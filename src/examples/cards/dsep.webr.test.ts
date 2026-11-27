// The implied-independencies card (analyses/dsep.tsx: the basis set from model/dsep.ts, tests in R ps_dsep) on its
// example (packages.ts: bollen-union-dsep), run as the app opens it, against piecewiseSEM's dSep() on the same model
// written as regressions in desktop R (scripts/validation/dsep.R → src/engine/__fixtures__/dsep/reference.json).
// Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, it } from 'vitest';
import type { DsepResult } from '../../rengine/dsep';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { against, near, same } from '../../validation/record';
import { open } from './modelHarness';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const REF = JSON.parse(
  readFileSync(
    join(__dirname, '..', '..', 'engine', '__fixtures__', 'dsep', 'reference.json'),
    'utf8',
  ),
) as {
  n: number;
  claims: string[];
  t: number[];
  df: number[];
  p: number[];
  fisherC: number;
  fisherDf: number;
};

it('bollen-union-dsep: the basis set, each claim’s test and Fisher’s C as piecewiseSEM’s dSep gives them', async () => {
  const { run } = await open('bollen-union-dsep', 'CB-SEM', ['stats']);
  const r = await run<DsepResult>();
  against({
    label: 'scripts/validation/dsep.R: piecewiseSEM::dSep (lm per claim) in desktop R',
    level: 'native',
  });
  same('N', r.n, REF.n);
  same('claims', r.claims.length, REF.claims.length);
  r.claims.forEach((c, k) => {
    // dSep writes each claim as "y ~ x + given…" (the given in its own order)
    const [y, rhs] = REF.claims[k].split(' ~ ');
    const [x, ...given] = rhs.split(' + ');
    same(
      `claim ${k + 1}`,
      `${c.y} ~ ${c.x} | ${[...c.given].sort().join(', ')}`,
      `${y} ~ ${x} | ${given.sort().join(', ')}`,
    );
    near(`${c.y} ⫫ ${c.x}: t`, c.t, REF.t[k], 1e-6);
    same(`${c.y} ⫫ ${c.x}: df`, c.df, REF.df[k]);
    near(`${c.y} ⫫ ${c.x}: p`, c.p, REF.p[k], 1e-7);
  });
  near('Fisher’s C', r.fisherC, REF.fisherC, 1e-6);
  same('Fisher’s C: df', r.fisherDf, REF.fisherDf);
}, 600_000);
