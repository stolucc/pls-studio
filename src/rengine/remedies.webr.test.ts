// The Troubleshoot tab's lavaan remedies (model/troubleshoot.ts): simple starting values and the BFGS optimiser
// reach lavaan (start = "simple", optim.method = "BFGS"), are in the R script, and on a model that converges either
// way leave the solution as it is; rescaling a variable of a covariance matrix (and its NACOV) changes no fit
// measure or standardised estimate. Run with npm run test:webr.

import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Dataset } from '../engine/types';
import { makeEmseExample } from '../examples/emse';
import { DEFAULT_SETTINGS, toSpec, type ModelState } from '../model/project';
import { rescaleMoments, swapRescaled } from '../model/troubleshoot';
import { rCall } from './bridge';
import { cbScriptLavaan, estimateCbLavaan } from './lavaan';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

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
const HS: ModelState = {
  constructs: [
    C('visual', ['x1', 'x2', 'x3']),
    C('textual', ['x4', 'x5', 'x6']),
    C('speed', ['x7', 'x8', 'x9']),
  ],
  paths: [],
  moderations: [],
  correlations: [
    { id: 'k1', kind: 'construct', a: 'visual', b: 'textual' },
    { id: 'k2', kind: 'construct', a: 'visual', b: 'speed' },
    { id: 'k3', kind: 'construct', a: 'textual', b: 'speed' },
  ],
};

it('simple starting values and BFGS: passed to lavaan, written in the script, the same solution (Holzinger & Swineford)', async () => {
  const raw = await rCall<{ names: string[]; cols: (number | null)[][] }>(
    'ps_dataset',
    { package: 'lavaan', name: 'HolzingerSwineford1939', na: [] },
    'lavaan',
  );
  const data: Dataset = {
    names: raw.names,
    cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))),
  };
  const tried: ModelState = { ...HS, startValues: 'simple', optimizer: 'BFGS' };
  const plain = await estimateCbLavaan(data, toSpec(HS), 'casewise', 'ML');
  const remedied = await estimateCbLavaan(data, toSpec(tried), 'casewise', 'ML');
  expect(remedied.converged).toBe(true);
  expect(remedied.warnings).toEqual([]);
  // (lavaan's tutorial: χ² = 85.306 on 24 df, whichever start and optimiser)
  expect(remedied.fit.chisq).toBeCloseTo(85.306, 2);
  expect(remedied.fit.df).toBe(24);
  for (const e of plain.estimates) {
    const same = remedied.estimates.find(
      (x) => x.lhs === e.lhs && x.op === e.op && x.rhs === e.rhs,
    )!;
    expect(same.est, `${e.lhs} ${e.op} ${e.rhs}`).toBeCloseTo(e.est, 3);
  }
  const script = await cbScriptLavaan(data, toSpec(tried), 'casewise', 'ML');
  expect(script).toContain('start = "simple"');
  expect(script).toContain('optim.method = "BFGS"');
  expect(await cbScriptLavaan(data, toSpec(HS), 'casewise', 'ML')).not.toContain('optim.method');
}, 600_000);

it('rescaling a covariance-matrix dataset (Stol et al. 2022, MLM with NACOV): the same fit and standardised estimates', async () => {
  const e = makeEmseExample(DEFAULT_SETTINGS);
  const data = rescaleMoments(e.data, 'num_challenges_solved', 10, 'num_challenges_solved_div10');
  const model = swapRescaled(e.model, 'num_challenges_solved', 'num_challenges_solved_div10');
  const before = await estimateCbLavaan(
    e.data,
    toSpec(e.model),
    e.settings.missing,
    'MLM',
    'product',
  );
  const after = await estimateCbLavaan(data, toSpec(model), e.settings.missing, 'MLM', 'product');
  expect(after.converged).toBe(true);
  // (to the optimiser's precision: the rescaled problem reaches the same minimum by a slightly different path)
  expect(after.fit.chisq).toBeCloseTo(before.fit.chisq, 3);
  expect(after.fit.chisqScaled!).toBeCloseTo(before.fit.chisqScaled!, 3);
  expect(after.fit.cfi).toBeCloseTo(before.fit.cfi, 5);
  const rename = (x: string) => (x === 'num_challenges_solved' ? 'num_challenges_solved_div10' : x);
  for (const b of before.estimates) {
    const a = after.estimates.find(
      (x) => x.lhs === rename(b.lhs) && x.op === b.op && x.rhs === rename(b.rhs),
    )!;
    expect(a.std, `${b.lhs} ${b.op} ${b.rhs}`).toBeCloseTo(b.std, 3);
    expect(a.z ?? 0, `z of ${b.lhs} ${b.op} ${b.rhs}`).toBeCloseTo(b.z ?? 0, 2);
  }
}, 600_000);
