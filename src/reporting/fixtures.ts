// Representative models and results for the reporting tests (hand-made: only
// the fields the methods text and the checklist read, with plausible values).

import type { BootstrapResult, PlsResult } from '../engine/types';
import type { CbEstimate, CbResult } from '../engine/cbsem';
import type { CpaResult } from '../rengine/cpa';
import { DEFAULT_SETTINGS, type Construct, type ModelState, type Settings } from '../model/project';
import type { ReportInput } from './methods';

const k = (id: string, name: string, indicators: string[], extra: Partial<Construct> = {}): Construct => ({ id, name, type: 'factor', mode: 'A', indicators, x: 0, y: 0, side: 'left', ...extra });
const m0 = (constructs: Construct[], paths: [string, string][], extra: Partial<ModelState> = {}): ModelState => ({ constructs, paths: paths.map(([from, to], i) => ({ id: `p${i}`, from, to })), moderations: [], ...extra });
const sq = <T,>(n: number, f: (i: number, j: number) => T): T[][] => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => f(i, j)));

// ---------------------------------------------------------------- PLS-SEM: image → satisfaction → loyalty, satisfaction formative
export const plsModel = m0([
  k('i', 'Image', ['im1', 'im2', 'im3']),
  k('s', 'Satisfaction', ['sa1', 'sa2', 'sa3', 'sa4'], { type: 'composite', mode: 'B' }),
  k('l', 'Loyalty', ['lo1', 'lo2']),
], [['i', 's'], ['s', 'l'], ['i', 'l']]);

const plsIndicators = plsModel.constructs.flatMap((c, j) => c.indicators.map((name) => ({ name, construct: j })));
export const plsResult = (over: Partial<PlsResult> = {}): PlsResult & { engine: { package: string; version: string } } => ({
  n: 250, iterations: 5, converged: true, constructs: ['Image', 'Satisfaction', 'Loyalty'], indicators: plsIndicators,
  weights: plsIndicators.map(() => 0.4), loadings: [0.82, 0.79, 0.65, 0.7, 0.8, 0.75, 0.6, 0.9, 0.88],
  pathCoef: [[0, 0.5, 0.2], [0, 0, 0.6], [0, 0, 0]], hasPath: [[false, true, true], [false, false, true], [false, false, false]],
  totalEffects: sq(3, () => 0), indirectEffects: sq(3, () => 0), rSquared: [null, 0.25, 0.48], adjRSquared: [null, 0.247, 0.476],
  constructCor: sq(3, (i, j) => (i === j ? 1 : 0.5)),
  quality: [{ alpha: 0.72, rhoC: 0.81, rhoA: 0.74, ave: 0.58 }, { alpha: 0.7, rhoC: 0.8, rhoA: 0.75, ave: 0.5 }, { alpha: 0.75, rhoC: 0.88, rhoA: 0.77, ave: 0.79 }],
  htmt: [[null, null, null], [0.6, null, null], [0.92, 0.7, null]], htmt2: sq<number | null>(3, () => null),
  fit: { saturated: { srmr: 0.06, dULS: 0.2, dG: 0.1 }, estimated: { srmr: 0.07, dULS: 0.25, dG: 0.12 } },
  consistent: false, types: ['factor', 'composite', 'factor'], moderations: [],
  fSquare: [[null, 0.33, 0.05], [null, null, 0.4], [null, null, null]], vifInner: [[null, 1, 1.3], [null, null, 1.3], [null, null, null]],
  vifOuter: [1.5, 1.6, 1.4, 2.1, 3.4, 1.8, 1.2, 2, 2], scores: [], droppedRows: 0,
  engine: { package: 'cSEM', version: '0.7.1' },
  ...over,
});

export const plsBoot = (over: Partial<BootstrapResult & { seed: number }> = {}): BootstrapResult & { seed: number } => ({
  samples: 5000, failed: 0, confidence: 0.95, tails: 2, interval: 'percentile', seed: 1234,
  stats: [
    { key: 'Image->Satisfaction', group: 'path', label: 'Image → Satisfaction', original: 0.5, mean: 0.5, sd: 0.05, t: 10, p: 0, ciLow: 0.4, ciHigh: 0.6 },
    { key: 'Image->Loyalty', group: 'path', label: 'Image → Loyalty', original: 0.2, mean: 0.2, sd: 0.08, t: 2.5, p: 0.012, ciLow: 0.04, ciHigh: 0.35 },
  ],
  engine: { package: 'cSEM', version: '0.7.1' },
  ...over,
});

export const plsInput = (over: Partial<ReportInput> = {}): ReportInput => ({
  model: plsModel, settings: { ...DEFAULT_SETTINGS, bootSamples: 5000 }, info: { fileName: 'survey.csv', rows: 250, missingCells: 12, excluded: [] },
  pls: plsResult(), boot: plsBoot(), log: [], runtime: { R: '4.5.1', webR: '0.5.4' }, ...over,
});

// ---------------------------------------------------------------- CB-SEM: two-factor model with a path, MLR, FIML, bootstrap
export const cbModel = m0([k('a', 'Anxiety', ['x1', 'x2', 'x3']), k('d', 'Depression', ['y1', 'y2', 'y3'])], [['a', 'd']]);
const est = (lhs: string, op: CbEstimate['op'], rhs: string, e: number, std: number, kind: CbEstimate['kind'] = op === '=~' ? 'loading' : op === '~' ? 'regression' : 'residual'): CbEstimate => ({ kind, lhs, op, rhs, est: e, se: 0.05, z: e / 0.05, p: 0.001, std });
export const cbResult = (over: Partial<CbResult> = {}): CbResult & { engine: { package: string; version: string; desktop?: string } } => ({
  estimator: 'MLR', seType: 'robust.huber.white', n: 412, iterations: 31, converged: true, constructs: ['Anxiety', 'Depression'],
  indicators: ['x1', 'x2', 'x3', 'y1', 'y2', 'y3'].map((name, i) => ({ name, construct: i < 3 ? 0 : 1 })),
  estimates: [est('Anxiety', '=~', 'x1', 1, 0.78), est('Anxiety', '=~', 'x2', 0.9, 0.74), est('Anxiety', '=~', 'x3', 0.5, 0.42), est('Depression', '=~', 'y1', 1, 0.81), est('Depression', '=~', 'y2', 1.1, 0.85), est('Depression', '=~', 'y3', 0.95, 0.77),
    est('Depression', '~', 'Anxiety', 0.6, 0.55), est('x1', '~~', 'x1', 0.4, 0.39), est('y3', '~~', 'y3', 0.3, 0.41)],
  fit: { chisq: 18.2, df: 8, pvalue: 0.02, baselineChisq: 900, baselineDf: 15, cfi: 0.987, tli: 0.976, rmsea: 0.056, rmseaLow: 0.021, rmseaHigh: 0.09, rmseaP: 0.35, srmr: 0.031, aic: 8000, bic: 8080, logl: -3980, npar: 19,
    chisqScaled: 16.9, dfScaled: 8, pvalueScaled: 0.031, scalingFactor: 1.08, cfiRobust: 0.988, tliRobust: 0.978, rmseaRobust: 0.052 },
  r2Indicators: [0.6, 0.55, 0.18, 0.66, 0.72, 0.59], r2Constructs: [null, 0.3], stdLoadings: [0.78, 0.74, 0.42, 0.81, 0.85, 0.77],
  stdPaths: [[0, 0.55], [0, 0]], hasPath: [[false, true], [false, false]], stdTotal: [[0, 0.55], [0, 0]], stdIndirect: [[0, 0], [0, 0]], lvCor: [[1, 0.55], [0.55, 1]],
  reliability: [{ cr: 0.66, ave: 0.44 }, { cr: 0.85, ave: 0.66 }], residualCor: sq(6, () => 0), htmt: [[null, null], [0.62, null]], htmt2: [[null, null], [null, null]], vcov: null,
  moderations: [], warnings: [], droppedRows: 0,
  engine: { package: 'lavaan', version: '0.6-19', desktop: 'R version 4.4.2 (2024-10-31)' },
  ...over,
});
export const cbBoot = (): BootstrapResult & { seed: number } => ({ samples: 2000, failed: 3, confidence: 0.95, tails: 2, interval: 'bca', seed: 99, stats: [], engine: { package: 'lavaan', version: '0.6-19' } });
export const cbSettings: Settings = { ...DEFAULT_SETTINGS, method: 'cbsem', estimator: 'MLR', missing: 'fiml', bootSamples: 2000, bootInterval: 'bca', seed: 99 };
export const cbInput = (over: Partial<ReportInput> = {}): ReportInput => ({
  model: cbModel, settings: cbSettings, info: { fileName: 'clinic.csv', rows: 412, missingCells: 57, excluded: [] }, cb: cbResult(), boot: cbBoot(), log: [], ...over,
});

// ---------------------------------------------------------------- CPA: PROCESS model 4 (simple mediation), HC3
export const cpaModel = m0([
  k('x', 'Training', ['train'], { type: 'composite' }), k('m', 'Efficacy', ['ef1', 'ef2', 'ef3'], { type: 'composite' }), k('y', 'Performance', ['perf'], { type: 'composite' }),
], [['x', 'm'], ['m', 'y'], ['x', 'y']]);
const eff = { est: 0.2, se: 0.05, lo: 0.1, hi: 0.3 };
export const cpaResult = (over: Partial<CpaResult> = {}): CpaResult => ({
  n: 180,
  equations: [
    { outcome: 'Efficacy', n: 180, r2: 0.2, mse: 1, f: 44, df1: 1, df2: 178, p: 0, coefficients: [{ term: [], ...eff, t: 4, p: 0 }, { term: ['Training'], ...eff, t: 4, p: 0 }], interactions: [] },
    { outcome: 'Performance', n: 180, r2: 0.3, mse: 1, f: 38, df1: 2, df2: 177, p: 0, coefficients: [{ term: [], ...eff, t: 4, p: 0 }, { term: ['Training'], ...eff, t: 2, p: 0.04 }, { term: ['Efficacy'], ...eff, t: 5, p: 0 }], interactions: [] },
  ],
  moderators: [], direct: { moderators: [], rows: [{ at: {}, ...eff, t: 2, p: 0.04 }] }, directs: [], indirect: [{ path: ['Training', 'Efficacy', 'Performance'], moderators: [], rows: [{ at: {}, ...eff }] }],
  total: eff, indices: [], jn: [], boot: { samples: 10000 }, inference: 'bootstrap', hc: 'HC3', latent: [], warnings: [],
  engine: { package: 'manymome', version: '0.2.4' },
  ...over,
});
export const cpaInput = (over: Partial<ReportInput> = {}): ReportInput => ({
  model: cpaModel, settings: { ...DEFAULT_SETTINGS, method: 'process', hc: 'HC3', bootSamples: 10000, seed: 2024 }, info: { fileName: 'training.csv', rows: 180, missingCells: 0, excluded: [] },
  process: cpaResult(), log: [], runtime: { R: '4.5.1', webR: '0.5.4' }, ...over,
});
