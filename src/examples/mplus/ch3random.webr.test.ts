// Mplus User's Guide, example 3.9: a random slope in a one-level regression (TYPE = RANDOM) on the regression
// card, in webR against the printed Mplus output (see testkit.ts). Run with npm run test:webr.

import { afterAll, beforeAll, expect, it } from 'vitest';
import { regressionR } from '../../rengine/regression';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { near, same } from '../../validation/record';
import { exampleData } from './lmmkit';
import { evidence, example, MPLUS, TOL } from './testkit';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

it('ex3.9: the regression card’s random slope (ML, HC0) reproduces the Mplus output', async () => {
  evidence('ex3.9', 'Regression', ['stats']);
  const p = example('ex3.9').panel;
  if (p?.kind !== 'regression') throw new Error('ex3.9 opens a regression card');
  const { kind: _k, ...opts } = p;
  const r = await regressionR(exampleData('ex3.9'), { ...opts, confidence: 0.95 });
  expect(r.se).toBe('HC0');
  expect(r.warnings).toEqual([]);
  const want = MPLUS['ex3.9'];
  same('free parameters', r.fit.npar, want.fit.npar!);
  near('log-likelihood', r.fit.logLik, want.fit.logl!, 0.001);
  near('AIC', r.fit.aic, want.fit.aic!, 0.002);
  near('BIC', r.fit.bic, want.fit.bic!, 0.002);
  // Mplus: y ON x2 and [y] are the mean model's; [s] and s ON x2 the slope of x1c and its interaction with x2c;
  // y (the residual), s and s WITH y the random part.
  const term = (lhs: string, op: string, rhs: string) =>
    op === '~1'
      ? lhs === 'y'
        ? '(Intercept)'
        : 'x1c'
      : op === '~'
        ? lhs === 'y'
          ? 'x2c'
          : 'x1c:x2c'
        : lhs !== rhs
          ? 'Covariance of the slope of x1c and the residual'
          : lhs === 'y'
            ? 'Residual variance'
            : 'Variance of the slope of x1c';
  for (const e of want.estimates) {
    const c = r.coefficients.find((x) => x.term === term(e.lhs, e.op, e.rhs));
    expect(c, `${e.lhs} ${e.op} ${e.rhs}`).toBeDefined();
    near(`${e.lhs} ${e.op} ${e.rhs}`, c!.est, e.est, TOL);
    near(`SE of ${e.lhs} ${e.op} ${e.rhs}`, c!.se, e.se, TOL);
  }
}, 600_000);
