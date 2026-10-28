import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { DEFAULT_SETTINGS, type ModelState } from '../model/project';
import { LOCAL, readDoc, writeDoc } from './collab';

const C = (id: string, name: string, x = 0) => ({ id, name, type: 'factor' as const, mode: 'A' as const, indicators: [`${id}1`, `${id}2`], x, y: 0, side: 'left' as const });
const model: ModelState = {
  constructs: [C('a', 'Alpha'), C('b', 'Beta', 300)],
  paths: [{ id: 'p', from: 'a', to: 'b' }],
  moderations: [],
};

/** Two replicas exchanging updates, like two browsers through the server. */
function pair() {
  const d1 = new Y.Doc(), d2 = new Y.Doc();
  d1.on('update', (u: Uint8Array, o: unknown) => { if (o !== 'remote') Y.applyUpdate(d2, u, 'remote'); });
  d2.on('update', (u: Uint8Array, o: unknown) => { if (o !== 'remote') Y.applyUpdate(d1, u, 'remote'); });
  return [d1, d2] as const;
}

describe('shared document binding', () => {
  it('round-trips model, settings, name and order', () => {
    const d = new Y.Doc();
    writeDoc(d, model, { ...DEFAULT_SETTINGS, method: 'cbsem' }, 'Shared', null);
    const r = readDoc(d);
    expect(r.model).toEqual(model);
    expect(r.settings.method).toBe('cbsem');
    expect(r.name).toBe('Shared');
  });

  it('writes minimal diffs: unchanged state produces no update', () => {
    const d = new Y.Doc();
    writeDoc(d, model, DEFAULT_SETTINGS, 'Shared', null);
    let updates = 0;
    d.on('update', () => updates++);
    writeDoc(d, model, DEFAULT_SETTINGS, 'Shared', null);
    expect(updates).toBe(0);
    writeDoc(d, { ...model, constructs: [{ ...model.constructs[0], x: 50 }, model.constructs[1]] }, DEFAULT_SETTINGS, 'Shared', null);
    expect(updates).toBe(1);
  });

  it('merges concurrent edits to different fields and constructs', () => {
    const [d1, d2] = pair();
    writeDoc(d1, model, DEFAULT_SETTINGS, 'Shared', null);
    // Offline concurrently: user 1 renames Alpha, user 2 moves Alpha and adds a construct.
    const off1 = new Y.Doc(), off2 = new Y.Doc();
    Y.applyUpdate(off1, Y.encodeStateAsUpdate(d1));
    Y.applyUpdate(off2, Y.encodeStateAsUpdate(d2));
    writeDoc(off1, { ...model, constructs: [{ ...model.constructs[0], name: 'Image' }, model.constructs[1]] }, DEFAULT_SETTINGS, 'Shared', null);
    writeDoc(off2, { ...model, constructs: [{ ...model.constructs[0], x: 120 }, model.constructs[1], C('c', 'Gamma')] }, DEFAULT_SETTINGS, 'Shared', null);
    Y.applyUpdate(off1, Y.encodeStateAsUpdate(off2));
    Y.applyUpdate(off2, Y.encodeStateAsUpdate(off1));
    const r1 = readDoc(off1), r2 = readDoc(off2);
    expect(r1.model).toEqual(r2.model);
    expect(r1.model.constructs[0]).toMatchObject({ name: 'Image', x: 120 });
    expect(r1.model.constructs.map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('drops dangling references from concurrent delete + connect instead of failing', () => {
    const base = new Y.Doc();
    writeDoc(base, model, DEFAULT_SETTINGS, 'Shared', null);
    const u1 = new Y.Doc(), u2 = new Y.Doc();
    Y.applyUpdate(u1, Y.encodeStateAsUpdate(base));
    Y.applyUpdate(u2, Y.encodeStateAsUpdate(base));
    writeDoc(u1, { constructs: [model.constructs[0]], paths: [], moderations: [] }, DEFAULT_SETTINGS, 'Shared', null); // delete Beta
    writeDoc(u2, { ...model, constructs: [...model.constructs, C('c', 'Gamma')], paths: [...model.paths, { id: 'q', from: 'c', to: 'b' }] }, DEFAULT_SETTINGS, 'Shared', null);
    Y.applyUpdate(u1, Y.encodeStateAsUpdate(u2));
    const r = readDoc(u1);
    expect(r.model.constructs.map((c) => c.id)).toEqual(['a', 'c']);
    expect(r.model.paths).toEqual([]);
  });

  it('sanitises hostile shared state like an untrusted project file', () => {
    const d = new Y.Doc();
    writeDoc(d, model, DEFAULT_SETTINGS, 'Shared', null);
    d.transact(() => {
      const m = d.getMap<Y.Map<unknown>>('constructs').get('a')!;
      m.set('name', 'x'.repeat(10_000));
      m.set('mode', 'Z');
      d.getMap('meta').set('settings', { bootSamples: 1e12, scheme: '<img src=x>' });
    }, 'remote');
    const r = readDoc(d);
    expect(r.model.constructs[0].name.length).toBe(100);
    expect(r.model.constructs[0].mode).toBe('A');
    expect(r.settings.bootSamples).toBe(100000);
    expect(r.settings.scheme).toBe('path');
  });

  it('undo reverts only local changes', () => {
    const [d1, d2] = pair();
    writeDoc(d1, model, DEFAULT_SETTINGS, 'Shared', null);
    const undo = new Y.UndoManager([d1.getMap('constructs'), d1.getMap('paths'), d1.getMap('moderations'), d1.getMap('meta')], { trackedOrigins: new Set([LOCAL]) });
    writeDoc(d1, { ...model, constructs: [{ ...model.constructs[0], name: 'Mine' }, model.constructs[1]] }, DEFAULT_SETTINGS, 'Shared', null);
    writeDoc(d2, { ...readDoc(d2).model, constructs: [readDoc(d2).model.constructs[0], { ...model.constructs[1], name: 'Theirs' }] }, DEFAULT_SETTINGS, 'Shared', null);
    undo.undo();
    const r = readDoc(d1);
    expect(r.model.constructs.map((c) => c.name)).toEqual(['Alpha', 'Theirs']);
  });
});

describe('correlations in the shared document', () => {
  it('round-trip, and dangling ones from concurrent edits are dropped', () => {
    const withCor: ModelState = { ...model, correlations: [{ id: 'k1', kind: 'construct', a: 'a', b: 'b' }, { id: 'k2', kind: 'indicator', a: 'a1', b: 'b2' }] };
    const [d1, d2] = pair();
    writeDoc(d1, withCor, DEFAULT_SETTINGS, 'Shared', null);
    expect(readDoc(d2).model.correlations).toEqual(withCor.correlations);
    // Peer 2 removes construct b while peer 1's correlations still point at it.
    writeDoc(d2, { ...withCor, constructs: [withCor.constructs[0]], paths: [], correlations: withCor.correlations }, DEFAULT_SETTINGS, 'Shared', null);
    expect(readDoc(d1).model.correlations ?? []).toEqual([]);
  });
});
