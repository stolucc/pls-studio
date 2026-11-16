// Regression on composites, the benchmark of simulation studies of PLS: each
// construct is the sum of its standardised indicators (unit weights; Goodhue,
// Lewis & Thompson 2012; Rönkkö et al. 2016), and the paths are OLS
// regressions of the composites with the closed-form standard errors and a t
// test on n − k − 1 degrees of freedom. Disattenuated regression ("DR";
// Aguirre-Urreta, Rönkkö & McIntosh 2024) corrects the composite correlations
// of common factors for unreliability first: r / √(ω_i ω_j), ω the reliability
// of the unit-weighted composite from a one-factor MINRES solution of its block.
// R/mc.R does the same in R (reg_stats).

import { invert, solve, symEigen, zeros } from './linalg';
import { corStd, standardize, tTestP } from './stats';
import type { Dataset, ModelSpec } from './types';

export interface RegressionFit {
  constructs: string[];
  /** Composite correlations (DR: disattenuated) [J][J]. */
  C: number[][];
  /** Standardised paths [from][to], their standard errors and the residual degrees of freedom per endogenous construct. */
  paths: number[][];
  se: number[][];
  df: number[];
  /** Reliability of each composite (1: not corrected — composites, single indicators, plain regression). */
  reliability: number[];
  /** DR: a reliability outside (0, 1] or a corrected correlation beyond ±1. */
  admissible: boolean;
}

/**
 * One-factor loadings of a correlation matrix by iterated principal axis factoring, which converges to the
 * MINRES (unweighted least squares) solution: communalities start at the squared multiple correlations.
 */
export function minresLoadings(R: number[][]): number[] {
  const k = R.length;
  if (k === 1) return [1];
  let h: number[];
  try {
    const inv = invert(R);
    h = inv.map((row, i) => 1 - 1 / row[i]);
  } catch {
    h = new Array<number>(k).fill(0.5);
  }
  let lambda = new Array<number>(k).fill(0);
  for (let iter = 0; iter < 1000; iter++) {
    const reduced = R.map((row, i) => row.map((v, j) => (i === j ? h[i] : v)));
    const { values, vectors } = symEigen(reduced);
    let top = 0;
    values.forEach((v, i) => {
      if (v > values[top]) top = i;
    });
    const scale = Math.sqrt(Math.max(values[top], 0));
    lambda = vectors.map((row) => row[top] * scale);
    // (the sign of an eigenvector is arbitrary: positive loadings sum)
    if (lambda.reduce((s, v) => s + v, 0) < 0) lambda = lambda.map((v) => -v);
    const next = lambda.map((v) => v * v);
    const change = Math.max(...next.map((v, i) => Math.abs(v - h[i])));
    h = next;
    if (change < 1e-10) break;
  }
  return lambda;
}

/** Reliability (ω) of the unit-weighted sum of standardised indicators with these one-factor loadings. */
export function omegaUnit(lambda: number[]): number {
  const sum = lambda.reduce((s, v) => s + v, 0);
  const error = lambda.reduce((s, v) => s + (1 - v * v), 0);
  return (sum * sum) / (sum * sum + error);
}

/** Regression on unit-weighted composites (dr: disattenuated) for a replication's data. */
export function regressionFit(
  data: Dataset,
  spec: ModelSpec,
  missing: 'mean' | 'casewise',
  dr: boolean,
): RegressionFit {
  const constructs = spec.constructs.map((c) => c.name);
  const J = constructs.length;
  const used = spec.constructs.flatMap((c) => c.indicators);
  let cols = used.map((name) => {
    const i = data.names.indexOf(name);
    if (i < 0) throw new Error(`Indicator "${name}" is not in the data.`);
    return data.cols[i];
  });
  if (missing === 'casewise') {
    const keep = Array.from(cols[0].keys()).filter((r) => cols.every((c) => Number.isFinite(c[r])));
    cols = cols.map((c) => Float64Array.from(keep, (r) => c[r]));
  } else {
    cols = cols.map((c) => {
      const finite = Array.from(c).filter(Number.isFinite);
      const m = finite.reduce((s, v) => s + v, 0) / finite.length;
      return Float64Array.from(c, (v) => (Number.isFinite(v) ? v : m));
    });
  }
  const n = cols[0]?.length ?? 0;
  const Z = cols.map((c, i) => standardize(c, used[i]));
  const block = (j: number) => spec.constructs[j].indicators.map((name) => used.indexOf(name));
  // (standardised, as corStd expects)
  const composites = constructs.map((name, j) =>
    standardize(
      Float64Array.from({ length: n }, (__, r) => block(j).reduce((s, i) => s + Z[i][r], 0)),
      name,
    ),
  );
  const raw = composites.map((a) => composites.map((b) => corStd(a, b)));
  const reliability = constructs.map((_, j) => {
    const b = block(j);
    if (!dr || spec.constructs[j].type !== 'factor' || b.length < 2) return 1;
    const R = b.map((x) => b.map((y) => corStd(Z[x], Z[y])));
    return omegaUnit(minresLoadings(R));
  });
  let admissible = reliability.every((r) => r > 0 && r <= 1 + 1e-10);
  const C = raw.map((row, i) =>
    row.map((v, j) => (i === j ? 1 : v / Math.sqrt(reliability[i] * reliability[j]))),
  );
  if (C.some((row) => row.some((v) => Math.abs(v) > 1 + 1e-10))) admissible = false;

  const paths = zeros(J, J);
  const se = zeros(J, J).map((row) => row.map(() => NaN));
  const df = new Array<number>(J).fill(NaN);
  for (let t = 0; t < J; t++) {
    const P = spec.paths
      .filter((p) => p.to === constructs[t])
      .map((p) => constructs.indexOf(p.from));
    if (!P.length) continue;
    const Cpp = P.map((a) => P.map((b) => C[a][b]));
    const beta = solve(
      Cpp,
      P.map((a) => C[a][t]),
    );
    const r2 = beta.reduce((s, b, i) => s + b * C[P[i]][t], 0);
    const inv = invert(Cpp);
    df[t] = n - P.length - 1;
    P.forEach((f, i) => {
      paths[f][t] = beta[i];
      se[f][t] = Math.sqrt((Math.max(0, 1 - r2) / df[t]) * inv[i][i]);
    });
  }
  return { constructs, C, paths, se, df, reliability, admissible };
}

/** The two-sided t critical value for α on df degrees of freedom. */
export function tCrit(alpha: number, df: number): number {
  let lo = 0;
  let hi = 1000;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (tTestP(mid, df) > alpha) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
