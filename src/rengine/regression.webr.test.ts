// The regression card against the packages' documented examples run natively
// (scripts/validation/regression.R): every coefficient and standard error.
// Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Dataset } from '../engine/types';
import { pnorm } from '../engine/stats';
import type { DataInfo } from '../model/project';
import { computeColumn } from '../data/compute';
import { PACKAGE_EXAMPLES, type PackageExample } from '../examples/packages';
import { against, example, near } from '../validation/record';
import type { RPackage } from './bridge';
import { rCall } from './bridge';
import { regressionR, regressionScriptR, type RegressionInput } from './regression';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';
import { exampleTestData, remoteTestData } from '../examples/testData';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

type Ref = { coefficients: { term: string; est: number; se: number }[]; logLik: number; aic: number; theta?: number; zeta?: Record<string, number>; deviance?: number };
const ref = JSON.parse(readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'regression', 'reference.json'), 'utf8')) as Record<string, Ref>;

async function load(ex: PackageExample): Promise<Dataset> {
  let d: Dataset;
  const fromFile = exampleTestData(ex);
  if (fromFile) d = fromFile;
  else {
    const raw = await rCall<{ names: string[]; cols: (number | null)[][]; levels?: Record<string, string[]> }>('ps_dataset', { package: ex.data.package, name: ex.data.name, na: [] }, ex.data.package as RPackage);
    d = { names: raw.names, cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))), ...(raw.levels && !Array.isArray(raw.levels) && Object.keys(raw.levels).length ? { categories: raw.levels } : {}) };
  }
  let info: DataInfo = { fileName: 'x', rows: d.cols[0].length, missingCells: 0, excluded: [] };
  for (const k of ex.computed ?? []) ({ data: d, info } = computeColumn(d, info, k.name, k.expr));
  if (ex.labels) d = { ...d, categories: { ...(d.categories ?? {}), ...ex.labels } };
  return d;
}

const CASES: [string, string][] = [['stats-dobson', 'dobson'], ['stats-clotting', 'clotting'], ['datasets-infert', 'infert'], ['mass-menarche', 'menarche'], ['mass-quine', 'quine'], ['mass-housing', 'housing'], ['mass-birthwt', 'birthwt'], ['nnet-birthwt', 'multinom'],
  ['datasets-attitude', 'attitude'], ['datasets-swiss', 'swiss'], ['cardata-duncan', 'duncan'], ['cardata-prestige', 'prestige'], ['faraway-gala', 'gala']];
/** R's term names for the reference (factor levels under their labels) match ours up to the names of recoded columns. */
const same = (a: string, b: string) => a.replace(/^log\(u\)$/, 'log_u').replace(/^log2\(income\)$/, 'log2_income').replace(/^ftv/, 'ftv2').replace(/TRUE$/, '') === b;

it.each(CASES)('%s reproduces the help page (native R)', async (id, key) => {
  const ex = PACKAGE_EXAMPLES.find((e) => e.id === id)!;
  example(id, { title: ex.title, method: 'Regression', packages: [ex.package], definition: ex });
  against({ label: 'the help page’s model in desktop R, scripts/validation/regression.R', script: 'scripts/validation/regression.R', level: 'native' });
  const data = await load(ex);
  const { kind: _k, ...opts } = ex.panel as { kind: 'regression' } & Omit<RegressionInput, 'confidence'>;
  const input: RegressionInput = { ...opts, confidence: 0.95 };
  const r = await regressionR(data, input);
  const want = ref[key];
  const digits = key === 'multinom' ? 3 : key === 'quine' ? 4 : 5;
  for (const w of want.coefficients) {
    const mine = r.coefficients.find((e) => same(w.term, e.term)) ?? r.thresholds.find((e) => same(w.term, e.term));
    expect(mine, `${id}: ${w.term} (have ${r.coefficients.map((e) => e.term).join(', ')})`).toBeTruthy();
    expect(mine!.est, w.term).toBeCloseTo(w.est, digits);
    expect(mine!.se, `SE of ${w.term}`).toBeCloseTo(w.se, digits);
  }
  expect(r.fit.logLik, 'log-likelihood').toBeCloseTo(want.logLik, digits);
  expect(r.fit.aic, 'AIC').toBeCloseTo(want.aic, digits);
  if (want.theta !== undefined) expect(r.fit.theta, 'θ (negative binomial)').toBeCloseTo(want.theta, 4);
  if (want.deviance !== undefined) expect(r.fit.deviance, 'deviance').toBeCloseTo(want.deviance, 5);
  if (want.zeta) for (const [k, v] of Object.entries(want.zeta)) expect(r.thresholds.find((t) => t.term === k)!.est, k).toBeCloseTo(v, 5);
  expect(r.warnings, r.warnings.join(' | ')).toEqual([]);
  expect(r.lrt).toBeTruthy();
  if (key === 'infert') { expect(r.diagnostics.auc).toBeGreaterThan(0.5); expect(r.diagnostics.hosmerLemeshow).toBeTruthy(); expect(r.coefficients[1].ratio).toBeCloseTo(Math.exp(r.coefficients[1].est), 10); }
  if (key === 'quine') expect(r.formula).toMatch(/Days ~ Sex \+ Sex:Age \+ Sex:Eth \+ Sex:Lrn \+ Sex:Eth:Lrn/);
  expect(r.fit.n).toBe(data.cols[0].length);  // every row, for every family (polr has no residuals component)
  if (key === 'clotting') expect(r.lrt!.df).toBe(1);  // Gamma: the dispersion parameter is not a tested coefficient
  if (key === 'menarche') { expect(r.curves[0].points?.y.length).toBe(data.cols[0].length); expect(Math.max(...r.curves[0].points!.y)).toBeLessThanOrEqual(1); }
  if (key === 'birthwt') expect(r.curves.map((k) => k.x)).toEqual(['age', 'lwt', 'smoke', 'ptd', 'ht', 'ui']);  // one partial-effect curve per non-categorical predictor
  if (key === 'housing') expect(r.curves).toEqual([]);
  if (key === 'multinom') expect(r.curves.every((k) => k.probs && !k.points)).toBe(true);
  if (key === 'clotting') { expect(r.lrt!.df).toBe(1); const b = r.coefficients[1]; expect(b.ciLow).toBeLessThan(b.est); expect(b.p).toBeGreaterThan(0); }
  if (key === 'housing') expect(r.thresholds.map((t) => t.term)).toEqual(['Low|Medium', 'Medium|High']);
  if (key === 'multinom') expect(r.levels).toEqual({ reference: '0', others: ['1'] });
  const script = await regressionScriptR(data, input);
  const LM = ['attitude', 'swiss', 'duncan', 'prestige'];
  expect(script).toContain(key === 'quine' ? 'glm.nb(' : key === 'housing' ? 'polr(' : key === 'multinom' ? 'multinom(' : ['dobson', 'gala'].includes(key) ? 'family = poisson' : key === 'clotting' ? 'family = Gamma' : key === 'menarche' ? 'binomial(link = "probit")' : LM.includes(key) ? 'fit <- lm(' : 'family = binomial');
  if (key === 'gala') { against({ label: 'Faraway, Extending the Linear Model with R: residual deviance (printed by R)', level: 'native' }); expect(r.fit.deviance, 'residual deviance').toBeCloseTo(716.8458, 3); expect(r.fit.n).toBe(30); }  // Faraway: residual deviance 716.85 on 24 df
  if (key === 'prestige') expect(r.formula).toMatch(/log2_income/);
}, 900_000);

// The other links on the same help-page data (scripts/validation/regression_links.R).
const links = JSON.parse(readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'regression', 'links.json'), 'utf8')) as Record<string, Ref>;
async function sameAsLink(id: string, link: string, key: string) {
  const ex = PACKAGE_EXAMPLES.find((e) => e.id === id)!;
  const { kind: _k, ...opts } = ex.panel as { kind: 'regression' } & Omit<RegressionInput, 'confidence'>;
  const r = await regressionR(await load(ex), { ...opts, link, confidence: 0.95 });
  const want = links[key];
  for (const w of want.coefficients) {
    const mine = r.coefficients.find((e) => same(w.term, e.term)) ?? r.thresholds.find((e) => same(w.term, e.term));
    expect(mine, `${key}: ${w.term} (have ${r.coefficients.map((e) => e.term).join(', ')})`).toBeTruthy();
    expect(mine!.est, `${w.term} (${link})`).toBeCloseTo(w.est, 5);
    expect(mine!.se, `SE of ${w.term} (${link})`).toBeCloseTo(w.se, 5);
  }
  for (const [k, v] of Object.entries(want.zeta ?? {})) expect(r.thresholds.find((t) => t.term === k)!.est, `${k} (${link})`).toBeCloseTo(v, 5);
  expect(r.fit.logLik, `log-likelihood (${link})`).toBeCloseTo(want.logLik, 5);
  expect(r.fit.aic, `AIC (${link})`).toBeCloseTo(want.aic, 5);
  if (want.deviance !== undefined) expect(r.fit.deviance, `deviance (${link})`).toBeCloseTo(want.deviance, 5);
  return r;
}

it('binomial with the complementary log-log link (cloglog) on ?menarche equals glm(binomial("cloglog")) natively', async () => {
  const r = await sameAsLink('mass-menarche', 'cloglog', 'menarche_cloglog');
  expect(r.warnings.every((w) => /fitted probabilities numerically 0 or 1/.test(w)), r.warnings.join(' | ')).toBe(true);  // (as natively)
}, 900_000);

it.each([['probit', 'housing_probit'], ['cloglog', 'housing_cloglog']])('ordinal with the %s link on ?housing equals polr natively', async (link, key) => {
  const r = await sameAsLink('mass-housing', link, key);
  expect(r.warnings, r.warnings.join(' | ')).toEqual([]);
  expect(r.thresholds.map((t) => t.term)).toEqual(['Low|Medium', 'Medium|High']);
}, 900_000);

type PsclRef = { coefficients: { term: string; est: number; se: number }[]; logLik: number; aic: number; bic: number; npar: number; theta?: number; thetaSe?: number; vuong: Record<'raw' | 'aic' | 'bic', number>; zeros: number; zerosPredicted: number; zerosStandard: number };
const pscl = JSON.parse(readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'regression', 'pscl.json'), 'utf8')) as Record<string, PsclRef>;
const BIO = ['fem', 'mar', 'kid5', 'phd', 'ment'];
/** pscl's names (count_femWomen, zero_ment) as the card's part and term. */
const psclTerm = (t: string) => ({ part: t.startsWith('zero_') ? 'zero' : null, term: t.replace(/^(count|zero)_/, '') });
const PSCL: [string, Partial<RegressionInput>][] = [
  ['zinb2', { family: 'negbin', zeroModel: 'zeroinfl', zeroPart: 'same' }],
  ['zip2', { family: 'poisson', zeroModel: 'zeroinfl', zeroPart: 'same' }],
  ['zinb', { family: 'negbin', zeroModel: 'zeroinfl', zeroPart: 'intercept' }],
  ['hnb1', { family: 'negbin', zeroModel: 'hurdle', zeroPart: 'same' }],
  ['hp1', { family: 'poisson', zeroModel: 'hurdle', zeroPart: 'same' }],
  ['hp_own', { family: 'poisson', zeroModel: 'hurdle', zeroPart: 'chosen', zeroPredictors: ['kid5', 'ment'], se: 'HC0' }],
  ['zinb_own', { family: 'negbin', zeroModel: 'zeroinfl', zeroPart: 'chosen', zeroPredictors: ['kid5', 'ment'], se: 'HC0' }],
];
const bioInput = (p: Partial<RegressionInput>): RegressionInput => ({ outcome: 'art', predictors: BIO, categorical: [], interactions: [], family: 'poisson', link: 'logit', trials: '', weights: '', se: 'model', cluster: '', confidence: 0.95, ...p });

// (pscl stops ~3e-6 short of the maximum at its default tolerance, and webR's floating point differs slightly: 1e-5)
it.each(PSCL)('pscl %s: the zero-inflated and hurdle models reproduce pscl natively (coefficients, SEs, theta, fit, Vuong, zeros; 1e-5)', async (key, p) => {
  const ex = PACKAGE_EXAMPLES.find((e) => e.id === 'pscl-zinb')!;
  if (key === 'zinb2' || key === 'hnb1') {
    const id = key === 'zinb2' ? 'pscl-zinb' : 'pscl-hurdle', e = PACKAGE_EXAMPLES.find((x) => x.id === id)!;
    example(id, { title: e.title, method: 'Regression', packages: ['pscl'], definition: e });
    against({ label: 'the help page’s model in desktop R (pscl::zeroinfl / pscl::hurdle, pscl::vuong), scripts/validation/zeroinfl.R', script: 'scripts/validation/zeroinfl.R', level: 'native' });
  }
  const data = await load(ex);
  const input = bioInput(p);
  const r = await regressionR(data, input);
  const want = pscl[key];
  expect(r.coefficients.length).toBe(want.coefficients.length);
  for (const w of want.coefficients) {
    const { part, term } = psclTerm(w.term);
    const mine = r.coefficients.find((e) => (e.part ?? null) === part && term === e.term);
    expect(mine, `${key}: ${w.term} (have ${r.coefficients.map((e) => `${e.part ?? ''}:${e.term}`).join(', ')})`).toBeTruthy();
    near(w.term, mine!.est, w.est, 1e-5);
    near(`SE of ${w.term}`, mine!.se, w.se, 1e-5);
    if (term !== '(Intercept)') expect(mine!.ratio).toBeCloseTo(Math.exp(w.est), 6);
  }
  for (const k of ['logLik', 'aic', 'bic'] as const) near(k, r.fit[k], want[k], 1e-5);
  expect(r.fit.npar).toBe(want.npar);
  if (want.theta !== undefined) near('θ', r.fit.theta!, want.theta, 1e-5);
  if (want.thetaSe !== undefined) near('SE of θ', r.fit.thetaSe!, want.thetaSe, 1e-5);
  else expect(r.fit.thetaSe ?? null).toBeNull();
  for (const k of ['raw', 'aic', 'bic'] as const) expect(Math.abs(r.vuong![k].z - want.vuong[k]) / Math.max(1, Math.abs(want.vuong[k])), `Vuong ${k}`).toBeLessThan(1e-6);
  const v = r.vuong!.raw; expect(v.p).toBeCloseTo(v.z > 0 ? 1 - pnorm(v.z) : pnorm(v.z), 6);
  expect(r.fit.zeros).toBe(want.zeros);
  near('predicted zeros', r.fit.zerosPredicted!, want.zerosPredicted, 1e-5);
  near('zeros predicted by the standard model', r.fit.zerosStandard!, want.zerosStandard, 1e-5);
  expect(r.zeroModel).toBe(p.zeroModel);
  expect(r.engine.package).toBe('pscl');
  expect(r.lrt).toBeNull();
  expect(r.warnings, r.warnings.join(' | ')).toEqual([]);
  expect(r.curves.length).toBeGreaterThan(0);
  const script = await regressionScriptR(data, input);
  expect(script).toContain(p.zeroModel === 'hurdle' ? `fit <- hurdle(art ~ fem + mar + kid5 + phd + ment${p.zeroPart === 'chosen' ? ' | kid5 + ment' : ''}, data = data, dist = "${p.family}", zero.dist = "binomial")`
    : `fit <- zeroinfl(art ~ fem + mar + kid5 + phd + ment${p.zeroPart === 'intercept' ? ' | 1' : p.zeroPart === 'chosen' ? ' | kid5 + ment' : ''}, data = data, dist = "${p.family}")`);
  expect(script).toContain('vuong(fit, std)');
  expect(script).toContain(p.se === 'HC0' ? 'vc <- sandwich(fit)' : 'vc <- vcov(fit)');
}, 900_000);

it('the zero-inflated Poisson written out (Mplus COUNT (i)) agrees with pscl::zeroinfl on the same predictors', async () => {
  const data = await load(PACKAGE_EXAMPLES.find((e) => e.id === 'pscl-zinb')!);
  const own = await regressionR(data, bioInput({ inflated: true }));
  const zip = await regressionR(data, bioInput({ zeroModel: 'zeroinfl', zeroPart: 'same' }));
  const ref = pscl.zip2;
  expect(own.coefficients.length).toBe(zip.coefficients.length);
  // (both maximise the same likelihood: the estimates agree to the optimisers' tolerance, pscl's default reltol about 1.5e-10)
  own.coefficients.forEach((c) => {
    const z = zip.coefficients.find((e) => e.term === c.term && (e.part === 'zero') === (c.part === 'inflation'))!;
    expect(Math.abs(c.est - z.est), c.term).toBeLessThan(1e-5);
    expect(Math.abs(c.se - z.se), `SE of ${c.term}`).toBeLessThan(1e-5);
  });
  near('logLik', own.fit.logLik, ref.logLik, 1e-6);
  expect(own.fit.npar).toBe(ref.npar);
  near('aic', own.fit.aic, ref.aic, 1e-6);
}, 900_000);

it('robust and cluster-robust standard errors come from sandwich', async () => {
  const ex = PACKAGE_EXAMPLES.find((e) => e.id === 'datasets-infert')!;
  const data = await load(ex);
  const base: RegressionInput = { outcome: 'case', predictors: ['spontaneous', 'induced'], categorical: [], interactions: [], family: 'binomial', link: 'logit', trials: '', weights: '', se: 'model', cluster: '', confidence: 0.95 };
  const m = await regressionR(data, base);
  const h = await regressionR(data, { ...base, se: 'HC3' });
  const k = await regressionR(data, { ...base, se: 'cluster', cluster: 'stratum' });
  expect(h.coefficients[1].est).toBeCloseTo(m.coefficients[1].est, 10);
  expect(h.coefficients[1].se).not.toBeCloseTo(m.coefficients[1].se, 4);
  expect(k.coefficients[1].se).not.toBeCloseTo(m.coefficients[1].se, 4);
  expect(await regressionScriptR(data, { ...base, se: 'cluster', cluster: 'stratum' })).toContain('vcovCL(fit, cluster = ~stratum)');
  // HC0 (White, as Mplus MLR): the leverage-free sandwich, never larger than HC3's leverage-inflated one.
  const h0 = await regressionR(data, { ...base, se: 'HC0' });
  expect(h0.se).toBe('HC0');
  h0.coefficients.forEach((c, i) => expect(c.se).toBeLessThan(h.coefficients[i].se));
  expect(await regressionScriptR(data, { ...base, se: 'HC0' })).toContain('vcovHC(fit, type = "HC0")');
  await expect(regressionR(data, { ...base, family: 'multinomial', se: 'HC3' })).rejects.toThrow(/model-based or HC0/);
  // Term names map back to the columns' names piece by piece, even when one name is a prefix of another.
  const renamed = { ...data, names: data.names.map((n) => (n === 'spontaneous' ? 'Price (EUR)' : n === 'induced' ? 'Price index' : n)) };
  const t = await regressionR(renamed, { ...base, predictors: ['Price (EUR)', 'Price index'], interactions: [['Price (EUR)', 'Price index']] });
  expect(t.coefficients.map((e) => e.term)).toEqual(['(Intercept)', 'Price (EUR)', 'Price index', 'Price (EUR):Price index']);
  // A text outcome with two categories in a logistic model: its second level is the event.
  const txt = { ...data, categories: { ...(data.categories ?? {}), case: ['control', 'case'] } };
  const g = await regressionR(txt, base);
  expect(g.coefficients[1].est).toBeCloseTo(m.coefficients[1].est, 10);
}, 900_000);

it('censored from above mirrors censored from below; inflated models give model-based errors too; the scripts run on their own', async () => {
  const d = remoteTestData({ kind: 'mplus', example: '3.2' });
  const neg = { ...d, cols: d.cols.map((c, k) => (d.names[k] === 'y1' ? c.map((v) => -v) : c)) };
  const opts: RegressionInput = { outcome: 'y1', predictors: ['x1', 'x3'], categorical: [], interactions: [], family: 'censored', link: 'logit', trials: '', weights: '', se: 'model', cluster: '', confidence: 0.95 };
  const below = await regressionR(d, opts);
  const above = await regressionR(neg, { ...opts, censoring: 'above' });
  // (y censored below at 0 is −y censored above at 0: the coefficients change sign, everything else is equal)
  below.coefficients.forEach((c, i) => { expect(above.coefficients[i].est).toBeCloseTo(-c.est, 6); expect(above.coefficients[i].se).toBeCloseTo(c.se, 6); });
  expect(above.fit.logLik).toBeCloseTo(below.fit.logLik, 6);
  expect(above.fit.censored).toBe(below.fit.censored);
  expect(above.fit.residualVariance).toBeCloseTo(below.fit.residualVariance!, 6);
  const inf = await regressionR(d, { ...opts, inflated: true });
  expect(inf.coefficients.filter((c) => c.part === 'inflation').length).toBe(3);
  expect(inf.fit.npar).toBe(7);
  expect(inf.warnings).toEqual([]);
  // The tobit is the censored-inflated model without the inflation: the inflated fit is at least as good.
  expect(inf.fit.logLik).toBeGreaterThanOrEqual(below.fit.logLik - 1e-6);
  const s = await regressionScriptR(d, { ...opts, inflated: true, se: 'HC0' });
  expect(s).toContain('ml_fit <- function');
  expect(s).toContain('fit <- ml_fit(ll, start, robust = TRUE)');
  expect(await regressionScriptR(d, opts)).toContain('survreg(Surv(y1, y1 > lim, type = "left") ~ x1 + x3');
}, 900_000);
