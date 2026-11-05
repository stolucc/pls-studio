// Mplus User's Guide, chapter 6: the examples in webR against what their Mplus outputs print
// (see testkit.ts). Run with npm run test:webr.

import { afterAll, beforeAll, expect, it } from 'vitest';
import { growthInput } from '../../analyses/longitudinal';
import { DEFAULT_SETTINGS, toSpec } from '../../model/project';
import { growthR } from '../../rengine/longitudinal';
import { cbScriptLavaan, estimateCbLavaan } from '../../rengine/lavaan';
import type { CbEstimator } from '../../engine/cbsem';
import { regressionR } from '../../rengine/regression';
import { computeColumn } from '../../data/compute';
import type { DataInfo } from '../../model/project';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { exampleModel } from '../packages';
import { near, same } from '../../validation/record';
import { evidence, example, load, MPLUS, runCards, sameFit, samePrinted } from './testkit';
import type { BmvregResult } from '../../rengine/customml';

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

it.each([['ex6.4'], ['ex6.5'], ['ex6.15']])('%s: categorical growth by WLSMV (CB-SEM, lavaan syntax) reproduces the Mplus output: χ², every estimate and standard error', async (key) => {
  const ex = example(key);
  evidence(key, 'CB-SEM', ['lavaan']);
  const st = { ...DEFAULT_SETTINGS, ...ex.settings };
  const spec = toSpec(exampleModel(ex));
  const r = await estimateCbLavaan(load(key), spec, 'casewise', st.estimator as CbEstimator, 'product');
  expect(r.converged).toBe(true);
  expect(r.warnings).toEqual([]);
  const want = MPLUS[key];
  same('free parameters', r.fit.npar, want.fit.npar!);
  same('df', r.fit.df, want.fit.df!);
  near('χ² (WLSMV, as Mplus)', r.fit.chisqScaled!, want.fit.chisq!, 0.002);
  // (Mplus prints the scale factors under Scales: lavaan's ~*~ rows)
  samePrinted(r.estimates.map((e) => (e.kind === 'scale' ? { ...e, op: 'Scales', rhs: '' } : e)), want.estimates, key);
  const s = await cbScriptLavaan(load(key), spec, 'casewise', 'WLSMV');
  expect(s).toContain('information.bread = "expected"');
  expect(s).toContain('fit <- mplus_se(fit)');
  if (key !== 'ex6.5') expect(s).toMatch(/u12 ~\*~ NA\*u12/);
  else expect(s).toMatch(/u12 ~~ NA\*u12/);
}, 600_000);

it('ex6.25: the bivariate VAR(1) on the Bayesian multivariate regression card (exact posterior, flat priors) agrees with Mplus’s MCMC medians within its Monte Carlo error', async () => {
  evidence('ex6.25', 'Bayesian multivariate regression', ['stats']);
  const [r] = await runCards<BmvregResult>('ex6.25');
  expect(r.n).toBe(99);
  expect(r.warnings).toEqual([]);
  same('free parameters (coefficients, intercepts, residual variances and covariance)', r.parameters.length, MPLUS['ex6.25'].fit.npar!);
  // Mplus: 2 chains × 500 iterations, the second halves kept: 500 draws. The Monte Carlo SE of a median of 500
  // draws is about 1.2533·SD/√500; the card's exact medians lie within three of them of Mplus's, the SDs within three
  // Monte Carlo SEs of an SD (SD/√(2·500)).
  const name = (p: { lhs: string; op: string; rhs: string }) => p.op === '~' ? `${p.lhs} ON ${p.rhs.replace(/^(\w+)&1$/, '$1_lag1')}`
    : p.op === '~1' ? `${p.lhs} ON (Intercept)` : p.lhs === p.rhs ? `Residual variance ${p.lhs}` : `Residual covariance ${[p.lhs, p.rhs].sort().join(' ')}`;
  for (const p of MPLUS['ex6.25'].estimates) {
    const q = r.parameters.find((x) => x.name === name(p));
    expect(q, name(p)).toBeTruthy();
    near(`${name(p)}: posterior median (Mplus by MCMC)`, q!.median, p.est, 3 * 1.2533 * p.se / Math.sqrt(500));
    near(`${name(p)}: posterior SD`, q!.sd, p.se, 3 * p.se / Math.sqrt(1000));
  }
  // The numbers stated on the card.
  const at = (n: string) => r.parameters.find((x) => x.name === n)!.median;
  near('intercept of y1', at('y1 ON (Intercept)'), -0.033, 0.0005);
  near('residual variance of y2', at('Residual variance y2'), 1.032, 0.0005);
  near('y1 on y2&1', at('y1 ON y2_lag1'), -0.231, 0.0005);
  near('y2 on y1&1', at('y2 ON y1_lag1'), 0.347, 0.0005);
  near('residual covariance', at('Residual covariance y1 y2'), 0.006, 0.001);
}, 600_000);
