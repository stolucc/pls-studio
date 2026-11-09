// PLSc with interaction and quadratic terms in the built-in engine, against
// plain cSEM calls (scripts/validation/plsc_nonlinear.R).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bootstrapPls } from './bootstrap';
import { parseCsv } from './dataset';
import { binaryModeration, estimatePls, originalScaleCoefficients } from './pls';
import { latentMoments } from './plscMoments';
import { interactionName, type Dataset, type ModelSpec } from './types';

const fx = join(__dirname, '__fixtures__');
const ref = JSON.parse(readFileSync(join(fx, 'plsc_nonlinear', 'reference.json'), 'utf8'));
const mobi = (): Dataset => parseCsv(readFileSync(join(fx, 'mobi.csv'), 'utf8')).dataset;
const ITEMS: Record<string, string[]> = {
  EXPE: ['CUEX1', 'CUEX2', 'CUEX3'], QUAL: ['PERQ1', 'PERQ2', 'PERQ3', 'PERQ4', 'PERQ5', 'PERQ6', 'PERQ7'],
  VAL: ['PERV1', 'PERV2'], SAT: ['CUSA1', 'CUSA2', 'CUSA3'], LOY: ['CUSL1', 'CUSL2', 'CUSL3'],
};
const K = (name: string) => ({ name, mode: 'A' as const, type: 'factor' as const, indicators: ITEMS[name] });
const model = (names: string[], paths: [string, string][], mods: [string, string, string][]): ModelSpec => ({
  constructs: names.map(K), paths: paths.map(([from, to]) => ({ from, to })), moderations: mods.map(([from, moderator, to]) => ({ from, moderator, to })),
});
const CASES: Record<string, ModelSpec> = {
  moderation: model(['EXPE', 'QUAL', 'SAT'], [['EXPE', 'SAT'], ['QUAL', 'SAT']], [['EXPE', 'QUAL', 'SAT']]),
  twoMod: model(['EXPE', 'QUAL', 'VAL', 'SAT'], [['EXPE', 'SAT'], ['QUAL', 'SAT'], ['VAL', 'SAT']], [['EXPE', 'QUAL', 'SAT'], ['EXPE', 'VAL', 'SAT']]),
  quadratic: model(['QUAL', 'SAT'], [['QUAL', 'SAT']], [['QUAL', 'QUAL', 'SAT']]),
  chain: model(['EXPE', 'QUAL', 'SAT', 'LOY'], [['EXPE', 'SAT'], ['QUAL', 'SAT'], ['SAT', 'LOY']], [['EXPE', 'QUAL', 'SAT']]),
  endogenous: model(['EXPE', 'QUAL', 'SAT', 'LOY'], [['EXPE', 'SAT'], ['QUAL', 'SAT'], ['SAT', 'LOY'], ['EXPE', 'LOY']], [['SAT', 'EXPE', 'LOY']]),
};
const term = (name: string) => { const f = name.split('.'); return f.length === 2 && f[0] === f[1] ? interactionName(f[0], f[1]) : f.join(' × '); };

describe('PLSc with nonlinear terms', () => {
  it.each(Object.keys(CASES))('reproduces cSEM: %s', (k) => {
    const r = estimatePls(mobi(), CASES[k], { consistent: true });
    const paths = ref[k].paths as Record<string, Record<string, number>>;
    for (const [to, row] of Object.entries(paths)) for (const [from, v] of Object.entries(row)) {
      if (!v) continue;
      expect(r.pathCoef[r.constructs.indexOf(term(from))][r.constructs.indexOf(to)], `${from} → ${to}`).toBeCloseTo(v, 3);
    }
    for (const [to, v] of Object.entries(ref[k].r2 as Record<string, number>)) expect(r.rSquared[r.constructs.indexOf(to)], `R² ${to}`).toBeCloseTo(v, 3);
    for (const [c, v] of Object.entries(ref[k].rhoA as Record<string, number>)) expect(r.quality[r.constructs.indexOf(c)].rhoA, `ρA ${c}`).toBeCloseTo(v, 3);
  });
  it('leaves a linear model and standard PLS with terms as they were', () => {
    const linear = estimatePls(mobi(), { ...CASES.moderation, moderations: [] }, { consistent: true });
    expect(linear.constructs).toEqual(['EXPE', 'QUAL', 'SAT']);
    const plain = estimatePls(mobi(), CASES.moderation);
    const t = plain.constructs.indexOf(interactionName('EXPE', 'QUAL'));
    expect(plain.pathCoef[t][plain.constructs.indexOf('SAT')]).not.toBeCloseTo(ref.moderation.paths.SAT['EXPE.QUAL'], 3);
  });
  it('bootstraps, and reports a finite f² for the term', () => {
    const r = estimatePls(mobi(), CASES.moderation, { consistent: true });
    const t = r.constructs.indexOf(interactionName('EXPE', 'QUAL')), j = r.constructs.indexOf('SAT');
    expect(Number.isFinite(r.fSquare[t][j])).toBe(true);
    const b = bootstrapPls(mobi(), CASES.moderation, { consistent: true }, { samples: 30, seed: 3, confidence: 0.95 });
    const s = b.stats.find((x) => x.key === `path:${interactionName('EXPE', 'QUAL')}:SAT`)!;
    expect(s.sd).toBeGreaterThan(0);
    expect(s.original).toBeCloseTo(r.pathCoef[t][j], 10);
  });
});

describe('latent moments', () => {
  const x = Float64Array.from([-1.5, -0.5, 0.5, 1.5].map((v) => v / Math.sqrt(5 / 3)));
  it('take the error variance out of second and fourth moments', () => {
    const m = latentMoments([x], [0.8]);
    expect(m([])).toBe(1);
    expect(m([0])).toBe(0);
    expect(m([0, 0])).toBeCloseTo(1, 10);
    const proxy4 = x.reduce((s, v) => s + v ** 4, 0) / 4;
    expect(m([0, 0, 0, 0])).toBeCloseTo((proxy4 - 6 * 0.8 * 0.2 - 3 * 0.04) / 0.64, 10);
  });
  it('with reliability 1 are the moments of the scores', () => {
    const y = Float64Array.from([1.2, -0.3, -1.1, 0.2]);
    const m = latentMoments([x, y], [1, 1]);
    expect(m([0, 1])).toBeCloseTo(x.reduce((s, v, i) => s + v * y[i], 0) / 4, 10);
  });
});

describe('three-way interactions', () => {
  const three: ModelSpec = {
    ...model(['EXPE', 'QUAL', 'VAL', 'SAT'], [['EXPE', 'SAT']], [['EXPE', 'QUAL', 'SAT']]),
    threeWay: [{ from: 'EXPE', moderator: 'QUAL', moderator2: 'VAL', to: 'SAT' }],
  };
  const beta = (r: ReturnType<typeof estimatePls>, from: string) => r.pathCoef[r.constructs.indexOf(from)][r.constructs.indexOf('SAT')];
  const T3 = 'EXPE × QUAL × VAL';
  it('imply their lower-order terms and main effects, and reproduce two-stage seminr', () => {
    const r = estimatePls(mobi(), three);
    const ref3 = ref.threeWayStandard;
    for (const [mine, theirs] of [['EXPE', 'EXPE'], ['QUAL', 'QUAL'], ['VAL', 'VAL'], ['EXPE × QUAL', 'EQ'], ['EXPE × VAL', 'EV'], ['QUAL × VAL', 'QV'], [T3, 'EQV']]) {
      expect(beta(r, mine), mine).toBeCloseTo(ref3.paths[theirs], 3);
    }
    expect(r.rSquared[r.constructs.indexOf('SAT')]).toBeCloseTo(ref3.r2, 3);
    expect(r.threeWay!.map((t) => r.constructs[t.construct])).toEqual([T3]);
  });
  it('with PLSc reproduce cSEM', () => {
    const r = estimatePls(mobi(), three, { consistent: true });
    const p = ref.threeWay.paths.SAT;
    for (const [mine, theirs] of [['EXPE', 'EXPE'], ['QUAL', 'QUAL'], ['VAL', 'VAL'], ['EXPE × QUAL', 'EXPE.QUAL'], ['EXPE × VAL', 'EXPE.VAL'], ['QUAL × VAL', 'QUAL.VAL'], [T3, 'EXPE.QUAL.VAL']]) {
      expect(beta(r, mine), mine).toBeCloseTo(p[theirs], 3);
    }
    expect(r.rSquared[r.constructs.indexOf('SAT')]).toBeCloseTo(ref.threeWay.r2.SAT, 3);
  });
  it('bootstrap, and refuse a path that is not in the model', () => {
    const b = bootstrapPls(mobi(), three, {}, { samples: 20, seed: 5, confidence: 0.95 });
    expect(b.stats.find((s) => s.key === `path:${T3}:SAT`)!.sd).toBeGreaterThan(0);
    expect(() => estimatePls(mobi(), { ...three, threeWay: [{ from: 'SAT', moderator: 'QUAL', moderator2: 'VAL', to: 'EXPE' }] })).toThrow(/not in the model/);
  });
});

describe('pre-defined weights', () => {
  const spec: ModelSpec = {
    constructs: [{ name: 'EXPE', mode: 'B', type: 'composite', indicators: ITEMS.EXPE, predefinedWeights: { CUEX1: 0.5, CUEX2: 0.3, CUEX3: 0.2 } }, { name: 'SAT', mode: 'B', type: 'composite', indicators: ITEMS.SAT }],
    paths: [{ from: 'EXPE', to: 'SAT' }],
  };
  it('reproduce cSEM: rescaled to a unit-variance score, the other block estimated', () => {
    const r = estimatePls(mobi(), spec);
    const w = (n: string) => r.weights[r.indicators.findIndex((i) => i.name === n)];
    for (const n of ITEMS.EXPE) expect(w(n), n).toBeCloseTo(ref.predefined.weights[n], 4);
    for (const n of ITEMS.SAT) expect(w(n), n).toBeCloseTo(ref.predefined.weightsSAT[n], 3);
    expect(r.pathCoef[0][1]).toBeCloseTo(ref.predefined.path, 3);
    expect(r.rSquared[1]).toBeCloseTo(ref.predefined.r2, 3);
  });
  it('keep their ratio in a bootstrap sample, and a missing weight counts as 0', () => {
    const r = estimatePls(mobi(), { ...spec, constructs: [{ ...spec.constructs[0], predefinedWeights: { CUEX1: 1 } }, spec.constructs[1]] });
    expect(r.weights.slice(0, 3).filter((v) => v !== 0)).toHaveLength(1);
    const b = bootstrapPls(mobi(), spec, {}, { samples: 10, seed: 1, confidence: 0.95 });
    const stat = (n: string) => b.stats.find((x) => x.key === `weight:${n}`)!;
    expect(stat('CUEX1').mean / stat('CUEX2').mean).toBeCloseTo(0.5 / 0.3, 6);
  });
});

describe('results on the original scale', () => {
  const spec = model(['EXPE', 'QUAL', 'SAT'], [['EXPE', 'SAT'], ['QUAL', 'SAT']], []);
  const r = estimatePls(mobi(), spec);
  const weights = r.indicators.map((x, i) => ({ name: x.name, weight: r.weights[i] }));
  it('reproduce lm() on the rescaled composites', () => {
    const [eq] = originalScaleCoefficients(mobi(), spec, {}, weights)!;
    expect(eq.to).toBe('SAT');
    expect(eq.coefficients.find((k) => k.from === 'EXPE')!.b).toBeCloseTo(ref.originalScale.unstandardized.EXPE, 3);
    expect(eq.coefficients.find((k) => k.from === 'QUAL')!.b).toBeCloseTo(ref.originalScale.unstandardized.QUAL, 3);
    expect(eq.intercept).toBeCloseTo(ref.originalScale.unstandardized['(Intercept)'], 2);
    expect(ref.originalScale.meanCentred.EXPE).toBeCloseTo(ref.originalScale.unstandardized.EXPE, 10);  // the same slopes
    expect(Math.abs(ref.originalScale.meanCentred['(Intercept)'])).toBeLessThan(1e-10);
  });
  it('are not offered for a model with terms', () => {
    expect(originalScaleCoefficients(mobi(), CASES.moderation, {}, weights)).toBeNull();
  });
});

describe('a binary moderator', () => {
  it('reads as lm() with the 0/1 variable as it is', () => {
    const data = mobi();
    const cusco = data.cols[data.names.indexOf('CUSCO')];
    const D = Float64Array.from(cusco, (v) => (v >= ref.binaryMedian ? 1 : 0));
    const d2: Dataset = { ...data, names: [...data.names, 'D'], cols: [...data.cols, D] };
    const r = estimatePls(d2, {
      constructs: [K('EXPE'), K('SAT'), { name: 'GRP', mode: 'A', type: 'factor', indicators: ['D'] }],
      paths: [{ from: 'EXPE', to: 'SAT' }, { from: 'GRP', to: 'SAT' }], moderations: [{ from: 'EXPE', moderator: 'GRP', to: 'SAT' }],
    });
    const j = r.constructs.indexOf('SAT');
    const b = binaryModeration(r.pathCoef[r.constructs.indexOf('EXPE')][j], r.pathCoef[r.constructs.indexOf('GRP')][j], r.pathCoef[r.constructs.indexOf('EXPE × GRP')][j], D)!;
    // (lm() on the stage 1 scores; stage 2 re-estimates the weights, so to two decimals)
    expect(b.slopeLow).toBeCloseTo(ref.binaryLm['z(EXPE)'], 1);
    expect(b.difference).toBeCloseTo(ref.binaryLm['z(EXPE):D'], 1);
    expect(b.groupDifference).toBeCloseTo(ref.binaryLm.D, 1);
  });
  it('is only for two values', () => {
    expect(binaryModeration(1, 1, 1, [1, 2, 3])).toBeNull();
    const m = binaryModeration(0.4, 0.2, 0.1, [0, 0, 1, 1])!;
    expect(m.difference).toBeCloseTo(0.1 / Math.sqrt(1 / 3), 10);
  });
});
