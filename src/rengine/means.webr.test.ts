// The mean structure (the constant on the canvas) against lavaan run natively
// (scripts/validation/means.R): a free latent mean with its marker intercept
// fixed at 0, an observed covariate's intercept, every indicator intercept.
// Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { ModelSpec } from '../engine/types';
import { rCall } from './bridge';
import { cbScriptLavaan, estimateCbLavaan } from './lavaan';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const ref = JSON.parse(readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'means', 'reference.json'), 'utf8')) as { chisq: number; df: number; intercepts: { lhs: string; est: number; se: number; std: number }[] };

const spec: ModelSpec = {
  constructs: [
    { name: 'visual', type: 'factor', mode: 'A', indicators: ['x1', 'x2', 'x3'] },
    { name: 'textual', type: 'factor', mode: 'A', indicators: ['x4', 'x5', 'x6'] },
    { name: 'ageyr', type: 'factor', mode: 'A', indicators: ['ageyr'], covariate: true },
  ],
  paths: [{ from: 'visual', to: 'textual' }, { from: 'ageyr', to: 'textual' }],
  meanStructure: true,
  // One arrow, visual's latent mean; ageyr's intercept comes with the mean structure (lavaan fixes an
  // exogenous covariate's mean at the sample mean, fixed.x); an arrow to it would estimate it freely.
  means: [{ construct: 'visual' }],
};

it('estimates a latent mean and intercepts as lavaan does (meanstructure = TRUE)', async () => {
  const raw = await rCall<{ names: string[]; cols: (number | null)[][] }>('ps_dataset', { package: 'lavaan', name: 'HolzingerSwineford1939', na: [] }, 'lavaan');
  const data = { names: raw.names, cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))) };
  const r = await estimateCbLavaan(data, spec, 'casewise', 'ML', 'product');
  expect(r.converged).toBe(true);
  expect(r.fit.chisq).toBeCloseTo(ref.chisq, 4);
  expect(r.fit.df).toBe(ref.df);
  const means = r.estimates.filter((e) => e.kind === 'mean' || e.kind === 'intercept');
  for (const x of ref.intercepts) {
    const e = means.find((m) => m.lhs === x.lhs)!;
    expect(e, x.lhs).toBeTruthy();
    expect(e.est, x.lhs).toBeCloseTo(x.est, 4);  // (webR and native R optimise to slightly different tolerances)
    if (x.se > 0) expect(e.se, x.lhs).toBeCloseTo(x.se, 4); else expect(e.se).toBeNull();
    expect(e.kind).toBe(x.lhs === 'visual' || x.lhs === 'textual' ? 'mean' : 'intercept');
  }
  // The script says what it does: the marker intercept fixed, the mean structure on.
  const script = await cbScriptLavaan(data, spec, 'casewise', 'ML', 'product');
  expect(script).toContain('visual ~ 1');
  expect(script).toContain('x1 ~ 0*1');
  expect(script).toContain('meanstructure = TRUE');
}, 600_000);
