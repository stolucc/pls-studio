// The dynamic panel card (analyses/dpm.tsx, R ps_dpm) on its example (packages.ts: dpm-wages), run as the app opens
// it, against the dpm package's own example in desktop R, which replicates Allison, Williams & Moral-Benito (2017)
// (scripts/validation/dpm.R → src/engine/__fixtures__/dpm/reference.json). The card writes the lavaan model itself.
// Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, it } from 'vitest';
import type { DpmResult } from '../../rengine/dpm';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { against, near, same } from '../../validation/record';
import { open } from './modelHarness';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

type Est = { est: number; se: number };
const REF = JSON.parse(
  readFileSync(
    join(__dirname, '..', '..', 'engine', '__fixtures__', 'dpm', 'reference.json'),
    'utf8',
  ),
) as {
  dpm: string;
  n: number;
  wksLag: Est;
  unionLag: Est;
  lwageLag: Est;
  ed: Est;
  errorVariance: Est;
  alphaVariance: Est;
  fit: { chisq: number; df: number; cfi: number; rmsea: number };
};

it('dpm-wages: the effects, variances and fit of dpm’s own example (Allison et al. 2017)', async () => {
  const { run } = await open('dpm-wages', 'Longitudinal', ['lavaan']);
  const r = await run<DpmResult>();
  against({
    label: `scripts/validation/dpm.R: dpm ${REF.dpm} in desktop R`,
    level: 'native',
  });
  same('men', r.n, REF.n);
  same('waves', r.waves, 7);
  near('χ²', r.fit.chisq!, REF.fit.chisq, 1e-3);
  same('df', r.fit.df!, REF.fit.df);
  near('CFI', r.fit.cfi!, REF.fit.cfi, 1e-5);
  near('RMSEA', r.fit.rmsea!, REF.fit.rmsea, 1e-5);
  const want: [string, Est][] = [
    ['wks (previous wave)', REF.wksLag],
    ['union (previous wave)', REF.unionLag],
    ['lwage (previous wave)', REF.lwageLag],
    ['ed', REF.ed],
  ];
  want.forEach(([name, ref], k) => {
    same(`coefficient ${k + 1}`, r.coefficients[k].name, name);
    near(`${name}: estimate`, r.coefficients[k].est, ref.est, 1e-5);
    near(`${name}: SE (observed information)`, r.coefficients[k].se, ref.se, 1e-5);
  });
  near('error variance', r.errorVariance!.est, REF.errorVariance.est, 1e-4);
  near('variance of the fixed effect', r.alphaVariance.est, REF.alphaVariance.est, 1e-4);
}, 600_000);
