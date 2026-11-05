// Mplus User's Guide, chapter 6: the examples in webR against what their Mplus outputs print
// (see testkit.ts). Run with npm run test:webr.

import { afterAll, beforeAll, expect, it } from 'vitest';
import { growthInput } from '../../analyses/longitudinal';
import { DEFAULT_SETTINGS } from '../../model/project';
import { growthR } from '../../rengine/longitudinal';
import { regressionR } from '../../rengine/regression';
import { computeColumn } from '../../data/compute';
import type { DataInfo } from '../../model/project';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { exampleModel } from '../packages';
import { near } from '../../validation/record';
import { evidence, example, load, MPLUS, sameFit, samePrinted } from './testkit';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

it.each([['ex6.1'], ['ex6.8'], ['ex6.9'], ['ex6.10']])('%s: the growth card reproduces the Mplus output: fit, estimates and standard errors', async (key) => {
  const ex = example(key);
  evidence(key, 'Longitudinal', ['lavaan']);
  const { kind: _k, ...opts } = ex.panel as Extract<NonNullable<typeof ex.panel>, { kind: 'growth' }>;
  const input = growthInput({ ...opts, timeVarying: opts.timeVarying ?? [] }, { settings: { ...DEFAULT_SETTINGS, ...ex.settings, missing: 'casewise' }, model: exampleModel(ex) });
  expect(input.information).toBe('observed');
  const r = await growthR(load(key), input);
  const want = MPLUS[key];
  sameFit(r.fit, want.fit);
  samePrinted(r.estimates, want.estimates, key);
}, 600_000);

/** The example's growth card run as the app runs it (the model written as lavaan syntax). */
async function runCard(key: string) {
  const ex = example(key);
  const { kind: _k, ...opts } = ex.panel as Extract<NonNullable<typeof ex.panel>, { kind: 'growth' }>;
  const input = growthInput({ ...opts, timeVarying: opts.timeVarying ?? [] }, { settings: { ...DEFAULT_SETTINGS, ...ex.settings }, model: exampleModel(ex) });
  expect(input.syntax).toBeTruthy();
  expect(input.information).toBe('observed');
  return growthR(load(key), input);
}

it.each([['ex6.11'], ['ex6.13'], ['ex6.14']])('%s: the growth card with the model written as syntax reproduces the Mplus output', async (key) => {
  evidence(key, 'Longitudinal', ['lavaan']);
  const r = await runCard(key);
  sameFit(r.fit, MPLUS[key].fit);
  samePrinted(r.estimates, MPLUS[key].estimates, key);
  expect(r.impliedMeans.length).toBe(r.measures.length);
}, 600_000);

it('ex6.17: AR(1) residuals by constraints: fit and estimates as Mplus; standard errors under the nonlinear constraints as stated', async () => {
  evidence('ex6.17', 'Longitudinal', ['lavaan']);
  const r = await runCard('ex6.17');
  sameFit(r.fit, MPLUS['ex6.17'].fit);
  // Mplus prints the NEW parameter corr among the variances; here it is the defined parameter corr := p1/rv.
  const mine = r.estimates.map((e) => (e.op === ':=' ? { ...e, op: '~~', rhs: e.lhs } : e));
  samePrinted(mine, MPLUS['ex6.17'].estimates, 'ex6.17', { ses: false });
  // The means' standard errors agree; lavaan's standard errors of the constrained (co)variances omit the constraints'
  // curvature (Mplus's equal the reparameterised likelihood's): the values the card states.
  samePrinted(mine, MPLUS['ex6.17'].estimates.filter((p) => p.op === '~1'), 'ex6.17 means');
  const se = (lhs: string, op: string, rhs: string) => mine.find((e) => e.lhs === lhs && e.op === op && e.rhs === rhs)!.se!;
  for (const [l, o, rr, v] of [['y1', '~~', 'y1', 0.235], ['y1', '~~', 'y2', 0.219], ['y1', '~~', 'y3', 0.161], ['y1', '~~', 'y4', 0.106], ['corr', '~~', 'corr', 0.070], ['i', '~~', 'i', 0.263]] as const) near(`SE of ${l} ${o} ${rr} (lavaan, stated)`, se(l, o, rr), v, 0.0006);
}, 600_000);

it('ex6.18: three cohorts with their own time scores and equalities reproduce the Mplus output in every group', async () => {
  evidence('ex6.18', 'Longitudinal', ['lavaan']);
  const r = await runCard('ex6.18');
  sameFit(r.fit, MPLUS['ex6.18'].fit);
  expect(r.groups).toEqual(['1', '2', '3']);
  for (const g of [1, 2, 3]) samePrinted(r.estimates.filter((e) => e.group === g), MPLUS['ex6.18'].estimates.filter((p) => p.group === g), `ex6.18 group ${g}`);
}, 600_000);

/**
 * N = 1 time series (6.23, 6.23b, 6.24): Mplus estimates by Bayes (posterior medians, MCMC, the first occasions' missing
 * lags as missing data), the regression card by least squares on the occasions with lags (computed columns). They are
 * estimates of the same model: within 0.015 (about a tenth of a standard error), standard errors within 0.005 of the
 * posterior SDs, σ² within 0.025 of the posterior median of the residual variance, as the cards state.
 */
it.each([['ex6.23', 99], ['ex6.23b', 98], ['ex6.24', 99]])('%s: the regression card on lagged columns agrees with Mplus’s Bayes estimates as stated', async (key, n) => {
  const ex = example(key);
  evidence(key, 'Regression', ['stats']);
  let data = load(key);
  let info = { fileName: key, rows: data.cols[0].length, missingCells: 0, excluded: [] } as unknown as DataInfo;
  for (const k of ex.computed ?? []) ({ data, info } = computeColumn(data, info, k.name, k.expr));
  const { kind: _k, ...opts } = ex.panel as Extract<NonNullable<typeof ex.panel>, { kind: 'regression' }>;
  const r = await regressionR(data, { ...opts, confidence: 0.95 });
  expect(r.fit.n).toBe(n);
  const term = (rhs: string) => rhs.replace(/^(\w+)&(\d)$/, '$1_lag$2');
  for (const p of MPLUS[key].estimates) {
    if (p.op === '~~') { near('residual variance (σ²)', r.fit.sigma! ** 2, p.est, 0.025); continue; }
    const c = r.coefficients.find((x) => x.term === (p.op === '~1' ? '(Intercept)' : term(p.rhs)))!;
    expect(c, `${p.lhs} ${p.op} ${p.rhs}`).toBeTruthy();
    near(`${p.lhs} ${p.op} ${p.rhs} (least squares vs posterior median)`, c.est, p.est, 0.015);
    near(`SE of ${p.lhs} ${p.op} ${p.rhs} (vs posterior SD)`, c.se, p.se, 0.005);
  }
}, 600_000);

it('a growth model written as syntax refuses function calls and quotes (lavaan evaluates constraints as R code)', async () => {
  const input = { measures: [], times: [], shape: 'linear' as const, covariates: [], estimator: 'ML' as const, missing: 'casewise' as const };
  for (const syntax of ['i =~ 1*y1 + 1*y2 + 1*y3\nk := exp(1)', 'i =~ 1*y1 + 1*y2 + 1*y3\nk := system("ls")', "i =~ 1*y1 + label('a')*y2"]) {
    await expect(growthR(load('ex6.17'), { ...input, syntax })).rejects.toThrow(/syntax/);
  }
}, 600_000);
