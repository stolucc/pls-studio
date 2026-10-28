// Nonparametric bootstrap: resample cases with replacement, re-estimate, and
// summarise each parameter's sampling distribution (standard error, t,
// two-tailed p with df = samples − 1, percentile CI).
//
// Work is organised in *ranges* of sample indices so it can be spread over
// several Web Workers. Every sample draws its cases from its own RNG seeded by
// (seed, sample index), so results are identical however the samples are
// split between workers.

import { fitEstimator, prepareCb, sampleCov, standardized, type CbEstimator } from './cbsem';
import { matMul, symEigen, symMatFn } from './linalg';
import { compileModel, extractColumns, impliedConstructCor, impliedIndicatorCor, modelFit, plsCore, preparePls, standardizeColumns, structural, type CompiledModel } from './pls';
import { corStd, mulberry32, quantileSorted, tTestP } from './stats';
import type { BootstrapOptions, BootstrapResult, BootstrapStat, Dataset, ModelFit, ModelSpec, PlsOptions } from './types';
import { DEFAULT_OPTIONS } from './types';

export interface ParamMeta {
  key: string;
  group: BootstrapStat['group'];
  label: string;
}

export interface BootstrapHooks {
  onProgress?: (done: number, total: number) => void;
  shouldCancel?: () => boolean;
}

export type BootJobKind = 'pls' | 'cb' | 'fittest';

export interface RangeRequest {
  job: BootJobKind;
  data: Dataset;
  spec: ModelSpec;
  options: Partial<PlsOptions>;
  estimator?: CbEstimator;
  seed: number;
  /** Sample indices [start, end). */
  start: number;
  end: number;
}

export interface RangePart {
  start: number;
  params: ParamMeta[];
  originals: number[];
  /** One array per parameter, length end − start; NaN marks a failed sample. */
  draws: Float64Array[];
  observed?: ModelFit;
}

/** Deterministic per-sample seed (integer hash of seed and sample index). */
export function sampleSeed(seed: number, b: number): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (b + 0x7f4a7c15), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export function sampleIndices(seed: number, b: number, n: number): Uint32Array {
  const rand = mulberry32(sampleSeed(seed, b));
  const idx = new Uint32Array(n);
  for (let r = 0; r < n; r++) idx[r] = Math.floor(rand() * n);
  return idx;
}

interface Job {
  n: number;
  params: ParamMeta[];
  originals: number[];
  /** Estimates for one resample; throws if it cannot be estimated. */
  sample: (idx: Uint32Array) => number[];
  observed?: ModelFit;
}

const resample = (cols: Float64Array[], idx: Uint32Array) => cols.map((c) => Float64Array.from(idx, (r) => c[r]));

// ---------- PLS ----------

type Getter = (s: ReturnType<typeof structural>, w: Float64Array) => number;

function plsParameters(m: CompiledModel, orig: ReturnType<typeof structural>): (ParamMeta & { get: Getter })[] {
  const C = m.constructs;
  const J = C.length;
  const ps: (ParamMeta & { get: Getter })[] = [];
  for (let i = 0; i < J; i++) for (let j = 0; j < J; j++) {
    if (m.hasPath[i][j]) ps.push({ key: `path:${C[i]}:${C[j]}`, group: 'path', label: `${C[i]} → ${C[j]}`, get: (s) => s.pathCoef[i][j] });
  }
  for (let i = 0; i < J; i++) for (let j = 0; j < J; j++) {
    const indirect = orig.totalEffects[i][j] - orig.pathCoef[i][j];
    if (Math.abs(indirect) > 1e-12) {
      ps.push({ key: `total:${C[i]}:${C[j]}`, group: 'total', label: `${C[i]} → ${C[j]}`, get: (s) => s.totalEffects[i][j] });
      ps.push({ key: `indirect:${C[i]}:${C[j]}`, group: 'indirect', label: `${C[i]} → ${C[j]}`, get: (s) => s.totalEffects[i][j] - s.pathCoef[i][j] });
    }
  }
  m.indicatorNames.forEach((name, k) => {
    const c = C[m.indicatorConstruct[k]];
    ps.push({ key: `loading:${name}`, group: 'loading', label: `${c} → ${name}`, get: (s) => s.loadings[k] });
    ps.push({ key: `weight:${name}`, group: 'weight', label: `${name} → ${c}`, get: (_s, w) => w[k] });
  });
  C.forEach((c, j) => {
    if (m.preds[j].length > 0) ps.push({ key: `r2:${c}`, group: 'r2', label: c, get: (s) => s.rSquared[j] as number });
  });
  return ps;
}

function plsJob(data: Dataset, spec: ModelSpec, options: Partial<PlsOptions>): Job {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const prep = preparePls(data, spec, opts);
  const first = prep.estimate(prep.cols);
  const params = plsParameters(prep.m, first.st);
  return {
    n: prep.cols[0].length,
    params,
    originals: params.map((p) => p.get(first.st, first.core.w)),
    sample: (idx) => {
      // Both stages are re-run per sample when the model has moderators.
      const eb = prep.estimate(resample(prep.cols, idx), { w1: first.w1, w2: first.core.w });
      if (!eb.core.converged) throw new Error('not converged');
      return params.map((p) => p.get(eb.st, eb.core.w));
    },
  };
}

// ---------- CB-SEM ----------

function cbJob(data: Dataset, spec: ModelSpec, missing: PlsOptions['missing'], estimator: CbEstimator): Job {
  const { cm, cols } = prepareCb(data, spec, missing);
  if (!cols) throw new Error('Bootstrapping needs raw data; this dataset is a covariance matrix.');
  const core = fitEstimator(cm, sampleCov(cols, estimator), estimator);
  const m = cm.m;
  const C = m.constructs;
  const J = C.length;
  type Std = ReturnType<typeof standardized>;
  type CbGetter = (s: Std, r2: (number | null)[]) => number;
  const params: (ParamMeta & { get: CbGetter })[] = [];
  const orig = standardized(cm, core.X);
  for (let i = 0; i < J; i++) for (let j = 0; j < J; j++) {
    if (m.hasPath[i][j]) params.push({ key: `path:${C[i]}:${C[j]}`, group: 'path', label: `${C[i]} → ${C[j]}`, get: (s) => s.stdPaths[i][j] });
  }
  for (let i = 0; i < J; i++) for (let j = 0; j < J; j++) {
    if (Math.abs(orig.indirect[i][j]) > 1e-12) {
      params.push({ key: `total:${C[i]}:${C[j]}`, group: 'total', label: `${C[i]} → ${C[j]}`, get: (s) => s.total[i][j] });
      params.push({ key: `indirect:${C[i]}:${C[j]}`, group: 'indirect', label: `${C[i]} → ${C[j]}`, get: (s) => s.indirect[i][j] });
    }
  }
  m.indicatorNames.forEach((name, k) => {
    const c = C[m.indicatorConstruct[k]];
    params.push({ key: `loading:${name}`, group: 'loading', label: `${c} → ${name}`, get: (s) => s.stdLoadings[k] });
  });
  C.forEach((c, j) => {
    if (m.preds[j].length) params.push({ key: `r2:${c}`, group: 'r2', label: c, get: (_s, r2) => r2[j] as number });
  });
  const r2Of = (X: typeof core.X) => C.map((_, j) => (m.preds[j].length ? 1 - X.Psi[j][j] / X.C[j][j] : null));
  const r2orig = r2Of(core.X);
  return {
    n: cols[0].length,
    params,
    originals: params.map((p) => p.get(orig, r2orig)),
    sample: (idx) => {
      const fb = fitEstimator(cm, sampleCov(resample(cols, idx), estimator), estimator, core.theta, 200);
      if (!fb.converged) throw new Error('not converged');
      const sb = standardized(cm, fb.X);
      const r2 = r2Of(fb.X);
      return params.map((p) => p.get(sb, r2));
    },
  };
}

// ---------- test of exact overall model fit (Dijkstra & Henseler 2015) ----------

export interface FitTestResult {
  samples: number;
  failed: number;
  observed: ModelFit;
  /** 95% and 99% quantiles of each discrepancy under the null of exact fit (HI95 / HI99). */
  hi95: ModelFit;
  hi99: ModelFit;
}

const DISC = ['srmr', 'dULS', 'dG'] as const;
const WHICH = ['saturated', 'estimated'] as const;

/** Z* = Z R^-½ Σ̂^½: data whose sample correlation matrix equals Σ̂ exactly. */
export function rotateToImplied(Z: Float64Array[], R: number[][], Sigma: number[][], label = 'model'): Float64Array[] {
  const n = Z[0].length, p = Z.length;
  if (Math.min(...symEigen(Sigma).values) <= 1e-10) {
    throw new Error(`The ${label} model-implied correlation matrix is not positive definite; the fit test is unavailable.`);
  }
  const M = matMul(symMatFn(R, (v) => 1 / Math.sqrt(v)), symMatFn(Sigma, Math.sqrt));
  return Array.from({ length: p }, (_, j) => {
    const col = new Float64Array(n);
    for (let r = 0; r < n; r++) { let s = 0; for (let k = 0; k < p; k++) s += Z[k][r] * M[k][j]; col[r] = s; }
    return col;
  });
}

/**
 * Bootstrap-based test of exact fit. The data are rotated so that the model
 * holds exactly (Beran & Srivastava 1985; Bollen–Stine): Z* = Z R^-½ Σ̂^½.
 * Bootstrapping Z* gives the reference distribution of each discrepancy;
 * an observed value above HI95 rejects exact fit at the 5% level.
 */
function fitTestJob(data: Dataset, spec: ModelSpec, options: Partial<PlsOptions>): Job {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const m = compileModel(spec);
  const { cols } = extractColumns(data, m, opts.missing);
  const Z = standardizeColumns(cols, m.indicatorNames);
  const core = plsCore(Z, m, opts);
  const st = structural(m, Z, core, opts.consistent);
  const R = Z.map((a) => Z.map((b) => corStd(a, b)));
  const observed = modelFit(m, R, st);
  const implied = {
    saturated: impliedIndicatorCor(m, R, st.loadings, st.C),
    estimated: impliedIndicatorCor(m, R, st.loadings, impliedConstructCor(m, st.C, st.pathCoef, st.rSquared)),
  };
  const rotated = WHICH.map((which) => rotateToImplied(Z, R, implied[which], which));
  const params: ParamMeta[] = WHICH.flatMap((w) => DISC.map((d) => ({ key: `${w}:${d}`, group: 'r2' as const, label: `${w} ${d}` })));
  return {
    n: cols[0].length,
    params,
    observed,
    originals: WHICH.flatMap((w) => DISC.map((d) => observed[w][d])),
    sample: (idx) => WHICH.flatMap((which, w) => {
      const Xb = standardizeColumns(resample(rotated[w], idx), m.indicatorNames);
      const cb = plsCore(Xb, m, opts, core.w);
      if (!cb.converged) throw new Error('not converged');
      const Rb = Xb.map((a) => Xb.map((c) => corStd(a, c)));
      const fit = modelFit(m, Rb, structural(m, Xb, cb, opts.consistent))[which];
      return DISC.map((d) => fit[d]);
    }),
  };
}

// ---------- ranges and merging ----------

/** Estimate bootstrap samples [start, end) of a job. Safe to run in parallel workers. */
export function runRange(req: RangeRequest, hooks: BootstrapHooks = {}): RangePart {
  const job = req.job === 'pls' ? plsJob(req.data, req.spec, req.options)
    : req.job === 'cb' ? cbJob(req.data, req.spec, { ...DEFAULT_OPTIONS, ...req.options }.missing, req.estimator ?? 'ML')
      : fitTestJob(req.data, req.spec, req.options);
  const count = Math.max(0, req.end - req.start);
  const draws = job.params.map(() => new Float64Array(count).fill(NaN));
  for (let k = 0; k < count; k++) {
    if (hooks.shouldCancel?.()) throw new Error('Bootstrapping cancelled.');
    try {
      const vals = job.sample(sampleIndices(req.seed, req.start + k, job.n));
      vals.forEach((v, p) => (draws[p][k] = v));
    } catch {
      // failed sample stays NaN
    }
    if (hooks.onProgress && (k % 10 === 9 || k === count - 1)) hooks.onProgress(k + 1, count);
  }
  return { start: req.start, params: job.params.map(({ key, group, label }) => ({ key, group, label })), originals: job.originals, draws, observed: job.observed };
}

/** Concatenate ranges in sample order and keep the samples that succeeded. */
function collect(parts: RangePart[]) {
  const ordered = [...parts].sort((a, b) => a.start - b.start);
  const P = ordered[0].params.length;
  const total = ordered.reduce((s, p) => s + (p.draws[0]?.length ?? 0), 0);
  const kept: number[][] = Array.from({ length: P }, () => []);
  let ok = 0;
  for (const part of ordered) {
    const len = part.draws[0]?.length ?? 0;
    for (let k = 0; k < len; k++) {
      if (!part.draws.every((d) => Number.isFinite(d[k]))) continue;
      for (let p = 0; p < P; p++) kept[p].push(part.draws[p][k]);
      ok++;
    }
  }
  if (ok < 2) throw new Error('Too few bootstrap samples could be estimated.');
  return { ordered, kept, ok, failed: total - ok };
}

export function mergeBootstrap(parts: RangePart[], confidence: number): BootstrapResult {
  const { ordered, kept, ok, failed } = collect(parts);
  const alpha = (1 - confidence) / 2;
  const stats: BootstrapStat[] = ordered[0].params.map((p, i) => {
    const v = kept[i];
    const mean = v.reduce((s, x) => s + x, 0) / ok;
    const sd = Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / (ok - 1));
    const original = ordered[0].originals[i];
    const t = sd > 0 ? Math.abs(original / sd) : Infinity;
    const sorted = Float64Array.from(v).sort();
    return {
      ...p, original, mean, sd, t,
      p: tTestP(t, ok - 1),
      ciLow: quantileSorted(sorted, alpha),
      ciHigh: quantileSorted(sorted, 1 - alpha),
    };
  });
  return { samples: ok, failed, confidence, stats };
}

export function mergeFitTest(parts: RangePart[]): FitTestResult {
  const { ordered, kept, ok, failed } = collect(parts);
  const q = (w: number, prob: number) =>
    Object.fromEntries(DISC.map((d, k) => [d, quantileSorted(Float64Array.from(kept[w * DISC.length + k]).sort(), prob)])) as unknown as ModelFit['saturated'];
  return {
    samples: ok, failed, observed: ordered[0].observed!,
    hi95: { saturated: q(0, 0.95), estimated: q(1, 0.95) },
    hi99: { saturated: q(0, 0.99), estimated: q(1, 0.99) },
  };
}

/** Split [0, samples) into `workers` contiguous ranges. */
export function splitRanges(samples: number, workers: number): [number, number][] {
  const k = Math.max(1, Math.min(workers, samples));
  return Array.from({ length: k }, (_, i) => [Math.floor((i * samples) / k), Math.floor(((i + 1) * samples) / k)] as [number, number]);
}

// ---------- single-threaded conveniences ----------

const whole = (job: BootJobKind, data: Dataset, spec: ModelSpec, options: Partial<PlsOptions>, samples: number, seed: number, hooks: BootstrapHooks, estimator?: CbEstimator) =>
  runRange({ job, data, spec, options, estimator, seed, start: 0, end: Math.max(2, Math.floor(samples)) }, hooks);

export function bootstrapPls(data: Dataset, spec: ModelSpec, options: Partial<PlsOptions>, bopts: BootstrapOptions, hooks: BootstrapHooks = {}): BootstrapResult {
  return mergeBootstrap([whole('pls', data, spec, options, bopts.samples, bopts.seed, hooks)], bopts.confidence);
}

export function fitTestPls(data: Dataset, spec: ModelSpec, options: Partial<PlsOptions>, bopts: Pick<BootstrapOptions, 'samples' | 'seed'>, hooks: BootstrapHooks = {}): FitTestResult {
  return mergeFitTest([whole('fittest', data, spec, options, bopts.samples, bopts.seed, hooks)]);
}

export function bootstrapCb(
  data: Dataset, spec: ModelSpec, missing: PlsOptions['missing'], bopts: BootstrapOptions, hooks: BootstrapHooks = {}, estimator: CbEstimator = 'ML',
): BootstrapResult {
  return mergeBootstrap([whole('cb', data, spec, { missing }, bopts.samples, bopts.seed, hooks, estimator)], bopts.confidence);
}
