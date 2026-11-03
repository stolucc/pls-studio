// The regression card against the packages' documented examples run natively
// (scripts/validation/regression.R): every coefficient and standard error.
// Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { parseCsv } from '../engine/dataset';
import type { Dataset } from '../engine/types';
import type { DataInfo } from '../model/project';
import { computeColumn } from '../data/compute';
import { PACKAGE_EXAMPLES, type PackageExample } from '../examples/packages';
import { against, example } from '../validation/record';
import type { RPackage } from './bridge';
import { rCall } from './bridge';
import { regressionR, regressionScriptR, type RegressionInput } from './regression';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

type Ref = { coefficients: { term: string; est: number; se: number }[]; logLik: number; aic: number; theta?: number; zeta?: Record<string, number>; deviance?: number };
const ref = JSON.parse(readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'regression', 'reference.json'), 'utf8')) as Record<string, Ref>;

async function load(ex: PackageExample): Promise<Dataset> {
  let d: Dataset;
  if (ex.data.file) d = parseCsv(readFileSync(join(__dirname, '..', '..', 'public', ex.data.file), 'utf8')).dataset;
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
  await expect(regressionR(data, { ...base, family: 'multinomial', se: 'HC3' })).rejects.toThrow(/Robust standard errors are available for lm and glm/);
  // Term names map back to the columns' names piece by piece, even when one name is a prefix of another.
  const renamed = { ...data, names: data.names.map((n) => (n === 'spontaneous' ? 'Price (EUR)' : n === 'induced' ? 'Price index' : n)) };
  const t = await regressionR(renamed, { ...base, predictors: ['Price (EUR)', 'Price index'], interactions: [['Price (EUR)', 'Price index']] });
  expect(t.coefficients.map((e) => e.term)).toEqual(['(Intercept)', 'Price (EUR)', 'Price index', 'Price (EUR):Price index']);
  // A text outcome with two categories in a logistic model: its second level is the event.
  const txt = { ...data, categories: { ...(data.categories ?? {}), case: ['control', 'case'] } };
  const g = await regressionR(txt, base);
  expect(g.coefficients[1].est).toBeCloseTo(m.coefficients[1].est, 10);
}, 900_000);
