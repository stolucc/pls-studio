// Mplus User's Guide, chapter 7: the latent class examples in webR against what their Mplus outputs
// print (see testkit.ts and mixturekit.ts). Run with npm run test:webr.

import { afterAll, beforeAll, expect, it } from 'vitest';
import { lcaSpec } from '../../analyses/items';
import { DEFAULT_SETTINGS } from '../../model/project';
import { lcaR } from '../../rengine/items';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { near, same } from '../../validation/record';
import type { CustomMlResult } from '../../rengine/customml';
import { sameClasses } from './mixturekit';
import { evidence, example, load, MPLUS, runCards, sameFit, TOL } from './testkit';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

// 7.7 and 7.8: the smaller class is weakly determined (Mplus's SEs up to 3.9); Mplus stops at its
// convergence criterion with its logits up to 0.0035 from the maximum, at the same log-likelihood (see the descriptions).
const LOOSE: Record<string, (p: { block: string }) => number> = {
  'ex7.7': (p) => (p.block === 'Latent Class 1' ? TOL : 0.0035),
  'ex7.8': (p) => (p.block === 'Latent Class 1' ? TOL : 0.0035),
};

it.each([
  ['ex7.3'],
  ['ex7.4'],
  ['ex7.5'],
  ['ex7.6'],
  ['ex7.7'],
  ['ex7.8'],
  ['ex7.9'],
  ['ex7.10'],
  ['ex7.22'],
])(
  '%s: the latent class card reproduces the Mplus output: fit and the class-specific estimates',
  async (key) => {
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
  },
  600_000,
);

it('ex7.28: the twin bivariate probit with known classes on two custom likelihood cards: Mplus’s estimates within its quadrature error, the class logit as printed', async () => {
  evidence('ex7.28', 'Custom likelihood', ['stats', 'pbivnorm']);
  const [probit, classes] = await runCards<CustomMlResult>('ex7.28');
  for (const r of [probit, classes]) {
    expect(r.converged).toBe(true);
    expect(r.warnings).toEqual([]);
    expect(r.se).toBe('robust');
  }
  const want = MPLUS['ex7.28'];
  same('free parameters', probit.fit.npar + classes.fit.npar, want.fit.npar!);
  const logl = probit.fit.logLik + classes.fit.logLik;
  // Mplus integrates the factors numerically (adaptive quadrature, 15 points per dimension): at its own estimates the
  // exact log-likelihood is −9927.527 against its printed −9927.558; the cards' maximum is the exact one.
  near('log-likelihood (exact; Mplus by quadrature)', logl, -9927.526, 0.001);
  near('log-likelihood against Mplus’s quadrature', logl, want.fit.logl!, 0.035);
  near('AIC', -2 * logl + 2 * 4, 19863.052, 0.002);
  // The class proportion does not involve the integration: as printed.
  const k = classes.parameters[0];
  near('cdz#1 (class logit)', k.est, 0.053, TOL);
  near('SE of cdz#1', k.se, 0.028, TOL);
  const par = (n: string) =>
    probit.parameters.find((x) => x.name === n) ?? probit.defined.find((x) => x.name === n)!;
  const nw = (want as unknown as { new: Record<string, { est: number; se: number }> }).new;
  // The likelihood is flat in c (SE 0.34): estimates within 0.005 of Mplus's, standard errors within 0.007.
  for (const n of ['a', 'c', 'h']) {
    near(n, par(n).est!, nw[n].est, 0.005);
    near(`SE of ${n}`, par(n).se!, nw[n].se, 0.007);
  }
  near('threshold', par('t').est!, 0.013, TOL);
  near('SE of the threshold', par('t').se!, 0.029, TOL);
  const thr = want.estimates.find((p) => p.op === '|')!;
  near('threshold (printed)', par('t').est!, thr.est, TOL);
  near('varf', par('varf').est!, 2.934, 0.01);
  near('covmz', par('covmz').est!, 2.933, 0.01);
  near('covdz', par('covdz').est!, 1.524, 0.004);
  near('varf (stated on the card)', par('varf').est!, 2.942, 0.001);
  near('covdz (stated on the card)', par('covdz').est!, 1.527, 0.001);
}, 600_000);
