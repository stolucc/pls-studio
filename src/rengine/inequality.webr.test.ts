// Inequality constraints and non-negative variances in CB-SEM (lavaan) in
// webR equal lavaan in desktop R (scripts/validation/inequality.R).
// Run with npm run test:webr.

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

const ref = JSON.parse(
  readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'inequality.json'), 'utf8'),
);
const C = (id: string, inds: string[]) => ({
  id,
  name: id,
  type: 'factor' as const,
  mode: 'A' as const,
  indicators: inds,
  x: 0,
  y: 0,
  side: 'left' as const,
});
const base: ModelState = {
  constructs: [C('f1', ['x1', 'x2', 'x3']), C('f2', ['x4', 'x5', 'x6'])],
  paths: [],
  moderations: [],
  correlations: [{ id: 'k', kind: 'construct', a: 'f1', b: 'f2' }],
};

describe('inequality constraints (lavaan)', () => {
  it('cfa_dat_heywood: variances kept non-negative, and an active bound on a labelled loading', async () => {
    const raw = await rCall<{ names: string[]; cols: (number | null)[][] }>(
      'ps_dataset',
      { package: 'semfindr', name: 'cfa_dat_heywood', na: [] },
      'semfindr',
    );
    const data: Dataset = {
      names: raw.names,
      cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))),
    };
    const variance = (r: Awaited<ReturnType<typeof estimateCbLavaan>>, x: string) =>
      r.estimates.find((e) => e.op === '~~' && e.lhs === x && e.rhs === x)!.est;
    const bounded = await estimateCbLavaan(
      data,
      toSpec({ ...base, positiveVariances: true }),
      'casewise',
      'ML',
    );
    expect(variance(bounded, 'x1')).toBeCloseTo(ref.bounds.variances.x1, 6);
    expect(variance(bounded, 'x1')).toBeGreaterThanOrEqual(0);
    expect(bounded.fit.chisq).toBeCloseTo(ref.bounds.chisq, 4);
    const labelled = {
      ...base,
      constructs: base.constructs.map((c) =>
        c.id === 'f1' ? { ...c, loadingLabels: { x2: 'a' } } : c,
      ),
      inequalities: 'a > 0.5',
    };
    const r = await estimateCbLavaan(data, toSpec(labelled), 'casewise', 'ML');
    expect(
      r.estimates.find((e) => e.op === '=~' && e.lhs === 'f1' && e.rhs === 'x2')!.est,
    ).toBeCloseTo(ref.loading.loadings['f1 x2'], 6);
    expect(r.fit.chisq).toBeCloseTo(ref.loading.chisq, 4);
    const script = await cbScriptLavaan(
      data,
      toSpec({ ...labelled, positiveVariances: true }),
      'casewise',
      'ML',
    );
    expect(script).toContain('a > 0.5');
    expect(script).toContain('bounds = "pos.var"');
  }, 600_000);
});
