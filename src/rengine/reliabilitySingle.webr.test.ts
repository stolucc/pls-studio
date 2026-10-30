// Single indicators with a known reliability in CB-SEM (lavaan) in webR equal
// lavaan in desktop R (scripts/validation/reliability_single.R): the error
// variance is fixed at (1 − reliability) × the indicator's variance, from raw
// data or from a covariance matrix. Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Dataset } from '../engine/types';
import { toSpec, type ModelState } from '../model/project';
import { rCall } from './bridge';
import { cbScriptLavaan, estimateCbLavaan } from './lavaan';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const ref = JSON.parse(readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'reliability_single.json'), 'utf8'));
const C = (id: string, inds: string[], extra = {}) => ({ id, name: id, type: 'factor' as const, mode: 'A' as const, indicators: inds, x: 0, y: 0, side: 'left' as const, ...extra });
const model = (reliability?: number): ModelState => ({
  constructs: [C('visual', ['x1', 'x2', 'x3']), C('textual', ['x4', 'x5', 'x6']), C('speed', ['x7'], reliability === undefined ? {} : { reliability })],
  paths: [{ id: 'p1', from: 'visual', to: 'speed' }, { id: 'p2', from: 'textual', to: 'speed' }], moderations: [], correlations: [{ id: 'k', kind: 'construct', a: 'visual', b: 'textual' }],
});

type R = Awaited<ReturnType<typeof estimateCbLavaan>>;
const check = (r: R, want: typeof ref.raw) => {
  for (const x of ['visual', 'textual']) {
    const e = r.estimates.find((q) => q.op === '~' && q.lhs === 'speed' && q.rhs === x)!;
    expect(e.est).toBeCloseTo(want.paths[x], 6);
    expect(e.se!).toBeCloseTo(want.se[x], 6);
  }
  expect(r.estimates.find((q) => q.op === '~~' && q.lhs === 'speed' && q.rhs === 'speed')!.est).toBeCloseTo(want.speedVar, 6);
  expect(r.fit.chisq).toBeCloseTo(want.chisq, 4);
  expect(r.fit.df).toBe(want.df);
};

describe('single indicator with known reliability (lavaan)', () => {
  it('HolzingerSwineford1939: x7 with reliability 0.7, from raw data, a covariance matrix, and the default (no error)', async () => {
    const raw = await rCall<{ names: string[]; cols: (number | null)[][] }>('ps_dataset', { package: 'lavaan', name: 'HolzingerSwineford1939', na: [] }, 'lavaan');
    const data: Dataset = { names: raw.names, cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))) };
    const r = await estimateCbLavaan(data, toSpec(model(0.7)), 'casewise', 'ML');
    check(r, ref.raw);
    const x7 = r.estimates.find((q) => q.op === '~~' && q.lhs === 'x7' && q.rhs === 'x7')!;
    expect(x7.est).toBeCloseTo(ref.errorVariance, 10);
    check(await estimateCbLavaan(data, toSpec(model()), 'casewise', 'ML'), ref.none);

    // The covariance matrix of x1..x9 (unbiased, as R's cov()).
    const xs = Array.from({ length: 9 }, (_, i) => data.cols[data.names.indexOf(`x${i + 1}`)]);
    const n = xs[0].length;
    const mean = xs.map((c) => c.reduce((s, v) => s + v, 0) / n);
    const S = xs.map((a, i) => xs.map((b, j) => a.reduce((s, v, k) => s + (v - mean[i]) * (b[k] - mean[j]), 0) / (n - 1)));
    const mat: Dataset = { names: xs.map((_, i) => `x${i + 1}`), cols: [], moments: { S, n } };
    check(await estimateCbLavaan(mat, toSpec(model(0.7)), 'casewise', 'ML'), ref.matrix);

    const script = await cbScriptLavaan(data, toSpec(model(0.7)), 'casewise', 'ML');
    expect(script).toMatch(/x7 ~~ 0\.356124978\d*\*x7 {3}# single indicator, reliability 0\.7/);
  }, 600_000);
});
