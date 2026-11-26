// Monte Carlo card of cards/model.ts: Kock & Hadaya (2018), at N = 400 only. The card bootstraps PLS and PLSc 500 times
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
  'kock-hadaya-sample-size at N = 400: PLS reaches power .80; PLS attenuates the weakest path, PLSc does not',
  async () => {
    const run = await mcCardRun('kock-hadaya-sample-size', true, [400]);
    const weakest = (e: string, n: number) => run.row(e, 'path:CL:LO', n);
    against({
      label:
        'Kock & Hadaya (2018), Table 4: for the weakest path .147 the inverse square root method gives N = 287 for power .80 (one-tailed 5%); with loadings .8 PLS attenuates the path (about .13), so power .80 needs more (here about 400)',
      level: 'recovery',
      url: 'https://doi.org/10.1111/isj.12131',
    });
    near('PLS power at N = 400', weakest('PLS', 400).rejection!, 0.79, 0.05);
    near('PLS estimate', weakest('PLS', 400).mean, 0.127, 0.012);
    near('PLSc estimate', weakest('PLSc', 400).mean, 0.147, 0.012);
  },
  3_600_000,
);
