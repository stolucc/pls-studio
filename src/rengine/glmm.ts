// Generalized linear mixed models (R/glmm.R): Poisson, negative binomial, zero-inflated and binomial
// outcomes with random intercepts and slopes, by adaptive Gauss-Hermite quadrature (GLMMadaptive).

import type { Dataset } from '../engine/types';
import { rCall, rScript, rStrings } from './bridge';
import { rColumns, rList } from './rjson';
import type { REngineInfo } from './lavaan';

export type GlmmFamily = 'poisson' | 'negbin' | 'zip' | 'zinb' | 'binomial';
export const GLMM_FAMILIES: readonly GlmmFamily[] = ['poisson', 'negbin', 'zip', 'zinb', 'binomial'];
export const zeroInflated = (f: GlmmFamily) => f === 'zip' || f === 'zinb';

/**
 * The model. Long data: one row per observation, `outcome` and `cluster` columns. Wide data: one row per
 * person, the outcome at each occasion in `occasions` with its time score in `times` (Mplus's growth models:
 * i s | u1@0 u2@1 ...): the predictors are "time" and time-invariant covariates.
 */
export interface GlmmInput {
  layout: 'long' | 'wide';
  outcome: string; cluster: string;
  occasions: string[]; times: number[];
  predictors: string[];
  /** Long data: predictors entered as categories (dummies against the first). */
  categorical: string[];
  /** Predictors with a random slope (wide data: "time" for a random slope of time). */
  slopes: string[];
  family: GlmmFamily;
  /** Zero-inflated families: predictors of the zero part (wide data may name "time"), and a random intercept in it. */
  ziPredictors: string[]; ziRandom: boolean;
  /** Binomial outcome in long data: the column with the number of trials (absent: a binary outcome). */
  trials?: string;
  /** Quadrature points per random effect (GLMMadaptive's nAGQ). */
  quadrature: number;
  /** Robust (sandwich) standard errors, as Mplus's MLR. */
  robust: boolean;
  /** 'mplus': Mplus's integration rule (adaptive rectangular, `quadrature` points per dimension) by the integration card's engine (rengine/glmmMplus.ts), wide data only; absent: GLMMadaptive. */
  integration?: 'mplus';
}

export interface GlmmCoef { term: string; est: number; se: number; z: number; p: number }
export interface GlmmResult {
  family: GlmmFamily; layout: 'long' | 'wide'; n: number; clusters: number; quadrature: number; robust: boolean;
  fixed: GlmmCoef[];
  /** Zero-inflated families: the zero part (logit of a structural zero). */
  zero?: GlmmCoef[];
  /** Variances (b absent) and covariances of the random effects; zeroA / zeroB: the effect is in the zero part. */
  random: { a: string; b?: string; zeroA: boolean; zeroB: boolean; est: number; se: number }[];
  /** Negative binomial: the log of the dispersion parameter θ (variance μ + μ²/θ). */
  logPhi?: { est: number; se: number };
  logLik: number; npar: number; aic: number; bic: number; converged: boolean;
  /** 'mplus': fitted with Mplus's integration rule (absent: GLMMadaptive). */
  integration?: 'mplus';
  warnings: string[]; engine: REngineInfo;
}


/** The columns the model reads. */
export const glmmColumns = (o: GlmmInput) => (o.layout === 'wide' ? [...o.occasions, ...o.predictors]
  : [o.outcome, o.cluster, ...o.predictors, ...(o.family === 'binomial' && o.trials ? [o.trials] : [])]);

export function glmmRequest(data: Dataset, o: GlmmInput) {
  const zi = zeroInflated(o.family);
  return {
    kind: 'glmm', layout: o.layout, family: o.family, predictors: o.predictors, slopes: o.slopes, quadrature: o.quadrature, robust: o.robust,
    ...(o.layout === 'wide' ? { occasions: o.occasions, times: o.times.length === o.occasions.length ? o.times : o.occasions.map((_, i) => i) }
      : { outcome: o.outcome, cluster: o.cluster, categorical: o.categorical.filter((c) => o.predictors.includes(c)), ...(o.family === 'binomial' && o.trials ? { trials: o.trials } : {}) }),
    ...(zi ? { ziPredictors: o.ziPredictors, ziRandom: o.ziRandom } : {}),
    data: rColumns(data, glmmColumns(o)),
  };
}

export async function glmmR(data: Dataset, o: GlmmInput): Promise<GlmmResult> {
  const raw = await rCall<Record<string, any>>('ps_glmm', glmmRequest(data, o), 'GLMMadaptive');
  return {
    ...raw, fixed: rList<GlmmCoef>(raw.fixed), ...(raw.zero != null ? { zero: rList<GlmmCoef>(raw.zero) } : {}),
    random: rList<any>(raw.random).map((x) => ({ ...x, ...(x.b == null ? { b: undefined } : {}) })),
    ...(raw.logPhi != null ? { logPhi: raw.logPhi } : {}), warnings: rStrings(raw.warnings),
  } as GlmmResult;
}
export const glmmScriptR = (data: Dataset, o: GlmmInput) => rScript('ps_glmm', glmmRequest(data, o), 'GLMMadaptive');
