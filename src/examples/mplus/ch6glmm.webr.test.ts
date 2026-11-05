// Mplus User's Guide, examples 6.6 and 6.7: growth models for counts on the GLMM card (GLMMadaptive) in webR against
// what the Mplus outputs print (see testkit.ts). Mplus's growth factors are the random effects: i the intercept,
// s the slope of time; in 6.7 ii is the random intercept of the zero part. Run with npm run test:webr.

import { afterAll, beforeAll, expect, it } from 'vitest';
import { glmmR } from '../../rengine/glmm';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { near, same } from '../../validation/record';
import { evidence, example, load, MPLUS } from './testkit';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

it.each([['ex6.6'], ['ex6.7']])('%s: the GLMM card against the Mplus output', async (key) => {
  const ex = example(key);
  const p = ex.panel as Extract<NonNullable<typeof ex.panel>, { kind: 'glmm' }>;
  evidence(key, 'Generalized linear mixed model', ['GLMMadaptive']);
  const r = await glmmR(load(key), p);
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
  // 6.6: the estimates within 0.0015 and standard errors within 0.0015; 6.7 (Mplus's coarse 7-point integration): see the
  // example's description. Mplus's log-likelihoods are its integration's approximations (see the descriptions).
  const tol = key === 'ex6.6' ? { est: 0.0015, se: 0.0015, logl: 0.02 } : { est: 0.04, se: 0.1, logl: 0.07 };
  for (const [label, mine, m] of rows) {
    near(label, mine.est, m.est, tol.est);
    near(`SE of ${label}`, mine.se, m.se, tol.se);
  }
  near('log-likelihood', r.logLik, want.fit.logl!, tol.logl);
  near('AIC', r.aic, want.fit.aic!, 2 * tol.logl);
  near('BIC', r.bic, want.fit.bic!, 2 * tol.logl);
  expect(r.warnings).toEqual([]);
}, 1_800_000);
