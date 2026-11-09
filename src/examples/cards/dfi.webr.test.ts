// The examples of cards/dfi.ts against the dynamic package run in desktop R on the help page's own call
// (scripts/validation/dfi.R → src/engine/__fixtures__/dfi/reference.json, the original packages). The package draws
// with fixed seeds of its own, so the same code and data give the same cutoffs, and every cell of its printed tables is
// compared as text (tolerance 0). Each example runs through its card (the card's own run(), the same rengine call the
// app makes): in the browser's R (npm run test:webr; the patched build of dynamic that loads without GenOrd and
// cubature, scripts/webr/fetch.mjs PATCHED), or with PS_NATIVE_R=1 (npm run test:native) in desktop R. The slower
// ones (minutes each in webR) run with WEBR_SLOW (npm run test:webr:all, validate:evidence).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Dataset } from '../../engine/types';
import { categoriesOf } from '../../io';
import { DEFAULT_SETTINGS } from '../../model/project';
import { analysisType } from '../../analyses/registry';
import type { AnalysisCtx } from '../../analyses/types';
import { dfiEmpirical, dfiVerdicts } from '../../analyses/dfi';
import { DESKTOP_ONLY, rCall, type RPackage } from '../../rengine/bridge';
import type { DfiResult, DfiTable } from '../../rengine/dfi';
import { slowIt } from '../../rengine/webrSlow';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { exampleModel, exampleSettings, PACKAGE_EXAMPLES, panelPreset, type PackageExample } from '../packages';
import { against, example as exampleCheck, near, same } from '../../validation/record';

const NATIVE = !!process.env.PS_NATIVE_R;
beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

interface Ref { fn: string | string[]; cutoffs: DfiTable | null; fit: DfiTable | null; equiv: { rmsea: string; cfi: string; rmseaBins: string[]; cfiBins: string[] } | null; dataNames: string[]; dataRows: number }
const FIXTURES = join(__dirname, '..', '..', 'engine', '__fixtures__', 'dfi');
const REF = JSON.parse(readFileSync(join(FIXTURES, 'reference.json'), 'utf8')) as { R: string; dynamic: string; lavaan: string; examples: Record<string, Ref> };
const SOURCE = { label: `dynamic ${REF.dynamic} in desktop ${REF.R} (lavaan ${REF.lavaan}): the help page’s call, scripts/validation/dfi.R`, level: 'native' as const, script: 'scripts/validation/dfi.R' };

const exampleOf = (id: string) => PACKAGE_EXAMPLES.find((e) => e.id === id)!;

async function load(ex: PackageExample): Promise<Dataset> {
  const raw = await rCall<{ names: string[]; cols: (number | null)[][]; levels?: Record<string, string[]> }>('ps_dataset', { package: ex.data.package, name: ex.data.name, na: ex.data.na ?? [] }, ex.data.package as RPackage);
  return { names: raw.names, cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))), ...categoriesOf(raw.levels) };
}

/** The example as the app opens it: its data, settings and diagram, and its card with the example's options. */
async function run(ex: PackageExample): Promise<{ result: DfiResult; call: string }> {
  const data = await load(ex);
  const ctx: AnalysisCtx = { data, info: null, settings: exampleSettings(DEFAULT_SETTINGS, ex.settings), pls: null, projectName: ex.title, model: exampleModel(ex) };
  const t = analysisType(ex.panel!.kind)!;
  const options = t.parseOptions({ ...t.defaults(ctx), ...panelPreset(ex.panel!) })!;
  expect(t.blocked(options, ctx), `${ex.id}: the card is ready to run`).toBeNull();
  const result = (await t.run(options, ctx, () => {})) as DfiResult;
  const script = await t.script!(options, ctx);
  expect(script).toContain('library(dynamic)');
  const call = /dfi <- dynamic::[^\n]*/.exec(script)?.[0] ?? '';
  return { result, call };
}

/** Every cell of a printed table equals the native one (the package prints its cutoffs rounded, so text equality is the comparison). */
function sameTable(what: string, got: DfiTable | null, want: DfiTable | null) {
  same(`${what}: rows`, got?.rows.join(' | ') ?? '', want?.rows.join(' | ') ?? '');
  same(`${what}: columns`, got?.columns.join(' | ') ?? '', want?.columns.join(' | ') ?? '');
  want?.rows.forEach((row, i) => want.columns.forEach((col, j) => { if (want.cells[i][j] !== '') same(`${what}: ${row || 'value'} ${col}`.trim(), got?.cells[i]?.[j] ?? '', want.cells[i][j]); }));
}

async function check(id: string) {
  const ex = exampleOf(id);
  exampleCheck(id, { title: ex.title, method: 'CB-SEM', packages: ['dynamic', 'lavaan'], definition: ex });
  const ref = REF.examples[id];
  expect(ref, `${id}: native reference recorded (Rscript scripts/validation/dfi.R)`).toBeTruthy();
  const { result: r, call } = await run(ex);
  against(NATIVE ? SOURCE : { ...SOURCE, label: `${SOURCE.label}; the card run in the browser’s R (webR, the patched build of dynamic)` });
  same('dynamic function', r.fn, Array.isArray(ref.fn) ? ref.fn[0] : ref.fn);
  same('dynamic version', String(r.engine?.version ?? ''), REF.dynamic);
  same('N', r.n, ex.data.name === 'Example' ? 500 : 301);
  sameTable('cutoffs', r.cutoffs, ref.cutoffs);
  sameTable('empirical fit indices', r.fit, ref.fit);
  if (r.fn !== 'equivTest') {
    same('simulated distributions: columns', r.data?.names.join(' | ') ?? '', ref.dataNames.join(' | '));
    same('simulated distributions: replications', r.data?.cols[0]?.length ?? 0, ref.dataRows);
  }
  expect(r.printed.length).toBeGreaterThan(3);
  expect(r.warnings, `${id}: no R warnings`).toEqual([]);
  expect(call).toContain(`dfi <- dynamic::${r.fn}(fit`);
  return r;
}

it('dynamic runs in the browser’s R too (the patched build loads without GenOrd and cubature)', () => {
  expect(DESKTOP_ONLY.has('dynamic')).toBe(false);
});

it('dynamic-hs-equivtest: equivTest’s T-size RMSEA and CFI and adjusted bins, by lavaan object and by hand', async () => {
  const r = await check('dynamic-hs-equivtest');
  const ref = REF.examples['dynamic-hs-equivtest'].equiv!;
  same('T-size RMSEA', r.equiv!.rmsea, ref.rmsea);
  same('T-size CFI', r.equiv!.cfi, ref.cfi);
  same('RMSEA bins', r.equiv!.rmseaBins.join(' | '), ref.rmseaBins.join(' | '));
  same('CFI bins', r.equiv!.cfiBins.join(' | '), ref.cfiBins.join(' | '));
  // The help page's manual entry (n = 301, T_ml = 85.306, df = 24, T_mli = 918.852, p = 9) is the same model: the same T-size values.
  const manual = (REF.examples as unknown as Record<string, { rmsea: string; cfi: string }>)['dynamic-hs-equivtest-manual'];
  same('T-size RMSEA, manual entry', r.equiv!.rmsea, manual.rmsea);
  same('T-size CFI, manual entry', r.equiv!.cfi, manual.cfi);
  same('both in the mediocre bin', dfiVerdicts(r).map((v) => v.verdict.split(' ')[0]).join(','), 'mediocre,mediocre');
}, 600_000);

it('dynamic-hs-exactfit: exactFit’s 99th and 95th percentiles of the exact-fit distributions', async () => {
  const r = await check('dynamic-hs-exactfit');
  same('percentile rows', r.cutoffs!.rows.join(' '), '99th: 95th:');
  same('χ² beyond the 99th percentile', String(dfiVerdicts(r)[0].ok), 'false');
}, 1_800_000);

it('dynamic-example-catone: catOne on five ordinal items (WLSMV)', async () => { await check('dynamic-example-catone'); }, 1_800_000);

// (minutes each in the browser's R: the slow suite)
slowIt('dynamic-hs-cfahb: cfaHB on the three-factor CFA gives the help page’s cutoffs (two levels, magnitudes .424 and .57)', async () => {
  const r = await check('dynamic-hs-cfahb');
  const v = dfiVerdicts(r);
  same('levels', r.cutoffs!.rows.filter((x) => /^Level-[1-9]/.test(x)).length, 2);
  same('magnitudes of the omitted cross-loadings', r.cutoffs!.cells.filter((c) => /^0?\.\d/.test(c[3])).map((c) => c[3]).join(' '), '0.424 0.57');
  same('SRMR clears no level (the vignette’s reading)', String(v.find((x) => x.index === 'SRMR')!.ok), 'false');
  near('empirical SRMR', dfiEmpirical(r.fit)!.srmr!, 0.065, 1e-9);
}, 1_800_000);

slowIt('dynamic-hs-cfaone: cfaOne on the one-factor model gives the help page’s three levels', async () => {
  const r = await check('dynamic-hs-cfaone');
  same('levels', r.cutoffs!.rows.filter((x) => /^Level-[1-9]/.test(x)).length, 3);
  near('empirical CFI', dfiEmpirical(r.fit)!.cfi!, 0.677, 1e-9);
}, 1_800_000);

slowIt('dynamic-holzinger-dddfi: DDDFI’s discrepancy-based cutoffs on the package’s Holzinger data', async () => {
  const r = await check('dynamic-holzinger-dddfi');
  same('levels', r.cutoffs!.rows.filter((x) => /^(Close|Fair|Mediocre)$/.test(x)).join(' '), 'Close Fair Mediocre');
  same('estimator', r.estimator ?? '', 'ML');
}, 1_800_000);

slowIt('dynamic-example-cathb: catHB on two factors of ordinal items (WLSMV)', async () => { await check('dynamic-example-cathb'); }, 1_800_000);
slowIt('dynamic-example-likertone: likertOne keeps the items’ response frequencies', async () => { await check('dynamic-example-likertone'); }, 1_800_000);
slowIt('dynamic-example-likerthb: likertHB on two factors of Likert items', async () => { await check('dynamic-example-likerthb'); }, 1_800_000);
slowIt('dynamic-example-nnorhb: nnorHB by a modified Bollen–Stine bootstrap of the data (MLR)', async () => { await check('dynamic-example-nnorhb'); }, 1_800_000);
