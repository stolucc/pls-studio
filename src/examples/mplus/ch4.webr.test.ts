// Mplus User's Guide, chapter 4: the EFA examples in webR against what their Mplus outputs print
// (see testkit.ts; TYPE = EFA outputs are parsed per number of factors into `efa`). The EFA card's lavaan
// extraction gives the standardised rotated loadings, factor correlations and residual variances with their
// standard errors, and the fit of each number of factors. Factors come in another order and sign than
// Mplus's: they are matched first. Run with npm run test:webr.

import { afterAll, beforeAll, expect, it } from 'vitest';
import type { CbEstimator } from '../../engine/cbsem';
import { DEFAULT_EFA, type EfaDesign } from '../../model/efa';
import { DEFAULT_SETTINGS, toSpec } from '../../model/project';
import { efaR, efaScriptR, type EfaResult } from '../../rengine/efa';
import { estimateCbLavaan } from '../../rengine/lavaan';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { near, same } from '../../validation/record';
import { exampleModel } from '../packages';
import { evidence, example, load, MPLUS, sameFit, samePrinted, TOL } from './testkit';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

type Solution = { factors: number; fit: Record<string, number>; variables: string[]; loadings: number[][]; loadingsSE: number[][]; phi: number[][]; phiSE: number[][]; residual: number[]; residualSE: number[] };
const PRINTED = MPLUS as unknown as Record<string, { efa: { eigenvalues: number[]; solutions: Solution[] } }>;
const solution = (key: string, k: number) => PRINTED[key].efa.solutions.find((s) => s.factors === k)!;
/** Mplus's geomin ε by number of factors. */
const mplusEpsilon = (k: number) => (k <= 2 ? 0.0001 : k === 3 ? 0.001 : 0.01);

const design = (key: string, over: Partial<EfaDesign> = {}): EfaDesign => {
  const { kind: _k, ...preset } = example(key).panel as Extract<NonNullable<ReturnType<typeof example>['panel']>, { kind: 'efa' }>;
  return { ...DEFAULT_EFA, ...preset, ...over } as EfaDesign;
};
const permutations = (n: number): number[][] => (n <= 1 ? [[0]] : permutations(n - 1).flatMap((p) => Array.from({ length: n }, (_, i) => [...p.slice(0, i), n - 1, ...p.slice(i)])));
/** The app's factor (and its sign) for each of Mplus's: the order and reflection that best match the loadings. */
function match(got: number[][], want: number[][]) {
  const k = want[0].length;
  let best = { perm: [] as number[], sign: [] as number[], err: Infinity };
  for (const perm of permutations(k)) {
    const sign = perm.map((j, m) => (want.reduce((a, r, i) => a + r[m] * got[i][j], 0) < 0 ? -1 : 1));
    const err = want.reduce((a, r, i) => a + r.reduce((b, w, m) => b + (sign[m] * got[i][perm[m]] - w) ** 2, 0), 0);
    if (err < best.err) best = { perm, sign, err };
  }
  return best;
}
/** Tolerances; `se: null`: the standard errors of the loadings and factor correlations are not compared. */
type Tol = { loadings: number; se: number | null; phi: number; phiSe: number | null; residual: number; residualSe: number };
/** The solution against Mplus's printed one: loadings, factor correlations and residual variances with their standard errors. */
function sameSolution(r: EfaResult, want: Solution, tol: Tol) {
  expect(r.variables).toEqual(want.variables);
  const { perm, sign } = match(r.loadings, want.loadings);
  const k = want.factors;
  want.loadings.forEach((row, i) => row.forEach((w, m) => {
    near(`${want.variables[i]} on factor ${m + 1} (${k} factors)`, sign[m] * r.loadings[i][perm[m]], w, tol.loadings);
    if (tol.se !== null) near(`SE of ${want.variables[i]} on factor ${m + 1} (${k} factors)`, r.se!.loadings[i][perm[m]], want.loadingsSE[i][m], tol.se);
  }));
  for (let a = 1; a < k; a++) for (let b = 0; b < a; b++) {
    near(`factor correlation ${a + 1}, ${b + 1} (${k} factors)`, sign[a] * sign[b] * r.phi![perm[a]][perm[b]], want.phi[a][b], tol.phi);
    if (tol.phiSe !== null) near(`SE of factor correlation ${a + 1}, ${b + 1} (${k} factors)`, r.se!.phi![perm[a]][perm[b]], want.phiSE[a][b], tol.phiSe);
  }
  want.residual.forEach((w, i) => {
    near(`residual variance of ${want.variables[i]} (${k} factors)`, r.uniqueness[i], w, tol.residual);
    near(`SE of the residual variance of ${want.variables[i]} (${k} factors)`, r.se!.uniqueness[i], want.residualSE[i], tol.residualSe);
  });
}
/** The fit of each number of factors (Mplus's SUMMARY OF MODEL FIT INFORMATION and each solution's MODEL FIT). */
function sameComparison(r: EfaResult, key: string, chisqTol: number, logl: boolean, opts: { npar?: false; skip?: string[] } = {}) {
  for (const row of r.comparison!) {
    const f = solution(key, row.k).fit;
    if (opts.npar !== false) same(`free parameters (${row.k} factors)`, row.npar!, f.npar);
    same(`df (${row.k} factors)`, row.df!, f.df);
    near(`χ² (${row.k} factors)`, row.chisq!, f.chisq, chisqTol);
    if (logl) {
      near(`log-likelihood (${row.k} factors)`, row.logl!, f.logl, 0.002);
      near(`AIC (${row.k} factors)`, row.aic!, f.aic, 0.002);
      near(`BIC (${row.k} factors)`, row.bic!, f.bic, 0.002);
    }
    // (Mplus prints TLI at most 1)
    for (const m of ['rmsea', 'cfi', 'tli', 'srmr'] as const) if (f[m] !== undefined && !opts.skip?.includes(m)) near(`${m.toUpperCase()} (${row.k} factors)`, m === 'tli' ? Math.min(1, row[m]!) : row[m]!, f[m], TOL);
  }
}

const EXACT: Tol = { loadings: TOL, se: TOL, phi: TOL, phiSe: TOL, residual: TOL, residualSe: TOL };

it('ex4.1 part 1: the EFA card (lavaan) reproduces Mplus’s TYPE = EFA 1 4: the fit of each number of factors and every rotated solution', async () => {
  const key = 'ex4.1part1';
  evidence(key, 'EFA', ['lavaan']);
  const data = load(key);
  const d = design(key);
  expect(d.epsilon).toBe(mplusEpsilon(4));
  const r = await efaR(data, d, 1);
  expect(r.warnings).toEqual([]);
  expect(r.estimator).toBe('ML');
  expect(r.comparison!.map((x) => x.k)).toEqual([1, 2, 3, 4]);
  sameComparison(r, key, 0.002, true);
  PRINTED[key].efa.eigenvalues.forEach((e, i) => near(`eigenvalue ${i + 1}`, r.eigenvalues[i], e, TOL));
  sameSolution(r, solution(key, 4), EXACT);
  // The smaller solutions, each with Mplus's ε for its number of factors.
  for (const k of [1, 2, 3]) sameSolution(await efaR(data, { ...d, nfactors: k, from: k, epsilon: mplusEpsilon(k) }, 1), solution(key, k), EXACT);
}, 600_000);

it('ex4.2: binary items by WLSMV: the rotated solution within 0.002 of Mplus’s, its standard errors within 0.008, the χ² within 0.3%', async () => {
  const key = 'ex4.2';
  evidence(key, 'EFA', ['lavaan']);
  const r = await efaR(load(key), design(key), 1);
  expect(r.warnings).toEqual([]);
  expect(r.estimator).toBe('WLSMV');
  expect(r.ordinal).toEqual(design(key).vars);
  // lavaan's scaled-shifted χ² adjusts slightly differently from Mplus's (as in ex. 5.2): 729.259 against 730.699 with one
  // factor, 22.749 against 22.796 with four. Mplus counts the free parameters of a categorical EFA without the 12 thresholds
  // (42 with four factors; lavaan 54), and computes SRMR for categorical items differently (0.026 against 0.024).
  for (const row of r.comparison!) near(`χ² (${row.k} factors), relative`, row.chisq! / solution(key, row.k).fit.chisq, 1, 0.003);
  sameComparison(r, key, Infinity, false, { npar: false, skip: ['srmr'] });
  // The rotated loadings and factor correlations within 0.0011 (WLSMV); lavaan's standard errors up to 0.0065 larger than
  // Mplus's for the loadings and 0.008 for the residual variances (documented on the card).
  sameSolution(r, solution(key, 4), { loadings: 0.002, se: 0.007, phi: 0.002, phiSe: 0.007, residual: 0.002, residualSe: 0.009 });
}, 600_000);

it('ex4.7: bi-geomin EFA 2 3: the fit, the rotated solutions and the residual variances with their standard errors', async () => {
  const key = 'ex4.7';
  evidence(key, 'EFA', ['lavaan']);
  const data = load(key);
  const d = design(key);
  const r = await efaR(data, d, 1);
  expect(r.warnings).toEqual([]);
  expect(r.comparison!.map((x) => x.k)).toEqual([2, 3]);
  // SRMR: Mplus's EFA prints 0.014 and 0.007, its ESEM of the same model and data (ex. 5.29) 0.006, as lavaan (0.012, 0.006).
  sameComparison(r, key, 0.002, true, { skip: ['srmr'] });
  // lavaan's standard errors of the bi-geomin rotated loadings and factor correlation are not Mplus's (documented on the
  // card); those of the residual variances, which do not depend on the rotation, are.
  const tol: Tol = { loadings: TOL, se: null, phi: TOL, phiSe: null, residual: TOL, residualSe: TOL };
  sameSolution(r, solution(key, 3), tol);
  sameSolution(await efaR(data, { ...d, nfactors: 2, from: 2 }, 1), solution(key, 2), tol);
}, 600_000);

it('ex4.1 part 2: four exploratory factors as ESEM reproduce the Mplus output: fit, estimates and standard errors', async () => {
  const key = 'ex4.1part2';
  const ex = example(key);
  evidence(key, 'CB-SEM', ['lavaan']);
  const st = { ...DEFAULT_SETTINGS, ...ex.settings };
  const r = await estimateCbLavaan(load(key), toSpec(exampleModel(ex)), 'casewise', st.estimator as CbEstimator, 'product');
  expect(r.converged).toBe(true);
  sameFit(r.fit, MPLUS[key].fit);
  samePrinted(r.estimates, MPLUS[key].estimates, key);
}, 600_000);

it('the EFA card’s lavaan script carries the Mplus settings: ε, observed information, the range of factors', async () => {
  const s = await efaScriptR(load('ex4.1part1'), design('ex4.1part1'), 1);
  expect(s).toContain('efa(X, nfactors = m, rotation = list("geomin", geomin_epsilon = 0.01), estimator = "ML", meanstructure = TRUE, missing = "ml", information = "observed"');
  expect(s).toContain('seq(min(1, k), k)');
  const b = await efaScriptR(load('ex4.7'), design('ex4.7'), 1);
  expect(b).toContain('rotation = list("bigeomin", geomin_epsilon = 0.001)');
}, 600_000);
