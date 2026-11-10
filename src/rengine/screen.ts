// Data screening (R/screen.R): distributions and Mardia's test (psych),
// Mahalanobis outliers, and case influence on a CB-SEM model (semfindr).

import type { CbEstimator } from '../engine/cbsem';
import type { Dataset, MissingTreatment, ModelSpec } from '../engine/types';
import { rCall, rScript, rStrings } from './bridge';
import { cbRequest, type REngineInfo } from './lavaan';

export interface ScreenResult {
  variables: string[];
  describe: { n: number; missing: number; mean: number; sd: number; median: number; min: number; max: number; skew: number; kurtosis: number }[];
  mardia: { n: number; p: number; b1p: number; b2p: number; skew: number; smallSkew: number; pSkew: number; pSmall: number; kurtosis: number; pKurt: number; df: number };
  /** Complete cases: row (1-based, in the dataset), Mahalanobis D², its chi-square p. */
  cases: { rows: number[]; d2: number[]; p: number[] };
  alpha: number; df: number;
  warnings: string[]; engine: REngineInfo;
}

/** `approach` absent in results saved before it existed: exact (they were all refits). */
export interface InfluenceResult {
  approach?: 'exact' | 'approximate';
  rows: number[]; gcd: number[]; md: number[]; chisq: number[]; cfi: number[]; rmsea: number[]; tli: number[];
  /** Each complete case's contribution to Mardia's multivariate kurtosis b₂,ₚ of the indicators (d⁴ / n; absent in results saved before it). */
  kurtosis?: { rows: number[]; contribution: number[]; b2p: number; p: number };
  warnings: string[]; engine: REngineInfo;
}

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? v : v == null ? [] : [v]) as T[];
const nums = (v: unknown) => arr<unknown>(v).map((x) => (typeof x === 'number' ? x : NaN));

export function screenRequest(data: Dataset, vars: string[], alpha: number) {
  if (data.moments && data.cols.length === 0) throw new Error('Data screening needs raw data; this dataset is a covariance matrix.');
  const keep = data.names.map((n, k) => [n, k] as const).filter(([n]) => vars.includes(n));
  return { vars, alpha, data: { names: keep.map(([n]) => n), cols: keep.map(([, k]) => Array.from(data.cols[k], (v) => (Number.isNaN(v) ? null : v))) } };
}

export async function screenR(data: Dataset, vars: string[], alpha: number): Promise<ScreenResult> {
  const raw = await rCall<Record<string, any>>('ps_screen', screenRequest(data, vars, alpha), 'psych');
  return {
    ...raw, variables: rStrings(raw.variables), describe: arr(raw.describe),
    cases: { rows: nums(raw.cases?.rows), d2: nums(raw.cases?.d2), p: nums(raw.cases?.p) }, warnings: rStrings(raw.warnings),
  } as ScreenResult;
}
export const screenScriptR = (data: Dataset, vars: string[], alpha: number) => rScript('ps_screen', screenRequest(data, vars, alpha), 'psych');

/** exact: the model refitted without each case (lavaan_rerun); approximate: semfindr's approximations from the one fit. */
export type InfluenceApproach = 'exact' | 'approximate';
const influenceRequest = (data: Dataset, spec: ModelSpec, missing: MissingTreatment, estimator: CbEstimator, approach: InfluenceApproach) => ({ ...cbRequest(data, spec, missing, estimator), approach });
export async function influenceR(data: Dataset, spec: ModelSpec, missing: MissingTreatment, estimator: CbEstimator, approach: InfluenceApproach = 'exact'): Promise<InfluenceResult> {
  const raw = await rCall<Record<string, any>>('ps_influence', influenceRequest(data, spec, missing, estimator, approach), 'semfindr');
  return { approach: raw.approach === 'approximate' ? 'approximate' : 'exact', rows: nums(raw.rows), gcd: nums(raw.gcd), md: nums(raw.md), chisq: nums(raw.chisq), cfi: nums(raw.cfi), rmsea: nums(raw.rmsea), tli: nums(raw.tli),
    ...(raw.kurtosis ? { kurtosis: { rows: nums(raw.kurtosis.rows), contribution: nums(raw.kurtosis.contribution), b2p: Number(raw.kurtosis.b2p), p: Number(raw.kurtosis.p) } } : {}),
    warnings: rStrings(raw.warnings), engine: raw.engine };
}
export const influenceScriptR = (data: Dataset, spec: ModelSpec, missing: MissingTreatment, estimator: CbEstimator, approach: InfluenceApproach = 'exact') => rScript('ps_influence', influenceRequest(data, spec, missing, estimator, approach), 'semfindr');

/** The missing-data card (R/screen.R, ps_missing): patterns, coverage, EM estimates and Mplus's dropout descriptives. */
export interface MissingDataInput { vars: string[]; measures: string[]; descriptive: string[] }
export type DropoutGroup = 'after' | 'stayAfter' | 'dropouts' | 'dropoutsNoIntermittent' | 'dropoutsIntermittent' | 'nonDropouts' | 'nonDropoutsComplete' | 'nonDropoutsIntermittent' | 'total';
export interface DropoutRow { group: DropoutGroup; time?: number; n: number; mean: number | null; sd: number | null }
export interface DropoutVariable { variable: string; time: number; rows: DropoutRow[] }
export interface MissingDataResult {
  variables: string[]; n: number;
  /** In Mplus's order (a pattern as a binary number, a missing value 1, the first variable the most significant digit). */
  patterns: { observed: boolean[]; n: number }[];
  coverage: number[][];
  /** The unrestricted (H1) model by EM / FIML; loglik is null where the covariance matrix is (near) singular. */
  em: { means: number[]; cov: number[][]; cor: number[][]; loglik: number | null; singular: boolean };
  dropout?: { measures: string[]; dropouts: number; nonDropoutsComplete: number; nonDropoutsIntermittent: number; byTime: number[]; set1: DropoutVariable[]; set2: DropoutVariable[] };
  warnings: string[]; engine: REngineInfo;
}
export function missingDataRequest(data: Dataset, o: MissingDataInput) {
  if (data.moments && data.cols.length === 0) throw new Error('The missing-data summary needs raw data; this dataset is a covariance matrix.');
  const used = [...new Set([...o.vars, ...o.measures, ...o.descriptive.filter(Boolean)])];
  const keep = used.map((n) => [n, data.names.indexOf(n)] as const);
  if (keep.some(([, k]) => k < 0)) throw new Error('A column of the summary is not in the data.');
  return { ...o, data: { names: used, cols: keep.map(([, k]) => Array.from(data.cols[k], (v) => (Number.isNaN(v) ? null : v))) } };
}
const numOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const matrix = (v: unknown) => arr<unknown>(v).map((r) => nums(r));
const dropoutVars = (v: unknown): DropoutVariable[] => arr<any>(v).map((x) => ({ variable: String(x.variable), time: Number(x.time),
  rows: arr<any>(x.rows).map((r) => ({ group: r.group, ...(typeof r.time === 'number' ? { time: r.time } : {}), n: Number(r.n), mean: numOrNull(r.mean), sd: numOrNull(r.sd) })) }));
export async function missingDataR(data: Dataset, o: MissingDataInput): Promise<MissingDataResult> {
  const raw = await rCall<Record<string, any>>('ps_missing', missingDataRequest(data, o), 'lavaan');
  const d = raw.dropout;
  return {
    variables: rStrings(raw.variables), n: raw.n,
    patterns: arr<any>(raw.patterns).map((p) => ({ observed: arr<boolean>(p.observed), n: Number(p.n) })),
    coverage: matrix(raw.coverage),
    em: { means: nums(raw.em?.means), cov: matrix(raw.em?.cov), cor: matrix(raw.em?.cor), loglik: numOrNull(raw.em?.loglik), singular: !!raw.em?.singular },
    ...(d ? { dropout: { measures: rStrings(d.measures), dropouts: d.dropouts, nonDropoutsComplete: d.nonDropoutsComplete, nonDropoutsIntermittent: d.nonDropoutsIntermittent, byTime: nums(d.byTime), set1: dropoutVars(d.set1), set2: dropoutVars(d.set2) } } : {}),
    warnings: rStrings(raw.warnings), engine: raw.engine,
  };
}
export const missingDataScriptR = (data: Dataset, o: MissingDataInput) => rScript('ps_missing', missingDataRequest(data, o), 'lavaan');
