// The Mplus User's Guide examples in webR against what their Mplus outputs
// print (scripts/validation/mplus_printed.py, from the statmodel.com output
// pages): fit information and every estimate and standard error, by group.
// Mplus prints three decimals and stops at a looser convergence criterion than
// lavaan, so values agree within 0.001. Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { CbEstimator } from '../engine/cbsem';
import { parseCsv } from '../engine/dataset';
import { growthInput } from '../analyses/longitudinal';
import { toSpec } from '../model/project';
import { estimateCbLavaan } from '../rengine/lavaan';
import { growthR } from '../rengine/longitudinal';
import { regressionR } from '../rengine/regression';
import { startTestRuntime, stopTestRuntime } from '../rengine/webrTestRuntime';
import { DEFAULT_SETTINGS } from '../model/project';
import { exampleModel, PACKAGE_EXAMPLES } from './packages';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

type Printed = { lhs: string; op: string; rhs: string; group: number; est: number; se: number };
type Fit = { npar?: number; logl?: number; aic?: number; bic?: number; chisq?: number; df?: number };
const MPLUS = JSON.parse(readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'textbook', 'mplus_printed.json'), 'utf8')) as Record<string, { fit: Fit; estimates: Printed[] }>;
/** Mplus's three printed decimals plus its convergence criterion. */
const TOL = 0.001;

const example = (key: string) => PACKAGE_EXAMPLES.find((e) => e.id === `mplus-${key}`)!;
const load = (key: string) => parseCsv(readFileSync(join(__dirname, '..', '..', 'public', example(key).data.file!), 'utf8')).dataset;
type Mine = { lhs: string; op: string; rhs: string; est: number; se: number | null; kind?: string };

/**
 * Every parameter Mplus prints: a free one (SE > 0) must be in the app's table with the same estimate
 * and (unless `ses` is false) standard error; a fixed one, when the app lists it, at the same value.
 */
function samePrinted(mine: Mine[], printed: Printed[], where: string, opts: { tol?: number; ses?: boolean; skip?: (p: Printed) => boolean } = {}) {
  const tol = opts.tol ?? TOL;
  for (const p of printed) {
    if (opts.skip?.(p)) continue;
    const pool = mine.filter((e) => (e.op === p.op || (p.op === '|' && e.kind === 'threshold'))
      && ((e.lhs === p.lhs && e.rhs === p.rhs) || (p.op === '~~' && e.lhs === p.rhs && e.rhs === p.lhs)));
    const what = `${where}: ${p.lhs} ${p.op} ${p.rhs} (group ${p.group})`;
    if (p.se === 0) {
      if (pool.length) expect(Math.min(...pool.map((e) => Math.abs(e.est - p.est))), what).toBeLessThanOrEqual(tol);
      continue;
    }
    expect(pool.length, `${what} is not in the app's table`).toBeGreaterThan(0);
    const best = pool.reduce((a, b) => (Math.abs(b.est - p.est) < Math.abs(a.est - p.est) ? b : a));
    expect(Math.abs(best.est - p.est), `${what}: estimate ${best.est} vs Mplus ${p.est}`).toBeLessThanOrEqual(tol);
    if (opts.ses !== false) expect(Math.abs((best.se ?? 0) - p.se), `${what}: SE ${best.se} vs Mplus ${p.se}`).toBeLessThanOrEqual(tol);
  }
}

function sameFit(fit: Partial<Record<'npar' | 'logl' | 'aic' | 'bic' | 'chisq' | 'df', number | undefined>>, want: Fit, where: string) {
  if (want.npar !== undefined) expect(fit.npar, `${where} free parameters`).toBe(want.npar);
  if (want.df !== undefined) expect(fit.df, `${where} df`).toBe(want.df);
  for (const k of ['logl', 'aic', 'bic', 'chisq'] as const) if (want[k] !== undefined) expect(Math.abs(fit[k]! - want[k]!), `${where} ${k}: ${fit[k]} vs Mplus ${want[k]}`).toBeLessThanOrEqual(0.002);
}

it.each([['ex3.1'], ['ex3.5'], ['ex3.7']])('%s: the regression card reproduces the Mplus coefficients and log-likelihood', async (key) => {
  const ex = example(key);
  const { kind: _k, ...opts } = ex.panel as Extract<NonNullable<typeof ex.panel>, { kind: 'regression' }>;
  const r = await regressionR(load(key), { ...opts, confidence: 0.95 });
  if (key === 'ex3.7') expect(r.se).toBe('HC0');
  const want = MPLUS[key];
  expect(Math.abs(r.fit.logLik - want.fit.logl!)).toBeLessThanOrEqual(0.001);
  expect(Math.abs(r.fit.aic - want.fit.aic!)).toBeLessThanOrEqual(0.002);
  const coef = (term: string) => r.coefficients.find((c) => c.term === term)!;
  for (const p of want.estimates) {
    // (Mplus: u1 ON x1 is the slope; the intercept of a count or continuous outcome, the threshold of a binary one (its negative))
    const c = p.op === '~' ? coef(p.rhs) : p.op === '~1' ? coef('(Intercept)') : p.op === '|' ? { ...coef('(Intercept)'), est: -coef('(Intercept)').est } : null;
    if (!c) continue;  // the residual variance (ex3.1): the card reports the least-squares residual SD instead (see the description)
    expect(Math.abs(c.est - p.est), `${key} ${p.lhs} ${p.op} ${p.rhs}`).toBeLessThanOrEqual(TOL);
    // 3.1: least-squares SEs (N − 3) are within 0.001 of Mplus's ML ones; 3.7: Mplus's MLR = the card's HC0 sandwich.
    expect(Math.abs(c.se - p.se), `${key} SE ${p.lhs} ${p.op} ${p.rhs}`).toBeLessThanOrEqual(TOL);
  }
}, 600_000);

it.each([['ex3.11'], ['ex5.1'], ['ex5.2'], ['ex5.6'], ['ex5.8'], ['ex5.11'], ['ex5.14'], ['ex5.15'], ['ex5.25']])('%s reproduces the Mplus output: fit, estimates and standard errors', async (key) => {
  const ex = example(key);
  const st = { ...DEFAULT_SETTINGS, ...ex.settings };
  const r = await estimateCbLavaan(load(key), toSpec(exampleModel(ex)), 'casewise', st.estimator as CbEstimator, 'product');
  const want = MPLUS[key];
  expect(r.converged).toBe(true);
  if (key === 'ex5.2') {
    // WLSMV: lavaan's scaled-shifted statistic adjusts slightly differently from Mplus's (documented on the card).
    expect(r.fit.npar).toBe(want.fit.npar);
    expect(r.fit.df).toBe(want.fit.df);
    expect(Math.abs(r.fit.chisqScaled! - want.fit.chisq!)).toBeLessThan(0.01);
    // Reliability with ordinal indicators: categorical omega and ordinal alpha, without a warning from semTools.
    expect(r.warnings).toEqual([]);
    for (const rel of r.reliability) { expect(rel.omega).toBeGreaterThan(0.5); expect(rel.alpha).toBeGreaterThan(0.5); }
  } else sameFit(r.fit, want.fit, key);
  if (r.groups) {
    expect(r.groups.labels.length).toBe(2);
    for (const g of [1, 2]) samePrinted(r.groups.results[g - 1].estimates, want.estimates.filter((p) => p.group === g), `${key} group ${g}`);
  } else samePrinted(r.estimates, want.estimates, key);
}, 600_000);

it('ex5.13: the latent interaction by LMS reproduces the Mplus estimates to two decimals', async () => {
  const ex = example('ex5.13');
  const r = await estimateCbLavaan(load('ex5.13'), toSpec(exampleModel(ex)), 'casewise', 'ML', 'lms');
  expect(r.interaction).toBe('lms');
  // Mplus integrates numerically (MLR); modsem's LMS uses its own quadrature (ML): the loadings and paths agree
  // within 0.002, the standard errors and the log-likelihood are not comparable (both documented on the card).
  const mine = r.estimates.map((e) => (e.op === '~' && /f1.*f2|f2.*f1/.test(e.rhs) ? { ...e, rhs: 'f1:f2' } : e));
  samePrinted(mine, MPLUS['ex5.13'].estimates.filter((p) => p.op === '=~' || p.op === '~'), 'ex5.13', { tol: 0.002, ses: false });
}, 600_000);

it.each([['ex6.1'], ['ex6.8'], ['ex6.9'], ['ex6.10']])('%s: the growth card reproduces the Mplus output: fit, estimates and standard errors', async (key) => {
  const ex = example(key);
  const { kind: _k, ...opts } = ex.panel as Extract<NonNullable<typeof ex.panel>, { kind: 'growth' }>;
  const input = growthInput({ ...opts, timeVarying: opts.timeVarying ?? [] }, { settings: { ...DEFAULT_SETTINGS, ...ex.settings, missing: 'casewise' }, model: exampleModel(ex) });
  expect(input.information).toBe('observed');
  const r = await growthR(load(key), input);
  const want = MPLUS[key];
  sameFit(r.fit, want.fit, key);
  samePrinted(r.estimates, want.estimates, key);
}, 600_000);

it('the replication scripts carry the Mplus defaults: observed information, geomin ε, no mean structure, intercepts of observed variables', async () => {
  const { cbScriptLavaan } = await import('../rengine/lavaan');
  const script = async (key: string) => cbScriptLavaan(load(key), toSpec(exampleModel(example(key))), 'casewise', 'ML');
  const s525 = await script('ex5.25');
  expect(s525).toContain('information = "observed"');
  expect(s525).toContain('rotation.args = list(geomin.epsilon = 0.0001)');
  const s514 = await script('ex5.14');
  expect(s514).toContain('meanstructure = FALSE');
  expect(s514).not.toContain('information = "observed"');
  // An observed variable's intercept on its construct (the indicator's fixed at 0), in one group.
  const s311 = await script('ex3.11');
  expect(s311).toMatch(/y3_lv ~ 1/);
  expect(s311).toMatch(/y3 ~ 0\*1 {3}# the intercept of y3_lv/);
}, 600_000);
