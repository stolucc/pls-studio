// Bayesian SEM (R/bayes.R ps_bsem): the CB-SEM model of the diagram by blavaan
// (Stan). Desktop R only: the bridge refuses it in the browser (DESKTOP_ONLY).

import type { CbEstimator } from '../engine/cbsem';
import type { Dataset, MissingTreatment, ModelSpec } from '../engine/types';
import { exprToR, parseExpr } from '../model/expr';
import { rCall, rScript, rStrings } from './bridge';
import { cbRequest, type REngineInfo } from './lavaan';

/** A normal prior on labelled parameters, as Mplus's MODEL PRIORS writes it: label ~ N(mean, variance). */
export interface BsemPrior { labels: string[]; mean: number; variance: number }
/** Approximate invariance across groups (blavaan's wiggle; Mplus's DIFF priors): the prior variance of a pairwise difference. */
export interface BsemWiggle { what: ('loadings' | 'intercepts')[]; variance: number }
/** A quantity over a grid of a moderator, from the draws of labelled parameters (Mplus MODEL CONSTRAINT: LOOP and PLOT). */
export interface BsemLoop { name: string; expr: string; variable: string; from: number; to: number; by: number }
export interface BsemOptions {
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
  lhs: string; op: string; rhs: string; mean: number; sd: number; low: number; high: number; rhat: number | null; neff: number | null;
  median?: number; label?: string; group?: number; groupLabel?: string; prior?: string;
}
export interface BsemDefined { name: string; expr: string; median: number; mean: number; sd: number; low: number; high: number }
export interface BsemLoopResult { name: string; variable: string; expr: string; x: number[]; median: number[]; mean: number[]; sd: number[]; low: number[]; high: number[] }
/** Summaries of the plausible values: over all cases and draws (means, covariances), and the cases' own SDs averaged. */
export interface BsemPlausible { draws: number; cases: number; factors: string[]; mean: number[]; cov: number[][]; meanSd: number[] }
export interface BsemResult {
  identification: BsemOptions['identification']; chains: number; burnin: number; sample: number; seed: number; confidence: number; n: number;
  parameters: BsemParameter[]; maxRhat: number; minNeff: number; converged: boolean;
  fit: { ppp?: number; dic?: number; pDic?: number; waic?: number; looic?: number; seLooic?: number; margLogLik?: number; bic?: number };
  warnings: string[]; engine: REngineInfo & { desktop?: string };
  priors?: 'blavaan' | 'mplus'; groups?: string[]; wiggleSd?: number; defined?: BsemDefined[]; loop?: BsemLoopResult; plausible?: BsemPlausible;
}

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? v : v == null ? [] : [v]) as T[];
const num = (v: unknown): number[] => arr<number>(v).map(Number);

export const bsemRequest = (data: Dataset, spec: ModelSpec, missing: MissingTreatment, o: BsemOptions, seed: number, confidence: number) => {
  const ordinal = (spec.ordered?.length ?? 0) > 0;
  const { loop, labelPriors, wiggle, priors, plausible, ...rest } = o;
  return {
    ...cbRequest(data, spec, missing, (ordinal ? 'WLSMV' : 'ML') as CbEstimator), ...rest, seed, confidence,
    ...(priors ? { priors } : {}),
    ...(labelPriors?.length ? { labelPriors } : {}),
    ...(wiggle ? { wiggle } : {}),
    ...(plausible ? { plausible } : {}),
    // (the expression travels as printed from its parsed form, never as typed)
    ...(loop ? { loop: { ...loop, expr: exprToR(parseExpr(loop.expr)) } } : {}),
  };
};

export async function bsemR(data: Dataset, spec: ModelSpec, missing: MissingTreatment, o: BsemOptions, seed: number, confidence: number): Promise<BsemResult> {
  const r = await rCall<Record<string, any>>('ps_bsem', bsemRequest(data, spec, missing, o, seed, confidence), 'blavaan');
  return bsemResult(r);
}
/** The reply as the card reads it (R's single values and empty lists normalised). */
export function bsemResult(r: Record<string, any>): BsemResult {
  const loop = r.loop && !Array.isArray(r.loop) ? { ...r.loop, x: num(r.loop.x), median: num(r.loop.median), mean: num(r.loop.mean), sd: num(r.loop.sd), low: num(r.loop.low), high: num(r.loop.high) } : undefined;
  const pv = r.plausible && !Array.isArray(r.plausible) ? r.plausible : undefined;
  const plausible = pv ? { ...pv, factors: arr<string>(pv.factors), mean: num(pv.mean), meanSd: num(pv.meanSd), cov: arr<unknown>(pv.cov).map((row) => num(row)) } : undefined;
  return {
    ...r, parameters: arr(r.parameters), fit: r.fit && !Array.isArray(r.fit) ? r.fit : {}, warnings: rStrings(r.warnings),
    ...(r.groups ? { groups: arr<string>(r.groups).map(String) } : {}), defined: arr(r.defined), loop, plausible,
  } as BsemResult;
}
export const bsemScriptR = (data: Dataset, spec: ModelSpec, missing: MissingTreatment, o: BsemOptions, seed: number, confidence: number) =>
  rScript('ps_bsem', bsemRequest(data, spec, missing, o, seed, confidence), 'blavaan');
