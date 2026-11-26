// Monte Carlo card of cards/model.ts: Franke & Sarstedt (2019), unequal loadings. Run through the card's design in R (modelHarness.ts, which says why these
// are split over files, one heavy card per file) and compared with the paper. Slow: run with WEBR_TESTS=1 WEBR_SLOW=1.

import { afterAll, beforeAll, expect } from 'vitest';
import { slowIt } from '../../rengine/webrSlow';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { against, near } from '../../validation/record';
import { mcCardRun } from './modelHarness';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const FRANKE_SARSTEDT = {
  level: 'published' as const,
  url: 'https://doi.org/10.1108/IntR-12-2017-0515',
};
// (the paper's share indicating discriminant validity is 1 − the card's failing share)
const dv = (run: Awaited<ReturnType<typeof mcCardRun>>, key: string, n: number) =>
  1 - run.row('CB-ML', `validity:${key}`, n).rejection!;

slowIt(
  'franke-sarstedt-unequal: PHI tests at the cutoffs and the heuristics against Tables I and II, unequal loadings',
  async () => {
    const unequal = await mcCardRun('franke-sarstedt-unequal', true);
    against({
      ...FRANKE_SARSTEDT,
      label:
        'Franke & Sarstedt (2019), Tables I and II, loadings .85 / .71, φ = .9, three items, N = 100 / 500: PHI1 .67 / 1, PHI.90 .03 / .05; FL1 (heuristic) .17 / .03, FL2 0 / 0; HTMT.90 .48 / .49',
    });
    near('PHI1 at N = 100 (.67)', dv(unequal, 'cicfa:X:Y', 100), 0.67, 0.05);
    for (const n of [100, 500])
      near(`PHI.90 at N = ${n}`, dv(unequal, 'cicfa90:X:Y', n), 0.04, 0.025);
    near('FL for X at N = 100 (.17)', dv(unequal, 'fl:X', 100), 0.17, 0.05);
    expect(dv(unequal, 'fl:Y', 500)).toBe(0);
    near('HTMT.90 heuristic at N = 500 (.49)', dv(unequal, 'htmt90:X:Y', 500), 0.49, 0.05);
  },
  3_600_000,
);
