// Mplus User's Guide, example 5.5 parts 3 and 4: the IRT card's 3PL and 4PL models with priors (mirt) in webR against what the Mplus
// outputs print (see testkit.ts). Run with npm run test:webr.

import { afterAll, beforeAll, expect, it } from 'vitest';
import { irtFit } from '../../analyses/items';
import { DEFAULT_SETTINGS } from '../../model/project';
import { irtR } from '../../rengine/items';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { near, same } from '../../validation/record';
import { evidence, example, load, MPLUS, type Mine } from './testkit';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const panel = (key: string) => example(key).panel as Extract<NonNullable<ReturnType<typeof example>['panel']>, { kind: 'irt' }>;

// Mplus integrates with 15 rectangular points per person (adaptive, ±5 posterior SDs), mirt with 61 fixed points
// (the exact likelihood): refitting with Mplus's rule in desktop R reproduces Mplus's log-likelihood (part 3:
// −64414.662, part 4: −134598.576). The card's exact maximum differs from Mplus's printed estimates within the
// tolerances below, stated in the examples' descriptions; the 4PL's asymptotes are weakly determined.
const TOLS: Record<string, { logl: number; loading: number; t1: number; t2: number; t3: number; se: number }> = {
  'ex5.5part3': { logl: 0.1, loading: 0.002, t1: 0.005, t2: 0.01, t3: 0, se: 0.03 },
  'ex5.5part4': { logl: 0.15, loading: 0.09, t1: 0.01, t2: 0.025, t3: 0.04, se: 0.09 },
};

it.each([['ex5.5part3'], ['ex5.5part4']])('%s: the 3PL / 4PL model with priors (mirt) against the Mplus output', async (key) => {
  evidence(key, 'Item response theory', ['mirt']);
  const p = panel(key);
  const r = await irtR(load(key), p.items, p.model, irtFit(p, DEFAULT_SETTINGS.seed));
  const want = MPLUS[key], tol = TOLS[key];
  same('free parameters', r.npar!, want.fit.npar!);
  // Mplus prints the log-likelihood plus the log prior density (with priors its estimates maximise that sum).
  near('log-likelihood + log prior', r.logLik + r.logPrior!, want.fit.logl!, tol.logl);
  near('AIC (from log-likelihood + log prior)', -2 * (r.logLik + r.logPrior!) + 2 * r.npar!, want.fit.aic!, 2 * tol.logl);
  const mine: Mine[] = r.coefficients!.map((k) => ({ lhs: k.parameter === 'loading' ? 'f' : k.item, op: k.parameter === 'loading' ? '=~' : '|', rhs: k.parameter === 'loading' ? k.item : `t${k.parameter.split(' ')[1]}`, est: k.est, se: k.se }));
  for (const q of want.estimates.filter((x) => x.se > 0)) {
    const m = mine.find((x) => x.lhs === q.lhs && x.op === q.op && x.rhs === q.rhs);
    expect(m, `${q.lhs} ${q.op} ${q.rhs}`).toBeDefined();
    const label = `${q.lhs} ${q.op} ${q.rhs}`;
    near(label, m!.est, q.est, q.op === '=~' ? tol.loading : tol[q.rhs as 't1' | 't2' | 't3']);
    // (robust standard errors, relative to Mplus's)
    near(`SE of ${label} (relative)`, m!.se! / q.se, 1, tol.se);
  }
  expect(r.warnings).toEqual([]);
}, 3_600_000);
