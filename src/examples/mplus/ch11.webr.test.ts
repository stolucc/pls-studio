// Mplus User's Guide, chapter 11: the examples in webR against what their Mplus outputs print
// (see testkit.ts). Run with npm run test:webr.

import { afterAll, beforeAll, expect, it } from 'vitest';
import { growthInput } from '../../analyses/longitudinal';
import { computeColumn } from '../../data/compute';
import type { DataInfo } from '../../model/project';
import { DEFAULT_SETTINGS } from '../../model/project';
import { growthR } from '../../rengine/longitudinal';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { near, same } from '../../validation/record';
import { exampleModel } from '../packages';
import { evidence, example, load, MPLUS, sameFit, samePrinted } from './testkit';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

/** The example's data with its computed columns, and its growth card run as the app runs it. */
async function runCard(key: string) {
  const ex = example(key);
  let data = load(key);
  let info = { fileName: key, rows: data.cols[0].length, missingCells: 0, excluded: [] } as unknown as DataInfo;
  for (const k of ex.computed ?? []) ({ data, info } = computeColumn(data, info, k.name, k.expr));
  const { kind: _k, ...opts } = ex.panel as Extract<NonNullable<typeof ex.panel>, { kind: 'growth' }>;
  const input = growthInput({ ...opts, timeVarying: opts.timeVarying ?? [] }, { settings: { ...DEFAULT_SETTINGS, ...ex.settings }, model: exampleModel(ex) });
  expect(input.missing).toBe('fiml');
  expect(input.information).toBe('observed');
  return { r: await growthR(data, input), data };
}

it('ex11.1: FIML with a saturated missing-data correlate reproduces the Mplus output', async () => {
  evidence('ex11.1', 'Longitudinal', ['lavaan']);
  const { r } = await runCard('ex11.1');
  const want = MPLUS['ex11.1'];
  // Mplus counts the growth model's 9 parameters; its log-likelihood, AIC and BIC include z's 6 (mean, variance, 4 covariances), as lavaan's.
  same('free parameters with the auxiliary part', r.fit.npar!, want.fit.npar! + 6);
  sameFit({ ...r.fit, npar: undefined }, { ...want.fit, npar: undefined });
  expect(r.n).toBe(200);
  samePrinted(r.estimates, want.estimates, 'ex11.1');
}, 600_000);

it('ex11.4: the pattern-mixture model reproduces the Mplus output (one standard error as stated)', async () => {
  evidence('ex11.4', 'Longitudinal', ['lavaan']);
  const { r, data } = await runCard('ex11.4');
  // The dropout dummies as Mplus's DDROPOUT makes them (its descriptive statistics: 3.3%, 3.5%, 5.4%, 4.0%).
  const count = (d: string) => Array.from(data.cols[data.names.indexOf(d)]).reduce((a, v) => a + v, 0);
  expect([1, 2, 3, 4, 5].map((t) => count(`d${t}`))).toEqual([33, 35, 54, 40, 151]);
  const want = MPLUS['ex11.4'];
  sameFit(r.fit, want.fit);
  const shared = (p: { lhs: string; op: string; rhs: string }) => p.lhs === 's' && p.op === '~' && (p.rhs === 'd1' || p.rhs === 'd2');
  samePrinted(r.estimates, want.estimates.filter((p) => !shared(p)), 'ex11.4');
  samePrinted(r.estimates, want.estimates.filter(shared), 'ex11.4 shared slope shift', { ses: false });
  // Mplus prints 0.156; lavaan's observed information (and a numerical Hessian of the likelihood) give 0.160, as the card states.
  for (const d of ['d1', 'd2']) near(`SE of s ~ ${d} (stated)`, r.estimates.find((e) => e.lhs === 's' && e.op === '~' && e.rhs === d)!.se!, 0.160, 0.0006);
}, 600_000);
