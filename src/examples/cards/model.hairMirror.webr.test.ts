// Monte Carlo cards of cards/model.ts: Hair et al., the mirror-image cards. Run through the card's design in R (modelHarness.ts, which says why
// these are split over files) and compared with the paper. Slow: run with WEBR_TESTS=1 WEBR_SLOW=1.

import { afterAll, beforeAll, expect } from 'vitest';
import { slowIt } from '../../rengine/webrSlow';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { against, near } from '../../validation/record';
import { mcCardRun, pathMae } from './modelHarness';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

slowIt(
  'hair-mirror cards: PLS and GSCA consistent on composites, sum scores only with equal weights (Figures 3 and 4)',
  async () => {
    const level = { level: 'published' as const, url: 'https://doi.org/10.1007/s11747-017-0517-x' };
    const unequal = await mcCardRun('hair-mirror-unequal');
    against({
      ...level,
      label:
        'Hair et al. (2017), Figure 4, unequal weights, 4 indicators: MAE of the paths at N = 100 / 10,000, PLS .077 / .007, GSCA .078 / .007, sum scores .089 / .053',
    });
    for (const e of ['PLS', 'GSCA']) {
      near(`${e} at N = 100`, pathMae(unequal, e, 100), 0.072, 0.012);
      near(`${e} at N = 10,000`, pathMae(unequal, e, 10000), 0.007, 0.003);
    }
    near('sum scores at N = 100', pathMae(unequal, 'Sum scores', 100), 0.088, 0.012);
    near('sum scores at N = 10,000', pathMae(unequal, 'Sum scores', 10000), 0.053, 0.006);

    const equal = await mcCardRun('hair-mirror-equal');
    against({
      ...level,
      label:
        'Hair et al. (2017), Figure 4, equal weights, 8 indicators: at N = 100 sum scores the most accurate (.066 against PLS .086, GSCA .093); all three .007 at N = 10,000',
    });
    expect(pathMae(equal, 'Sum scores', 100)).toBeLessThan(pathMae(equal, 'PLS', 100) - 0.01);
    expect(pathMae(equal, 'PLS', 100)).toBeLessThan(pathMae(equal, 'GSCA', 100) + 0.005);
    for (const e of ['PLS', 'GSCA', 'Sum scores'])
      near(`${e} at N = 10,000`, pathMae(equal, e, 10000), 0.007, 0.003);

    // Power for the weak (.15) paths at N = 100, with the card's bootstrap: GSCA the least
    const boot = await mcCardRun('hair-mirror-unequal', true, [100]);
    const low = (e: string) =>
      ['path:Y1:Y3', 'path:Y1:Y4', 'path:Y7:Y6']
        .map((k) => boot.row(e, k, 100).rejection!)
        .reduce((t, v) => t + v / 3, 0);
    against({
      ...level,
      label:
        'Hair et al. (2017), Table A2, unequal weights, 4 indicators, N = 100: power for the .15 paths PLS .70, sum scores .63, GSCA .41 (here: GSCA the least; the paper’s levels pool its non-normal data and its test is not stated)',
    });
    expect(low('GSCA')).toBeLessThan(low('PLS') - 0.08);
    expect(low('GSCA')).toBeLessThan(low('Sum scores') - 0.08);
  },
  14_400_000,
);
