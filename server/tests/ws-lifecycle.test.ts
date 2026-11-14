// Room lifecycle: a member joining while the last room is being saved and
// dropped must end up in a live room (no lost edits, no split brain).
// Deterministic: the save (compaction, the only user of db.connect) is held
// at a gate the test opens.

import { WebSocket } from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';
import type { Db } from '../src/db.ts';
import { attachCollab } from '../src/ws.ts';
import { ORIGIN, signedUp, startEnv, type Agent, type TestEnv } from './helpers.ts';

let env: TestEnv;
let owner: Agent;
let projectId: string;

/** Compaction waits here while `held` is set; `entered` resolves once it does. */
let held: { entered: () => void; release: Promise<void> } | null = null;

const until = async (cond: () => boolean, ms = 5000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 20));
  }
};

const cookieOf = (a: Agent) =>
  a
    .cookie()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');

function connect(a: Agent) {
  const doc = new Y.Doc();
  const polyfill = class extends WebSocket {
    constructor(url: string) {
      super(url, { headers: { origin: ORIGIN, cookie: cookieOf(a) } });
    }
  };
  const p = new WebsocketProvider(`ws://127.0.0.1:${env.port}/ws/projects`, projectId, doc, {
    WebSocketPolyfill: polyfill as unknown as typeof globalThis.WebSocket,
    disableBc: true,
    maxBackoffTime: 50,
  });
  return { doc, p };
}

beforeAll(async () => {
  env = await startEnv();
  owner = await signedUp(env, 'life@example.org');
  projectId = (await owner.post('/api/projects', { name: 'Life' })).body.id;
  // Replace the collaboration layer by one with a short close delay and a gated save.
  await env.collab.close();
  const gated = {
    query: (...args: Parameters<Db['query']>) => env.db.query(...args),
    connect: async () => {
      if (held) {
        const h = held;
        h.entered();
        await h.release;
      }
      return env.db.connect();
    },
  } as unknown as Db;
  env.collab = attachCollab(
    env.server,
    gated,
    (env.app as unknown as { sessionMiddleware: Parameters<typeof attachCollab>[2] })
      .sessionMiddleware,
    ORIGIN,
    { closeAfterMs: 50 },
  );
});
afterAll(async () => {
  await env.close();
});

describe('room lifecycle', () => {
  it('a member joining while the empty room is being saved lands in a live room', async () => {
    const a = connect(owner);
    await until(() => a.p.synced);
    a.doc.getMap('m').set('x', 1);
    await new Promise((r) => setTimeout(r, 100)); // persisted

    let release!: () => void;
    const entered = new Promise<void>((resolve) => {
      held = {
        entered: resolve,
        release: new Promise<void>((r) => {
          release = r;
        }),
      };
    });
    a.p.destroy();
    await entered; // the close timer fired; the save is in progress
    held = null;

    const b = connect(owner);
    await new Promise((r) => setTimeout(r, 150)); // b's handshake reaches the server meanwhile
    release();
    await until(() => b.p.synced && b.doc.getMap('m').get('x') === 1);

    b.doc.getMap('m').set('y', 2);
    const c = connect(owner);
    await until(() => c.p.synced);
    await until(() => c.doc.getMap('m').get('y') === 2);
    c.doc.getMap('m').set('z', 3);
    await until(() => b.doc.getMap('m').get('z') === 3);

    // b's edit reached the database (it was made in a live room).
    await new Promise((r) => setTimeout(r, 100));
    const n = (
      await env.db.query('SELECT count(*)::int AS n FROM project_updates WHERE project_id = $1', [
        projectId,
      ])
    ).rows[0].n;
    expect(n).toBeGreaterThan(0);
    b.p.destroy();
    c.p.destroy();
  });

  it('a stale room finishing its save does not drop the newer room from the map', async () => {
    const a = connect(owner);
    await until(() => a.p.synced);
    let release!: () => void;
    const entered = new Promise<void>((resolve) => {
      held = {
        entered: resolve,
        release: new Promise<void>((r) => {
          release = r;
        }),
      };
    });
    a.p.destroy();
    await entered;
    held = null;
    const newer = connect(owner); // asks for a room while the old one saves
    await new Promise((r) => setTimeout(r, 100));
    const entry = env.collab.rooms.get(projectId);
    expect(entry).toBeDefined();
    release();
    await until(() => newer.p.synced);
    await new Promise((r) => setTimeout(r, 100)); // the old room's save has finished
    expect(env.collab.rooms.get(projectId)).toBe(entry);
    newer.p.destroy();
  });
});
