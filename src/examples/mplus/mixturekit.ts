// Shared by the Mplus mixture chapter tests (ch7, ch8): the latent class card's result in Mplus's
// parameterisation, with the card's classes matched to Mplus's (class labels are arbitrary).
//   thresholds (u$j, categorical items): logit P(u ≤ j | class)
//   nominal intercepts (u#j): log(P(j | class) / P(last | class))
//   class intercepts (c#m): log(share of class m / share of the last class)
//   growth (LCGA): Mplus fixes the intercept mean of its last class at 0, the card that of its smallest
//     class; the thresholds and intercepts are re-expressed relative to the class Mplus fixes.

import type { LcaModel } from '../../rengine/items';
import type { GmmModel } from '../../rengine/mixed';
import type { MixtureParam } from '../../rengine/mixture';
import { expect } from 'vitest';
import { buildMixture } from '../../analyses/mixtureSyntax';
import { DEFAULT_SETTINGS } from '../../model/project';
import { mixtureR } from '../../rengine/mixture';
import { near, same } from '../../validation/record';
import { examplePanels } from '../packages';
import { evidence, example, load, MPLUS, sameFit, TOL, type Mine, type Printed } from './testkit';

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

// ---------------------------------------------------------------------------------------------------------------
// The mixture model card (analyses/mixture.tsx): its parameters carry the class of each latent class variable they
// belong to (`at`, 0 = all). Mplus prints them under "Latent Class 2" (one class variable), "Latent Class C1#2"
// (one of several), "Latent Class Pattern 1 2" (a joint class) or in the overall part / "Categorical Latent
// Variables" (all classes).


/** The classes a printed block stands for: per class variable its class (0: not given). */
export function blockClasses(block0: string, names: string[]): number[] {
  const out = names.map(() => 0);
  const block = block0.replace(/ \(\d+\)$/, '');  // (a known class: Latent Class 1 (0), with its value)
  const one = /^Latent Class (\d+)$/.exec(block);
  if (one) { const main = names.length === 1 ? 0 : -1; if (main < 0) throw new Error(`"${block}" with several latent class variables`); out[main] = Number(one[1]); return out; }
  const pat = /^Latent Class Pattern ([\d ]+)$/.exec(block);
  if (pat) { pat[1].trim().split(/\s+/).map(Number).forEach((k, i) => { out[i] = k; }); return out; }
  const named = /^Latent Class (\w+)#(\d+)$/.exec(block);
  if (named) { const i = names.indexOf(named[1].toLowerCase()); if (i < 0) throw new Error(`Unknown class variable in "${block}"`); out[i] = Number(named[2]); return out; }
  return out;
}

const isClassName = (s: string, names: string[]) => names.includes(s.split('#')[0]);
/** Rename a class category under a permutation (Mplus class j = the card's perm[j − 1]). */
const mapCat = (s: string, names: string[], perm: number[][]) => {
  const [v, k] = s.split('#'); const i = names.indexOf(v);
  return i < 0 || !k ? s : `${v}#${perm[i][Number(k) - 1]}`;
};

/** The card's row printed by Mplus as `p`, with Mplus's classes mapped to the card's by `perm`. */
export function findMixture(mine: MixtureParam[], p: Printed, names: string[], perm: number[][], renameClasses = false): MixtureParam | undefined {
  const cond = blockClasses(p.block, names).map((k, i) => (k ? perm[i][k - 1] : 0));
  const lhs = renameClasses ? mapCat(p.lhs, names, perm) : p.lhs, rhs = renameClasses ? mapCat(p.rhs, names, perm) : p.rhs;
  // (two-level: the level it is printed under, as a heading of its own or above the classes)
  const lv = /^(Within|Between) Level$/.exec(p.level ?? p.block)?.[1].toLowerCase();
  // (the most specific row: a class-specific parameter before the overall one it adds to)
  return mine.filter((e) => e.op === p.op && ((e.lhs === lhs && e.rhs === rhs) || (p.op === '~~' && e.lhs === rhs && e.rhs === lhs))
    && e.at.every((a, i) => a === 0 || a === cond[i]) && (!lv || !e.level || e.level === lv))
    .sort((a, b) => b.at.filter((x) => x > 0).length - a.at.filter((x) => x > 0).length)[0];
}

/**
 * The permutation of each latent class variable's classes that matches the card's solution to Mplus's (Mplus class j
 * = the card's class perm[v][j − 1]), from the class-specific parameters (and, with `probabilities`, the class
 * model's probabilities, which are the same in any order); known classes keep their order.
 */
export function matchClasses(mine: MixtureParam[], printed: Printed[], classes: { name: string; k: number; known: boolean }[], probabilities = false): number[][] {
  const names = classes.map((c) => c.name);
  // (the classes in the card's order first: a variable the printed parameters do not tell apart keeps it)
  const options = classes.map((c) => (c.known ? [Array.from({ length: c.k }, (_, i) => i + 1)] : perms(c.k).map((p) => p.map((x) => x + 1)).sort((a, b) => Number(b.every((x, i) => x === i + 1)) - Number(a.every((x, i) => x === i + 1)))));
  const rows = printed.filter((p) => (probabilities ? true : !isClassName(p.lhs, names)) && blockClasses(p.block, names).some((k) => k > 0) || (probabilities && isClassName(p.lhs, names) && p.op === '~'));
  let best: number[][] = options.map((o) => o[0]), bestScore = Infinity;
  const walk = (i: number, acc: number[][]) => {
    if (i === options.length) {
      // (per parameter, up to a common shift: a mean fixed at 0 in another reference class moves the others)
      const diffs = new Map<string, number[]>();
      let s = 0;
      for (const p of rows) {
        const e = findMixture(mine, p, names, acc, probabilities);
        if (!e) { s += isClassName(p.lhs, names) ? 0.5 : 1e3; continue; }
        const k = `${p.lhs} ${p.op} ${p.rhs}`;
        if (!diffs.has(k)) diffs.set(k, []);
        diffs.get(k)!.push(e.est - p.est);
      }
      for (const [k, d] of diffs) { const shift = isClassName(k.split(' ')[0], names) ? 0 : [...d].sort((a, b) => a - b)[Math.floor(d.length / 2)]; s += d.reduce((t, x) => t + Math.abs(x - shift), 0); }
      if (s < bestScore) { bestScore = s; best = acc.map((x) => [...x]); }
      return;
    }
    for (const o of options[i]) walk(i + 1, [...acc, o]);
  };
  walk(0, []);
  return best;
}

/**
 * Every parameter Mplus prints against the card's (classes already in Mplus's order): the estimate within `tol`, the
 * standard error (MLR) within `seTol` (unless `ses` is false). Returns the largest differences.
 */
export function sameMixture(mine: MixtureParam[], printed: Printed[], names: string[], tol: (p: Printed) => number, seTol: (p: Printed) => number | null, signFree?: (p: Printed) => boolean) {
  const id = names.map(() => Array.from({ length: 12 }, (_, i) => i + 1));
  let worst = 0, worstSe = 0;
  for (const p of printed) {
    const e = findMixture(mine, p, names, id);
    const label = `${p.lhs} ${p.op} ${p.rhs}${p.block ? ` (${p.block})` : ''}`;
    // (a parameter fixed at 0 that the card does not list, e.g. a random slope's variance: nothing to compare)
    if (!e && p.se === 0 && p.est === 0) continue;
    if (!e) throw new Error(`${label} is not among the card's parameters`);
    // (a coefficient on a factor whose sign is not identified: its magnitude)
    const est = signFree?.(p) ? Math.sign(p.est) * Math.abs(e.est) : e.est;
    if (process.env.MIXDEBUG && Math.abs(est - p.est) > 0.001) console.log('EST', label, est, p.est);
    worst = Math.max(worst, Math.abs(est - p.est));
    near(`${label}${p.se === 0 ? ' (fixed)' : ''}`, est, p.est, tol(p));
    const st = seTol(p);
    if (process.env.MIXDEBUG && p.se > 0 && Math.abs((e.se ?? NaN) - p.se) > 0.001) console.log('SE', label, e.est, p.est, e.se, p.se);
    if (p.se > 0 && st !== null) { worstSe = Math.max(worstSe, Math.abs((e.se ?? NaN) - p.se)); near(`SE of ${label}`, e.se ?? NaN, p.se, st); }
  }
  return { worst, worstSe };
}

/** Per example: tolerances of estimates and standard errors where Mplus's convergence or its MLR differ (see the descriptions). */
export const MIX_TOL: Record<string, { signFree?: (p: Printed) => boolean; est?: number; se?: number; noSe?: (p: Printed) => boolean; logl?: number; skip?: (p: Printed) => boolean; estOf?: (p: Printed) => number | undefined; seOf?: (p: Printed) => number | undefined }> = {
  // (Mplus stops at its convergence criterion where the likelihood is flat: see the description)
  'ex8.13part1': { est: 0.002, se: 0.003 },
  // (a transition probability at 0: the information there depends on the side it is taken from; the SEs of that row
  // are not compared, the others agree within 0.002: see the description)
  'ex8.15': { se: 0.002, noSe: (p) => p.rhs === 'c1#3' && p.block === 'Latent Class C#1' },
  // Numerical integration (see the descriptions): Mplus stops on a flat ridge of loadings and factor variance (7.19);
  // its standard errors where the likelihood is flattest (7.27); its integration's log-likelihood (8.3, 10.2: the
  // integral at the same estimates, which finer rules and the closed form confirm); diverging class logits (8.5 part 2).
  'ex7.18': { signFree: (p) => p.rhs === 'f' },
  'ex7.19': { est: 0.0025 },
  'ex7.27': { est: 0.002, seOf: (p) => (p.op === '~~' && p.lhs === 'f' ? 0.02 : 0.004) },
  'ex8.3': { logl: 0.012, est: 0.0015, se: 0.003 },
  'ex8.5part2': { skip: (p) => p.lhs === 'c#1' || (p.op === '~~' && p.se === 0), est: 0.002 },
  // (two-level: Mplus's estimates maximise its own integration's log-likelihood, which differs from the integral by up
  // to 0.014 here; the closed form confirms the card's for 10.2: see the descriptions)
  'ex10.2': { logl: 0.014, se: 0.0015 }, 'ex10.2alt': { logl: 0.014, est: 0.0025, se: 0.0015 }, 'ex10.3': { logl: 0.015, est: 0.017, se: 0.017 },
  'ex10.4': { logl: 0.003, est: 0.05, se: 0.05 }, 'ex10.13': { est: 0.005, se: 0.008 },
};

export async function fitMixture(key: string) {
  const ex = example(key);
  // (the example's mixture card: its panel, or one of morePanels when it opens another card first)
  const p = examplePanels(ex).find((x) => x.kind === 'mixture') as Extract<NonNullable<typeof ex.panel>, { kind: 'mixture' }>;
  const data = load(key);
  const parsed = buildMixture(p.syntax, data, { seed: DEFAULT_SETTINGS.seed, starts: p.starts });
  const r = await mixtureR(data, parsed.spec);
  const want = MPLUS[key];
  const perm = matchClasses(r.params, want.estimates, parsed.classes, parsed.parameterization === 'probability');
  const identity = perm.every((q) => q.every((x, i) => x === i + 1));
  // In Mplus's class order: refit from the maximum with the classes relabelled (the same likelihood).
  const r2 = identity ? r : await mixtureR(data, { ...parsed.spec, order: perm, given: r.theta, starts: 1, final: 1 });
  return { r, r2, parsed, perm, want };
}

export async function checkMixture(key: string) {
  evidence(key, 'Mixture model', ['R']);
  const { r, r2, parsed, want } = await fitMixture(key);
  expect(r.converged).toBe(true);
  const t = MIX_TOL[key] ?? {};
  // (a stated difference in the log-likelihood: Mplus's integration; AIC and BIC move with it)
  if (t.logl !== undefined) {
    same('free parameters', r.npar, want.fit.npar!);
    for (const [k, label] of [['logl', 'log-likelihood'], ['aic', 'AIC'], ['bic', 'BIC']] as const) near(label, k === 'logl' ? r.logLik : k === 'aic' ? r.aic : r.bic, want.fit[k]!, (k === 'logl' ? 1 : 2) * t.logl);
  } else sameFit({ npar: r.npar, logl: r.logLik, aic: r.aic, bic: r.bic }, want.fit);
  near2(r2.logLik, r.logLik);
  const news = (MPLUS[key] as { new?: Record<string, { est: number; se: number }> }).new ?? {};
  const printed = want.estimates.filter((p) => !t.skip?.(p) && !(p.lhs in news));
  // (MODEL CONSTRAINT's NEW parameters)
  for (const [n, v] of Object.entries(news)) {
    const e = r2.params.find((x) => x.op === 'new' && x.lhs === n);
    if (!e) throw new Error(`NEW parameter ${n} is not among the card's parameters`);
    near(`${n} (NEW)`, e.est, v.est, t.est ?? TOL); near(`SE of ${n} (NEW)`, e.se ?? NaN, v.se, t.se ?? TOL);
  }
  return sameMixture(r2.params, printed, parsed.classes.map((c) => c.name), (p) => t.estOf?.(p) ?? t.est ?? TOL, (p) => (t.noSe?.(p) ? null : t.seOf?.(p) ?? t.se ?? TOL), t.signFree);
}
const near2 = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-4);

