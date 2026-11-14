import * as encoding from 'lib0/encoding';
import { WebSocket } from 'ws';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import {
  bindPresenceState,
  MAX_AWARENESS_BYTES,
  MAX_AWARENESS_CLIENTS,
  MAX_BUFFERED_BYTES,
  MAX_CONNS_PER_USER,
  MAX_DOC_BYTES,
  STEP1_BURST,
  sendOrDrop,
  type SendTarget,
} from '../src/ws.ts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';
import { agent, ORIGIN, signedUp, startEnv, type Agent, type TestEnv } from './helpers.ts';

let env: TestEnv;
let owner: Agent, editor: Agent, viewer: Agent, stranger: Agent;
let projectId: string;

/** Session cookie header of an agent. */
const cookieOf = (a: Agent) =>
  a
    .cookie()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');

/** A WebSocket class with the agent's cookie and Origin, for y-websocket. */
const wsFor = (a: Agent | null, origin = ORIGIN) =>
  class extends WebSocket {
    constructor(url: string) {
      super(url, { headers: { origin, ...(a ? { cookie: cookieOf(a) } : {}) } });
    }
  };

function connect(a: Agent | null, doc = new Y.Doc(), origin = ORIGIN) {
  const p = new WebsocketProvider(`ws://127.0.0.1:${env.port}/ws/projects`, projectId, doc, {
    WebSocketPolyfill: wsFor(a, origin) as unknown as typeof globalThis.WebSocket,
    disableBc: true,
    maxBackoffTime: 50,
  });
  return { doc, p };
}

const until = async (cond: () => boolean, ms = 5000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 20));
  }
};

/** Raw upgrade attempt: resolves with the HTTP status of a refused handshake, or 101. */
const handshake = (a: Agent | null, origin = ORIGIN, id = projectId) =>
  new Promise<number>((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${env.port}/ws/projects/${id}`, {
      headers: { origin, ...(a ? { cookie: cookieOf(a) } : {}) },
    });
    ws.on('open', () => {
      ws.close();
      resolve(101);
    });
    ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
    ws.on('error', () => {});
  });

/** A raw socket held open: resolves with it once open, or with the refused handshake's status. */
const openRaw = (a: Agent, id = projectId) =>
  new Promise<{ status: number; ws: WebSocket }>((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${env.port}/ws/projects/${id}`, {
      headers: { origin: ORIGIN, cookie: cookieOf(a) },
    });
    ws.on('open', () => resolve({ status: 101, ws }));
    ws.on('unexpected-response', (_req, res) => resolve({ status: res.statusCode ?? 0, ws }));
    ws.on('error', () => {});
  });

/** Close code and reason of a socket, once it closes. */
const closedWith = (ws: WebSocket) =>
  new Promise<{ code: number; reason: string }>((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) return resolve({ code: 1006, reason: '' });
    ws.on('close', (code, reason) => resolve({ code, reason: reason.toString() }));
  });

/** A presence (awareness) message with one entry. */
const presenceMessage = (clientId: number, clock: number, state: string) => {
  const update = encoding.createEncoder();
  encoding.writeVarUint(update, 1);
  encoding.writeVarUint(update, clientId);
  encoding.writeVarUint(update, clock);
  encoding.writeVarString(update, state);
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, 1);
  encoding.writeVarUint8Array(enc, encoding.toUint8Array(update));
  return encoding.toUint8Array(enc);
};

/** A sync step 1 message ("send me everything I am missing"). */
const step1 = () => {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, 0);
  syncProtocol.writeSyncStep1(enc, new Y.Doc());
  return encoding.toUint8Array(enc);
};

beforeAll(async () => {
  env = await startEnv();
  owner = await signedUp(env, 'o@example.org');
  editor = await signedUp(env, 'e@example.org');
  viewer = await signedUp(env, 'v@example.org');
  stranger = await signedUp(env, 's@example.org');
  projectId = (await owner.post('/api/projects', { name: 'Live' })).body.id;
  for (const [a, email, role] of [
    [editor, 'e@example.org', 'editor'],
    [viewer, 'v@example.org', 'viewer'],
  ] as const) {
    await owner.post(`/api/projects/${projectId}/invitations`, { email, role });
    const token = decodeURIComponent(
      /invite=([^\s]+)/.exec(env.deps.mailer.outbox.at(-1)!.text)![1],
    );
    await a.post(`/api/auth/invitations/${token}/accept`);
  }
});
afterAll(async () => {
  await env.close();
});

describe('collaboration socket', () => {
  it('refuses anonymous users, non-members, foreign origins and bad ids', async () => {
    expect(await handshake(null)).toBe(401);
    expect(await handshake(stranger)).toBe(403);
    expect(await handshake(owner, 'https://evil.example')).toBe(403);
    expect(await handshake(owner, ORIGIN, 'nope')).toBe(404);
    expect(await handshake(owner)).toBe(101);
  });

  it('refuses a malformed escape in the project id without crashing the server', async () => {
    // (decodeURIComponent('%FF') throws: in the upgrade listener that used to end the process)
    expect(await handshake(null, ORIGIN, '%FF')).toBe(404);
    expect(await handshake(owner, ORIGIN, `${projectId.slice(0, -2)}%E0%A4%A`)).toBe(404);
    expect(await handshake(owner)).toBe(101);
  });

  it('syncs edits between editors and persists them', async () => {
    const a = connect(owner),
      b = connect(editor);
    await until(() => a.p.synced && b.p.synced);
    a.doc.getMap('constructs').set('c1', 'Satisfaction');
    await until(() => b.doc.getMap('constructs').get('c1') === 'Satisfaction');
    b.doc.getMap('paths').set('p1', 'c1->c2');
    await until(() => a.doc.getMap('paths').get('p1') === 'c1->c2');
    a.p.destroy();
    b.p.destroy();
    await new Promise((r) => setTimeout(r, 100));
    const n = (
      await env.db.query('SELECT count(*)::int AS n FROM project_updates WHERE project_id = $1', [
        projectId,
      ])
    ).rows[0].n;
    expect(n).toBeGreaterThan(0);
  });

  it('ignores document changes from viewers but sends them the state', async () => {
    const v = connect(viewer),
      e = connect(editor);
    await until(() => v.p.synced && e.p.synced);
    expect(v.doc.getMap('constructs').get('c1')).toBe('Satisfaction');
    v.doc.getMap('constructs').set('hack', 'x');
    e.doc.getMap('constructs').set('c2', 'Loyalty');
    await until(() => v.doc.getMap('constructs').get('c2') === 'Loyalty');
    await new Promise((r) => setTimeout(r, 200));
    expect(e.doc.getMap('constructs').get('hack')).toBeUndefined();
    v.p.destroy();
    e.p.destroy();
  });

  it('shares presence (awareness) including from viewers', async () => {
    const v = connect(viewer),
      e = connect(editor);
    await until(() => v.p.synced && e.p.synced);
    v.p.awareness.setLocalStateField('cursor', { x: 1, y: 2 });
    await until(() =>
      [...e.p.awareness.getStates().values()].some(
        (s) => s.cursor?.x === 1 && s.user?.name === 'v',
      ),
    );
    v.p.destroy();
    e.p.destroy();
  });

  it('binds presence identity to the signed-in user', async () => {
    const viewerId = (await viewer.get('/api/auth/session')).body.user.id as string;
    const ownerId = (await owner.get('/api/auth/session')).body.user.id as string;
    const v = connect(viewer),
      e = connect(editor);
    await until(() => v.p.synced && e.p.synced);
    // A viewer claiming to be the owner, with a colour that is not a colour.
    v.p.awareness.setLocalStateField('user', {
      id: ownerId,
      name: 'o',
      color: 'red; background: url(x)',
    });
    v.p.awareness.setLocalStateField('selection', ['c1']);
    const seen = () => e.p.awareness.getStates().get(v.doc.clientID);
    await until(() => Array.isArray(seen()?.selection));
    expect(seen()?.user).toEqual({ id: viewerId, name: 'v' });
    v.p.awareness.setLocalStateField('user', { id: ownerId, name: 'o', color: '#2563eb' });
    await until(() => seen()?.user?.color === '#2563eb');
    expect(seen()?.user).toEqual({ id: viewerId, name: 'v', color: '#2563eb' });
    v.p.destroy();
    e.p.destroy();
  });

  it('ignores presence updates for another user’s presence id', async () => {
    const o = connect(owner);
    await until(() => o.p.synced);
    o.p.awareness.setLocalStateField('cursor', { x: 5, y: 5 });
    const room = await env.collab.rooms.get(projectId)!;
    await until(() => room.awareness.getStates().get(o.doc.clientID)?.cursor?.x === 5);
    const { ws } = await openRaw(editor);
    const clock = room.awareness.meta.get(o.doc.clientID)!.clock;
    // Overwrite, then remove, the owner's presence: later clocks for the owner's client id.
    ws.send(presenceMessage(o.doc.clientID, clock + 1, '{"cursor":{"x":9,"y":9}}'));
    ws.send(presenceMessage(o.doc.clientID, clock + 2, 'null'));
    // A marker sent after them: once it is applied, so would they have been.
    ws.send(presenceMessage(737373, 1, '{"cursor":{"x":0,"y":0}}'));
    await until(() => room.awareness.getStates().has(737373));
    expect(room.awareness.getStates().get(o.doc.clientID)?.cursor).toEqual({ x: 5, y: 5 });
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
    o.p.destroy();
  });

  it('does not count presence passed back by a client against its cap', async () => {
    // y-websocket sends every presence change it receives back to the server: a client
    // joining a room with more peers than MAX_AWARENESS_CLIENTS must not be refused.
    const peers: ReturnType<typeof connect>[] = [];
    for (let i = 0; i <= MAX_AWARENESS_CLIENTS; i++) {
      const p = connect(i % 2 === 0 ? owner : viewer);
      p.p.awareness.setLocalStateField('cursor', { x: i, y: i });
      peers.push(p);
    }
    await until(() => peers.every((p) => p.p.synced));
    const late = connect(editor);
    await until(() => late.p.awareness.getStates().size > MAX_AWARENESS_CLIENTS + 1);
    late.p.awareness.setLocalStateField('cursor', { x: 99, y: 99 });
    await until(() =>
      [...peers[0].p.awareness.getStates().values()].some((s) => s.cursor?.x === 99),
    );
    expect(late.p.wsconnected).toBe(true);
    for (const p of [...peers, late]) p.p.destroy();
  });

  it('lets a user’s new connection take over their own presence id', async () => {
    const first = await openRaw(editor);
    const second = await openRaw(editor);
    const send = (ws: WebSocket, clock: number, state: string) =>
      ws.send(presenceMessage(424242, clock, state));
    const room = await env.collab.rooms.get(projectId)!;
    send(first.ws, 1, '{"cursor":{"x":1,"y":1}}');
    await until(() => room.awareness.getStates().get(424242)?.cursor?.x === 1);
    send(second.ws, 2, '{"cursor":{"x":2,"y":2}}');
    await until(() => room.awareness.getStates().get(424242)?.cursor?.x === 2);
    // The old socket closing no longer removes the presence its successor now holds.
    first.ws.close();
    await new Promise((r) => setTimeout(r, 100));
    expect(room.awareness.getStates().get(424242)?.user?.name).toBe('e');
    expect(second.ws.readyState).toBe(WebSocket.OPEN);
    second.ws.close();
  });

  it('refuses a presence state that is not an object', () => {
    const who = { userId: 'u1', name: 'Ann' };
    expect(bindPresenceState('null', who)).toBe('null');
    expect(JSON.parse(bindPresenceState('{"user":{"id":"u2","name":"Bob"}}', who))).toEqual({
      user: { id: 'u1', name: 'Ann' },
    });
    expect(() => bindPresenceState('[1]', who)).toThrow('Invalid presence state');
    expect(() => bindPresenceState('"x"', who)).toThrow('Invalid presence state');
    expect(() => bindPresenceState('{', who)).toThrow('Invalid presence state');
  });

  it('closes a connection that sends an oversized presence state', async () => {
    const closed = new Promise<number>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${env.port}/ws/projects/${projectId}`, {
        headers: { origin: ORIGIN, cookie: cookieOf(editor) },
      });
      ws.on('close', (code) => resolve(code));
      ws.on('open', () => {
        const aw = new awarenessProtocol.Awareness(new Y.Doc());
        aw.setLocalState({ user: { name: 'x'.repeat(MAX_AWARENESS_BYTES) } });
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, 1);
        encoding.writeVarUint8Array(
          enc,
          awarenessProtocol.encodeAwarenessUpdate(aw, [aw.clientID]),
        );
        ws.send(encoding.toUint8Array(enc));
      });
    });
    expect(await closed).toBe(1009);
  });

  it('refuses an editor’s change that would grow the document past its cap', async () => {
    const closed = new Promise<{ code: number; reason: string }>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${env.port}/ws/projects/${projectId}`, {
        headers: { origin: ORIGIN, cookie: cookieOf(editor) },
      });
      ws.on('close', (code, reason) => resolve({ code, reason: reason.toString() }));
      ws.on('open', () => {
        const d = new Y.Doc();
        d.getText('junk').insert(0, 'x'.repeat(MAX_DOC_BYTES + 1));
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, 0);
        syncProtocol.writeUpdate(enc, Y.encodeStateAsUpdate(d));
        ws.send(encoding.toUint8Array(enc));
      });
    });
    expect(await closed).toEqual({ code: 1009, reason: 'Document too big' });
    // The document is as it was: the next editor sees no junk.
    const { doc, p } = connect(editor);
    await until(() => p.synced);
    expect(doc.getText('junk').length).toBe(0);
    p.destroy();
  });

  it('caps the open sockets of one user', async () => {
    const sockets: WebSocket[] = [];
    for (let i = 0; i < MAX_CONNS_PER_USER; i++) {
      const ws = new WebSocket(`ws://127.0.0.1:${env.port}/ws/projects/${projectId}`, {
        headers: { origin: ORIGIN, cookie: cookieOf(viewer) },
      });
      await new Promise<void>((r) => ws.on('open', () => r()));
      sockets.push(ws);
    }
    expect(await handshake(viewer)).toBe(429);
    sockets[0].close();
    await until(() => sockets[0].readyState === WebSocket.CLOSED);
    await new Promise((r) => setTimeout(r, 50));
    expect(await handshake(viewer)).toBe(101);
    sockets.forEach((ws) => ws.close());
  });

  it('restores the document from the database after compaction', async () => {
    const room = await env.collab.rooms.get(projectId)!;
    await room.compact();
    await env.collab.close(); // drop all rooms
    const fresh = await import('../src/ws.ts');
    env.collab = fresh.attachCollab(
      env.server,
      env.db,
      (env.app as unknown as { sessionMiddleware: Parameters<typeof fresh.attachCollab>[2] })
        .sessionMiddleware,
      ORIGIN,
    );
    env.deps.onMembershipChange = (p, u) => {
      void env.collab.membershipChanged(p, u);
    };
    env.deps.onSessionsEnded = (u, opts) => env.collab.sessionsEnded(u, opts);
    const c = connect(owner);
    await until(() => c.p.synced);
    expect(c.doc.getMap('constructs').get('c2')).toBe('Loyalty');
    expect(
      (
        await env.db.query('SELECT count(*)::int AS n FROM project_updates WHERE project_id = $1', [
          projectId,
        ])
      ).rows[0].n,
    ).toBe(0);
    c.p.destroy();
  });

  it('disconnects a member as soon as access is removed', async () => {
    const e = connect(editor);
    await until(() => e.p.synced);
    let closedWith = 0;
    e.p.ws!.addEventListener('close', (ev) => {
      closedWith = (ev as CloseEvent).code;
    });
    const editorId = (await env.db.query("SELECT id FROM users WHERE email = 'e@example.org'"))
      .rows[0].id;
    expect((await owner.del(`/api/projects/${projectId}/members/${editorId}`)).status).toBe(200);
    await until(() => closedWith !== 0);
    expect(closedWith).toBe(4403);
    e.p.destroy();
  });

  it('closes a connection that keeps asking for the whole document', async () => {
    const { ws } = await openRaw(viewer);
    const closed = closedWith(ws);
    for (let i = 0; i <= STEP1_BURST; i++) ws.send(step1());
    expect(await closed).toEqual({ code: 1008, reason: 'Rate limit' });
  });

  it('answers a few sync requests on one connection', async () => {
    const { ws } = await openRaw(viewer);
    let replies = 0;
    ws.on('message', () => replies++);
    for (let i = 0; i < STEP1_BURST; i++) ws.send(step1());
    // one reply per request (the server's own step 1 on join may come before the listener)
    await until(() => replies >= STEP1_BURST);
    await new Promise((r) => setTimeout(r, 50));
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it('caps the presence states one connection may speak for', async () => {
    const { ws } = await openRaw(viewer);
    const closed = closedWith(ws);
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, 1);
    const update = encoding.createEncoder();
    encoding.writeVarUint(update, MAX_AWARENESS_CLIENTS + 1);
    for (let id = 1; id <= MAX_AWARENESS_CLIENTS + 1; id++) {
      encoding.writeVarUint(update, id);
      encoding.writeVarUint(update, 1);
      encoding.writeVarString(update, '{"user":{"name":"x"}}');
    }
    encoding.writeVarUint8Array(enc, encoding.toUint8Array(update));
    ws.send(encoding.toUint8Array(enc));
    expect(await closed).toEqual({ code: 1008, reason: 'Too many presence states' });
  });

  it('drops a socket whose unsent backlog passes the cap', () => {
    const sent: Uint8Array[] = [];
    let terminated = false;
    const fake = (bufferedAmount: number): SendTarget => ({
      readyState: WebSocket.OPEN,
      bufferedAmount,
      send: (m) => sent.push(m),
      terminate: () => {
        terminated = true;
      },
    });
    expect(MAX_BUFFERED_BYTES).toBeGreaterThan(MAX_DOC_BYTES);
    expect(sendOrDrop(fake(0), new Uint8Array(10))).toBe(true);
    expect(sendOrDrop(fake(MAX_BUFFERED_BYTES - 10), new Uint8Array(10))).toBe(true);
    expect(terminated).toBe(false);
    expect(sendOrDrop(fake(MAX_BUFFERED_BYTES - 10), new Uint8Array(11))).toBe(false);
    expect(terminated).toBe(true);
    expect(sent.length).toBe(2);
  });

  it('holds the per-user cap against parallel handshakes', async () => {
    const tries = await Promise.all(
      Array.from({ length: MAX_CONNS_PER_USER + 5 }, () => openRaw(viewer)),
    );
    const opened = tries.filter((t) => t.status === 101);
    expect(opened.length).toBe(MAX_CONNS_PER_USER);
    expect(tries.filter((t) => t.status === 429).length).toBe(5);
    await Promise.all(
      opened.map((t) => {
        const c = closedWith(t.ws);
        t.ws.close();
        return c;
      }),
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(await handshake(viewer)).toBe(101);
  });

  it('closes the sockets of a session that signs out, not those of other sessions', async () => {
    const other = await agent(env);
    await other.post('/api/auth/login', {
      email: 'o@example.org',
      password: 'correct horse battery',
    });
    const mine = (await openRaw(owner)).ws;
    const theirs = (await openRaw(other)).ws;
    expect(mine.readyState).toBe(WebSocket.OPEN);
    expect(theirs.readyState).toBe(WebSocket.OPEN);
    const closed = closedWith(theirs);
    await other.refresh();
    expect((await other.post('/api/auth/logout')).status).toBe(200);
    expect(await closed).toEqual({ code: 4401, reason: 'Signed out' });
    await new Promise((r) => setTimeout(r, 50));
    expect(mine.readyState).toBe(WebSocket.OPEN);
    mine.close();
  });

  it('closes the other sessions’ sockets on a password change and all of them on a reset', async () => {
    const a = await signedUp(env, 'pw@example.org');
    const pid = (await a.post('/api/projects', { name: 'PW' })).body.id;
    const b = await agent(env);
    await b.post('/api/auth/login', { email: 'pw@example.org', password: 'correct horse battery' });
    const mine = (await openRaw(a, pid)).ws;
    const theirs = (await openRaw(b, pid)).ws;
    const theirsClosed = closedWith(theirs);
    const change = await a.post('/api/auth/password/change', {
      current: 'correct horse battery',
      password: 'another long password',
    });
    expect(change.status).toBe(200);
    expect((await theirsClosed).code).toBe(4401);
    await new Promise((r) => setTimeout(r, 50));
    expect(mine.readyState).toBe(WebSocket.OPEN);

    const mineClosed = closedWith(mine);
    await (await agent(env)).post('/api/auth/password/forgot', { email: 'pw@example.org' });
    const token = /reset=([^\s&]+)/.exec(env.deps.mailer.outbox.at(-1)!.text)![1];
    const reset = await (
      await agent(env)
    ).post('/api/auth/password/reset', {
      token: decodeURIComponent(token),
      password: 'a third long password',
    });
    expect(reset.status).toBe(200);
    expect((await mineClosed).code).toBe(4401);
  });
});
