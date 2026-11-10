// CB-SEM extras of the model on the canvas (R/lavaan.R): the Bollen-Stine
// bootstrap p of the chi-square test, pairwise parameter comparisons (AMOS's
// critical ratios for differences) and factor score weights.

import type { CbEstimator } from '../engine/cbsem';
import type { Dataset, MissingTreatment, ModelSpec } from '../engine/types';
import { rCall, rScript, rStrings } from './bridge';
import { rList, rNum } from './rjson';
import { cbRequest, type LatentInteraction, type REngineInfo } from './lavaan';

export interface CbCall { data: Dataset; spec: ModelSpec; missing: MissingTreatment; estimator: CbEstimator; interaction: LatentInteraction }
/** The request for the CB-SEM model on the canvas as the Model tab fits it, plus the analysis's own fields. */
export const cbCallRequest = <E extends object>(c: CbCall, extra: E) => ({ ...cbRequest(c.data, c.spec, c.missing, c.estimator, c.interaction), ...extra });

export interface BollenStineResult { chisq: number; df: number; p: number; mlChisq: number; samples: number; valid: number | null; boot: number[]; warnings: string[]; engine: REngineInfo }
export async function bollenStineR(c: CbCall, boot: { samples: number; seed: number }): Promise<BollenStineResult> {
  const r = await rCall<Record<string, any>>('ps_cb_bollen_stine', cbCallRequest(c, { boot }), 'lavaan');
  return { chisq: r.chisq, df: r.df, p: r.p, mlChisq: r.mlChisq, samples: r.samples, valid: rNum(r.valid), boot: rList<number>(r.boot).filter((x) => typeof x === 'number'), warnings: rStrings(r.warnings), engine: r.engine };
}
export const bollenStineScriptR = (c: CbCall, boot: { samples: number; seed: number }) => rScript('ps_cb_bollen_stine', cbCallRequest(c, { boot }), 'lavaan');

export type ParamKind = 'paths' | 'loadings' | 'variances' | 'covariances';
export interface CompareParamsResult { params: { label: string; est: number; kind: string }[]; z: (number | null)[][]; warnings: string[]; engine: REngineInfo }
export async function compareParamsR(c: CbCall, kinds: ParamKind[]): Promise<CompareParamsResult> {
  const r = await rCall<Record<string, any>>('ps_cb_compare_params', cbCallRequest(c, { kinds }), 'lavaan');
  return { params: rList<CompareParamsResult['params'][number]>(r.params), z: rList<unknown>(r.z).map((row) => rList<unknown>(row).map(rNum)), warnings: rStrings(r.warnings), engine: r.engine };
}
export const compareParamsScriptR = (c: CbCall, kinds: ParamKind[]) => rScript('ps_cb_compare_params', cbCallRequest(c, { kinds }), 'lavaan');

export type ScoreMethod = 'regression' | 'Bartlett';
export interface ScoreWeightsResult { method: ScoreMethod; factors: string[]; variables: string[]; weights: number[][]; warnings: string[]; engine: REngineInfo }
export async function scoreWeightsR(c: CbCall, method: ScoreMethod): Promise<ScoreWeightsResult> {
  const r = await rCall<Record<string, any>>('ps_cb_score_weights', cbCallRequest(c, { method }), 'lavaan');
  return { method: r.method, factors: rList<string>(r.factors), variables: rList<string>(r.variables), weights: rList<unknown>(r.weights).map((row) => rList<number>(row)), warnings: rStrings(r.warnings), engine: r.engine };
}
export const scoreWeightsScriptR = (c: CbCall, method: ScoreMethod) => rScript('ps_cb_score_weights', cbCallRequest(c, { method }), 'lavaan');
