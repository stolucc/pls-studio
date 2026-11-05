// Mplus User's Guide, chapter 7: the latent class examples in webR against what their Mplus outputs
// print (see testkit.ts and mixturekit.ts). Run with npm run test:webr.

import { afterAll, beforeAll, expect, it } from 'vitest';
import { lcaSpec } from '../../analyses/items';
import { DEFAULT_SETTINGS } from '../../model/project';
import { lcaR } from '../../rengine/items';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { same } from '../../validation/record';
import { sameClasses } from './mixturekit';
import { evidence, example, load, MPLUS, sameFit, TOL } from './testkit';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

// 7.7 and 7.8: the smaller class is weakly determined (Mplus's SEs up to 3.9); Mplus stops at its
// convergence criterion with its logits up to 0.003 from the maximum, at the same log-likelihood (see the descriptions).
const LOOSE: Record<string, (p: { block: string }) => number> = {
  'ex7.7': (p) => (p.block === 'Latent Class 1' ? TOL : 0.003),
  'ex7.8': (p) => (p.block === 'Latent Class 1' ? TOL : 0.003),
};

it.each([['ex7.3'], ['ex7.4'], ['ex7.5'], ['ex7.6'], ['ex7.7'], ['ex7.8'], ['ex7.9'], ['ex7.10'], ['ex7.22']])('%s: the latent class card reproduces the Mplus output: fit and the class-specific estimates', async (key) => {
  const ex = example(key);
  const p = ex.panel as Extract<NonNullable<typeof ex.panel>, { kind: 'lca' }>;
  evidence(key, 'Items', [p.model === 'lpa' ? 'R' : 'poLCA']);
  expect(p.from).toBe(p.to);
  const r = await lcaR(load(key), p.items, [p.from], 10, DEFAULT_SETTINGS.seed, lcaSpec(p));
  const m = r.models[0];
  same('classes', m.k, p.from);
  const want = MPLUS[key];
  sameFit({ npar: m.npar, logl: m.llik, aic: m.aic, bic: m.bic }, want.fit);
  sameClasses(m, p.items, want.estimates, LOOSE[key] ?? (() => TOL));
}, 600_000);
