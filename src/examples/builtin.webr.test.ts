// The built-in examples (customer survey, Stol et al. 2022, political
// democracy, MIMIC, the textbook matrices) run clean: no warning and no note from R, with every engine
// they offer. Run with npm run test:webr.

import { afterAll, beforeAll, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, toSpec } from '../model/project';
import { estimateCbLavaan } from '../rengine/lavaan';
import { estimatePlsR } from '../rengine/pls';
import { startTestRuntime, stopTestRuntime } from '../rengine/webrTestRuntime';
import { makeSample } from '../sample';
import { makeEmseExample } from './emse';
import { makeMimicExample } from './mimic';
import { makePoldemExample } from './poldem';
import { makeKerckhoffExample, makeThurstoneExample, makeWheatonExample } from './textbook';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

it('customer experience: PLS with cSEM and seminr, PLSc, and CB-SEM, without a note', async () => {
  const { data, model } = makeSample();
  const spec = toSpec(model);
  for (const [pkg, consistent] of [['cSEM', false], ['seminr', false], ['cSEM', true]] as const) {
    const r = await estimatePlsR(data, spec, { scheme: 'path', consistent, missing: 'mean', tolerance: 1e-7, maxIter: 300 }, pkg);
    expect(r.converged, `${pkg} ${consistent}`).toBe(true);
    expect(r.warnings, `${pkg} ${consistent}`).toEqual([]);
    expect(r.notes, `${pkg} ${consistent}`).toEqual([]);
  }
  const cb = await estimateCbLavaan(data, spec, 'casewise', 'ML', 'product');
  expect(cb.converged).toBe(true);
  expect(cb.warnings).toEqual([]);
  expect(cb.notes).toEqual([]);
}, 600_000);

it('Stol et al. (2022) and political democracy: CB-SEM as their sources, without a warning', async () => {
  const emse = makeEmseExample(DEFAULT_SETTINGS);
  const e = await estimateCbLavaan(emse.data, toSpec(emse.model), emse.settings.missing, 'MLM', 'product');
  expect(e.converged).toBe(true);
  expect(e.warnings).toEqual([]);
  expect(e.notes).toEqual([]);
  // Omega and alpha come from the factors' CFA (the model has observed covariates, which semTools cannot handle).
  expect(e.reliability.filter((r) => typeof r.omega === 'number' && typeof r.alpha === 'number').length).toBeGreaterThanOrEqual(3);
  const pd = makePoldemExample(DEFAULT_SETTINGS);
  const p = await estimateCbLavaan(pd.data, toSpec(pd.model), pd.settings.missing, 'ML', 'product');
  expect(p.converged).toBe(true);
  expect(p.warnings).toEqual([]);
  expect(p.notes).toEqual([]);
}, 600_000);

it('social participation (MIMIC): lavaan on the correlation matrix reproduces the book, without a warning', async () => {
  const ex = makeMimicExample(DEFAULT_SETTINGS);
  const r = await estimateCbLavaan(ex.data, toSpec(ex.model), 'casewise', 'ML', 'product');
  expect(r.converged).toBe(true);
  expect(r.warnings).toEqual([]);
  expect(r.notes).toEqual([]);
  const est = (op: string, rhs: string) => r.estimates.find((e) => e.op === op && e.lhs === 'Social participation' && e.rhs === rhs)!.est;
  expect(est('~', 'income')).toBeCloseTo(0.108, 3); expect(est('~', 'occupation')).toBeCloseTo(0.045, 3); expect(est('~', 'education')).toBeCloseTo(0.155, 3);
  expect(est('=~', 'memberships')).toBeCloseTo(1.579, 3); expect(est('=~', 'friends')).toBeCloseTo(0.862, 3);
  expect(r.fit.chisq).toBeCloseTo(12.522, 3); expect(r.fit.df).toBe(6);
}, 600_000);

it('Wheaton, Thurstone and Kerckhoff: lavaan on the published matrices reproduces the manuals, without a warning', async () => {
  const run = async (ex: ReturnType<typeof makeWheatonExample>) => {
    const r = await estimateCbLavaan(ex.data, toSpec(ex.model), 'casewise', 'ML', 'product');
    expect(r.converged, ex.name).toBe(true);
    expect(r.warnings, ex.name).toEqual([]);
    expect(r.notes, ex.name).toEqual([]);
    return r;
  };
  const est = (r: Awaited<ReturnType<typeof estimateCbLavaan>>, op: string, lhs: string, rhs: string) => r.estimates.find((e) => e.op === op && e.lhs === lhs && e.rhs === rhs)!;
  // Wheaton et al.: chi-square 4.73 on 4 df (Bollen 1989); SES -> Alienation 1967 -0.575, 1967 -> 1971 0.607.
  const w = await run(makeWheatonExample(DEFAULT_SETTINGS));
  expect(w.fit.chisq).toBeCloseTo(4.735, 2); expect(w.fit.df).toBe(4);
  expect(est(w, '~', 'Alienation 1967', 'SES').est).toBeCloseTo(-0.575, 3);
  expect(est(w, '~', 'Alienation 1971', 'Alienation 1967').est).toBeCloseTo(0.607, 3);
  expect(est(w, '~~', 'Anomia67', 'Anomia71').est).toBeCloseTo(1.623, 3);
  // Thurstone: chi-square 38.38 on 24 df (lavaan; sem's 38.20 divides by N - 1), standardised second-order loadings .822 / .782 / .815.
  const t = await run(makeThurstoneExample(DEFAULT_SETTINGS));
  expect(t.fit.chisq).toBeCloseTo(38.376, 2); expect(t.fit.df).toBe(24);
  expect(est(t, '=~', 'General ability', 'Verbal').std).toBeCloseTo(0.822, 3);
  expect(est(t, '=~', 'General ability', 'Reasoning').std).toBeCloseTo(0.815, 3);
  // Kerckhoff: just identified (df 0); Grades on Intelligence .526, OccupAsp on EducExp .550.
  const k = await run(makeKerckhoffExample(DEFAULT_SETTINGS));
  expect(k.fit.df).toBe(0);
  expect(est(k, '~', 'Grades', 'Intelligence').est).toBeCloseTo(0.526, 3);
  expect(est(k, '~', 'OccupAsp', 'EducExp').est).toBeCloseTo(0.550, 3);
  expect(k.r2Constructs[k.constructs.indexOf('OccupAsp')]).toBeCloseTo(0.443, 3);
}, 600_000);
