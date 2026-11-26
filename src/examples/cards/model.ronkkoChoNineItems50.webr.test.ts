// Monte Carlo card of cards/model.ts: Rönkkö & Cho (2022), nine items per factor, at N = 50 only. The card has 27
// indicators, too slow in one test, so each sample size has a file of its own: a replication's seeds depend only on the
// card's seed, the sample size and the replication (rengine/mc.ts), so these draw exactly what the full design draws, and
// scripts/validation/evidence.mjs merges the files' checks of the example into one. modelHarness.ts says why these are split
// over files. Slow: run with WEBR_TESTS=1 WEBR_SLOW=1.

import { afterAll, beforeAll, expect } from 'vitest';
import { slowIt } from '../../rengine/webrSlow';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { against, near } from '../../validation/record';
import { mcCardRun } from './modelHarness';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

slowIt(
  'ronkko-cho-nine-items at N = 50: nine items make the tests against 1 precise; Fornell–Larcker still flags',
  async () => {
    const run = await mcCardRun('ronkko-cho-nine-items', true, [50]);
    against({
      level: 'published',
      url: 'https://doi.org/10.1177/1094428120968614',
      label:
        'Rönkkö & Cho (2022), Table 8, φ = .9, loadings .8: CI_CFA(1) .293 / .106 and χ²(1) .199 / .081 at N = 50 / 100, averaged over 3, 6 and 9 items (nine items: the most precise); AVE/SV_CFA .968 / .993',
    });
    const fail = (key: string, n: number) => run.row('CB-ML', `validity:${key}`, n).rejection!;
    expect(fail('cicfa:F1:F2', 50)).toBeLessThan(0.06);
    expect(fail('chi1:F1:F2', 50)).toBeLessThan(0.03);
    near('CI_CFA(.90) at N = 50', fail('cicfa90:F1:F2', 50), 0.985, 0.02);
    expect(fail('fl:F1', 50), 'Fornell–Larcker at N = 50').toBeGreaterThan(0.98);
    near('correlation at N = 50', run.row('CB-ML', 'cov:F1:F2', 50).mean, 0.9, 0.01);
  },
  3_600_000,
);
