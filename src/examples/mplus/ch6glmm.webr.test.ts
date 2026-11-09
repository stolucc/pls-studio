// Mplus User's Guide, examples 6.6 and 6.7: growth models for counts on the GLMM card (with Mplus's integration rule) in webR against
// what the Mplus outputs print (see testkit.ts). Mplus's growth factors are the random effects: i the intercept,
// s the slope of time; in 6.7 ii is the random intercept of the zero part. Run with npm run test:webr.

import { afterAll, beforeAll, expect, it } from 'vitest';
import { glmmR } from '../../rengine/glmm';
import { glmmMplusR } from '../../rengine/glmmMplus';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { near, same } from '../../validation/record';
import { evidence, example, load, MPLUS } from './testkit';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

it.each([['ex6.6'], ['ex6.7']])('%s: the GLMM card against the Mplus output', async (key) => {
  const ex = example(key);
  const p = ex.panel as Extract<NonNullable<typeof ex.panel>, { kind: 'glmm' }>;
  evidence(key, 'Generalized linear mixed model', p.integration === 'mplus' ? ['R'] : ['GLMMadaptive']);
  const r = await (p.integration === 'mplus' ? glmmMplusR : glmmR)(load(key), p);
  const want = MPLUS[key];
  expect(r.converged).toBe(true);
  same('free parameters', r.npar, want.fit.npar!);
  const est = (lhs: string, op: string, rhs = '') => want.estimates.find((e) => e.lhs === lhs && e.op === op && e.rhs === rhs)!;
  const fx = (t: string) => r.fixed.find((f) => f.term === t)!;
  const rv = (a: string, b?: string, zeroA = false, zeroB = false) => r.random.find((x) => x.a === a && x.b === b && x.zeroA === zeroA && (b === undefined || x.zeroB === zeroB))!;
  const rows: [string, { est: number; se: number }, { est: number; se: number }][] = key === 'ex6.6'
    ? [['i mean', fx('Intercept'), est('i', '~1')], ['s mean', fx('time'), est('s', '~1')], ['i variance', rv('Intercept'), est('i', '~~', 'i')],
      ['s variance', rv('time'), est('s', '~~', 's')], ['i with s', rv('Intercept', 'time'), est('s', '~~', 'i')]]
    : [['i mean', fx('Intercept'), est('i', '~1')], ['s mean', fx('time'), est('s', '~1')], ['zero part intercept (u#1)', r.zero!.find((f) => f.term === 'Intercept')!, est('u11#1', '~1')],
      ['si mean', r.zero!.find((f) => f.term === 'time')!, est('si', '~1')], ['i variance', rv('Intercept'), est('i', '~~', 'i')],
      ['ii variance', rv('Intercept', undefined, true), est('ii', '~~', 'ii')], ['ii with i', r.random.find((x) => x.b)!, est('ii', '~~', 'i')]];
  // With Mplus's integration rule (the card's option) the estimates within 0.001, except 6.7's variance of ii (1.186 against
  // 1.189, SE 0.535: Mplus stops at its convergence criterion on this flat likelihood; see the description), the standard
  // errors within 0.001, and the log-likelihood, AIC and BIC within 0.002.
  const tol = { est: 0.001, se: 0.001, logl: 0.002 };
  for (const [label, mine, m] of rows) {
    near(label, mine.est, m.est, label === 'ii variance' ? 0.004 : tol.est);
    near(`SE of ${label}`, mine.se, m.se, tol.se);
  }
  near('log-likelihood', r.logLik, want.fit.logl!, tol.logl);
  near('AIC', r.aic, want.fit.aic!, 2 * tol.logl);
  near('BIC', r.bic, want.fit.bic!, 2 * tol.logl);
  expect(r.warnings).toEqual([]);
}, 1_800_000);
