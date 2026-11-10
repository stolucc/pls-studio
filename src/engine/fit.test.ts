import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeSample } from '../sample';
import { toSpec } from '../model/project';
import { bootstrapCb, fitTestPls, rotateToImplied } from './bootstrap';
import { estimateCb } from './cbsem';
import { parseCsv } from './dataset';
import { estimatePls } from './pls';
import { corStd, standardize } from './stats';
import type { ModelSpec } from './types';
import { cases, loadData, toSpec as caseSpec } from './validationHarness';
import { near } from '../validation/record';

const data = parseCsv(readFileSync(join(__dirname, '__fixtures__', 'mobi.csv'), 'utf8')).dataset;
const items = (p: string, k: number) => Array.from({ length: k }, (_, i) => `${p}${i + 1}`);

describe('rotateToImplied', () => {
  it('produces data whose correlation matrix equals the target', () => {
    const names = items('IMAG', 4);
    const Z = names.map((nm) => standardize(data.cols[data.names.indexOf(nm)]));
    const R = Z.map((a) => Z.map((b) => corStd(a, b)));
    const target = R.map((row, i) => row.map((_v, j) => (i === j ? 1 : 0.4)));
    const Zs = rotateToImplied(Z, R, target).map((c) => standardize(c));
    Zs.forEach((a, i) => Zs.forEach((b, j) => expect(corStd(a, b)).toBeCloseTo(target[i][j], 10)));
    const notPD = target.map((row, i) => row.map((_v, j) => (i === j ? 1 : 0.99 * (i < 2 && j < 2 ? 1 : -1))));
    expect(() => rotateToImplied(Z, R, notPD)).toThrow(/not positive definite/);
  });
});

describe('fitTestPls (Dijkstra & Henseler 2015)', () => {
  it('does not reject exact fit for data generated from the model (PLSc on factors)', () => {
    const { data: d, model } = makeSample(400, 99);
    const res = fitTestPls(d, toSpec(model), { consistent: true }, { samples: 200, seed: 3 });
    expect(res.samples).toBeGreaterThan(190);
    for (const disc of ['srmr', 'dULS', 'dG'] as const) {
      expect(res.hi95.estimated[disc]).toBeLessThanOrEqual(res.hi99.estimated[disc]);
      expect(res.observed.estimated[disc]).toBeLessThan(res.hi99.estimated[disc]);
    }
    // Observed values equal the point estimate's fit.
    const est = estimatePls(d, toSpec(model), { consistent: true });
    expect(res.observed.estimated.srmr).toBeCloseTo(est.fit.estimated.srmr, 12);
  });

  it('rejects a clearly misspecified composite model', () => {
    const c = (name: string, ind: string[]) => ({ name, mode: 'B' as const, type: 'composite' as const, indicators: ind });
    const spec: ModelSpec = {
      constructs: [c('Image', items('IMAG', 5)), c('Expectation', items('CUEX', 3)), c('Satisfaction', items('CUSA', 3)), c('Loyalty', items('CUSL', 3))],
      // Image deliberately has no direct effect on Satisfaction or Loyalty.
      paths: [{ from: 'Image', to: 'Expectation' }, { from: 'Expectation', to: 'Satisfaction' }, { from: 'Satisfaction', to: 'Loyalty' }],
    };
    const res = fitTestPls(data, spec, {}, { samples: 200, seed: 5 });
    expect(res.observed.estimated.srmr).toBeGreaterThan(res.hi99.estimated.srmr);
    // The saturated model only restricts the measurement model and fits better.
    expect(res.observed.saturated.srmr).toBeLessThan(res.observed.estimated.srmr);
  });
});

// Against cSEM::testOMF (scripts/validation/fit_test.R): the observed discrepancies exactly, and the 95% and 99% quantiles of
// the bootstrap under the null within Monte Carlo error (2,000 samples on each side, different random numbers).
describe('fitTestPls against cSEM::testOMF (threecommonfactors, PLS)', () => {
  it('testOMF: the same observed discrepancies, and quantiles within Monte Carlo error', () => {
    const ref = JSON.parse(readFileSync(join(__dirname, '__fixtures__', 'fittest', 'threecf.json'), 'utf8')) as Record<'observed' | 'hi95' | 'hi99', Record<'srmr' | 'dULS' | 'dG', number>>;
    const c = cases.find((x) => x.name === 'pls_csem_threecommonfactors')!;
    const r = fitTestPls(loadData(c), caseSpec(c), { consistent: false }, { samples: 2000, seed: 1 });
    expect(r.samples).toBe(2000);
    for (const d of ['srmr', 'dULS', 'dG'] as const) {
      near(`observed ${d}`, r.observed.estimated[d], ref.observed[d], 1e-6);
      near(`95% quantile of ${d} (within 3%)`, r.hi95.estimated[d], ref.hi95[d], 0.03 * ref.hi95[d]);
      near(`99% quantile of ${d} (within 5%)`, r.hi99.estimated[d], ref.hi99[d], 0.05 * ref.hi99[d]);
    }
  });
});

describe('bootstrapCb', () => {
  const f = (name: string, ind: string[]) => ({ name, mode: 'A' as const, type: 'factor' as const, indicators: ind });
  const spec: ModelSpec = {
    constructs: [f('Image', items('IMAG', 5)), f('Quality', items('PERQ', 7)), f('Satisfaction', items('CUSA', 3)), f('Value', items('PERV', 2))],
    paths: [['Quality', 'Value'], ['Image', 'Satisfaction'], ['Quality', 'Satisfaction'], ['Value', 'Satisfaction']].map(([from, to]) => ({ from, to })),
  };
  const res = bootstrapCb(data, spec, 'casewise', { samples: 150, seed: 11, confidence: 0.95 });
  const ml = estimateCb(data, spec);

  it('reports standardised originals equal to the ML solution', () => {
    const s = res.stats.find((x) => x.key === 'path:Quality:Satisfaction')!;
    expect(s.original).toBeCloseTo(ml.stdPaths[1][2], 10);
    expect(s.ciLow).toBeLessThan(s.original);
    expect(s.ciHigh).toBeGreaterThan(s.original);
  });

  it('includes indirect effects through the mediator', () => {
    const ind = res.stats.find((x) => x.key === 'indirect:Quality:Satisfaction')!;
    expect(ind.original).toBeCloseTo(ml.stdIndirect[1][2], 10);
    expect(ind.sd).toBeGreaterThan(0);
  });

  it('is reproducible', () => {
    const again = bootstrapCb(data, spec, 'casewise', { samples: 150, seed: 11, confidence: 0.95 });
    expect(again.stats.map((x) => x.sd)).toEqual(res.stats.map((x) => x.sd));
  });
});
