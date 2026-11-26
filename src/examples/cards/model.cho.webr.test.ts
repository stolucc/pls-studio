// Monte Carlo cards of cards/model.ts: Cho et al., factors and components. Run through the card's design in R (modelHarness.ts, which says why
// these are split over files) and compared with the paper. Slow: run with WEBR_TESTS=1 WEBR_SLOW=1.

import { afterAll, beforeAll, expect } from 'vitest';
import { slowIt } from '../../rengine/webrSlow';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { against, near, same } from '../../validation/record';
import { mcCardRun, pathMae } from './modelHarness';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

slowIt(
  'cho cards: ML SEM best on factors, PLS and GSCA on components, ML improper on components (Figures 2 and 3, Table 1)',
  async () => {
    const level = { level: 'published' as const, url: 'https://doi.org/10.1111/bmsp.12255' };
    const components = await mcCardRun('cho-components');
    against({
      ...level,
      label:
        'Cho, Sarstedt & Hwang (2022), Table S5, component population, simple model, 3 indicators: MAE of the paths at N = 100 / 200, GSCA .07 / .05, PLS mode A .08 / .05, MLF .26 / .25; Table 1: MLF has convergence problems (improper solutions) in most component samples with 3 indicators',
    });
    for (const e of ['PLS mode A', 'PLS mode B', 'GSCA']) {
      near(`${e} at N = 100`, pathMae(components, e, 100), 0.075, 0.015);
      near(`${e} at N = 200`, pathMae(components, e, 200), 0.05, 0.01);
      same(`${e} improper at N = 100`, components.row(e, 'path:E1:E3', 100).improper, 0);
    }
    for (const n of [100, 1000]) {
      expect(pathMae(components, 'CB-ML', n)).toBeGreaterThan(0.25);
      const r = components.row('CB-ML', 'path:E1:E3', n);
      expect((r.improper + r.failed) / r.reps, `ML problems at N = ${n}`).toBeGreaterThan(0.3);
    }

    const factors = await mcCardRun('cho-factors');
    against({
      ...level,
      label:
        'Cho, Sarstedt & Hwang (2022), Figure 3, factor population by N = 100 / 200 / 500 / 1,000: MAE of the paths MLF .095 / .065 / .04 / .03; GSCA and PLS .095 / .08 / .07 / .068',
    });
    near('ML at N = 1,000', pathMae(factors, 'CB-ML', 1000), 0.03, 0.008);
    near('ML at N = 200', pathMae(factors, 'CB-ML', 200), 0.068, 0.012);
    for (const e of ['PLS mode A', 'GSCA']) {
      near(`${e} at N = 1,000`, pathMae(factors, e, 1000), 0.066, 0.01);
      expect(pathMae(factors, e, 1000)).toBeGreaterThan(2 * pathMae(factors, 'CB-ML', 1000));
    }
  },
  7_200_000,
);
