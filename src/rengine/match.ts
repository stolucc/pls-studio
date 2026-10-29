// Matching (R/match.R): MatchIt, balance by cobalt, the effect by weighted
// regression with cluster-robust standard errors.

import type { Dataset } from '../engine/types';
import { rCall, rScript, rStrings } from './bridge';
import type { REngineInfo } from './lavaan';

export type MatchMethod = 'nearest' | 'optimal' | 'full' | 'exact' | 'cem' | 'subclass';
export interface MatchInput {
  treatment: string; covariates: string[]; outcome: string;
  method: MatchMethod; distance: 'glm' | 'mahalanobis'; estimand: 'ATT' | 'ATE' | 'ATC';
  ratio: number; caliper: number | null; replace: boolean; seed: number; confidence: number;
}
export interface MatchResult {
  method: MatchMethod; estimand: string;
  counts: { row: string; control: number; treated: number }[];
  balance: { variable: string; type: string; diffBefore: number; diffAfter: number; ratioBefore: number | null; ratioAfter: number | null }[];
  effect: { est: number; se: number; t: number; p: number; ciLow: number; ciHigh: number; n: number } | null;
  warnings: string[]; engine: REngineInfo;
}

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? v : v == null ? [] : [v]) as T[];
const n0 = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

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
  const raw = await rCall<Record<string, any>>('ps_match', matchRequest(data, input), 'MatchIt');
  return {
    method: raw.method, estimand: raw.estimand, counts: arr(raw.counts),
    balance: arr<any>(raw.balance).map((b) => ({ ...b, ratioBefore: n0(b.ratioBefore), ratioAfter: n0(b.ratioAfter) })),
    effect: raw.effect ?? null, warnings: rStrings(raw.warnings), engine: raw.engine,
  };
}
export const matchScriptR = (data: Dataset, input: MatchInput) => rScript('ps_match', matchRequest(data, input), 'MatchIt');
