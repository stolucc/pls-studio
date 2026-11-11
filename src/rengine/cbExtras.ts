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

/** The sample statistics of one group, as lavaan fits the model to them (lavaan's variable names). */
export interface DataSummaryGroup {
  label: string;
  n: number;
  variables: string[];
  ordinal: boolean[];
  /** Descriptives of the analysed cases on the variables' own scale (category codes for ordinal ones). */
  valid: number[];
  mean: number[];
  sd: number[];
  /** Correlations: Pearson, or polychoric / polyserial with ordinal indicators (the matrix lavaan fits). */
  cor: number[][];
  /** Continuous indicators: covariances (divisor N − 1) and means. */
  cov?: number[][];
  means?: number[];
  /** Ordinal indicators: thresholds, NACOV (N × the asymptotic covariance of the statistics), weights. */
  thresholds?: { variable: string[]; index: number[]; value: number[] };
  nacovNames?: string[];
  nacov?: number[][];
  wlsV?: number[][];
}

/** What a data summary for secondary analysis holds (R/lavaan.R ps_cb_data_summary). */
export interface DataSummaryResult {
  groups: DataSummaryGroup[];
  /** lavaan's names of the constructs and indicators, and the app's. */
  names: { lavaan: string[]; app: string[] };
  /** The lavaan model syntax, one line each. */
  syntax: string[];
  /** The lavaan call that refits the model from the statistics. */
  refitCall: string;
  /** Script lines after the refit call (Mplus's WLSMV standard errors, as the model's). */
  refitAfter: string[];
  refitEstimator: string;
  /** The estimator chosen (lavaan reports MLR, for one, as ML with robust corrections). */
  requestedEstimator: string;
  estimator: string;
  missing: string;
  meanstructure: boolean;
  /** The estimates from the raw data, to check a refit against. */
  estimates: { lhs: string[]; op: string[]; rhs: string[]; group: number[]; est: number[]; se: (number | null)[] };
  chisq: number;
  df: number;
  warnings: string[];
  engine: REngineInfo;
}

const numbers = (v: unknown) => rList<unknown>(v).map((x) => (typeof x === 'number' ? x : NaN));
const matrix = (v: unknown) => rList<unknown>(v).map(numbers);

function parseSummaryGroup(g: any): DataSummaryGroup {
  const out: DataSummaryGroup = {
    label: String(g.label ?? ''),
    n: g.n,
    variables: rList<string>(g.variables),
    ordinal: rList<boolean>(g.ordinal),
    valid: numbers(g.valid),
    mean: numbers(g.mean),
    sd: numbers(g.sd),
    cor: matrix(g.cor),
  };
  if (g.cov) out.cov = matrix(g.cov);
  if (g.means) out.means = numbers(g.means);
  if (g.thresholds) {
    out.thresholds = {
      variable: rList<string>(g.thresholds.variable),
      index: numbers(g.thresholds.index),
      value: numbers(g.thresholds.value),
    };
  }
  if (g.nacov) {
    out.nacovNames = rList<string>(g.nacovNames);
    out.nacov = matrix(g.nacov);
    out.wlsV = matrix(g.wlsV);
  }
  return out;
}

/** The data summary of the CB-SEM model on the canvas (sample statistics, no raw data). */
export async function dataSummaryR(c: CbCall): Promise<DataSummaryResult> {
  const r = await rCall<Record<string, any>>('ps_cb_data_summary', cbCallRequest(c, {}), 'lavaan');
  const e = r.estimates ?? {};
  return {
    groups: rList<any>(r.groups).map(parseSummaryGroup),
    names: { lavaan: rList<string>(r.names?.lavaan), app: rList<string>(r.names?.app) },
    syntax: rList<string>(r.syntax),
    refitCall: String(r.refitCall),
    refitAfter: rList<string>(r.refitAfter),
    refitEstimator: String(r.refitEstimator),
    requestedEstimator: String(r.requestedEstimator),
    estimator: String(r.estimator),
    missing: String(r.missing),
    meanstructure: r.meanstructure === true,
    estimates: {
      lhs: rList<string>(e.lhs),
      op: rList<string>(e.op),
      rhs: rList<string>(e.rhs),
      group: numbers(e.group),
      est: numbers(e.est),
      se: rList<unknown>(e.se).map(rNum),
    },
    chisq: r.chisq,
    df: r.df,
    warnings: rStrings(r.warnings),
    engine: r.engine,
  };
}

/** The R script that computes the data summary. */
export const dataSummaryScriptR = (c: CbCall) => rScript('ps_cb_data_summary', cbCallRequest(c, {}), 'lavaan');
