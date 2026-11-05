// The two multiple-imputation examples against their help pages run natively
// (scripts/validation/examples_mi.R): ?HS20imps (Amelia, seed 456, age and
// school as auxiliary variables) with ?lavaan.mi's cfa.mi, and
// ?pool.r.squared (mice, seed 16117) with lm(chl ~ age + hyp + bmi). The
// pooled point estimates (Rubin's rules: the means over the imputations)
// must agree. Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Dataset } from '../engine/types';
import { DEFAULT_SETTINGS, toSpec } from '../model/project';
import { rCall, type RPackage } from '../rengine/bridge';
import { cbScriptLavaan, estimateCbLavaan } from '../rengine/lavaan';
import { startTestRuntime, stopTestRuntime } from '../rengine/webrTestRuntime';
import { exampleModel, PACKAGE_EXAMPLES } from './packages';
import { against, example as exampleCheck, near } from '../validation/record';
import { exampleTestData } from './testData';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const ref = JSON.parse(readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'mi', 'examples.json'), 'utf8')) as { hs: Record<string, number>; nhanes: Record<string, number> };
const example = (id: string) => PACKAGE_EXAMPLES.find((e) => e.id === id)!;
const settingsOf = (id: string) => ({ ...DEFAULT_SETTINGS, ...example(id).settings });
const miOf = (id: string) => { const s = settingsOf(id); return { m: s.miImputations, seed: s.seed, method: s.miMethod, auxiliary: s.miAuxiliary, nominal: s.miNominal }; };

it('lavaanmi-hs: Amelia with the help page’s auxiliary variables and seed gives HS20imps: the pooled CFA as cfa.mi', async () => {
  const ex = example('lavaanmi-hs');
  exampleCheck(ex.id, { title: ex.title, method: 'CB-SEM', packages: ['lavaan', 'Amelia', 'lavaan.mi'], definition: ex });
  against({ label: 'desktop Amelia and lavaan.mi (the help page’s HS20imps and cfa.mi), scripts/validation/examples_mi.R', script: 'scripts/validation/examples_mi.R', level: 'native' });
  const data = exampleTestData(ex)!;
  const r = await estimateCbLavaan(data, toSpec(exampleModel(ex)), 'mi', 'ML', 'product', miOf('lavaanmi-hs'));
  expect(r.converged).toBe(true);
  expect(r.imputations).toBe(20);
  for (const [k, v] of Object.entries(ref.hs)) {
    const [lhs, op, rhs] = k.split(' ');
    if (op !== '=~' && op !== '~~') continue;
    const mine = r.estimates.find((e) => e.op === op && ((e.lhs === lhs && e.rhs === rhs) || (op === '~~' && e.lhs === rhs && e.rhs === lhs)));
    if (!mine && op === '=~' && v === 1) continue;  // (a marker loading)
    expect(mine, k).toBeTruthy();
    near(`pooled ${k}`, mine!.est, v, 1e-4 * Math.max(1, Math.abs(v)));
  }
  const script = await cbScriptLavaan(data, toSpec(exampleModel(ex)), 'mi', 'ML', 'product', miOf('lavaanmi-hs'));
  expect(script).toContain('set.seed(456)');
  expect(script).toContain('imp <- amelia(data, m = 20, noms = c("school"), p2s = 0)$imputations');
  expect(script).toContain('# Auxiliary variables of the imputation (not in the model): ageyr, agemo, school');
  expect(script).toContain('summary(fit_mi');
}, 900_000);

it('mice-nhanes: mice(nhanes, seed = 16117) and the regression of ?pool.r.squared: the pooled coefficients of its lm()', async () => {
  const ex = example('mice-nhanes');
  exampleCheck(ex.id, { title: ex.title, method: 'CB-SEM', packages: ['lavaan', 'mice'], definition: ex });
  against({ label: 'desktop mice (?pool.r.squared’s regression), scripts/validation/examples_mi.R', script: 'scripts/validation/examples_mi.R', level: 'native' });
  const raw = await rCall<{ names: string[]; cols: (number | null)[][] }>('ps_dataset', { package: 'mice', name: 'nhanes', na: [] }, 'mice' as RPackage);
  const data: Dataset = { names: raw.names, cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))) };
  expect(data.names).toEqual(['age', 'bmi', 'hyp', 'chl']);
  const r = await estimateCbLavaan(data, toSpec(exampleModel(ex)), 'mi', 'ML', 'product', miOf('mice-nhanes'));
  expect(r.imputations).toBe(5);
  for (const k of ['age', 'hyp', 'bmi']) {
    const mine = r.estimates.find((e) => e.op === '~' && e.lhs === 'chl' && e.rhs === k)!;
    near(`pooled chl ~ ${k}`, mine.est, ref.nhanes[k], 1e-4 * Math.max(1, Math.abs(ref.nhanes[k])));
  }
}, 900_000);
