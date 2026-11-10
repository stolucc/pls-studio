// Bayesian SEM (R/bayes.R ps_bsem): the CB-SEM model of the diagram by blavaan
// (Stan), desktop R only (the bridge refuses it in the browser: DESKTOP_ONLY),
// or by INLAvaan's approximate Bayesian inference, which runs in webR too.

import type { CbEstimator } from '../engine/cbsem';
import type { Dataset, MissingTreatment, ModelSpec } from '../engine/types';
import { exprToR, parseExpr } from '../model/expr';
import { rCall, rScript, rStrings } from './bridge';
import { rList } from './rjson';
import { cbRequest, type REngineInfo } from './lavaan';

/** A normal prior on labelled parameters, as Mplus's MODEL PRIORS writes it: label ~ N(mean, variance). */
export interface BsemPrior { labels: string[]; mean: number; variance: number }
/** Approximate invariance across groups (blavaan's wiggle; Mplus's DIFF priors): the prior variance of a pairwise difference. */
export interface BsemWiggle { what: ('loadings' | 'intercepts')[]; variance: number }
/** A quantity over a grid of a moderator, from the draws of labelled parameters (Mplus MODEL CONSTRAINT: LOOP and PLOT). */
export interface BsemLoop { name: string; expr: string; variable: string; from: number; to: number; by: number }
/** INLAvaan's parameter types for default priors (priors_for): loadings, regressions, intercepts, latent means, thresholds, residual and factor variances, correlations. */
export type InlaPriorType = 'lambda' | 'beta' | 'nu' | 'alpha' | 'tau' | 'theta' | 'psi' | 'rho';
export interface BsemOptions {
  /** The engine: blavaan (MCMC by Stan, desktop R; absent) or INLAvaan (approximate Bayesian inference; also in the browser). With INLAvaan `sample` is its number of posterior draws (PPP, DIC, defined parameters). */
  engine?: 'inlavaan';
  /** INLAvaan: default priors by parameter type, instead of its own (priors_for). */
  defaultPriors?: Partial<Record<InlaPriorType, string>>;
  identification: 'unit' | 'marker'; chains: number; burnin: number; sample: number;
  /** The default priors: blavaan's (absent) or Mplus's (flat). */
  priors?: 'mplus';
  labelPriors?: BsemPrior[];
  wiggle?: BsemWiggle;
  loop?: BsemLoop;
  /** Plausible values: draws of every case's factor scores (0 or absent: none). */
  plausible?: number;
}
export interface BsemParameter {
  lhs: string; op: string; rhs: string; mean: number; sd: number; low: number; high: number; rhat?: number | null; neff?: number | null;
  median?: number; label?: string; group?: number; groupLabel?: string; prior?: string;
  /** INLAvaan: how far the fitted skew-normal marginal deviates from the scanned posterior (NMAD), and the VB correction of the mean in posterior SDs. */
  nmad?: number | null; vbShift?: number | null;
}
/** INLAvaan's global diagnostics of the approximation (diagnostics()). */
export interface InlaDiagnostics { iterations?: number; gradInf?: number; modeShiftMax?: number; hessCond?: number; vbShiftMax?: number; kldMax?: number; nmadMax?: number; scanEndMassMax?: number }
export interface BsemDefined { name: string; expr: string; median: number; mean: number; sd: number; low: number; high: number }
export interface BsemLoopResult { name: string; variable: string; expr: string; x: number[]; median: number[]; mean: number[]; sd: number[]; low: number[]; high: number[] }
/** Summaries of the plausible values: over all cases and draws (means, covariances), and the cases' own SDs averaged. */
export interface BsemPlausible { draws: number; cases: number; factors: string[]; mean: number[]; cov: number[][]; meanSd: number[] }
export interface BsemResult {
  identification: BsemOptions['identification']; chains: number; burnin: number; sample: number; seed: number; confidence: number; n: number;
  /** blavaan: R-hat and n_eff over the parameters (INLAvaan: null, no chains). */
  parameters: BsemParameter[]; maxRhat: number | null; minNeff: number | null; converged: boolean;
  fit: {
    ppp?: number; dic?: number; pDic?: number; waic?: number; looic?: number; seLooic?: number; margLogLik?: number; bic?: number;
    // (INLAvaan: WAIC's SE and effective parameters, LOO's, and the Bayesian fit indices)
    seWaic?: number; pWaic?: number; pLoo?: number; brmsea?: number; bgammahat?: number; adjBgammahat?: number; bmc?: number; bcfi?: number; btli?: number; bnfi?: number;
  };
  warnings: string[]; engine: REngineInfo & { desktop?: string };
  priors?: 'blavaan' | 'mplus' | 'inlavaan' | 'custom'; groups?: string[]; wiggleSd?: number; defined?: BsemDefined[]; loop?: BsemLoopResult; plausible?: BsemPlausible;
  /** INLAvaan: its diagnostics, the default priors set by type, its run time, and where the intervals come from (95%: the marginals; other levels: posterior draws). */
  diagnostics?: InlaDiagnostics; defaultPriors?: Partial<Record<InlaPriorType, string>>; seconds?: number; intervals?: 'marginals' | 'draws';
}
/** The R package an engine runs. */
export const bsemPackage = (o: Pick<BsemOptions, 'engine'>) => (o.engine === 'inlavaan' ? 'INLAvaan' : 'blavaan');

const num = (v: unknown): number[] => rList<number>(v).map(Number);

export const bsemRequest = (data: Dataset, spec: ModelSpec, missing: MissingTreatment, o: BsemOptions, seed: number, confidence: number) => {
  const ordinal = (spec.ordered?.length ?? 0) > 0;
  const { loop, labelPriors, wiggle, priors, plausible, engine, defaultPriors, ...rest } = o;
  return {
    ...cbRequest(data, spec, missing, (ordinal ? 'WLSMV' : 'ML') as CbEstimator), ...rest, seed, confidence,
    // (default priors by type are INLAvaan's only)
    ...(engine === 'inlavaan' ? { engine, ...(defaultPriors && Object.keys(defaultPriors).length ? { defaultPriors } : {}) } : {}),
    ...(priors ? { priors } : {}),
    ...(labelPriors?.length ? { labelPriors } : {}),
    ...(wiggle ? { wiggle } : {}),
    ...(plausible ? { plausible } : {}),
    // (the expression travels as printed from its parsed form, never as typed)
    ...(loop ? { loop: { ...loop, expr: exprToR(parseExpr(loop.expr)) } } : {}),
  };
};

export async function bsemR(data: Dataset, spec: ModelSpec, missing: MissingTreatment, o: BsemOptions, seed: number, confidence: number): Promise<BsemResult> {
  const r = await rCall<Record<string, any>>('ps_bsem', bsemRequest(data, spec, missing, o, seed, confidence), bsemPackage(o));
  return bsemResult(r);
}
/** The reply as the card reads it (R's single values and empty lists normalised). */
export function bsemResult(r: Record<string, any>): BsemResult {
  const loop = r.loop && !Array.isArray(r.loop) ? { ...r.loop, x: num(r.loop.x), median: num(r.loop.median), mean: num(r.loop.mean), sd: num(r.loop.sd), low: num(r.loop.low), high: num(r.loop.high) } : undefined;
  const pv = r.plausible && !Array.isArray(r.plausible) ? r.plausible : undefined;
  const plausible = pv ? { ...pv, factors: rList<string>(pv.factors), mean: num(pv.mean), meanSd: num(pv.meanSd), cov: rList<unknown>(pv.cov).map((row) => num(row)) } : undefined;
  return {
    ...r, parameters: rList(r.parameters), fit: r.fit && !Array.isArray(r.fit) ? r.fit : {}, warnings: rStrings(r.warnings),
    ...(r.groups ? { groups: rList<string>(r.groups).map(String) } : {}), defined: rList(r.defined), loop, plausible,
  } as BsemResult;
}
export const bsemScriptR = (data: Dataset, spec: ModelSpec, missing: MissingTreatment, o: BsemOptions, seed: number, confidence: number) =>
  rScript('ps_bsem', bsemRequest(data, spec, missing, o, seed, confidence), bsemPackage(o));
