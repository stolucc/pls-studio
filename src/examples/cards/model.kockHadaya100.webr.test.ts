// Monte Carlo card of cards/model.ts: Kock & Hadaya (2018), at N = 100 only. The card bootstraps PLS and PLSc 500 times
// in each of 1,000 replications, too slow in one test, so each sample size the test checks has a file of its own (N = 200,
// which it does not check, is not run): a replication's seeds depend only on the card's seed, the sample size and the
// replication (rengine/mc.ts), so these draw exactly what the full design draws, and scripts/validation/evidence.mjs merges
// the files' checks of the example into one. modelHarness.ts says why these are split over files. Slow: run with
// WEBR_TESTS=1 WEBR_SLOW=1.

import { afterAll, beforeAll } from 'vitest';
import { slowIt } from '../../rengine/webrSlow';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { against, near } from '../../validation/record';
import { mcCardRun } from './modelHarness';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

slowIt(
  'kock-hadaya-sample-size at N = 100: PLS power of the weakest path well below .80',
  async () => {
    const run = await mcCardRun('kock-hadaya-sample-size', true, [100]);
    const weakest = (e: string, n: number) => run.row(e, 'path:CL:LO', n);
    against({
      label:
        'Kock & Hadaya (2018), Table 4: for the weakest path .147 the inverse square root method gives N = 287 for power .80 (one-tailed 5%); with loadings .8 PLS attenuates the path (about .13), so power .80 needs more (here about 400)',
      level: 'recovery',
      url: 'https://doi.org/10.1111/isj.12131',
    });
    near('PLS power at N = 100', weakest('PLS', 100).rejection!, 0.37, 0.05);
  },
  3_600_000,
);
