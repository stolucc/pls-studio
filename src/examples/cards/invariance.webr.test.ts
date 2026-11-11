// The measurement invariance card examples (cards/invariance.ts): each example's data loaded as the app loads it, its
// card set up from the example's options and run as the Run button runs it, and compared with the package's documented
// workflow run natively in desktop R (scripts/validation/invariance_cards.R → src/engine/__fixtures__/invariance/reference.json).
// Run with WEBR_TESTS=1 PS_NATIVE_R=1 npx vitest run src/examples/cards/invariance (or in webR without PS_NATIVE_R).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { analysisType } from '../../analyses/registry';
import type { AnalysisCtx } from '../../analyses/types';
import type { Dataset } from '../../engine/types';
import { categoriesOf } from '../../io';
import { DEFAULT_SETTINGS } from '../../model/project';
import { rCall, type RPackage } from '../../rengine/bridge';
import type { AlignmentResult, LsemResult, MnlfaResult } from '../../rengine/invariance';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { against, cleanRun, example, near, same } from '../../validation/record';
import { exampleModel, examplePanels, exampleSettings, panelPreset, type ExamplePanel, type PackageExample } from '../packages';
import { CARD_INVARIANCE } from './invariance';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const REF = JSON.parse(readFileSync(join(__dirname, '..', '..', 'engine', '__fixtures__', 'invariance', 'reference.json'), 'utf8'));
const LSEM = JSON.parse(readFileSync(join(__dirname, '..', '..', 'engine', '__fixtures__', 'invariance', 'lsem.json'), 'utf8'));
const ex = (id: string) => { const e = CARD_INVARIANCE.find((x) => x.id === id); if (!e) throw new Error(`No example ${id}`); return e; };

async function load(e: PackageExample): Promise<Dataset> {
  const raw = await rCall<{ names: string[]; cols: (number | null)[][]; levels?: Record<string, string[]> }>('ps_dataset', { package: e.data.package, name: e.data.name, na: e.data.na ?? [] }, e.data.package as RPackage);
  return { names: raw.names, cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))), ...categoriesOf(raw.levels) };
}

async function runPanel<R>(id: string, ctx: AnalysisCtx, p: ExamplePanel, options: Record<string, unknown> = {}): Promise<R> {
  const t = analysisType(p.kind)!;
  const o = t.parseOptions({ ...t.defaults(ctx), ...panelPreset(p), ...options })!;
  expect(t.blocked(o, ctx), `${id}: the ${p.kind} card is ready to run`).toBeNull();
  const r = await t.run(o, ctx, () => {}) as R & { warnings: string[] };
  cleanRun(r.warnings.length);
  expect(r.warnings, `${id} warned`).toEqual([]);
  const script = await t.script!(o, ctx);
  expect(script).toContain(p.kind === 'alignment' ? 'invariance.alignment(' : 'mod <- mnlfa(');
  return r;
}

const rowsNear = (what: string, got: number[][], want: number[][], tol: number) => want.forEach((row, g) => row.forEach((v, j) => near(`${what} [${g + 1}, ${j + 1}]`, got[g][j], v, tol)));

it('sirt-inv4gr-alignment: the help page’s alignment of data.inv4gr, as sirt’s documented workflow gives it', async () => {
  const e = ex('sirt-inv4gr-alignment');
  example(e.id, { title: e.title, method: 'CB-SEM', packages: ['sirt', 'lavaan'], definition: e });
  const data = await load(e);
  const ctx: AnalysisCtx = { data, info: null, settings: exampleSettings(DEFAULT_SETTINGS, e.settings), pls: null, projectName: e.title, model: exampleModel(e) };
  const [panel] = examplePanels(e);
  const ref = REF.cases.alignment;
  against({ label: `sirt ${REF.sirt} and lavaan ${REF.lavaan} in desktop ${REF.R}: ?invariance.alignment example 2 as written (scripts/validation/invariance_cards.R)`, level: 'native', script: 'scripts/validation/invariance_cards.R' });
  const r = await runPanel<AlignmentResult>(e.id, ctx, panel);
  same('groups', r.groups.join(' '), '1 2 3 4');
  same('N per group', r.n.join(' '), '1000 1000 1000 1000');
  near('configural χ² (the help page prints 162.084)', r.fit.chisq, ref.chisq, 1e-6);
  same('configural df', r.fit.df, ref.df);
  const f = r.factors[0];
  same('items', f.items.join(' '), 'I01 I02 I03 I04 I05 I06 I07 I08 I09 I10 I11');
  rowsNear('configural loadings', f.lambda, ref.lambda, 1e-6);
  rowsNear('configural intercepts', f.nu, ref.nu, 1e-6);
  ref.default.mean.forEach((v: number, g: number) => near(`aligned mean, group ${g + 1}`, f.mean[g], v, 1e-6));
  ref.default.sd.forEach((v: number, g: number) => near(`aligned SD, group ${g + 1}`, f.sd[g], v, 1e-6));
  near('R², loadings', f.r2.lambda, ref.default.r2[0], 1e-6);
  near('R², intercepts', f.r2.nu, ref.default.r2[1], 1e-6);
  near('rbar, loadings', f.rbar.lambda, ref.default.rbar[0], 1e-6);
  near('rbar, intercepts', f.rbar.nu, ref.default.rbar[1], 1e-6);
  near('√(1 − R²), loadings', f.sqrtU2.lambda, ref.default.sqrtU2[0], 1e-6);
  rowsNear('aligned loadings', f.lambdaAligned, ref.default.lambdaAligned, 1e-6);
  rowsNear('aligned intercepts', f.nuAligned, ref.default.nuAligned, 1e-6);
  near('loss', f.fopt, ref.default.fopt, 1e-6);
  same('converged', String(f.converged), 'true');
  near('non-invariant loadings (tolerance .2)', f.lambdaConstraints.noninvariant, ref.noninvariant.lambda, 1e-9);
  near('non-invariant intercepts (tolerance .4)', f.nuConstraints.noninvariant, ref.noninvariant.nu, 1e-9);
  // Lower tolerances, √N weights and least squares: the same card, other options
  const low = await runPanel<AlignmentResult>(e.id, ctx, panel, { tolLambda: 0.05, tolNu: 0.1 });
  near('non-invariant loadings (tolerance .05)', low.factors[0].lambdaConstraints.noninvariant, ref.noninvariant05.lambda, 1e-9);
  near('non-invariant intercepts (tolerance .1)', low.factors[0].nuConstraints.noninvariant, ref.noninvariant05.nu, 1e-9);
  same('non-invariant loadings per item (tolerance .05)', low.factors[0].lambdaConstraints.unique.join(' '), ref.noninvariant05.lambdaUnique.join(' '));
  same('non-invariant intercepts per item (tolerance .1)', low.factors[0].nuConstraints.unique.join(' '), ref.noninvariant05.nuUnique.join(' '));
  const w = await runPanel<AlignmentResult>(e.id, ctx, panel, { groupWeights: 'sqrtN' });
  ref.weighted.mean.forEach((v: number, g: number) => near(`√N weights: aligned mean, group ${g + 1}`, w.factors[0].mean[g], v, 1e-6));
  const ls = await runPanel<AlignmentResult>(e.id, ctx, panel, { powerLambda: 2, powerNu: 2 });
  ref.leastSquares.mean.forEach((v: number, g: number) => near(`least squares: aligned mean, group ${g + 1}`, ls.factors[0].mean[g], v, 1e-6));
  ref.leastSquares.sd.forEach((v: number, g: number) => near(`least squares: aligned SD, group ${g + 1}`, ls.factors[0].sd[g], v, 1e-6));
  near('least squares: R², loadings', ls.factors[0].r2.lambda, ref.leastSquares.r2[0], 1e-6);
}, 600_000);

it('mnlfa-mnlfa01-dif: the help page’s model 4, and a 2PL with a categorical covariate, as mnlfa gives them', async () => {
  const e = ex('mnlfa-mnlfa01-dif');
  example(e.id, { title: e.title, method: 'Measurement', packages: ['mnlfa'], definition: e });
  const data = await load(e);
  const ctx: AnalysisCtx = { data, info: null, settings: exampleSettings(DEFAULT_SETTINGS, e.settings), pls: null, projectName: e.title };
  const [panel] = examplePanels(e);
  against({ label: `mnlfa ${REF.mnlfa} in desktop ${REF.R}: ?mnlfa example 1, model 4 as written (scripts/validation/invariance_cards.R)`, level: 'native', script: 'scripts/validation/invariance_cards.R' });
  // (webR vs desktop R: the same package versions; the WebAssembly build's floating point moves optimiser results by ~1e-6)
  const check = (what: string, r: MnlfaResult, ref: { parm: string[]; est: number[]; traitEst: number[]; deviance: number; npar: number; aic: number; bic: number }, rename: (t: string) => string = (t) => t) => {
    same(`${what}: item parameters`, r.items.map((p) => `${p.item}_${p.kind}_${rename(p.term)}`).join(' '), ref.parm.join(' '));
    ref.est.forEach((v, k) => near(`${what}: ${ref.parm[k]}`, r.items[k].est, v, 1e-5));
    ref.traitEst.forEach((v, k) => near(`${what}: trait parameter ${k + 1}`, r.trait[k].est, v, 1e-5));
    near(`${what}: deviance`, r.fit.deviance, ref.deviance, 1e-5);
    same(`${what}: parameters`, r.fit.npar, ref.npar);
    near(`${what}: AIC`, r.fit.aic, ref.aic, 1e-5);
    near(`${what}: BIC`, r.fit.bic, ref.bic, 1e-5);
    same(`${what}: converged`, String(r.converged), 'true');
  };
  const m4 = await runPanel<MnlfaResult>(e.id, ctx, panel);
  check('model 4', m4, REF.cases.mnlfa.model4);
  same('model 4: trait terms', m4.trait.map((t) => `${t.kind}_${t.term}`).join(' '), REF.cases.mnlfa.model4.trait.join(' '));
  // A three-level categorical covariate (named categories) and the 2PL
  const n = data.cols[0].length;
  const withGroup: AnalysisCtx = { ...ctx, data: { ...data, names: [...data.names, 'grp'], cols: [...data.cols, Float64Array.from({ length: n }, (_, i) => (i % 3) + 1)], categories: { ...data.categories, grp: ['red', 'green', 'blue'] } } };
  const two = await runPanel<MnlfaResult>(e.id, withGroup, panel, { itemType: '2PL', covariates: ['age', 'grp'], categorical: ['grp'], intercept: ['age'], slope: ['grp'], mean: ['grp'], sd: ['age'], moderated: ['I1', 'I2', 'I3'] });
  check('2PL, categorical covariate', two, REF.cases.mnlfa.twoPL, (t) => t.replace(/^grp_/, 'grp'));
  same('dummy terms named by category', two.terms.map((t) => `${t.covariate}=${t.level ?? ''}`).join(' '), 'age= grp=green grp=blue');
}, 600_000);

it('sirt-lsem01-age: the help page’s local SEM of data.lsem01, its bootstrap and permutation test, as sirt gives them', async () => {
  const e = ex('sirt-lsem01-age');
  example(e.id, { title: e.title, method: 'CB-SEM', packages: ['sirt', 'lavaan'], definition: e });
  const data = await load(e);
  const ctx: AnalysisCtx = { data, info: null, settings: exampleSettings(DEFAULT_SETTINGS, e.settings), pls: null, projectName: e.title, model: exampleModel(e) };
  const [panel] = examplePanels(e);
  const t = analysisType('lsem')!;
  const opts = (more: Record<string, unknown> = {}) => t.parseOptions({ ...t.defaults(ctx), ...panelPreset(panel), ...more })!;
  against({ label: `sirt ${LSEM.sirt} and lavaan ${LSEM.lavaan} in desktop ${LSEM.R}: ?lsem.estimate example 1, model 1 as written, lsem.bootstrap and lsem.permutationTest after set.seed(1234) (scripts/validation/lsem.R)`, level: 'native', script: 'scripts/validation/lsem.R' });
  expect(t.blocked(opts(), ctx), 'the lsem card is ready to run').toBeNull();
  const r = await t.run(opts(), ctx, () => {}) as LsemResult;
  cleanRun(r.warnings.length);
  expect(r.warnings, `${e.id} warned`).toEqual([]);
  expect(await t.script!(opts(), ctx)).toContain('lsem.permutationTest(mod, B = 10');
  const m = LSEM.model1;
  same('N', r.n, m.n);
  same('focal points', r.grid.join(' '), m.grid.join(' '));
  near('bandwidth', r.bw, m.bw, 1e-12);
  m.weight.forEach((v: number, i: number) => near(`density weight at ${m.grid[i]}`, r.weight[i], v, 1e-9));
  m.neff.forEach((v: number, i: number) => near(`effective N at ${m.grid[i]}`, r.neff[i], v, 1e-9));
  same('parameters', r.params.map((p) => p.par).join(' '), m.pars.join(' '));
  // (webR vs desktop R: the same package versions; each local fit is an optimiser result, ~1e-6 apart in WebAssembly)
  for (const p of r.params) {
    const want = m.curves[p.par], s = m.summary[p.par];
    want.est.forEach((v: number, i: number) => near(`${p.par} at ${m.grid[i]}`, p.est[i], v, 1e-5));
    if (p.op !== 'fit') want.se.forEach((v: number, i: number) => near(`${p.par} SE at ${m.grid[i]}`, p.se[i]!, v, 1e-5));
    near(`${p.par}: SD over the focal points`, p.summary!.sd, s.sd, 1e-5);
    near(`${p.par}: linear slope`, p.summary!.linSlope, s.linSlope, 1e-5);
    near(`${p.par}: mean`, p.summary!.mean, s.mean, 1e-5);
    const perm = m.perm[p.par];
    if (perm) {
      near(`${p.par}: permutation p of the SD`, p.test!.sdP, perm.sdP, 1e-12);
      near(`${p.par}: permutation p of the MAD`, p.test!.madP, perm.madP, 1e-12);
      near(`${p.par}: permutation p of the slope`, p.test!.linSlopeP, perm.linSlopeP, 1e-12);
      same(`${p.par}: pointwise permutation p`, p.test!.pointwise.join(' '), perm.pointwise.join(' '));
    }
  }
  same('loadings and variances named back', r.params.filter((p) => p.op !== 'fit').map((p) => `${p.lhs}${p.op}${p.rhs}`).join(' '), m.pars.filter((x: string) => x.includes('~')).join(' '));
  // Bootstrap (20 samples after set.seed(1234)): some resamples have a negative residual variance at an end of the age range, which lavaan and sirt warn about
  const b = await t.run(opts({ permutation: false, bootstrap: true, bootR: 20 }), ctx, () => {}) as LsemResult;
  for (const w of b.warnings) expect(w).toMatch(/ov variances are negative|NaNs produced/);
  for (const p of b.params.filter((x) => x.op !== 'fit')) {
    const want = m.boot[p.par];
    want.se.forEach((v: number, i: number) => near(`${p.par}: bootstrap SE at ${m.grid[i]}`, p.boot!.se[i]!, v, 1e-5));
    want.lower.forEach((v: number, i: number) => near(`${p.par}: bootstrap lower limit at ${m.grid[i]}`, p.boot!.lower[i]!, v, 1e-5));
  }
  // Another kernel, bandwidth and grid
  const k = await t.run(opts({ permutation: false, kernel: 'epanechnikov', h: 1.1, points: 8 }), ctx, () => {}) as LsemResult;
  const m2 = LSEM.model2;
  m2.grid.forEach((v: number, i: number) => near(`Epanechnikov: focal point ${i + 1}`, k.grid[i], v, 1e-12));
  near('Epanechnikov: bandwidth', k.bw, m2.bw, 1e-12);
  for (const p of k.params) m2.curves[p.par].est.forEach((v: number, i: number) => near(`Epanechnikov, h = 1.1: ${p.par} at focal point ${i + 1}`, p.est[i], v, 1e-5));
  // FIML: the help page's example 2, its missing values of v1 and v2 (drawn in R after set.seed(98)) deleted here
  const fm = LSEM.fiml, drop = (name: string, rows: number[]) => { const k2 = data.names.indexOf(name); const col = Float64Array.from(data.cols[k2]); for (const r1 of rows) col[r1 - 1] = NaN; return col; };
  const holes: Dataset = { ...data, cols: data.cols.map((c, k2) => (data.names[k2] === 'v1' ? drop('v1', fm.missingV1) : data.names[k2] === 'v2' ? drop('v2', fm.missingV2) : c)) };
  const fctx: AnalysisCtx = { ...ctx, data: holes, settings: { ...ctx.settings, missing: 'fiml' } };
  const fo = opts({ permutation: false, from: 4, to: 22, points: 10 });
  expect(t.blocked(fo, fctx)).toBeNull();
  const f = await t.run(fo, fctx, () => {}) as LsemResult;
  same('FIML: parameters (with the mean structure FIML brings)', f.params.map((p) => p.par).join(' '), Object.keys(fm.curves).join(' '));
  for (const p of f.params) fm.curves[p.par].est.forEach((v: number, i: number) => near(`FIML: ${p.par} at ${fm.grid[i]}`, p.est[i], v, 1e-5));
}, 900_000);
