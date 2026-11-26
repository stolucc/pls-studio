// Monte Carlo cards of cards/model.ts: Aguirre-Urreta & Rönkkö (2018), PLSc intervals. Run through the card's design in R (modelHarness.ts, which says why
// these are split over files) and compared with the paper. Slow: run with WEBR_TESTS=1 WEBR_SLOW=1.

import { afterAll, beforeAll, expect } from 'vitest';
import { slowIt } from '../../rengine/webrSlow';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { against, near } from '../../validation/record';
import { mcCardRun } from './modelHarness';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

slowIt(
  'aguirre-ronkko cards: PLSc intervals near .95 with inadmissible draws dropped; PLS attenuated, its null path biased with correlated predictors',
  async () => {
    const source = {
      label:
        'Aguirre-Urreta & Rönkkö (2018), Figures C1, C4, C17–C20 (read off): γ1 strong, N = 50: PLSc percentile .99, normal ≈ .998, PLS normal .91; correlated: PLSc BCa ≈ .94–.96',
      level: 'recovery',
      url: 'https://doi.org/10.25300/MISQ/2018/13587',
    } as const;
    const g1 = 'path:K1:E1',
      g4 = 'path:K4:E1';
    const percentile = await mcCardRun('aguirre-ronkko-percentile', true, [50]);
    against(source);
    near('PLSc percentile γ1, N 50', percentile.row('PLSc', g1, 50).coverage!, 0.95, 0.03);
    near('thin PLSc bootstraps, N 50', percentile.row('PLSc', g1, 50).thinBoot!, 0.88, 0.05);
    near('PLS γ1 attenuated', percentile.row('PLS', g1, 50).mean, 0.405, 0.03);
    const inadmissible = (r: { improper: number; reps: number }) => r.improper / r.reps;
    near('inadmissible PLSc, N 50 (K4)', inadmissible(percentile.row('PLSc', g1, 50)), 0.89, 0.04);
    const normal = await mcCardRun('aguirre-ronkko-normal', true, [50]);
    against(source);
    near('PLSc normal γ1, N 50', normal.row('PLSc', g1, 50).coverage!, 0.92, 0.03);
    const correlated = await mcCardRun('aguirre-ronkko-correlated', true, [50]);
    against(source);
    near('PLSc BCa γ1, N 50', correlated.row('PLSc', g1, 50).coverage!, 0.9, 0.03);
    expect(correlated.row('PLS', g4, 50).mean, 'PLS null path biased upward').toBeGreaterThan(
      0.015,
    );
    near('inadmissible PLSc, N 50', inadmissible(correlated.row('PLSc', g1, 50)), 0.71, 0.04);
    expect(correlated.row('PLSc', g1, 50).failed, 'no replication lost to BCa').toBe(0);
    const bca = await mcCardRun('aguirre-ronkko-bca', true, [50]);
    against(source);
    near('PLSc BCa γ1, N 50 (below percentile)', bca.row('PLSc', g1, 50).coverage!, 0.85, 0.04);
    expect(bca.row('PLSc', g1, 50).failed, 'no replication lost to BCa').toBe(0);
  },
  14_400_000,
);
