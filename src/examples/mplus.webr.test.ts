// The Mplus User's Guide examples in webR against the native reference
// (scripts/validation/mplus.R: lavaan, glm and modsem on the guide's data,
// each matching the log-likelihood the Mplus output prints) and the estimates
// the guide prints for the latent interaction. Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { CbEstimator } from '../engine/cbsem';
import { parseCsv } from '../engine/dataset';
import { toSpec } from '../model/project';
import { estimateCbLavaan } from '../rengine/lavaan';
import { growthR } from '../rengine/longitudinal';
import { regressionR } from '../rengine/regression';
import { startTestRuntime, stopTestRuntime } from '../rengine/webrTestRuntime';
import { exampleModel, PACKAGE_EXAMPLES } from './packages';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

type Estimate = { lhs: string; op: string; rhs: string; group: number; est: number; se: number };
type Fit = { n: number; chisq: number; df: number; logl: number | null; npar: number; scaled?: number | null; estimates: Estimate[] };
type Glm = { logl: number; coef: Record<string, number> };
const ref = JSON.parse(readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'textbook', 'mplus.json'), 'utf8')) as Record<string, Fit & Glm>;

const example = (key: string) => PACKAGE_EXAMPLES.find((e) => e.id === `mplus-${key}`)!;
const load = (key: string) => parseCsv(readFileSync(join(__dirname, '..', '..', 'public', example(key).data.file!), 'utf8')).dataset;
const close = (a: number, b: number, tol = 1e-4) => expect(Math.abs(a - b), `${a} vs ${b}`).toBeLessThan(tol * Math.max(1, Math.abs(b)));

/** Every loading and regression of the reference (free ones) is in the app's table, at the same value. */
function sameEstimates(mine: { lhs: string; op: string; rhs: string; est: number }[], want: Estimate[], where: string, tol = 1e-4) {
  for (const w of want.filter((w) => (w.op === '=~' || w.op === '~') && w.se > 0)) {
    const pool = mine.filter((e) => e.op === w.op && e.lhs === w.lhs && e.rhs === w.rhs);
    expect(pool.length, `${where}: ${w.lhs} ${w.op} ${w.rhs}`).toBeGreaterThan(0);
    expect(Math.min(...pool.map((e) => Math.abs(e.est - w.est))), `${where}: ${w.lhs} ${w.op} ${w.rhs}`).toBeLessThan(tol * Math.max(1, Math.abs(w.est)));
  }
}

it.each([['ex3.1'], ['ex3.5'], ['ex3.7']])('%s: the regression card reproduces glm (and the Mplus log-likelihood)', async (key) => {
  const ex = example(key);
  const p = ex.panel as Extract<NonNullable<typeof ex.panel>, { kind: 'regression' }>;
  const { kind: _k, ...opts } = p;
  const r = await regressionR(load(key), { ...opts, confidence: 0.95 });
  const want = ref[key];
  close(r.fit.logLik, want.logl, 1e-6);
  for (const [term, est] of Object.entries(want.coef)) {
    const mine = r.coefficients.find((c) => c.term === term);
    expect(mine, `${key}: ${term}`).toBeTruthy();
    close(mine!.est, est, 1e-5);
  }
}, 600_000);

it.each([['ex3.11'], ['ex5.1'], ['ex5.6'], ['ex5.8'], ['ex5.11'], ['ex5.25']])('%s under ML reproduces native lavaan', async (key) => {
  const ex = example(key);
  const r = await estimateCbLavaan(load(key), toSpec(exampleModel(ex)), 'casewise', 'ML', 'product');
  const want = ref[key];
  expect(r.converged).toBe(true);
  expect(r.fit.df).toBe(want.df);
  close(r.fit.chisq, want.chisq, 1e-5);
  // ESEM: the rotated loadings depend on the rotation's start; the fit and the structural part do not.
  sameEstimates(r.estimates, key === 'ex5.25' ? want.estimates.filter((w) => w.op === '~') : want.estimates, key);
}, 600_000);

it('ex5.2: binary indicators under WLSMV reproduce native lavaan (Mplus: χ² 5.482 on 8 df)', async () => {
  const ex = example('ex5.2');
  const spec = toSpec(exampleModel(ex));
  expect(spec.ordered).toEqual(['u1', 'u2', 'u3', 'u4', 'u5', 'u6']);
  const r = await estimateCbLavaan(load('ex5.2'), spec, 'casewise', 'WLSMV', 'product');
  const want = ref['ex5.2'];
  expect(r.converged).toBe(true);
  expect(r.fit.df).toBe(8);
  close(r.fit.chisq, want.chisq, 1e-5);
  close(r.fit.chisqScaled!, want.scaled!, 1e-5);
  expect(Math.abs(r.fit.chisqScaled! - 5.482)).toBeLessThan(0.02);
  sameEstimates(r.estimates, want.estimates, 'ex5.2');
  // Reliability with ordinal indicators: categorical omega (Green & Yang) and ordinal alpha, without a warning from semTools.
  expect(r.warnings).toEqual([]);
  for (const rel of r.reliability) { expect(rel.omega).toBeGreaterThan(0.5); expect(rel.alpha).toBeGreaterThan(0.5); }
}, 600_000);

it.each([['ex5.14'], ['ex5.15']])('%s: the two-group MIMIC model reproduces native lavaan (and the Mplus parameter count)', async (key) => {
  const ex = example(key);
  const r = await estimateCbLavaan(load(key), toSpec(exampleModel(ex)), 'casewise', ex.settings.estimator as CbEstimator, 'product');
  const want = ref[key];
  expect(r.converged).toBe(true);
  expect(r.groups!.labels.length).toBe(2);
  expect(r.fit.df).toBe(want.df);
  close(r.fit.chisq, want.chisq, 1e-5);
  for (const g of [1, 2]) sameEstimates(r.groups!.results[g - 1].estimates, want.estimates.filter((w) => w.group === g), `${key} group ${g}`);
  // The loading of y3 on f1 differs between the groups (freed for females); the others are equal.
  const y3 = r.groups!.results.map((g) => g.estimates.find((e) => e.op === '=~' && e.lhs === 'f1' && e.rhs === 'y3')!.est);
  expect(Math.abs(y3[0] - y3[1])).toBeGreaterThan(0.1);
  const y2 = r.groups!.results.map((g) => g.estimates.find((e) => e.op === '=~' && e.lhs === 'f1' && e.rhs === 'y2')!.est);
  close(y2[0], y2[1], 1e-8);
}, 600_000);

it('ex5.13: the latent interaction by LMS reproduces the estimates Mplus prints', async () => {
  const ex = example('ex5.13');
  const r = await estimateCbLavaan(load('ex5.13'), toSpec(exampleModel(ex)), 'casewise', 'ML', 'lms');
  expect(r.interaction).toBe('lms');
  const est = (lhs: string, rhs: string) => r.estimates.find((e) => e.op === '~' && e.lhs === lhs && e.rhs === rhs)!.est;
  // Mplus User's Guide, example 5.13 output (XWITH, numerical integration): F3 ON F1 0.439, F2 0.812, F1XF2 0.397; F4 ON F3 0.585.
  expect(est('f3', 'f1')).toBeCloseTo(0.439, 2);
  expect(est('f3', 'f2')).toBeCloseTo(0.812, 2);
  expect(est('f4', 'f3')).toBeCloseTo(0.585, 2);
  const inter = r.estimates.find((e) => e.op === '~' && e.lhs === 'f3' && /f1.*f2|f2.*f1/.test(e.rhs))!;
  expect(inter, 'interaction term').toBeTruthy();
  expect(inter.est).toBeCloseTo(0.397, 2);
}, 600_000);

it.each([['ex6.1'], ['ex6.8'], ['ex6.9'], ['ex6.10']])('%s: the growth card reproduces native lavaan::growth', async (key) => {
  const ex = example(key);
  const p = ex.panel as Extract<NonNullable<typeof ex.panel>, { kind: 'growth' }>;
  const r = await growthR(load(key), { ...p, estimator: 'ML', missing: 'casewise' });
  const want = ref[key];
  expect(r.fit.df).toBe(want.df);
  close(r.fit.chisq!, want.chisq, 1e-5);
  // Growth factor means, variances and the regressions on the covariates.
  for (const w of want.estimates.filter((w) => w.se > 0 && (w.op === '~1' || w.op === '~' || (w.op === '~~' && w.lhs !== w.rhs)) && /^[isq]$/.test(w.lhs))) {
    const pool = r.estimates.filter((e) => e.op === w.op && ((e.lhs === w.lhs && e.rhs === w.rhs) || (w.op === '~~' && e.lhs === w.rhs && e.rhs === w.lhs)));
    expect(pool.length, `${key}: ${w.lhs} ${w.op} ${w.rhs}`).toBeGreaterThan(0);
    close(pool[0].est, w.est, 1e-4);
  }
}, 600_000);
