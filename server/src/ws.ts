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
export class TooBig extends Error {}

interface Conn { ws: WebSocket; userId: string; role: Role; clientIds: Set<number>; tokens: number; last: number }

class Room {
  readonly doc = new Y.Doc();
  readonly awareness: awarenessProtocol.Awareness;
  readonly conns = new Set<Conn>();
  private pending = 0;
  private closeTimer: NodeJS.Timeout | null = null;
  private readonly projectId: string;
  private readonly db: Db;
  private readonly onEmpty: () => void;

  constructor(projectId: string, db: Db, onEmpty: () => void) {
    this.projectId = projectId;
    this.db = db;
    this.onEmpty = onEmpty;
    this.awareness = new awarenessProtocol.Awareness(this.doc);
    this.awareness.setLocalState(null);
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === 'load') return;
      this.broadcast(this.syncUpdate(update), origin as Conn | undefined);
      void this.persist(update);
    });
    this.awareness.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      const changed = [...added, ...updated, ...removed];
      const conn = origin as Conn | undefined;
      if (conn?.clientIds) { added.forEach((id) => conn.clientIds.add(id)); removed.forEach((id) => conn.clientIds.delete(id)); }
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MSG_AWARENESS);
      encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed));
      this.broadcast(encoding.toUint8Array(enc));
    });
  }

  async load() {
    const p = await this.db.query('SELECT yjs_state FROM projects WHERE id = $1', [this.projectId]);
    if (p.rows[0]?.yjs_state) Y.applyUpdate(this.doc, p.rows[0].yjs_state, 'load');
    const u = await this.db.query('SELECT update FROM project_updates WHERE project_id = $1 ORDER BY id', [this.projectId]);
    for (const row of u.rows) Y.applyUpdate(this.doc, row.update, 'load');
    this.pending = u.rowCount ?? 0;
  }

  private syncUpdate(update: Uint8Array) {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_SYNC);
    syncProtocol.writeUpdate(enc, update);
    return encoding.toUint8Array(enc);
  }

  private broadcast(msg: Uint8Array, except?: Conn) {
    for (const c of this.conns) if (c !== except && c.ws.readyState === WebSocket.OPEN) c.ws.send(msg);
  }

  private async persist(update: Uint8Array) {
    try {
      await this.db.query('INSERT INTO project_updates (project_id, update) VALUES ($1, $2)', [this.projectId, Buffer.from(update)]);
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
      const maxId = (await client.query('SELECT max(id) AS m FROM project_updates WHERE project_id = $1', [this.projectId])).rows[0].m;
      await client.query('UPDATE projects SET yjs_state = $2 WHERE id = $1', [this.projectId, Buffer.from(Y.encodeStateAsUpdate(this.doc))]);
      if (maxId) await client.query('DELETE FROM project_updates WHERE project_id = $1 AND id <= $2', [this.projectId, maxId]);
      await client.query('COMMIT');
      this.pending = 0;
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('compaction failed', err);
    } finally {
      client.release();
    }
  }

  add(conn: Conn) {
    if (this.closeTimer) { clearTimeout(this.closeTimer); this.closeTimer = null; }
    this.conns.add(conn);
    // Initial sync: step 1 (our state vector) and current presence.
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_SYNC);
    syncProtocol.writeSyncStep1(enc, this.doc);
    conn.ws.send(encoding.toUint8Array(enc));
    const states = [...this.awareness.getStates().keys()];
    if (states.length) {
      const a = encoding.createEncoder();
      encoding.writeVarUint(a, MSG_AWARENESS);
      encoding.writeVarUint8Array(a, awarenessProtocol.encodeAwarenessUpdate(this.awareness, states));
      conn.ws.send(encoding.toUint8Array(a));
    }
  }

  message(conn: Conn, data: Uint8Array) {
    const dec = decoding.createDecoder(data);
    const type = decoding.readVarUint(dec);
    if (type === MSG_SYNC) {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MSG_SYNC);
      if (conn.role === 'viewer') {
        // Viewers may request state but their document changes are ignored.
        const sub = decoding.readVarUint(dec);
        if (sub === syncProtocol.messageYjsSyncStep1) syncProtocol.readSyncStep1(dec, enc, this.doc);
      } else {
        syncProtocol.readSyncMessage(dec, enc, this.doc, conn);
      }
      if (encoding.length(enc) > 1) conn.ws.send(encoding.toUint8Array(enc));
    } else if (type === MSG_AWARENESS) {
      const update = decoding.readVarUint8Array(dec);
      if (update.length > MAX_AWARENESS_BYTES) throw new TooBig('presence state too big');
      awarenessProtocol.applyAwarenessUpdate(this.awareness, update, conn);
    }
  }

  remove(conn: Conn) {
    this.conns.delete(conn);
    awarenessProtocol.removeAwarenessStates(this.awareness, [...conn.clientIds], null);
    if (this.conns.size === 0) {
      this.closeTimer = setTimeout(() => { void this.compact().finally(() => this.onEmpty()); }, 30_000);
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
  rooms: Map<string, Promise<Room>>;
  close(): Promise<void>;
}

type SessionMw = (req: IncomingMessage, res: unknown, next: (err?: unknown) => void) => void;

export function attachCollab(server: Server, db: Db, sessionMw: SessionMw, appOrigin: string): Collab {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD });
  const rooms = new Map<string, Promise<Room>>();
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  const getRoom = (id: string) => {
    let r = rooms.get(id);
    if (!r) {
      const room = new Room(id, db, () => { rooms.delete(id); room.destroy(); });
      r = room.load().then(() => room);
      rooms.set(id, r);
      r.catch(() => rooms.delete(id));
    }
    return r;
  };

  const reject = (socket: Duplex, code: number, text: string) => {
    socket.write(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  };

  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const m = /^\/ws\/projects\/([^/?]+)/.exec(req.url ?? '');
    if (!m) return reject(socket, 404, 'Not Found');
    if (req.headers.origin !== appOrigin) return reject(socket, 403, 'Forbidden');
    const projectId = decodeURIComponent(m[1]);
    if (!UUID.test(projectId)) return reject(socket, 404, 'Not Found');
    sessionMw(req, {}, async () => {
      try {
        const userId = (req as unknown as { session?: { userId?: string } }).session?.userId;
        if (!userId) return reject(socket, 401, 'Unauthorized');
        const role = await roleOf(db, projectId, userId);
        if (!role) return reject(socket, 403, 'Forbidden');
        const room = await getRoom(projectId);
        wss.handleUpgrade(req, socket, head, (ws) => {
          const conn: Conn = { ws, userId, role, clientIds: new Set(), tokens: RATE, last: Date.now() };
          room.add(conn);
          ws.on('message', (data, isBinary) => {
            if (!isBinary) return;
            const now = Date.now();
            conn.tokens = Math.min(RATE, conn.tokens + ((now - conn.last) / 1000) * RATE);
            conn.last = now;
            if (conn.tokens < 1) return ws.close(1008, 'Rate limit');
            conn.tokens -= 1;
            try {
              room.message(conn, new Uint8Array(data as Buffer));
            } catch (err) {
              ws.close(err instanceof TooBig ? 1009 : 1007, err instanceof TooBig ? 'Presence state too big' : 'Malformed message');
            }
          });
          ws.on('close', () => room.remove(conn));
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
    async close() {
      server.off('upgrade', onUpgrade);
      for (const r of rooms.values()) {
        const room = await r;
        for (const c of room.conns) c.ws.terminate();
        await room.compact();
        room.destroy();
      }
      rooms.clear();
      wss.close();
    },
  };
}
