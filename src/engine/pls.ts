// PLS-SEM estimation (Lohmöller / Wold algorithm) with path, factor or
// centroid inner weighting and Mode A (correlation) / Mode B (regression)
// outer weights (estimation choices, not measurement models: Henseler 2021).
// Results are validated against R seminr in pls.test.ts.

import {
  cholesky,
  invert,
  invertPD,
  matMul,
  solve,
  symEigen,
  transpose,
  zeros,
  type Mat,
} from './linalg';
import { corStd, cramerVonMises, mean, pStar, sd, standardize } from './stats';
import type {
  ConstructQuality,
  ConstructType,
  Dataset,
  Mode,
  ModelFit,
  ModelSpec,
  PlsOptions,
  PlsResult,
} from './types';
import {
  copulaName,
  DEFAULT_OPTIONS,
  interactionName,
  LAVAAN_MISSING,
  threeWayName,
} from './types';
import { expandCategorical } from './categorical';
import { latentMoments, momentRegression } from './plscMoments';

export interface CompiledModel {
  constructs: string[];
  modes: Mode[];
  types: ConstructType[];
  indicatorNames: string[];
  indicatorConstruct: number[];
  /** Indicator indices (into indicatorNames) for each construct. */
  blocks: number[][];
  /** Dominant indicator of each construct (index into indicatorNames), or -1. */
  dominant: number[];
  /** Pre-defined weights of each construct's block (null: estimated). */
  predefined: (number[] | null)[];
  preds: number[][];
  succs: number[][];
  hasPath: boolean[][];
}

export function compileModel(spec: ModelSpec): CompiledModel {
  const constructs = spec.constructs.map((c) => c.name);
  const idx = new Map(constructs.map((n, i) => [n, i]));
  const indicatorNames: string[] = [];
  const indicatorConstruct: number[] = [];
  const blocks: number[][] = spec.constructs.map((c, j) =>
    c.indicators.map((name) => {
      indicatorNames.push(name);
      indicatorConstruct.push(j);
      return indicatorNames.length - 1;
    }),
  );
  const J = constructs.length;
  const hasPath = Array.from({ length: J }, () => new Array<boolean>(J).fill(false));
  const preds: number[][] = constructs.map(() => []);
  const succs: number[][] = constructs.map(() => []);
  for (const p of spec.paths) {
    const f = idx.get(p.from),
      t = idx.get(p.to);
    if (f === undefined || t === undefined)
      throw new Error(`Path ${p.from} → ${p.to} references an unknown construct.`);
    if (hasPath[f][t]) continue;
    hasPath[f][t] = true;
    preds[t].push(f);
    succs[f].push(t);
  }
  const types = spec.constructs.map((c) => c.type ?? (c.mode === 'B' ? 'composite' : 'factor'));
  const predefined = spec.constructs.map((c) =>
    c.predefinedWeights ? c.indicators.map((name) => c.predefinedWeights![name] ?? 0) : null,
  );
  const dominant = spec.constructs.map((c, j) =>
    c.dominant ? (blocks[j].find((k) => indicatorNames[k] === c.dominant) ?? -1) : -1,
  );
  return {
    constructs,
    predefined,
    modes: spec.constructs.map((c) => c.mode),
    types,
    indicatorNames,
    indicatorConstruct,
    blocks,
    preds,
    succs,
    hasPath,
    dominant,
  };
}

/**
 * Pull the model's indicator columns out of the dataset and apply the
 * missing-value treatment. Returns raw (unstandardised) columns.
 */
export function extractColumns(
  data: Dataset,
  model: CompiledModel,
  missing: PlsOptions['missing'],
): { cols: Float64Array[]; dropped: number } {
  if (data.moments && data.cols.length === 0) {
    throw new Error(
      'This dataset is a covariance matrix: PLS, bootstrapping and moderation need raw data. Use CB-SEM (ML, MLM, MLMV, GLS or ULS).',
    );
  }
  const byName = new Map(data.names.map((n, i) => [n, data.cols[i]]));
  const raw = model.indicatorNames.map((name) => {
    const col = byName.get(name);
    if (!col) throw new Error(`Indicator "${name}" is not in the dataset.`);
    return col;
  });
  const n = raw[0]?.length ?? 0;
  if (missing === 'casewise') {
    const keep: number[] = [];
    for (let r = 0; r < n; r++) if (raw.every((c) => !Number.isNaN(c[r]))) keep.push(r);
    return { cols: raw.map((c) => Float64Array.from(keep, (r) => c[r])), dropped: n - keep.length };
  }
  const cols = raw.map((c) => {
    const present = c.filter((v) => !Number.isNaN(v));
    if (present.length === 0) return c.slice();
    const m = mean(present);
    return c.map((v) => (Number.isNaN(v) ? m : v));
  });
  return { cols, dropped: 0 };
}

interface CoreResult {
  w: Float64Array;
  scores: Float64Array[];
  iterations: number;
  converged: boolean;
}

/** Core iterative algorithm on standardised indicator columns. */
export function plsCore(
  X: Float64Array[],
  m: CompiledModel,
  opts: Pick<PlsOptions, 'scheme' | 'maxIter' | 'tolerance'>,
  /** Starting weights; bootstrapping passes the original solution to converge faster. */
  init?: Float64Array,
): CoreResult {
  const J = m.constructs.length;
  const n = X[0].length;
  const w = init ? init.slice() : new Float64Array(X.length).fill(1);

  // Mode B needs the inverse indicator correlation matrix of each block, which is constant.
  const blockInv: (Mat | null)[] = m.blocks.map((b, j) => {
    if (m.modes[j] !== 'B' || b.length < 2 || m.predefined[j]) return null;
    const R = b.map((k) => b.map((l) => corStd(X[k], X[l])));
    return invert(R);
  });

  const computeScores = (): Float64Array[] =>
    m.blocks.map((b, j) => {
      const y = new Float64Array(n);
      for (const k of b) {
        const xk = X[k],
          wk = w[k];
        for (let r = 0; r < n; r++) y[r] += wk * xk[r];
      }
      // Rescale weights so that the score has unit variance (X is centred, so mean is 0).
      let ss = 0;
      for (let r = 0; r < n; r++) ss += y[r] * y[r];
      const s = Math.sqrt(ss / (n - 1));
      if (!(s > 1e-12)) throw new Error(`Construct "${m.constructs[j]}" has zero variance.`);
      for (const k of b) w[k] /= s;
      for (let r = 0; r < n; r++) y[r] /= s;
      return y;
    });

  let Y = computeScores();
  let iterations = 0;
  let converged = false;

  for (let it = 1; it <= opts.maxIter; it++) {
    iterations = it;
    const C = Y.map((a) => Y.map((b) => corStd(a, b)));

    // Inner weights E[i][j]: contribution of construct i to the inner proxy of j.
    const E = zeros(J, J);
    for (let j = 0; j < J; j++) {
      if (opts.scheme === 'path') {
        for (const s of m.succs[j]) E[s][j] = C[s][j];
        const P = m.preds[j];
        if (P.length > 0) {
          const beta = solve(
            P.map((a) => P.map((b) => C[a][b])),
            P.map((a) => C[a][j]),
          );
          P.forEach((p, i) => (E[p][j] = beta[i]));
        }
      } else {
        for (const nb of [...m.preds[j], ...m.succs[j]])
          E[nb][j] = opts.scheme === 'factor' ? C[nb][j] : Math.sign(C[nb][j]);
      }
    }

    const Z = Array.from({ length: J }, (_, j) => {
      const z = new Float64Array(n);
      for (let i = 0; i < J; i++) {
        const e = E[i][j];
        if (e === 0) continue;
        const yi = Y[i];
        for (let r = 0; r < n; r++) z[r] += e * yi[r];
      }
      // Scaled only: z is a combination of centred scores (with sampling weights, of √w-premultiplied ones, whose centring is the weighted one).
      let ss = 0;
      for (let r = 0; r < n; r++) ss += z[r] * z[r];
      const s = Math.sqrt(ss / (n - 1));
      if (!(s > 1e-12)) throw new Error(`"inner proxy of ${m.constructs[j]}" has zero variance.`);
      for (let r = 0; r < n; r++) z[r] /= s;
      return z;
    });

    const last = w.slice();
    m.blocks.forEach((b, j) => {
      const r = b.map((k) => corStd(X[k], Z[j]));
      const inv = blockInv[j];
      // Sum scores: equal (unit) weights on the standardised indicators, rescaled below.
      const given = m.predefined[j];
      if (given) b.forEach((k, a) => (w[k] = given[a]));
      else if (m.modes[j] === 'unit') b.forEach((k) => (w[k] = 1));
      else if (inv) {
        b.forEach((k, a) => (w[k] = inv[a].reduce((s, v, c) => s + v * r[c], 0)));
      } else {
        b.forEach((k, a) => (w[k] = r[a]));
      }
    });
    Y = computeScores();
    // Dominant indicators: each block's sign such that its dominant indicator loads positively (cSEM's setDominantIndicator).
    m.dominant.forEach((k, j) => {
      if (k < 0 || corStd(X[k], Y[j]) >= 0) return;
      for (const i of m.blocks[j]) w[i] = -w[i];
      const y = Y[j];
      for (let r = 0; r < n; r++) y[r] = -y[r];
    });

    let diff = 0;
    for (let k = 0; k < w.length; k++) diff += Math.abs(w[k] - last[k]);
    if (diff < opts.tolerance) {
      converged = true;
      break;
    }
  }
  return { w, scores: Y, iterations, converged };
}

function rSquaredOf(C: number[][], P: number[], j: number): { beta: number[]; r2: number } {
  if (P.length === 0) return { beta: [], r2: 0 };
  const beta = solve(
    P.map((a) => P.map((b) => C[a][b])),
    P.map((a) => C[a][j]),
  );
  return { beta, r2: beta.reduce((s, b, i) => s + b * C[P[i]][j], 0) };
}

function totalEffectsOf(B: number[][]): number[][] {
  const J = B.length;
  const total = B.map((r) => r.slice());
  let power = B.map((r) => r.slice());
  for (let step = 1; step < J; step++) {
    const next = zeros(J, J);
    for (let i = 0; i < J; i++)
      for (let k = 0; k < J; k++) {
        if (power[i][k] === 0) continue;
        for (let j = 0; j < J; j++) next[i][j] += power[i][k] * B[k][j];
      }
    power = next;
    for (let i = 0; i < J; i++) for (let j = 0; j < J; j++) total[i][j] += power[i][j];
  }
  return total;
}

/**
 * Dijkstra–Henseler ρA of a Mode A block, with weights scaled so the composite
 * has unit variance. Also returns the correction factor ĉ (λ̂ = ĉ ŵ).
 */
function rhoAOf(b: number[], w: Float64Array, R: Mat): { rhoA: number; c: number } {
  const k = b.length;
  const wb = b.map((i) => w[i]);
  const ww = wb.reduce((s, v) => s + v * v, 0);
  let num = 0;
  for (let a = 0; a < k; a++)
    for (let d = 0; d < k; d++) if (a !== d) num += wb[a] * R[b[a]][b[d]] * wb[d];
  const den = ww * ww - wb.reduce((s, v) => s + v ** 4, 0);
  const c2 = num / den;
  return { rhoA: ww * ww * c2, c: Math.sqrt(Math.max(c2, 0)) };
}

/** Whether a construct gets the ρA reliability (and PLSc correction). */
const isCommonFactor = (m: CompiledModel, j: number) =>
  m.types[j] === 'factor' && m.modes[j] === 'A' && m.blocks[j].length > 1 && !m.predefined[j];

/**
 * Structural results that bootstrapping also needs. With `consistent`, common
 * factors are corrected for attenuation (PLSc, Dijkstra & Henseler 2015):
 * loadings λ = ĉŵ and construct correlations r / √(ρA_i ρA_j).
 */
export function structural(
  m: CompiledModel,
  X: Float64Array[],
  core: CoreResult,
  consistent = false,
) {
  const J = m.constructs.length;
  const Y = core.scores;
  const raw = Y.map((a) => Y.map((b) => corStd(a, b)));
  const rhoA = new Array<number>(J).fill(1);
  const loadings = m.indicatorConstruct.map((j, k) => corStd(X[k], Y[j]));
  m.blocks.forEach((b, j) => {
    if (!isCommonFactor(m, j)) return;
    const R = b.map((a) => b.map((d) => corStd(X[a], X[d])));
    const local = b.map((_, i) => i);
    const wLocal = Float64Array.from(b, (i) => core.w[i]);
    const r = rhoAOf(local, wLocal, R);
    rhoA[j] = r.rhoA;
    if (consistent) b.forEach((i) => (loadings[i] = r.c * core.w[i]));
  });
  const C = consistent
    ? raw.map((row, i) => row.map((v, j) => (i === j ? 1 : v / Math.sqrt(rhoA[i] * rhoA[j]))))
    : raw;
  const pathCoef = zeros(J, J);
  const rSquared: (number | null)[] = new Array(J).fill(null);
  for (let j = 0; j < J; j++) {
    const P = m.preds[j];
    if (P.length === 0) continue;
    const { beta, r2 } = rSquaredOf(C, P, j);
    P.forEach((p, i) => (pathCoef[p][j] = beta[i]));
    rSquared[j] = r2;
  }
  const totalEffects = totalEffectsOf(pathCoef);
  return { C, pathCoef, rSquared, loadings, totalEffects, rhoA };
}

function quality(
  m: CompiledModel,
  R: number[][],
  rhoAs: number[],
  loadings: number[],
): ConstructQuality[] {
  return m.blocks.map((b, j) => {
    const k = b.length;
    const lam = b.map((i) => loadings[i]);
    const sumL = lam.reduce((s, v) => s + v, 0);
    const errVar = lam.reduce((s, v) => s + (1 - v * v), 0);
    const rhoC = (sumL * sumL) / (sumL * sumL + errVar);
    const ave = lam.reduce((s, v) => s + v * v, 0) / k;
    if (k === 1) return { alpha: 1, rhoC, rhoA: 1, ave };

    let sumR = 0;
    for (const a of b) for (const c of b) sumR += R[a][c];
    const alpha = (k / (k - 1)) * (1 - k / sumR);

    const rhoA = rhoAs[j];
    return { alpha, rhoC, rhoA, ave };
  });
}

export function htmtOf(m: CompiledModel, R: number[][]): (number | null)[][] {
  const J = m.constructs.length;
  const mono = m.blocks.map((b) => {
    if (b.length < 2) return 1;
    let s = 0,
      c = 0;
    for (let a = 0; a < b.length; a++)
      for (let d = a + 1; d < b.length; d++) {
        s += Math.abs(R[b[a]][b[d]]);
        c++;
      }
    return s / c;
  });
  const out: (number | null)[][] = Array.from({ length: J }, () => new Array(J).fill(null));
  for (let i = 0; i < J; i++)
    for (let j = 0; j < i; j++) {
      if (!m.blocks[i].length || !m.blocks[j].length) continue; // higher-order constructs have no indicators
      let s = 0;
      for (const a of m.blocks[i]) for (const b of m.blocks[j]) s += Math.abs(R[a][b]);
      const hetero = s / (m.blocks[i].length * m.blocks[j].length);
      out[i][j] = hetero / Math.sqrt(mono[i] * mono[j]);
    }
  return out;
}

/** HTMT2 (Roemer, Schuberth & Henseler 2021): geometric instead of arithmetic means. */
export function htmt2Of(m: CompiledModel, R: number[][]): (number | null)[][] {
  const J = m.constructs.length;
  const gmean = (xs: number[]) =>
    Math.exp(xs.reduce((s, v) => s + Math.log(Math.abs(v)), 0) / xs.length);
  const mono = m.blocks.map((b) => {
    if (b.length < 2) return 1;
    const xs: number[] = [];
    for (let a = 0; a < b.length; a++)
      for (let d = a + 1; d < b.length; d++) xs.push(R[b[a]][b[d]]);
    return gmean(xs);
  });
  const out: (number | null)[][] = Array.from({ length: J }, () => new Array(J).fill(null));
  for (let i = 0; i < J; i++)
    for (let j = 0; j < i; j++) {
      if (!m.blocks[i].length || !m.blocks[j].length) continue;
      const xs: number[] = [];
      for (const a of m.blocks[i]) for (const b of m.blocks[j]) xs.push(R[a][b]);
      out[i][j] = gmean(xs) / Math.sqrt(mono[i] * mono[j]);
    }
  return out;
}

/**
 * Construct correlations implied by the structural model: exogenous
 * correlations as estimated, endogenous disturbances uncorrelated with
 * variance 1 − R² (as in cSEM's fit()).
 */
export function impliedConstructCor(
  m: CompiledModel,
  C: Mat,
  pathCoef: Mat,
  rSquared: (number | null)[],
): Mat {
  const J = m.constructs.length;
  const B = zeros(J, J); // B[to][from]
  for (let f = 0; f < J; f++) for (let t = 0; t < J; t++) B[t][f] = pathCoef[f][t];
  const Psi = zeros(J, J);
  const exo = m.preds.map((P) => P.length === 0);
  for (let i = 0; i < J; i++)
    for (let j = 0; j < J; j++) {
      if (exo[i] && exo[j]) Psi[i][j] = C[i][j];
      else if (i === j) Psi[i][i] = 1 - (rSquared[i] ?? 0);
    }
  const A = invert(B.map((r, i) => r.map((v, j) => (i === j ? 1 : 0) - v)));
  const V = matMul(matMul(A, Psi), transpose(A));
  for (let i = 0; i < J; i++) V[i][i] = 1;
  return V;
}

/**
 * Model-implied indicator correlation matrix Σ̂ = Λᵀ Φ Λ + Θ, with the
 * within-block correlations of composites left unrestricted (taken from S).
 */
export function impliedIndicatorCor(m: CompiledModel, S: Mat, loadings: number[], Phi: Mat): Mat {
  const p = S.length;
  const ofC = m.indicatorConstruct;
  const Sig = zeros(p, p);
  for (let i = 0; i < p; i++)
    for (let j = 0; j < p; j++) {
      if (i === j) {
        Sig[i][i] = 1;
        continue;
      }
      if (ofC[i] === ofC[j] && m.types[ofC[i]] === 'composite') Sig[i][j] = S[i][j];
      else Sig[i][j] = loadings[i] * Phi[ofC[i]][ofC[j]] * loadings[j];
    }
  return Sig;
}

/** SRMR, d_ULS and d_G (natural log) between two correlation matrices. */
export function discrepancies(S: Mat, Sig: Mat): { srmr: number; dULS: number; dG: number } {
  const p = S.length;
  let ss = 0,
    uls = 0;
  for (let i = 0; i < p; i++)
    for (let j = 0; j < p; j++) {
      const d =
        S[i][j] / Math.sqrt(S[i][i] * S[j][j]) - Sig[i][j] / Math.sqrt(Sig[i][i] * Sig[j][j]);
      if (j <= i) ss += d * d;
      uls += (S[i][j] - Sig[i][j]) ** 2;
    }
  let dG = NaN;
  const L = cholesky(S);
  const LS = cholesky(Sig);
  if (L && LS) {
    // Eigenvalues of S⁻¹Σ̂ equal those of the symmetric L⁻¹ Σ̂ L⁻ᵀ.
    const Linv = transpose(cholesky(invertPD(L))!); // any matrix M with Mᵀ M = S⁻¹ works
    const M = matMul(matMul(Linv, Sig), transpose(Linv));
    dG = 0.5 * symEigen(M).values.reduce((s, v) => s + Math.log(v) ** 2, 0);
  }
  return { srmr: Math.sqrt(ss / ((p * (p + 1)) / 2)), dULS: 0.5 * uls, dG };
}

export function modelFit(m: CompiledModel, R: Mat, st: ReturnType<typeof structural>): ModelFit {
  const sat = impliedIndicatorCor(m, R, st.loadings, st.C);
  const est = impliedIndicatorCor(
    m,
    R,
    st.loadings,
    impliedConstructCor(m, st.C, st.pathCoef, st.rSquared),
  );
  return { saturated: discrepancies(R, sat), estimated: discrepancies(R, est) };
}

function vifDiag(R: number[][]): number[] {
  if (R.length === 1) return [1];
  const inv = invert(R);
  return R.map((_, i) => inv[i][i]);
}

/**
 * R² of `to` when the path from→to is dropped. Following Hair et al. (and
 * seminr), the whole model is re-estimated without that path. If dropping it
 * isolates a construct the model is no longer estimable, so we fall back to
 * regressing on the remaining predictors' current scores.
 */
function excludedRSquared(
  m: CompiledModel,
  X: Float64Array[],
  opts: PlsOptions,
  C: number[][],
  from: number,
  to: number,
): number {
  const remaining = m.preds[to].filter((q) => q !== from);
  if (remaining.length === 0) return 0;
  const reduced: CompiledModel = {
    ...m,
    preds: m.preds.map((P, j) => (j === to ? remaining : P)),
    succs: m.succs.map((S, j) => (j === from ? S.filter((s) => s !== to) : S)),
  };
  const isolated = reduced.preds.some((P, j) => P.length === 0 && reduced.succs[j].length === 0);
  if (!isolated) {
    try {
      const core = plsCore(X, reduced, opts);
      return rSquaredOf(structural(reduced, X, core, opts.consistent).C, remaining, to).r2;
    } catch {
      // fall through to the fixed-scores approximation
    }
  }
  return rSquaredOf(C, remaining, to).r2;
}

export function standardizeColumns(cols: Float64Array[], names: string[]): Float64Array[] {
  return cols.map((c, i) => standardize(c, names[i]));
}

/** Sampling weights (WPLS) rescaled to sum to n, so that unit weights give the unweighted algorithm. Throws on invalid weights. */
export function normaliseWeights(w: ArrayLike<number>): Float64Array {
  let sum = 0;
  for (let r = 0; r < w.length; r++) {
    if (!(Number.isFinite(w[r]) && w[r] >= 0))
      throw new Error('Sampling weights must be non-negative numbers without missing values.');
    sum += w[r];
  }
  if (!(sum > 0)) throw new Error('The sampling weights are all zero.');
  return Float64Array.from(w, (v) => (v * w.length) / sum);
}

/** Weighted mean and standard deviation (weights summing to n; n − 1 denominator, as the unweighted sd). */
export function weightedMoments(
  x: ArrayLike<number>,
  w: ArrayLike<number>,
): { mean: number; sd: number } {
  const n = x.length;
  let m = 0,
    ss = 0;
  for (let r = 0; r < n; r++) m += w[r] * x[r];
  m /= n;
  for (let r = 0; r < n; r++) ss += w[r] * (x[r] - m) ** 2;
  return { mean: m, sd: Math.sqrt(ss / (n - 1)) };
}

/** Mean and sd, weighted when there are sampling weights. */
const momentsOf = (x: Float64Array, w: Float64Array | null) =>
  w ? weightedMoments(x, w) : { mean: mean(x), sd: sd(x) };

/**
 * Weighted PLS (WPLS; Becker & Ismail 2016, European Management Journal 34(6)): every correlation and
 * regression of the algorithm weighted by the sampling weights. Columns are standardised with the weighted
 * mean and sd (`Z`) and premultiplied by √w (`X`), so that the plain cross-products of plsCore / structural
 * (corStd) are weighted correlations Σ w z_a z_b / (n − 1), and least squares on them weighted least squares.
 * With integer weights the estimates equal those of the data with each row repeated w times.
 */
function weightedColumns(
  cols: Float64Array[],
  names: string[],
  w: Float64Array,
): { X: Float64Array[]; Z: Float64Array[] } {
  const sw = w.map(Math.sqrt);
  const Z = cols.map((c, i) => {
    const { mean: m, sd: s } = weightedMoments(c, w);
    if (!(s > 1e-12)) throw new Error(`"${names[i]}" has zero (weighted) variance.`);
    return Float64Array.from(c, (v) => (v - m) / s);
  });
  return { X: Z.map((z) => Float64Array.from(z, (v, r) => v * sw[r])), Z };
}

export interface PlsEstimate {
  m: CompiledModel;
  X: Float64Array[];
  core: CoreResult;
  /** `r2Excluding`: PLSc with terms: R² of an equation without a predictor. */
  st: ReturnType<typeof structural> & { r2Excluding?: (from: number, to: number) => number };
  /** Stage-1 weights when the model has moderators (warm start for bootstrapping). */
  w1?: Float64Array;
  /** Construct scores for reporting when they differ from core.scores (WPLS: core.scores are premultiplied by √w). */
  scores?: Float64Array[];
}

/**
 * Indicators of a product-indicator or orthogonalising interaction term, as seminr's interaction_term(method =
 * product_indicator / orthogonal): the items standardised (scale()), every predictor × moderator item product
 * (Chin, Marcolin & Newsted 2003); orthogonalising: each product replaced by its residual from a least-squares
 * regression on all the predictor's and moderator's items (Little, Bovaird & Widaman 2006; Henseler & Chin 2010).
 * With sampling weights the means, sds and the regression are weighted.
 */
export function indicatorProducts(
  c: Float64Array[],
  items: [number, number][],
  orthogonal: boolean,
  w: Float64Array | null,
): Float64Array[] {
  const n = c[0].length;
  const z = new Map<number, Float64Array>();
  const zOf = (k: number) => {
    if (!z.has(k)) {
      const mo = momentsOf(c[k], w);
      z.set(
        k,
        Float64Array.from(c[k], (v) => (v - mo.mean) / mo.sd),
      );
    }
    return z.get(k)!;
  };
  const prods = items.map(([a, b]) => {
    const za = zOf(a),
      zb = zOf(b);
    return Float64Array.from(za, (v, r) => v * zb[r]);
  });
  if (!orthogonal) return prods;
  const regs = [...new Set(items.flatMap(([a, b]) => [a, b]))];
  const cols = [new Float64Array(n).fill(1), ...regs.map((k) => c[k])];
  const wt = (r: number) => (w ? w[r] : 1);
  const XtX = cols.map((a) =>
    cols.map((b) => {
      let s = 0;
      for (let r = 0; r < n; r++) s += wt(r) * a[r] * b[r];
      return s;
    }),
  );
  return prods.map((y) => {
    const beta = solve(
      XtX,
      cols.map((a) => {
        let s = 0;
        for (let r = 0; r < n; r++) s += wt(r) * a[r] * y[r];
        return s;
      }),
    );
    return Float64Array.from(y, (v, r) => v - cols.reduce((s, col, i) => s + beta[i] * col[r], 0));
  });
}

/**
 * Compile a (possibly moderated) model and return an estimator that works on
 * raw, complete indicator columns. Moderation uses the two-stage approach
 * (Henseler & Chin 2010; as seminr and SmartPLS): stage 1 estimates the model
 * without interaction terms, the product of the standardised scores of the
 * predictor and the moderator becomes a single-indicator construct, and stage 2
 * estimates the full model. Gaussian copula terms take the same route (Hult et
 * al. 2018): P* of the predictor's stage 1 scores, recomputed per bootstrap sample.
 * With PLSc, the terms' moments are corrected instead (plscMoments.ts).
 */
export function preparePls(data0: Dataset, spec0: ModelSpec, opts: PlsOptions) {
  // Categorical exogenous constructs: their dummy columns and Mode B composites.
  const { data, spec } = expandCategorical(data0, spec0);
  const mods = spec.moderations ?? [];
  if (spec.constructs.some((c) => c.components?.length))
    throw new Error('Higher-order constructs are supported in CB-SEM only.');
  const cops = spec.copulas ?? [];
  // P* is built from the proxy itself, so its error is not independent of the proxy's: PLSc's correction does not apply.
  if (cops.length && opts.consistent)
    throw new Error(
      'Gaussian copula terms are not available with PLSc; switch consistent PLS off.',
    );
  const threeMains = (spec.threeWay ?? []).flatMap((t) =>
    [t.moderator, t.moderator2].map((from) => ({ from, to: t.to })),
  );
  const m1 = compileModel({
    constructs: spec.constructs,
    paths: [
      ...spec.paths,
      ...threeMains
        .filter((q) => !spec.paths.some((p) => p.from === q.from && p.to === q.to))
        .filter((q, i, all) => all.findIndex((o) => o.from === q.from && o.to === q.to) === i),
    ],
  });
  // Sampling weights (WPLS): the weights column travels with the rows as the last column, so bootstrap samples resample cases with their weights.
  const wname = spec.weights;
  if (wname) {
    if (cops.length)
      throw new Error(
        'Gaussian copula terms cannot be combined with sampling weights (P* is built from unweighted ranks).',
      );
    if (opts.consistent && (mods.length || spec.threeWay?.length))
      throw new Error(
        'Interaction terms with PLSc cannot be combined with sampling weights; switch consistent PLS off.',
      );
    if (m1.indicatorNames.includes(wname))
      throw new Error(`“${wname}” cannot be both the sampling weights and an indicator.`);
  }
  const { cols, dropped } = extractColumns(
    data,
    wname ? { ...m1, indicatorNames: [...m1.indicatorNames, wname] } : m1,
    opts.missing,
  );
  /** Indicator columns and normalised weights (null: unweighted) of a set of rows. */
  const split = (c: Float64Array[]) =>
    wname ? { c: c.slice(0, -1), w: normaliseWeights(c[c.length - 1]) } : { c, w: null };
  /** Algorithm columns X, and the standardised (not premultiplied) columns Z. */
  const stdz = (c: Float64Array[], names: string[], w: Float64Array | null) => {
    if (w) return weightedColumns(c, names, w);
    const X = standardizeColumns(c, names);
    return { X, Z: X };
  };
  /** Scores for reporting and for building terms: with weights, recomputed from Z (core.scores carry the √w factor). */
  const plain = (m: CompiledModel, core: CoreResult, Z: Float64Array[], w: Float64Array | null) =>
    w
      ? m.blocks.map((b) => {
          const y = new Float64Array(Z[0].length);
          for (const k of b) for (let r = 0; r < y.length; r++) y[r] += core.w[k] * Z[k][r];
          return y;
        })
      : core.scores;
  if (mods.length === 0 && cops.length === 0 && !spec.threeWay?.length) {
    const estimate = (c0: Float64Array[], init?: { w2?: Float64Array }): PlsEstimate => {
      const { c, w } = split(c0);
      const { X, Z } = stdz(c, m1.indicatorNames, w);
      const core = plsCore(X, m1, opts, init?.w2);
      return {
        m: m1,
        X,
        core,
        st: structural(m1, X, core, opts.consistent),
        ...(w ? { scores: plain(m1, core, Z, w) } : {}),
      };
    };
    return {
      m: m1,
      cols,
      dropped,
      estimate,
      moderations: [] as PlsResult['moderations'],
      threeWay: [] as NonNullable<PlsResult['threeWay']>,
      copulas: [] as { from: string; to: string; construct: number }[],
    };
  }
  // A three-way interaction brings its lower-order terms and main effects along.
  const threes = spec.threeWay ?? [];
  const allMods = [...mods];
  const paths = [...spec.paths];
  for (const t of threes) {
    if (!spec.paths.some((p) => p.from === t.from && p.to === t.to))
      throw new Error(
        `${threeWayName(t)} acts on ${t.from} → ${t.to}, but that path is not in the model.`,
      );
    for (const [from, moderator] of [
      [t.from, t.moderator],
      [t.from, t.moderator2],
      [t.moderator, t.moderator2],
    ]) {
      if (
        !allMods.some(
          (mo) =>
            mo.to === t.to &&
            ((mo.from === from && mo.moderator === moderator) ||
              (mo.from === moderator && mo.moderator === from)),
        )
      )
        allMods.push({ from, moderator, to: t.to });
    }
    for (const from of [t.moderator, t.moderator2])
      if (!paths.some((p) => p.from === from && p.to === t.to)) paths.push({ from, to: t.to });
  }
  const names = [
    ...allMods.map((mo) => interactionName(mo.from, mo.moderator)),
    ...threes.map(threeWayName),
  ];
  const pairs: number[][] = [
    ...allMods.map((mo) => {
      const a = m1.constructs.indexOf(mo.from),
        b = m1.constructs.indexOf(mo.moderator);
      if (a < 0 || b < 0 || !m1.constructs.includes(mo.to))
        throw new Error(
          `Moderation ${mo.moderator} on ${mo.from} → ${mo.to} references an unknown construct.`,
        );
      if (mods.includes(mo) && !spec.paths.some((p) => p.from === mo.from && p.to === mo.to))
        throw new Error(
          `${mo.moderator} moderates ${mo.from} → ${mo.to}, but that path is not in the model.`,
        );
      return [a, b];
    }),
    ...threes.map((t) => {
      const f = [t.from, t.moderator, t.moderator2].map((n) => m1.constructs.indexOf(n));
      if (f.some((i) => i < 0) || !m1.constructs.includes(t.to))
        throw new Error(`${threeWayName(t)} references an unknown construct.`);
      return f;
    }),
  ];
  const termTo = [...allMods.map((mo) => mo.to), ...threes.map((t) => t.to)];
  // Product-indicator and orthogonalising terms (seminr's interaction_term methods): the term's own indicators,
  // every product of a predictor item and a moderator item; null: a two-stage term (one indicator, the product of scores).
  const termItems: ([number, number][] | null)[] = names.map((_, i) => {
    const mo = allMods[i];
    const method = mo?.method ?? 'two_stage';
    if (!mo || method === 'two_stage' || mo.from === mo.moderator) return null;
    if (method !== 'product_indicator' && method !== 'orthogonal')
      throw new Error('Invalid interaction method.');
    if (opts.consistent)
      throw new Error(
        `${names[i]}: product-indicator and orthogonalising terms are not available with PLSc; use the two-stage term or switch consistent PLS off.`,
      );
    return m1.blocks[pairs[i][0]].flatMap((a) =>
      m1.blocks[pairs[i][1]].map((b) => [a, b] as [number, number]),
    );
  });
  const termIndicators = names.map(
    (name, i) =>
      termItems[i]?.map(([a, b]) => `${m1.indicatorNames[a]}*${m1.indicatorNames[b]}`) ?? [name],
  );
  const copNames = cops.map((k) => copulaName(k.from, k.to));
  const copFrom = cops.map((k) => {
    if (!spec.paths.some((p) => p.from === k.from && p.to === k.to))
      throw new Error(
        `A Gaussian copula is set on ${k.from} → ${k.to}, but that path is not in the model.`,
      );
    return m1.constructs.indexOf(k.from);
  });
  const m2 = compileModel({
    constructs: [
      ...spec.constructs,
      ...names.map((name, i) => ({
        name,
        mode: 'A' as const,
        type: 'factor' as const,
        indicators: termIndicators[i],
      })),
      ...copNames.map((name) => ({
        name,
        mode: 'A' as const,
        type: 'factor' as const,
        indicators: [name],
      })),
    ],
    paths: [
      ...paths,
      ...names.map((name, i) => ({ from: name, to: termTo[i] })),
      ...cops.map((k, i) => ({ from: copNames[i], to: k.to })),
    ],
  });
  const estimate = (
    c0: Float64Array[],
    init?: { w1?: Float64Array; w2?: Float64Array },
  ): PlsEstimate => {
    const { c, w } = split(c0);
    const { X: X1, Z: Z1 } = stdz(c, m1.indicatorNames, w);
    const core1 = plsCore(X1, m1, opts, init?.w1);
    const y1 = plain(m1, core1, Z1, w);
    const products = pairs.map((f) =>
      Float64Array.from(y1[f[0]], (_, r) => f.reduce((p, a) => p * y1[a][r], 1)),
    );
    if (opts.consistent) {
      // PLSc: the weights of the model without its terms, and the moments of the products corrected for measurement error.
      const X = standardizeColumns([...c, ...products], m2.indicatorNames);
      const core: CoreResult = {
        ...core1,
        w: Float64Array.from([...core1.w, ...products.map(() => 1)]),
        scores: [...core1.scores, ...products.map((p, i) => standardize(p, names[i]))],
      };
      const st = structural(m2, X, core, true);
      const moment = latentMoments(core1.scores, structural(m1, X1, core1, true).rhoA);
      const regressors = (j: number): number[][] =>
        m2.preds[j].map((p) =>
          p < m1.constructs.length ? [p] : Array.from(pairs[p - m1.constructs.length]),
        );
      m2.preds.forEach((P, j) => {
        if (P.length === 0) return;
        const { beta, r2 } = momentRegression(moment, j, regressors(j));
        P.forEach((p, i) => {
          st.pathCoef[p][j] = beta[i];
        });
        st.rSquared[j] = r2;
      });
      const r2Excluding = (p: number, j: number) => {
        const left = m2.preds[j].filter((q) => q !== p);
        return momentRegression(
          moment,
          j,
          left.map((q) =>
            q < m1.constructs.length ? [q] : Array.from(pairs[q - m1.constructs.length]),
          ),
        ).r2;
      };
      return {
        m: m2,
        X,
        core,
        st: { ...st, totalEffects: totalEffectsOf(st.pathCoef), r2Excluding },
        w1: core1.w,
      };
    }
    const pStars = copFrom.map((a) => pStar(core1.scores[a]));
    const termCols = names.map((_, i) => {
      const items = termItems[i];
      return items
        ? indicatorProducts(c, items, allMods[i].method === 'orthogonal', w)
        : [products[i]];
    });
    const { X, Z } = stdz([...c, ...termCols.flat(), ...pStars], m2.indicatorNames, w);
    const core = plsCore(X, m2, opts, init?.w2);
    const st = structural(m2, X, core, false);
    // Report interaction effects per unit of the product of standardised scores
    // (not of the re-standardised term), as seminr does: then the simple slope of
    // `from` at moderator level m (in SD) is β_from + β_int · m. A term with its own indicators is rescaled
    // as seminr's adjust_interaction does: by the loading-weighted mean sd of its (product) indicators.
    termCols.forEach((cols, i) => {
      const k = m2.constructs.indexOf(names[i]);
      const lam = m2.blocks[k].map((q) => Math.abs(st.loadings[q]));
      const s = termItems[i]
        ? cols.reduce((a, col, q) => a + momentsOf(col, w).sd * lam[q], 0) /
          lam.reduce((a, v) => a + v, 0)
        : momentsOf(cols[0], w).sd;
      st.pathCoef[k] = st.pathCoef[k].map((v) => v / s);
      st.totalEffects[k] = st.totalEffects[k].map((v) => v / s);
    });
    return { m: m2, X, core, st, w1: core1.w, ...(w ? { scores: plain(m2, core, Z, w) } : {}) };
  };
  return {
    m: m2,
    cols,
    dropped,
    estimate,
    moderations: allMods.map((mo, i) => ({
      ...mo,
      ...(termItems[i] ? {} : { method: 'two_stage' as const }),
      construct: m2.constructs.indexOf(names[i]),
    })),
    threeWay: threes.map((t) => ({ ...t, construct: m2.constructs.indexOf(threeWayName(t)) })),
    copulas: cops.map((k, i) => ({ ...k, construct: m2.constructs.indexOf(copNames[i]) })),
  };
}

/**
 * Paths on the indicators' own scale (Fornell's rescaling, as in IPMA): outer weights per raw unit, normalised to sum to 1
 * in each block. Mean-centred results have the same slopes and intercepts of 0. Null for a model with terms (their products have no such scale).
 */
export function originalScaleCoefficients(
  data: Dataset,
  spec: ModelSpec,
  options: Partial<PlsOptions>,
  weights: { name: string; weight: number }[],
) {
  if (spec.moderations?.length || spec.threeWay?.length || spec.copulas?.length) return null;
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const { data: d, spec: sp } = expandCategorical(data, spec);
  const m = compileModel({ constructs: sp.constructs, paths: sp.paths });
  const { cols } = extractColumns(d, m, opts.missing);
  const w = new Map(weights.map((x) => [x.name, x.weight]));
  const n = cols[0]?.length ?? 0;
  const scores = m.blocks.map((b) => {
    const raw = b.map((k) => (w.get(m.indicatorNames[k]) ?? 0) / sd(cols[k]));
    const sum = raw.reduce((s, v) => s + v, 0);
    const y = new Float64Array(n);
    b.forEach((k, a) => {
      for (let r = 0; r < n; r++) y[r] += (raw[a] / (sum || 1)) * cols[k][r];
    });
    return y;
  });
  const means = scores.map((y) => mean(y));
  const cov = (a: number, b: number) => {
    let s = 0;
    for (let r = 0; r < n; r++) s += (scores[a][r] - means[a]) * (scores[b][r] - means[b]);
    return s / (n - 1);
  };
  return m.preds.flatMap((P, j) => {
    if (P.length === 0) return [];
    const b = solve(
      P.map((a) => P.map((c) => cov(a, c))),
      P.map((a) => cov(a, j)),
    );
    return [
      {
        to: m.constructs[j],
        intercept: means[j] - P.reduce((s, p, i) => s + b[i] * means[p], 0),
        coefficients: P.map((p, i) => ({ from: m.constructs[p], b: b[i] })),
      },
    ];
  });
}

/**
 * A moderator that is 0/1 read without standardising it (Becker et al. 2023): from the standardised estimates of
 * z_y = βx·z_x + βd·z_d + βi·z_x·z_d, with z_d = (d − mean) / sd.
 */
export function binaryModeration(bx: number, bd: number, bi: number, d: ArrayLike<number>) {
  const col = Float64Array.from(d as ArrayLike<number>).filter(Number.isFinite);
  const values = [...new Set(col)].sort((a, b) => a - b);
  if (values.length !== 2) return null;
  const [lo, hi] = values;
  const m = mean(col),
    s = sd(col);
  const slope = (v: number) => bx + (bi * (v - m)) / s;
  return {
    low: lo,
    high: hi,
    slopeLow: slope(lo),
    slopeHigh: slope(hi),
    difference: slope(hi) - slope(lo),
    groupDifference: (bd * (hi - lo)) / s,
  };
}

export function estimatePls(
  data: Dataset,
  spec: ModelSpec,
  options: Partial<PlsOptions> = {},
): PlsResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  if (LAVAAN_MISSING.includes(opts.missing))
    throw new Error(
      'FIML, pairwise deletion and the two-stage approach are CB-SEM (lavaan) options; PLS uses mean replacement or casewise deletion.',
    );
  const prep = preparePls(data, spec, opts);
  const dropped = prep.dropped;
  const n = prep.cols[0]?.length ?? 0;
  if (n < 3) throw new Error('Not enough complete observations to estimate the model.');
  const { m, X, core, st, scores: shown } = prep.estimate(prep.cols);
  const scores = shown ?? core.scores;
  const { C, pathCoef, rSquared, loadings, totalEffects } = st;
  const J = m.constructs.length;

  const adjRSquared = rSquared.map((r2, j) =>
    r2 === null ? null : 1 - ((1 - r2) * (n - 1)) / (n - m.preds[j].length - 1),
  );
  const indirectEffects = totalEffects.map((row, i) => row.map((v, j) => v - pathCoef[i][j]));

  const fSquare: (number | null)[][] = Array.from({ length: J }, () => new Array(J).fill(null));
  const vifInner: (number | null)[][] = Array.from({ length: J }, () => new Array(J).fill(null));
  for (let j = 0; j < J; j++) {
    const P = m.preds[j];
    if (P.length === 0) continue;
    const r2 = rSquared[j] as number;
    const vifs = vifDiag(P.map((a) => P.map((b) => C[a][b])));
    P.forEach((p, i) => {
      fSquare[p][j] =
        (r2 - (st.r2Excluding?.(p, j) ?? excludedRSquared(m, X, opts, C, p, j))) / (1 - r2);
      vifInner[p][j] = vifs[i];
    });
  }

  const R = X.map((a) => X.map((b) => corStd(a, b)));
  const vifOuter = new Array<number>(X.length).fill(1);
  m.blocks.forEach((b) => {
    const v = vifDiag(b.map((a) => b.map((c) => R[a][c])));
    b.forEach((k, i) => (vifOuter[k] = v[i]));
  });

  return {
    n,
    iterations: core.iterations,
    converged: core.converged,
    constructs: m.constructs,
    indicators: m.indicatorNames.map((name, k) => ({ name, construct: m.indicatorConstruct[k] })),
    weights: Array.from(core.w),
    loadings,
    pathCoef,
    hasPath: m.hasPath,
    totalEffects,
    indirectEffects,
    rSquared,
    adjRSquared,
    constructCor: C,
    quality: quality(m, R, st.rhoA, loadings),
    htmt: htmtOf(m, R),
    htmt2: htmt2Of(m, R),
    fit: modelFit(m, R, st),
    consistent: opts.consistent,
    types: m.types,
    moderations: prep.moderations,
    ...(prep.threeWay.length ? { threeWay: prep.threeWay } : {}),
    copulas: prep.copulas.map((k) => ({
      ...k,
      normality: cramerVonMises(scores[m.constructs.indexOf(k.from)]),
    })),
    fSquare,
    vifInner,
    vifOuter,
    scores,
    droppedRows: dropped,
    ...(spec.weights ? { samplingWeights: spec.weights } : {}),
  };
}
