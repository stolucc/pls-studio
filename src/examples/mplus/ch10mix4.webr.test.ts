// Mplus User's Guide, example 10.4: the two-level mixture of ch10mix.webr.test.ts that takes about half an hour in
// webR, in a file of its own so that it runs beside the others and a timeout here costs no other example its record.
// Slow: run with WEBR_TESTS=1 WEBR_SLOW=1.

import { afterAll, beforeAll } from 'vitest';
import { useCompute } from '../../rengine/compute';
import { slowIt } from '../../rengine/webrSlow';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { checkMixture } from './mixturekit';

beforeAll(async () => {
  useCompute.getState().set({ workers: 2 });
  await startTestRuntime();
});
afterAll(stopTestRuntime);

slowIt(
  'ex10.4: the mixture model card reproduces the Mplus two-level mixture: fit, every estimate and MLR standard error',
  async () => {
    const t0 = Date.now();
    const w = await checkMixture('ex10.4');
    console.log('ex10.4', JSON.stringify(w), `${Math.round((Date.now() - t0) / 1000)} s`);
  },
  3_600_000,
);
