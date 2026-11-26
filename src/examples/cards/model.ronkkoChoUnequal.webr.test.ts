// Monte Carlo card of cards/model.ts: Rönkkö & Cho (2022), unequal loadings. Run through the card's design in R (modelHarness.ts, which says why these
// are split over files, one heavy card per file) and compared with the paper. Slow: run with WEBR_TESTS=1 WEBR_SLOW=1.

import { afterAll, beforeAll, expect } from 'vitest';
import { slowIt } from '../../rengine/webrSlow';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { against, near } from '../../validation/record';
import { mcCardRun } from './modelHarness';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const RONKKO_CHO = { level: 'published' as const, url: 'https://doi.org/10.1177/1094428120968614' };
const ML = 'CB-ML';

slowIt(
  'ronkko-cho-unequal: HTMT is biased by unequal loadings, the CFA correlation is not (Tables 6 and 8)',
  async () => {
    const unequal = await mcCardRun('ronkko-cho-unequal', true);
    against({
      ...RONKKO_CHO,
      label:
        'Rönkkö & Cho (2022), Tables 6 and 8, loadings .9 / .6 / .3, φ = .9: r_DPR (HTMT) .989 and r_CFA .901 at N = 250; CI_CFA(1) .388 / .241 / .124 / .001 at N = 50 / 100 / 250 / 1,000',
    });
    const fail = (key: string, n: number) => unequal.row(ML, `validity:${key}`, n).rejection!;
    near(
      'unequal: HTMT at N = 250 (.989)',
      unequal.row(ML, 'validity:htmt:F1:F2', 250).mean,
      0.989,
      0.015,
    );
    near(
      'unequal: CFA correlation at N = 250 (.901)',
      unequal.row(ML, 'cov:F1:F2', 250).mean,
      0.901,
      0.01,
    );
    expect(fail('htmt90:F1:F2', 1000)).toBeGreaterThan(0.95);
    expect(fail('cicfa:F1:F2', 1000)).toBeLessThan(0.02);
  },
  3_600_000,
);
