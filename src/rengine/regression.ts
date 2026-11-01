// Regression (R/regression.R): lm, glm (binomial, Poisson, Gamma), MASS
// negative binomial and ordinal, nnet multinomial.

import type { Dataset } from '../engine/types';
import { rCall, rScript, rStrings } from './bridge';
import type { REngineInfo } from './lavaan';

export type Family = 'gaussian' | 'binomial' | 'poisson' | 'negbin' | 'gamma' | 'ordinal' | 'multinomial';
export interface RegressionInput {
  outcome: string; predictors: string[];
  /** Numeric predictors treated as categorical (factors); text columns are factors anyway. */
  categorical: string[];
  interactions: string[][];
  family: Family;
  /** binomial: logit, probit, cloglog; ordinal: logistic, probit, cloglog. */
  link: string;
  /** binomial counts: the number of trials per row (the outcome is the number of successes). */
  trials: string;
  /** Frequency weights. */
  weights: string;
  /** HC0: White's sandwich (Mplus MLR); HC3: the leverage-corrected one (small samples). */
  se: 'model' | 'HC0' | 'HC3' | 'cluster';
  cluster: string;
  confidence: number;
}
export interface RegressionCurve { x: string; grid: number[]; y?: number[]; levels?: string[]; probs?: number[][]; points?: { x: number[]; y: number[] } }
export interface Coefficient { level?: string; term: string; est: number; se: number; stat: number; p: number; ciLow: number; ciHigh: number; ratio?: number }
export interface RegressionResult {
  family: Family; link: string; formula: string; se: string;
  coefficients: Coefficient[];
  thresholds: Coefficient[];
  levels: { reference: string; others: string[] } | null;
  fit: { n: number; logLik: number; aic: number; bic: number; npar: number; r2?: number; adjR2?: number; sigma?: number; deviance?: number; nullDeviance?: number; dfResidual?: number; dispersion?: number; theta?: number; thetaSe?: number };
  lrt: { stat: number; df: number; p: number; pseudoR2?: number } | null;
  diagnostics: { vif?: { term: string; vif: number | null }[]; accuracy?: number; auc?: number; hosmerLemeshow?: { stat: number; df: number; p: number } };
  /** One partial-effect curve per numeric predictor: the response over it, the other predictors at their means. */
  curves: RegressionCurve[];
  warnings: string[]; engine: REngineInfo;
}

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? v : v == null ? [] : [v]) as T[];

export function regressionRequest(data: Dataset, i: RegressionInput) {
  if (data.moments && data.cols.length === 0) throw new Error('Regression needs raw data; this dataset is a covariance matrix.');
  // (the cluster column only when it is used: a stale choice must not drop rows or fail the run)
  const cluster = i.se === 'cluster' ? i.cluster : '';
  const names = [...new Set([i.outcome, ...i.predictors, ...i.interactions.flat(), i.trials, i.weights, cluster].filter(Boolean))];
  const keep = data.names.map((n, k) => [n, k] as const).filter(([n]) => names.includes(n));
  const categories = Object.fromEntries(names.filter((c) => data.categories?.[c]).map((c) => [c, data.categories![c]]));
  return { kind: 'regression', ...i, cluster, categories, data: { names: keep.map(([n]) => n), cols: keep.map(([, k]) => Array.from(data.cols[k], (v) => (Number.isNaN(v) ? null : v))) } };
}

export async function regressionR(data: Dataset, input: RegressionInput): Promise<RegressionResult> {
  const raw = await rCall<Record<string, any>>('ps_regression', regressionRequest(data, input), 'regression');
  const curves: RegressionCurve[] = arr<any>(raw.curves).filter((c) => c && typeof c === 'object' && !Array.isArray(c)).map((c) => ({
    x: String(c.x), grid: arr<number>(c.grid), ...(c.y ? { y: arr<number>(c.y) } : {}),
    ...(c.levels ? { levels: arr<string>(c.levels), probs: arr<unknown>(c.probs).map((p) => arr<number>(p)) } : {}),
    ...(c.points ? { points: { x: arr<number>(c.points.x), y: arr<number>(c.points.y) } } : {}),
  }));
  const diag = raw.diagnostics && !Array.isArray(raw.diagnostics) ? raw.diagnostics : {};
  return {
    ...raw, coefficients: arr(raw.coefficients), thresholds: arr(raw.thresholds), levels: raw.levels && !Array.isArray(raw.levels) ? { reference: String(raw.levels.reference), others: arr<string>(raw.levels.others) } : null,
    lrt: raw.lrt && !Array.isArray(raw.lrt) ? raw.lrt : null, diagnostics: { ...diag, ...(diag.vif ? { vif: arr(diag.vif) } : {}) }, curves, warnings: rStrings(raw.warnings),
  } as RegressionResult;
}
export const regressionScriptR = (data: Dataset, input: RegressionInput) => rScript('ps_regression', regressionRequest(data, input), 'regression');
