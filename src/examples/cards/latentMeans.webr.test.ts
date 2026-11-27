// Latent mean differences as effect sizes (cards/invariance.ts: lavaan-hs-guided-means): the guided invariance card
// on Holzinger & Swineford by school, run as the app opens it, with the intercepts of x3 and x7 freed; its latent
// mean differences, Hancock's (2001) d over the pooled factor SD and the N for 80% power against desktop lavaan with
// plain group.equal / group.partial (scripts/validation/guided_invariance.R → src/engine/__fixtures__/invariance/
// guided.json, case hsML). Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { latentMeanEffect } from '../../analyses/guidedInvarianceLogic';
import type { GuidedInvarianceResult } from '../../rengine/invariance';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { against, near, same } from '../../validation/record';
import { open } from './modelHarness';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const REF = JSON.parse(
  readFileSync(
    join(__dirname, '..', '..', 'engine', '__fixtures__', 'invariance', 'guided.json'),
    'utf8',
  ),
).cases.hsML;

it('lavaan-hs-guided-means: partial scalar invariance, the latent mean differences, Hancock’s d and the N for 80% power', async () => {
  const { run } = await open('lavaan-hs-guided-means', 'CB-SEM', ['lavaan', 'semTools']);
  const r = await run<GuidedInvarianceResult>();
  against({
    label: 'scripts/validation/guided_invariance.R: lavaan 0.7-3 group.equal / group.partial',
    level: 'native',
  });
  same('steps', r.steps.map((s) => s.step).join(' '), 'configural metric scalar');
  expect(r.steps.every((s) => s.converged)).toBe(true);
  same('factors compared', r.means.map((m) => m.factor).join(' '), 'visual textual speed');
  r.means.forEach((m, k) => {
    near(`${m.factor}: latent mean difference`, m.est, REF.meanEst[k], 1e-5);
    near(`${m.factor}: its SE`, m.se, REF.meanSe[k], 1e-5);
    const e = latentMeanEffect(m, r);
    near(`${m.factor}: Hancock’s d`, e.d, REF.hancockD[k], 1e-5);
    near(`${m.factor}: lower limit of d`, e.lo, REF.hancockLo[k], 1e-5);
    near(`${m.factor}: upper limit of d`, e.hi, REF.hancockHi[k], 1e-5);
    near(`${m.factor}: N for 80% power`, e.nFor80, REF.n80[k], 1 + 2e-4 * REF.n80[k]);
  });
}, 600_000);
