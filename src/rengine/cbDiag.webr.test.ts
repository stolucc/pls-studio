// CB-SEM diagnostics through the bridge on the Holzinger–Swineford CFA (lavaan's ?cfa), against direct
// lavaan calls in native R (scripts/validation/cbdiag.R → src/engine/__fixtures__/cbdiag/reference.json):
// local fit (lavResiduals z-tests, normalized residuals, the SRMR's tests, lavTest's further tests) and
// FIML / two-stage with auxiliary variables (lavaan aux =); discriminant validity (semTools::discriminantValidity);
// comparing two models (lavTestNET, lavTestLRT, nonnest2::vuongtest and icci).
// Run with WEBR_TESTS=1 PS_NATIVE_R=1 (or npm run test:webr).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Dataset, ModelSpec } from '../engine/types';
import { rCall } from './bridge';
import type { CbCall } from './cbExtras';
import { compareModelsR, compareModelsScriptR, discriminantR, discriminantScriptR, dvClass, dvClassChi2, largestResiduals, LOCALFIT_TESTS, localFitR, localFitScriptR, type LocalFitBlock } from './cbDiag';
import { estimateCbLavaan } from './lavaan';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const REF = JSON.parse(readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'cbdiag', 'reference.json'), 'utf8'));
const F = (name: string, inds: string[]) => ({ name, type: 'factor' as const, mode: 'A' as const, indicators: inds });
const spec: ModelSpec = { constructs: [F('visual', ['x1', 'x2', 'x3']), F('textual', ['x4', 'x5', 'x6']), F('speed', ['x7', 'x8', 'x9'])], paths: [] };
let hs: Dataset;
const call = (over: Partial<CbCall> = {}): CbCall => ({ data: hs, spec, missing: 'casewise', estimator: 'ML', interaction: 'product', ...over });
/** The lower triangle, column by column (as R's m[lower.tri(m)]). */
const low = (m: (number | null)[][]) => m.flatMap((_, j) => m.slice(j + 1).map((row) => row[j]));
/** HS with values removed by the reference's rule: x1 in every 5th row, x5 in rows 3, 10, 17, ... */
const withMissing = (): Dataset => ({ ...hs, cols: hs.cols.map((col, k) => Float64Array.from(col, (v, i) => ((hs.names[k] === 'x1' && (i + 1) % 5 === 0) || (hs.names[k] === 'x5' && (i + 1) % 7 === 3) ? NaN : v))) });

beforeAll(async () => {
  const raw = await rCall<{ names: string[]; cols: (number | null)[][] }>('ps_dataset', { package: 'lavaan', name: 'HolzingerSwineford1939', na: [] }, 'lavaan');
  hs = { names: raw.names, cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))) };
}, 900_000);

describe('local fit (lavaan::lavResiduals, lavTest)', () => {
  it('residual correlations, their SEs and z-tests, the normalized residuals and the SRMR tests equal lavResiduals', async () => {
    const r = await localFitR(call(), { tests: [...LOCALFIT_TESTS], base: 'standard' });
    const ref = REF.localfit;
    expect(r.blocks).toHaveLength(1);
    const b = r.blocks[0];
    expect(b.names).toEqual(ref.names);
    low(b.residual).forEach((v, k) => expect(v, `residual ${k}`).toBeCloseTo(ref.residual[k], 8));
    low(b.se).forEach((v, k) => expect(v, `se ${k}`).toBeCloseTo(ref.se[k], 8));
    low(b.z).forEach((v, k) => expect(v, `z ${k}`).toBeCloseTo(ref.z[k], 6));
    low(b.normalized!).forEach((v, k) => expect(v, `normalized ${k}`).toBeCloseTo(ref.normalized[k], 6));
    expect(b.summary.srmr).toBeCloseTo(ref.srmr, 8);
    expect(b.summary.se).toBeCloseTo(ref.srmrSe, 8);
    expect(b.summary.z).toBeCloseTo(ref.srmrZ, 6);
    expect(b.summary.usrmr).toBeCloseTo(ref.usrmr, 8);
    expect(b.summary.low).toBeCloseTo(ref.usrmrLow, 8);
    expect(b.summary.high).toBeCloseTo(ref.usrmrHigh, 8);
    expect(b.summary.closeP).toBeCloseTo(ref.closeP, 8);
    // Every further test, as lavTest gives it on its own.
    expect(r.tests.map((t) => t.test)).toEqual(['standard', ...LOCALFIT_TESTS]);
    for (const t of r.tests) {
      const want = ref.tests[t.test];
      expect(t.error, t.test).toBeNull();
      expect(t.stat, t.test).toBeCloseTo(want.stat, 6);
      expect(t.df, t.test).toBeCloseTo(want.df, 6);
      expect(t.p, t.test).toBeCloseTo(want.p, 10);
      if (want.scaling !== null) expect(t.scaling, t.test).toBeCloseTo(want.scaling, 8);
    }
    expect(r.tests.find((t) => t.test === 'standard')!.stat).toBeCloseTo(85.306, 3);  // ?cfa's χ²
    // The largest misfit: x7 ↔ x8 (the speed factor's two tests that correlate beyond it), as in lavaan's summary.
    const top = largestResiduals(b)[0];
    expect([top.a, top.b]).toEqual(['x7', 'x8']);
  }, 900_000);

  it('with Browne’s RLS as the base statistic the scaled, corrected and FMG tests equal lavTest(scaled_test = "RLS")', async () => {
    const tests = ['satorra.bentler', 'mean.var.adjusted.corrected', 'scaled.shifted.corrected', 'peba4'] as const;
    const r = await localFitR(call(), { tests: [...tests], base: 'RLS' });
    for (const k of tests) {
      const t = r.tests.find((x) => x.test === k)!, want = REF.localfit.rls[k];
      expect(t.stat, k).toBeCloseTo(want.stat, 6);
      expect(t.p, k).toBeCloseTo(want.p, 10);
    }
    expect(r.base).toBe('RLS');
  }, 900_000);

  it('a test that does not apply says why, and the others still run (FIML: no corrected tests, no sample-based ADF test)', async () => {
    const r = await localFitR(call({ data: withMissing(), missing: 'fiml' }), { tests: ['browne.residual.nt.model', 'browne.residual.adf', 'mean.var.adjusted.corrected'], base: 'standard' });
    const by = (k: string) => r.tests.find((t) => t.test === k)!;
    expect(by('browne.residual.nt.model').stat).toBeGreaterThan(0);
    expect(by('browne.residual.adf').error).toMatch(/incomplete|model-based/);
    expect(by('mean.var.adjusted.corrected').error).toMatch(/listwise/);
    expect(r.blocks[0].means).not.toBeNull();  // FIML: a mean structure, its residuals reported
  }, 900_000);

  it('the exported script runs the same calls', async () => {
    const s = await localFitScriptR(call(), { tests: ['peba4'], base: 'RLS' });
    expect(s).toContain('lavResiduals(fit, type = "cor.bentler", se = TRUE');
    expect(s).toContain('peba4 = lav_test("peba4", scaled_test = "RLS")');
  }, 900_000);

  it('largestResiduals sorts the pairs by |z| and leaves the diagonal out', () => {
    const b: LocalFitBlock = { label: '', names: ['a', 'b', 'c'], residual: [[0, null, null], [0.1, 0, null], [-0.2, 0.05, 0]], se: [[0], [0.05], [0.05, 0.05]], z: [[0, null, null], [2, 0, null], [-4, 1, 0]], normalized: null, means: null, summary: {} as LocalFitBlock['summary'] };
    expect(largestResiduals(b).map((p) => `${p.a}${p.b}:${p.z}`)).toEqual(['ac:-4', 'ab:2', 'bc:1']);
  });
});

describe('auxiliary variables (lavaan aux =)', () => {
  const loadings = (r: Awaited<ReturnType<typeof estimateCbLavaan>>) => r.estimates.filter((e) => e.op === '=~');
  it('FIML with saturated correlates equals cfa(missing = "ml", aux = c("ageyr", "agemo")), and differs from FIML without', async () => {
    const data = withMissing();
    const none = await estimateCbLavaan(data, spec, 'fiml', 'ML');
    const aux = await estimateCbLavaan(data, { ...spec, auxiliary: ['ageyr', 'agemo'] }, 'fiml', 'ML');
    expect(none.fit.chisq).toBeCloseTo(REF.aux.none.chisq, 6);
    expect(aux.fit.chisq).toBeCloseTo(REF.aux.aux.chisq, 6);
    expect(aux.fit.df).toBe(REF.aux.aux.df);
    expect(aux.fit.cfi).toBeCloseTo(REF.aux.aux.cfi, 8);
    loadings(aux).forEach((e, k) => { expect(e.est, `${e.lhs} → ${e.rhs}`).toBeCloseTo(REF.aux.aux.est[k], 6); if (REF.aux.aux.se[k]) expect(e.se, `${e.lhs} → ${e.rhs}`).toBeCloseTo(REF.aux.aux.se[k], 6); });
    expect(Math.abs(aux.fit.chisq - none.fit.chisq)).toBeGreaterThan(1e-3);
    // The auxiliary variables are no part of the model: same parameters, same df.
    expect(aux.estimates.filter((e) => e.op === '=~').length).toBe(none.estimates.filter((e) => e.op === '=~').length);
  }, 900_000);

  it('the two-stage approach takes them into its first-stage EM; other treatments ignore them', async () => {
    const data = withMissing();
    const two = await estimateCbLavaan(data, { ...spec, auxiliary: ['ageyr', 'agemo'] }, 'twostage', 'ML');
    expect(two.fit.chisq).toBeCloseTo(REF.aux.twostage.chisq, 6);
    loadings(two).forEach((e, k) => expect(e.est).toBeCloseTo(REF.aux.twostage.est[k], 6));
    // casewise: the request leaves them out (validate.ts warns that they are ignored)
    const cw = await estimateCbLavaan(data, { ...spec, auxiliary: ['ageyr'] }, 'casewise', 'ML');
    const cw0 = await estimateCbLavaan(data, spec, 'casewise', 'ML');
    expect(cw.fit.chisq).toBeCloseTo(cw0.fit.chisq, 10);
  }, 900_000);
});

describe('discriminant validity (semTools::discriminantValidity, Rönkkö & Cho 2022)', () => {
  type Ref = { lhs: string[]; rhs: string[]; est: number[]; low: number[]; high: number[]; cut80: Lrt; cut90: Lrt; cut100: Lrt; merge: Lrt };
  type Lrt = { chisq: number[]; df: number[]; p: number[] };
  const same = (r: Awaited<ReturnType<typeof discriminantR>>, ref: Ref) => {
    expect(r.pairs.map((p) => [p.a, p.b])).toEqual(ref.lhs.map((a, i) => [a, ref.rhs[i]]));
    r.pairs.forEach((p, i) => {
      expect(p.est, `est ${i}`).toBeCloseTo(ref.est[i], 6);
      expect(p.low, `low ${i}`).toBeCloseTo(ref.low[i], 6);
      expect(p.high, `high ${i}`).toBeCloseTo(ref.high[i], 6);
      for (const k of ['cut80', 'cut90', 'cut100', 'merge'] as const) {
        expect(p[k]!.chisq, `${k} ${i}`).toBeCloseTo(ref[k].chisq[i], 4);
        expect(p[k]!.df, `${k} ${i}`).toBe(ref[k].df[i]);
        expect(p[k]!.p, `${k} ${i}`).toBeCloseTo(ref[k].p[i], 8);
      }
    });
  };
  it('the HS factors: correlations, CIs, χ²(cut) at .8, .9, 1 and χ²(merge) as semTools gives them; no problem', async () => {
    const r = await discriminantR(call(), { level: 0.95, merge: true });
    same(r, REF.discriminant.hs);
    expect(r.markers).toBe(true);
    expect(r.pairs.map((p) => [dvClass(p.low, p.high), dvClassChi2(p)])).toEqual([['none', 'none'], ['none', 'none'], ['none', 'none']]);
  }, 900_000);

  it('Political Democracy: dem60 and dem65 (r = .98) are a severe problem by both workflows', async () => {
    const raw = await rCall<{ names: string[]; cols: (number | null)[][] }>('ps_dataset', { package: 'lavaan', name: 'PoliticalDemocracy', na: [] }, 'lavaan');
    const pd: Dataset = { names: raw.names, cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))) };
    const pdSpec: ModelSpec = { constructs: [F('ind60', ['x1', 'x2', 'x3']), F('dem60', ['y1', 'y2', 'y3', 'y4']), F('dem65', ['y5', 'y6', 'y7', 'y8'])], paths: [] };
    const r = await discriminantR(call({ data: pd, spec: pdSpec }), { level: 0.95, merge: true });
    same(r, REF.discriminant.poldem);
    expect(r.pairs.map((p) => dvClass(p.low, p.high))).toEqual(['none', 'none', 'severe']);
    expect(r.pairs.map((p) => dvClassChi2(p))).toEqual(['none', 'none', 'severe']);
    const s = await discriminantScriptR(call({ data: pd, spec: pdSpec }), { level: 0.95, merge: false });
    expect(s).toContain('discriminantValidity(fit, cutoff = k, level = 0.95)');
    expect(s).not.toContain('merge = TRUE');
  }, 900_000);
});

describe('comparing two models (lavTestNET, lavTestLRT, nonnest2)', () => {
  it('nonnest2’s documented example: the HS CFA (mean structure, as ?icci) against the same CFA by school', async () => {
    const byGroup: ModelSpec = { ...spec, multigroup: { column: 'school', invariance: 'configural', free: [] } };
    const r = await compareModelsR(call({ spec: { ...spec, meanStructure: true } }), byGroup, 'auto');
    const ref = REF.compare.documented;
    expect(r.fit1.logl).toBeCloseTo(ref.logl1, 6);
    expect(r.fit2.logl).toBeCloseTo(ref.logl2, 6);
    expect(r.vuong.error).toBeNull();
    expect(r.vuong.nested).toBe(false);  // NET cannot check models with different numbers of groups
    for (const k of ['omega', 'pOmega', 'stat', 'pA', 'pB'] as const) expect(r.vuong[k], k).toBeCloseTo(ref.vuong[k], 8);
    for (const k of ['aic1', 'aic2', 'aicLow', 'aicHigh', 'bic1', 'bic2', 'bicLow', 'bicHigh'] as const) expect(r.icci[k], k).toBeCloseTo(ref.icci[k], 6);
    expect(r.net.nested21).toBeNull();
    expect(r.net.reason21).toMatch(/groups/);
    expect(r.lrt.notes.join(' ')).toMatch(/number of groups differs.*invalid/);  // lavaan computes it, and says it is invalid
  }, 900_000);

  it('a nested pair (three factors against one): NET finds the nesting, the χ² difference and Vuong’s nested test as lavaan and nonnest2 give them', async () => {
    const one: ModelSpec = { constructs: [F('g', ['x1', 'x2', 'x3', 'x4', 'x5', 'x6', 'x7', 'x8', 'x9'])], paths: [] };
    const r = await compareModelsR(call(), one, 'auto');
    const ref = REF.compare.nested;
    expect(r.net.nested21).toBe(true);
    expect(r.net.nested12).toBeNull();
    expect(r.lrt.chisq).toBeCloseTo(ref.lrt.chisq, 6);
    expect(r.lrt.df).toBe(ref.lrt.df);
    expect(r.lrt.p).toBeCloseTo(ref.lrt.p, 12);
    expect(r.vuong.nested).toBe(true);
    expect(r.vuong.stat).toBeCloseTo(ref.vuong.stat, 6);
    expect(r.vuong.pA).toBeCloseTo(ref.vuong.pA, 10);
    expect(r.fit1.df).toBe(24);
    expect(r.fit2.df).toBe(27);
    const s = await compareModelsScriptR(call(), one, 'nested');
    expect(s).toContain('vt <- try_test(vuongtest(fit_1, fit_2, nested = nested))');
    expect(s).toContain('nested <- TRUE');
    expect(s).toContain('fit_2 <- sem(model_2,');
  }, 900_000);

  it('refuses models on different observed variables and non-ML estimators', async () => {
    const fewer: ModelSpec = { constructs: [F('visual', ['x1', 'x2', 'x3']), F('textual', ['x4', 'x5', 'x6'])], paths: [] };
    await expect(compareModelsR(call(), fewer, 'auto')).rejects.toThrow(/same observed variables/);
    await expect(compareModelsR(call({ estimator: 'ULS' }), spec, 'auto')).rejects.toThrow(/maximum-likelihood/);
  }, 900_000);
});
