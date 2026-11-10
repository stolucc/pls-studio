import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, validateModel, type Construct, type ModelState, type Settings } from './project';
import { exampleModel, PACKAGE_EXAMPLES } from '../examples/packages';
import type { Dataset } from '../engine/types';

// Pins the full issue list (level, message, construct, action, in order) of validateModel over rich models and many
// settings: the rule groups of validate.ts must compose to exactly the list the single function gave.

type Opts = Parameters<typeof validateModel>[2];
// (construct ids as their position: the examples' ids are generated afresh each run)
const idOf = (model: ModelState, id: string) => { const k = model.constructs.findIndex((c) => c.id === id); return k < 0 ? id : `#${k}`; };
const show = (model: ModelState, data: Dataset | null, s: Opts) => validateModel(model, data, s).map((i) => `${i.level}: ${i.message}${i.constructId ? ` [${idOf(model, i.constructId)}]` : ''}${i.action ? ` {${i.action}}` : ''}`);

// Settings variants that reach each method's branches.
const VARIANTS: [string, Partial<Settings>][] = [
  ['pls', { method: 'pls' }],
  ['plsc seminr', { method: 'pls', consistent: true, plsPackage: 'seminr', scheme: 'centroid', plsApproach: 'GSCA', missing: 'fiml' }],
  ['pls builtin mi', { method: 'pls', engine: 'builtin', missing: 'mi', miMethod: 'amelia', plsApproach: 'unit' }],
  ['cbsem', { method: 'cbsem' }],
  ['cbsem builtin wlsmv fiml', { method: 'cbsem', engine: 'builtin', estimator: 'WLSMV', missing: 'fiml' }],
  ['cbsem 2sls', { method: 'cbsem', estimator: '2SLS' }],
  ['cbsem mi lms', { method: 'cbsem', missing: 'mi', estimator: 'GLS', interaction: 'lms', miMethod: 'amelia', miAuxiliary: ['nope'], miNominal: ['zz'] }],
  ['cbsem rml pairwise', { method: 'cbsem', estimator: 'RML', missing: 'pairwise' }],
  ['cbsem wls twostage', { method: 'cbsem', estimator: 'WLS', missing: 'twostage', interaction: 'qml' }],
  ['process', { method: 'process', missing: 'mi', hc: 'HC3' }],
];

const C = (id: string, name: string, indicators: string[], extra: Partial<Construct> = {}): Construct => ({ id, name, type: 'factor', mode: 'A', indicators, x: 0, y: 0, side: 'left', ...extra });
const cols = (names: string[], n: number, f: (k: number, i: number) => number): Dataset => ({ names, cols: names.map((_, k) => Float64Array.from({ length: n }, (_, i) => f(k, i))) });

// Every feature at once, many of them wrongly combined.
const kitchen: ModelState = {
  constructs: [
    C('A', 'Alpha', ['a1', 'a2', 'a3'], { reliabilities: { a1: 0.8, a2: 1.5 }, fixedLoadings: { a2: 1 }, predefinedWeights: { a1: 0, a2: 0, a3: 0 }, dominant: 'a1' }),
    C('B', 'Beta', ['b1', 'b2'], { type: 'composite', mode: 'B', loadingLabels: { b1: 'l1' } }),
    C('G', 'Gamma', [], { components: ['A', 'D'], markerFree: true, componentLoadings: { A: NaN, D: 1 } }),
    C('D', 'Delta', ['d1'], { reliability: 1.2, freeError: true, mode: 'unit', categorical: 'indicator' }),
    C('E', 'Epsilon', ['e1'], { covariate: true, latent: true }),
    C('F', 'phi', ['a1', 'f2'], { mode: 'unit', latent: true }),
    C('H', 'Phi', ['txt', 'zz'], { mode: 'B' }),
    C('K', '', ['k1', 'k2', 'k3'], { categorical: 'indicator' }),
  ],
  paths: [
    { id: 'p1', from: 'A', to: 'B', fixed: 1 },
    { id: 'p2', from: 'B', to: 'F', label: 'b' },
    { id: 'p3', from: 'F', to: 'A' },
    { id: 'p4', from: 'E', to: 'H' },
    { id: 'p5', from: 'D', to: 'E' },
    { id: 'p6', from: 'K', to: 'H' },
  ],
  moderations: [{ id: 'm1', moderator: 'H', path: 'p1', method: 'orthogonal' }, { id: 'm2', moderator: 'A', path: 'p1' }, { id: 'm3', moderator: 'K', path: 'gone' }],
  threeWay: [{ id: 't1', moderation: 'm1', moderator: 'K' }],
  copulas: [{ id: 'c1', path: 'p4' }],
  correlations: [
    { id: 'r1', kind: 'construct', a: 'A', b: 'B', byGroup: [1, 2, 3] },
    { id: 'r2', kind: 'construct', a: 'E', b: 'K', zero: true },
    { id: 'r3', kind: 'construct', a: 'K', b: 'D' },
    { id: 'r4', kind: 'indicator', a: 'b1', b: 'd1', fixed: 0.2 },
    { id: 'r5', kind: 'construct', a: 'F', b: 'B' },
  ],
  ordered: ['k1', 'k2'],
  defined: [{ id: 'd1', name: 'ab', expr: 'b * zz' }],
  waldTests: [{ id: 'w1', name: 'w', constraints: 'b == q' }],
  information: 'observed',
  likelihood: 'wishart',
  sampleCovRescale: false,
  multigroup: { column: 'grp', invariance: 'scalar', meanStructure: false, free: [{ kind: 'loading', construct: 'Q', indicator: 'x' }, { kind: 'regression', from: 'A', to: 'K' }, { kind: 'mean', construct: 'B' }], structural: ['means'] },
  multilevel: { column: 'grp', between: 'model', betweenModel: [{ lhs: 'fb', op: '=~', rhs: [{ name: 'a1' }, { name: 'nothere' }] }] },
  weights: 'wt',
  cluster: 'a1',
  esem: { blocks: [{ id: 'e1', constructs: ['A', 'B'] }, { id: 'e2', constructs: ['A', 'E', 'G'] }], rotation: 'bigeomin', invariant: true },
  constant: { x: 0, y: 0 },
  means: [{ id: 'mn1', target: 'G', bias: [1, NaN] }, { id: 'mn2', target: 'gone', bias: [1, 2] }, { id: 'mn3', target: 'A', bias: 0.5 }],
  parameters: [{ id: 'v1', kind: 'variance', target: 'A', byGroup: [1] }],
  indicatorPaths: [{ id: 'i1', from: 'A', to: 'a1' }, { id: 'i2', from: 'E', to: 'b1' }, { id: 'i3', from: 'K', to: 'd1' }, { id: 'i4', from: 'K', to: 'gone' }, { id: 'i5', from: 'K', to: 'a2' }],
} as ModelState;

const kNames = ['a1', 'a2', 'a3', 'b1', 'b2', 'd1', 'e1', 'f2', 'txt', 'k1', 'k2', 'k3', 'grp', 'wt', 'cl'];
const kData: Dataset = { ...cols(kNames, 25, (k, i) => (kNames[k] === 'a3' ? 4 : kNames[k] === 'b2' ? NaN : kNames[k] === 'wt' ? i - 3 : kNames[k] === 'grp' ? i % 25 : kNames[k] === 'd1' ? i % 30 : (i * (k + 1)) % 4)), categories: { txt: ['x', 'y', 'z', 'w'] } };
// (no weights column among a matrix's names: validateModel would index its missing raw column)
const kMatrix: Dataset = { names: kNames.filter((x) => x !== 'wt'), cols: [], moments: { n: 40, cov: kNames.slice(1).map((_, i) => kNames.slice(1).map((_, j) => (i === j ? 1 : 0.1))) } } as unknown as Dataset;

// A process model: X, M, Y, W with latent scales, a categorical X and a dichotomous Y.
const proc: ModelState = {
  constructs: [C('X', 'X', ['x1'], { categorical: 'indicator' }), C('M', 'M', ['m1', 'm2'], { latent: true }), C('Y', 'Y', ['y1']), C('W', 'W', ['w1']), C('Z', 'Z', ['z1'], { categorical: 'helmert' })],
  paths: [{ id: 'p1', from: 'X', to: 'M' }, { id: 'p2', from: 'M', to: 'Y' }, { id: 'p3', from: 'X', to: 'Y' }],
  moderations: [{ id: 'm1', moderator: 'W', path: 'p2' }, { id: 'm2', moderator: 'X', path: 'p2' }],
  threeWay: [{ id: 't1', moderation: 'm1', moderator: 'Z' }],
};
const pNames = ['x1', 'm1', 'm2', 'y1', 'w1', 'z1'];
const pData = cols(pNames, 200, (k, i) => (pNames[k] === 'y1' ? i % 2 : pNames[k] === 'x1' ? i % 3 : Math.sin(i * (k + 1.3)) + (i % (k + 3))));

// Package examples (the shipped diagrams), with data shaped as their own test builds it.
const diagrams = PACKAGE_EXAMPLES.filter((e) => !e.panel);
const exampleCase = (ex: (typeof diagrams)[number]) => {
  const model = exampleModel(ex);
  const names = [...new Set([...model.constructs.flatMap((c) => c.indicators), ...(ex.multigroup ? [ex.multigroup.column] : []), ...(ex.multilevel ? [ex.multilevel.column, ...(ex.multilevel.betweenCovariates ?? [])] : [])])];
  const data = cols(names, 120, (k, i) => (names[k] === ex.multigroup?.column ? 1 + (i % 2) : names[k] === ex.multilevel?.column ? 1 + (i % 12) : Math.sin(i * (k + 1.3)) + (i % (k + 3))));
  return { model, data, own: ex.settings };
};

describe('validateModel: the full issue list is pinned', () => {
  it.each(VARIANTS)('kitchen-sink model, raw data, %s', (_n, s) => expect(show(kitchen, kData, { ...DEFAULT_SETTINGS, ...s })).toMatchSnapshot());
  it.each(VARIANTS)('kitchen-sink model, covariance matrix, %s', (_n, s) => expect(show(kitchen, kMatrix, { ...DEFAULT_SETTINGS, ...s })).toMatchSnapshot());
  it.each(VARIANTS)('kitchen-sink model, no data, %s', (_n, s) => expect(show(kitchen, null, { ...DEFAULT_SETTINGS, ...s })).toMatchSnapshot());
  it.each(VARIANTS)('process model, %s', (_n, s) => expect(show(proc, pData, { ...DEFAULT_SETTINGS, ...s })).toMatchSnapshot());
  it('package examples under their own settings and every variant', () => {
    const out: Record<string, string[]> = {};
    for (const ex of diagrams) {
      const { model, data, own } = exampleCase(ex);
      out[`${ex.id} (own)`] = show(model, data, { ...DEFAULT_SETTINGS, ...own });
      for (const [n, s] of VARIANTS) out[`${ex.id} (${n})`] = show(model, data, { ...DEFAULT_SETTINGS, ...own, ...s });
    }
    expect(out).toMatchSnapshot();
  });
});

// A covariance matrix has no raw columns: a weights column among its names is reported, not read.
it('reports sampling weights on a covariance matrix instead of reading its missing column', () => {
  const matrix = { ...kMatrix, names: kNames } as Dataset;
  const issues = validateModel(kitchen, matrix, { ...DEFAULT_SETTINGS, method: 'cbsem', engine: 'r' } as Settings).map((i) => i.message);
  expect(issues).toContain('Sampling weights need raw data; this dataset is a covariance matrix.');
});

// Product-indicator and orthogonalising terms: seminr's, and the built-in engine's (not cSEM's; not with PLSc).
describe('interaction-term methods in PLS-SEM', () => {
  const m = { constructs: [C('A', 'A', ['a1', 'a2']), C('M', 'M', ['m1', 'm2']), C('B', 'B', ['b1', 'b2'])], paths: [{ id: 'p', from: 'A', to: 'B' }, { id: 'q', from: 'M', to: 'B' }], moderations: [{ id: 'mo', moderator: 'M', path: 'p', method: 'orthogonal' }] } as unknown as ModelState;
  const d = cols(['a1', 'a2', 'm1', 'm2', 'b1', 'b2'], 40, (k, i) => Math.sin(i * (k + 1.3)) + (i % (k + 3)));
  const errs = (s: Partial<Settings>) => validateModel(m, d, { ...DEFAULT_SETTINGS, method: 'pls', ...s } as Settings).filter((i) => i.level === 'error').map((i) => i.message);
  it('allows them with seminr and the built-in engine, refuses them with cSEM and PLSc', () => {
    expect(errs({ engine: 'builtin' })).toEqual([]);
    expect(errs({ engine: 'r', plsPackage: 'seminr' })).toEqual([]);
    expect(errs({ engine: 'r', plsPackage: 'cSEM' }).join()).toMatch(/seminr’s \(interaction_term\) and the built-in engine’s/);
    expect(errs({ engine: 'builtin', consistent: true }).join()).toMatch(/not available with PLSc/);
  });
});

// Weighted PLS (WPLS): sampling weights apply to PLS-SEM, through the built-in engine.
describe('sampling weights in PLS-SEM', () => {
  const m: ModelState = { constructs: [C('A', 'A', ['a1', 'a2']), C('B', 'B', ['b1', 'b2'])], paths: [{ id: 'p', from: 'A', to: 'B' }], moderations: [], weights: 'wt' } as unknown as ModelState;
  const d = cols(['a1', 'a2', 'b1', 'b2', 'wt'], 30, (k, i) => (k === 4 ? 1 + (i % 3) : Math.sin(i * (k + 1.3)) + (i % (k + 3))));
  const msgs = (s: Partial<Settings>, data = d, model = m) => validateModel(model, data, { ...DEFAULT_SETTINGS, method: 'pls', ...s } as Settings).map((i) => `${i.level}: ${i.message}`);
  it('no longer says PLS ignores them; with R packages, notes the built-in engine', () => {
    expect(msgs({ engine: 'builtin' }).filter((x) => /weights/i.test(x))).toEqual([]);
    expect(msgs({ engine: 'r' })).toContain('warning: Weighted PLS (sampling weights wt) is estimated by the built-in engine: neither cSEM nor seminr takes sampling weights.');
  });
  it('checks the column and refuses unsupported combinations', () => {
    const bad = { ...d, cols: d.cols.map((c, k) => (k === 4 ? Float64Array.from(c, (v, i) => (i === 2 ? -1 : v)) : c)) };
    expect(msgs({ engine: 'builtin' }, bad)).toContain('error: The sampling weights (wt) must be non-negative numbers without missing values.');
    const zero = { ...d, cols: d.cols.map((c, k) => (k === 4 ? new Float64Array(c.length) : c)) };
    expect(msgs({ engine: 'builtin' }, zero)).toContain('error: The sampling weights (wt) are all zero.');
    expect(msgs({ engine: 'builtin', plsApproach: 'GSCA' })).toContain('error: Weighted PLS needs PLS path modeling as the weighting approach.');
    expect(msgs({ engine: 'builtin', missing: 'mi' })).toContain('error: Weighted PLS uses mean replacement or casewise deletion, not multiple imputation.');
    expect(msgs({ engine: 'builtin' }, d, { ...m, copulas: [{ id: 'c', path: 'p' }] } as ModelState)).toContain('error: Gaussian copulas cannot be combined with sampling weights.');
  });
});

// Ordinal indicators in PLS: OrdPLS/OrdPLSc through cSEM, refused where it is not available.
describe('ordinal PLS (OrdPLS/OrdPLSc)', () => {
  const m: ModelState = { constructs: [C('X', 'X', ['x1', 'x2']), C('Y', 'Y', ['y1', 'y2'])], paths: [{ id: 'p', from: 'X', to: 'Y' }], moderations: [], ordered: ['x1', 'x2'] };
  const full = cols(['x1', 'x2', 'y1', 'y2'], 40, (k, i) => 1 + ((i * 7 + k * 3 + (i >> 2) * (k + 1)) % 5));
  const gap = { ...full, cols: full.cols.map((c, k) => (k === 0 ? Float64Array.from(c, (v, i) => (i === 3 ? NaN : v)) : c)) };
  const errs = (s: Partial<Settings>, model = m, data: Dataset = full) => validateModel(model, data, { ...DEFAULT_SETTINGS, method: 'pls', ...s }).filter((i) => i.level === 'error').map((i) => i.message);
  it('is valid with cSEM, casewise deletion or mean replacement without gaps, PLS or PLSc', () => {
    expect(errs({ engine: 'r', plsPackage: 'cSEM', missing: 'casewise' })).toEqual([]);
    expect(errs({ engine: 'r', plsPackage: 'cSEM', missing: 'mean', consistent: true })).toEqual([]);
    expect(validateModel(m, full, { ...DEFAULT_SETTINGS, method: 'pls' }).map((i) => i.message).join(' ')).not.toMatch(/as continuous\./);
  });
  it('refuses the built-in engine and seminr, mean replacement with gaps, MI, other approaches, interactions', () => {
    expect(errs({ engine: 'builtin' })[0]).toMatch(/x1, x2 are ordinal: ordinal PLS .* is estimated by cSEM/);
    expect(errs({ engine: 'r', plsPackage: 'seminr' })[0]).toMatch(/estimated by cSEM/);
    expect(errs({ engine: 'r', missing: 'mean' }, m, gap)).toEqual(['Mean replacement would put non-category values into ordinal indicators that have missing values; choose casewise deletion.']);
    expect(errs({ engine: 'r', missing: 'mi' })).toContain('Ordinal PLS (OrdPLS/OrdPLSc) is available with casewise deletion; multiple imputation is for continuous indicators.');
    expect(errs({ engine: 'r', missing: 'casewise', plsApproach: 'GSCA' }).join(' ')).toMatch(/choose PLS-PM/);
    const mod: ModelState = { ...m, constructs: [...m.constructs, C('M', 'M', ['m1'])], moderations: [{ id: 'mo', moderator: 'M', path: 'p' }] };
    expect(errs({ engine: 'r', missing: 'casewise' }, mod, cols(['x1', 'x2', 'y1', 'y2', 'm1'], 40, (k, i) => 1 + ((i * 7 + k * 3 + (i >> 2) * (k + 1)) % 5))).join(' ')).toMatch(/interaction terms .* not available with ordinal PLS/);
  });
  it('ignores a categorical variable’s column (it travels as dummies)', () => {
    const cat: ModelState = { ...m, constructs: [C('X', 'X', ['x1'], { categorical: 'indicator' }), C('Y', 'Y', ['y1', 'y2'])], ordered: ['x1'] };
    expect(errs({ engine: 'builtin' }, cat).join(' ')).not.toMatch(/ordinal/);
  });
});
