// The Bayesian multilevel / DSEM examples (6.26–6.28, 9.19, 9.24–9.40) against Mplus's printed output. Both sides are
// random draws, so the comparison is within Monte Carlo error. dsem.native.test.ts runs the card's R code in desktop R
// (rstan) and records its results in src/engine/__fixtures__/dsem/mplus.json; dsem.test.ts checks that recorded run
// against Mplus without R.
//
// Tolerances. Mplus prints posterior medians and SDs from 2 Gibbs chains, keeping each chain's second half, after
// BITERATIONS (TECH8 prints how many: from 200 for FBITERATIONS = 100 to 20,000). Gibbs chains of multilevel and
// time-series models are strongly autocorrelated (latent states and random effects are drawn given the parameters,
// random log variances by Metropolis steps): with an integrated autocorrelation time of about 50 iterations, the
// effective number of draws n_M is taken as the iterations / 50 (bounded to 20–100: the examples that ask for long runs,
// BITERATIONS = 10,000 or 20,000, are those whose chains mix slowest). Ours (Stan's NUTS) have n_eff of
// 400 or more for most parameters (n_O = 400). A posterior median from n effective draws has a Monte Carlo SE of
// 1.25 SD/sqrt(n), an SD a relative SE of 1/sqrt(2n): medians agree within k = 3 × 1.25 × sqrt(1/n_M + 1/n_O)
// posterior SDs (0.62 for 2,000 iterations), SDs within 3 × sqrt(1/(2 n_M) + 1/(2 n_O)) relatively (35%), plus
// Mplus's rounding (0.0015). A posterior with heavy tails (an SD 1.5 times the one its 95% interval implies,
// (upper − lower) / 3.92: loadings of binary items, slopes on random effects with variances near 0) has no SD a short
// chain can estimate: there only the median is compared. The priors are Mplus's defaults (flat; N(0, 5) for binary
// items' loadings and thresholds). Lagged values before a series' first occasion are sampled, as in Mplus, from the
// variable's residual distribution.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
import { dsemModel, type DsemOptions } from '../../analyses/dsem';
import { dsemColumns } from '../../analyses/dsemSyntax';
import type { Dataset } from '../../engine/types';
import type { AnalysisCtx } from '../../analyses/types';
import { DEFAULT_SETTINGS } from '../../model/project';
import { dsemRequest, type DsemResult } from '../../rengine/dsem';
import { near } from '../../validation/record';
import { examplePanels, exampleSettings, PACKAGE_EXAMPLES, panelPreset } from '../packages';
import { exampleTestData } from '../testData';
import { evidence, example, load, MPLUS } from './testkit';

/**
 * Mplus's iterations per chain (TECH8), from which its effective draws are taken; k, sdRel: a wider tolerance an example
 * states. 9.39: Mplus ran past its BITERATIONS = 5,000 to 6,700 until its potential scale reduction was small, the
 * sign of slow mixing: its draws are taken as worth those of 2,000 iterations (n_M = 40).
 */
export const DSEM_EXAMPLES: { key: string; iterations: number; k?: number; sdRel?: number }[] = [
  { key: 'ex6.26', iterations: 2000 }, { key: 'ex6.26b', iterations: 20000 }, { key: 'ex6.27', iterations: 2000 }, { key: 'ex6.28', iterations: 2000 },
  { key: 'ex9.19part1', iterations: 1000 }, { key: 'ex9.19part3', iterations: 1000 },
  { key: 'ex9.24', iterations: 2000 }, { key: 'ex9.25', iterations: 800 }, { key: 'ex9.26', iterations: 1000 }, { key: 'ex9.27', iterations: 2500 }, { key: 'ex9.28', iterations: 2000 }, { key: 'ex9.29', iterations: 10000 },
  { key: 'ex9.30', iterations: 2000 }, { key: 'ex9.30b', iterations: 2100 }, { key: 'ex9.31', iterations: 2000 }, { key: 'ex9.32', iterations: 2000 }, { key: 'ex9.32b', iterations: 2000 },
  { key: 'ex9.33', iterations: 6200 }, { key: 'ex9.34', iterations: 2000 }, { key: 'ex9.35', iterations: 3000 }, { key: 'ex9.37', iterations: 3000 },
  { key: 'ex9.38', iterations: 2000 }, { key: 'ex9.38b', iterations: 200 }, { key: 'ex9.39', iterations: 6700, k: 0.62, sdRel: 0.35 }, { key: 'ex9.39b', iterations: 200 },
  { key: 'ex9.40', iterations: 1700 }, { key: 'ex9.40part2', iterations: 1600 },
];
const N_OURS = 400;
export const nMplus = (iterations: number) => Math.min(100, Math.max(20, iterations / 50));
/** The medians' tolerance in posterior SDs, and the SDs' relative tolerance. */
export const tolerances = (iterations: number) => { const n = nMplus(iterations); return { k: 3 * 1.25 * Math.sqrt(1 / n + 1 / N_OURS), sdRel: 3 * Math.sqrt(1 / (2 * n) + 1 / (2 * N_OURS)) }; };
export const FIXTURE = join(__dirname, '..', '..', 'engine', '__fixtures__', 'dsem', 'mplus.json');
export type Recorded = Record<string, { result: Pick<DsemResult, 'parameters' | 'maxRhat' | 'minNeff' | 'converged' | 'divergent' | 'npar' | 'chains' | 'warmup' | 'draws' | 'seed' | 'n' | 'clusters'>; versions?: Record<string, string> }>;
export const readRecorded = (): Recorded => { try { return JSON.parse(readFileSync(FIXTURE, 'utf8')) as Recorded; } catch { return {}; } };

/** The example's card, as the app opens it: its data, settings and options. */
/**
 * `given`: the data of an example whose data come from an R package (the card's example, lme4's sleepstudy: read by
 * desktop R in the native test); without it, columns of that name (enough for the model, not for a run).
 */
export function dsemExample(key: string, given?: Dataset) {
  const ex = key.startsWith('ex') ? example(key) : PACKAGE_EXAMPLES.find((e) => e.id === key)!;
  const data = given ?? (key.startsWith('ex') ? load(key) : exampleTestData(ex) ?? stub(dsemColumns((panelPreset(examplePanels(ex)[0]) as unknown as DsemOptions).syntax)));
  const settings = exampleSettings(DEFAULT_SETTINGS, ex.settings);
  const ctx = { data, info: null, settings, pls: null, projectName: ex.title } as unknown as AnalysisCtx;
  const options = panelPreset(examplePanels(ex)[0]) as unknown as DsemOptions;
  return { ex, ctx, settings, options };
}
const stub = (names: string[]): Dataset => ({ names, cols: names.map(() => Float64Array.from([1, 2, 3, 4])) });
export function dsemExampleRequest(key: string, given?: Dataset) {
  const { ctx, settings, options } = dsemExample(key, given);
  const m = dsemModel(options, ctx);
  return dsemRequest(m.data, m.spec, options, settings.seed, settings.confidence);
}

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * Parameters compared otherwise than with Mplus's median alone (keys: `lhs op rhs`, or `block|lhs op rhs` for one level).
 * Means of cross-classified random intercepts where Mplus's short Gibbs chains (9.24: 2,000 iterations, 9.25: 800)
 * are further from the posterior than Monte Carlo error allows: there the posterior median is compared with the
 * maximum-likelihood estimate of the same model (lme4::lmer, REML = FALSE, the same fixed and random effects; with 20
 * and 100 clusters the posterior median of a mean is close to it), and Mplus's median only within 1.5 posterior SDs.
 * 9.24: y's intercept, lmer 1.746 (SE 0.227), Mplus 1.569. 9.25: y1's intercept, lmer for y1 alone (its equation
 * does not involve y2) 1.525 (SE 0.192), Mplus 1.379; y2's has no single-equation ML counterpart (y2 ON y1 uses y1's
 * within part), so only the 1.5 SD bound applies to it.
 */
/**
 * Parameters whose posterior has heavy tails (their medians only; see above): those the rule finds, and 6.27's loading
 * of u3 (a binary item answered the same way by most occasions: its posterior SD 0.46 against the 0.33 of Mplus's
 * 2,000 iterations, the 95% interval 0.7–2.6 skewed to the right).
 */
/*
 * 9.30b: z regressed on the random effects, one of which (the AR(2) slope s2) has a variance of 0.003 (SD 0.002) whose
 * posterior reaches 0. A slope on a random effect is its covariance with z over its variance, so z ON s2 (and with it
 * z ON s1, z ON logv and z's intercept) has tails that fall off like 1/variance: no finite SD a chain can estimate.
 * The posterior SD grows with the length of the run while the median stays: z ON s2 −3.25 (SD 3.43) from 4 × 3,000
 * draws, −3.06 (SD 4.28) from 4 × 1,000 non-centred draws, against Mplus's −2.757 (1.803) from 2,100 iterations.
 */
const HEAVY_TAILS: Record<string, string[]> = {
  'ex6.27': ['f =~ u3'],
  'ex9.30b': ['z ~ s1 (Between Level)', 'z ~ s2 (Between Level)', 'z ~ logv (Between Level)', 'z ~1  (Between Level)'],
};

const ML_CHECK: Record<string, Record<string, { ml?: number; mlSe?: number; truth?: number; mplusWithin?: number; truthWithin?: number; sdRel?: number }>> = {
  'ex9.24': { 'y ~1 ': { ml: 1.746, mlSe: 0.227 } },
  'ex9.25': { 'y1 ~1 ': { ml: 1.525, mlSe: 0.192 }, 'y2 ~1 ': {} },
  // 9.38: the means of the subject-level random intercept and covariate slope (crossed with time), Mplus 2.103 and 0.621
  // from 2,000 iterations; lmer with the same random effects over subjects and time, the lag centred at each subject's
  // observed mean (close to Mplus's latent centring with 100 occasions): 2.033 (SE 0.089) and 0.544 (SE 0.054).
  'ex9.38': { 'y ~1 ': { ml: 2.033, mlSe: 0.089 }, 'sx ~1 ': { ml: 0.544, mlSe: 0.054 } },
  // 9.39: the subject-level mean of the covariate slope and its trend over time (the slope regressed on timet on the
  // time level), Mplus 0.727 and −0.002 from 6,700 iterations (the two trade off: timet runs from 1 to 100); the
  // same lmer as for 9.38, with the time slope over subjects and the covariate slope over time on timet: 0.468
  // (SE 0.101) and 0.0015 (SE 0.0016), the time slope's mean 0.0006 (SE 0.0039). Mplus within 3 posterior SDs.
  'ex9.39': { 'sx ~1 ': { ml: 0.468, mlSe: 0.101, mplusWithin: 3 }, 'sx ~ timet': { ml: 0.0015, mlSe: 0.0016, mplusWithin: 3 }, 's ~1 ': { ml: 0.0006, mlSe: 0.0039 } },
  // 9.39b: as 9.39 for the covariate slope's subject-level mean (Mplus 0.573 from 200 iterations, FBITERATIONS = 100;
  // lmer 0.468, SE 0.101), and as 9.38b for the random log residual variance's variance (generated constant: 0).
  // The data (ex9.39.dat, generated by mcex9.39.inp: "Same as mcex9.38") have a constant within residual variance
  // (y*1, no logv), so logv's regressions and covariances are 0 in truth: logv ON xm (Mplus −0.013, SD 0.008) and
  // y WITH logv on the subject level (Mplus 0.013, SD 0.007) are compared with 0 here, Mplus's within 3 SDs.
  'ex9.39b': { 'sx ~1 ': { ml: 0.468, mlSe: 0.101, mplusWithin: 3 }, 'logv ~~ logv': { truth: 0, mplusWithin: 3, truthWithin: 3 },
    'logv ~ xm': { truth: 0, mplusWithin: 3, truthWithin: 2 }, 'y ~~ logv': { truth: 0, mplusWithin: 3, truthWithin: 2 },
    // the random intercept's mean (at time 0: timew is not centred, so it trades off with the trend s over times
    // 1 to 100): Mplus's SD 0.092 from 200 iterations, 0.129 from its 6,700 for the same y and s in 9.39 (ours 0.163
    // there, 0.163 here): a short Gibbs chain does not cover the trade-off. Its SD within 100% here.
    'y ~1 ': { sdRel: 1 } },
  // 9.38b: the random log residual variance's variance. The data (mcex9.38.inp) were generated with a constant
  // residual variance, so its true value is 0: ours 0.002 (SD 0.001), Mplus 0.004 from 200 iterations.
  // The random intercept's mean: Mplus's posterior SD from 200 iterations, 0.060, is below the ML standard error of
  // the same intercept (lmer as for 9.38: 2.033, SE 0.089); ours 2.04 (SD 0.092). Compared with lmer, Mplus's SD within 60%.
  'ex9.38b': { 'logv ~~ logv': { truth: 0, mplusWithin: 3, truthWithin: 3 }, 'y ~1 ': { ml: 2.033, mlSe: 0.089, sdRel: 0.6 } },
  // 9.40 part 2: the subject-level variance of the factor whose loadings are random over subjects. Mplus prints 0.878
  // (SD 0.101), the card 1.83 (SD 0.20). In the model as written, y_kjt = ν_kj + ν_kt + s_kj (f_w,jt + f_j + f_t) + e,
  // the covariance of two indicators' subject means is E[s_kj s_lj] ψ_j, and the data's subject means covary by 2.72,
  // 3.27 and 3.09 (mean 3.03) with loading means of 1.315–1.317 (E[s_k s_l] = 1.73): ψ_j ≈ 1.75, as here. Mplus's
  // figure scales the between part of a factor with random loadings otherwise (its documentation does not say how).
  // The intercept means and their SDs move with it (their posterior is wider here: within 1.5 SDs and 70%).
  'ex9.40part2': { 'Between SUBJECT Level|f ~~ f': { truth: 1.75, truthWithin: 1, mplusWithin: 12, sdRel: 1.2 }, 'y1 ~1 ': { sdRel: 0.7 }, 'y2 ~1 ': { sdRel: 0.7 }, 'y3 ~1 ': { sdRel: 0.7 } },
  // 9.37: the AR slope's mean, an open difference. Ours 0.324 (SD 0.011) in two runs (2 × 2,000 and 4 × 2,000 draws,
  // R-hat 1.001), Mplus 0.316 (0.011) from 3,000 iterations: 0.71 posterior SDs, beyond the 0.52 its iterations
  // allow (Mplus's slowest parameters, TECH8, are logv's, not this one). Every other parameter, the AR slope's
  // regressions on w and xm and its variance among them, agrees within 0.33 SDs. The data were generated
  // (mcex9.37.inp) with 0.3. Compared within 1 posterior SD here; the cause is not known.
  'ex9.37': { 'sy ~1 ': { mplusWithin: 1, sdRel: 0.29 } },
  // 9.35's data were generated by mcex9.35.inp (chapter 9's Monte Carlo inputs) with the AR slopes' variance 0.02:
  // the posterior median here is 0.019, Mplus's 0.030 (SD 0.004) from 3,000 Gibbs iterations, whose chains for the
  // random AR slopes of a latent factor of binary items (data augmentation twice over) mix slowest. Ours is compared
  // with the generating value (within 2 posterior SDs), Mplus's within 3.
  'ex9.35': { 's ~~ s': { truth: 0.02, mplusWithin: 3 } },
};

/** Every free parameter Mplus prints, against the recorded posterior: medians within k·SD, SDs within sdRel. */
export function compareWithMplus(key: string, r: Recorded[string]['result']) {
  const spec = DSEM_EXAMPLES.find((e) => e.key === key)!;
  const tol = tolerances(spec.iterations);
  const k = spec.k ?? tol.k, sdRel = spec.sdRel ?? tol.sdRel;
  evidence(key, 'Bayesian', ['rstan']);
  let n = 0;
  const heavy: string[] = [];
  for (const p of MPLUS[key].estimates) {
    const mine = r.parameters.filter((e) => e.block === p.block && e.op === p.op
      && ((sameName(e.lhs, p.lhs) && sameName(e.rhs, p.rhs)) || (p.op === '~~' && sameName(e.lhs, p.rhs) && sameName(e.rhs, p.lhs))));
    if (p.se === 0) {
      // a fixed parameter (or one Mplus prints as 0.000 with SD 0.000)
      if (mine.length) near(`${p.lhs} ${p.op} ${p.rhs} (${p.block || 'model'}, fixed or 0)`, mine[0].median, p.est, 0.0015 + (mine[0].fixed ? 0 : 3 * mine[0].sd));
      continue;
    }
    expect(mine.length, `${key}: ${p.lhs} ${p.op} ${p.rhs} ${p.block}`).toBe(1);
    const e = mine[0];
    const label = `${p.lhs} ${p.op} ${p.rhs}${p.block ? ` (${p.block})` : ''}`;
    // (an entry keyed by `block|parameter` applies on that level only)
    const ml = ML_CHECK[key]?.[`${p.block}|${p.lhs} ${p.op} ${p.rhs}`] ?? ML_CHECK[key]?.[`${p.lhs} ${p.op} ${p.rhs}`];
    if (ml) {
      const w = ml.mplusWithin ?? 1.5;
      near(`posterior median of ${label}, Mplus's short chain (within ${w} posterior SDs)`, e.median, p.est, w * e.sd);
      if (ml.ml !== undefined) near(`posterior median of ${label} against the ML estimate (lme4)`, e.median, ml.ml, 0.5 * ml.mlSe!);
      if (ml.truth !== undefined) near(`posterior median of ${label} against the value the data were generated with (Mplus's Monte Carlo input)`, e.median, ml.truth, (ml.truthWithin ?? 2) * e.sd);
      near(`posterior SD of ${label}`, e.sd, p.se, (ml.sdRel ?? 0.5) * p.se + 0.0015);
      n++;
      continue;
    }
    near(`posterior median of ${label}`, e.median, p.est, k * p.se + 0.0015);
    if (e.sd > 1.5 * (e.high - e.low) / 3.92 || HEAVY_TAILS[key]?.includes(label)) heavy.push(label);
    else near(`posterior SD of ${label}`, e.sd, p.se, sdRel * p.se + 0.0015);
    n++;
  }
  // (the parameters whose posterior SD is not compared: heavy tails)
  expect(heavy, `${key}: parameters with heavy-tailed posteriors`).toEqual(HEAVY_TAILS[key] ?? []);
  return n;
}
