// Mixed models (R/mixed.R): multilevel regression with random intercepts and
// slopes (lme4 + lmerTest) and growth mixture models (lcmm::hlme).

import type { Dataset } from '../engine/types';
import { rCall, rScript, rStrings } from './bridge';
import type { REngineInfo } from './lavaan';

export interface LmmInput {
  outcome: string; predictors: string[]; cluster: string; slopes: string[];
  /** none; grand-mean centred; within / between (cluster means as extra predictors). */
  center: 'none' | 'grand' | 'cluster';
  estimation: 'REML' | 'ML';
}
export interface LmmResult {
  n: number; clusters: number; reml: boolean; icc: number;
  fixed: { term: string; est: number; se: number; df: number; t: number; p: number; ciLow: number; ciHigh: number }[];
  /** Variance components: a (and b for a covariance) within group; group "Residual" for the residual. */
  random: { group: string; a: string | null; b: string | null; variance: number; sd: number }[];
  r2: { marginal: number; conditional: number };
  logLik: number; aic: number; bic: number; singular: boolean;
  slopeTest: { chisq: number; df: number; p: number } | null;
  lines: { predictor: string; range: [number, number]; intercepts: number[]; slopes: number[]; fixed: [number, number] } | null;
  warnings: string[]; engine: REngineInfo;
}

export type GmmInput = {
  shape: 'linear' | 'quadratic'; random: 'none' | 'intercept' | 'slope'; classes: number[]; covariates: string[]; nrep: number; seed: number;
} & ({
  format: 'wide'; measures: string[]; times: number[];
  /**
   * 'occasion': a residual variance per occasion (Mplus's default), fitted by a likelihood written out in R
   * (ps_gmm_wide) instead of lcmm; the covariates then predict the growth factors (Mplus: i s ON x) and
   * `membership` the class (c ON w).
   */
  residuals?: 'occasion'; membership?: string[];
} | { format: 'long'; subject: string; time: string; outcome: string });
export interface GmmModel {
  k: number; logLik: number; npar: number; aic: number; bic: number; sabic: number; entropy: number | null; converged: boolean;
  shares: number[]; params: { name: string; est: number; se: number | null; p: number | null }[];
  /** Predicted mean trajectory per class over `times` (covariates at their means). */
  trajectories: number[][];
  /** Observed means per class (modal assignment) at `observedTimes`, when there are few occasions. */
  observed: (number | null)[][] | null;
}
export interface GmmResult { n: number; observations: number; times: number[]; observedTimes: number[]; models: GmmModel[]; warnings: string[]; engine: REngineInfo }

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? v : v == null ? [] : [v]) as T[];
const n0 = (v: unknown) => (typeof v === 'number' ? v : null);
const columns = (data: Dataset, names: string[]) => {
  const keep = data.names.map((n, i) => [n, i] as const).filter(([n]) => names.includes(n));
  return { names: keep.map(([n]) => n), cols: keep.map(([, i]) => Array.from(data.cols[i], (v) => (Number.isNaN(v) ? null : v))) };
};

export const lmmRequest = (data: Dataset, i: LmmInput) => ({ ...i, data: columns(data, [i.outcome, ...i.predictors, i.cluster]) });
export const gmmRequest = (data: Dataset, i: GmmInput) =>
  ({ ...i, data: columns(data, [...(i.format === 'wide' ? i.measures : [i.subject, i.time, i.outcome]), ...i.covariates, ...(i.format === 'wide' && i.residuals ? i.membership ?? [] : [])]) });
/** lcmm, or the wide model with a residual variance per occasion. */
const gmmBridge = (i: GmmInput) => (i.format === 'wide' && i.residuals === 'occasion' ? ['ps_gmm_wide', 'stats'] as const : ['ps_gmm', 'lcmm'] as const);

export async function lmmR(data: Dataset, input: LmmInput): Promise<LmmResult> {
  const raw = await rCall<Record<string, any>>('ps_lmm', lmmRequest(data, input), 'lme4');
  return {
    ...raw, fixed: arr(raw.fixed), random: arr<any>(raw.random).map((r) => ({ ...r, a: r.a ?? null, b: r.b ?? null })),
    slopeTest: raw.slopeTest ?? null,
    lines: raw.lines ? { ...raw.lines, intercepts: arr<number>(raw.lines.intercepts), slopes: arr<number>(raw.lines.slopes) } : null,
    warnings: rStrings(raw.warnings),
  } as LmmResult;
}
export const lmmScriptR = (data: Dataset, input: LmmInput) => rScript('ps_lmm', lmmRequest(data, input), 'lme4');

export async function gmmR(data: Dataset, input: GmmInput): Promise<GmmResult> {
  const [fn, pkg] = gmmBridge(input);
  const raw = await rCall<Record<string, any>>(fn, gmmRequest(data, input), pkg);
  // Lists of vectors (one per class) stay arrays of arrays in R's JSON.
  const rows = (v: unknown) => arr<unknown>(v).map((x) => arr<number>(x));
  return {
    ...raw, times: arr<number>(raw.times), observedTimes: arr<number>(raw.observedTimes), warnings: rStrings(raw.warnings),
    models: arr<any>(raw.models).map((m) => ({
      ...m, entropy: n0(m.entropy), shares: arr<number>(m.shares),
      params: arr<any>(m.params).map((p) => ({ name: p.name, est: p.est, se: n0(p.se), p: n0(p.p) })),
      trajectories: rows(m.trajectories),
      observed: m.observed == null ? null : rows(m.observed),
    })),
  } as GmmResult;
}
export const gmmScriptR = (data: Dataset, input: GmmInput) => rScript(gmmBridge(input)[0], gmmRequest(data, input), gmmBridge(input)[1]);
