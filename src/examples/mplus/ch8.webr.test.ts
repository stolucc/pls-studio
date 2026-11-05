// Mplus User's Guide, chapter 8: the growth mixture and latent class growth examples in webR against what their Mplus
// outputs print (see testkit.ts and mixturekit.ts). Run with npm run test:webr.

import { afterAll, beforeAll, expect, it } from 'vitest';
import { lcaSpec } from '../../analyses/items';
import { gmmInput } from '../../analyses/longitudinal';
import { DEFAULT_SETTINGS } from '../../model/project';
import { lcaR } from '../../rengine/items';
import { gmmR } from '../../rengine/mixed';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { same } from '../../validation/record';
import { sameClasses, sameGmm } from './mixturekit';
import { evidence, example, load, MPLUS, sameFit, TOL } from './testkit';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

it.each([['ex8.9'], ['ex8.10']])('%s: the latent class card’s growth model reproduces the Mplus output: fit, thresholds and growth factor means', async (key) => {
  const ex = example(key);
  const p = ex.panel as Extract<NonNullable<typeof ex.panel>, { kind: 'lca' }>;
  evidence(key, 'Items', ['R']);
  expect(p.model).toBe('lcga');
  const r = await lcaR(load(key), p.items, [p.from], 10, DEFAULT_SETTINGS.seed, lcaSpec(p));
  const m = r.models[0];
  same('classes', m.k, p.from);
  sameFit({ npar: m.npar, logl: m.llik, aic: m.aic, bic: m.bic }, MPLUS[key].fit);
  sameClasses(m, p.items, MPLUS[key].estimates, () => TOL);
}, 600_000);

it.each([['ex8.1'], ['ex8.2']])('%s: the growth mixture card (a residual variance per occasion) reproduces the Mplus output: fit and every estimate', async (key) => {
  const ex = example(key);
  evidence(key, 'Longitudinal', ['R']);
  const { kind: _k, ...opts } = ex.panel as Extract<NonNullable<typeof ex.panel>, { kind: 'gmm' }>;
  const input = gmmInput(opts, DEFAULT_SETTINGS.seed);
  expect(input).toMatchObject({ format: 'wide', residuals: 'occasion', membership: ['x'] });
  const r = await gmmR(load(key), input);
  const m = r.models.find((x) => x.k === 2)!;
  expect(m.converged).toBe(true);
  sameFit({ npar: m.npar, logl: m.logLik, aic: m.aic, bic: m.bic }, MPLUS[key].fit);
  sameGmm(m, MPLUS[key].estimates, TOL);
}, 600_000);
