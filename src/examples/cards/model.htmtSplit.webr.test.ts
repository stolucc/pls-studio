// Monte Carlo cards of cards/model.ts: Henseler, Ringle & Sarstedt (2015), one factor split in two. Each run through the card's design in R (modelHarness.ts, which says
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
  'henseler2015-split and -high: Fornell–Larcker and cross-loadings miss one factor split in two, HTMT finds it (Table 3)',
  async () => {
    const NS = [100, 250, 500, 1000];
    const PLS = 'PLS mode A, centroid';
    const split = await mcCardRun('henseler2015-split', true);
    against({
      ...HENSELER_2015,
      label:
        'Henseler, Ringle & Sarstedt (2015), Table 3, loadings .7, φ = 1 at N = 100 / 250 / 500 / 1,000: Fornell–Larcker 6.9 / 0.3 / 0 / 0% (either construct), cross-loadings 0%, HTMT.85 99.1 / 100%, HTMT.90 95.9 / 99.9 / 100 / 100%, HTMT inference 96.0 / 95.7 / 94.9 / 95.5%',
    });
    const fail = (run: typeof split, key: string, n: number) =>
      run.row(PLS, `validity:${key}`, n).rejection!;
    near(
      'split: Fornell–Larcker, N = 100 (6.9% either construct)',
      fail(split, 'fl:A', 100),
      0.05,
      0.03,
    );
    for (const n of NS) {
      expect(fail(split, 'xl:A', n), `split: cross-loadings at N = ${n}`).toBe(0);
      near(`split: HTMT inference at N = ${n}`, fail(split, 'htmtci:A:B', n), 0.955, 0.025);
      expect(fail(split, 'htmt:A:B', n), `split: HTMT.85 at N = ${n}`).toBeGreaterThan(0.98);
    }
    near('split: HTMT.90 at N = 100 (95.9%)', fail(split, 'htmt90:A:B', 100), 0.959, 0.025);
    expect(fail(split, 'fl:A', 1000)).toBe(0);
    near(
      'split: the composites correlate at their reliability',
      split.row(PLS, 'cov:A:B', 250).mean,
      0.742,
      0.01,
    );

    const high = await mcCardRun('henseler2015-high', true);
    against({
      ...HENSELER_2015,
      label:
        'Henseler, Ringle & Sarstedt (2015), Table 3, loadings .9, φ = 1 at N = 100 / 250 / 500 / 1,000: Fornell–Larcker 42.1 / 27.3 / 15.4 / 4.8% (either construct), cross-loadings 0%, HTMT.85 and HTMT.90 100%, HTMT inference 96.3 / 96.0 / 95.5 / 96.0%',
    });
    // (per construct; the paper flags the pair when either fails, a little more often)
    const fl = NS.map((n) => fail(high, 'fl:A', n));
    near('high: Fornell–Larcker, N = 100 (42.1% either construct)', fl[0], 0.3, 0.07);
    near('high: Fornell–Larcker, N = 1,000 (4.8% either construct)', fl[3], 0.03, 0.025);
    for (let k = 1; k < NS.length; k++)
      expect(fl[k], 'fewer flags as N grows').toBeLessThan(fl[k - 1]);
    for (const n of NS) {
      expect(fail(high, 'htmt90:A:B', n)).toBe(1);
      near(`high: HTMT inference at N = ${n}`, fail(high, 'htmtci:A:B', n), 0.958, 0.025);
    }
  },
  7_200_000,
);
