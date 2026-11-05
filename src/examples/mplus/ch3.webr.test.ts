// Mplus User's Guide, chapter 3: the examples in webR against what their Mplus outputs print
// (see testkit.ts). Run with npm run test:webr.

import { afterAll, beforeAll, expect, it } from 'vitest';
import { regressionR } from '../../rengine/regression';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { near } from '../../validation/record';
import { evidence, example, load, MPLUS, TOL } from './testkit';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

it.each([['ex3.1'], ['ex3.5'], ['ex3.7']])('%s: the regression card reproduces the Mplus coefficients and log-likelihood', async (key) => {
  const ex = example(key);
  evidence(key, 'Regression', ['stats']);
  const { kind: _k, ...opts } = ex.panel as Extract<NonNullable<typeof ex.panel>, { kind: 'regression' }>;
  const r = await regressionR(load(key), { ...opts, confidence: 0.95 });
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
