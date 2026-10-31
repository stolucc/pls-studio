// The three built-in examples (customer survey, Stol et al. 2022, political
// democracy) run clean: no warning and no note from R, with every engine
// they offer. Run with npm run test:webr.

import { afterAll, beforeAll, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, toSpec } from '../model/project';
import { estimateCbLavaan } from '../rengine/lavaan';
import { estimatePlsR } from '../rengine/pls';
import { startTestRuntime, stopTestRuntime } from '../rengine/webrTestRuntime';
import { makeSample } from '../sample';
import { makeEmseExample } from './emse';
import { makePoldemExample } from './poldem';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

it('customer experience: PLS with cSEM and seminr, PLSc, and CB-SEM, without a note', async () => {
  const { data, model } = makeSample();
  const spec = toSpec(model);
  for (const [pkg, consistent] of [['cSEM', false], ['seminr', false], ['cSEM', true]] as const) {
    const r = await estimatePlsR(data, spec, { scheme: 'path', consistent, missing: 'mean', tolerance: 1e-7, maxIter: 300 }, pkg);
    expect(r.converged, `${pkg} ${consistent}`).toBe(true);
    expect(r.warnings, `${pkg} ${consistent}`).toEqual([]);
    expect(r.notes, `${pkg} ${consistent}`).toEqual([]);
  }
  const cb = await estimateCbLavaan(data, spec, 'casewise', 'ML', 'product');
  expect(cb.converged).toBe(true);
  expect(cb.warnings).toEqual([]);
  expect(cb.notes).toEqual([]);
}, 600_000);

it('Stol et al. (2022) and political democracy: CB-SEM as their sources, without a warning', async () => {
  const emse = makeEmseExample(DEFAULT_SETTINGS);
  const e = await estimateCbLavaan(emse.data, toSpec(emse.model), emse.settings.missing, 'MLM', 'product');
  expect(e.converged).toBe(true);
  expect(e.warnings).toEqual([]);
  expect(e.notes).toEqual([]);
  // Omega and alpha come from the factors' CFA (the model has observed covariates, which semTools cannot handle).
  expect(e.reliability.filter((r) => typeof r.omega === 'number' && typeof r.alpha === 'number').length).toBeGreaterThanOrEqual(3);
  const pd = makePoldemExample(DEFAULT_SETTINGS);
  const p = await estimateCbLavaan(pd.data, toSpec(pd.model), pd.settings.missing, 'ML', 'product');
  expect(p.converged).toBe(true);
  expect(p.warnings).toEqual([]);
  expect(p.notes).toEqual([]);
}, 600_000);
