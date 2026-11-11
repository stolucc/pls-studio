// CB-SEM with sampling weights (lavaan's sampling.weights) in webR equals
// lavaan in desktop R (scripts/validation/weights.R). Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Dataset } from '../engine/types';
import { toSpec, type ModelState } from '../model/project';
import { rCall } from './bridge';
import { cbRequest, estimateCbLavaan } from './lavaan';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const ref = JSON.parse(
  readFileSync(
    join(__dirname, '..', 'engine', '__fixtures__', 'weights', 'reference.json'),
    'utf8',
  ),
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
const model: ModelState = {
  constructs: [
    C('visual', ['x1', 'x2', 'x3']),
    C('textual', ['x4', 'x5', 'x6']),
    C('speed', ['x7', 'x8', 'x9']),
  ],
  paths: [],
  moderations: [],
  correlations: [
    { id: 'a', kind: 'construct', a: 'visual', b: 'textual' },
    { id: 'b', kind: 'construct', a: 'visual', b: 'speed' },
    { id: 'c', kind: 'construct', a: 'textual', b: 'speed' },
  ],
  weights: 'w',
};

describe('sampling weights (CB-SEM)', () => {
  it('weighted CFA equals lavaan: ML (robust SEs) and MLR with FIML', async () => {
    const raw = await rCall<{ names: string[]; cols: (number | null)[][] }>(
      'ps_dataset',
      { package: 'lavaan', name: 'HolzingerSwineford1939', na: [] },
      'lavaan',
    );
    const hs: Dataset = {
      names: raw.names,
      cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))),
    };
    const age = hs.cols[hs.names.indexOf('ageyr')];
    const data: Dataset = {
      names: [...hs.names, 'w'],
      cols: [...hs.cols, Float64Array.from(age, (a) => 1 + (a - 12) / 4)],
    };
    const spec = toSpec(model);
    expect(cbRequest(data, spec, 'casewise', 'ML').data).toMatchObject({
      names: expect.arrayContaining(['w']),
    });
    const check = (r: Awaited<ReturnType<typeof estimateCbLavaan>>, want: any) => {
      expect(r.fit.chisq).toBeCloseTo(want.chisq, 5);
      expect(r.fit.chisqScaled).toBeCloseTo(want.chisqScaled, 5);
      for (const [k, v] of Object.entries(want.loadings as Record<string, number>)) {
        const [l, i] = k.split(' ');
        const e = r.estimates.find((x) => x.op === '=~' && x.lhs === l && x.rhs === i)!;
        expect(e.est, k).toBeCloseTo(v, 6);
        if (want.se[k]) expect(e.se!, `${k} se`).toBeCloseTo(want.se[k], 6);
      }
    };
    check(await estimateCbLavaan(data, spec, 'casewise', 'ML'), ref.ml);
    const x1 = data.cols[data.names.indexOf('x1')].slice();
    x1[2] = NaN;
    x1[9] = NaN;
    const miss: Dataset = {
      ...data,
      cols: data.cols.map((c, k) => (data.names[k] === 'x1' ? x1 : c)),
    };
    check(await estimateCbLavaan(miss, spec, 'fiml', 'MLR'), ref.mlrFiml);
    await expect(estimateCbLavaan(data, spec, 'casewise', 'GLS')).rejects.toThrow(
      /sampling weights choose ML, MLR or MLM/,
    );
  }, 600_000);
});
