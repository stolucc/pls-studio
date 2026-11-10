// Regression (R/regression.R): lm, glm (binomial, Poisson, Gamma), MASS
// negative binomial and ordinal, nnet multinomial; survival's censored (tobit)
// and Cox regressions and piecewise exponential model; zero- and censored-
// inflated models by maximum likelihood written out; zero-inflated and hurdle
// count models (pscl).

import type { Dataset } from '../engine/types';
import { rCall, rScript, rStrings } from './bridge';
import type { REngineInfo } from './lavaan';

export type Family = 'gaussian' | 'binomial' | 'poisson' | 'negbin' | 'gamma' | 'ordinal' | 'multinomial' | 'censored' | 'survival';
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
  /** censored: censored from below (at the lowest value) or above (at the highest). */
  censoring?: 'below' | 'above';
  /** poisson: zero-inflated; censored: censored-inflated (a logistic model for the extra values at the limit). */
  inflated?: boolean;
  /** multinomial: the reference level, the first (R's default) or the last (Mplus's). */
  reference?: 'first' | 'last';
  /** survival: the outcome is the time, `status` the 0/1 column; statusCensored: 1 = censored (Mplus's TIMECENSORED), otherwise 1 = event. */
  status?: string;
  statusCensored?: boolean;
  /** survival: cut points of a piecewise-constant baseline hazard (piecewise exponential model); none: Cox regression. */
  cuts?: number[];
  /**
   * gaussian: a predictor whose slope varies across cases (a random slope in a one-level model, Mplus TYPE = RANDOM:
   * s | y ON x; s WITH y): the residual variance becomes sigma2 + 2 c x + tau x^2, fitted by maximum likelihood.
   */
  randomSlope?: string;
  /**
   * poisson, negbin: a zero-inflated (pscl::zeroinfl) or hurdle (pscl::hurdle, logit zero hurdle) model; `zeroPart`: the zero
   * part's predictors, the count part's (same), an intercept only, or `zeroPredictors` (y ~ x | z).
   */
  zeroModel?: 'zeroinfl' | 'hurdle';
  zeroPart?: 'same' | 'intercept' | 'chosen';
  zeroPredictors?: string[];
}
export interface RegressionCurve { x: string; grid: number[]; y?: number[]; levels?: string[]; probs?: number[][]; points?: { x: number[]; y: number[] } }
/** `part`: the inflation's coefficients (inflated models), the zero part of a zero-inflated or hurdle model, a baseline hazard (piecewise exponential; est is the hazard) or a variance or covariance of a random slope. */
export interface Coefficient { level?: string; part?: 'inflation' | 'zero' | 'baseline' | 'random' | null; term: string; est: number; se: number; stat: number; p: number; ciLow: number; ciHigh: number; ratio?: number }
export interface RegressionResult {
  family: Family; link: string; formula: string; se: string;
  /** Zero-inflated or hurdle count models (pscl). */
  zeroModel?: 'zeroinfl' | 'hurdle' | null;
  coefficients: Coefficient[];
  thresholds: Coefficient[];
  levels: { reference: string; others: string[] } | null;
  fit: { n: number; logLik: number; aic: number; bic: number; npar: number; r2?: number; adjR2?: number; sigma?: number; deviance?: number; nullDeviance?: number; dfResidual?: number; dispersion?: number; theta?: number; thetaSe?: number;
    /** censored: the residual variance and its standard error (delta method), as Mplus prints it; the censored, zero and event counts. */
    residualVariance?: number; residualVarianceSe?: number; censored?: number; zeros?: number; events?: number;
    /** Zero models: the zeros expected under the model and under the standard count model (sums of the predicted P(y = 0)). */
    zerosPredicted?: number; zerosStandard?: number };
  lrt: { stat: number; df: number; p: number; pseudoR2?: number } | null;
  /** Zero models: Vuong's test against the standard count model (as pscl::vuong), raw and AIC- and BIC-corrected; z > 0 favours the zero model; p one-sided. */
  vuong?: Record<'raw' | 'aic' | 'bic', { z: number; p: number }> | null;
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
  const status = i.family === 'survival' ? i.status ?? '' : '';
  const zero = zeroOptions(i);
  const names = [...new Set([i.outcome, ...i.predictors, ...i.interactions.flat(), ...(zero.zeroPredictors ?? []), i.trials, i.weights, cluster, status].filter(Boolean))];
  const keep = data.names.map((n, k) => [n, k] as const).filter(([n]) => names.includes(n));
  const categories = Object.fromEntries(names.filter((c) => data.categories?.[c]).map((c) => [c, data.categories![c]]));
  const { zeroModel: _z, zeroPart: _p, zeroPredictors: _q, ...rest } = i;
  return { kind: 'regression', ...rest, ...zero, cluster, status, cuts: i.family === 'survival' ? i.cuts ?? [] : [], categories, data: { names: keep.map(([n]) => n), cols: keep.map(([, k]) => Array.from(data.cols[k], (v) => (Number.isNaN(v) ? null : v))) } };
}

export async function regressionR(data: Dataset, input: RegressionInput): Promise<RegressionResult> {
  const raw = await rCall<Record<string, any>>('ps_regression', regressionRequest(data, input), regressionPackages(input));
  const curves: RegressionCurve[] = arr<any>(raw.curves).filter((c) => c && typeof c === 'object' && !Array.isArray(c)).map((c) => ({
    x: String(c.x), grid: arr<number>(c.grid), ...(c.y ? { y: arr<number>(c.y) } : {}),
    ...(c.levels ? { levels: arr<string>(c.levels), probs: arr<unknown>(c.probs).map((p) => arr<number>(p)) } : {}),
    ...(c.points ? { points: { x: arr<number>(c.points.x), y: arr<number>(c.points.y) } } : {}),
  }));
  const diag = raw.diagnostics && !Array.isArray(raw.diagnostics) ? raw.diagnostics : {};
  return {
    ...raw, coefficients: arr(raw.coefficients), thresholds: arr(raw.thresholds), levels: raw.levels && !Array.isArray(raw.levels) ? { reference: String(raw.levels.reference), others: arr<string>(raw.levels.others) } : null,
    lrt: raw.lrt && !Array.isArray(raw.lrt) ? raw.lrt : null, vuong: raw.vuong && !Array.isArray(raw.vuong) ? raw.vuong : null, diagnostics: { ...diag, ...(diag.vif ? { vif: arr(diag.vif) } : {}) }, curves, warnings: rStrings(raw.warnings),
  } as RegressionResult;
}
export const regressionScriptR = (data: Dataset, input: RegressionInput) => rScript('ps_regression', regressionRequest(data, input), regressionPackages(input));
/** survival only when the model needs it (censored without inflation, survival); pscl for the zero models. */
export const regressionPackages = (i: Pick<RegressionInput, 'family' | 'inflated' | 'zeroModel'>) => (i.family === 'survival' || (i.family === 'censored' && !i.inflated) ? 'regressionSurvival' : isZeroModel(i) ? 'pscl' : 'regression');
/** A zero-inflated or hurdle model applies (a count family, not the zero-inflated Poisson written out). */
export const isZeroModel = (i: Pick<RegressionInput, 'family' | 'inflated' | 'zeroModel'>) => !!i.zeroModel && (i.family === 'poisson' || i.family === 'negbin') && !i.inflated;
/** The zero-model fields the request carries: none unless a zero model applies; the zero predictors only when chosen. */
export function zeroOptions(i: RegressionInput): Pick<RegressionInput, 'zeroModel' | 'zeroPart' | 'zeroPredictors'> {
  if (!isZeroModel(i)) return {};
  const part = i.zeroPart ?? 'same';
  return { zeroModel: i.zeroModel, zeroPart: part, ...(part === 'chosen' ? { zeroPredictors: i.zeroPredictors ?? [] } : {}) };
}
