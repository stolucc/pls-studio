// Shared by the Mplus mixture chapter tests (ch7, ch8): the latent class card's result in Mplus's
// parameterisation, with the card's classes matched to Mplus's (class labels are arbitrary).
//   thresholds (u$j, categorical items): logit P(u ≤ j | class)
//   nominal intercepts (u#j): log(P(j | class) / P(last | class))
//   class intercepts (c#m): log(share of class m / share of the last class)
//   growth (LCGA): Mplus fixes the intercept mean of its last class at 0, the card that of its smallest
//     class; the thresholds and intercepts are re-expressed relative to the class Mplus fixes.

import type { LcaModel } from '../../rengine/items';
import type { GmmModel } from '../../rengine/mixed';
import { near } from '../../validation/record';
import type { Mine, Printed } from './testkit';

const logit = (p: number) => Math.log(p / (1 - p));

/** The card's parameters of each Mplus class m, given perm[m] = the card's class. */
function mplusParams(m: LcaModel, items: string[], perm: number[]): Mine[][] {
  const ref = perm[perm.length - 1];
  return perm.map((c) => {
    const out: Mine[] = [];
    if (m.growth) {
      const g = m.growth, shift = g.intercepts[ref];
      out.push({ lhs: 'i', op: '~1', rhs: '', est: g.intercepts[c] - shift, se: null }, { lhs: 's', op: '~1', rhs: '', est: g.slopes[c], se: null });
      for (const it of items) g.thresholds.forEach((t, j) => out.push({ lhs: it, op: '|', rhs: `t${j + 1}`, est: t - shift, se: null }));
    } else if (m.means) {
      items.forEach((a, i) => {
        out.push({ lhs: a, op: '~1', rhs: '', est: m.means![c][i], se: null });
        items.forEach((b, j) => out.push({ lhs: a, op: '~~', rhs: b, est: m.cov![c][i][j], se: null }));
      });
    } else {
      for (const p of m.probs) {
        const pr = p.byClass[c];
        let cum = 0;
        pr.slice(0, -1).forEach((v, j) => {
          cum += v;
          out.push({ lhs: p.item, op: '|', rhs: `t${j + 1}`, est: logit(cum), se: null });
          out.push({ lhs: `${p.item}#${j + 1}`, op: '~1', rhs: '', est: Math.log(v / pr[pr.length - 1]), se: null });
        });
      }
    }
    return out;
  });
}

const perms = (k: number): number[][] => (k === 1 ? [[0]] : perms(k - 1).flatMap((p) => Array.from({ length: k }, (_, i) => [...p.slice(0, i), k - 1, ...p.slice(i)])));
const classOf = (block: string) => Number(/^Latent Class (\d+)$/.exec(block)?.[1] ?? 0);
const find = (mine: Mine[], p: Printed) => mine.find((e) => e.op === p.op && ((e.lhs === p.lhs && e.rhs === p.rhs) || (p.op === '~~' && e.lhs === p.rhs && e.rhs === p.lhs)));

/**
 * Every class-specific parameter and class intercept Mplus prints, against the card's, after matching
 * the classes (the permutation closest to Mplus's estimates). Fixed parameters (SE 0) are checked when
 * the card has them (the LCGA's loadings, which it does not list, are skipped). `tol(p)`: the tolerance
 * of one parameter (Mplus's three decimals by default). Returns the matching and the largest difference per block.
 */
export function sameClasses(m: LcaModel, items: string[], printed: Printed[], tol: (p: Printed) => number) {
  const k = m.shares.length;
  const own = printed.filter((p) => classOf(p.block) > 0 && p.op !== '=~');
  const cint = printed.filter((p) => p.block === 'Categorical Latent Variables');
  const score = (perm: number[]) => {
    const mine = mplusParams(m, items, perm);
    return own.reduce((s, p) => { const e = find(mine[classOf(p.block) - 1], p); return s + (e ? Math.abs(e.est - p.est) : 1e6); }, 0);
  };
  const perm = perms(k).reduce((a, b) => (score(b) < score(a) ? b : a));
  const mine = mplusParams(m, items, perm);
  const worst: Record<string, number> = {};
  const keep = (block: string, d: number) => { worst[block] = Math.max(worst[block] ?? 0, d); };
  for (const p of own) {
    const e = find(mine[classOf(p.block) - 1], p);
    if (!e) throw new Error(`${p.lhs} ${p.op} ${p.rhs} (${p.block}) is not among the card's parameters`);
    keep(p.block, Math.abs(e.est - p.est));
    near(`${p.lhs} ${p.op} ${p.rhs} (${p.block})${p.se === 0 ? ' (fixed)' : ''}`, e.est, p.est, tol(p));
  }
  for (const p of cint) {
    const c = Number(/^c#(\d+)$/.exec(p.lhs)?.[1]);
    if (p.op !== '~1' || !c) throw new Error(`Unexpected class parameter ${p.lhs} ${p.op} ${p.rhs}`);
    const got = Math.log(m.shares[perm[c - 1]] / m.shares[perm[k - 1]]);
    keep(p.block, Math.abs(got - p.est));
    near(`${p.lhs} (class intercept)`, got, p.est, tol(p));
  }
  return { perm, worst };
}

/** The growth mixture card's parameter of the card's class c (1-based), by Mplus's name (lhs op rhs). */
function gmmParam(m: GmmModel, c: number, p: Printed): number | undefined {
  const F: Record<string, string> = { i: 'intercept', s: 'slope', q: 'quadratic' };
  const get = (name: string) => m.params.find((x) => x.name === name)?.est;
  if (p.op === '~1' && F[p.lhs]) return get(`class ${c}: ${F[p.lhs]} mean`);
  if (p.op === '~' && F[p.lhs]) return get(`${F[p.lhs]} ~ ${p.rhs}`);
  if (p.op === '~~' && F[p.lhs] && p.lhs === p.rhs) return get(`variance: ${F[p.lhs]}`);
  if (p.op === '~~' && F[p.lhs] && F[p.rhs]) return get(`covariance: ${F[p.rhs]}, ${F[p.lhs]}`) ?? get(`covariance: ${F[p.lhs]}, ${F[p.rhs]}`);
  if (p.op === '~~' && p.lhs === p.rhs) return get(`residual variance: ${p.lhs}`);
  return undefined;
}
/** Membership logit of the card's class c against its last class (0 for the last), for a term ('intercept' or a covariate). */
const gmmLogit = (m: GmmModel, c: number, term: string) => (c === m.k ? 0 : m.params.find((x) => x.name === `membership: class ${c} vs ${m.k}: ${term}`)!.est);

/**
 * The growth mixture card against Mplus's MODEL RESULTS: class-specific and common estimates by class,
 * after matching the classes; the class regressions (c#m ON x, the intercepts c#m) re-expressed against
 * Mplus's last class. Fixed parameters (loadings, the occasions' intercepts at 0) are skipped.
 */
export function sameGmm(m: GmmModel, printed: Printed[], tol: number) {
  const k = m.k;
  const own = printed.filter((p) => classOf(p.block) > 0 && p.se !== 0);
  const value = (perm: number[], p: Printed) => gmmParam(m, perm[classOf(p.block) - 1] + 1, p);
  const score = (perm: number[]) => own.reduce((s, p) => { const v = value(perm, p); return s + (v === undefined ? 1e6 : Math.abs(v - p.est)); }, 0);
  const perm = perms(k).reduce((a, b) => (score(b) < score(a) ? b : a));
  for (const p of own) {
    const v = value(perm, p);
    if (v === undefined) throw new Error(`${p.lhs} ${p.op} ${p.rhs} (${p.block}) is not among the card's parameters`);
    near(`${p.lhs} ${p.op} ${p.rhs} (${p.block})`, v, p.est, tol);
  }
  for (const p of printed.filter((x) => x.block === 'Categorical Latent Variables')) {
    const c = Number(/^c#(\d+)$/.exec(p.lhs)?.[1]);
    const term = p.op === '~1' ? 'intercept' : p.rhs;
    near(`${p.lhs} ${p.op} ${p.rhs}`, gmmLogit(m, perm[c - 1] + 1, term) - gmmLogit(m, perm[k - 1] + 1, term), p.est, tol);
  }
  return perm;
}
