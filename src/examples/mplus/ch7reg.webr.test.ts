// Mplus User's Guide, chapter 7: the mixtures whose classes reduce to a regression card (7.25: zero-inflated
// Poisson; 7.30: Cox regression with observed classes), in webR against what their Mplus outputs print
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

it('ex7.25: the zero-inflated Poisson regression reproduces the two-class Mplus model: fit, estimates and standard errors', async () => {
  evidence('ex7.25', 'Regression', ['stats']);
  const r = await regressionR(load('ex7.25'), panelOf('ex7.25'));
  expect(r.se).toBe('HC0');
  const want = MPLUS['ex7.25'];
  same('free parameters', r.fit.npar, want.fit.npar!);
  near('log-likelihood', r.fit.logLik, want.fit.logl!, TOL);
  near('AIC', r.fit.aic, want.fit.aic!, 0.002);
  near('BIC', r.fit.bic, want.fit.bic!, 0.002);
  let n = 0;
  for (const p of want.estimates) {
    if (p.block === 'Latent Class 1') continue; // the structural zeros: fixed (u1 at −15, no slopes)
    // (class 2: the Poisson part; c#1: the inflation, the logit of the structural-zero class)
    const inflation = p.lhs === 'c#1';
    const term = p.op === '~1' ? '(Intercept)' : p.rhs;
    const c = r.coefficients.find(
      (e) => e.term === term && (inflation ? e.part === 'inflation' : !e.part),
    )!;
    expect(c, `${p.lhs} ${p.op} ${p.rhs}`).toBeTruthy();
    near(`${p.lhs} ${p.op} ${p.rhs} (${p.block})`, c.est, p.est, TOL);
    near(`SE of ${p.lhs} ${p.op} ${p.rhs} (${p.block})`, c.se, p.se, TOL);
    n++;
  }
  expect(n).toBe(6);
}, 600_000);

it('ex7.30: Cox regression on x and the observed class reproduces the Mplus estimates, MLR standard errors and (by Mplus’s convention) the log-likelihood', async () => {
  evidence('ex7.30', 'Regression', ['survival']);
  const d = load('ex7.30');
  const r = await regressionR(d, panelOf('ex7.30'));
  expect(r.warnings).toEqual([]);
  const want = MPLUS['ex7.30'];
  const coef = (t: string) => r.coefficients.find((e) => e.term === t)!;
  const get = (p: { lhs: string; op: string; block: string }) =>
    p.op === '~' ? coef('x') : p.lhs === 't' && p.block === 'Latent Class 2' ? coef('u') : null;
  for (const p of want.estimates) {
    const c = get(p);
    if (!c) continue;
    near(`${p.lhs} ${p.op} ${p.rhs} (${p.block})`, c.est, p.est, TOL);
    near(`SE of ${p.lhs} ${p.op} ${p.rhs} (${p.block})`, c.se, p.se, TOL);
  }
  // The classes are the observed groups (thresholds ±15): c#1 = log(n(u = 0) / n(u = 1)), its SE that of a logit of a proportion.
  const col = (n: string) => Array.from(d.cols[d.names.indexOf(n)]);
  const u = col('u'),
    t = col('t'),
    cens = col('tcent');
  const n1 = u.filter((v) => v === 1).length,
    n0 = u.length - n1;
  const cint = want.estimates.find((p) => p.lhs === 'c#1')!;
  near('c#1 (log ratio of the group sizes)', Math.log(n0 / n1), cint.est, TOL);
  near('SE of c#1', Math.sqrt(1 / n0 + 1 / n1), cint.se, TOL);
  // Mplus's log-likelihood: the partial log-likelihood, minus the events, minus log(distance of each event time to the
  // previous observed time), plus the binomial log-likelihood of u.
  const times = [...new Set(t)].sort((a, b) => a - b);
  let gaps = 0,
    events = 0;
  t.forEach((ti, i) => {
    if (cens[i] === 0) {
      events++;
      const k = times.indexOf(ti);
      gaps += Math.log(ti - (k > 0 ? times[k - 1] : 0));
    }
  });
  same('events', r.fit.events!, events);
  const binom = n0 * Math.log(n0 / u.length) + n1 * Math.log(n1 / u.length);
  near(
    'log-likelihood (Mplus’s convention)',
    r.fit.logLik - events - gaps + binom,
    want.fit.logl!,
    TOL,
  );
}, 600_000);
