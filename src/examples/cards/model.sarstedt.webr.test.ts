// Monte Carlo cards of cards/model.ts: Sarstedt et al. (2016), common factors and composites. Run through the card's design in R (modelHarness.ts, which says why
// these are split over files) and compared with the paper. Slow: run with WEBR_TESTS=1 WEBR_SLOW=1.

import { afterAll, beforeAll, expect } from 'vitest';
import { slowIt } from '../../rengine/webrSlow';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { against, near } from '../../validation/record';
import { mcCardRun, pathMae } from './modelHarness';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const SARSTEDT = {
  level: 'published' as const,
  url: 'https://doi.org/10.1016/j.jbusres.2016.06.007',
};

slowIt(
  'sarstedt cards: PLS biased on common factors at every N; PLSc and CB-SEM fail on composites at every N',
  async () => {
    const weak = await mcCardRun('sarstedt-factor-weak');
    against({
      ...SARSTEDT,
      label:
        'Sarstedt et al. (2016), Table 2, common factors (2 indicators; loadings .5): PLS’s MAE does not shrink with N (about .1 or more), PLSc’s and CB-SEM’s fall to about .01 to .02 at N = 10,000; at N = 100 PLS is the most accurate',
    });
    expect(pathMae(weak, 'PLS', 10000)).toBeGreaterThan(0.1);
    for (const e of ['PLSc', 'CB-ML']) {
      expect(pathMae(weak, e, 10000), e).toBeLessThan(0.04);
      expect(pathMae(weak, e, 100), e).toBeGreaterThan(pathMae(weak, 'PLS', 100));
    }
    // (Reinartz et al. 2009: about half the solutions improper in this cell at N = 100)
    expect(weak.row('CB-ML', 'path:Y1:Y2', 100).failed).toBeGreaterThan(60);

    const unequal = await mcCardRun('sarstedt-factor-unequal');
    against({
      ...SARSTEDT,
      label:
        'Sarstedt et al. (2016), Table 2, common factors (4 indicators; loadings .5/.9): MAE about .08 to .10 for all three at N = 100; at N = 10,000 PLS .04 to .06, PLSc and CB-SEM .01',
    });
    for (const e of ['PLS', 'PLSc', 'CB-ML'])
      near(`${e} at N = 100`, pathMae(unequal, e, 100), 0.08, 0.025);
    near('PLS at N = 10,000', pathMae(unequal, 'PLS', 10000), 0.04, 0.015);
    for (const e of ['PLSc', 'CB-ML'])
      near(`${e} at N = 10,000`, pathMae(unequal, e, 10000), 0.01, 0.005);

    const composites = [
      ['sarstedt-composite-equal', '4 indicators, equal weights'],
      ['sarstedt-composite-unequal', '2 indicators, unequal weights'],
    ];
    for (const [id, cell] of composites) {
      const run = await mcCardRun(id);
      against({
        ...SARSTEDT,
        label: `Sarstedt et al. (2016), Table 3, composites (${cell}): PLS’s MAE about .07 at N = 100 falling to .01 at 10,000; PLSc’s above 1 and CB-SEM’s about .5 or more at every N, CB-SEM converging in fewer than half the runs`,
      });
      near(`${id}: PLS at N = 100`, pathMae(run, 'PLS', 100), 0.065, 0.015);
      expect(pathMae(run, 'PLS', 10000), `${id}: PLS at N = 10,000`).toBeLessThan(0.012);
      for (const n of [100, 1000, 10000])
        expect(pathMae(run, 'PLSc', n), `${id}: PLSc at N = ${n}`).toBeGreaterThan(1);
      for (const n of [100, 1000])
        expect(pathMae(run, 'CB-ML', n), `${id}: CB-ML at N = ${n}`).toBeGreaterThan(0.5);
      for (const n of [250, 1000])
        expect(
          run.row('CB-ML', 'path:Y1:Y2', n).failed,
          `${id}: CB-ML failed at N = ${n}`,
        ).toBeGreaterThan(150);
    }
  },
  7_200_000,
);
