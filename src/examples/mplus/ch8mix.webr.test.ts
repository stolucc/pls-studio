// Mplus User's Guide, chapter 8: the growth mixtures and latent transition / hidden Markov models on the mixture model
// card, in webR against what their Mplus outputs print (see mixturekit.ts): fit, every parameter and its MLR
// standard error, the classes matched to Mplus's. Run with npm run test:webr.

import { afterAll, beforeAll, it } from 'vitest';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { checkMixture } from './mixturekit';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

it.each([['ex8.6'], ['ex8.7'], ['ex8.8'], ['ex8.11'], ['ex8.12'], ['ex8.13part1'], ['ex8.13part2'], ['ex8.14'], ['ex8.15']])('%s: the mixture model card reproduces the Mplus output: fit, every estimate and MLR standard error', async (key) => {
  const t0 = Date.now();
  const w = await checkMixture(key);
  console.log(key, JSON.stringify(w), `${Math.round((Date.now() - t0) / 1000)} s`);
}, 1_800_000);
