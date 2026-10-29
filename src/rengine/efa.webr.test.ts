// Exploratory factor analysis / PCA (psych) in webR equal psych in desktop R
// (scripts/validation/efa.R): the Big Five items (bfi; minres + oblimin and
// ML + varimax) and Harman.5 (?principal; PCA + varimax). Factor signs and
// order can differ between builds, so loadings are compared up to sign per
// factor. Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
    const r = await efaR(d, { ...DEFAULT_EFA, vars, nfactors: 5, method: 'minres', rotation: 'oblimin', parallel: 10 }, 1);
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
    const ml = await efaR(d, { ...DEFAULT_EFA, vars, nfactors: 5, method: 'ml', rotation: 'varimax', parallel: 0 }, 1);
    sameLoadings(ml.loadings, ref.bfi.ml.loadings, 4);
    expect(ml.fit.chisq).toBeCloseTo(ref.bfi.ml.chisq, 2);
    expect(ml.fit.df).toBe(ref.bfi.ml.df);
    expect(ml.fit.tli).toBeCloseTo(ref.bfi.ml.tli, 6);
    expect(ml.phi).toBeNull();
    expect(await efaScriptR(d, { ...DEFAULT_EFA, vars, nfactors: 5 }, 1)).toContain('fit <- fa(X, nfactors = 5, fm = "minres", rotate = "oblimin")');
  }, 900_000);

  it('Harman.5: principal components with varimax equal desktop psych', async () => {
    const d = await load('Harman.5');
    const r = await efaR(d, { ...DEFAULT_EFA, vars: d.names, nfactors: 2, method: 'pca', rotation: 'varimax', parallel: 0 }, 1);
    sameLoadings(r.loadings, ref.harman5.loadings, 8);
    r.cumulative.forEach((c, i) => expect(c).toBeCloseTo(ref.harman5.cumulative[i], 8));
    expect(r.factors).toEqual(['RC1', 'RC2']);
  }, 900_000);
});
