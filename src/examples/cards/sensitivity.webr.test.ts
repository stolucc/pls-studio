// The sensitivity cards' examples (cards/sensitivity.ts) in webR: each example's data and diagram as the app opens
// them, its card set up from the example's options and run as the Run button runs it, and compared with the packages
// run natively in desktop R on their help pages' calls (scripts/validation/sensitivity.R →
// src/engine/__fixtures__/sensitivity/reference.json):
//   - semsens-sa-aco: SEMsens's ?sa.aco (opt.fun = 3, k = 5, max.iter = 10, seed 1): sens.tables and every
//     evaluation's standardised estimates;
//   - mediation-jobs-medsens: mediation's ?medsens Example 1: the ACME and ADE curves with their bands, and where each is zero.
// Run with WEBR_TESTS=1 npx vitest run src/examples/cards/sensitivity (PS_NATIVE_R=1: desktop R).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { analysisType } from '../../analyses/registry';
import type { AnalysisCtx } from '../../analyses/types';
import type { Dataset } from '../../engine/types';
import { categoriesOf } from '../../io';
import { DEFAULT_SETTINGS } from '../../model/project';
import { rCall, type RPackage } from '../../rengine/bridge';
import type { MedsensResult, SemsensResult } from '../../rengine/sensitivity';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { against, cleanRun, example, near, same } from '../../validation/record';
import { exampleModel, exampleSettings, panelPreset, type PackageExample } from '../packages';
import { exampleTestData } from '../testData';
import { CARD_SENSITIVITY } from './sensitivity';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

interface Tab { row: string; values: (number | null)[] }
const REF = JSON.parse(readFileSync(join(__dirname, '..', '..', 'engine', '__fixtures__', 'sensitivity', 'reference.json'), 'utf8')) as {
  R: string; lavaan: string; SEMsens: string; mediation: string;
  semsens: { n: number; 'n.eval': number; 'n.iter': number; 'max.y': number; 'sens.summary': Tab[]; 'phan.paths': Tab[]; 'phan.min': Tab[]; 'phan.max': Tab[]; 'p.paths': Tab[]; draws: { path: string; est: number[] }[] };
  medsens: Record<string, number | number[]>;
};
const ex = (id: string) => CARD_SENSITIVITY.find((x) => x.id === id)!;

async function load(e: PackageExample): Promise<Dataset> {
  const fromFile = exampleTestData(e);
  if (fromFile) return fromFile;
  const raw = await rCall<{ names: string[]; cols: (number | null)[][]; levels?: Record<string, string[]> }>('ps_dataset', { package: e.data.package, name: e.data.name, na: e.data.na ?? [] }, e.data.package as RPackage);
  return { names: raw.names, cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))), ...categoriesOf(raw.levels) };
}
async function run<R>(e: PackageExample): Promise<{ r: R; script: string }> {
  const data = await load(e);
  const ctx: AnalysisCtx = { data, info: null, settings: exampleSettings(DEFAULT_SETTINGS, e.settings), pls: null, projectName: e.title, model: exampleModel(e) };
  const t = analysisType(e.panel!.kind)!;
  const options = t.parseOptions({ ...t.defaults(ctx), ...panelPreset(e.panel!) })!;
  expect(t.blocked(options, ctx), `${e.id}: the card is ready to run`).toBeNull();
  const r = await t.run(options, ctx, () => {}) as R & { warnings: string[] };
  cleanRun(r.warnings.length);
  expect(r.warnings, `${e.id} warned`).toEqual([]);
  return { r, script: await t.script!(options, ctx) };
}
/** A table cell: both missing, or equal within the tolerance. */
function cell(what: string, got: number | undefined, want: number | null, tol: number) {
  if (want === null) same(`${what}: none`, Number.isFinite(got ?? NaN) ? 'a value' : 'none', 'none');
  else near(what, got ?? NaN, want, tol);
}

it('semsens-sa-aco: SEMsens’s ?sa.aco, every table of sens.tables and every evaluation', async () => {
  const e = ex('semsens-sa-aco');
  example(e.id, { title: e.title, method: 'CB-SEM', packages: ['SEMsens', 'lavaan'], definition: e });
  const { r, script } = await run<SemsensResult>(e);
  const s = REF.semsens;
  against({ label: `SEMsens ${REF.SEMsens} in desktop ${REF.R} (lavaan ${REF.lavaan}): sa.aco on the help page’s data, model and settings with seed = 1, sens.tables(sort = FALSE) (scripts/validation/sensitivity.R)`, level: 'native', script: 'scripts/validation/sensitivity.R' });
  same('converged evaluations', r.evaluations, s['n.eval']);
  same('tried', r.tried, s['n.iter']);
  // (the app writes the observed mediator as a single-indicator factor m_lv =~ 1*m, m ~~ 0*m: the same model, which
  // lavaan's optimiser reaches to about 1e-6; the objective, a mean change of p-values, differs by 1.4e-6)
  near('best objective', r.maxObjective, s['max.y'], 1e-5);
  const byRow = <T extends { from: string; to: string }>(rows: T[], row: string): T | undefined => { const [to, from] = row.split('~'); return rows.find((x) => x.from === from && x.to === to); };
  for (const [name, mine, ref, cols] of [['summary', r.summary, s['sens.summary'], 5], ['at minimum', r.atMin, s['phan.min'], 3], ['at maximum', r.atMax, s['phan.max'], 3], ['flip', r.flip, s['p.paths'], 5]] as const) {
    for (const w of ref) {
      const g = byRow(mine, w.row);
      expect(g, `${name}: ${w.row}`).toBeTruthy();
      for (let j = 0; j < cols; j++) cell(`${name}: ${w.row} [${j + 1}]`, g!.values[j], w.values[j], 1e-6);
    }
  }
  for (const w of s['phan.paths']) { const g = r.phantom.find((p) => `${p.construct}~phantom` === w.row)!; for (let j = 0; j < 3; j++) cell(`phantom: ${w.row} [${j + 1}]`, g.values[j], w.values[j], 1e-6); }
  for (const d of s.draws) {
    const got = d.path.endsWith('~phantom') ? r.draws.phantom[r.phantoms.indexOf(d.path.split('~')[0])] : byRow(r.draws.path, d.path)?.est;
    same(`${d.path}: evaluations`, got?.length ?? 0, d.est.length);
    d.est.forEach((v, i) => near(`${d.path}: evaluation ${i + 1}`, got![i], v, 1e-6));
  }
  expect(script).toContain('sa <- SEMsens::sa.aco(model = model, sens.model = sens_model, data = data');
  expect(script).toContain('opt.fun = 3, paths = path_rows, k = 5, n.of.ants = 10,');
}, 900_000);

it('mediation-jobs-medsens: mediation’s ?medsens Example 1, the curves and where they are zero', async () => {
  const e = ex('mediation-jobs-medsens');
  example(e.id, { title: e.title, method: 'Conditional process analysis', packages: ['mediation'], definition: e });
  const { r, script } = await run<MedsensResult>(e);
  const m = REF.medsens as Record<string, number & number[]>;
  against({ label: `mediation ${REF.mediation} in desktop ${REF.R}: ?medsens Example 1, medsens(rho.by = .1, eps = .01, effect.type = "both") (scripts/validation/sensitivity.R)`, level: 'native', script: 'scripts/validation/sensitivity.R' });
  same('N', r.n, m.n);
  same('grid', r.rho.map((x) => x.toFixed(2)).join(' '), m.rho.map((x: number) => x.toFixed(2)).join(' '));
  for (const [mine, ref] of [[r.acme.est, 'd0'], [r.acme.lo, 'lower.d0'], [r.acme.hi, 'upper.d0'], [r.ade.est, 'z0'], [r.ade.lo, 'lower.z0'], [r.ade.hi, 'upper.z0'], [r.r2starProd, 'R2star.prod'], [r.r2tildeProd, 'R2tilde.prod']] as const) {
    (m[ref] as number[]).forEach((v, i) => near(`${ref} at rho = ${m.rho[i].toFixed(1)}`, mine[i], v, 1e-8));
  }
  near('rho at which ACME = 0', r.acmeZero.rho!, m['err.cr.d'], 1e-10);
  near('R2*M R2*Y at which ACME = 0', r.acmeZero.r2star!, m['R2star.d.thresh'], 1e-10);
  near('R2~M R2~Y at which ACME = 0', r.acmeZero.r2tilde!, m['R2tilde.d.thresh'], 1e-8);
  near('rho at which ADE = 0', r.adeZero.rho!, m['err.cr.z'], 1e-10);
  near('R2*M R2*Y at which ADE = 0', r.adeZero.r2star!, m['R2star.z.thresh'], 1e-10);
  near('R2~M R2~Y at which ADE = 0', r.adeZero.r2tilde!, m['R2tilde.z.thresh'], 1e-8);
  near('R² of the mediator equation', r.r2m, m['r.square.m'], 1e-10);
  near('R² of the outcome equation', r.r2y, m['r.square.y'], 1e-10);
  expect(script).toContain('fit_m <- lm(job_seek ~ treat + econ_hard + sex + age, data = data)');
  expect(script).toContain('sens <- medsens(med, rho.by = 0.1, eps = 0.01, effect.type = "both")');
}, 900_000);
