// Mplus User's Guide, chapter 10: two-level mixtures (TYPE = TWOLEVEL MIXTURE) on the mixture model card, in webR
// against what their Mplus outputs print (see mixturekit.ts): fit, every parameter and its MLR standard error at its
// level, the classes matched to Mplus's. The random starts run in two R sessions. Run with npm run test:webr.

import { afterAll, beforeAll, it } from 'vitest';
import { useCompute } from '../../rengine/compute';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { checkMixture } from './mixturekit';

beforeAll(async () => {
  useCompute.getState().set({ workers: 2 });
  await startTestRuntime();
});
afterAll(stopTestRuntime);

const TWO_LEVEL = [['ex10.2'], ['ex10.2alt'], ['ex10.3'], ['ex10.4'], ['ex10.11'], ['ex10.13']];

it.each(TWO_LEVEL)(
  '%s: the mixture model card reproduces the Mplus two-level mixture: fit, every estimate and MLR standard error',
  async (key) => {
    const t0 = Date.now();
    const w = await checkMixture(key);
    console.log(key, JSON.stringify(w), `${Math.round((Date.now() - t0) / 1000)} s`);
    // (MIXLOG=<file>: the largest differences, for the descriptions)
    if (process.env.MIXLOG)
      (await import('node:fs')).appendFileSync(
        process.env.MIXLOG,
        `${JSON.stringify({ key, ...w, s: Math.round((Date.now() - t0) / 1000) })}\n`,
      );
  },
  900_000,
);
