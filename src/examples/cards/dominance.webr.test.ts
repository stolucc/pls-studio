// The dominance analysis card (analyses/dominance.tsx, R ps_dominance) on its example (packages.ts: swiss-dominance),
// run as the app opens it, against domir 1.3.0 in desktop R, which fits lm() on every subset of the predictors, and
// relaimpo's LMG (scripts/validation/dominance.R → src/engine/__fixtures__/dominance/reference.json). The card's
// subset R² come from the correlation matrix instead. Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { completePairs } from '../../analyses/dominance';
import type { DominanceResult } from '../../rengine/dominance';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { against, near, same } from '../../validation/record';
import { open } from './modelHarness';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const REF = JSON.parse(
  readFileSync(
    join(__dirname, '..', '..', 'engine', '__fixtures__', 'dominance', 'reference.json'),
    'utf8',
  ),
) as {
  predictors: string[];
  r2: number;
  general: number[];
  lmg: number[];
  conditional: number[][];
  complete: (number | null)[][];
};

it('swiss-dominance: general, conditional and complete dominance as domir and relaimpo give them', async () => {
  const { run } = await open('swiss-dominance', 'Regression', ['stats']);
  const r = await run<DominanceResult>();
  against({
    label: 'scripts/validation/dominance.R: domir 1.3.0 (lm on every subset) and relaimpo 2.2.7 (LMG)',
    level: 'native',
  });
  same('predictors', r.predictors.join(' '), REF.predictors.join(' '));
  same('N', r.n, 47);
  near('R²', r.r2, REF.r2, 1e-10);
  r.predictors.forEach((p, i) => {
    near(`${p}: general dominance`, r.general[i], REF.general[i], 1e-10);
    near(`${p}: LMG`, r.general[i], REF.lmg[i], 1e-10);
    REF.conditional[i].forEach((x, m) =>
      near(`${p}: conditional dominance with ${m} others`, r.conditional[i][m], x, 1e-10),
    );
    REF.complete[i].forEach((x, j) => {
      if (x === null) expect(r.complete[i][j]).toBeNull();
      else near(`${p} over ${REF.predictors[j]}: share of subsets`, r.complete[i][j]!, x, 1e-12);
    });
  });
  near(
    'general dominance sums to R²',
    r.general.reduce((a, b) => a + b, 0),
    r.r2,
    1e-12,
  );
  same(
    'complete dominance',
    completePairs(r)
      .map(([a, b]) => `${a}>${b}`)
      .join(' '),
    'Education>Agriculture Education>Examination Education>Catholic Infant.Mortality>Agriculture',
  );
}, 600_000);
