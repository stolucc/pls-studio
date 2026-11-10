// Matching (R/match.R): MatchIt, balance by cobalt, the effect by weighted
// regression with cluster-robust standard errors.

import type { Dataset } from '../engine/types';
import { rCall, rScript, rStrings } from './bridge';
import { rList, rNum } from './reply';
import type { REngineInfo } from './lavaan';

/** 'weighting': inverse probability weighting (WeightIt) instead of matching. */
export type MatchMethod = 'nearest' | 'optimal' | 'full' | 'exact' | 'cem' | 'subclass' | 'weighting';
export interface MatchInput {
  treatment: string; covariates: string[]; outcome: string;
  method: MatchMethod; distance: 'glm' | 'mahalanobis'; estimand: 'ATT' | 'ATE' | 'ATC';
  ratio: number; caliper: number | null; replace: boolean; seed: number; confidence: number;
  /** Weighting: the effect from the weighted outcome on treatment (IPW), or doubly robust (outcome model with covariates, g-computation). */
  effectModel?: 'ipw' | 'dr';
  /** Weighting: weights from a logistic propensity score (glm) or by entropy balancing (ebal). */
  weightMethod?: 'glm' | 'ebal';
  /** Matching on a propensity score: its link (logit or probit). */
  link?: 'logit' | 'probit';
  /** Matching: the effect as the difference in the matched data, or (dr) the outcome model with the covariates by g-computation. */
  matchEffect?: 'difference' | 'dr';
}
export interface MatchResult {
  method: MatchMethod; estimand: string;
  counts: { row: string; control: number; treated: number }[];
  balance: { variable: string; type: string; diffBefore: number; diffAfter: number; ratioBefore: number | null; ratioAfter: number | null }[];
  effect: { est: number; se: number; t: number; p: number; ciLow: number; ciHigh: number; n: number } | null;
  /** Weighting: the largest weight and the ranges among treated and controls. */
  weights?: { max: number; treatedRange: number[]; controlRange: number[] };
  effectModel?: 'ipw' | 'dr';
  weightMethod?: 'glm' | 'ebal';
  matchEffect?: 'difference' | 'dr';
  link?: 'logit' | 'probit';
  warnings: string[]; engine: REngineInfo;
}


export function matchRequest(data: Dataset, i: MatchInput) {
  if (data.moments && data.cols.length === 0) throw new Error('Matching needs raw data; this dataset is a covariance matrix.');
  const names = [i.treatment, ...i.covariates, ...(i.outcome ? [i.outcome] : [])];
  const keep = data.names.map((n, k) => [n, k] as const).filter(([n]) => names.includes(n));
  // Text (categorical) covariates travel with their category names, to become factors.
  const categories = Object.fromEntries(i.covariates.filter((c) => data.categories?.[c]).map((c) => [c, data.categories![c]]));
  return {
    ...i, caliper: i.caliper ?? undefined, categories,
    data: { names: keep.map(([n]) => n), cols: keep.map(([, k]) => Array.from(data.cols[k], (v) => (Number.isNaN(v) ? null : v))) },
  };
}

export async function matchR(data: Dataset, input: MatchInput): Promise<MatchResult> {
  const raw = await rCall<Record<string, any>>('ps_match', matchRequest(data, input), input.method === 'weighting' ? 'WeightIt' : 'MatchIt');
  return {
    method: raw.method, estimand: raw.estimand, counts: rList(raw.counts),
    ...(raw.weights ? { weights: { max: Number(raw.weights.max), treatedRange: rList<number>(raw.weights.treatedRange), controlRange: rList<number>(raw.weights.controlRange) } } : {}),
    ...(raw.effectModel ? { effectModel: raw.effectModel } : {}),
    ...(raw.weightMethod === 'ebal' ? { weightMethod: 'ebal' as const } : {}),
    ...(raw.matchEffect === 'dr' ? { matchEffect: 'dr' as const } : {}),
    ...(raw.link === 'probit' ? { link: 'probit' as const } : {}),
    balance: rList<any>(raw.balance).map((b) => ({ ...b, ratioBefore: rNum(b.ratioBefore), ratioAfter: rNum(b.ratioAfter) })),
    effect: raw.effect ?? null, warnings: rStrings(raw.warnings), engine: raw.engine,
  };
}
export const matchScriptR = (data: Dataset, input: MatchInput) => rScript('ps_match', matchRequest(data, input), input.method === 'weighting' ? 'WeightIt' : 'MatchIt');
