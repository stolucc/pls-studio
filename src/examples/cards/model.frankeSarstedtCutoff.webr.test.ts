// Monte Carlo card of cards/model.ts: Franke & Sarstedt (2019), equal loadings. Run through the card's design in R (modelHarness.ts, which says why these
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
  'franke-sarstedt-cutoff: PHI tests at the cutoffs and the heuristics against Tables I and II, equal loadings',
  async () => {
    const cutoff = await mcCardRun('franke-sarstedt-cutoff', true);
    against({
      ...FRANKE_SARSTEDT,
      label:
        'Franke & Sarstedt (2019), Tables I and II, loadings .71, φ = .85, three items, N = 100 / 500: PHI.85 .04 / .04, PHI.90 .13 / .45, PHI1 .73 / 1; HTMT.85 (heuristic) .46 / .47, HTMT.90 .74 / .94; FL1 .06 / 0',
    });
    for (const n of [100, 500])
      near(`PHI.85 at N = ${n} (.04)`, dv(cutoff, 'cicfa85:X:Y', n), 0.04, 0.025);
    near('PHI.90 at N = 100 (.13)', dv(cutoff, 'cicfa90:X:Y', 100), 0.13, 0.05);
    near('PHI.90 at N = 500 (.45)', dv(cutoff, 'cicfa90:X:Y', 500), 0.45, 0.06);
    near('PHI1 at N = 100 (.73)', dv(cutoff, 'cicfa:X:Y', 100), 0.73, 0.05);
    near('HTMT.85 heuristic at N = 100 (.46)', dv(cutoff, 'htmt:X:Y', 100), 0.46, 0.05);
    near('HTMT.90 heuristic at N = 500 (.94)', dv(cutoff, 'htmt90:X:Y', 500), 0.94, 0.03);
    expect(dv(cutoff, 'fl:X', 500)).toBe(0);
  },
  3_600_000,
);
