// Mplus User's Guide, chapters 7 and 8: the mixtures on the mixture model card, in webR against what their Mplus
// outputs print (see testkit.ts and mixturekit.ts): fit, every parameter and its MLR standard error, the classes
// matched to Mplus's (class labels are arbitrary). Run with npm run test:webr.

import { afterAll, beforeAll, it } from 'vitest';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { checkMixture, fitMixture } from './mixturekit';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

it.each([
  ['ex7.1'],
  ['ex7.2'],
  ['ex7.11'],
  ['ex7.12'],
  ['ex7.13'],
  ['ex7.14'],
  ['ex7.15'],
  ['ex7.17'],
  ['ex7.20'],
  ['ex7.21'],
  ['ex7.24'],
  ['ex7.26'],
])(
  '%s: the mixture model card reproduces the Mplus output: fit, every estimate and MLR standard error',
  async (key) => {
    if (process.env.MIXDEBUG) {
      const f = await fitMixture(key);
      console.log(
        key,
        JSON.stringify(f.perm),
        JSON.stringify(f.r2.params.filter((p) => p.lhs === 'f')),
      );
    }
    const w = await checkMixture(key);
    console.log(key, JSON.stringify(w));
  },
  900_000,
);
