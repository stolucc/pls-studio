// Mplus User's Guide, chapter 3: the examples in webR against what their Mplus outputs print
// (see testkit.ts). Run with npm run test:webr.

import { afterAll, beforeAll, expect, it } from 'vitest';
import type { CbEstimator } from '../../engine/cbsem';
import { DEFAULT_SETTINGS, toSpec } from '../../model/project';
import { cbScriptLavaan, estimateCbLavaan } from '../../rengine/lavaan';
import { regressionR, type Coefficient } from '../../rengine/regression';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { near, same } from '../../validation/record';
import { exampleModel } from '../packages';
import { evidence, example, load, MPLUS, samePrinted, TOL } from './testkit';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const panelOf = (key: string) => {
  const { kind: _k, ...opts } = example(key).panel as Extract<NonNullable<ReturnType<typeof example>['panel']>, { kind: 'regression' }>;
  return { ...opts, confidence: 0.95 };
};

it.each([['ex3.1'], ['ex3.5'], ['ex3.7']])('%s: the regression card reproduces the Mplus coefficients and log-likelihood', async (key) => {
  evidence(key, 'Regression', ['stats']);
  const r = await regressionR(load(key), panelOf(key));
  if (key === 'ex3.7') expect(r.se).toBe('HC0');
  const want = MPLUS[key];
  near('log-likelihood', r.fit.logLik, want.fit.logl!, 0.001);
  near('AIC', r.fit.aic, want.fit.aic!, 0.002);
  const coef = (term: string) => r.coefficients.find((c) => c.term === term)!;
  for (const p of want.estimates) {
    // (Mplus: u1 ON x1 is the slope; the intercept of a count or continuous outcome, the threshold of a binary one (its negative))
    const c = p.op === '~' ? coef(p.rhs) : p.op === '~1' ? coef('(Intercept)') : p.op === '|' ? { ...coef('(Intercept)'), est: -coef('(Intercept)').est } : null;
    if (!c) continue;  // the residual variance (ex3.1): the card reports the least-squares residual SD instead (see the description)
    near(`${p.lhs} ${p.op} ${p.rhs}`, c.est, p.est, TOL);
    // 3.1: least-squares SEs (N − 3) are within 0.001 of Mplus's ML ones; 3.7: Mplus's MLR = the card's HC0 sandwich.
    near(`SE of ${p.lhs} ${p.op} ${p.rhs}`, c.se, p.se, TOL);
  }
}, 600_000);

/**
 * Censored, censored-inflated, multinomial, zero-inflated and negative binomial regressions (Mplus's default MLR,
 * the card's HC0): the fit, and every parameter Mplus prints. `u1#k` is the inflation (inflated models) or the
 * k-th category against the last (multinomial: the data's categories are 0, 1, 2, so u1#1 is level 0).
 */
it.each([['ex3.2', 'survival'], ['ex3.3', 'stats'], ['ex3.6', 'nnet'], ['ex3.8part1', 'stats'], ['ex3.8part2', 'MASS']])('%s: the regression card reproduces the Mplus output: fit, estimates and standard errors (%s)', async (key, pkg) => {
  evidence(key, 'Regression', [pkg]);
  const opts = panelOf(key);
  const r = await regressionR(load(key), opts);
  expect(r.se).toBe('HC0');
  expect(r.warnings).toEqual([]);
  const want = MPLUS[key];
  same('free parameters', r.fit.npar, want.fit.npar!);
  near('log-likelihood', r.fit.logLik, want.fit.logl!, 0.001);
  near('AIC', r.fit.aic, want.fit.aic!, 0.002);
  near('BIC', r.fit.bic, want.fit.bic!, 0.002);
  const y = opts.outcome;
  const find = (lhs: string, term: string): Coefficient => {
    const k = lhs === y ? 0 : Number(lhs.slice(y.length + 1));
    const c = r.coefficients.find((e) => e.term === term && (k === 0 ? !e.part && !e.level : opts.family === 'multinomial' ? e.level === String(k - 1) : e.part === 'inflation'));
    expect(c, `${lhs}: ${term}`).toBeTruthy();
    return c!;
  };
  let n = 0;
  for (const p of want.estimates) {
    const label = `${p.lhs} ${p.op} ${p.rhs}`;
    let est: number, se: number;
    if (p.op === '~') ({ est, se } = find(p.lhs, p.rhs));
    else if (p.op === '~1') ({ est, se } = find(p.lhs, '(Intercept)'));
    else if (p.op === '~~') { est = r.fit.residualVariance!; se = r.fit.residualVarianceSe!; }
    // (Mplus's negative-binomial dispersion α is 1/θ; its standard error by the delta method)
    else if (p.op === 'Dispersion') { est = 1 / r.fit.theta!; se = r.fit.thetaSe! / r.fit.theta! ** 2; }
    else throw new Error(`Unexpected parameter ${label}`);
    near(label, est, p.est, TOL);
    near(`SE of ${label}`, se, p.se, TOL);
    n++;
  }
  expect(n).toBe(want.estimates.length);
}, 600_000);

it('ex3.4: the probit regression with WLSMV (lavaan, u1 ordered) reproduces the Mplus estimates and standard errors', async () => {
  const ex = example('ex3.4');
  evidence('ex3.4', 'CB-SEM', ['lavaan']);
  const st = { ...DEFAULT_SETTINGS, ...ex.settings };
  const r = await estimateCbLavaan(load('ex3.4'), toSpec(exampleModel(ex)), 'casewise', st.estimator as CbEstimator, 'product');
  expect(r.converged).toBe(true);
  const want = MPLUS['ex3.4'];
  same('free parameters', r.fit.npar, want.fit.npar!);
  same('df', r.fit.df, want.fit.df!);
  samePrinted(r.estimates, want.estimates, 'ex3.4');
  // (the ordinal outcome's construct is the systematic part of its latent response: no disturbance of its own)
  expect(await cbScriptLavaan(load('ex3.4'), toSpec(exampleModel(ex)), 'casewise', 'WLSMV')).toMatch(/u1_lv ~~ 0\*u1_lv/);
}, 600_000);
