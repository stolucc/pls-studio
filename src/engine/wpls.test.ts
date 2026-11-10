// Weighted PLS (WPLS; Becker & Ismail 2016). Reference: with integer sampling weights, WPLS must give
// exactly the estimates of the unweighted algorithm on the data with each row repeated w times (the
// weights enter only through weighted correlations and regressions). Plus a hand-computed weighted correlation.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bootstrapPls } from './bootstrap';
import { parseCsv } from './dataset';
import { estimatePls, normaliseWeights, weightedMoments } from './pls';
import type { Dataset, ModelSpec, PlsResult } from './types';

const data = parseCsv(readFileSync(join(__dirname, '__fixtures__', 'mobi.csv'), 'utf8')).dataset;
const items = (p: string, k: number) => Array.from({ length: k }, (_, i) => `${p}${i + 1}`);
const n = data.cols[0].length;
// Deterministic integer weights 0..3 (a 0 drops the row from both analyses).
const wInt = Float64Array.from({ length: n }, (_, r) => (r * 7 + 3) % 4);
const weighted: Dataset = { names: [...data.names, 'sw'], cols: [...data.cols, wInt] };
const repeated: Dataset = { names: data.names, cols: data.cols.map((c) => Float64Array.from(Array.from(c).flatMap((v, r) => Array<number>(wInt[r]).fill(v)))) };

const model = (extra: Partial<ModelSpec> = {}): ModelSpec => ({
  constructs: [
    { name: 'Image', mode: 'A', indicators: items('IMAG', 5) },
    { name: 'Expectation', mode: 'A', indicators: items('CUEX', 3) },
    { name: 'Quality', mode: 'B', indicators: items('PERQ', 7) },
    { name: 'Value', mode: 'A', indicators: items('PERV', 2) },
    { name: 'Satisfaction', mode: 'A', indicators: items('CUSA', 3) },
    { name: 'Loyalty', mode: 'A', indicators: items('CUSL', 3) },
  ],
  paths: [['Image', 'Expectation'], ['Image', 'Satisfaction'], ['Expectation', 'Quality'], ['Expectation', 'Value'], ['Quality', 'Value'],
    ['Quality', 'Satisfaction'], ['Value', 'Satisfaction'], ['Satisfaction', 'Loyalty'], ['Image', 'Loyalty']].map(([from, to]) => ({ from, to })),
  ...extra,
});

function same(a: PlsResult, b: PlsResult, digits = 9) {
  expect(a.constructs).toEqual(b.constructs);
  a.weights.forEach((v, k) => expect(v, `weight ${k}`).toBeCloseTo(b.weights[k], digits));
  a.loadings.forEach((v, k) => expect(v, `loading ${k}`).toBeCloseTo(b.loadings[k], digits));
  a.pathCoef.forEach((row, i) => row.forEach((v, j) => expect(v, `path ${i} ${j}`).toBeCloseTo(b.pathCoef[i][j], digits)));
  a.rSquared.forEach((v, j) => expect(v ?? 0).toBeCloseTo(b.rSquared[j] ?? 0, digits));
  a.fSquare.forEach((row, i) => row.forEach((v, j) => expect(v ?? 0).toBeCloseTo(b.fSquare[i][j] ?? 0, digits)));
  a.quality.forEach((q, j) => { expect(q.rhoA).toBeCloseTo(b.quality[j].rhoA, digits); expect(q.alpha).toBeCloseTo(b.quality[j].alpha, digits); expect(q.ave).toBeCloseTo(b.quality[j].ave, digits); });
  a.htmt.forEach((row, i) => row.forEach((v, j) => expect(v ?? 0).toBeCloseTo(b.htmt[i][j] ?? 0, digits)));
  expect(a.fit.estimated.srmr).toBeCloseTo(b.fit.estimated.srmr, digits);
  a.vifOuter.forEach((v, k) => expect(v).toBeCloseTo(b.vifOuter[k], digits));
}

describe('weighted PLS (WPLS)', () => {
  it('equals the unweighted algorithm on rows repeated by integer weights', () => {
    const wpls = estimatePls(weighted, model({ weights: 'sw' }), { missing: 'casewise' });
    const rep = estimatePls(repeated, model(), { missing: 'casewise' });
    expect(wpls.samplingWeights).toBe('sw');
    expect(wpls.iterations).toBe(rep.iterations);
    same(wpls, rep);
  });

  it('equals it with PLSc too', () => {
    same(estimatePls(weighted, model({ weights: 'sw' }), { consistent: true }), estimatePls(repeated, model(), { consistent: true }));
  });

  it('equals it with a two-stage interaction term (standardised effects; the term per unit of the product to the n−1 convention)', () => {
    const mod = { moderations: [{ from: 'Image', moderator: 'Value', to: 'Satisfaction' }] };
    const wpls = estimatePls(weighted, model({ weights: 'sw', ...mod }));
    const rep = estimatePls(repeated, model(mod));
    const i = wpls.constructs.indexOf('Image × Value'), j = wpls.constructs.indexOf('Satisfaction');
    wpls.weights.forEach((v, k) => expect(v).toBeCloseTo(rep.weights[k], 9));
    expect(wpls.pathCoef[0][j]).toBeCloseTo(rep.pathCoef[0][j], 9);
    expect(wpls.rSquared[j]).toBeCloseTo(rep.rSquared[j]!, 9);
    // Scores have unit variance with the denominator n − 1 (weights summing to n) vs n_rep − 1: the term differs by that ratio only.
    expect(wpls.pathCoef[i][j]).toBeCloseTo(rep.pathCoef[i][j], 2);
  });

  it('unit weights give the unweighted estimates', () => {
    const ones: Dataset = { names: [...data.names, 'one'], cols: [...data.cols, new Float64Array(n).fill(1)] };
    const a = estimatePls(ones, model({ weights: 'one' }));
    same(a, estimatePls(data, model()), 10);
    // Scores are reported without the √w factor of the algorithm.
    expect(a.scores[0][5]).toBeCloseTo(estimatePls(data, model()).scores[0][5], 10);
  });

  it('a single-indicator path is the weighted correlation (by hand)', () => {
    const x = data.cols[data.names.indexOf('CUSA1')], y = data.cols[data.names.indexOf('CUSL1')];
    const w = normaliseWeights(Float64Array.from(wInt, (v) => v + 0.5));
    const mx = weightedMoments(x, w), my = weightedMoments(y, w);
    let c = 0;
    for (let r = 0; r < n; r++) c += w[r] * (x[r] - mx.mean) * (y[r] - my.mean);
    const rw = c / (n - 1) / (mx.sd * my.sd);
    // the textbook form: Σw(x−x̄)(y−ȳ) / √(Σw(x−x̄)² Σw(y−ȳ)²)
    let sxx = 0, syy = 0;
    for (let r = 0; r < n; r++) { sxx += w[r] * (x[r] - mx.mean) ** 2; syy += w[r] * (y[r] - my.mean) ** 2; }
    expect(rw).toBeCloseTo(c / Math.sqrt(sxx * syy), 12);
    const d: Dataset = { names: ['x', 'y', 'w'], cols: [x, y, Float64Array.from(wInt, (v) => v + 0.5)] };
    const res = estimatePls(d, { constructs: [{ name: 'X', mode: 'A', indicators: ['x'] }, { name: 'Y', mode: 'A', indicators: ['y'] }], paths: [{ from: 'X', to: 'Y' }], weights: 'w' });
    expect(res.pathCoef[0][1]).toBeCloseTo(rw, 12);
    expect(rw).not.toBeCloseTo(estimatePls(d, { constructs: [{ name: 'X', mode: 'A', indicators: ['x'] }, { name: 'Y', mode: 'A', indicators: ['y'] }], paths: [{ from: 'X', to: 'Y' }] }).pathCoef[0][1], 3);
  });

  it('bootstraps cases with their weights (unit weights: the unweighted bootstrap)', () => {
    const ones: Dataset = { names: [...data.names, 'one'], cols: [...data.cols, new Float64Array(n).fill(1)] };
    const b1 = bootstrapPls(ones, model({ weights: 'one' }), {}, { samples: 20, seed: 3, confidence: 0.95 });
    const b0 = bootstrapPls(data, model(), {}, { samples: 20, seed: 3, confidence: 0.95 });
    b1.stats.forEach((s, i) => expect(s.sd).toBeCloseTo(b0.stats[i].sd, 9));
    const bw = bootstrapPls(weighted, model({ weights: 'sw' }), {}, { samples: 20, seed: 3, confidence: 0.95 });
    const orig = estimatePls(weighted, model({ weights: 'sw' }));
    expect(bw.failed).toBe(0);
    expect(bw.stats.find((s) => s.key === 'path:Satisfaction:Loyalty')!.original).toBeCloseTo(orig.pathCoef[4][5], 10);
  });

  it('refuses invalid weights and unsupported combinations', () => {
    const neg: Dataset = { names: [...data.names, 'sw'], cols: [...data.cols, Float64Array.from(wInt, (v) => v - 1)] };
    expect(() => estimatePls(neg, model({ weights: 'sw' }))).toThrow(/non-negative/);
    const zero: Dataset = { names: [...data.names, 'sw'], cols: [...data.cols, new Float64Array(n)] };
    expect(() => estimatePls(zero, model({ weights: 'sw' }))).toThrow(/all zero/);
    expect(() => estimatePls(weighted, model({ weights: 'sw', copulas: [{ from: 'Image', to: 'Loyalty' }] }))).toThrow(/copula/);
  });
});
