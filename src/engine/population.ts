// Population models for Monte Carlo studies. All variables are standardised.
//
// Common factor j: x = λ η + ε, Var ε = 1 − λ².
// Composite j (Dijkstra & Henseler's composite model): indicators with an
// unrestricted within-block correlation matrix Σ_jj (here: equal correlation
// r), η = wᵀx with wᵀΣ_jj w = 1; cross-block covariances Σ_jj w ρ wᵀ Σ_kk.
// Constructs: exogenous correlations as given; η_t = Σ β η_f + ζ_t with
// Var ζ_t = 1 − R²_t so every construct has unit variance.

import { cholesky, zeros, type Mat } from './linalg';
import { valeMaurelli, type ValeMaurelli } from './nonnormal';
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
  /** Overrides of the population-wide indicator skewness / excess kurtosis. */
  skew?: number;
  kurtosis?: number;
}

export interface PopulationSpec {
  constructs: PopConstruct[];
  paths: { from: string; to: string; value: number }[];
  /** Correlations between exogenous constructs (0 when omitted). */
  exoCor: { a: string; b: string; value: number }[];
  /** Indicator skewness and excess kurtosis (Vale–Maurelli); normal when both are 0 or omitted. */
  skew?: number;
  kurtosis?: number;
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
}

export function buildPopulation(pop: PopulationSpec): Population {
  const C = pop.constructs.map((c) => c.name);
  const J = C.length;
  const idx = new Map(C.map((n, i) => [n, i]));
  const B = zeros(J, J); // B[to][from]
  const specified = zeros(J, J).map((r) => r.map(() => false)); // [from][to]
  for (const p of pop.paths) {
    const f = idx.get(p.from),
      t = idx.get(p.to);
    if (f === undefined || t === undefined)
      throw new Error(`Population path ${p.from} → ${p.to} references an unknown construct.`);
    B[t][f] = p.value;
    specified[f][t] = true;
  }
  // A path with population value 0 is still part of the model (Type I error).
  const preds = C.map((_, t) => C.map((__, f) => f).filter((f) => specified[f][t]));
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
    const R = b.map((_, a) => b.map((__, d) => (a === d ? 1 : r)));
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
      else Sigma[i][k] = load[i] * Phi[a][b] * load[k];
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
  const vm =
    skew.some((v) => v !== 0) || kurt.some((v) => v !== 0) ? valeMaurelli(Sigma, skew, kurt) : null;
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
    covariances,
    vm,
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
    paths: pop.paths.map(({ from, to }) => ({ from, to })),
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
