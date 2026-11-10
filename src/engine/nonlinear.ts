// Nonlinear structural paths on PLS construct scores (after WarpPLS's warped relationships, Kock 2010):
// each endogenous construct regressed by OLS on polynomial terms of its predictors' scores (x, x², x³), and
// Kock's causality assessment indices from the linear path coefficients and construct correlations.
// Polynomials stand in for WarpPLS's own warping functions, which are not published in closed form.

import { invert, solve } from './linalg';
import { mean, tTestP } from './stats';

/** Shape of a path: straight, U-curve (x, x²) or S-curve (x, x², x³). */
export type PathShape = 'linear' | 'quadratic' | 'cubic';
export const SHAPE_POWER: Record<PathShape, number> = { linear: 1, quadratic: 2, cubic: 3 };

export interface PolyTerm { from: string; power: number; b: number; se: number; t: number; p: number }
export interface NonlinearEquation {
  to: string;
  intercept: number;
  terms: PolyTerm[];
  /** R² of the polynomial equation and of the linear one (the same predictors, power 1 only). */
  r2: number;
  r2Linear: number;
  n: number;
}

/** OLS with an intercept: coefficients, standard errors (σ̂² (XᵀX)⁻¹, df n − k − 1) and R². */
export function ols(y: ArrayLike<number>, X: ArrayLike<number>[]) {
  const n = y.length, cols = [Float64Array.from({ length: n }, () => 1), ...X];
  const k = cols.length;
  if (n <= k) throw new Error('Too few observations for the polynomial terms.');
  const XtX = cols.map((a) => cols.map((b) => { let s = 0; for (let r = 0; r < n; r++) s += a[r] * b[r]; return s; }));
  const Xty = cols.map((a) => { let s = 0; for (let r = 0; r < n; r++) s += a[r] * y[r]; return s; });
  const beta = solve(XtX, Xty);
  const my = mean(y);
  let sse = 0, sst = 0;
  for (let r = 0; r < n; r++) {
    const fit = cols.reduce((s, col, i) => s + beta[i] * col[r], 0);
    sse += (y[r] - fit) ** 2;
    sst += (y[r] - my) ** 2;
  }
  const df = n - k, inv = invert(XtX);
  const se = beta.map((_, i) => Math.sqrt((sse / df) * inv[i][i]));
  return { beta, se, r2: 1 - sse / sst, df };
}

/**
 * Each endogenous construct on the polynomial terms of its predictors: ŷ = b₀ + Σ_p Σ_{k ≤ K_p} b_pk x_pᵏ, with K_p the
 * power of the path's shape. `shape(from, to)` gives each path's shape. Scores are as estimated (standardised).
 */
export function nonlinearPaths(scores: Float64Array[], constructs: string[], hasPath: boolean[][], shape: (from: string, to: string) => PathShape): NonlinearEquation[] {
  const J = constructs.length;
  const out: NonlinearEquation[] = [];
  for (let j = 0; j < J; j++) {
    const P = Array.from({ length: J }, (_, i) => i).filter((i) => hasPath[i][j]);
    if (!P.length) continue;
    const spec = P.flatMap((i) => Array.from({ length: SHAPE_POWER[shape(constructs[i], constructs[j])] }, (_, q) => ({ i, power: q + 1 })));
    const X = spec.map(({ i, power }) => Float64Array.from(scores[i], (v) => v ** power));
    const fit = ols(scores[j], X);
    const lin = ols(scores[j], P.map((i) => scores[i]));
    out.push({
      to: constructs[j], intercept: fit.beta[0], r2: fit.r2, r2Linear: lin.r2, n: scores[j].length,
      terms: spec.map(({ i, power }, q) => {
        const b = fit.beta[q + 1], se = fit.se[q + 1], t = b / se;
        return { from: constructs[i], power, b, se, t, p: tTestP(Math.abs(t), fit.df) };
      }),
    });
  }
  return out;
}

/** The fitted curve of one predictor (the others at their mean, 0): points (x, ŷ) over [lo, hi]. */
export function pathCurve(eq: NonlinearEquation, from: string, lo: number, hi: number, steps = 60): [number, number][] {
  const own = eq.terms.filter((t) => t.from === from);
  return Array.from({ length: steps + 1 }, (_, s) => {
    const x = lo + ((hi - lo) * s) / steps;
    return [x, eq.intercept + own.reduce((a, t) => a + t.b * x ** t.power, 0)];
  });
}

export interface PathCausality { from: string; to: string; beta: number; r: number; contribution: number; simpson: boolean; suppression: boolean }
export interface CausalityIndices {
  paths: PathCausality[];
  /** Simpson's paradox ratio: share of paths whose coefficient and correlation have the same sign. */
  spr: number;
  /** R-squared contribution ratio: Σ positive contributions β·r / Σ |β·r|. */
  rscr: number;
  /** Statistical suppression ratio: share of paths with |β / r| ≤ 1.3. */
  ssr: number;
}

/**
 * Kock's causality assessment indices (Kock 2015, "How likely is Simpson's paradox in path models?", International
 * Journal of e-Collaboration 11(1), 1–7; Kock 2022, "Using causality assessment indices in PLS-SEM", Data Analysis
 * Perspectives Journal 3(5), 1–6; WarpPLS User Manual):
 * - a Simpson's paradox instance: a path coefficient and the correlation of the two linked variables of different signs;
 *   SPR = paths without one / all paths (acceptable ≥ 0.7, ideally 1);
 * - a predictor's R² contribution β·r (R² = Σ β_i r_iy); RSCR = Σ positive contributions / Σ |contributions|
 *   (acceptable ≥ 0.9, ideally 1);
 * - a (medium or greater) statistical suppression instance: |β / r| > 1.3; SSR = paths without one / all paths
 *   (acceptable ≥ 0.7).
 * Kock's fourth index, the nonlinear bivariate causality direction ratio (NLBCDR), compares coefficients of association
 * from all of WarpPLS's warping algorithms in both directions; those algorithms are not published in closed form, so it is
 * not computed here.
 */
export function causalityIndices(constructs: string[], hasPath: boolean[][], pathCoef: number[][], cor: number[][]): CausalityIndices {
  const paths: PathCausality[] = [];
  constructs.forEach((from, i) => constructs.forEach((to, j) => {
    if (!hasPath[i][j]) return;
    const beta = pathCoef[i][j], r = cor[i][j];
    paths.push({ from, to, beta, r, contribution: beta * r, simpson: beta * r < 0, suppression: Math.abs(r) > 0 ? Math.abs(beta / r) > 1.3 : beta !== 0 });
  }));
  const k = paths.length || 1;
  const abs = paths.reduce((s, p) => s + Math.abs(p.contribution), 0);
  return {
    paths,
    spr: paths.filter((p) => !p.simpson).length / k,
    rscr: abs > 0 ? paths.reduce((s, p) => s + Math.max(0, p.contribution), 0) / abs : 1,
    ssr: paths.filter((p) => !p.suppression).length / k,
  };
}
