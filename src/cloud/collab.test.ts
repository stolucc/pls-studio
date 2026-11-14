import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  type Construct,
  DEFAULT_SETTINGS,
  type ModelState,
  parseProject,
  serializeProject,
} from '../model/project';
import type { Card } from '../analyses/types';
import { LOCAL, readCards, readDoc, writeCards, writeDoc } from './collab';

const C = (id: string, name: string, x = 0) => ({
  id,
  name,
  type: 'factor' as const,
  mode: 'A' as const,
  indicators: [`${id}1`, `${id}2`],
  x,
  y: 0,
  side: 'left' as const,
});
const model: ModelState = {
  constructs: [C('a', 'Alpha'), C('b', 'Beta', 300)],
  paths: [{ id: 'p', from: 'a', to: 'b' }],
  moderations: [],
};

/** Two replicas exchanging updates, like two browsers through the server. */
function pair() {
  const d1 = new Y.Doc(),
    d2 = new Y.Doc();
  d1.on('update', (u: Uint8Array, o: unknown) => {
    if (o !== 'remote') Y.applyUpdate(d2, u, 'remote');
  });
  d2.on('update', (u: Uint8Array, o: unknown) => {
    if (o !== 'remote') Y.applyUpdate(d1, u, 'remote');
  });
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
    writeDoc(
      d,
      { ...model, constructs: [{ ...model.constructs[0], x: 50 }, model.constructs[1]] },
      DEFAULT_SETTINGS,
      'Shared',
      null,
    );
    expect(updates).toBe(1);
  });

  it('merges concurrent edits to different fields and constructs', () => {
    const [d1, d2] = pair();
    writeDoc(d1, model, DEFAULT_SETTINGS, 'Shared', null);
    // Offline concurrently: user 1 renames Alpha, user 2 moves Alpha and adds a construct.
    const off1 = new Y.Doc(),
      off2 = new Y.Doc();
    Y.applyUpdate(off1, Y.encodeStateAsUpdate(d1));
    Y.applyUpdate(off2, Y.encodeStateAsUpdate(d2));
    writeDoc(
      off1,
      { ...model, constructs: [{ ...model.constructs[0], name: 'Image' }, model.constructs[1]] },
      DEFAULT_SETTINGS,
      'Shared',
      null,
    );
    writeDoc(
      off2,
      {
        ...model,
        constructs: [{ ...model.constructs[0], x: 120 }, model.constructs[1], C('c', 'Gamma')],
      },
      DEFAULT_SETTINGS,
      'Shared',
      null,
    );
    Y.applyUpdate(off1, Y.encodeStateAsUpdate(off2));
    Y.applyUpdate(off2, Y.encodeStateAsUpdate(off1));
    const r1 = readDoc(off1),
      r2 = readDoc(off2);
    expect(r1.model).toEqual(r2.model);
    expect(r1.model.constructs[0]).toMatchObject({ name: 'Image', x: 120 });
    expect(r1.model.constructs.map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('drops dangling references from concurrent delete + connect instead of failing', () => {
    const base = new Y.Doc();
    writeDoc(base, model, DEFAULT_SETTINGS, 'Shared', null);
    const u1 = new Y.Doc(),
      u2 = new Y.Doc();
    Y.applyUpdate(u1, Y.encodeStateAsUpdate(base));
    Y.applyUpdate(u2, Y.encodeStateAsUpdate(base));
    writeDoc(
      u1,
      { constructs: [model.constructs[0]], paths: [], moderations: [] },
      DEFAULT_SETTINGS,
      'Shared',
      null,
    ); // delete Beta
    writeDoc(
      u2,
      {
        ...model,
        constructs: [...model.constructs, C('c', 'Gamma')],
        paths: [...model.paths, { id: 'q', from: 'c', to: 'b' }],
      },
      DEFAULT_SETTINGS,
      'Shared',
      null,
    );
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
    const undo = new Y.UndoManager(
      [d1.getMap('constructs'), d1.getMap('paths'), d1.getMap('moderations'), d1.getMap('meta')],
      { trackedOrigins: new Set([LOCAL]) },
    );
    writeDoc(
      d1,
      { ...model, constructs: [{ ...model.constructs[0], name: 'Mine' }, model.constructs[1]] },
      DEFAULT_SETTINGS,
      'Shared',
      null,
    );
    writeDoc(
      d2,
      {
        ...readDoc(d2).model,
        constructs: [readDoc(d2).model.constructs[0], { ...model.constructs[1], name: 'Theirs' }],
      },
      DEFAULT_SETTINGS,
      'Shared',
      null,
    );
    undo.undo();
    const r = readDoc(d1);
    expect(r.model.constructs.map((c) => c.name)).toEqual(['Alpha', 'Theirs']);
  });
});

describe('correlations in the shared document', () => {
  it('round-trip, and dangling ones from concurrent edits are dropped', () => {
    const withCor: ModelState = {
      ...model,
      correlations: [
        { id: 'k1', kind: 'construct', a: 'a', b: 'b' },
        { id: 'k2', kind: 'indicator', a: 'a1', b: 'b2' },
      ],
    };
    const [d1, d2] = pair();
    writeDoc(d1, withCor, DEFAULT_SETTINGS, 'Shared', null);
    expect(readDoc(d2).model.correlations).toEqual(withCor.correlations);
    // Peer 2 removes construct b while peer 1's correlations still point at it.
    writeDoc(
      d2,
      {
        ...withCor,
        constructs: [withCor.constructs[0]],
        paths: [],
        correlations: withCor.correlations,
      },
      DEFAULT_SETTINGS,
      'Shared',
      null,
    );
    expect(readDoc(d1).model.correlations ?? []).toEqual([]);
  });
});

describe('shared projects from before explicit correlations', () => {
  it('are migrated once (undrawn exogenous pairs drawn), then stay as written', () => {
    const C2 = (id: string, name: string) => ({
      id,
      name,
      type: 'factor' as const,
      mode: 'A' as const,
      indicators: [`${id}1`, `${id}2`],
      x: 0,
      y: 0,
      side: 'left' as const,
    });
    const m: ModelState = {
      constructs: [C2('a', 'A'), C2('b', 'B'), C2('y', 'Y')],
      paths: [
        { id: 'p', from: 'a', to: 'y' },
        { id: 'q', from: 'b', to: 'y' },
      ],
      moderations: [],
    };
    const d = new Y.Doc();
    writeDoc(d, m, DEFAULT_SETTINGS, 'Shared', null);
    // A document written before format 2: no format in its metadata.
    d.getMap('meta').delete('format');
    const migrated = readDoc(d).model;
    expect(migrated.correlations?.map((k) => [k.a, k.b, k.zero ?? false])).toEqual([
      ['a', 'b', false],
    ]);
    writeDoc(d, migrated, DEFAULT_SETTINGS, 'Shared', null);
    expect(d.getMap('meta').get('format')).toBe(2);
    expect(readDoc(d).model.correlations).toEqual(migrated.correlations);
    // Removed later by a user: stays removed (no second migration).
    writeDoc(d, { ...migrated, correlations: [] }, DEFAULT_SETTINGS, 'Shared', null);
    expect(readDoc(d).model.correlations ?? []).toEqual([]);
  });
});

// Every model and construct field, set. Typed Required<…>: a field added to the
// model later fails typechecking here until it is added, and then must survive
// both a project file and the shared document.
const full: Construct &
  Required<Omit<Construct, 'categorical' | 'components' | 'componentLoadings' | 'markerFree'>> = {
  id: 'f',
  name: 'Full',
  type: 'factor',
  mode: 'unit',
  indicators: ['f1', 'f2', 'f3'],
  x: 10,
  y: 20,
  side: 'top',
  predefinedWeights: { f1: 1, f2: 0.5, f3: 0 },
  shape: 'octagon',
  color: '#123456',
  covariate: true,
  reliability: 0.8,
  freeError: true,
  reliabilities: { f3: 0.9 },
  latent: true,
  fixedLoadings: { f2: 0.5 },
  dominant: 'f2',
  loadingLabels: { f3: 'lf' },
  scaling: 'variance',
};
const kitchenSink: Required<ModelState> = {
  constructs: [
    full,
    { ...C('a', 'Alpha'), categorical: 'helmert' },
    C('b', 'Beta'),
    {
      id: 'h',
      name: 'High',
      type: 'factor',
      mode: 'A',
      indicators: [],
      x: 0,
      y: 0,
      side: 'left',
      components: ['a', 'b'],
      componentLoadings: { b: 2 },
      markerFree: true,
    },
  ],
  paths: [
    { id: 'p', from: 'a', to: 'b', label: 'pa', line: 'dashed', curved: true },
    { id: 'p2', from: 'f', to: 'b', fixed: 0.3 },
  ],
  moderations: [{ id: 'mo', moderator: 'f', path: 'p' }],
  copulas: [{ id: 'gc', path: 'p' }],
  notes: [{ id: 'note-1', x: 1, y: 2, text: 'A comment' }],
  correlations: [
    { id: 'k1', kind: 'construct', a: 'a', b: 'f', zero: true },
    { id: 'k2', kind: 'indicator', a: 'a1', b: 'b2', label: 'e1' },
    { id: 'k3', kind: 'construct', a: 'h', b: 'f', fixed: 0.2 },
    { id: 'k4', kind: 'indicator', a: 'a2', b: 'b1', byGroup: ['cm', 0.5, null] },
  ],
  threeWay: [{ id: 't', moderation: 'mo', moderator: 'h' }],
  ordered: ['a1', 'b1'],
  count: { a2: 'zip', f1: 'nb' },
  defined: [{ id: 'd', name: 'ind', expr: 'pa*2' }],
  waldTests: [{ id: 'w', name: 'Equal', constraints: 'pa == lf' }],
  inequalities: 'pa > 0',
  positiveVariances: true,
  information: 'observed',
  wlsmvSe: 'lavaan',
  mimic: 'Mplus',
  baseline: 'independence',
  likelihood: 'wishart',
  sampleCovRescale: false,
  multigroup: {
    column: 'g',
    invariance: 'scalar',
    free: [
      { kind: 'loading', construct: 'a', indicator: 'a2' },
      { kind: 'intercept', indicator: 'b1' },
    ],
    meanStructure: false,
    ordinalScales: 'free',
  },
  multilevel: { column: 'school', between: 'same' },
  weights: 'w',
  cluster: 'k',
  auxiliary: ['x9', 'age'],
  constant: { x: 5, y: 6 },
  means: [
    { id: 'm1', target: 'f', fixed: 2 },
    { id: 'm2', target: 'b', label: 'mu', bias: 0.5 },
  ],
  esem: { blocks: [{ id: 'e', constructs: ['a', 'b'] }], rotation: 'target' },
  parameters: [
    { id: 'v1', kind: 'variance', target: 'a', fixed: 1 },
    { id: 'v2', kind: 'variance', target: 'b1', indicator: true, label: 've' },
    { id: 'i1', kind: 'intercept', target: 'a1', indicator: true, byGroup: ['i', 'i'] },
    { id: 't1', kind: 'threshold', target: 'b1', indicator: true, threshold: 2, label: 'tt' },
  ],
  parameterization: 'theta',
  indicatorPaths: [
    { id: 'ip', from: 'b', to: 'a1', label: 'dir' },
    { id: 'ip2', from: 'f', to: 'a2', fixed: 0.1 },
  ],
  modifications: [
    {
      id: 'h1',
      kind: 'free',
      lhs: 'a1',
      op: '~~',
      rhs: 'a2',
      at: 1,
      mi: 12.5,
      sepc: 0.3,
      decision: 'M',
    },
    { id: 'h2', kind: 'remove', lhs: 'b', op: '~', rhs: 'a', at: 2, p: 0.4, group: 'g1' },
  ],
  measurement: {
    similarPairs: [['a', 'b']],
    deletedItems: [
      {
        indicator: 'f4',
        construct: 'Full',
        loading: 0.31,
        reason: 'Loading 0.31, below 0.40 (Hair et al. 2017, 2021).',
        note: 'Wording overlaps f1.',
        before: { ave: 0.45, rhoA: 0.72, rhoC: 0.69 },
        after: { ave: 0.55, rhoA: 0.75, rhoC: 0.78 },
      },
    ],
  },
};

describe('every model field survives', () => {
  it('a project file', () => {
    expect(parseProject(serializeProject(kitchenSink, DEFAULT_SETTINGS, null, null)).model).toEqual(
      kitchenSink,
    );
  });
  it('the shared document, between two peers, and removal of a field', () => {
    const [d1, d2] = pair();
    writeDoc(d1, kitchenSink, DEFAULT_SETTINGS, 'Shared', null);
    expect(readDoc(d2).model).toEqual(kitchenSink);
    const { multigroup: _g, weights: _w, ...fewer } = kitchenSink;
    writeDoc(d2, fewer, DEFAULT_SETTINGS, 'Shared', null);
    expect(readDoc(d1).model).toEqual(fewer);
  });
  it('drops a moderated moderation whose moderation a peer removed concurrently', () => {
    const base = new Y.Doc();
    writeDoc(base, kitchenSink, DEFAULT_SETTINGS, 'Shared', null);
    const u1 = new Y.Doc(),
      u2 = new Y.Doc();
    Y.applyUpdate(u1, Y.encodeStateAsUpdate(base));
    Y.applyUpdate(u2, Y.encodeStateAsUpdate(base));
    writeDoc(
      u1,
      { ...kitchenSink, moderations: [], threeWay: [] },
      DEFAULT_SETTINGS,
      'Shared',
      null,
    );
    writeDoc(
      u2,
      {
        ...kitchenSink,
        threeWay: [...kitchenSink.threeWay, { id: 't2', moderation: 'mo', moderator: 'a' }],
      },
      DEFAULT_SETTINGS,
      'Shared',
      null,
    );
    Y.applyUpdate(u1, Y.encodeStateAsUpdate(u2));
    const r = readDoc(u1);
    expect(r.model.moderations).toEqual([]);
    expect(r.model.threeWay ?? []).toEqual([]);
  });
  it('undo reverts a local change to a model-level field', () => {
    const d = new Y.Doc();
    writeDoc(d, model, DEFAULT_SETTINGS, 'Shared', null);
    const undo = new Y.UndoManager([d.getMap('model')], { trackedOrigins: new Set([LOCAL]) });
    writeDoc(d, { ...model, weights: 'w' }, DEFAULT_SETTINGS, 'Shared', null);
    expect(readDoc(d).model.weights).toBe('w');
    undo.undo();
    expect(readDoc(d).model.weights).toBeUndefined();
  });
});

describe('the analysis log in a shared project', () => {
  const nca = (id: string, at?: number): Card => ({
    id,
    kind: 'analysis',
    type: 'nca',
    options: { source: 'data', x: ['a1'], y: 'b1', permutations: 100 },
    ...(at ? { run: { at, fingerprint: 'f', options: '{}', packed: 'SECRETRESULT' } } : {}),
  });

  it('syncs cards and their order between peers, never the results', () => {
    const [d1, d2] = pair();
    writeCards(d1, [{ id: 'card-h', kind: 'heading', text: 'Checks' }, nca('card-n', 5)]);
    expect(readCards(d2).map((c) => c.id)).toEqual(['card-h', 'card-n']);
    expect((readCards(d2)[1] as Extract<Card, { kind: 'analysis' }>).run).toEqual({
      at: 5,
      fingerprint: 'f',
      options: '{}',
    });
    expect(JSON.stringify(d2.getMap('analyses').toJSON())).not.toContain('SECRETRESULT');
    writeCards(d2, [nca('card-n', 5), { id: 'card-h', kind: 'heading', text: 'Checks' }]);
    expect(readCards(d1).map((c) => c.id)).toEqual(['card-n', 'card-h']);
    writeCards(d1, [nca('card-n', 5)]);
    expect(readCards(d2).map((c) => c.id)).toEqual(['card-n']);
  });

  it('keeps cards two peers add at the same time', () => {
    const d1 = new Y.Doc(),
      d2 = new Y.Doc();
    writeCards(d1, [{ id: 'card-a', kind: 'note', text: 'one' }]);
    writeCards(d2, [{ id: 'card-b', kind: 'note', text: 'two' }]);
    Y.applyUpdate(d1, Y.encodeStateAsUpdate(d2));
    Y.applyUpdate(d2, Y.encodeStateAsUpdate(d1));
    expect(
      readCards(d1)
        .map((c) => c.id)
        .sort(),
    ).toEqual(['card-a', 'card-b']);
    expect(readCards(d1)).toEqual(readCards(d2));
  });

  it('validates what it reads', () => {
    const d = new Y.Doc();
    d.getMap('analyses').set('card-x', {
      id: 'card-x',
      kind: 'analysis',
      type: 'nope',
      options: {},
    });
    d.getMap('analyses').set('card-y', { id: 'card-y', kind: 'note', text: 7 });
    d.getMap('analyses').set('order', 'not a list');
    expect(readCards(d)).toEqual([{ id: 'card-y', kind: 'note', text: '' }]);
  });
});
