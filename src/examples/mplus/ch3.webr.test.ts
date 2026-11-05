// Mplus User's Guide, chapter 3: the examples in webR against what their Mplus outputs print
// (see testkit.ts). Run with npm run test:webr.

import { afterAll, beforeAll, expect, it } from 'vitest';
import type { CbEstimator } from '../../engine/cbsem';
import { DEFAULT_SETTINGS, toSpec } from '../../model/project';
import { cbScriptLavaan, estimateCbLavaan } from '../../rengine/lavaan';
import { regressionR, type Coefficient } from '../../rengine/regression';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { near, same } from '../../validation/record';
import { exampleModel, examplePanels } from '../packages';
import { bootstrapR } from '../../rengine/analyses';
import { evidence, example, load, MPLUS, sameFit, samePrinted, TOL } from './testkit';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const panelOf = (key: string) => {
  const { kind: _k, ...opts } = example(key).panel as Extract<NonNullable<ReturnType<typeof example>['panel']>, { kind: 'regression' }>;
  return { ...opts, confidence: 0.95 };
};

it.each([['ex3.1'], ['ex3.5'], ['ex3.7']])('%s: the regression card reproduces the Mplus coefficients and log-likelihood', async (key) => {
  evidence(key, 'Regression', ['stats']);
  const r = await regressionR(load(key), panelOf(key));
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

/**
 * Censored, censored-inflated, multinomial, zero-inflated and negative binomial regressions (Mplus's default MLR,
 * the card's HC0): the fit, and every parameter Mplus prints. `u1#k` is the inflation (inflated models) or the
 * k-th category against the last (multinomial: the data's categories are 0, 1, 2, so u1#1 is level 0).
 */
it.each([['ex3.2', 'survival'], ['ex3.3', 'stats'], ['ex3.6', 'nnet'], ['ex3.8part1', 'stats'], ['ex3.8part2', 'MASS']])('%s: the regression card reproduces the Mplus output: fit, estimates and standard errors (%s)', async (key, pkg) => {
  evidence(key, 'Regression', [pkg]);
  const opts = panelOf(key);
  const r = await regressionR(load(key), opts);
  expect(r.se).toBe('HC0');
  expect(r.warnings).toEqual([]);
  const want = MPLUS[key];
  same('free parameters', r.fit.npar, want.fit.npar!);
  near('log-likelihood', r.fit.logLik, want.fit.logl!, 0.001);
  near('AIC', r.fit.aic, want.fit.aic!, 0.002);
  near('BIC', r.fit.bic, want.fit.bic!, 0.002);
  const y = opts.outcome;
  const find = (lhs: string, term: string): Coefficient => {
    const k = lhs === y ? 0 : Number(lhs.slice(y.length + 1));
    const c = r.coefficients.find((e) => e.term === term && (k === 0 ? !e.part && !e.level : opts.family === 'multinomial' ? e.level === String(k - 1) : e.part === 'inflation'));
    expect(c, `${lhs}: ${term}`).toBeTruthy();
    return c!;
  };
  let n = 0;
  for (const p of want.estimates) {
    const label = `${p.lhs} ${p.op} ${p.rhs}`;
    let est: number, se: number;
    if (p.op === '~') ({ est, se } = find(p.lhs, p.rhs));
    else if (p.op === '~1') ({ est, se } = find(p.lhs, '(Intercept)'));
    else if (p.op === '~~') { est = r.fit.residualVariance!; se = r.fit.residualVarianceSe!; }
    // (Mplus's negative-binomial dispersion α is 1/θ; its standard error by the delta method)
    else if (p.op === 'Dispersion') { est = 1 / r.fit.theta!; se = r.fit.thetaSe! / r.fit.theta! ** 2; }
    else throw new Error(`Unexpected parameter ${label}`);
    near(label, est, p.est, TOL);
    near(`SE of ${label}`, se, p.se, TOL);
    n++;
  }
  expect(n).toBe(want.estimates.length);
}, 600_000);

it('ex3.4: the probit regression with WLSMV (lavaan, u1 ordered) reproduces the Mplus estimates and standard errors', async () => {
  const ex = example('ex3.4');
  evidence('ex3.4', 'CB-SEM', ['lavaan']);
  const st = { ...DEFAULT_SETTINGS, ...ex.settings };
  const r = await estimateCbLavaan(load('ex3.4'), toSpec(exampleModel(ex)), 'casewise', st.estimator as CbEstimator, 'product');
  expect(r.converged).toBe(true);
  const want = MPLUS['ex3.4'];
  same('free parameters', r.fit.npar, want.fit.npar!);
  same('df', r.fit.df, want.fit.df!);
  samePrinted(r.estimates, want.estimates, 'ex3.4');
  // (the ordinal outcome's construct is the systematic part of its latent response: no disturbance of its own)
  expect(await cbScriptLavaan(load('ex3.4'), toSpec(exampleModel(ex)), 'casewise', 'WLSMV')).toMatch(/u1_lv ~~ 0\*u1_lv/);
}, 600_000);

it('ex3.16: the path model with bootstrapped standard errors, intervals and specific indirect effects agrees with Mplus within the bootstrap’s sampling error', async () => {
  const ex = example('ex3.16');
  evidence('ex3.16', 'CB-SEM', ['lavaan']);
  const st = { ...DEFAULT_SETTINGS, ...ex.settings };
  const data = load('ex3.16'), spec = toSpec(exampleModel(ex));
  const r = await estimateCbLavaan(data, spec, 'casewise', st.estimator as CbEstimator, 'product');
  const want = MPLUS['ex3.16'];
  // The ML estimates are Mplus's (the standard errors Mplus prints are the bootstrap's: checked below).
  sameFit(r.fit, want.fit);
  samePrinted(r.estimates, want.estimates, 'ex3.16', { ses: false });
  const defined = (name: string) => r.estimates.find((e) => e.kind === 'defined' && e.lhs === name)!;
  const ind = (k: number) => (want as unknown as { indirect: { effect: string; est: number; se: number }[] }).indirect.find((e) => e.effect === `Specific indirect ${k}`)!;
  near('indirect x1 → y1 → y3', defined('ind1').est, ind(1).est, TOL);
  near('indirect x1 → y2 → y3', defined('ind2').est, ind(2).est, TOL);

  // 1000 bootstrap draws (Mplus: BOOTSTRAP = 1000). Two independent sets of draws: an SE agrees within its sampling
  // error, about 1/√(2B) = 2.2% each, so 10% (more than 3 SD of the difference); a 2.5% / 97.5% percentile limit
  // within 0.4 SE (its sampling SD is about 0.085 SE each, so more than 3 SD of the difference).
  const boot = await bootstrapR(data, spec, { kind: 'cbBoot', estimator: 'ML', missing: 'casewise', boot: { samples: st.bootSamples, seed: st.seed, confidence: 0.95 } }, () => 'x');
  expect(boot.failed).toBe(0);
  const est = boot.stats.filter((s) => s.group === 'estimate');
  const stat = (label: string) => { const s = est.find((x) => x.label === label); expect(s, label).toBeDefined(); return s!; };
  const lab = (p: { lhs: string; op: string; rhs: string }) => (p.op === '~1' ? `${p.lhs} ~1` : `${p.lhs} ${p.op} ${p.rhs}`);
  for (const p of want.estimates) {
    const s = stat(lab(p));
    near(`${lab(p)}: estimate`, s.original, p.est, TOL);
    near(`${lab(p)}: bootstrap SE / Mplus’s`, s.sd / p.se, 1, 0.1);
  }
  for (const c of (want as unknown as { ci: { lhs: string; op: string; rhs: string; low: number; high: number }[] }).ci) {
    const s = stat(lab(c)), se = want.estimates.find((p) => lab(p) === lab(c))!.se;
    near(`${lab(c)}: lower 2.5% limit`, s.ciLow, c.low, 0.4 * se);
    near(`${lab(c)}: upper 2.5% limit`, s.ciHigh, c.high, 0.4 * se);
  }
  for (const [name, k] of [['ind1', 1], ['ind2', 2]] as const) {
    const s = est.find((x) => x.label.startsWith(`${name} :=`))!;
    near(`${name}: bootstrap SE / Mplus’s`, s.sd / ind(k).se, 1, 0.1);
  }
}, 900_000);

it.each([['ex3.12'], ['ex3.13'], ['ex3.14']])('%s: the categorical path model by WLSMV reproduces the Mplus output: χ², every estimate and standard error', async (key) => {
  const ex = example(key);
  evidence(key, 'CB-SEM', ['lavaan']);
  const st = { ...DEFAULT_SETTINGS, ...ex.settings };
  const r = await estimateCbLavaan(load(key), toSpec(exampleModel(ex)), 'casewise', st.estimator as CbEstimator, 'product');
  expect(r.converged).toBe(true);
  expect(r.warnings).toEqual([]);
  const want = MPLUS[key];
  same('free parameters', r.fit.npar, want.fit.npar!);
  same('df', r.fit.df, want.fit.df!);
  // Mplus's test statistic (mimic = "Mplus") and standard errors (the expected information in the sandwich, divided by N).
  near('χ² (WLSMV, as Mplus)', r.fit.chisqScaled!, want.fit.chisq!, 0.002);
  samePrinted(r.estimates, want.estimates, key);
  const s = await cbScriptLavaan(load(key), toSpec(exampleModel(ex)), 'casewise', 'WLSMV');
  expect(s).toContain('mimic = "Mplus", gamma.vcov.mplus = FALSE, information.bread = "expected"');
  expect(s).toContain('fit <- mplus_se(fit)');
}, 600_000);

it('ex3.15: the path model of a censored, a binary and a nominal outcome factorises into three regression cards that reproduce the Mplus output', async () => {
  evidence('ex3.15', 'Regression', ['survival', 'stats', 'nnet']);
  const ex = example('ex3.15'), data = load('ex3.15');
  const panels = examplePanels(ex);
  expect(panels.map((p) => p.kind)).toEqual(['regression', 'regression', 'regression']);
  const fits = await Promise.all(panels.map((p) => { const { kind: _k, ...o } = p as Extract<typeof p, { kind: 'regression' }>; return regressionR(data, { ...o, confidence: 0.95 }); }));
  const [cens, logit, nom] = fits;
  for (const r of fits) { expect(r.se).toBe('HC0'); expect(r.warnings).toEqual([]); }
  const want = MPLUS['ex3.15'];
  // The likelihood factorises: the three log-likelihoods and parameter counts add up to Mplus's.
  same('free parameters', fits.reduce((a, r) => a + r.fit.npar, 0), want.fit.npar!);
  const logl = fits.reduce((a, r) => a + r.fit.logLik, 0);
  near('log-likelihood (sum of the three cards)', logl, want.fit.logl!, 0.001);
  near('AIC', -2 * logl + 2 * want.fit.npar!, want.fit.aic!, 0.002);
  near('BIC', -2 * logl + Math.log(500) * want.fit.npar!, want.fit.bic!, 0.002);
  const coef = (r: typeof cens, term: string, level?: string) => {
    const c = r.coefficients.find((e) => e.term === term && !e.part && (level === undefined ? !e.level : e.level === level));
    expect(c, `${term} ${level ?? ''}`).toBeTruthy();
    return c!;
  };
  let n = 0;
  for (const p of want.estimates) {
    const label = `${p.lhs} ${p.op} ${p.rhs}`;
    let est: number, se: number;
    const lev = p.lhs.startsWith('u2#') ? String(Number(p.lhs.slice(3)) - 1) : undefined;  // u2#1 = category 0 against 2
    const r = p.lhs === 'y1' ? cens : p.lhs === 'u1' ? logit : nom;
    if (p.op === '~') ({ est, se } = coef(r, p.rhs, lev));
    else if (p.op === '~1') ({ est, se } = coef(r, '(Intercept)', lev));
    else if (p.op === '|') { const c = coef(r, '(Intercept)'); est = -c.est; se = c.se; }
    else if (p.op === '~~') { est = cens.fit.residualVariance!; se = cens.fit.residualVarianceSe!; }
    else throw new Error(`Unexpected parameter ${label}`);
    near(label, est, p.est, TOL);
    near(`SE of ${label}`, se, p.se, TOL);
    n++;
  }
  expect(n).toBe(want.estimates.length);
}, 600_000);
