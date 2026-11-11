// Exploratory factor analysis / PCA (psych) in webR equal psych in desktop R
// (scripts/validation/efa.R): the Big Five items (bfi; minres + oblimin and
// ML + varimax; principal axis + promax, scripts/validation/efa_pa.R) and Harman.5 (?principal; PCA + varimax). Factor signs and
// order can differ between builds, so loadings are compared up to sign per
// factor. Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { slowIt } from './webrSlow';
import type { Dataset } from '../engine/types';
import { DEFAULT_EFA } from '../model/efa';
import { rCall } from './bridge';
import { efaR, efaScriptR } from './efa';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const ref = JSON.parse(readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'efa', 'reference.json'), 'utf8'));
const load = async (name: string): Promise<Dataset> => {
  const raw = await rCall<{ names: string[]; cols: (number | null)[][] }>('ps_dataset', { package: 'psych', name, na: [] }, 'psych');
  return { names: raw.names, cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))) };
};
/** Loadings equal up to the sign of each factor. */
const sameLoadings = (got: number[][], want: number[][], digits: number) => {
  for (let j = 0; j < want[0].length; j++) {
    const s = Math.sign(got.reduce((a, r, i) => a + r[j] * want[i][j], 0)) || 1;
    want.forEach((r, i) => expect(s * got[i][j], `[${i},${j}]`).toBeCloseTo(r[j], digits));
  }
};

describe('exploratory factor analysis (psych)', () => {
  it('bfi: suitability, number of factors, minres + oblimin and ML + varimax equal desktop psych', async () => {
    const d = await load('bfi');
    const vars = d.names.slice(0, 25);
    const r = await efaR(d, { ...DEFAULT_EFA, criterion: 'fixed', vars, nfactors: 5, method: 'minres', rotation: 'oblimin', parallel: 10 }, 1);
    expect(r.n).toBe(ref.bfi.n);
    expect(r.kmo.overall).toBeCloseTo(ref.bfi.kmo, 8);
    expect(r.bartlett.chisq).toBeCloseTo(ref.bfi.bartlett, 4);
    r.eigenvalues.forEach((e, i) => expect(e).toBeCloseTo(ref.bfi.eigenvalues[i], 8));
    expect(r.map.values[0]).toBeCloseTo(ref.bfi.map[0], 6);
    sameLoadings(r.loadings, ref.bfi.minres.loadings, 4);
    r.communality.forEach((h, i) => expect(h).toBeCloseTo(ref.bfi.minres.communality[i], 6));
    expect(r.fit.rmsea).toBeCloseTo(ref.bfi.minres.rmsea, 6);
    expect(r.oblique).toBe(true);
    expect(r.phi).toHaveLength(5);
    expect(r.parallel?.observed).toHaveLength(25);
    // Item x item: residuals = observed - Λ Φ Λᵀ (off-diagonal), with the solution's own Λ and Φ.
    expect(r.correlations).toHaveLength(25);
    for (const [i, j] of [[0, 1], [3, 17], [24, 10]]) {
      let implied = 0;
      for (let a = 0; a < 5; a++) for (let b = 0; b < 5; b++) implied += r.loadings[i][a] * r.phi![a][b] * r.loadings[j][b];
      expect(r.residuals[i][j], `${i},${j}`).toBeCloseTo(r.correlations[i][j] - implied, 10);
    }
    expect(r.residuals[4][4]).toBe(0);
    const ml = await efaR(d, { ...DEFAULT_EFA, criterion: 'fixed', vars, nfactors: 5, method: 'ml', rotation: 'varimax', parallel: 0 }, 1);
    sameLoadings(ml.loadings, ref.bfi.ml.loadings, 4);
    expect(ml.fit.chisq).toBeCloseTo(ref.bfi.ml.chisq, 2);
    expect(ml.fit.df).toBe(ref.bfi.ml.df);
    expect(ml.fit.tli).toBeCloseTo(ref.bfi.ml.tli, 6);
    expect(ml.phi).toBeNull();
    expect(await efaScriptR(d, { ...DEFAULT_EFA, criterion: 'fixed', vars, nfactors: 5 }, 1)).toContain('fit <- fa(X, nfactors = k, fm = "minres", rotate = "oblimin")');
  }, 900_000);

  it('bfi: principal axis factoring (fm = "pa") with promax equals desktop psych', async () => {
    const pa = JSON.parse(readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'efa', 'pa.json'), 'utf8'));
    const d = await load('bfi');
    const r = await efaR(d, { ...DEFAULT_EFA, criterion: 'fixed', vars: d.names.slice(0, 25), nfactors: 5, method: 'pa', rotation: 'promax', parallel: 0 }, 1);
    sameLoadings(r.loadings, pa.loadings, 5);
    r.communality.forEach((h, i) => expect(h, `communality ${i + 1}`).toBeCloseTo(pa.communality[i], 6));
    expect(r.fit.rmsea, 'RMSEA').toBeCloseTo(pa.rmsea, 6);
    expect(r.fit.tli, 'TLI').toBeCloseTo(pa.tli, 6);
    expect(r.phi).toHaveLength(5);
  }, 900_000);

  it('Harman.5: principal components with varimax equal desktop psych', async () => {
    const d = await load('Harman.5');
    const r = await efaR(d, { ...DEFAULT_EFA, criterion: 'fixed', vars: d.names, nfactors: 2, method: 'pca', rotation: 'varimax', parallel: 0 }, 1);
    sameLoadings(r.loadings, ref.harman5.loadings, 8);
    r.cumulative.forEach((c, i) => expect(c).toBeCloseTo(ref.harman5.cumulative[i], 8));
    expect(r.factors).toEqual(['RC1', 'RC2']);
  }, 900_000);

  it('bfi: Tucker congruence of minres + oblimin with ML + varimax equals desktop psych (factor.congruence)', async () => {
    const cg = JSON.parse(readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'efa', 'congruence.json'), 'utf8'));
    const d = await load('bfi');
    const design = {
      ...DEFAULT_EFA,
      criterion: 'fixed' as const,
      vars: d.names.slice(0, 25),
      nfactors: 5,
      parallel: 0,
      compare: { method: 'ml' as const, rotation: 'varimax' as const },
    };
    const r = await efaR(d, design, 1);
    const got = r.congruence!;
    expect(got.method).toBe('ml');
    expect(got.factors).toHaveLength(5);
    // A factor's sign is arbitrary, so the coefficients are compared in absolute value. The oblimin loadings
    // come from GPArotation's iterative rotation, which lands within a few 1e-6 of itself from run to run in
    // the same desktop R (checked: fa(bfi[, 1:25], 5) twice differs by 2.8e-6), so 4 digits.
    cg.coefficients.forEach((row: number[], i: number) => row.forEach((v, j) => {
      expect(Math.abs(got.coefficients[i][j]), `φ[${i + 1},${j + 1}]`).toBeCloseTo(Math.abs(v), 4);
    }));
    sameLoadings(got.loadings, cg.loadings, 5);
    const script = await efaScriptR(d, design, 1);
    expect(script).toContain('fit2 <- fa(X, nfactors = k, fm = "ml", rotate = "varimax")');
    expect(script).toContain('congruence <- factor.congruence(fit, fit2, digits = 15)');
    const bad = { ...design, compare: { method: 'lavaan', rotation: 'varimax' } as never };
    await expect(efaR(d, bad, 1)).rejects.toThrow(/Invalid extraction for the comparison/);
  }, 900_000);

  it('retention criteria set the number of components in R (Kaiser, MAP, parallel analysis)', async () => {
    const d = await load('bfi');
    const vars = d.names.slice(0, 25);
    const base = { ...DEFAULT_EFA, vars, method: 'pca' as const, rotation: 'varimax' as const, parallel: 10 };
    const kaiser = await efaR(d, { ...base, criterion: 'kaiser' }, 1);
    expect(kaiser.criterion).toBe('kaiser');
    expect(kaiser.k).toBe(kaiser.eigenvalues.filter((e) => e > 1).length);
    expect(kaiser.k).toBe(ref.bfi.kaiser);
    expect(kaiser.factors).toHaveLength(kaiser.k);
    const map = await efaR(d, { ...base, criterion: 'map' }, 1);
    expect(map.k).toBe(map.map.suggested);
    expect(map.k).toBe(ref.bfi.mapK);
    const par = await efaR(d, { ...base, criterion: 'parallel' }, 1);
    expect(par.k).toBe(par.parallel!.suggested);
    expect(par.k).toBe(ref.bfi.parallelPc);  // same seed and samples as native psych
    expect(par.loadings[0]).toHaveLength(par.k);
    const script = await efaScriptR(d, { ...base, criterion: 'parallel' }, 1);
    expect(script).toContain('k <- parallel$ncomp  # retained by parallel analysis');
    expect(script).toContain('principal(X, nfactors = k, rotate = "varimax")');
    await expect(efaR(d, { ...base, criterion: 'parallel', parallel: 0 }, 1)).rejects.toThrow(/Parallel analysis needs samples/);
    await expect(efaR(d, { ...base, criterion: 'evil' as never }, 1)).rejects.toThrow(/Invalid criterion/);
  }, 900_000);

  // (slow: minutes in webR; run with WEBR_SLOW, as npm run validate:evidence does)
  slowIt('bfi with age: factor analysis of polychoric correlations equals desktop psych (cor = "mixed")', async () => {
    const pr = JSON.parse(readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'efa', 'polychoric.json'), 'utf8'));
    const d = await load('bfi');
    const r = await efaR(d, { ...DEFAULT_EFA, criterion: 'fixed', vars: pr.vars, nfactors: 5, method: 'minres', rotation: 'oblimin', parallel: 5, correlation: 'polychoric' }, 1);
    expect(r.correlation).toBe('polychoric');
    expect(r.ordinal).toEqual(pr.vars.slice(0, 25));  // age has more than 8 values: continuous (polyserial)
    for (let i = 0; i < 26; i++) for (let j = 0; j < 26; j++) expect(r.correlations[i][j]).toBeCloseTo(pr.cor[i][j], 6);
    expect(r.kmo.overall).toBeCloseTo(pr.kmo, 6);
    r.eigenvalues.forEach((e, i) => expect(e).toBeCloseTo(pr.eigenvalues[i], 6));
    sameLoadings(r.loadings, pr.loadings, 4);
    r.communality.forEach((h, i) => expect(h).toBeCloseTo(pr.communality[i], 5));
    r.parallel!.observed.forEach((e, i) => expect(e).toBeCloseTo(pr.parallelObserved[i], 5));
    // Independent: lavaan's polychoric correlations on the complete cases agree with psych's (polyserial ones less).
    const cc = pr.completeCases;
    for (let i = 0; i < 25; i++) for (let j = 0; j < 25; j++) expect(Math.abs(cc.psych[i][j] - cc.lavaan[i][j])).toBeLessThan(1e-4);
    // And the reason for the option: larger loadings than from Pearson correlations of the same items.
    expect(pr.meanTopLoading[0]).toBeGreaterThan(pr.meanTopLoading[1]);
    expect(await efaScriptR(d, { ...DEFAULT_EFA, criterion: 'fixed', vars: pr.vars, nfactors: 5, correlation: 'polychoric' }, 1)).toContain('fa(X, nfactors = k, fm = "minres", rotate = "oblimin", cor = "mixed")');
  }, 900_000);
});
