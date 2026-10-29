// Endogeneity methods in webR against native R (scripts/validation/endo.R):
// REndo's copula control function, hetErrorsIV and higherMomentsIV on REndo's
// example data (written out here, since REndo cannot load in the browser's R),
// ivreg on Kmenta and sampleSelection (two-step) on Mroz87.
// Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { parseCsv } from '../engine/dataset';
import { rCall } from './bridge';
import { endoR, endoScriptR, type EndoInput } from './endo';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const ref = JSON.parse(readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'endo', 'reference.json'), 'utf8'));
const rendo = (n: string) => parseCsv(readFileSync(join(__dirname, '..', '..', 'public', 'examples', 'rendo', `${n}.csv`), 'utf8')).dataset;
const pkgData = async (pkg: 'ivreg' | 'sampleSelection', name: string) => {
  const raw = await rCall<{ names: string[]; cols: (number | null)[][] }>('ps_dataset', { package: pkg, name, na: [] }, pkg);
  return { names: raw.names, cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))) };
};
const base: EndoInput = { method: 'iv', outcome: 'y', exogenous: ['X1', 'X2'], endogenous: ['P'], instruments: [], hetRegressors: ['X1', 'X2'], hmTypes: [],
  selection: { outcome: '', regressors: [] }, heckmanMethod: '2step', boot: { samples: 200, seed: 1, confidence: 0.95 } };
const term = (t: string) => (t === '(Intercept)' ? 'Intercept' : t.replace(/^PStar\.(.*)$/, 'P* ($1)'));

it('Gaussian copula (two continuous endogenous regressors) equals REndo::copulaCorrection, bootstrap included', async () => {
  const r = await endoR(rendo('dataCopCont2'), { ...base, method: 'copula', endogenous: ['P1', 'P2'] });
  for (const c of ref.copula.summary) {
    const m = r.coefficients.find((x) => x.term === term(c.term))!;
    expect(m, c.term).toBeDefined();
    expect(m.est).toBeCloseTo(c.est, 10);
    expect(m.se!).toBeCloseTo(c.se, 10);
    expect(m.ciLow!).toBeCloseTo(c.ciLow, 10);
    expect(m.ciHigh!).toBeCloseTo(c.ciHigh, 10);
  }
  expect(r.normality.map((x) => x.variable)).toEqual(['P1', 'P2']);
  expect(r.ols.length).toBe(5);
  expect(await endoScriptR(rendo('dataCopCont2'), { ...base, method: 'copula', endogenous: ['P1', 'P2'] })).toContain('pstar <- function(v)');
}, 900_000);

it('heteroskedasticity-based instruments equal REndo::hetErrorsIV', async () => {
  const r = await endoR(rendo('dataHetIV'), { ...base, method: 'het' });
  for (const c of ref.het.coef) {
    const m = r.coefficients.find((x) => x.term === term(c.term))!;
    expect(m.est, c.term).toBeCloseTo(c.est, 10);
    expect(m.se!).toBeCloseTo(c.se, 10);
  }
  expect(r.heteroskedasticity.map((x) => x.variable)).toEqual(['X1', 'X2']);
}, 900_000);

it('higher-moment instruments equal REndo::higherMomentsIV (gp with g = x², and yp)', async () => {
  const r = await endoR(rendo('dataHigherMoments'), { ...base, method: 'hm', hmTypes: ['gp', 'yp'] });
  for (const c of ref.hm.coef) {
    const m = r.coefficients.find((x) => x.term === term(c.term))!;
    expect(m.est, c.term).toBeCloseTo(c.est, 10);
    expect(m.se!).toBeCloseTo(c.se, 10);
  }
}, 900_000);

it('instrumental variables on Kmenta equal ivreg, with its diagnostics', async () => {
  const d = await pkgData('ivreg', 'Kmenta');
  const r = await endoR(d, { ...base, outcome: 'Q', exogenous: ['D'], endogenous: ['P'], instruments: ['F', 'A'] });
  for (const c of ref.iv.coef) expect(r.coefficients.find((x) => x.term === term(c.term))!.est).toBeCloseTo(c.est, 10);
  ref.iv.diagnostics.forEach((g: { test: string; stat: number }, i: number) => {
    expect(r.diagnostics[i].test).toBe(g.test);
    expect(r.diagnostics[i].stat).toBeCloseTo(g.stat, 8);
  });
}, 900_000);

it('Heckman two-step on Mroz87 equals sampleSelection', async () => {
  const d = await pkgData('sampleSelection', 'Mroz87');
  const r = await endoR(d, { ...base, method: 'heckman', outcome: 'wage', exogenous: ['exper', 'educ', 'city'], endogenous: [],
    selection: { outcome: 'lfp', regressors: ['age', 'faminc', 'kids5', 'educ'] }, heckmanMethod: '2step' });
  ref.heckman_2step.coef.forEach((c: { est: number }, i: number) => expect(r.coefficients[i].est).toBeCloseTo(c.est, 8));
  expect(r.coefficients.filter((x) => x.equation === 'selection')).toHaveLength(5);
  expect(r.selection).toEqual({ selected: 428, total: 753 });
}, 900_000);
