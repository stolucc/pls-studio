// Composites (emergent variables) in CB-SEM (lavaan <~) in webR equal lavaan in
// desktop R (scripts/validation/cb_composite.R): weights, composite loadings,
// paths and fit, with ML and with FIML. Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Dataset } from '../engine/types';
import { toSpec, type ModelState } from '../model/project';
import { bootstrapR } from './analyses';
import { rCall } from './bridge';
import { cbScriptLavaan, estimateCbLavaan } from './lavaan';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const ref = JSON.parse(readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'cb_composite.json'), 'utf8'));
const C = (id: string, inds: string[], type: 'factor' | 'composite' = 'factor') => ({ id, name: id, type, mode: type === 'composite' ? 'B' as const : 'A' as const, indicators: inds, x: 0, y: 0, side: 'left' as const });
const model: ModelState = {
  constructs: [C('visual', ['x1', 'x2', 'x3'], 'composite'), C('textual', ['x4', 'x5', 'x6']), C('speed', ['x7', 'x8', 'x9'])],
  paths: [{ id: 'p1', from: 'visual', to: 'speed' }, { id: 'p2', from: 'textual', to: 'speed' }], moderations: [],
  correlations: [{ id: 'k', kind: 'construct', a: 'visual', b: 'textual' }],
};

type R = Awaited<ReturnType<typeof estimateCbLavaan>>;
const check = (r: R, want: typeof ref.ml) => {
  for (const x of ['x1', 'x2', 'x3']) {
    const w = r.estimates.find((e) => e.op === '<~' && e.lhs === 'visual' && e.rhs === x)!;
    expect(w.kind).toBe(x === 'x1' ? 'fixed-weight' : 'weight');
    expect(w.est).toBeCloseTo(want.weights[x], 6);
    expect(w.std).toBeCloseTo(want.weightStd[x], 6);
    if (x !== 'x1') expect(w.se!).toBeCloseTo(want.weightSe[x], 6);
    expect(r.stdLoadings[r.indicators.findIndex((i) => i.name === x)]).toBeCloseTo(want.loadings[x], 6);
    expect(r.r2Indicators[r.indicators.findIndex((i) => i.name === x)]).toBeNaN();
  }
  for (const x of ['visual', 'textual']) {
    const e = r.estimates.find((q) => q.op === '~' && q.lhs === 'speed' && q.rhs === x)!;
    expect(e.est).toBeCloseTo(want.paths[x], 6);
    expect(e.se!).toBeCloseTo(want.pathSe[x], 6);
  }
  expect(r.fit.chisq).toBeCloseTo(want.chisq, 4);
  expect(r.fit.df).toBe(want.df);
  // Not for composites: CR/AVE, ω (compRelSEM misreads models with composites) and HTMT.
  expect(r.reliability[0].cr).toBeFalsy();
  expect(r.reliability[1].cr).toBeGreaterThan(0);
  expect(r.reliability[1].omega).toBeFalsy();
  expect(r.htmt[0][1] ?? NaN).toBeNaN();
  expect(r.htmt[1][2]).toBeGreaterThan(0);
};

describe('composites in CB-SEM (lavaan)', () => {
  it('HolzingerSwineford1939: visual a composite of x1-x3; ML, and FIML with missing values', async () => {
    const raw = await rCall<{ names: string[]; cols: (number | null)[][] }>('ps_dataset', { package: 'lavaan', name: 'HolzingerSwineford1939', na: [] }, 'lavaan');
    const data: Dataset = { names: raw.names, cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))) };
    const ml = await estimateCbLavaan(data, toSpec(model), 'casewise', 'ML');
    check(ml, ref.ml);
    // lavaan computes no modification indices with composites: the reason is passed on, not shown as "none reach 3.84".
    expect(ml.modindices).toEqual([]);
    expect(ml.modindicesError).toMatch(/not available for models with composites/);

    const cols = data.cols.map((c) => Float64Array.from(c));
    for (const [x, rows] of Object.entries(ref.missing as Record<string, number[]>)) for (const r of rows) cols[data.names.indexOf(x)][r - 1] = NaN;
    check(await estimateCbLavaan({ names: data.names, cols }, toSpec(model), 'fiml', 'ML'), ref.fiml);

    // The bootstrap resamples the composite weights too (standardised, as the other statistics).
    const boot = await bootstrapR(data, toSpec(model), { kind: 'cbBoot', estimator: 'ML', missing: 'casewise', boot: { samples: 30, seed: 7, confidence: 0.95 }, interaction: 'product' }, () => 'x');
    for (const x of ['x1', 'x2', 'x3']) {
      const s = boot.stats.find((q) => q.key === `weight:${x}`)!;
      expect(s.label).toBe(`${x} → visual`);
      expect(s.original).toBeCloseTo(ref.ml.weightStd[x], 6);
      expect(s.sd).toBeGreaterThan(0);
    }
    expect(boot.failed).toBe(0);

    const script = await cbScriptLavaan(data, toSpec(model), 'casewise', 'ML');
    expect(script).toContain('visual <~ 1*x1 + x2 + x3');
  }, 600_000);

  it('refuses composites in multiple-group models (R-side guard)', async () => {
    const raw = await rCall<{ names: string[]; cols: (number | null)[][] }>('ps_dataset', { package: 'lavaan', name: 'HolzingerSwineford1939', na: [] }, 'lavaan');
    const data: Dataset = { names: raw.names, cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))) };
    await expect(estimateCbLavaan(data, toSpec({ ...model, multigroup: { column: 'school', invariance: 'configural', free: [] } }), 'casewise', 'ML')).rejects.toThrow(/multiple-group/);
  }, 600_000);
});
