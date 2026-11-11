// Mplus User's Guide, chapter 6: growth with individually varying times and a random slope of a time-varying
// covariate (TYPE = RANDOM) on the multilevel regression card, in webR against the printed Mplus output
// (see testkit.ts): nlme with a residual variance per occasion, Mplus's robust standard errors (MLR).
// Run with npm run test:webr.

import { afterAll, beforeAll, expect, it } from 'vitest';
import { lmmScriptR } from '../../rengine/mixed';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { exampleData, lmmPanel, runLmm, samePrintedLmm, type Where } from './lmmkit';
import { evidence, type Printed } from './testkit';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

it('ex6.12: wide data, individually varying times, a random slope of a time-varying covariate (nlme, MLR) reproduce the Mplus output', async () => {
  evidence('ex6.12', 'Longitudinal', ['nlme']);
  const r = await runLmm('ex6.12');
  expect(r.engine.package).toBe('nlme');
  expect(r.levels).toEqual([{ name: 'Person', units: 500 }]);
  expect(r.n).toBe(2000);
  const name: Record<string, string> = { i: 'Intercept', s: 'a1', st: 'a2' };
  const where = (p: Printed): Where => {
    if (p.op === '~') return { fixed: p.lhs === 'i' ? 'x' : `${name[p.lhs]} × x` };
    if (p.op === '~1') return { fixed: name[p.lhs] };
    if (/^y\d$/.test(p.lhs)) return { group: 'Residual', a: p.lhs };
    return p.lhs !== p.rhs
      ? { group: 'Person', a: 'Intercept', b: 'a1' }
      : { group: 'Person', a: name[p.lhs] };
  };
  samePrintedLmm('ex6.12', r, where);
  // The script runs on its own: nlme's lme with varIdent and pdBlocked, and the MLR sandwich.
  const script = await lmmScriptR(exampleData('ex6.12'), lmmPanel('ex6.12'));
  expect(script).toContain('weights = varIdent(form = ~ 1 |');
  expect(script).toContain('pdBlocked(list(pdSymm(~ 1 + a1), pdDiag(~ 0 + a2)))');
  expect(script).toContain('mlr <- mlr_fit(');
}, 600_000);
