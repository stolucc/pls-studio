// The MCAR tests of the missing-data card (cards/missing.ts) in webR: the example's data loaded as the app loads it, its
// card set up from the example's options and run as the Run button runs it, and compared with misty run natively in
// desktop R (scripts/validation/mcar.R → src/engine/__fixtures__/mcar/airquality.json): ?na.test's Example 1 (Little's
// test; each pattern's share by Little's formula from mvnmle::mlest) and Example 2 (Jamshidian & Jalal's tests, seed 42),
// which MissMech::TestMCARNormality(airquality, imputation.number = 20, seed = 42) reproduces (the medians of its p-values).
// Run with WEBR_TESTS=1 npx vitest run src/examples/cards/missing (PS_NATIVE_R=1: desktop R).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { analysisType } from '../../analyses/registry';
import type { AnalysisCtx } from '../../analyses/types';
import type { Dataset } from '../../engine/types';
import { categoriesOf } from '../../io';
import { DEFAULT_SETTINGS } from '../../model/project';
import { rCall, type RPackage } from '../../rengine/bridge';
import type { MissingDataResult } from '../../rengine/screen';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { against, cleanRun, example, near, same } from '../../validation/record';
import { exampleSettings, panelPreset } from '../packages';
import { CARD_MISSING } from './missing';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

interface Ref {
  R: string; misty: string; mvnmle: string;
  little: { n: number; incomplete: number; patterns: number; chisq: number; df: number; p: number; byPattern: { key: string; n: number; k: number; d2: number }[] };
  jamjal: { n: number; incomplete: number; patterns: number; patternN: number[]; hawkins: { stat: number; df: number; p: number }; anderson: { stat: number; p: number } };
  MissMech: { version: string; hawkinsP: number; andersonP: number; patterns: number };
}
const REF = JSON.parse(readFileSync(join(__dirname, '..', '..', 'engine', '__fixtures__', 'mcar', 'airquality.json'), 'utf8')) as Ref;

it('misty-airquality-mcar: Little’s MCAR test with each pattern’s share, and Jamshidian & Jalal’s tests, as misty’s ?na.test', async () => {
  const e = CARD_MISSING.find((x) => x.id === 'misty-airquality-mcar')!;
  example(e.id, { title: e.title, method: 'Data', packages: ['misty', 'mvnmle'], definition: e });
  const raw = await rCall<{ names: string[]; cols: (number | null)[][]; levels?: Record<string, string[]> }>('ps_dataset', { package: e.data.package, name: e.data.name, na: [] }, e.data.package as RPackage);
  const data: Dataset = { names: raw.names, cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))), ...categoriesOf(raw.levels) };
  const ctx: AnalysisCtx = { data, info: null, settings: exampleSettings(DEFAULT_SETTINGS, e.settings), pls: null, projectName: e.title };
  const t = analysisType('missingdata')!;
  const options = t.parseOptions({ ...t.defaults(ctx), ...panelPreset(e.panel!) })!;
  expect(options.mcar && options.jamjal).toBe(true);
  expect(t.blocked(options, ctx)).toBeNull();
  const r = await t.run(options, ctx, () => {}) as MissingDataResult;
  cleanRun(r.warnings.length);
  expect(r.warnings).toEqual([]);
  same('engine', r.engine.package, 'misty');

  against({ label: `misty ${REF.misty} in desktop ${REF.R}: na.test(airquality) (?na.test, Example 1); the shares by Little’s formula from mvnmle ${REF.mvnmle}::mlest (scripts/validation/mcar.R)`, level: 'native', script: 'scripts/validation/mcar.R' });
  const l = r.little!;
  same('cases', l.n, REF.little.n);
  same('incomplete cases', l.incomplete, REF.little.incomplete);
  same('patterns', l.patterns, REF.little.patterns);
  near('Little’s χ²', l.chisq, REF.little.chisq, 1e-6);
  same('df', l.df, REF.little.df);
  near('p', l.p, REF.little.p, 1e-8);
  same('patterns with a share', l.byPattern.length, REF.little.byPattern.length);
  REF.little.byPattern.forEach((w, i) => {
    const g = l.byPattern[i];
    same(`pattern ${w.key}: observed`, g.observed.map((o) => (o ? '0' : '1')).join(''), w.key);
    same(`pattern ${w.key}: cases`, g.n, w.n);
    same(`pattern ${w.key}: observed variables`, g.k, w.k);
    near(`pattern ${w.key}: share of χ²`, g.d2, w.d2, 1e-6);
  });
  near('the shares sum to χ²', l.byPattern.reduce((s, x) => s + x.d2, 0), l.chisq, 1e-6);
  // Every pattern with a share is one of the card's patterns.
  for (const g of l.byPattern) expect(r.patterns.some((p) => p.observed.join() === g.observed.join())).toBe(true);

  against({ label: `misty ${REF.misty}: na.test(airquality, print = "jamjal") (?na.test, Example 2, seed 42); MissMech ${REF.MissMech.version}::TestMCARNormality(airquality, imputation.number = 20, seed = 42) gives the same medians (scripts/validation/mcar.R)`, level: 'native', script: 'scripts/validation/mcar.R' });
  const j = r.jamjal!;
  if ('error' in j) throw new Error(j.error);
  same('cases in patterns of at least 6', j.n, REF.jamjal.n);
  same('patterns used', j.patterns, REF.jamjal.patterns);
  same('their sizes', j.patternN.join(', '), REF.jamjal.patternN.join(', '));
  near('Hawkins statistic', j.hawkins.stat, REF.jamjal.hawkins.stat, 1e-6);
  same('Hawkins df', j.hawkins.df, REF.jamjal.hawkins.df);
  near('Hawkins p', j.hawkins.p, REF.jamjal.hawkins.p, 1e-8);
  near('Anderson-Darling statistic', j.anderson.stat, REF.jamjal.anderson.stat, 1e-6);
  near('Anderson-Darling p', j.anderson.p, REF.jamjal.anderson.p, 1e-8);
  near('MissMech agrees: Hawkins p', REF.MissMech.hawkinsP, REF.jamjal.hawkins.p, 1e-10);
  near('MissMech agrees: Anderson-Darling p', REF.MissMech.andersonP, REF.jamjal.anderson.p, 1e-10);

  const script = await t.script!(options, ctx);
  expect(script).toContain('misty::na.test(as.data.frame(X), print = "little"');
  expect(script).toContain('print = "jamjal", seed = 42');
}, 900_000);

it('the MCAR tests are off for data without missing values: a note, no test', async () => {
  const data: Dataset = { names: ['a', 'b'], cols: [Float64Array.from({ length: 30 }, (_, i) => Math.sin(i)), Float64Array.from({ length: 30 }, (_, i) => Math.cos(i * 1.7))] };
  const ctx: AnalysisCtx = { data, info: null, settings: DEFAULT_SETTINGS, pls: null, projectName: 'complete' };
  const t = analysisType('missingdata')!;
  const r = await t.run({ ...t.defaults(ctx), vars: ['a', 'b'], mcar: true, jamjal: true }, ctx, () => {}) as MissingDataResult;
  expect(r.little).toBeUndefined();
  expect(r.jamjal).toBeUndefined();
  expect(r.patterns).toHaveLength(1);
}, 300_000);
