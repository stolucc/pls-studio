// The validity card examples (cards/validity.ts) in webR: each example's data loaded as the app loads it, its cards set up
// from the example's options and run as the Run button runs them, and compared with their references:
//   - seminr-corprep-cmb: seminr 2.6.0 run natively in desktop R 4.6.2 (scripts/validation/validity_cards.R):
//     diag(solve(cor(m$construct_scores))) of the extended corporate reputation model, and psych 2.6.9's
//     principal(X, nfactors = 1, rotate = "none") on the 31 indicators' complete cases;
//   - polit-cvi: the I-CVIs, S-CVI/UA and S-CVI/Ave Polit & Beck (2006) print in Table 1, and pc and k* by
//     Polit, Beck & Owen's (2007) formula (desktop R, the same script).
// Run with WEBR_TESTS=1 npx vitest run src/examples/cards/validity.

import { afterAll, beforeAll, expect, it } from 'vitest';
import { analysisType } from '../../analyses/registry';
import type { AnalysisCtx } from '../../analyses/types';
import { plsOptions } from '../../analyses/plsAssessment';
import type { Dataset } from '../../engine/types';
import { categoriesOf } from '../../io';
import { DEFAULT_SETTINGS, toSpec } from '../../model/project';
import { rCall, type RPackage } from '../../rengine/bridge';
import { estimatePlsR } from '../../rengine/pls';
import type { CmbResult, CviResult } from '../../rengine/validity';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { against, cleanRun, example, near, same } from '../../validation/record';
import { exampleModel, examplePanels, exampleSettings, panelPreset, type ExamplePanel, type PackageExample } from '../packages';
import { exampleTestData } from '../testData';
import { CARD_VALIDITY } from './validity';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const ex = (id: string) => { const e = CARD_VALIDITY.find((x) => x.id === id); if (!e) throw new Error(`No example ${id}`); return e; };

/** The example's data as the app opens it: a CSV shipped with the app or the package's dataset. */
async function load(e: PackageExample): Promise<Dataset> {
  const fromFile = exampleTestData(e);
  if (fromFile) return fromFile;
  const raw = await rCall<{ names: string[]; cols: (number | null)[][]; levels?: Record<string, string[]> }>('ps_dataset', { package: e.data.package, name: e.data.name, na: e.data.na ?? [] }, e.data.package as RPackage);
  return { names: raw.names, cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))), ...categoriesOf(raw.levels) };
}

/** One of the example's cards run as the app runs it (options through parseOptions, blocked() clear), its run checked clean. */
async function runPanel<R>(id: string, ctx: AnalysisCtx, p: ExamplePanel): Promise<R> {
  const t = analysisType(p.kind)!;
  const options = t.parseOptions({ ...t.defaults(ctx), ...panelPreset(p) })!;
  expect(t.blocked?.(options, ctx) ?? null, `${id}: the ${p.kind} card is ready to run`).toBeNull();
  const r = await t.run(options, ctx, () => {}) as R & { warnings: string[] };
  cleanRun(r.warnings.length);
  expect(r.warnings, `${id} warned`).toEqual([]);
  return r;
}

it('seminr-corprep-cmb: full-collinearity VIFs of seminr’s construct scores, and Harman’s test on the indicators', async () => {
  const e = ex('seminr-corprep-cmb');
  example(e.id, { title: e.title, method: 'PLS-SEM', packages: ['seminr', 'psych'], definition: e });
  const data = await load(e);
  const ctx: AnalysisCtx = { data, info: null, settings: exampleSettings(DEFAULT_SETTINGS, e.settings), pls: null, projectName: e.title, model: exampleModel(e) };
  ctx.pls = await estimatePlsR(data, toSpec(ctx.model!), plsOptions(ctx.settings), 'seminr');
  const [vifPanel, harmanPanel] = examplePanels(e);
  const vif = await runPanel<CmbResult>(e.id, ctx, vifPanel);
  against({ label: 'seminr 2.6.0 in desktop R 4.6.2: diag(solve(cor(construct_scores))) of the extended corporate reputation model (scripts/validation/validity_cards.R)', level: 'native' });
  same('n', vif.n, 344);
  same('type', vif.type, 'vif');
  const VIF: [string, number][] = [['QUAL', 4.27530465], ['PERF', 3.15195087], ['CSOR', 2.17468869], ['ATTR', 2.20154459], ['COMP', 2.76883519], ['LIKE', 2.68939866], ['CUSA', 2.02318416], ['CUSL', 2.32231710]];
  same('constructs', vif.rows!.map((x) => x.variable).join(', '), VIF.map(([k]) => k).join(', '));
  for (const [k, v] of VIF) { const row = vif.rows!.find((x) => x.variable === k)!; near(`VIF of ${k}`, row.vif, v, 1e-5); near(`R² of ${k}`, row.r2, 1 - 1 / v, 1e-6); }
  near('largest VIF', vif.maxVif!, 4.27530465, 1e-5);
  const harman = await runPanel<CmbResult>(e.id, ctx, harmanPanel);
  against({ label: 'psych 2.6.9 in desktop R 4.6.2: principal(X, nfactors = 1, rotate = "none") on the 31 indicators’ 336 complete cases (scripts/validation/validity_cards.R)', level: 'native' });
  same('complete cases', harman.n, 336);
  same('indicators', harman.vars.length, 31);
  near('share of variance of the single component', harman.share!, 0.4072987408, 1e-7);
  near('sum of squared loadings', harman.ssLoadings!, 12.62626097, 1e-6);
  near('largest eigenvalue', harman.eigenvalues![0], 12.62626097, 1e-6);
  same('eigenvalues above 1', harman.kaiser!, 4);
  expect(harman.loadings).toHaveLength(31);
}, 900_000);

it('polit-cvi: Polit & Beck’s (2006) Table 1 and the modified kappa of Polit, Beck & Owen (2007)', async () => {
  const e = ex('polit-cvi');
  example(e.id, { title: e.title, method: 'Measurement', packages: ['stats'], definition: e });
  const data = await load(e);
  const ctx: AnalysisCtx = { data, info: null, settings: { ...DEFAULT_SETTINGS, ...e.settings }, pls: null, projectName: e.title };
  const r = await runPanel<CviResult>(e.id, ctx, e.panel!);
  against({ label: 'Polit & Beck (2006), Table 1: the printed I-CVIs, S-CVI/UA and S-CVI/Ave (two decimals)', level: 'published', url: 'https://doi.org/10.1002/nur.20147' });
  same('items', r.nItems, 10);
  same('experts', r.experts.length, 3);
  for (let i = 0; i < 7; i++) near(`I-CVI of item ${i + 1}`, r.items[i].icvi, 1.0, 1e-12);
  for (let i = 7; i < 10; i++) near(`I-CVI of item ${i + 1}`, r.items[i].icvi, 0.67, 0.005);
  near('S-CVI/UA', r.scviUA, 0.7, 1e-12);
  near('S-CVI/Ave', r.scviAve, 0.9, 1e-12);
  against({ label: 'Polit, Beck & Owen (2007): pc = N! / [A! (N − A)!] × .5ᴺ and k* = (I-CVI − pc) / (1 − pc), computed in desktop R (scripts/validation/validity_cards.R)', level: 'native' });
  for (let i = 0; i < 7; i++) { near(`pc of item ${i + 1}`, r.items[i].pc, 0.125, 1e-12); near(`k* of item ${i + 1}`, r.items[i].kappa, 1, 1e-12); }
  for (let i = 7; i < 10; i++) { near(`pc of item ${i + 1}`, r.items[i].pc, 0.375, 1e-12); near(`k* of item ${i + 1}`, r.items[i].kappa, 0.4666666667, 1e-9); }
  same('item labels', r.items.map((x) => x.item).join(' '), '1 2 3 4 5 6 7 8 9 10');
  same('each expert rated every item', r.expertProportions.map((x) => x.rated).join(','), '10,10,10');
}, 600_000);
