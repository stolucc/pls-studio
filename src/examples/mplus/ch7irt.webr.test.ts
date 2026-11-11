// Mplus User's Guide, example 7.27: the IRT card's mixture model (mirt) in webR against what the Mplus
// outputs print (see testkit.ts). Run with npm run test:webr.

import { afterAll, beforeAll, expect } from 'vitest';
import { slowIt } from '../../rengine/webrSlow';
import { irtFit } from '../../analyses/items';
import { DEFAULT_SETTINGS } from '../../model/project';
import { irtR } from '../../rengine/items';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { near, same } from '../../validation/record';
import { evidence, example, load, MPLUS } from './testkit';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const panel = (key: string) =>
  example(key).panel as Extract<NonNullable<ReturnType<typeof example>['panel']>, { kind: 'irt' }>;

// (slow: minutes in webR; run with WEBR_SLOW, as npm run validate:evidence does)
slowIt(
  'ex7.27: the mixture 2PL (mirt) reproduces the Mplus output: fit, loadings, thresholds, factor variances and the class logit',
  async () => {
    const key = 'ex7.27';
    evidence(key, 'Item response theory', ['mirt']);
    const p = panel(key);
    const r = await irtR(load(key), p.items, p.model, irtFit(p, DEFAULT_SETTINGS.seed));
    const want = MPLUS[key];
    same('free parameters', r.npar!, want.fit.npar!);
    near('log-likelihood', r.logLik, want.fit.logl!, 0.002);
    near('AIC', r.aic, want.fit.aic!, 0.004);
    near('BIC', r.bic, want.fit.bic!, 0.004);
    // The card's factor has variance 1 in each class; Mplus fixes u1's loading at 1 instead: its loadings are the
    // card's divided by u1's, its factor variance the square of u1's loading. Classes matched by u1's threshold.
    const k = (c: number, item: string, par: string) =>
      r.coefficients!.find((x) => x.class === c && x.item === item && x.parameter === par)!.est;
    const t1 = (b: number) =>
      want.estimates.find((e) => e.block === `Latent Class ${b}` && e.lhs === 'u1' && e.op === '|')!
        .est;
    const card = (b: number) =>
      Math.abs(k(1, 'u1', 'threshold 1') - t1(b)) < Math.abs(k(2, 'u1', 'threshold 1') - t1(b))
        ? 1
        : 2;
    for (const e of want.estimates.filter((x) => x.se > 0)) {
      if (e.block === 'Categorical Latent Variables') {
        near('c#1', Math.log(r.classes![card(1) - 1] / r.classes![card(2) - 1]), e.est, 0.001);
        continue;
      }
      const b = Number(e.block.slice(-1)),
        c = card(b),
        a1 = k(c, 'u1', 'loading');
      // (Mplus's loadings are ratios of two of the card's: within 0.0025)
      if (e.op === '=~')
        near(`${e.rhs} loading, class ${b}`, k(c, e.rhs, 'loading') / a1, e.est, 0.0025);
      else if (e.op === '|')
        near(`${e.lhs} threshold, class ${b}`, k(c, e.lhs, 'threshold 1'), e.est, 0.001);
      // (the factor variances, weakly determined (SEs 0.59 and 1.01), within 0.004)
      else if (e.op === '~~') near(`factor variance, class ${b}`, a1 * a1, e.est, 0.004);
      else throw new Error(`unexpected ${e.lhs} ${e.op} ${e.rhs}`);
    }
    expect(r.warnings).toEqual([]);
  },
  1_800_000,
);
