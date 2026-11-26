// Monte Carlo card of cards/model.ts: Rönkkö & Cho (2022), nine items per factor, at N = 100 only. The card has 27
// indicators, too slow in one test, so each sample size has a file of its own: a replication's seeds depend only on the
// card's seed, the sample size and the replication (rengine/mc.ts), so these draw exactly what the full design draws, and
// scripts/validation/evidence.mjs merges the files' checks of the example into one. modelHarness.ts says why these are split
// over files. Slow: run with WEBR_TESTS=1 WEBR_SLOW=1.

import { afterAll, beforeAll, expect } from 'vitest';
import { slowIt } from '../../rengine/webrSlow';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { against } from '../../validation/record';
import { mcCardRun } from './modelHarness';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

slowIt(
  'ronkko-cho-nine-items at N = 100: the test against 1 flags no sample',
  async () => {
    const run = await mcCardRun('ronkko-cho-nine-items', true, [100]);
    against({
      level: 'published',
      url: 'https://doi.org/10.1177/1094428120968614',
      label:
        'Rönkkö & Cho (2022), Table 8, φ = .9, loadings .8: CI_CFA(1) .293 / .106 and χ²(1) .199 / .081 at N = 50 / 100, averaged over 3, 6 and 9 items (nine items: the most precise); AVE/SV_CFA .968 / .993',
    });
    const fail = (key: string, n: number) => run.row('CB-ML', `validity:${key}`, n).rejection!;
    expect(fail('cicfa:F1:F2', 100)).toBe(0);
  },
  3_600_000,
);
