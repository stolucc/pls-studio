// Robust ML (rsem; Yuan & Zhang 2012) in webR equals rsem.lavaan in desktop R
// (scripts/validation/rsem.R). Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Dataset } from '../engine/types';
import { toSpec, type ModelState } from '../model/project';
import { rCall } from './bridge';
import { cbScoresR, estimateCbLavaan } from './lavaan';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const ref = JSON.parse(
  readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'rsem', 'reference.json'), 'utf8'),
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
};

describe('robust ML (rsem)', () => {
  it('estimates, robust SEs, TRML and case weights equal rsem.lavaan (missing values by EM)', async () => {
    const raw = await rCall<{ names: string[]; cols: (number | null)[][] }>(
      'ps_dataset',
      { package: 'lavaan', name: 'HolzingerSwineford1939', na: [] },
      'lavaan',
    );
    const hs: Dataset = {
      names: raw.names,
      cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))),
    };
    const x1 = hs.cols[hs.names.indexOf('x1')].slice();
    x1[2] = NaN;
    x1[9] = NaN;
    const data: Dataset = { ...hs, cols: hs.cols.map((c, k) => (hs.names[k] === 'x1' ? x1 : c)) };
    const r = await estimateCbLavaan(data, toSpec(model), 'fiml', 'RML');
    expect(r.n).toBe(301);
    for (const [k, v] of Object.entries(ref.loadings as Record<string, number>)) {
      const [l, i] = k.split(' ');
      const e = r.estimates.find((x) => x.op === '=~' && x.lhs === l && x.rhs === i)!;
      expect(e.est, k).toBeCloseTo(v, 6);
      expect(e.se!, `${k} robust se`).toBeCloseTo(ref.se[k], 6);
    }
    expect(r.fit.chisqScaled).toBeCloseTo(ref.trml.stat, 5);
    expect(r.fit.pvalueScaled).toBeCloseTo(ref.trml.p, 10);
    const low = r
      .caseWeights!.rows.map((row, i) => ({ row, w: r.caseWeights!.weights[i] }))
      .sort((a, b) => a.w - b.w)
      .slice(0, 5);
    expect(low.map((x) => x.row)).toEqual(ref.lowest.rows);
    low.forEach((x, i) => expect(x.w).toBeCloseTo(ref.lowest.weights[i], 8));
    await expect(cbScoresR(data, toSpec(model), 'fiml', 'RML', 'regression')).rejects.toThrow(
      /not available with robust ML/,
    );
  }, 600_000);
});
