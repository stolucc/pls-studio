// Monte Carlo card of cards/model.ts: Reinartz, Haenlein & Henseler (2009), four indicators. Run through the card's design in R (modelHarness.ts, which says why these
// are split over files, one heavy card per file) and compared with the paper. Slow: run with WEBR_TESTS=1 WEBR_SLOW=1.

import { afterAll, beforeAll } from 'vitest';
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
  'reinartz-power: PLS has more power, ML SEM the right estimates (Table 7)',
  async () => {
    const typical = await mcCardRun('reinartz-power', true);
    against({
      ...REINARTZ,
      label:
        'Reinartz et al. (2009), Table 7, 4 indicators, loadings .7: power for weak / medium / strong paths at N = 100, CB-SEM .18 / .51 / .96, PLS .44 / .85 / .99; weak paths at N = 250 .45 / .81; PLS strong paths about .40 (Table 5)',
    });
    near('ML weak at N = 100', power(typical, 'CB-ML', 'weak', 100), 0.18, 0.08);
    near('PLS weak at N = 100', power(typical, 'PLS', 'weak', 100), 0.44, 0.08);
    near('ML medium at N = 100', power(typical, 'CB-ML', 'medium', 100), 0.51, 0.1);
    near('PLS medium at N = 100', power(typical, 'PLS', 'medium', 100), 0.85, 0.08);
    near('ML weak at N = 250', power(typical, 'CB-ML', 'weak', 250), 0.45, 0.08);
    near('PLS weak at N = 250', power(typical, 'PLS', 'weak', 250), 0.81, 0.08);
    near('PLS X → E1 at N = 1,000', typical.row('PLS', 'path:X:E1', 1000).mean, 0.4, 0.02);
    near('ML X → E1 at N = 1,000', typical.row('CB-ML', 'path:X:E1', 1000).mean, 0.5, 0.01);
  },
  3_600_000,
);
