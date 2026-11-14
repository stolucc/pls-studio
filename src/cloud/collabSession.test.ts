// The live session around the shared document, with the WebSocket provider replaced by a fake:
// sharing resolves only once the server has the seeded model, and a shared state that cannot be
// read stops the session from writing (it would overwrite collaborators' work).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';

/** A WebSocket that records what is sent; the test plays the server. */
class FakeSocket extends EventTarget {
  readyState = 1;
  sent: Uint8Array[] = [];
  send(data: Uint8Array) {
    this.sent.push(data);
  }
  /** The server's answer to a sync step 1 (a sync step 2 for that state vector). */
  answer(doc: Y.Doc) {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, 0);
    syncProtocol.writeSyncStep2(enc, doc);
    const bytes = encoding.toUint8Array(enc);
    const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    this.dispatchEvent(new MessageEvent('message', { data }));
  }
  close() {
    this.readyState = 3;
    this.dispatchEvent(new Event('close'));
  }
}

const providers = vi.hoisted(
  () => [] as { emit: (n: string, a: unknown[]) => void; ws: unknown }[],
);
vi.mock('y-websocket', async () => {
  const { Awareness } = await import('y-protocols/awareness');
  const { Observable } = await import('lib0/observable');
  class FakeProvider extends Observable<string> {
    awareness: InstanceType<typeof Awareness>;
    ws = new FakeSocket();
    constructor(_url: string, _room: string, doc: Y.Doc) {
      super();
      this.awareness = new Awareness(doc);
      providers.push(this as never);
    }
    destroy() {
      this.awareness.destroy();
    }
  }
  return { WebsocketProvider: FakeProvider };
});
vi.mock('./api', () => ({
  ApiError: class extends Error {},
  api: {
    get: vi.fn(async () => ({ id: 'p1', name: 'Shared', role: 'editor' })),
    post: vi.fn(async () => ({ id: 'p1' })),
    put: vi.fn(async () => ({ revision: 1 })),
    getText: vi.fn(async () => {
      throw Object.assign(new Error('none'), { status: 404 });
    }),
  },
}));

import { useStore } from '../store';
import {
  awaitServerEcho,
  closeSession,
  currentSession,
  openCloudProject,
  shareCurrentProject,
} from './collab';
import { api } from './api';

const user = { id: 'u1', display_name: 'A' };
const flush = () => new Promise((r) => setTimeout(r, 0));
const lastSocket = () => providers.at(-1)!.ws as FakeSocket;

beforeEach(() => {
  vi.stubGlobal('location', { protocol: 'http:', host: 'localhost' });
  providers.length = 0;
  useStore.getState().newProject();
  useStore.setState({ toasts: [], cloud: null });
});
afterEach(() => {
  closeSession();
  vi.unstubAllGlobals();
});

describe('awaitServerEcho', () => {
  it('sends a sync step 1 and resolves on the sync step 2 that answers it', async () => {
    const ws = new FakeSocket();
    const doc = new Y.Doc();
    let done = false;
    const p = awaitServerEcho(ws as unknown as WebSocket, doc).then(() => (done = true));
    expect(ws.sent).toHaveLength(1);
    const dec = decoding.createDecoder(ws.sent[0]);
    expect([decoding.readVarUint(dec), decoding.readVarUint(dec)]).toEqual([
      0,
      syncProtocol.messageYjsSyncStep1,
    ]);
    await flush();
    expect(done).toBe(false);
    ws.answer(doc);
    await p;
    expect(done).toBe(true);
  });

  it('rejects when the socket is not open, closes, or no answer comes', async () => {
    const doc = new Y.Doc();
    await expect(awaitServerEcho(null, doc)).rejects.toThrow(/no connection/);
    const closing = new FakeSocket();
    const p = awaitServerEcho(closing as unknown as WebSocket, doc);
    closing.close();
    await expect(p).rejects.toThrow(/closed/);
    const silent = new FakeSocket();
    await expect(awaitServerEcho(silent as unknown as WebSocket, doc, 5)).rejects.toThrow(
      /did not answer/,
    );
  });
});

describe('sharing the open project', () => {
  it('resolves only after the first sync, the push and the server’s answer', async () => {
    useStore.getState().addConstruct(0, 0, ['x1']);
    let resolved = false;
    const shared = shareCurrentProject(user).then((id) => {
      resolved = true;
      return id;
    });
    await flush();
    expect(api.post).toHaveBeenCalled();
    const session = currentSession()!;
    expect(resolved).toBe(false);
    providers.at(-1)!.emit('sync', [true]);
    // The model is in the document now, but the server has not answered yet.
    expect(session.doc.getMap('constructs').size).toBe(1);
    await flush();
    expect(resolved).toBe(false);
    lastSocket().answer(session.doc);
    expect(await shared).toBe('p1');
  });

  it('rejects when the connection closes before the server has the model', async () => {
    useStore.getState().addConstruct(0, 0, ['x1']);
    const shared = shareCurrentProject(user);
    await flush();
    providers.at(-1)!.emit('sync', [true]);
    lastSocket().close();
    await expect(shared).rejects.toThrow(/closed/);
  });
});

describe('a shared state that cannot be read', () => {
  it('stops writing to the document and says so, instead of overwriting it with a stale model', async () => {
    await openCloudProject('p1', user);
    const session = currentSession()!;
    providers.at(-1)!.emit('sync', [true]);
    const constructs = session.doc.getMap<Y.Map<unknown>>('constructs');
    session.doc.transact(() => {
      const m = new Y.Map<unknown>();
      constructs.set('c1', m);
      m.set('name', 'Theirs');
      m.set('indicators', 'not a list');
    }, 'remote');
    expect(useStore.getState().toasts.at(-1)).toMatchObject({ kind: 'error' });
    expect(useStore.getState().toasts.at(-1)!.text).toMatch(/no longer sent/);
    useStore.getState().addConstruct(0, 0, ['x9']);
    expect([...constructs.keys()]).toEqual(['c1']);
  });
});
