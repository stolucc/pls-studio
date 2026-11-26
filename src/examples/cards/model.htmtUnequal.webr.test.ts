// Monte Carlo cards of cards/model.ts: Henseler, Ringle & Sarstedt (2015), unequal loadings and φ = .9. Each run through the card's design in R (modelHarness.ts, which says
// why these are split over files) and compared with the paper. Slow: run with WEBR_TESTS=1 WEBR_SLOW=1.

import { afterAll, beforeAll, expect } from 'vitest';
import { slowIt } from '../../rengine/webrSlow';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { against, near } from '../../validation/record';
import { mcCardRun } from './modelHarness';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const HENSELER_2015 = {
  level: 'published' as const,
  url: 'https://doi.org/10.1007/s11747-014-0403-8',
};

slowIt(
  'henseler2015-unequal and -close: unequal loadings push HTMT above 1; at φ = .9 the three HTMT checks disagree',
  async () => {
    const PLS = 'PLS mode A, centroid';
    const unequal = await mcCardRun('henseler2015-unequal', true);
    against({
      ...HENSELER_2015,
      label:
        'Henseler, Ringle & Sarstedt (2015), Table 3, loadings .5 / .7 / .9, φ = 1 at N = 100 / 250 / 500 / 1,000: Fornell–Larcker 64.6 / 59.5 / 53.9 / 42.1% (either construct), cross-loadings 0%, HTMT inference 98.2 / 99.4 / 99.8 / 100%',
    });
    const fail = (run: typeof unequal, key: string, n: number) =>
      run.row(PLS, `validity:${key}`, n).rejection!;
    near(
      'unequal: Fornell–Larcker, N = 100 (64.6% either construct)',
      fail(unequal, 'fl:A', 100),
      0.5,
      0.08,
    );
    near(
      'unequal: Fornell–Larcker, N = 1,000 (42.1% either construct)',
      fail(unequal, 'fl:A', 1000),
      0.32,
      0.08,
    );
    near(
      'unequal: HTMT inference, N = 100 (98.2%)',
      fail(unequal, 'htmtci:A:B', 100),
      0.982,
      0.015,
    );
    expect(fail(unequal, 'htmtci:A:B', 1000)).toBeGreaterThan(0.99);
    expect(fail(unequal, 'xl:A', 250)).toBe(0);
    // population HTMT without tau-equivalence: (mean λ)² / mean λiλj = .49 / .4767
    near(
      'unequal: HTMT',
      unequal.row(PLS, 'validity:htmt:A:B', 1000).mean,
      0.49 / ((0.35 + 0.45 + 0.63) / 3),
      0.01,
    );

    const close = await mcCardRun('henseler2015-close', true);
    against({
      ...HENSELER_2015,
      label:
        'Henseler, Ringle & Sarstedt (2015), Figure 5, loadings .7 read at φ = .9: Fornell–Larcker and cross-loadings never flag, HTMT.85 flags most samples, HTMT.90 about half, HTMT inference fewer as N grows',
    });
    near('close: HTMT', close.row(PLS, 'validity:htmt:A:B', 1000).mean, 0.9, 0.01);
    for (const n of [100, 1000]) {
      near(`close: HTMT.90 at N = ${n}, about half`, fail(close, 'htmt90:A:B', n), 0.5, 0.06);
      expect(fail(close, 'fl:A', n)).toBe(0);
    }
    expect(fail(close, 'htmt:A:B', 1000)).toBeGreaterThan(0.95);
    expect(fail(close, 'htmtci:A:B', 100)).toBeGreaterThan(0.4);
    expect(fail(close, 'htmtci:A:B', 1000)).toBeLessThan(0.02);
  },
  7_200_000,
);
