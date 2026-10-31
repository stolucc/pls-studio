import * as encoding from 'lib0/encoding';
import { WebSocket } from 'ws';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import { MAX_AWARENESS_BYTES, MAX_CONNS_PER_USER, MAX_DOC_BYTES } from '../src/ws.ts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';
import { ORIGIN, signedUp, startEnv, type Agent, type TestEnv } from './helpers.ts';

let env: TestEnv;
let owner: Agent, editor: Agent, viewer: Agent, stranger: Agent;
let projectId: string;

/** Session cookie header of an agent. */
const cookieOf = (a: Agent) => a.cookie().map((c) => `${c.name}=${c.value}`).join('; ');

/** A WebSocket class with the agent's cookie and Origin, for y-websocket. */
const wsFor = (a: Agent | null, origin = ORIGIN) => class extends WebSocket {
  constructor(url: string) { super(url, { headers: { origin, ...(a ? { cookie: cookieOf(a) } : {}) } }); }
};

function connect(a: Agent | null, doc = new Y.Doc(), origin = ORIGIN) {
  const p = new WebsocketProvider(`ws://127.0.0.1:${env.port}/ws/projects`, projectId, doc, {
    WebSocketPolyfill: wsFor(a, origin) as unknown as typeof globalThis.WebSocket, disableBc: true, maxBackoffTime: 50,
  });
  return { doc, p };
}

const until = async (cond: () => boolean, ms = 5000) => {
  const t0 = Date.now();
  while (!cond()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 20)); }
};

/** Raw upgrade attempt: resolves with the HTTP status of a refused handshake, or 101. */
const handshake = (a: Agent | null, origin = ORIGIN, id = projectId) => new Promise<number>((resolve) => {
  const ws = new WebSocket(`ws://127.0.0.1:${env.port}/ws/projects/${id}`, { headers: { origin, ...(a ? { cookie: cookieOf(a) } : {}) } });
  ws.on('open', () => { ws.close(); resolve(101); });
  ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
  ws.on('error', () => {});
});

beforeAll(async () => {
  env = await startEnv();
  owner = await signedUp(env, 'o@example.org');
  editor = await signedUp(env, 'e@example.org');
  viewer = await signedUp(env, 'v@example.org');
  stranger = await signedUp(env, 's@example.org');
  projectId = (await owner.post('/api/projects', { name: 'Live' })).body.id;
  for (const [a, email, role] of [[editor, 'e@example.org', 'editor'], [viewer, 'v@example.org', 'viewer']] as const) {
    await owner.post(`/api/projects/${projectId}/invitations`, { email, role });
    const token = decodeURIComponent(/invite=([^\s]+)/.exec(env.deps.mailer.outbox.at(-1)!.text)![1]);
    await a.post(`/api/auth/invitations/${token}/accept`);
  }
});
afterAll(async () => { await env.close(); });

describe('collaboration socket', () => {
  it('refuses anonymous users, non-members, foreign origins and bad ids', async () => {
    expect(await handshake(null)).toBe(401);
    expect(await handshake(stranger)).toBe(403);
    expect(await handshake(owner, 'https://evil.example')).toBe(403);
    expect(await handshake(owner, ORIGIN, 'nope')).toBe(404);
    expect(await handshake(owner)).toBe(101);
  });

  it('syncs edits between editors and persists them', async () => {
    const a = connect(owner), b = connect(editor);
    await until(() => a.p.synced && b.p.synced);
    a.doc.getMap('constructs').set('c1', 'Satisfaction');
    await until(() => b.doc.getMap('constructs').get('c1') === 'Satisfaction');
    b.doc.getMap('paths').set('p1', 'c1->c2');
    await until(() => a.doc.getMap('paths').get('p1') === 'c1->c2');
    a.p.destroy(); b.p.destroy();
    await new Promise((r) => setTimeout(r, 100));
    const n = (await env.db.query('SELECT count(*)::int AS n FROM project_updates WHERE project_id = $1', [projectId])).rows[0].n;
    expect(n).toBeGreaterThan(0);
  });

  it('ignores document changes from viewers but sends them the state', async () => {
    const v = connect(viewer), e = connect(editor);
    await until(() => v.p.synced && e.p.synced);
    expect(v.doc.getMap('constructs').get('c1')).toBe('Satisfaction');
    v.doc.getMap('constructs').set('hack', 'x');
    e.doc.getMap('constructs').set('c2', 'Loyalty');
    await until(() => v.doc.getMap('constructs').get('c2') === 'Loyalty');
    await new Promise((r) => setTimeout(r, 200));
    expect(e.doc.getMap('constructs').get('hack')).toBeUndefined();
    v.p.destroy(); e.p.destroy();
  });

  it('shares presence (awareness) including from viewers', async () => {
    const v = connect(viewer), e = connect(editor);
    await until(() => v.p.synced && e.p.synced);
    v.p.awareness.setLocalStateField('user', { name: 'Viewer' });
    await until(() => [...e.p.awareness.getStates().values()].some((s) => s.user?.name === 'Viewer'));
    v.p.destroy(); e.p.destroy();
  });

  it('closes a connection that sends an oversized presence state', async () => {
    const closed = new Promise<number>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${env.port}/ws/projects/${projectId}`, { headers: { origin: ORIGIN, cookie: cookieOf(editor) } });
      ws.on('close', (code) => resolve(code));
      ws.on('open', () => {
        const aw = new awarenessProtocol.Awareness(new Y.Doc());
        aw.setLocalState({ user: { name: 'x'.repeat(MAX_AWARENESS_BYTES) } });
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, 1);
        encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(aw, [aw.clientID]));
        ws.send(encoding.toUint8Array(enc));
      });
    });
    expect(await closed).toBe(1009);
  });

  it('refuses an editor’s change that would grow the document past its cap', async () => {
    const closed = new Promise<{ code: number; reason: string }>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${env.port}/ws/projects/${projectId}`, { headers: { origin: ORIGIN, cookie: cookieOf(editor) } });
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
      const ws = new WebSocket(`ws://127.0.0.1:${env.port}/ws/projects/${projectId}`, { headers: { origin: ORIGIN, cookie: cookieOf(viewer) } });
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
    env.collab = fresh.attachCollab(env.server, env.db, (env.app as unknown as { sessionMiddleware: Parameters<typeof fresh.attachCollab>[2] }).sessionMiddleware, ORIGIN);
    env.deps.onMembershipChange = (p, u) => { void env.collab.membershipChanged(p, u); };
    const c = connect(owner);
    await until(() => c.p.synced);
    expect(c.doc.getMap('constructs').get('c2')).toBe('Loyalty');
    expect((await env.db.query('SELECT count(*)::int AS n FROM project_updates WHERE project_id = $1', [projectId])).rows[0].n).toBe(0);
    c.p.destroy();
  });

  it('disconnects a member as soon as access is removed', async () => {
    const e = connect(editor);
    await until(() => e.p.synced);
    let closedWith = 0;
    e.p.ws!.addEventListener('close', (ev) => { closedWith = (ev as CloseEvent).code; });
    const editorId = (await env.db.query("SELECT id FROM users WHERE email = 'e@example.org'")).rows[0].id;
    expect((await owner.del(`/api/projects/${projectId}/members/${editorId}`)).status).toBe(200);
    await until(() => closedWith !== 0);
    expect(closedWith).toBe(4403);
    e.p.destroy();
  });
});
