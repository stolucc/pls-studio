// The Bayesian SEM examples (3.18, 5.31, 5.32, 5.33, 11.7) against Mplus's printed output. Both sides are random
// draws, so the comparison is within Monte Carlo error. bsem.native.test.ts runs the card's R code in desktop R
// (blavaan, Stan) and records its results in src/engine/__fixtures__/blavaan/mplus.json; bsem.test.ts checks
// that recorded run against Mplus without R.
//
// Tolerances. Mplus prints posterior medians and SDs from 2 chains, keeping each chain's second half, and stops when
// the potential scale reduction is below 1.05 (TECH8: 1,700 iterations for 5.33, 2,900 for 11.7; 5.31 and 5.32
// print no TECH8, so their runs are the stopping rule's, a few hundred iterations) or, for 3.18, after
// BITERATIONS = 30,000. Its Gibbs chains for factor models are autocorrelated: the effective number of draws n_M
// is taken as 40 for 5.31 and 5.32, 100 for 5.33 and 11.7 and 3,000 for 3.18 (a regression, 30,000 draws). Ours
// have n_eff of 400 or more (n_O = 400; less only for 5.31's heavy-tailed loadings, below). A posterior median from n effective draws has a Monte Carlo SE of
// 1.25 SD/sqrt(n) and an SD a relative SE of 1/sqrt(2n): medians agree within three combined SEs,
// k = 3 x 1.25 x sqrt(1/n_M + 1/n_O) SDs, and SDs within 3 x sqrt(1/(2 n_M) + 1/(2 n_O)), relatively.
// Under flat priors a marker-identified factor whose variance can come near 0 has loadings with tails like
// |lambda|^-3 (along the ridge lambda^2 psi = constant): their posterior SD is not finite, and a run's SD depends on
// how far its chain wandered (5.31's f2: ours 7 to 20, Mplus's 0.30 to 0.57). Where our SD exceeds 1.5 times the
// SD implied by the 95% interval ((upper - lower)/3.92), only the median is compared (HEAVY_TAILS).
// The priors are Mplus's (ps_bsem): exactly for regression slopes, intercepts, loadings, variances and pairs of
// covariances; blavaan's LKJ correlation for three or more factors is close to Mplus's inverse Wishart. 5.33's
// approximate invariance is not Mplus's prior: Mplus's DIFF prior treats the groups alike (every pairwise
// difference with variance 0.01), blavaan's wiggle centres groups 2..10 on group 1 (SD sqrt(0.005): differences
// among groups 2..10 with variance 0.01, from group 1 0.005). With that prior the medians agree within 0.75 SD
// (the largest differences in f1's loadings of groups 4 and 6) and the SDs within 50% (wider here for groups
// 2..10's loadings, which are tied to one group rather than to all).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
import type { AnalysisCtx } from '../../analyses/types';
import { computeColumn } from '../../data/compute';
import { DEFAULT_SETTINGS, toSpec } from '../../model/project';
import { bsemRequest, type BsemOptions, type BsemResult } from '../../rengine/bsem';
import { near, same } from '../../validation/record';
import { exampleModel, examplePanels, exampleSettings, panelPreset } from '../packages';
import { evidence, example, load, MPLUS, type Printed } from './testkit';

/** The examples, and Mplus's effective number of draws assumed for each (see above). */
export const BSEM_EXAMPLES: { key: string; nMplus: number; k?: number; sdRel?: number }[] = [
  { key: 'ex3.18', nMplus: 3000 },
  { key: 'ex5.31', nMplus: 40 },
  { key: 'ex5.32', nMplus: 40 },
  { key: 'ex5.33', nMplus: 100, k: 0.75, sdRel: 0.5 },
  { key: 'ex11.7', nMplus: 100 },
];
const N_OURS = 400;
/** The medians' tolerance in posterior SDs, and the SDs' relative tolerance. */
export const tolerances = (nMplus: number) => ({ k: 3 * 1.25 * Math.sqrt(1 / nMplus + 1 / N_OURS), sdRel: 3 * Math.sqrt(1 / (2 * nMplus) + 1 / (2 * N_OURS)) });
export const FIXTURE = join(__dirname, '..', '..', 'engine', '__fixtures__', 'blavaan', 'mplus.json');
export type Recorded = Record<string, { result: Pick<BsemResult, 'parameters' | 'defined' | 'loop' | 'plausible' | 'groups' | 'maxRhat' | 'minNeff' | 'converged' | 'priors' | 'wiggleSd' | 'chains' | 'burnin' | 'sample' | 'seed'>; versions?: Record<string, string> }>;
export const readRecorded = (): Recorded => JSON.parse(readFileSync(FIXTURE, 'utf8')) as Recorded;

/** The example's card, as the app opens it: its data (with computed columns), model and options. */
export function bsemExample(key: string) {
  const ex = example(key);
  let data = load(key);
  let info = { fileName: key, rows: data.cols[0]?.length ?? 0, missingCells: 0, excluded: [] } as unknown as Parameters<typeof computeColumn>[1];
  for (const k of ex.computed ?? []) ({ data, info } = computeColumn(data, info, k.name, k.expr));
  const settings = exampleSettings(DEFAULT_SETTINGS, ex.settings);
  const model = exampleModel(ex);
  const ctx = { data, info: null, settings, pls: null, projectName: ex.title, model } as unknown as AnalysisCtx;
  const panel = examplePanels(ex)[0];
  return { ex, ctx, data, model, settings, options: panelPreset(panel) as unknown as BsemOptions };
}
export const bsemExampleRequest = (key: string, options?: BsemOptions) => {
  const { data, model, settings, options: o } = bsemExample(key);
  return bsemRequest(data, toSpec(model), settings.missing, options ?? o, settings.seed, settings.confidence);
};

/**
 * Parameters whose Mplus posterior SD is smaller than the large-sample standard error of the same model (lavaan
 * WLSMV, theta parameterisation, as Mplus's Bayes for categorical outcomes: residual variances of the latent
 * responses 1), which a posterior SD of 500 cases cannot be: Gibbs sampling with data augmentation mixes slowly for
 * means and variances of probit models (Mplus stopped 11.7 at 2,900 iterations), so its chains had not explored
 * the posterior's width. There the SD is compared with that standard error. (11.7: s's mean, Mplus 0.061, WLSMV
 * 0.101, ours 0.107; f2's residual variance, Mplus 0.114, WLSMV 0.127, ours 0.162.)
 */
const SHORT_CHAIN_SD: Record<string, Record<string, number>> = { 'ex11.7': { 's ~1 ': 0.101, 'f2 ~~ f2': 0.127 } };

/** Parameters whose posterior has heavy tails (an SD 1.5 times the interval's or more): their medians only. */
const HEAVY_TAILS: Record<string, string[]> = { 'ex5.31': ['f2 =~ y6', 'f2 =~ y7', 'f2 =~ y8'] };

/** Mplus's group of a printed parameter, as the data's group value (5.33: Latent Class k is group k). */
const printedGroup = (p: Printed) => /^Latent Class (\d+)/.exec(p.block)?.[1] ?? null;
const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Every free parameter Mplus prints, against the recorded posterior: medians within k·SD, SDs within sdRel. */
export function compareWithMplus(key: string, r: Recorded[string]['result']) {
  const spec = BSEM_EXAMPLES.find((e) => e.key === key)!;
  const tol = tolerances(spec.nMplus);
  const k = spec.k ?? tol.k;
  if (spec.sdRel) tol.sdRel = spec.sdRel;
  evidence(key, 'Bayesian', ['blavaan']);
  const printed = MPLUS[key].estimates.filter((p) => p.se > 0);
  let n = 0;
  const heavy: string[] = [];
  for (const p of printed) {
    const g = printedGroup(p);
    const mine = r.parameters.filter((e) => (e.op === p.op || (p.op === '|' && e.op === '|'))
      && ((sameName(e.lhs, p.lhs) && (sameName(e.rhs, p.rhs) || (p.op === '|' && e.rhs === 't1'))) || (p.op === '~~' && sameName(e.lhs, p.rhs) && sameName(e.rhs, p.lhs)))
      && (g === null || e.groupLabel === g));
    expect(mine.length, `${key}: ${p.lhs} ${p.op} ${p.rhs} ${p.block}`).toBeGreaterThan(0);
    const e = mine[0];
    const label = `${p.lhs} ${p.op} ${p.rhs}${g ? ` (group ${g})` : ''}`;
    near(`posterior median of ${label}`, e.median!, p.est, k * p.se + 0.0015);
    const under = SHORT_CHAIN_SD[key]?.[`${p.lhs} ${p.op} ${p.rhs}`];
    if (e.sd > 1.5 * (e.high - e.low) / 3.92) {
      // Heavy tails (see above): the SD is not a property of the posterior; only the median is compared.
      heavy.push(label);
    } else if (under !== undefined) {
      // Mplus's SD is below the large-sample SE: its short chain did not explore the posterior (SHORT_CHAIN_SD).
      same(`${label}: Mplus's posterior SD (${p.se}) below the WLSMV standard error (${under}), ours (${e.sd.toFixed(3)}) not`, String(p.se < under && e.sd >= under * (1 - tol.sdRel)), 'true');
    } else near(`posterior SD of ${label}`, e.sd, p.se, tol.sdRel * p.se + 0.0015);
    n++;
  }
  // (5.31: f2's loadings on y6, y7 and y8, whose marker-identified factor has a variance near 0)
  expect(heavy, `${key}: parameters with heavy-tailed posteriors`).toEqual(HEAVY_TAILS[key] ?? []);
  return n;
}
