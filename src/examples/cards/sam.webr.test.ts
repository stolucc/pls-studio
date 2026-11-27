// The Structural after measurement card (analyses/cbModel.tsx, R ps_cb_sam) on its example (packages.ts:
// lavaan-poldem-sam, Bollen's democracy model), run through the card as the app opens it and compared with the same
// estimates computed directly in desktop lavaan 0.7-3: sem() and sam(sam.method = "local" / "global") on the model,
// and lm() on lavPredict() scores of the measurement model alone (regression, Bartlett, and regression scores for the
// predictors with Bartlett scores for the outcome). Run with npm run test:webr.

import { afterAll, beforeAll, expect, it } from 'vitest';
import type { SamResult } from '../../rengine/cbExtras';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { against, near } from '../../validation/record';
import { open } from './modelHarness';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

type Method = keyof Omit<SamResult['paths'][number], 'from' | 'to'>;
// [from, to, method, est, se]: desktop lavaan, sem(), sam() and lm() on lavPredict() scores, as in the header.
const REF: [string, string, Method, number, number][] = [
  ['ind60', 'dem60', 'sem', 1.471, 0.392],
  ['ind60', 'dem65', 'sem', 0.6, 0.226],
  ['dem60', 'dem65', 'sem', 0.865, 0.075],
  ['ind60', 'dem60', 'local', 1.444, 0.393],
  ['ind60', 'dem65', 'local', 0.589, 0.238],
  ['dem60', 'dem65', 'local', 0.847, 0.078],
  ['ind60', 'dem60', 'global', 1.454, 0.389],
  ['ind60', 'dem65', 'global', 0.558, 0.225],
  ['dem60', 'dem65', 'global', 0.871, 0.076],
  ['ind60', 'dem60', 'regression', 1.5278583, 0.326976776],
  ['ind60', 'dem65', 'regression', 0.5785498, 0.03084277],
  ['dem60', 'dem65', 'regression', 0.8820873, 0.009686225],
  ['ind60', 'dem60', 'bartlett', 1.4176078, 0.36945522],
  ['ind60', 'dem65', 'bartlett', 0.7243066, 0.20188133],
  ['dem60', 'dem65', 'bartlett', 0.7622223, 0.05834159],
  ['ind60', 'dem60', 'skrondalLaake', 1.5261776, 0.3803698],
  ['ind60', 'dem65', 'skrondalLaake', 0.4471414, 0.14158104],
  ['dem60', 'dem65', 'skrondalLaake', 0.9790986, 0.04446377],
];

it('lavaan-poldem-sam: full SEM, local and global SAM, and three factor-score regressions', async () => {
  const { run } = await open('lavaan-poldem-sam', 'CB-SEM', ['lavaan']);
  const r = await run<SamResult>();
  expect(r.paths).toHaveLength(3);
  against({
    label:
      'desktop lavaan 0.7-3: sem(), sam(sam.method = "local" / "global"), lm() on lavPredict() scores',
    level: 'native',
  });
  for (const [from, to, method, est, se] of REF) {
    const p = r.paths.find((x) => x.from === from && x.to === to)!;
    const tol =
      method === 'regression' || method === 'bartlett' || method === 'skrondalLaake'
        ? 1e-6
        : 0.0005;
    near(`${from} → ${to}, ${method}`, p[method].est!, est, tol);
    near(`SE of ${from} → ${to}, ${method}`, p[method].se!, se, tol);
  }
}, 600_000);
