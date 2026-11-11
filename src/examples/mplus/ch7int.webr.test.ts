// Mplus User's Guide, chapter 7: mixtures with continuous latent variables integrated numerically (ALGORITHM =
// INTEGRATION) on the mixture model card, in webR against what their Mplus outputs print (see mixturekit.ts): fit,
// every parameter and its MLR standard error, the classes matched to Mplus's. The random starts run in two R sessions
// (rengine/mixture.ts, mixturePhases). Run with npm run test:webr.

import { afterAll, beforeAll, it } from 'vitest';
import { useCompute } from '../../rengine/compute';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { checkMixture } from './mixturekit';

beforeAll(async () => {
  useCompute.getState().set({ workers: 2 });
  await startTestRuntime();
});
afterAll(stopTestRuntime);

it.each([['ex7.18'], ['ex7.19'], ['ex7.27'], ['ex7.29']])(
  '%s: the mixture model card (numerical integration) reproduces the Mplus output: fit, every estimate and MLR standard error',
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

it('ex7.16: Mplus’s printed solution is not a maximum: the card reaches a higher log-likelihood; the parameters that agree are compared', async () => {
  const { evidence, MPLUS } = await import('./testkit');
  const { fitMixture, findMixture } = await import('./mixturekit');
  const { near } = await import('../../validation/record');
  const { expect } = await import('vitest');
  evidence('ex7.16', 'Mixture model', ['R']);
  const { r, r2, parsed } = await fitMixture('ex7.16');
  const want = MPLUS['ex7.16'];
  // (Mplus stops at −2598.111 with the residual covariance at 0.000, SE 3.1, and u2's and u3's class-1 thresholds with
  // SEs of 6.4: the card's maximum is higher)
  expect(r.npar).toBe(want.fit.npar);
  expect(r.logLik).toBeGreaterThan(want.fit.logl! + 0.02);
  const names = parsed.classes.map((c) => c.name),
    id = [[1, 2]];
  for (const p of want.estimates) {
    if (p.op === '~~' || (p.block === 'Latent Class 1' && (p.lhs === 'u2' || p.lhs === 'u3')))
      continue;
    const e = findMixture(r2.params, p, names, id);
    if (!e)
      throw new Error(`${p.lhs} ${p.op} ${p.rhs} (${p.block}) is not among the card's parameters`);
    near(`${p.lhs} ${p.op} ${p.rhs} (${p.block})`, e.est, p.est, 0.025);
  }
}, 900_000);
