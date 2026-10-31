// Sampling clusters (cluster-robust standard errors, Mplus TYPE = COMPLEX)
// against lavaan run natively (scripts/validation/complex.R): the same model
// on Demo.twolevel with cluster = "cluster", ML and MLR. Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { ModelSpec } from '../engine/types';
import { rCall } from './bridge';
import { cbScriptLavaan, estimateCbLavaan } from './lavaan';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

type Ref = { se: string; estimates: { lhs: string; op: string; rhs: string; est: number; se: number }[]; chisq: number; df: number; chisqScaled: number | null; cfi: number; srmr: number };
const ref = JSON.parse(readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'complex', 'reference.json'), 'utf8')) as { ML: Ref; MLR: Ref; plainSE: Record<string, number> };

const spec: ModelSpec = {
  constructs: [
    { name: 'fw', type: 'factor', mode: 'A', indicators: ['y1', 'y2', 'y3'] },
    ...['x1', 'x2', 'x3'].map((x) => ({ name: x, type: 'factor' as const, mode: 'A' as const, indicators: [x], covariate: true })),
  ],
  paths: ['x1', 'x2', 'x3'].map((x) => ({ from: x, to: 'fw' })),
  cluster: 'cluster',
};

async function data() {
  const raw = await rCall<{ names: string[]; cols: (number | null)[][] }>('ps_dataset', { package: 'lavaan', name: 'Demo.twolevel', na: [] }, 'lavaan');
  return { names: raw.names, cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))) };
}

it.each(['ML', 'MLR'] as const)('%s with sampling clusters reproduces lavaan’s cluster-robust standard errors', async (est) => {
  const d = await data();
  const r = await estimateCbLavaan(d, spec, 'casewise', est, 'product');
  expect(r.converged).toBe(true);
  const want = ref[est];
  for (const x of want.estimates) {
    const e = r.estimates.find((q) => q.lhs === x.lhs && q.op === x.op && q.rhs === x.rhs)!;
    expect(e, `${x.lhs} ${x.op} ${x.rhs}`).toBeTruthy();
    expect(e.est).toBeCloseTo(x.est, 5);
    if (x.se > 0) expect(e.se, `SE ${x.lhs} ${x.op} ${x.rhs}`).toBeCloseTo(x.se, 5); else expect(e.se).toBeNull();
  }
  // Not the plain standard errors: the clustering matters for some of them.
  const shifts = want.estimates.filter((x) => x.se > 0).map((x) => Math.abs(r.estimates.find((q) => q.lhs === x.lhs && q.op === x.op && q.rhs === x.rhs)!.se! - ref.plainSE[`${x.lhs} ${x.op} ${x.rhs}`]));
  expect(Math.max(...shifts)).toBeGreaterThan(1e-3);
  expect(r.fit.chisq).toBeCloseTo(want.chisq, 4);
  expect(r.fit.df).toBe(want.df);
  if (est === 'MLR') expect(r.fit.chisqScaled).toBeCloseTo(want.chisqScaled!, 4);
  expect(r.notes?.some((n) => /robust to the clustering of cases by cluster/.test(n))).toBe(true);
  expect(r.seType).toMatch(/^robust\.cluster/);
  const script = await cbScriptLavaan(d, spec, 'casewise', est, 'product');
  expect(script).toContain('cluster = "cluster"');
  expect(script).toContain('TYPE = COMPLEX');
}, 600_000);
