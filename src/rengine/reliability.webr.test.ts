// CB-SEM reliability: semTools' omega and alpha in webR equal semTools in
// desktop R (scripts/validation/reliability.R). Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Dataset } from '../engine/types';
import { toSpec, type ModelState } from '../model/project';
import { rCall } from './bridge';
import { estimateCbLavaan } from './lavaan';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const ref = JSON.parse(readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'weights', 'reliability.json'), 'utf8'));
const C = (id: string, inds: string[]) => ({ id, name: id, type: 'factor' as const, mode: 'A' as const, indicators: inds, x: 0, y: 0, side: 'left' as const });
const base: ModelState = {
  constructs: [C('visual', ['x1', 'x2', 'x3']), C('textual', ['x4', 'x5', 'x6']), C('speed', ['x7', 'x8', 'x9'])], paths: [], moderations: [],
  correlations: [{ id: 'a', kind: 'construct', a: 'visual', b: 'textual' }, { id: 'b', kind: 'construct', a: 'visual', b: 'speed' }, { id: 'c', kind: 'construct', a: 'textual', b: 'speed' }],
};
const FACTORS = ['visual', 'textual', 'speed'];

describe('CB-SEM reliability (semTools::compRelSEM)', () => {
  it('omega and alpha per factor: one group, with a residual covariance, and per school', async () => {
    const raw = await rCall<{ names: string[]; cols: (number | null)[][]; levels?: Record<string, string[]> }>('ps_dataset', { package: 'lavaan', name: 'HolzingerSwineford1939', na: [] }, 'lavaan');
    const data: Dataset = { names: raw.names, cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))) };
    const same = (rel: { omega?: number; alpha?: number }[], want: any, g = 0) => FACTORS.forEach((f, j) => {
      const at = (v: number | number[]) => (Array.isArray(v) ? v[g] : v);  // (one group: a single number)
      expect(rel[j].omega, `${f} omega`).toBeCloseTo(at(want.omega[f]), 8);
      expect(rel[j].alpha, `${f} alpha`).toBeCloseTo(at(want.alpha[f]), 8);
    });
    same((await estimateCbLavaan(data, toSpec(base), 'casewise', 'ML')).reliability, ref.one);
    const rescov = { ...base, correlations: [...base.correlations!, { id: 'd', kind: 'indicator' as const, a: 'x1', b: 'x4' }] };
    same((await estimateCbLavaan(data, toSpec(rescov), 'casewise', 'ML')).reliability, ref.rescov);
    const groups = { ...base, multigroup: { column: 'school', invariance: 'configural' as const, free: [] } };
    const r = await estimateCbLavaan({ ...data, categories: raw.levels }, toSpec(groups), 'casewise', 'ML');
    // lavaan orders the groups as they first appear (Pasteur, Grant-White), as compRelSEM does.
    r.groups!.results.forEach((g, k) => same(g.reliability, ref.groups, k));
  }, 600_000);
});
