// The Latent change score card against lcsm run natively (scripts/validation/lcs.R → src/engine/__fixtures__/lcs/
// reference.json): the bridge writes lcsm's model (the same parameter table for every combination of change components
// and couplings, checked there) and fits it as lcsm does; here every labelled estimate, standard error and fit measure
// is compared with lcsm's fit_uni_lcsm / fit_bi_lcsm on lcsm's help-page examples (its data_uni_lcsm, data_bi_lcsm,
// MLR and FIML) and on the home-screen example (lavaan's Demo.growth, ML), which runs through its cards. Run in the
// browser's R (npm run test:webr) or with PS_NATIVE_R=1 in desktop R.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Dataset, MissingTreatment } from '../../engine/types';
import { DEFAULT_SETTINGS } from '../../model/project';
import { analysisType } from '../../analyses/registry';
import type { AnalysisCtx } from '../../analyses/types';
import { lcsRows } from '../../analyses/lcs';
import { rCall } from '../../rengine/bridge';
import { lcsR, lcsScriptR, type LcsInput, type LcsResult } from '../../rengine/longitudinal';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { examplePanels, exampleSettings, PACKAGE_EXAMPLES, panelPreset } from '../packages';
import { against, example as exampleCheck, near, same } from '../../validation/record';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

interface Ref { n: number; estimates: Record<string, { est: number; se: number; std: number }>; fit: Record<string, number>; implied: { x: number[]; y: number[] } }
const REF = JSON.parse(readFileSync(join(__dirname, '..', '..', 'engine', '__fixtures__', 'lcs', 'reference.json'), 'utf8')) as {
  R: string; lcsm: string; lavaan: string; syntaxEquivalent: boolean; data: { uni: Record<string, (number | null)[]>; bi: Record<string, (number | null)[]> }; results: Record<string, Ref>;
};
const SOURCE = { label: `lcsm ${REF.lcsm} (lavaan ${REF.lavaan}) in desktop ${REF.R}: fit_uni_lcsm / fit_bi_lcsm, scripts/validation/lcs.R`, level: 'native' as const, script: 'scripts/validation/lcs.R' };
const frame = (d: Record<string, (number | null)[]>): Dataset => ({ names: Object.keys(d), cols: Object.values(d).map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))) });
const ALL = { constant: true, proportional: true, autoregressive: true }, NONE = { constant: false, proportional: false, autoregressive: false };
const NO = { deltaXY: false, deltaYX: false, xiXY: false, xiYX: false };

/** Every labelled estimate, its standard error and the fit measures equal lcsm's (`record`: as example evidence). */
// (5 digits: webR's floating point moves lavaan's estimates by ~1e-6 from desktop R's)
function compare(r: LcsResult, ref: Ref, record: boolean, digits = 5) {
  const close = (what: string, got: number | null, want: number) => (record ? near(what, got ?? NaN, want, 10 ** -digits) : expect(got ?? NaN, what).toBeCloseTo(want, digits));
  expect(r.n).toBe(ref.n);
  expect(r.estimates.map((e) => e.label).sort()).toEqual(Object.keys(ref.estimates).sort());
  for (const e of r.estimates) {
    close(`${e.label}`, e.est, ref.estimates[e.label].est);
    if (ref.estimates[e.label].se > 0) close(`${e.label}: SE`, e.se, ref.estimates[e.label].se);
  }
  close('χ²', r.fit.chisq ?? null, ref.fit.chisq);
  if (ref.fit.df !== undefined) expect(r.fit.df).toBe(ref.fit.df);
  close('log-likelihood', r.fit.logl ?? null, ref.fit.logl);
  r.impliedMeans.x.forEach((v, i) => close(`implied mean x${i + 1}`, v, ref.implied.x[i]));
}

describe('latent change score models (lcsm’s specification, lavaan)', () => {
  it('the bridge’s syntax is lcsm’s (recorded natively for every combination)', () => expect(REF.syntaxEquivalent).toBe(true));

  it('lcsm’s help examples: univariate constant change, the univariate dual change model, bivariate with coupling (MLR, FIML)', async () => {
    const uni = frame(REF.data.uni), bi = frame(REF.data.bi);
    const base = { y: [], modelY: NONE, coupling: NO, estimator: 'MLR' as const, missing: 'fiml' as MissingTreatment };
    compare(await lcsR(uni, { ...base, x: ['x1', 'x2', 'x3'], modelX: { constant: true, proportional: false, autoregressive: false } }), REF.results.uniHelp, false);
    const dual = await lcsR(uni, { ...base, estimator: 'ML', x: ['x1', 'x2', 'x3', 'x4', 'x5'], modelX: ALL });
    compare(dual, REF.results.uniDual, false);
    expect(lcsRows(dual)[0].rows.map(([what]) => what)).toEqual(['x: initial true score, mean', 'x: initial true score, variance', 'x: constant change, mean (α)', 'x: constant change, variance',
      'x: constant change ↔ initial true score', 'x: proportional change (β), change on the previous true score', 'x: autoregression of the changes (φ), change on the previous change', 'x: residual variance (each occasion)']);
    const b = await lcsR(bi, { x: ['x1', 'x2', 'x3'], y: ['y1', 'y2', 'y3'], modelX: { constant: true, proportional: true, autoregressive: false }, modelY: { constant: true, proportional: true, autoregressive: true },
      coupling: { deltaXY: true, deltaYX: false, xiXY: false, xiYX: true }, estimator: 'MLR', missing: 'fiml' });
    // (this help model is not identified at three occasions — lavaan says its vcov is not positive definite — so its
    //  individual estimates are not determined and drift between desktop R and webR; what is identified is compared)
    const bh = REF.results.biHelp;
    expect(b.estimates.map((e) => e.label).sort()).toEqual(Object.keys(bh.estimates).sort());
    expect(b.fit.chisq ?? NaN).toBeCloseTo(bh.fit.chisq, 4);
    if (bh.fit.df !== undefined) expect(b.fit.df).toBe(bh.fit.df);
    expect(b.fit.logl ?? NaN).toBeCloseTo(bh.fit.logl, 4);
    b.impliedMeans.x.forEach((v, i) => expect(v).toBeCloseTo(bh.implied.x[i], 4));
    b.impliedMeans.y.forEach((v, i) => expect(v).toBeCloseTo(bh.implied.y[i], 4));
    // (lcsm's own help example: its vcov is not positive definite at three occasions, as lavaan says in lcsm too)
    expect(b.warnings.join(' ')).toMatch(/positive definite/);
    expect(lcsRows(b).map((t) => t.title)).toEqual(['Change components', 'Coupling between the variables', 'Covariances between the variables']);
    expect(lcsRows(b)[1].rows.map(([w]) => w)).toEqual(['y (true score, t−1) → change in x (δ)', 'x (change, t−1) → change in y (ξ)']);
    // lcsm's Mplus-mimic defaults give the same estimates (its standard errors are computed differently)
    for (const k of Object.keys(REF.results.uniHelp.estimates)) expect(REF.results.uniHelpMplus.estimates[k].est).toBeCloseTo(REF.results.uniHelp.estimates[k].est, 4);
  }, 900_000);

  it('the home-screen example runs through its cards as lcsm fits it (Demo.growth, ML)', async () => {
    const ex = PACKAGE_EXAMPLES.find((e) => e.id === 'lavaan-demogrowth-lcs')!;
    exampleCheck(ex.id, { title: ex.title, method: 'Longitudinal', packages: ['lavaan'], definition: ex });
    const raw = await rCall<{ names: string[]; cols: (number | null)[][] }>('ps_dataset', { package: 'lavaan', name: 'Demo.growth', na: [] }, 'lavaan');
    const data: Dataset = { names: raw.names, cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))) };
    const ctx: AnalysisCtx = { data, info: null, settings: exampleSettings(DEFAULT_SETTINGS, ex.settings), pls: null, projectName: ex.title };
    const t = analysisType('lcs')!;
    const [uniPanel, biPanel] = examplePanels(ex);
    against(SOURCE);
    for (const [panel, ref] of [[uniPanel, REF.results.demoGrowthUni], [biPanel, REF.results.demoGrowth]] as const) {
      const o = t.parseOptions({ ...t.defaults(ctx), ...panelPreset(panel) })!;
      expect(t.blocked(o, ctx)).toBeNull();
      const r = (await t.run(o, ctx, () => {})) as LcsResult & { input: LcsInput };
      compare(r, ref, true);
      same('warnings', r.warnings.length, 0);
      const script = await t.script!(o, ctx);
      expect(script).toContain('fit <- lavaan(model, data = data, meanstructure = TRUE, fixed.x = FALSE');
      expect(script).toContain('lx2 ~ 1 * lx1');
    }
  }, 900_000);

  it('refuses too few or unmatched occasions; the script is self-contained', async () => {
    const uni = frame(REF.data.uni);
    const base: LcsInput = { x: ['x1', 'x2'], y: [], modelX: ALL, modelY: NONE, coupling: NO, estimator: 'ML', missing: 'casewise' };
    await expect(lcsR(uni, base)).rejects.toThrow(/at least three occasions/);
    await expect(lcsR(uni, { ...base, x: ['x1', 'x2', 'x3'], y: ['x4', 'x5'] })).rejects.toThrow(/same number of occasions/);
    const script = await lcsScriptR(uni, { ...base, x: ['x1', 'x2', 'x3'] });
    expect(script).toContain('data <- read.csv(text =');
    expect(script).toContain('data <- data[complete.cases(data), , drop = FALSE]');
    expect(script).toContain('dx3 ~ phi_x * dx2');
  }, 900_000);
});
