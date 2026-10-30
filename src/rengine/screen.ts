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

export interface InfluenceResult {
  rows: number[]; gcd: number[]; md: number[]; chisq: number[]; cfi: number[]; rmsea: number[]; tli: number[];
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

export async function influenceR(data: Dataset, spec: ModelSpec, missing: MissingTreatment, estimator: CbEstimator): Promise<InfluenceResult> {
  const raw = await rCall<Record<string, any>>('ps_influence', cbRequest(data, spec, missing, estimator), 'semfindr');
  return { rows: nums(raw.rows), gcd: nums(raw.gcd), md: nums(raw.md), chisq: nums(raw.chisq), cfi: nums(raw.cfi), rmsea: nums(raw.rmsea), tli: nums(raw.tli), warnings: rStrings(raw.warnings), engine: raw.engine };
}
export const influenceScriptR = (data: Dataset, spec: ModelSpec, missing: MissingTreatment, estimator: CbEstimator) => rScript('ps_influence', cbRequest(data, spec, missing, estimator), 'semfindr');
