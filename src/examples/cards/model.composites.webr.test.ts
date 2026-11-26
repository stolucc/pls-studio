// Monte Carlo cards of cards/model.ts: Dijkstra & Henseler (2015), Hwang et al. (2010); the heavier composite cards are in model.sarstedt, model.hairMirror and model.cho. Run through the card's design in R (modelHarness.ts, which says why
// these are split over files) and compared with the paper. Slow: run with WEBR_TESTS=1 WEBR_SLOW=1.

import { afterAll, beforeAll, expect } from 'vitest';
import { slowIt } from '../../rengine/webrSlow';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { against, near } from '../../validation/record';
import { mcCardRun, pathMae } from './modelHarness';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

slowIt(
  'dijkstra-henseler-plsc: PLSc and ML SEM recover the paths PLS and sum scores bias (Tables 3 and 4)',
  async () => {
    const run = await mcCardRun('dijkstra-henseler-plsc');
    const bias = (e: string, key: string, n: number) => {
      const r = run.row(e, key, n);
      return r.mean - r.param.value;
    };
    against({
      label:
        'Dijkstra & Henseler (2015), Table 3, normal data, bias at N = 100 / 500: X2 → Y4 PLS −.274 / −.283, sum scores −.305 / −.303, PLSc .023 / .005, FIML .021 / .005; X1 → Y4 (0) PLS .157 / .162; Table 4: X1 → Y4 significant for sum scores 35.2% / 94.9%, FIML 4.6% / 5.1%; X1 → Y5 found by FIML 20.4% / 87.2%',
      level: 'published',
      url: 'https://doi.org/10.25300/MISQ/2015/39.2.02',
    });
    near('PLS bias X2 → Y4 at N = 100', bias('PLS factorial', 'path:X2:Y4', 100), -0.274, 0.02);
    near('PLS bias X2 → Y4 at N = 500', bias('PLS factorial', 'path:X2:Y4', 500), -0.283, 0.015);
    near('PLS bias X1 → Y4 at N = 500', bias('PLS factorial', 'path:X1:Y4', 500), 0.162, 0.015);
    near(
      'sum scores bias X2 → Y4 at N = 500',
      bias('Sum scores', 'path:X2:Y4', 500),
      -0.303,
      0.015,
    );
    for (const e of ['PLSc', 'CB-ML'])
      for (const key of ['path:X2:Y4', 'path:X2:Y5', 'path:X1:Y4', 'path:X1:Y5'])
        near(`${e} bias ${key} at N = 500`, bias(e, key, 500), 0, 0.02);
    near(
      'sum scores: X1 → Y4 significant at N = 100',
      run.row('Sum scores', 'path:X1:Y4', 100).rejection!,
      0.352,
      0.05,
    );
    near(
      'sum scores: X1 → Y4 significant at N = 500',
      run.row('Sum scores', 'path:X1:Y4', 500).rejection!,
      0.949,
      0.03,
    );
    for (const n of [100, 500])
      near(
        `ML: X1 → Y4 significant at N = ${n}`,
        run.row('CB-ML', 'path:X1:Y4', n).rejection!,
        0.05,
        0.025,
      );
    near(
      'ML: X1 → Y5 power at N = 100',
      run.row('CB-ML', 'path:X1:Y5', 100).rejection!,
      0.204,
      0.05,
    );
    near(
      'ML: X1 → Y5 power at N = 500',
      run.row('CB-ML', 'path:X1:Y5', 500).rejection!,
      0.872,
      0.04,
    );
    // (GLS fails to converge in a few per cent of samples at N = 100, Table 2: 2.3%)
    expect(run.row('CB-GLS', 'path:X1:Y4', 100).failed).toBeLessThan(60);
  },
  3_600_000,
);

slowIt(
  'hwang-gsca-misspecified: left-out cross-loadings bias ML SEM more than PLS and GSCA (Figure 4)',
  async () => {
    const run = await mcCardRun('hwang-gsca-misspecified');
    against({
      label:
        'Hwang et al. (2010), Figure 4, misspecified model: ML (CSA) overestimates the paths (about +9.5% on average), PLS and GSCA underestimate them slightly (about −5%); parameter MAD GSCA .13, PLS .14, CSA .18',
      level: 'published',
      url: 'https://doi.org/10.1509/jmkr.47.4.699',
    });
    for (const n of [100, 500]) {
      near(`ML E1 → E2 at N = ${n}`, run.row('CB-ML', 'path:E1:E2', n).mean, 0.66, 0.025);
      expect(run.row('CB-ML', 'path:E2:E3', n).mean).toBeGreaterThan(0.8);
      for (const e of ['PLS', 'GSCA']) {
        near(`${e} E1 → E2 at N = ${n}`, run.row(e, 'path:E1:E2', n).mean, 0.52, 0.02);
        near(`${e} E1 → E3 at N = ${n}`, run.row(e, 'path:E1:E3', n).mean, 0, 0.025);
        expect(pathMae(run, e, n), `${e} more accurate than ML`).toBeLessThan(
          pathMae(run, 'CB-ML', n),
        );
      }
    }
    expect(run.row('CB-ML', 'path:E1:E3', 500).rejection!).toBeGreaterThan(0.4);
  },
  3_600_000,
);
