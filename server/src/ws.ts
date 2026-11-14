// Real-time collaboration: a Y.js WebSocket server speaking the y-websocket
// protocol (sync + awareness). Authentication uses the HTTP session cookie;
// the Origin header must match the app (prevents cross-site WebSocket
// hijacking); roles are re-checked whenever membership changes.

import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import { WebSocket, WebSocketServer } from 'ws';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import type { Db } from './db.ts';
import { roleOf, type Role } from './services/projects.ts';

const MSG_SYNC = 0;
const MSG_AWARENESS = 1;
const COMPACT_AFTER = 200;
const MAX_PAYLOAD = 2 * 1024 * 1024;
/** Messages per second per connection (token bucket). */
const RATE = 200;
/** Presence (awareness) states are a name, a colour and a selection: anything bigger is refused. */
export const MAX_AWARENESS_BYTES = 8 * 1024;
/**
 * A project document (model, settings, cards without results) is kilobytes;
 * past this size an editor's changes are refused, so one member cannot fill
 * the database. Counted as the compacted state plus the updates since.
 */
export const MAX_DOC_BYTES = Number(process.env.PLS_MAX_DOC_BYTES) || 16 * 1024 * 1024;
/** Open sockets per user over all projects (a few tabs and devices; not a thousand). */
export const MAX_CONNS_PER_USER = 10;
/**
 * Bytes a socket may have queued but not yet sent before it is dropped. The
 * largest single message is the whole document (a sync reply: at most
 * MAX_DOC_BYTES plus one update of at most MAX_PAYLOAD); a client that reads
 * its socket has at most a couple of those in flight. One that stops reading
 * (or keeps asking for the document) would otherwise make the server buffer
 * without limit, against a process memory cap of 1 GB.
 */
export const MAX_BUFFERED_BYTES = 2 * MAX_DOC_BYTES + MAX_PAYLOAD;
/**
 * Sync step 1 ("send me what I am missing": the server answers with up to
 * the whole document) per connection: a client sends one when it connects;
 * a few spare, then one per STEP1_REFILL_MS.
 */
export const STEP1_BURST = 3;
const STEP1_REFILL_MS = 10_000;
/** Presence (awareness) client ids per connection: one per open document in a tab; a few spare. */
export const MAX_AWARENESS_CLIENTS = 4;

/** A message the server refuses: the connection is closed with this code and reason. */
export class Refused extends Error {
  readonly code: number;
  constructor(code: number, reason: string) {
    super(reason);
    this.code = code;
  }
}
export class TooBig extends Refused {
  constructor(reason: string) {
    super(1009, reason);
  }
}

interface Conn {
  ws: WebSocket;
  userId: string;
  /** The HTTP session the socket was opened with (closed when that session ends). */
  sessionId: string;
  role: Role;
  clientIds: Set<number>;
  tokens: number;
  last: number;
  step1Tokens: number;
  step1Last: number;
}

/** Minimal view of a socket for `sendOrDrop` (a `ws` WebSocket satisfies it). */
export interface SendTarget {
  readonly readyState: number;
  readonly bufferedAmount: number;
  send(data: Uint8Array): void;
  terminate(): void;
}

/**
 * Send, unless the peer is not keeping up: past MAX_BUFFERED_BYTES queued the
 * socket is terminated (not closed: a close frame would queue behind the
 * backlog), which frees the buffer at once. Returns whether it was sent.
 */
export function sendOrDrop(ws: SendTarget, msg: Uint8Array): boolean {
  if (ws.readyState !== WebSocket.OPEN) return false;
  if (ws.bufferedAmount + msg.length > MAX_BUFFERED_BYTES) {
    ws.terminate();
    return false;
  }
  ws.send(msg);
  return true;
}

/** Client ids an awareness update speaks for (throws on a malformed update). */
function awarenessClientIds(update: Uint8Array): number[] {
  const dec = decoding.createDecoder(update);
  const n = decoding.readVarUint(dec);
  const ids: number[] = [];
  for (let i = 0; i < n; i++) {
    ids.push(decoding.readVarUint(dec));
    decoding.readVarUint(dec); // clock
    decoding.readVarString(dec); // state (JSON)
  }
  return ids;
}

/** Take one sync-step-1 token (refilled over time); refuse when none is left. */
function takeStep1Token(conn: Conn) {
  const now = Date.now();
  conn.step1Tokens = Math.min(
    STEP1_BURST,
    conn.step1Tokens + (now - conn.step1Last) / STEP1_REFILL_MS,
  );
  conn.step1Last = now;
  if (conn.step1Tokens < 1) throw new Refused(1008, 'Rate limit');
  conn.step1Tokens -= 1;
}

class Room {
  readonly doc = new Y.Doc();
  readonly awareness: awarenessProtocol.Awareness;
  readonly conns = new Set<Conn>();
  /** Bytes the document takes as stored (an upper bound: state + updates since compaction). */
  bytes = 0;
  private pending = 0;
  private closeTimer: NodeJS.Timeout | null = null;
  /**
   * Set (for good) when the close timer fires: the room is being saved and
   * destroyed, and takes no new connections (attachCollab hands a joiner a
   * fresh room, loaded once this one's save has finished).
   */
  closing = false;
  private readonly projectId: string;
  private readonly db: Db;
  private readonly onIdle: (room: Room) => void;
  private readonly closeAfterMs: number;

  constructor(projectId: string, db: Db, onIdle: (room: Room) => void, closeAfterMs: number) {
    this.projectId = projectId;
    this.db = db;
    this.onIdle = onIdle;
    this.closeAfterMs = closeAfterMs;
    this.awareness = new awarenessProtocol.Awareness(this.doc);
    this.awareness.setLocalState(null);
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === 'load') return;
      this.bytes += update.length;
      this.broadcast(this.syncUpdate(update), origin as Conn | undefined);
      void this.persist(update);
    });
    this.awareness.on(
      'update',
      (
        { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
        origin: unknown,
      ) => {
        const changed = [...added, ...updated, ...removed];
        const conn = origin as Conn | undefined;
        if (conn?.clientIds) {
          added.forEach((id) => conn.clientIds.add(id));
          removed.forEach((id) => conn.clientIds.delete(id));
        }
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, MSG_AWARENESS);
        encoding.writeVarUint8Array(
          enc,
          awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed),
        );
        this.broadcast(encoding.toUint8Array(enc));
      },
    );
  }

  async load() {
    const p = await this.db.query('SELECT yjs_state FROM projects WHERE id = $1', [this.projectId]);
    if (p.rows[0]?.yjs_state) Y.applyUpdate(this.doc, p.rows[0].yjs_state, 'load');
    const u = await this.db.query(
      'SELECT update FROM project_updates WHERE project_id = $1 ORDER BY id',
      [this.projectId],
    );
    for (const row of u.rows) Y.applyUpdate(this.doc, row.update, 'load');
    this.pending = u.rowCount ?? 0;
    this.bytes = Y.encodeStateAsUpdate(this.doc).length;
  }

  private syncUpdate(update: Uint8Array) {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_SYNC);
    syncProtocol.writeUpdate(enc, update);
    return encoding.toUint8Array(enc);
  }

  private broadcast(msg: Uint8Array, except?: Conn) {
    for (const c of this.conns) if (c !== except) sendOrDrop(c.ws, msg);
  }

  private async persist(update: Uint8Array) {
    try {
      await this.db.query('INSERT INTO project_updates (project_id, update) VALUES ($1, $2)', [
        this.projectId,
        Buffer.from(update),
      ]);
      await this.db.query('UPDATE projects SET updated_at = now() WHERE id = $1', [this.projectId]);
      if (++this.pending >= COMPACT_AFTER) await this.compact();
    } catch (err) {
      console.error('persist failed', err);
    }
  }

  /** Fold all updates into the snapshot (state covers every update written so far). */
  async compact() {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const maxId = (
        await client.query('SELECT max(id) AS m FROM project_updates WHERE project_id = $1', [
          this.projectId,
        ])
      ).rows[0].m;
      const state = Y.encodeStateAsUpdate(this.doc);
      await client.query('UPDATE projects SET yjs_state = $2 WHERE id = $1', [
        this.projectId,
        Buffer.from(state),
      ]);
      if (maxId)
        await client.query('DELETE FROM project_updates WHERE project_id = $1 AND id <= $2', [
          this.projectId,
          maxId,
        ]);
      await client.query('COMMIT');
      this.pending = 0;
      this.bytes = state.length;
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('compaction failed', err);
    } finally {
      client.release();
    }
  }

  /** Join; false when the room is closing (the caller must use a fresh room). */
  add(conn: Conn): boolean {
    if (this.closing) return false;
    if (this.closeTimer) {
      clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }
    this.conns.add(conn);
    // Initial sync: step 1 (our state vector) and current presence.
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_SYNC);
    syncProtocol.writeSyncStep1(enc, this.doc);
    sendOrDrop(conn.ws, encoding.toUint8Array(enc));
    const states = [...this.awareness.getStates().keys()];
    if (states.length) {
      const a = encoding.createEncoder();
      encoding.writeVarUint(a, MSG_AWARENESS);
      encoding.writeVarUint8Array(
        a,
        awarenessProtocol.encodeAwarenessUpdate(this.awareness, states),
      );
      sendOrDrop(conn.ws, encoding.toUint8Array(a));
    }
    return true;
  }

  message(conn: Conn, data: Uint8Array) {
    const dec = decoding.createDecoder(data);
    const type = decoding.readVarUint(dec);
    if (type === MSG_SYNC) {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MSG_SYNC);
      const sub = decoding.readVarUint(dec);
      if (sub === syncProtocol.messageYjsSyncStep1) {
        // Answered with up to the whole document: rationed per connection.
        takeStep1Token(conn);
        syncProtocol.readSyncStep1(dec, enc, this.doc);
      } else if (conn.role === 'viewer') {
        // Viewers may request state but their document changes are ignored.
      } else if (
        sub === syncProtocol.messageYjsSyncStep2 ||
        sub === syncProtocol.messageYjsUpdate
      ) {
        // (the message is at most the update it carries plus a few bytes: an upper bound on the growth)
        if (this.bytes + data.length > MAX_DOC_BYTES) throw new TooBig('Document too big');
        if (sub === syncProtocol.messageYjsSyncStep2)
          syncProtocol.readSyncStep2(dec, this.doc, conn);
        else syncProtocol.readUpdate(dec, this.doc, conn);
      } else {
        throw new Error('unknown sync message');
      }
      if (encoding.length(enc) > 1) sendOrDrop(conn.ws, encoding.toUint8Array(enc));
    } else if (type === MSG_AWARENESS) {
      const update = decoding.readVarUint8Array(dec);
      if (update.length > MAX_AWARENESS_BYTES) throw new TooBig('Presence state too big');
      const ids = new Set(conn.clientIds);
      for (const id of awarenessClientIds(update)) ids.add(id);
      if (ids.size > MAX_AWARENESS_CLIENTS) throw new Refused(1008, 'Too many presence states');
      awarenessProtocol.applyAwarenessUpdate(this.awareness, update, conn);
    }
  }

  remove(conn: Conn) {
    this.conns.delete(conn);
    awarenessProtocol.removeAwarenessStates(this.awareness, [...conn.clientIds], null);
    if (this.conns.size === 0 && !this.closing) {
      this.closeTimer = setTimeout(() => {
        this.closeTimer = null;
        this.closing = true;
        this.onIdle(this);
      }, this.closeAfterMs);
      this.closeTimer.unref();
    }
  }

  destroy() {
    if (this.closeTimer) clearTimeout(this.closeTimer);
    this.awareness.destroy();
    this.doc.destroy();
  }
}

export interface Collab {
  /** Re-check roles after a membership change (removes or downgrades connections). */
  membershipChanged(projectId: string, userId?: string): Promise<void>;
  /**
   * Sessions of a user ended (logout, password reset or change, account
   * claimed): close the sockets opened with them. `only` limits it to one
   * session (logout); `keep` spares one (the session that changed the password).
   */
  sessionsEnded(userId: string, opts?: { only?: string; keep?: string }): void;
  rooms: Map<string, Promise<Room>>;
  close(): Promise<void>;
}

export interface CollabOptions {
  /** How long an empty room stays in memory before it is saved and dropped. */
  closeAfterMs?: number;
}

type SessionMw = (req: IncomingMessage, res: unknown, next: (err?: unknown) => void) => void;

export function attachCollab(
  server: Server,
  db: Db,
  sessionMw: SessionMw,
  appOrigin: string,
  options: CollabOptions = {},
): Collab {
  const closeAfterMs = options.closeAfterMs ?? 30_000;
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD });
  const rooms = new Map<string, Promise<Room>>();
  /** Rooms being saved after their last member left, by project: a new room loads only after. */
  const closing = new Map<string, Promise<void>>();
  const conns = new Set<Conn>();
  const perUser = new Map<string, number>();
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  const getRoom = (id: string) => {
    const existing = rooms.get(id);
    if (existing) return existing;
    let entry: Promise<Room>;
    // The close timer fired: take the room out of the map (only if it is still
    // this room's entry), then save and destroy it. Until the save has finished,
    // a joiner waits (below) rather than loading a half-compacted state.
    const onIdle = (room: Room) => {
      if (rooms.get(id) === entry) rooms.delete(id);
      const done = room.compact().finally(() => {
        room.destroy();
        if (closing.get(id) === done) closing.delete(id);
      });
      closing.set(id, done);
    };
    const room = new Room(id, db, onIdle, closeAfterMs);
    const saved = closing.get(id) ?? Promise.resolve();
    entry = saved.then(() => room.load()).then(() => room);
    rooms.set(id, entry);
    entry.catch(() => {
      if (rooms.get(id) === entry) rooms.delete(id);
    });
    return entry;
  };

  const reject = (socket: Duplex, code: number, text: string) => {
    socket.write(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  };

  /**
   * Count a socket against its user's cap from now until the raw socket closes
   * (whether the upgrade completes, is refused or fails), so that parallel
   * handshakes cannot all pass the check. False when the cap is reached.
   */
  const reserveSlot = (userId: string, socket: Duplex): boolean => {
    const n = perUser.get(userId) ?? 0;
    if (n >= MAX_CONNS_PER_USER) return false;
    perUser.set(userId, n + 1);
    socket.once('close', () => {
      const left = (perUser.get(userId) ?? 1) - 1;
      if (left > 0) perUser.set(userId, left);
      else perUser.delete(userId);
    });
    return true;
  };

  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const m = /^\/ws\/projects\/([^/?]+)/.exec(req.url ?? '');
    if (!m) return reject(socket, 404, 'Not Found');
    if (req.headers.origin !== appOrigin) return reject(socket, 403, 'Forbidden');
    // (a project id is a UUID, which needs no decoding; decodeURIComponent would throw on a
    //  malformed escape such as %FF — in this listener that would take the whole server down)
    const projectId = m[1];
    if (!UUID.test(projectId)) return reject(socket, 404, 'Not Found');
    sessionMw(req, {}, async () => {
      try {
        const sessionReq = req as unknown as { session?: { userId?: string }; sessionID?: string };
        const userId = sessionReq.session?.userId;
        const sessionId = sessionReq.sessionID;
        if (!userId || !sessionId) return reject(socket, 401, 'Unauthorized');
        const role = await roleOf(db, projectId, userId);
        if (!role) return reject(socket, 403, 'Forbidden');
        // (the client may have gone while we waited: its 'close' has fired, nothing to reserve)
        if (socket.destroyed) return;
        if (!reserveSlot(userId, socket)) return reject(socket, 429, 'Too Many Connections');
        const room = await getRoom(projectId);
        if (socket.destroyed) return;
        wss.handleUpgrade(req, socket, head, (ws) => {
          const now = Date.now();
          const conn: Conn = {
            ws,
            userId,
            sessionId,
            role,
            clientIds: new Set(),
            tokens: RATE,
            last: now,
            step1Tokens: STEP1_BURST,
            step1Last: now,
          };
          if (!room.add(conn)) {
            // The room started closing in the meantime: the client reconnects into a fresh one.
            ws.close(1013, 'Try again');
            return;
          }
          conns.add(conn);
          ws.on('message', (data, isBinary) => {
            if (!isBinary) return;
            const t = Date.now();
            conn.tokens = Math.min(RATE, conn.tokens + ((t - conn.last) / 1000) * RATE);
            conn.last = t;
            if (conn.tokens < 1) return ws.close(1008, 'Rate limit');
            conn.tokens -= 1;
            try {
              room.message(conn, new Uint8Array(data as Buffer));
            } catch (err) {
              if (err instanceof Refused) ws.close(err.code, err.message);
              else ws.close(1007, 'Malformed message');
            }
          });
          ws.on('close', () => {
            conns.delete(conn);
            room.remove(conn);
          });
        });
      } catch (err) {
        console.error('ws upgrade failed', err);
        reject(socket, 500, 'Internal Server Error');
      }
    });
  };
  server.on('upgrade', onUpgrade);

  return {
    rooms,
    async membershipChanged(projectId, userId) {
      const r = rooms.get(projectId);
      if (!r) return;
      const room = await r;
      for (const c of [...room.conns]) {
        if (userId && c.userId !== userId) continue;
        const role = await roleOf(db, projectId, c.userId);
        if (!role) c.ws.close(4403, 'Access removed');
        else c.role = role;
      }
    },
    sessionsEnded(userId, opts = {}) {
      for (const c of [...conns]) {
        if (c.userId !== userId) continue;
        if (opts.only !== undefined && c.sessionId !== opts.only) continue;
        if (opts.keep !== undefined && c.sessionId === opts.keep) continue;
        c.ws.close(4401, 'Signed out');
      }
    },
    async close() {
      server.off('upgrade', onUpgrade);
      for (const r of rooms.values()) {
        const room = await r;
        for (const c of room.conns) c.ws.terminate();
        await room.compact();
        room.destroy();
      }
      rooms.clear();
      await Promise.all(closing.values());
      wss.close();
    },
  };
}
