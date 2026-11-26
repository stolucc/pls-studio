// Monte Carlo card of cards/model.ts: Reinartz, Haenlein & Henseler (2009), two weak indicators. Run through the card's design in R (modelHarness.ts, which says why these
// are split over files, one heavy card per file) and compared with the paper. Slow: run with WEBR_TESTS=1 WEBR_SLOW=1.

import { afterAll, beforeAll, expect } from 'vitest';
import { slowIt } from '../../rengine/webrSlow';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { against, near } from '../../validation/record';
import { mcCardRun } from './modelHarness';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const REINARTZ = {
  level: 'published' as const,
  url: 'https://doi.org/10.1016/j.ijresmar.2009.08.001',
};
const GROUPS = {
  weak: ['path:X:E2', 'path:X:E3', 'path:E4:E5'],
  medium: ['path:E2:E3'],
  strong: ['path:X:E1', 'path:E1:E2', 'path:E1:E3', 'path:E3:E4', 'path:E3:E5'],
};
/** The average power over a group of paths. */
const power = (
  run: Awaited<ReturnType<typeof mcCardRun>>,
  e: string,
  g: keyof typeof GROUPS,
  n: number,
) =>
  GROUPS[g].map((k) => run.row(e, k, n).rejection!).reduce((t, v) => t + v / GROUPS[g].length, 0);

slowIt(
  'reinartz-weak: ML fails with two weak indicators; PLS keeps its power (Tables 3, 4 and 7)',
  async () => {
    const weak = await mcCardRun('reinartz-weak', true);
    against({
      ...REINARTZ,
      label:
        'Reinartz et al. (2009), Tables 3, 4 and 7, 2 indicators, loadings .5: many improper CB-SEM solutions at N = 100 (about half), N = 500 needed for 97.5% proper; power at N = 500 / 1,000, CB-SEM weak .13 / .29, medium .31 / .67, strong .86 / .98; PLS weak .78 / .95',
    });
    const at100 = weak.row('CB-ML', 'path:X:E1', 100);
    expect((at100.failed + at100.improper) / at100.reps).toBeGreaterThan(0.4);
    for (const [n, w, m, st] of [
      [500, 0.13, 0.31, 0.86],
      [1000, 0.29, 0.67, 0.98],
    ]) {
      near(`ML weak at N = ${n}`, power(weak, 'CB-ML', 'weak', n), w, 0.07);
      near(`ML medium at N = ${n}`, power(weak, 'CB-ML', 'medium', n), m, 0.1);
      near(`ML strong at N = ${n}`, power(weak, 'CB-ML', 'strong', n), st, 0.06);
    }
    near('PLS weak at N = 500', power(weak, 'PLS', 'weak', 500), 0.78, 0.07);
    near('PLS X → E1 at N = 1,000', weak.row('PLS', 'path:X:E1', 1000).mean, 0.2, 0.02);
  },
  3_600_000,
);
