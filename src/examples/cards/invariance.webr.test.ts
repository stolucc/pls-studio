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
import type { AlignmentResult } from '../../rengine/invariance';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { against, cleanRun, example, near, same } from '../../validation/record';
import { exampleModel, examplePanels, exampleSettings, panelPreset, type ExamplePanel, type PackageExample } from '../packages';
import { CARD_INVARIANCE } from './invariance';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const REF = JSON.parse(readFileSync(join(__dirname, '..', '..', 'engine', '__fixtures__', 'invariance', 'reference.json'), 'utf8'));
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
  expect(script).toContain('invariance.alignment(');
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
