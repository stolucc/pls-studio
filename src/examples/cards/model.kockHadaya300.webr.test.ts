// Monte Carlo card of cards/model.ts: Kock & Hadaya (2018), at N = 300 only. The card bootstraps PLS and PLSc 500 times
// in each of 1,000 replications, too slow in one test, so each sample size the test checks has a file of its own (N = 200,
// which it does not check, is not run): a replication's seeds depend only on the card's seed, the sample size and the
// replication (rengine/mc.ts), so these draw exactly what the full design draws, and scripts/validation/evidence.mjs merges
// the files' checks of the example into one. modelHarness.ts says why these are split over files. Slow: run with
// WEBR_TESTS=1 WEBR_SLOW=1.

import { afterAll, beforeAll, expect } from 'vitest';
import { slowIt } from '../../rengine/webrSlow';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { against, near } from '../../validation/record';
import { mcCardRun } from './modelHarness';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

slowIt(
  'kock-hadaya-sample-size at N = 300: at the inverse square root rule’s 287 PLS power stays below .80',
  async () => {
    const run = await mcCardRun('kock-hadaya-sample-size', true, [300]);
    const weakest = (e: string, n: number) => run.row(e, 'path:CL:LO', n);
    against({
      label:
        'Kock & Hadaya (2018), Table 4: for the weakest path .147 the inverse square root method gives N = 287 for power .80 (one-tailed 5%); with loadings .8 PLS attenuates the path (about .13), so power .80 needs more (here about 400)',
      level: 'recovery',
      url: 'https://doi.org/10.1111/isj.12131',
    });
    near('PLS power at N = 300', weakest('PLS', 300).rejection!, 0.72, 0.05);
    expect(weakest('PLS', 300).rejection!, 'below .80 at the rule’s 287').toBeLessThan(0.8);
  },
  3_600_000,
);
