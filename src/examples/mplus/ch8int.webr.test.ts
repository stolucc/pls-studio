// Mplus User's Guide, chapter 8: growth mixtures of censored, categorical and count outcomes with growth factor
// variance (ALGORITHM = INTEGRATION) on the mixture model card, in webR against what their Mplus outputs print (see
// mixturekit.ts). The random starts run in two R sessions. Run with npm run test:webr.

import { afterAll, beforeAll, it } from 'vitest';
import { useCompute } from '../../rengine/compute';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { checkMixture } from './mixturekit';

beforeAll(async () => { useCompute.getState().set({ workers: 2 }); await startTestRuntime(); });
afterAll(stopTestRuntime);

it.each([['ex8.3'], ['ex8.5part2']])('%s: the mixture model card (numerical integration) reproduces the Mplus output: fit, every estimate and MLR standard error', async (key) => {
  const t0 = Date.now();
  const w = await checkMixture(key);
  console.log(key, JSON.stringify(w), `${Math.round((Date.now() - t0) / 1000)} s`);
  // (MIXLOG=<file>: the largest differences, for the descriptions)
  if (process.env.MIXLOG) (await import('node:fs')).appendFileSync(process.env.MIXLOG, `${JSON.stringify({ key, ...w, s: Math.round((Date.now() - t0) / 1000) })}\n`);
}, 900_000);
