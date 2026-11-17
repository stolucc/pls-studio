// Population models for Monte Carlo studies. All variables are standardised.
//
// Common factor j: x = λ η + ε, Var ε = 1 − λ².
// Composite j (Dijkstra & Henseler's composite model): indicators with an
// unrestricted within-block correlation matrix Σ_jj (here: equal correlation
// r), η = wᵀx with wᵀΣ_jj w = 1; cross-block covariances Σ_jj w ρ wᵀ Σ_kk.
// Constructs: exogenous correlations as given; η_t = Σ β η_f + ζ_t with
// Var ζ_t = 1 − R²_t so every construct has unit variance.

import { cholesky, solve, zeros, type Mat } from './linalg';
import { fleishman, valeMaurelli, type ValeMaurelli } from './nonnormal';
import { mulberry32 } from './stats';
import type { ConstructType, Dataset, ModelSpec } from './types';

export interface PopConstruct {
  name: string;
  type: ConstructType;
  indicators: string[];
  /** Common factors: standardised loadings, one per indicator. */
  loadings?: number[];
  /** Composites: relative weights (rescaled so the composite has unit variance). */
  weights?: number[];
  /** Composites: equal correlation among the block's indicators. */
  withinCor?: number;
  /** Composites: the full correlation matrix of the block's indicators, in place of withinCor. */
  withinMatrix?: number[][];
  /** Overrides of the population-wide indicator skewness / excess kurtosis. */
  skew?: number;
  kurtosis?: number;
}

export interface PopulationSpec {
  constructs: PopConstruct[];
  /** Structural paths; `omitted`: in the population but left out of the model the replications are estimated with. */
  paths: { from: string; to: string; value: number; omitted?: boolean }[];
  /** Correlations between exogenous constructs (0 when omitted). */
  exoCor: { a: string; b: string; value: number }[];
  /** Indicator skewness and excess kurtosis (Vale–Maurelli); normal when both are 0 or omitted. */
  skew?: number;
  kurtosis?: number;
  /**
   * How non-normal indicators are generated: 'vale-maurelli' (the default) keeps the population correlations;
   * 'fleishman' applies Fleishman's polynomial to each indicator of multivariate normal data without correcting
   * the correlations, as Goodhue et al. (2012, Appendix D) did, which lowers them.
   */
  nonnormal?: 'vale-maurelli' | 'fleishman';
  /** Misspecification: a common-factor indicator also loading on another construct (standardised), not estimated. */
  crossLoadings?: { indicator: string; construct: string; value: number }[];
  /** Misspecification: correlations between the errors of two common-factor indicators, not estimated. */
  errorCors?: { a: string; b: string; value: number }[];
}

export interface Population {
  names: string[];
  Sigma: Mat;
  /** Population construct correlation matrix. */
  Phi: Mat;
  constructs: string[];
  /** True standardised path coefficients [from][to]. */
  paths: number[][];
  /** Paths in the model [from][to], including those with population value 0. */
  specified: boolean[][];
  /** True standardised indirect effects [from][to]. */
  indirect: number[][];
  r2: (number | null)[];
  /** Marker (first-indicator) loading or composite loading, for CB-SEM's unstandardised metric. */
  markerLoading: number[];
  /** Correlations between exogenous constructs that the specification gives (zero ones included), as [a, b] indices. */
  covariances: { a: number; b: number; value: number }[];
  /** Non-normal generation (null: multivariate normal). */
  vm: ValeMaurelli | null;
  /** The estimated model differs from the population (cross-loadings, error correlations, omitted paths). */
  misspecified: boolean;
  /** Indicator indices (into names) of each construct's block. */
  blocks: number[][];
  /** Common-factor constructs (false: composites). */
  factor: boolean[];
  /** Covariances of the indicators with the constructs, ΛΦ [indicator][construct] (constructs have variance 1). */
  indicatorCov: Mat;
}

export function buildPopulation(pop: PopulationSpec): Population {
  const C = pop.constructs.map((c) => c.name);
  const J = C.length;
  const idx = new Map(C.map((n, i) => [n, i]));
  const B = zeros(J, J); // B[to][from]
  const inPopulation = zeros(J, J).map((r) => r.map(() => false)); // [from][to]
  const specified = zeros(J, J).map((r) => r.map(() => false)); // [from][to]: estimated
  for (const p of pop.paths) {
    const f = idx.get(p.from),
      t = idx.get(p.to);
    if (f === undefined || t === undefined)
      throw new Error(`Population path ${p.from} → ${p.to} references an unknown construct.`);
    B[t][f] = p.value;
    inPopulation[f][t] = true;
    if (!p.omitted) specified[f][t] = true;
  }
  // A path with population value 0 is still part of the model (Type I error).
  const preds = C.map((_, t) => C.map((__, f) => f).filter((f) => inPopulation[f][t]));
  const exo = preds.map((P) => P.length === 0);

  // Topological order.
  const order: number[] = [];
  const state = new Array<number>(J).fill(0);
  const visit = (j: number) => {
    if (state[j] === 2) return;
    if (state[j] === 1) throw new Error('The population structural model contains a cycle.');
    state[j] = 1;
    preds[j].forEach(visit);
    state[j] = 2;
    order.push(j);
  };
  C.forEach((_, j) => visit(j));

  const Phi = zeros(J, J);
  for (let j = 0; j < J; j++) Phi[j][j] = 1;
  const covariances: Population['covariances'] = [];
  for (const r of pop.exoCor) {
    const a = idx.get(r.a),
      b = idx.get(r.b);
    if (a === undefined || b === undefined || !exo[a] || !exo[b] || a === b) continue;
    Phi[a][b] = Phi[b][a] = r.value;
    covariances.push({ a, b, value: r.value });
  }
  const r2: (number | null)[] = new Array(J).fill(null);
  const done: number[] = [];
  for (const t of order) {
    if (!exo[t]) {
      // cov(η_t, η_k) = Σ_f β_tf cov(η_f, η_k) for constructs already placed.
      for (const k of done) {
        const v = preds[t].reduce((s, f) => s + B[t][f] * Phi[f][k], 0);
        Phi[t][k] = Phi[k][t] = v;
      }
      const R2 = preds[t].reduce((s, f) => s + B[t][f] * Phi[f][t], 0);
      if (!(R2 < 1)) throw new Error(`Population paths imply R² ≥ 1 for "${C[t]}".`);
      r2[t] = R2;
    }
    done.push(t);
  }

  // Indicator-level covariance matrix.
  const names: string[] = [];
  const ofC: number[] = [];
  const blocks: number[][] = pop.constructs.map((c, j) =>
    c.indicators.map((name) => {
      names.push(name);
      ofC.push(j);
      return names.length - 1;
    }),
  );
  /** Per indicator: factor loading, or for composites corr(x, η) = (Σ_jj w)ᵢ. */
  const load = new Array<number>(names.length).fill(0);
  const within: (Mat | null)[] = pop.constructs.map((c, j) => {
    const b = blocks[j];
    if (c.type === 'factor') {
      const l = c.loadings ?? b.map(() => 0.8);
      if (l.length !== b.length) throw new Error(`"${c.name}" needs one loading per indicator.`);
      if (l.some((v) => !(Math.abs(v) < 1)))
        throw new Error(`Loadings of "${c.name}" must lie strictly between −1 and 1.`);
      b.forEach((k, a) => (load[k] = l[a]));
      return null;
    }
    const r = c.withinCor ?? 0.5;
    const R = c.withinMatrix ?? b.map((_, a) => b.map((__, d) => (a === d ? 1 : r)));
    if (c.withinMatrix) checkWithinMatrix(c.name, c.withinMatrix, b.length);
    const w0 = c.weights ?? b.map(() => 1);
    if (w0.length !== b.length) throw new Error(`"${c.name}" needs one weight per indicator.`);
    let v = 0;
    for (let a = 0; a < b.length; a++)
      for (let d = 0; d < b.length; d++) v += w0[a] * R[a][d] * w0[d];
    if (!(v > 0)) throw new Error(`Weights of "${c.name}" give a composite with zero variance.`);
    const w = w0.map((x) => x / Math.sqrt(v));
    // Composite loadings: corr(x, η) = Σ_jj w.
    b.forEach((k, a) => (load[k] = R[a].reduce((s, rv, d) => s + rv * w[d], 0)));
    return R;
  });
  const p = names.length;
  // Λ: each indicator's loading on its construct (for a composite indicator corr(x, η)), plus cross-loadings.
  const Lambda = names.map((_, i) => C.map((__, j) => (j === ofC[i] ? load[i] : 0)));
  const indicatorIndex = (name: string, what: string) => {
    const i = names.indexOf(name);
    if (i < 0) throw new Error(`${what} names an unknown indicator "${name}".`);
    if (within[ofC[i]])
      throw new Error(
        `${what}: "${name}" is a composite indicator; only common-factor indicators can have one.`,
      );
    return i;
  };
  for (const x of pop.crossLoadings ?? []) {
    const i = indicatorIndex(x.indicator, 'A cross-loading');
    const j = idx.get(x.construct);
    if (j === undefined)
      throw new Error(`A cross-loading names an unknown construct "${x.construct}".`);
    if (j === ofC[i]) throw new Error(`"${x.indicator}" already loads on "${x.construct}".`);
    Lambda[i][j] += x.value;
  }
  // Common variance (ΛΦΛ')ᵢᵢ of factor indicators; the error variance makes each variance 1.
  const common = (i: number, k: number) => {
    let v = 0;
    for (let a = 0; a < J; a++) {
      if (!Lambda[i][a]) continue;
      for (let b = 0; b < J; b++) v += Lambda[i][a] * Phi[a][b] * Lambda[k][b];
    }
    return v;
  };
  const theta = names.map((name, i) => {
    if (within[ofC[i]]) return 0;
    const t = 1 - common(i, i);
    if (!(t > 0))
      throw new Error(
        `The loadings of "${name}" leave it no error variance: lower its (cross-)loadings.`,
      );
    return t;
  });
  const errorCov = zeros(p, p);
  for (const r of pop.errorCors ?? []) {
    const i = indicatorIndex(r.a, 'An error correlation');
    const k = indicatorIndex(r.b, 'An error correlation');
    if (i === k) throw new Error(`An error correlation needs two different indicators ("${r.a}").`);
    errorCov[i][k] = errorCov[k][i] = r.value * Math.sqrt(theta[i] * theta[k]);
  }
  const Sigma = zeros(p, p);
  for (let i = 0; i < p; i++)
    for (let k = 0; k < p; k++) {
      if (i === k) {
        Sigma[i][k] = 1;
        continue;
      }
      const a = ofC[i],
        b = ofC[k];
      if (a === b && within[a])
        Sigma[i][k] = within[a]![blocks[a].indexOf(i)][blocks[a].indexOf(k)];
      else Sigma[i][k] = common(i, k) + errorCov[i][k];
    }
  if (!cholesky(Sigma))
    throw new Error(
      'The population covariance matrix is not positive definite; check loadings, weights and paths.',
    );

  const paths = zeros(J, J);
  for (let f = 0; f < J; f++) for (let t = 0; t < J; t++) paths[f][t] = B[t][f];
  // Total effects T = B + B² + … in [from][to] orientation; indirect = T − B.
  const total = paths.map((r) => r.slice());
  let power = paths.map((r) => r.slice());
  for (let s = 1; s < J; s++) {
    const next = zeros(J, J);
    for (let i = 0; i < J; i++)
      for (let k = 0; k < J; k++)
        if (power[i][k]) for (let j = 0; j < J; j++) next[i][j] += power[i][k] * paths[k][j];
    power = next;
    for (let i = 0; i < J; i++) for (let j = 0; j < J; j++) total[i][j] += power[i][j];
  }
  const indirect = total.map((r, i) => r.map((v, j) => v - paths[i][j]));
  // Per-indicator distribution: construct overrides, else the population-wide values.
  const skew = ofC.map((j) => pop.constructs[j].skew ?? pop.skew ?? 0);
  const kurt = ofC.map((j) => pop.constructs[j].kurtosis ?? pop.kurtosis ?? 0);
  const nonnormal = skew.some((v) => v !== 0) || kurt.some((v) => v !== 0);
  let vm: ValeMaurelli | null = null;
  if (nonnormal && pop.nonnormal === 'fleishman')
    vm = { coef: skew.map((v, i) => fleishman(v, kurt[i])), L: cholesky(Sigma)! };
  else if (nonnormal) vm = valeMaurelli(Sigma, skew, kurt);
  return {
    names,
    Sigma,
    Phi,
    constructs: C,
    paths,
    specified,
    indirect,
    r2,
    markerLoading: blocks.map((b) => load[b[0]]),
    blocks,
    factor: pop.constructs.map((c) => c.type === 'factor'),
    indicatorCov: names.map((_, i) =>
      C.map((__, j) => Lambda[i].reduce((s, l, a) => s + l * Phi[a][j], 0)),
    ),
    covariances,
    vm,
    misspecified:
      (pop.crossLoadings ?? []).some((x) => x.value !== 0) ||
      (pop.errorCors ?? []).some((r) => r.value !== 0) ||
      pop.paths.some((x) => x.omitted),
  };
}

/** Model specification matching a population (for estimating simulated data). */
export function specFromPopulation(pop: PopulationSpec, as?: ConstructType): ModelSpec {
  return {
    constructs: pop.constructs.map((c) => {
      const type = as ?? c.type;
      return {
        name: c.name,
        indicators: c.indicators,
        type,
        mode: type === 'composite' ? 'B' : 'A',
      };
    }),
    paths: pop.paths.filter((x) => !x.omitted).map(({ from, to }) => ({ from, to })),
  };
}

/** Standard normal draws (Box–Muller) from a seeded generator. */
export function normalRng(seed: number): () => number {
  const u = mulberry32(seed);
  let spare: number | null = null;
  return () => {
    if (spare !== null) {
      const s = spare;
      spare = null;
      return s;
    }
    const a = 1 - u(),
      b = u();
    const r = Math.sqrt(-2 * Math.log(a));
    spare = r * Math.sin(2 * Math.PI * b);
    return r * Math.cos(2 * Math.PI * b);
  };
}

/** Draw n observations with covariance Σ: multivariate normal, or Vale–Maurelli non-normal. */
export function generateData(population: Population, n: number, seed: number): Dataset {
  const vm = population.vm;
  const L = vm ? vm.L : cholesky(population.Sigma)!;
  const p = L.length;
  const rnd = normalRng(seed);
  const cols = Array.from({ length: p }, () => new Float64Array(n));
  const z = new Float64Array(p);
  for (let r = 0; r < n; r++) {
    for (let k = 0; k < p; k++) z[k] = rnd();
    for (let i = 0; i < p; i++) {
      let s = 0;
      for (let k = 0; k <= i; k++) s += L[i][k] * z[k];
      if (vm) {
        const f = vm.coef[i];
        s = f.a + s * (f.b + s * (f.c + s * f.d));
      }
      cols[i][r] = s;
    }
  }
  return { names: population.names, cols };
}

// The reliability of a composite as the simulation studies of PLS measure it
// (Rönkkö & Evermann 2013; Rönkkö, McIntosh, Antonakis & Edwards 2016): the
// squared correlation of the weighted sum of a construct's standardised
// indicators with the construct itself, here from the population moments, so
// that it depends only on the weights: (w′a)² / (w′Sw), a = cov(x, η) of the
// block, S its covariance matrix. Ideal weights (S⁻¹a, the regression of η on
// the block) give the largest reliability possible, a′S⁻¹a; unit weights the
// sum score's.

/** The block's covariance matrix and covariances with construct j. */
export function blockMoments(pop: Population, j: number): { a: number[]; S: Mat } {
  const b = pop.blocks[j];
  return {
    a: b.map((i) => pop.indicatorCov[i][j]),
    S: b.map((i) => b.map((k) => pop.Sigma[i][k])),
  };
}

/** A composite's indicator correlation matrix: square, one row per indicator, symmetric, 1 on the diagonal. */
function checkWithinMatrix(name: string, R: number[][], k: number) {
  const square = R.length === k && R.every((row) => row.length === k);
  if (!square) throw new Error(`"${name}" needs a ${k} × ${k} indicator correlation matrix.`);
  for (let a = 0; a < k; a++)
    for (let d = 0; d < k; d++) {
      const ok = a === d ? R[a][d] === 1 : Math.abs(R[a][d]) < 1 && R[a][d] === R[d][a];
      if (!ok)
        throw new Error(
          `The indicator correlation matrix of "${name}" must be symmetric with 1 on the diagonal.`,
        );
    }
}

/** Reliability of construct j's composite with weights w (in the order of its block). */
export function compositeReliability(pop: Population, j: number, w: number[]): number {
  const { a, S } = blockMoments(pop, j);
  const cov = w.reduce((s, v, i) => s + v * a[i], 0);
  let variance = 0;
  w.forEach((v, i) => w.forEach((u, k) => (variance += v * S[i][k] * u)));
  return variance > 0 ? (cov * cov) / variance : NaN;
}

/** The largest reliability any weights give construct j's composite (ideal weights S⁻¹a). */
export function idealReliability(pop: Population, j: number): number {
  const { a, S } = blockMoments(pop, j);
  return solve(S, a).reduce((s, v, i) => s + v * a[i], 0);
}

/** Reliability of construct j's sum score (unit weights). */
export const unitReliability = (pop: Population, j: number) =>
  compositeReliability(
    pop,
    j,
    pop.blocks[j].map(() => 1),
  );

/** The population's inputs to the measurement checks (mcValidity.ts): loadings are indicator–construct correlations. */
export function populationValidityInputs(pop: Population) {
  const own = new Array<number>(pop.names.length).fill(NaN);
  pop.blocks.forEach((b, j) => b.forEach((i) => (own[i] = pop.indicatorCov[i][j])));
  return {
    constructs: pop.constructs,
    blocks: pop.blocks,
    factor: pop.factor,
    loadings: own,
    C: pop.Phi,
    R: pop.Sigma,
    r2: pop.r2,
    cross: pop.indicatorCov,
    boot: 'population' as const,
    factorTests: 'population' as const,
  };
}
