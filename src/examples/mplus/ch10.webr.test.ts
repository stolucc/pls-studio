// Mplus User's Guide, chapter 10: the two-level latent class model of example 10.7 (glca on the LCA card) in webR
// against what its Mplus output prints (see testkit.ts). Mplus's classes are numbered arbitrarily: the card's classes
// of people are matched to Mplus's by their thresholds, its classes of clusters by their logits. Run with npm run test:webr.

import { afterAll, beforeAll, expect, it } from 'vitest';
import { lcaSpec } from '../../analyses/items';
import { DEFAULT_SETTINGS } from '../../model/project';
import { lcaR } from '../../rengine/items';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { near, same } from '../../validation/record';
import { evidence, example, load, MPLUS } from './testkit';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const logit = (p: number) => Math.log(p / (1 - p));
const perms = (n: number): number[][] => (n === 1 ? [[0]] : perms(n - 1).flatMap((p) => Array.from({ length: n }, (_, i) => [...p.slice(0, i), n - 1, ...p.slice(i)])));

it('ex10.7: the multilevel latent class model (glca) reproduces the Mplus output: fit, thresholds and the class logits at both levels', async () => {
  const key = 'ex10.7';
  const ex = example(key);
  const p = ex.panel as Extract<NonNullable<typeof ex.panel>, { kind: 'lca' }>;
  evidence(key, 'Items', ['glca']);
  const r = await lcaR(load(key), p.items, [p.from], 10, DEFAULT_SETTINGS.seed, lcaSpec(p));
  const m = r.models[0], want = MPLUS[key];
  same('classes', m.k, 4);
  same('clusters', r.clusters!, 200);
  // glca reaches a log-likelihood 0.006 above Mplus's (−98736.121 against −98736.127): Mplus stops at its convergence criterion.
  same('free parameters', m.npar, want.fit.npar!);
  near('log-likelihood', m.llik, want.fit.logl!, 0.01);
  near('AIC', m.aic, want.fit.aic!, 0.02);
  near('BIC', m.bic, want.fit.bic!, 0.02);
  // glca's maximum is 0.006 above Mplus's (Mplus stops at its convergence criterion): the thresholds within T, the
  // class logits (standard errors 0.08 to 0.41) within TB (the largest, cb#1's intercept, −0.416 against −0.395, SE 0.406).
  const T = 0.0025, TB = 0.025;
  const est = (block: string, lhs: string, op: string, rhs: string) => want.estimates.find((e) => e.block === block && e.lhs === lhs && e.op === op && e.rhs === rhs)!.est;
  // Thresholds of the card's class c: logit of the cumulative probabilities.
  const thr = (c: number) => m.probs.flatMap((q) => { let cum = 0; return q.byClass[c].slice(0, -1).map((v, j) => { cum += v; return { item: q.item, t: `t${j + 1}`, v: logit(cum) }; }); });
  const W = perms(4).reduce((best, pm) => {
    const d = pm.reduce((s, c, b) => s + thr(c).reduce((x, q) => x + Math.abs(q.v - est(`Latent Class Pattern 1 ${b + 1}`, q.item, '|', q.t)), 0), 0);
    return d < best.d ? { pm, d } : best;
  }, { pm: [] as number[], d: Infinity }).pm;
  W.forEach((c, b) => thr(c).forEach((q) => near(`${q.item}$${q.t.slice(1)}, class ${b + 1}`, q.v, est(`Latent Class Pattern 1 ${b + 1}`, q.item, '|', q.t), T)));
  // Class logits: within cluster class j, log(P(cw = k) / P(cw = 4)) = intercept_k (cluster class 5) + (cw#k ON cb#j).
  const g = m.clusters!.byCluster, dl = m.clusters!.shares;
  const lw = (j: number, k: number) => Math.log(g[j][W[k]] / g[j][W[3]]);
  const B = perms(5).reduce((best, pm) => {
    let d = 0;
    for (let k = 0; k < 3; k++) {
      d += Math.abs(lw(pm[4], k) - est('Within Level', `cw#${k + 1}`, '~1', ''));
      for (let j = 0; j < 4; j++) d += Math.abs(lw(pm[j], k) - lw(pm[4], k) - est('Between Level', `cw#${k + 1}`, '~', `cb#${j + 1}`));
    }
    return d < best.d ? { pm, d } : best;
  }, { pm: [] as number[], d: Infinity }).pm;
  for (let k = 0; k < 3; k++) {
    near(`cw#${k + 1} intercept`, lw(B[4], k), est('Within Level', `cw#${k + 1}`, '~1', ''), TB);
    for (let j = 0; j < 4; j++) near(`cw#${k + 1} ON cb#${j + 1}`, lw(B[j], k) - lw(B[4], k), est('Between Level', `cw#${k + 1}`, '~', `cb#${j + 1}`), TB);
  }
  for (let j = 0; j < 4; j++) near(`cb#${j + 1} intercept`, Math.log(dl[B[j]] / dl[B[4]]), est('Between Level', `cb#${j + 1}`, '~1', ''), TB);
  expect(r.warnings).toEqual([]);
}, 1_800_000);
