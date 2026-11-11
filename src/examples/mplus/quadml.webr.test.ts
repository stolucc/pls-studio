// Mplus User's Guide: the models fitted by numerical integration on the integration card (quadml.ts), in webR against
// what their Mplus outputs print (see testkit.ts): fit, every parameter and its standard error. Each example is run
// through the card's own run() on the example's data (with its computed columns). Where Mplus integrates by Monte
// Carlo (3.17, 11.3), stops short of its maximum (5.7) or its MLR standard errors differ, the tolerances below are
// those stated, with the evidence, in the examples' descriptions. Run with npm run test:webr.

import { afterAll, beforeAll, expect } from 'vitest';
import type { QuadResult } from '../../rengine/quadml';
import { itIfFast } from '../../rengine/webrSlow';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { near } from '../../validation/record';
import {
  evidence,
  MPLUS,
  runCards,
  sameFit,
  samePrinted,
  type Mine,
  type Printed,
} from './testkit';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

/** Per example: the estimates' and standard errors' tolerances, the log-likelihood's (Mplus's three decimals by default). */
const TOLS: Record<
  string,
  {
    est?: number;
    se?: number;
    logl?: number;
    estOf?: (p: Printed) => number | undefined;
    seOf?: (p: Printed) => number | undefined;
  }
> = {
  // (Mplus: Monte Carlo integration with 250 points; the card's exact likelihood)
  'ex3.17': { est: 0.005, logl: 0.08 },
  // (Mplus stops before the maximum of its own rule, on a flat likelihood)
  'ex5.7': { est: 0.02, se: 0.005, logl: 0.009 },
  // (Mplus's convergence criterion)
  'ex6.3': { est: 0.0022, logl: 0.003 },
  'ex6.16': { est: 0.0013 },
  // (the loadings within 0.002; the MLR standard error of f's residual variance 0.607 against 0.597)
  'ex6.22': { est: 0.002, seOf: (p) => (p.lhs === 'f' && p.rhs === 'f' ? 0.011 : 0.002) },
  // (Mplus: Monte Carlo integration with 1250 points; the dropout logits move most)
  'ex11.3': {
    est: 0.021,
    se: 0.006,
    logl: 0.16,
    estOf: (p) => (/^d\d$/.test(p.lhs) ? 0.021 : 0.002),
  },
};

// (6.3 and 11.3 take minutes: with WEBR_SLOW)
for (const key of ['ex3.17', 'ex5.4', 'ex5.7', 'ex6.2', 'ex6.3', 'ex6.16', 'ex6.22', 'ex11.3'])
  itIfFast(key === 'ex6.3' || key === 'ex11.3')(
    `${key}: the integration card reproduces the Mplus output: fit, every estimate and standard error`,
    async () => {
      const t0 = Date.now();
      evidence(key, 'Integration ML', ['R']);
      const [r] = await runCards<QuadResult>(key);
      const want = MPLUS[key],
        tol = TOLS[key] ?? {};
      expect(r.converged).toBe(true);
      const logl = tol.logl ?? 0.002;
      sameFit({ npar: r.npar }, { npar: want.fit.npar });
      near('log-likelihood', r.logLik, want.fit.logl!, logl);
      near('AIC', r.aic, want.fit.aic!, 2 * logl);
      near('BIC', r.bic, want.fit.bic!, 2 * logl);
      // (base hazards: Mplus's t#k, printed in the fixture as t#k ~~ t#k)
      const mine: Mine[] = r.params.map((p) =>
        p.op === 'hazard'
          ? { lhs: p.lhs, op: '~~', rhs: p.lhs, est: p.est, se: p.se }
          : {
              lhs: p.lhs,
              op: p.op,
              rhs: p.rhs,
              est: p.est,
              se: p.se,
              kind: p.op === '|' ? 'threshold' : undefined,
            },
      );
      const groups = new Map<string, Printed[]>();
      for (const p of want.estimates) {
        const k = `${tol.estOf?.(p) ?? tol.est ?? 0.001}|${tol.seOf?.(p) ?? tol.se ?? 0.001}`;
        groups.set(k, [...(groups.get(k) ?? []), p]);
      }
      for (const [k, ps] of groups) {
        const [e, s] = k.split('|').map(Number);
        samePrinted(mine, ps, key, { tol: e, seTol: s });
      }
      expect(r.warnings).toEqual([]);
      console.log(key, `${Math.round((Date.now() - t0) / 1000)} s`);
    },
    900_000,
  );
