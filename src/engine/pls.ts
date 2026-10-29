// PLS-SEM estimation (Lohmöller / Wold algorithm) with path, factor or
// centroid inner weighting and Mode A (reflective) / Mode B (formative)
// outer estimation. Results are validated against R seminr in pls.test.ts.

import { cholesky, invert, invertPD, matMul, solve, symEigen, transpose, zeros, type Mat } from './linalg';
import { corStd, mean, sd, standardize } from './stats';
import type { ConstructQuality, ConstructType, Dataset, ModelFit, ModelSpec, PlsOptions, PlsResult } from './types';
import { DEFAULT_OPTIONS, interactionName } from './types';

export interface CompiledModel {
  constructs: string[];
  modes: ('A' | 'B')[];
  types: ConstructType[];
  indicatorNames: string[];
  indicatorConstruct: number[];
  /** Indicator indices (into indicatorNames) for each construct. */
  blocks: number[][];
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
    const f = idx.get(p.from), t = idx.get(p.to);
    if (f === undefined || t === undefined) throw new Error(`Path ${p.from} → ${p.to} references an unknown construct.`);
    if (hasPath[f][t]) continue;
    hasPath[f][t] = true;
    preds[t].push(f);
    succs[f].push(t);
  }
  const types = spec.constructs.map((c) => c.type ?? (c.mode === 'B' ? 'composite' : 'factor'));
  return { constructs, modes: spec.constructs.map((c) => c.mode), types, indicatorNames, indicatorConstruct, blocks, preds, succs, hasPath };
}

/**
 * Pull the model's indicator columns out of the dataset and apply the
 * missing-value treatment. Returns raw (unstandardised) columns.
 */
export function extractColumns(data: Dataset, model: CompiledModel, missing: PlsOptions['missing']): { cols: Float64Array[]; dropped: number } {
  if (data.moments && data.cols.length === 0) {
    throw new Error('This dataset is a covariance matrix: PLS, bootstrapping and moderation need raw data. Use CB-SEM (ML, MLM, MLMV, GLS or ULS).');
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
    if (m.modes[j] !== 'B' || b.length < 2) return null;
    const R = b.map((k) => b.map((l) => corStd(X[k], X[l])));
    return invert(R);
  });

  const computeScores = (): Float64Array[] =>
    m.blocks.map((b, j) => {
      const y = new Float64Array(n);
      for (const k of b) {
        const xk = X[k], wk = w[k];
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
          const beta = solve(P.map((a) => P.map((b) => C[a][b])), P.map((a) => C[a][j]));
          P.forEach((p, i) => (E[p][j] = beta[i]));
        }
      } else {
        for (const nb of [...m.preds[j], ...m.succs[j]]) E[nb][j] = opts.scheme === 'factor' ? C[nb][j] : Math.sign(C[nb][j]);
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
      return standardize(z, `inner proxy of ${m.constructs[j]}`);
    });

    const last = w.slice();
    m.blocks.forEach((b, j) => {
      const r = b.map((k) => corStd(X[k], Z[j]));
      const inv = blockInv[j];
      if (inv) {
        b.forEach((k, a) => (w[k] = inv[a].reduce((s, v, c) => s + v * r[c], 0)));
      } else {
        b.forEach((k, a) => (w[k] = r[a]));
      }
    });
    Y = computeScores();

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
  const beta = solve(P.map((a) => P.map((b) => C[a][b])), P.map((a) => C[a][j]));
  return { beta, r2: beta.reduce((s, b, i) => s + b * C[P[i]][j], 0) };
}

function totalEffectsOf(B: number[][]): number[][] {
  const J = B.length;
  const total = B.map((r) => r.slice());
  let power = B.map((r) => r.slice());
  for (let step = 1; step < J; step++) {
    const next = zeros(J, J);
    for (let i = 0; i < J; i++) for (let k = 0; k < J; k++) {
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
  for (let a = 0; a < k; a++) for (let d = 0; d < k; d++) if (a !== d) num += wb[a] * R[b[a]][b[d]] * wb[d];
  const den = ww * ww - wb.reduce((s, v) => s + v ** 4, 0);
  const c2 = num / den;
  return { rhoA: ww * ww * c2, c: Math.sqrt(Math.max(c2, 0)) };
}

/** Whether a construct gets the ρA reliability (and PLSc correction). */
const isCommonFactor = (m: CompiledModel, j: number) => m.types[j] === 'factor' && m.modes[j] === 'A' && m.blocks[j].length > 1;

/**
 * Structural results that bootstrapping also needs. With `consistent`, common
 * factors are corrected for attenuation (PLSc, Dijkstra & Henseler 2015):
 * loadings λ = ĉŵ and construct correlations r / √(ρA_i ρA_j).
 */
export function structural(m: CompiledModel, X: Float64Array[], core: CoreResult, consistent = false) {
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

function quality(m: CompiledModel, R: number[][], rhoAs: number[], loadings: number[]): ConstructQuality[] {
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
    let s = 0, c = 0;
    for (let a = 0; a < b.length; a++) for (let d = a + 1; d < b.length; d++) { s += Math.abs(R[b[a]][b[d]]); c++; }
    return s / c;
  });
  const out: (number | null)[][] = Array.from({ length: J }, () => new Array(J).fill(null));
  for (let i = 0; i < J; i++) for (let j = 0; j < i; j++) {
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
  const gmean = (xs: number[]) => Math.exp(xs.reduce((s, v) => s + Math.log(Math.abs(v)), 0) / xs.length);
  const mono = m.blocks.map((b) => {
    if (b.length < 2) return 1;
    const xs: number[] = [];
    for (let a = 0; a < b.length; a++) for (let d = a + 1; d < b.length; d++) xs.push(R[b[a]][b[d]]);
    return gmean(xs);
  });
  const out: (number | null)[][] = Array.from({ length: J }, () => new Array(J).fill(null));
  for (let i = 0; i < J; i++) for (let j = 0; j < i; j++) {
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
export function impliedConstructCor(m: CompiledModel, C: Mat, pathCoef: Mat, rSquared: (number | null)[]): Mat {
  const J = m.constructs.length;
  const B = zeros(J, J); // B[to][from]
  for (let f = 0; f < J; f++) for (let t = 0; t < J; t++) B[t][f] = pathCoef[f][t];
  const Psi = zeros(J, J);
  const exo = m.preds.map((P) => P.length === 0);
  for (let i = 0; i < J; i++) for (let j = 0; j < J; j++) {
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
  for (let i = 0; i < p; i++) for (let j = 0; j < p; j++) {
    if (i === j) { Sig[i][i] = 1; continue; }
    if (ofC[i] === ofC[j] && m.types[ofC[i]] === 'composite') Sig[i][j] = S[i][j];
    else Sig[i][j] = loadings[i] * Phi[ofC[i]][ofC[j]] * loadings[j];
  }
  return Sig;
}

/** SRMR, d_ULS and d_G (natural log) between two correlation matrices. */
export function discrepancies(S: Mat, Sig: Mat): { srmr: number; dULS: number; dG: number } {
  const p = S.length;
  let ss = 0, uls = 0;
  for (let i = 0; i < p; i++) for (let j = 0; j < p; j++) {
    const d = S[i][j] / Math.sqrt(S[i][i] * S[j][j]) - Sig[i][j] / Math.sqrt(Sig[i][i] * Sig[j][j]);
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
  const est = impliedIndicatorCor(m, R, st.loadings, impliedConstructCor(m, st.C, st.pathCoef, st.rSquared));
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
function excludedRSquared(m: CompiledModel, X: Float64Array[], opts: PlsOptions, C: number[][], from: number, to: number): number {
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

export { interactionName };

export interface PlsEstimate {
  m: CompiledModel;
  X: Float64Array[];
  core: CoreResult;
  st: ReturnType<typeof structural>;
  /** Stage-1 weights when the model has moderators (warm start for bootstrapping). */
  w1?: Float64Array;
}

/**
 * Compile a (possibly moderated) model and return an estimator that works on
 * raw, complete indicator columns. Moderation uses the two-stage approach
 * (Henseler & Chin 2010; as seminr and SmartPLS): stage 1 estimates the model
 * without interaction terms, the product of the standardised scores of the
 * predictor and the moderator becomes a single-indicator construct, and stage 2
 * estimates the full model.
 */
export function preparePls(data: Dataset, spec: ModelSpec, opts: PlsOptions) {
  const mods = spec.moderations ?? [];
  if (spec.constructs.some((c) => c.components?.length)) throw new Error('Higher-order constructs are supported in CB-SEM only.');
  if (mods.length && opts.consistent) throw new Error('Moderation is not yet supported with PLSc; switch consistent PLS off.');
  const m1 = compileModel({ constructs: spec.constructs, paths: spec.paths });
  const { cols, dropped } = extractColumns(data, m1, opts.missing);
  if (mods.length === 0) {
    const estimate = (c: Float64Array[], init?: { w2?: Float64Array }): PlsEstimate => {
      const X = standardizeColumns(c, m1.indicatorNames);
      const core = plsCore(X, m1, opts, init?.w2);
      return { m: m1, X, core, st: structural(m1, X, core, opts.consistent) };
    };
    return { m: m1, cols, dropped, estimate, moderations: [] as PlsResult['moderations'] };
  }
  const names = mods.map((mo) => interactionName(mo.from, mo.moderator));
  const pairs = mods.map((mo) => {
    const a = m1.constructs.indexOf(mo.from), b = m1.constructs.indexOf(mo.moderator);
    if (a < 0 || b < 0 || !m1.constructs.includes(mo.to)) throw new Error(`Moderation ${mo.moderator} on ${mo.from} → ${mo.to} references an unknown construct.`);
    if (!spec.paths.some((p) => p.from === mo.from && p.to === mo.to)) throw new Error(`${mo.moderator} moderates ${mo.from} → ${mo.to}, but that path is not in the model.`);
    return [a, b] as const;
  });
  const m2 = compileModel({
    constructs: [...spec.constructs, ...names.map((name) => ({ name, mode: 'A' as const, type: 'factor' as const, indicators: [name] }))],
    paths: [...spec.paths, ...mods.map((mo, i) => ({ from: names[i], to: mo.to }))],
  });
  const estimate = (c: Float64Array[], init?: { w1?: Float64Array; w2?: Float64Array }): PlsEstimate => {
    const X1 = standardizeColumns(c, m1.indicatorNames);
    const core1 = plsCore(X1, m1, opts, init?.w1);
    const products = pairs.map(([a, b]) => Float64Array.from(core1.scores[a], (v, r) => v * core1.scores[b][r]));
    const X = standardizeColumns([...c, ...products], m2.indicatorNames);
    const core = plsCore(X, m2, opts, init?.w2);
    const st = structural(m2, X, core, false);
    // Report interaction effects per unit of the product of standardised scores
    // (not of the re-standardised term), as seminr does: then the simple slope of
    // `from` at moderator level m (in SD) is β_from + β_int · m.
    products.forEach((prod, i) => {
      const k = m2.constructs.indexOf(names[i]);
      const s = sd(prod);
      st.pathCoef[k] = st.pathCoef[k].map((v) => v / s);
      st.totalEffects[k] = st.totalEffects[k].map((v) => v / s);
    });
    return { m: m2, X, core, st, w1: core1.w };
  };
  return { m: m2, cols, dropped, estimate, moderations: mods.map((mo, i) => ({ ...mo, construct: m2.constructs.indexOf(names[i]) })) };
}

export function estimatePls(data: Dataset, spec: ModelSpec, options: Partial<PlsOptions> = {}): PlsResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  if (opts.missing === 'fiml') throw new Error('FIML is a CB-SEM (lavaan) option; PLS uses mean replacement or casewise deletion.');
  const prep = preparePls(data, spec, opts);
  const dropped = prep.dropped;
  const n = prep.cols[0]?.length ?? 0;
  if (n < 3) throw new Error('Not enough complete observations to estimate the model.');
  const { m, X, core, st } = prep.estimate(prep.cols);
  const { C, pathCoef, rSquared, loadings, totalEffects } = st;
  const J = m.constructs.length;

  const adjRSquared = rSquared.map((r2, j) => (r2 === null ? null : 1 - ((1 - r2) * (n - 1)) / (n - m.preds[j].length - 1)));
  const indirectEffects = totalEffects.map((row, i) => row.map((v, j) => v - pathCoef[i][j]));

  const fSquare: (number | null)[][] = Array.from({ length: J }, () => new Array(J).fill(null));
  const vifInner: (number | null)[][] = Array.from({ length: J }, () => new Array(J).fill(null));
  for (let j = 0; j < J; j++) {
    const P = m.preds[j];
    if (P.length === 0) continue;
    const r2 = rSquared[j] as number;
    const vifs = vifDiag(P.map((a) => P.map((b) => C[a][b])));
    P.forEach((p, i) => {
      fSquare[p][j] = (r2 - excludedRSquared(m, X, opts, C, p, j)) / (1 - r2);
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
    fSquare,
    vifInner,
    vifOuter,
    scores: core.scores,
    droppedRows: dropped,
  };
}
