// Monte Carlo card of cards/model.ts: Goodhue et al. (2012), Study 4. Run through the card's design in R (modelHarness.ts, which says why these
// are split over files, one heavy card per file) and compared with the paper. Slow: run with WEBR_TESTS=1 WEBR_SLOW=1.

import { afterAll, beforeAll, expect } from 'vitest';
import { slowIt } from '../../rengine/webrSlow';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { against, near } from '../../validation/record';
import { mcCardRun } from './modelHarness';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

slowIt(
  'goodhue-complex: no advantage for PLS in a complex model; ML unbiased, the composites attenuated (Study 4)',
  async () => {
    const run = await mcCardRun('goodhue-complex', true);
    const truePaths = run.card.population.paths.filter((p) => p.value !== 0);
    const power = (e: string, n: number) =>
      truePaths
        .map((p) => run.row(e, `path:${p.from}:${p.to}`, n).rejection!)
        .reduce((t, v) => t + v / truePaths.length, 0);
    const relBias = (e: string, key: string, n: number) => {
      const r = run.row(e, key, n);
      return (r.mean - r.param.value) / r.param.value;
    };
    against({
      label:
        'Goodhue et al. (2012), Study 4: Ksi3 → Eta3 power at N = 40 PLS 59%, LISREL 53%; average power over the seven true paths at N = 40 regression 41.2%, PLS and LISREL 43.0%; Figure 6, relative bias of Ksi3 → Eta3 at N = 150 regression −.15, PLS −.12, LISREL 0',
      level: 'published',
      url: 'https://doi.org/10.2307/41703490',
    });
    near(
      'PLS Ksi3 → Eta3 power at N = 40',
      run.row('PLS', 'path:Ksi3:Eta3', 40).rejection!,
      0.59,
      0.07,
    );
    near(
      'ML Ksi3 → Eta3 power at N = 40',
      run.row('CB-ML', 'path:Ksi3:Eta3', 40).rejection!,
      0.53,
      0.08,
    );
    for (const [e, p] of [
      ['PLS', 0.43],
      ['Sum scores', 0.412],
      ['CB-ML', 0.43],
    ] as const)
      near(`${e} average power at N = 40`, power(e, 40), p, 0.06);
    near(
      'regression relative bias at N = 150',
      relBias('Sum scores', 'path:Ksi3:Eta3', 150),
      -0.15,
      0.03,
    );
    near('PLS relative bias at N = 150', relBias('PLS', 'path:Ksi3:Eta3', 150), -0.12, 0.03);
    near('ML relative bias at N = 150', relBias('CB-ML', 'path:Ksi3:Eta3', 150), 0, 0.02);
    // (lavaan converges in few samples of 20 for 21 indicators; LISREL failed in 99 of 500)
    expect(run.row('CB-ML', 'path:Ksi3:Eta3', 20).failed).toBeGreaterThan(99);
    for (const e of ['PLS', 'Sum scores', 'CB-ML'])
      expect(
        run.row(e, 'path:Ksi3:Eta4', 150).rejection!,
        `${e} false positives at N = 150`,
      ).toBeLessThan(0.1);
  },
  3_600_000,
);
