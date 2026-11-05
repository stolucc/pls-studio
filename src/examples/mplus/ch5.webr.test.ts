// Mplus User's Guide, chapter 5: the examples in webR against what their Mplus outputs print
// (see testkit.ts). Run with npm run test:webr.

import { afterAll, beforeAll, expect, it } from 'vitest';
import type { CbEstimator } from '../../engine/cbsem';
import { DEFAULT_SETTINGS, toSpec } from '../../model/project';
import { estimateCbLavaan } from '../../rengine/lavaan';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { near, same } from '../../validation/record';
import { exampleModel } from '../packages';
import { evidence, example, load, MPLUS, sameFit, samePrinted } from './testkit';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

it.each([['ex3.11'], ['ex5.1'], ['ex5.2'], ['ex5.6'], ['ex5.8'], ['ex5.11'], ['ex5.14'], ['ex5.15'], ['ex5.25']])('%s reproduces the Mplus output: fit, estimates and standard errors', async (key) => {
  const ex = example(key);
  evidence(key, 'CB-SEM', ['lavaan']);
  const st = { ...DEFAULT_SETTINGS, ...ex.settings };
  const r = await estimateCbLavaan(load(key), toSpec(exampleModel(ex)), 'casewise', st.estimator as CbEstimator, 'product');
  const want = MPLUS[key];
  expect(r.converged).toBe(true);
  if (key === 'ex5.2') {
    // WLSMV: lavaan's scaled-shifted statistic adjusts slightly differently from Mplus's (documented on the card).
    same('free parameters', r.fit.npar, want.fit.npar!);
    same('df', r.fit.df, want.fit.df!);
    near('χ² (WLSMV, scaled and shifted)', r.fit.chisqScaled!, want.fit.chisq!, 0.01);
    // Reliability with ordinal indicators: categorical omega and ordinal alpha, without a warning from semTools.
    expect(r.warnings).toEqual([]);
    for (const rel of r.reliability) { expect(rel.omega).toBeGreaterThan(0.5); expect(rel.alpha).toBeGreaterThan(0.5); }
  } else sameFit(r.fit, want.fit);
  if (r.groups) {
    expect(r.groups.labels.length).toBe(2);
    for (const g of [1, 2]) samePrinted(r.groups.results[g - 1].estimates, want.estimates.filter((p) => p.group === g), `${key} group ${g}`);
  } else samePrinted(r.estimates, want.estimates, key);
}, 600_000);

it('ex5.13: the latent interaction by LMS reproduces the Mplus estimates to two decimals', async () => {
  const ex = example('ex5.13');
  evidence('ex5.13', 'CB-SEM', ['modsem']);
  const r = await estimateCbLavaan(load('ex5.13'), toSpec(exampleModel(ex)), 'casewise', 'ML', 'lms');
  expect(r.interaction).toBe('lms');
  // Mplus integrates numerically (MLR); modsem's LMS uses its own quadrature (ML): the loadings and paths agree
  // within 0.002, the standard errors and the log-likelihood are not comparable (both documented on the card).
  const mine = r.estimates.map((e) => (e.op === '~' && /f1.*f2|f2.*f1/.test(e.rhs) ? { ...e, rhs: 'f1:f2' } : e));
  samePrinted(mine, MPLUS['ex5.13'].estimates.filter((p) => p.op === '=~' || p.op === '~'), 'ex5.13', { tol: 0.002, ses: false });
}, 600_000);

it('the replication scripts carry the Mplus defaults: observed information, geomin ε, no mean structure, intercepts of observed variables', async () => {
  const { cbScriptLavaan } = await import('../../rengine/lavaan');
  const script = async (key: string) => cbScriptLavaan(load(key), toSpec(exampleModel(example(key))), 'casewise', 'ML');
  const s525 = await script('ex5.25');
  expect(s525).toContain('information = "observed"');
  expect(s525).toContain('rotation.args = list(geomin.epsilon = 0.0001)');
  const s514 = await script('ex5.14');
  expect(s514).toContain('meanstructure = FALSE');
  expect(s514).not.toContain('information = "observed"');
  // An observed variable's intercept on its construct (the indicator's fixed at 0), in one group.
  const s311 = await script('ex3.11');
  expect(s311).toMatch(/y3_lv ~ 1/);
  expect(s311).toMatch(/y3 ~ 0\*1 {3}# the intercept of y3_lv/);
}, 600_000);
