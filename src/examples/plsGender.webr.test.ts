// The csem-gender example (?testMGD's model, csem() defaults, women and men of
// satisfaction_gender) as the app's groups card runs it: the deterministic parts of
// MICOM and of the multigroup analysis against cSEM run natively on the same
// model (scripts/validation/plsx.R, gender.json). Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Dataset } from '../engine/types';
import { DEFAULT_SETTINGS, toSpec } from '../model/project';
import { categoriesOf } from '../io';
import { rCall, type RPackage } from '../rengine/bridge';
import { groupsR } from '../rengine/plsx';
import { startTestRuntime, stopTestRuntime } from '../rengine/webrTestRuntime';
import { exampleModel, PACKAGE_EXAMPLES } from './packages';
import { against, example as exampleCheck } from '../validation/record';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const ref = JSON.parse(
  readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'plsx', 'gender.json'), 'utf8'),
) as {
  micomC: Record<string, number>;
  klesel: { dG: number; dL: number };
  chin: Record<string, number>;
  groups: Record<string, { SAT_VAL: number; LOY_SAT: number; VAL_QUAL: number }>;
};

it('csem-gender: MICOM c, Klesel’s dG and dL, Chin’s differences and the group paths equal cSEM on the example’s model', async () => {
  const ex = PACKAGE_EXAMPLES.find((e) => e.id === 'csem-gender')!;
  exampleCheck(ex.id, { title: ex.title, method: 'PLS-SEM', packages: ['cSEM'], definition: ex });
  against({
    label: 'desktop cSEM on the example’s model, scripts/validation/plsx.R',
    script: 'scripts/validation/plsx.R',
    level: 'native',
  });
  const raw = await rCall<{
    names: string[];
    cols: (number | null)[][];
    levels?: Record<string, string[]>;
  }>('ps_dataset', { package: 'cSEM', name: 'satisfaction_gender', na: [] }, 'cSEM' as RPackage);
  const data: Dataset = {
    names: raw.names,
    cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))),
    ...categoriesOf(raw.levels),
  };
  const st = { ...DEFAULT_SETTINGS, ...ex.settings };
  const options = {
    scheme: st.scheme,
    consistent: st.consistent,
    missing: st.missing,
    tolerance: 10 ** -st.stopExp,
    maxIter: st.maxIter,
  };
  const r = await groupsR(data, toSpec(exampleModel(ex)), options, {
    group: 'gender',
    approaches: ['Klesel', 'Chin'],
    samples: 30,
    seed: 1,
  });
  for (const [k, v] of Object.entries(ref.micomC))
    expect(r.micom.c[k], `MICOM c, ${k}`).toBeCloseTo(v, 6);
  const kl = r.mga.find((a) => a.approach === 'Klesel')!.overall!;
  expect(kl.dG.statistic).toBeCloseTo(Math.log(10) ** 2 * ref.klesel.dG, 5); // (natural logarithm; cSEM base 10)
  expect(kl.dL.statistic).toBeCloseTo(ref.klesel.dL, 5);
  const chin = r.mga.find((a) => a.approach === 'Chin')!.comparisons![0];
  for (const [k, v] of Object.entries(ref.chin)) {
    const [to, from] = k.split(' ~ ');
    expect(chin.paths.find((p) => p.from === from && p.to === to)!.statistic!, k).toBeCloseTo(v, 6);
  }
  for (const g of ['female', 'male']) {
    const path = (from: string, to: string) =>
      r.groups.find((x) => x.group === g)!.paths.find((p) => p.from === from && p.to === to)!.est;
    expect(path('VAL', 'SAT'), g).toBeCloseTo(ref.groups[g].SAT_VAL, 6);
    expect(path('SAT', 'LOY'), g).toBeCloseTo(ref.groups[g].LOY_SAT, 6);
    expect(path('QUAL', 'VAL'), g).toBeCloseTo(ref.groups[g].VAL_QUAL, 6);
  }
}, 1_800_000);
