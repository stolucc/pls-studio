// Mixed models (R/mixed.R): multilevel regression with random intercepts and
// slopes (lme4 + lmerTest) and growth mixture models (lcmm::hlme).

import type { Dataset } from '../engine/types';
import { rCall, rScript, rStrings } from './bridge';
import { rColumns, rList } from './rjson';
import type { REngineInfo } from './lavaan';

/** A cluster level above the first, nesting it (e.g. schools above classes), with its random slopes. */
export interface LmmLevel {
  cluster: string; slopes: string[];
  /** A variance per occasion at this level (repeated measures in columns): the occasions' residual variances between these clusters. */
  occasions?: boolean;
}
/**
 * Repeated measures in columns (wide data, as Mplus reads them): each row is a person, the measures are stacked as
 * the outcome, one row per person and occasion, with the time score `time` and the time-varying covariates
 * (one column per occasion each). The persons are the first level.
 */
export interface LmmRepeated { measures: string[]; times: number[]; time: string; varying: { name: string; columns: string[] }[] }
/** A further outcome, modelled with the first (stacked): its own intercept, predictors and random slopes. */
export interface LmmOutcome { outcome: string; predictors: string[]; slopes: string[] }
export interface LmmInput {
  outcome: string; predictors: string[]; cluster: string; slopes: string[];
  /** none; grand-mean centred; within / between (cluster means as extra predictors). */
  center: 'none' | 'grand' | 'cluster';
  estimation: 'REML' | 'ML';
  // The further options (absent in older saved cards, which run as before): these fit by nlme where lme4 cannot.
  /** Interaction terms (products of two or more predictors), as fixed effects. */
  interactions?: string[][];
  /** Random slopes uncorrelated with the intercept and the other random effects (at every level; Mplus's default for s | y ON x). */
  independent?: string[];
  /** Further cluster levels, each nesting the one below. */
  levels?: LmmLevel[];
  repeated?: LmmRepeated;
  /** A residual variance per occasion (repeated measures in columns; nlme's varIdent). */
  residuals?: 'occasion';
  outcomes?: LmmOutcome[];
  /** Robust standard errors as Mplus's MLR: the sandwich over the top-level clusters, for every parameter (ML only). */
  se?: 'robust';
}
export interface LmmResult {
  n: number; clusters: number; reml: boolean;
  /** (null: wide data, several outcomes or levels) */
  icc: number | null;
  /** df null: robust standard errors (z tests). */
  fixed: { term: string; est: number; se: number; df: number | null; t: number; p: number; ciLow: number; ciHigh: number }[];
  /** Variance components: a (and b for a covariance) within group; group "Residual" for the residual (a: the occasion or outcome of a residual variance per occasion or outcome); se with robust standard errors. */
  random: { group: string; a: string | null; b: string | null; variance: number; sd: number; se?: number | null }[];
  /** (null with several outcomes) */
  r2: { marginal: number; conditional: number } | null;
  logLik: number; aic: number; bic: number; singular: boolean;
  /** The general version: the units per level (lowest first), free parameters, cases (BIC's n), robust standard errors. */
  levels?: { name: string; units: number }[]; npar?: number; cases?: number; robust?: boolean;
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

const n0 = (v: unknown) => (typeof v === 'number' ? v : null);

/** The data columns a multilevel regression uses (with repeated measures in columns: the measures and the time-varying covariates' columns, not the names they create). */
export function lmmColumns(i: LmmInput): string[] {
  const created = i.repeated ? [i.outcome, i.repeated.time, ...i.repeated.varying.map((v) => v.name)] : [];
  return [...new Set([
    ...(i.repeated ? [...i.repeated.measures, ...i.repeated.varying.flatMap((v) => v.columns)] : [i.outcome]),
    ...[...i.predictors, ...(i.interactions ?? []).flat()].filter((x) => !created.includes(x)),
    ...(i.outcomes ?? []).flatMap((o) => [o.outcome, ...o.predictors]),
    i.cluster, ...(i.levels ?? []).map((l) => l.cluster),
  ].filter(Boolean))];
}
export const lmmRequest = (data: Dataset, i: LmmInput) => ({ ...i, data: rColumns(data, lmmColumns(i)) });
export const gmmRequest = (data: Dataset, i: GmmInput) =>
  ({ ...i, data: rColumns(data, [...(i.format === 'wide' ? i.measures : [i.subject, i.time, i.outcome]), ...i.covariates, ...(i.format === 'wide' && i.residuals ? i.membership ?? [] : [])]) });
/** lcmm, or the wide model with a residual variance per occasion. */
const gmmBridge = (i: GmmInput) => (i.format === 'wide' && i.residuals === 'occasion' ? ['ps_gmm_wide', 'stats'] as const : ['ps_gmm', 'lcmm'] as const);

export async function lmmR(data: Dataset, input: LmmInput): Promise<LmmResult> {
  const raw = await rCall<Record<string, any>>('ps_lmm', lmmRequest(data, input), 'lme4');
  return {
    ...raw, icc: n0(raw.icc), r2: raw.r2 && typeof raw.r2.marginal === 'number' ? raw.r2 : null,
    fixed: rList<any>(raw.fixed).map((f) => ({ ...f, df: n0(f.df) })),
    random: rList<any>(raw.random).map((r) => ({ ...r, a: r.a ?? null, b: r.b ?? null, ...('se' in r ? { se: n0(r.se) } : {}) })),
    ...(raw.levels ? { levels: rList(raw.levels) } : {}),
    slopeTest: raw.slopeTest ?? null,
    lines: raw.lines ? { ...raw.lines, intercepts: rList<number>(raw.lines.intercepts), slopes: rList<number>(raw.lines.slopes) } : null,
    warnings: rStrings(raw.warnings),
  } as LmmResult;
}
export const lmmScriptR = (data: Dataset, input: LmmInput) => rScript('ps_lmm', lmmRequest(data, input), 'lme4');

export async function gmmR(data: Dataset, input: GmmInput): Promise<GmmResult> {
  const [fn, pkg] = gmmBridge(input);
  const raw = await rCall<Record<string, any>>(fn, gmmRequest(data, input), pkg);
  // Lists of vectors (one per class) stay arrays of arrays in R's JSON.
  const rows = (v: unknown) => rList<unknown>(v).map((x) => rList<number>(x));
  return {
    ...raw, times: rList<number>(raw.times), observedTimes: rList<number>(raw.observedTimes), warnings: rStrings(raw.warnings),
    models: rList<any>(raw.models).map((m) => ({
      ...m, entropy: n0(m.entropy), shares: rList<number>(m.shares),
      params: rList<any>(m.params).map((p) => ({ name: p.name, est: p.est, se: n0(p.se), p: n0(p.p) })),
      trajectories: rows(m.trajectories),
      observed: m.observed == null ? null : rows(m.observed),
    })),
  } as GmmResult;
}
export const gmmScriptR = (data: Dataset, input: GmmInput) => rScript(gmmBridge(input)[0], gmmRequest(data, input), gmmBridge(input)[1]);
