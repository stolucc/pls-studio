// Mplus User's Guide, chapter 6: the examples in webR against what their Mplus outputs print
// (see testkit.ts). Run with npm run test:webr.

import { afterAll, beforeAll, expect, it } from 'vitest';
import { growthInput } from '../../analyses/longitudinal';
import { DEFAULT_SETTINGS } from '../../model/project';
import { growthR } from '../../rengine/longitudinal';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { exampleModel } from '../packages';
import { evidence, example, load, MPLUS, sameFit, samePrinted } from './testkit';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

it.each([['ex6.1'], ['ex6.8'], ['ex6.9'], ['ex6.10']])('%s: the growth card reproduces the Mplus output: fit, estimates and standard errors', async (key) => {
  const ex = example(key);
  evidence(key, 'Longitudinal', ['lavaan']);
  const { kind: _k, ...opts } = ex.panel as Extract<NonNullable<typeof ex.panel>, { kind: 'growth' }>;
  const input = growthInput({ ...opts, timeVarying: opts.timeVarying ?? [] }, { settings: { ...DEFAULT_SETTINGS, ...ex.settings, missing: 'casewise' }, model: exampleModel(ex) });
  expect(input.information).toBe('observed');
  const r = await growthR(load(key), input);
  const want = MPLUS[key];
  sameFit(r.fit, want.fit);
  samePrinted(r.estimates, want.estimates, key);
}, 600_000);
