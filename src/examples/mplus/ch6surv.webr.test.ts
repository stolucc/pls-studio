// Mplus User's Guide, chapter 6: the survival examples in webR against what their Mplus outputs print
// (see testkit.ts). Run with npm run test:webr.

import { afterAll, beforeAll, expect, it } from 'vitest';
import { regressionR } from '../../rengine/regression';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { near, same } from '../../validation/record';
import { evidence, example, load, MPLUS, TOL } from './testkit';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const panelOf = (key: string) => {
  const { kind: _k, ...opts } = example(key).panel as Extract<
    NonNullable<ReturnType<typeof example>['panel']>,
    { kind: 'regression' }
  >;
  return { ...opts, confidence: 0.95 };
};

it('ex6.19: discrete-time survival as a logistic regression on person-period data reproduces the Mplus output', async () => {
  evidence('ex6.19', 'Regression', ['stats', 'sandwich']);
  const r = await regressionR(load('ex6.19'), panelOf('ex6.19'));
  expect(r.warnings).toEqual([]);
  expect(r.fit.n).toBe(1545);
  const want = MPLUS['ex6.19'];
  same('free parameters', r.fit.npar, want.fit.npar!);
  near('log-likelihood', r.fit.logLik, want.fit.logl!, 0.001);
  near('AIC', r.fit.aic, want.fit.aic!, 0.002);
  const coef = (term: string) => r.coefficients.find((c) => c.term === term)!;
  const icpt = coef('(Intercept)').est;
  for (const p of want.estimates) {
    const label = `${p.lhs} ${p.op} ${p.rhs}`;
    if (p.se === 0) continue; // (f BY u1-u4@1, f@0: the factor that writes the model, fixed)
    if (p.op === '~') {
      const c = coef('x');
      near(label, c.est, p.est, TOL);
      // (cluster-robust by person: vcovCL's small-sample factor G/(G − 1) keeps it within 0.001 of Mplus's MLR)
      near(`SE of ${label}`, c.se, p.se, TOL);
    } else {
      // A threshold is minus the period's log-odds at x = 0: the intercept plus the period's effect.
      const j = Number(p.lhs.slice(1));
      near(label, -(icpt + (j > 1 ? coef(`period${j}`).est : 0)), p.est, TOL);
      if (j === 1) near(`SE of ${label}`, coef('(Intercept)').se, p.se, TOL);
    }
  }
}, 600_000);

it('ex6.20: Cox regression reproduces the Mplus coefficient and its MLR standard error', async () => {
  evidence('ex6.20', 'Regression', ['survival']);
  const r = await regressionR(load('ex6.20'), panelOf('ex6.20'));
  expect(r.warnings).toEqual([]);
  expect(r.fit.events).toBe(29);
  same('free parameters', r.fit.npar, MPLUS['ex6.20'].fit.npar!);
  const [p] = MPLUS['ex6.20'].estimates;
  const x = r.coefficients.find((c) => c.term === 'x')!;
  near('t ON x', x.est, p.est, TOL);
  // (coxph's robust sandwich = Mplus's MLR; Mplus's log-likelihood is on another basis: see the description)
  near('SE of t ON x', x.se, p.se, TOL);
}, 600_000);

it('ex6.21: the piecewise exponential model reproduces the Mplus output: fit, baseline hazards and standard errors', async () => {
  evidence('ex6.21', 'Regression', ['survival']);
  const r = await regressionR(load('ex6.21'), panelOf('ex6.21'));
  expect(r.warnings).toEqual([]);
  const want = MPLUS['ex6.21'];
  same('free parameters', r.fit.npar, want.fit.npar!);
  near('log-likelihood', r.fit.logLik, want.fit.logl!, 0.001);
  near('AIC', r.fit.aic, want.fit.aic!, 0.002);
  near('BIC', r.fit.bic, want.fit.bic!, 0.002);
  const base = r.coefficients.filter((c) => c.part === 'baseline');
  expect(base.length).toBe(21);
  expect(base[20].term).toBe('[20, Inf)');
  for (const p of want.estimates) {
    // (printed as t ON x, and the baseline hazards [t#k] in interval order)
    const c =
      p.rhs === 'x'
        ? r.coefficients.find((e) => e.term === 'x' && !e.part)!
        : base[Number(p.rhs.slice(2)) - 1];
    near(`${p.lhs} ${p.op} ${p.rhs}`, c.est, p.est, TOL);
    near(`SE of ${p.lhs} ${p.op} ${p.rhs}`, c.se, p.se, TOL);
  }
}, 600_000);
