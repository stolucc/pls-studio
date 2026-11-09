// Gaussian copula terms in a PLS-SEM model, against plain seminr calls and
// nortest::cvm.test (scripts/validation/copula.R).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bootstrapPls } from './bootstrap';
import { parseCsv } from './dataset';
import { estimatePls, preparePls } from './pls';
import { cramerVonMises, pStar } from './stats';
import { copulaName, DEFAULT_OPTIONS, type Dataset, type ModelSpec } from './types';

const fx = join(__dirname, '__fixtures__');
const ref = JSON.parse(readFileSync(join(fx, 'copula', 'reference.json'), 'utf8'));
const mobi = (): Dataset => parseCsv(readFileSync(join(fx, 'mobi.csv'), 'utf8')).dataset;
const K = (name: string, n: number) => ({ name, mode: 'A' as const, type: 'factor' as const, indicators: Array.from({ length: n }, (_, i) => `${name}${i + 1}`) });
const spec: ModelSpec = {
  constructs: [K('CUEX', 3), K('PERQ', 7), K('CUSA', 3), K('CUSL', 3)],
  paths: [{ from: 'CUEX', to: 'CUSA' }, { from: 'PERQ', to: 'CUSA' }, { from: 'CUSA', to: 'CUSL' }],
  copulas: [{ from: 'CUEX', to: 'CUSA' }, { from: 'PERQ', to: 'CUSA' }],
};
const path = (r: ReturnType<typeof estimatePls>, from: string, to: string) => r.pathCoef[r.constructs.indexOf(from)][r.constructs.indexOf(to)];

describe('Gaussian copula term P*', () => {
  it('matches the control function on the stage 1 scores', () => {
    const noTerms = estimatePls(mobi(), { ...spec, copulas: [] });
    const scores = noTerms.scores[noTerms.constructs.indexOf('CUEX')];
    Array.from(pStar(scores)).slice(0, 10).forEach((v, i) => expect(v).toBeCloseTo(ref.pstarHead[i], 8));
  });
  it('is finite at the largest value and with ties', () => {
    const s = pStar(Float64Array.from([1, 2, 2, 3]));
    expect(Array.from(s).every(Number.isFinite)).toBe(true);
    expect(s[1]).toBe(s[2]);
  });
});

describe('Cramér–von Mises normality test', () => {
  it.each(Object.keys(ref.cvm))('matches nortest::cvm.test (%s)', (k) => {
    const r = cramerVonMises(Float64Array.from(ref.cvm[k].x));
    expect(r.statistic).toBeCloseTo(ref.cvm[k].statistic, 8);
    expect(r.p).toBeCloseTo(ref.cvm[k].p, 8);
  });
  it('covers every branch of the p-value', () => {
    const wws = Object.values(ref.cvm as Record<string, { statistic: number; x: number[] }>).map((v) => v.statistic * (1 + 0.5 / v.x.length));
    expect(wws.some((w) => w < 0.0275)).toBe(true);
    expect(wws.some((w) => w >= 0.051 && w < 0.092)).toBe(true);
    expect(wws.some((w) => w >= 0.092)).toBe(true);
  });
  it('needs at least eight observations, as nortest does', () => {
    expect(() => cramerVonMises(Float64Array.from([1, 2, 3]))).toThrow(/eight/);
  });
});

describe('PLS-SEM with Gaussian copula terms', () => {
  const r = estimatePls(mobi(), spec);
  it('reproduces the two-stage estimates of plain seminr calls', () => {
    expect(r.n).toBe(ref.n);
    expect(path(r, 'CUEX', 'CUSA')).toBeCloseTo(ref.paths.CUEX_CUSA, 3);
    expect(path(r, 'PERQ', 'CUSA')).toBeCloseTo(ref.paths.PERQ_CUSA, 3);
    expect(path(r, copulaName('CUEX', 'CUSA'), 'CUSA')).toBeCloseTo(ref.paths.GC_CUEX_CUSA, 3);
    expect(path(r, copulaName('PERQ', 'CUSA'), 'CUSA')).toBeCloseTo(ref.paths.GC_PERQ_CUSA, 3);
    expect(path(r, 'CUSA', 'CUSL')).toBeCloseTo(ref.paths.CUSA_CUSL, 3);
    expect(r.rSquared[r.constructs.indexOf('CUSA')]).toBeCloseTo(ref.r2, 3);
  });
  it('reports each term with the normality test of its predictor', () => {
    expect(r.copulas!.map((k) => [k.from, k.to, r.constructs[k.construct]])).toEqual([
      ['CUEX', 'CUSA', copulaName('CUEX', 'CUSA')], ['PERQ', 'CUSA', copulaName('PERQ', 'CUSA')]]);
    const cuex = r.scores[r.constructs.indexOf('CUEX')];
    expect(r.copulas![0].normality.p).toBeCloseTo(cramerVonMises(cuex).p, 10);
  });
  it('leaves a model without terms alone', () => {
    const plain = estimatePls(mobi(), { ...spec, copulas: undefined });
    expect(plain.copulas).toEqual([]);
    expect(plain.constructs).toEqual(['CUEX', 'PERQ', 'CUSA', 'CUSL']);
  });
  it('recomputes P* in every bootstrap sample', () => {
    const b = bootstrapPls(mobi(), spec, {}, { samples: 40, seed: 7, confidence: 0.95 });
    const s = b.stats.find((x) => x.key === `path:${copulaName('CUEX', 'CUSA')}:CUSA`)!;
    expect(s.sd).toBeGreaterThan(0);
    expect(s.mean).not.toBeCloseTo(path(r, copulaName('CUEX', 'CUSA'), 'CUSA'), 8);
    // Each resample's own stage 1: a term from the original scores would be fixed-regressor bootstrapping.
    const prep = preparePls(mobi(), spec, DEFAULT_OPTIONS);
    expect(prep.copulas).toHaveLength(2);
  });
  it('refuses consistent PLS and a path that is not in the model', () => {
    expect(() => estimatePls(mobi(), spec, { consistent: true })).toThrow(/PLSc/);
    expect(() => estimatePls(mobi(), { ...spec, copulas: [{ from: 'CUSL', to: 'CUEX' }] })).toThrow(/not in the model/);
  });
});

describe('the example card', () => {
  it('states what plain seminr calls give, and builds its terms on the paths', async () => {
    const { exampleModel, PACKAGE_EXAMPLES } = await import('../examples/packages');
    const { toSpec } = await import('../model/project');
    const ex = PACKAGE_EXAMPLES.find((e) => e.id === 'seminr-copula')!;
    expect(ex.shows).toContain(ref.paths.GC_CUEX_CUSA.toFixed(3));
    expect(ex.shows).toContain(ref.paths.GC_PERQ_CUSA.toFixed(3));
    expect(ex.shows).toContain(ref.paths.PERQ_CUSA.toFixed(3));
    expect(ex.shows).toContain(Math.abs(ref.paths.CUEX_CUSA).toFixed(3));
    expect(ex.shows).toContain(ref.r2.toFixed(3));
    const spec = toSpec(exampleModel(ex));
    expect(spec.copulas).toEqual([{ from: 'Expectation', to: 'Satisfaction' }, { from: 'Quality', to: 'Satisfaction' }]);
    const r = estimatePls(mobi(), spec);
    expect(path(r, copulaName('Quality', 'Satisfaction'), 'Satisfaction')).toBeCloseTo(ref.paths.GC_PERQ_CUSA, 3);
  });
});
