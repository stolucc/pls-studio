// ROC analysis (R/roc.R): pROC's ROC curve, AUC with DeLong or bootstrap intervals, optimal cut-points, partial AUC
// and DeLong's test comparing two curves (paired predictors, or one predictor in two groups).

import type { Dataset } from '../engine/types';
import { rCall, rScript, rStrings } from './bridge';
import { rColumns, rList } from './rjson';
import type { REngineInfo } from './lavaan';

export interface RocInput {
  response: string;
  /** The value of the outcome that marks a case (null: the higher of its two values). */
  positive: number | null;
  /** The predictor: a data column, or the fitted probabilities of a logistic regression on `predictors`. */
  source: 'column' | 'logistic';
  predictor: string;
  predictors: string[];
  /** Which values mark cases: auto (pROC decides by the medians), higher (<) or lower (>). */
  direction: 'auto' | '<' | '>';
  ciMethod: 'delong' | 'bootstrap';
  bootN: number;
  cutpoint: 'youden' | 'closest.topleft';
  compare: 'none' | 'paired' | 'groups';
  predictor2: string;
  group: string;
  pauc: { focus: 'specificity' | 'sensitivity'; from: number; to: number; correct: boolean } | null;
  seed: number;
  confidence: number;
}

export interface RocPoints {
  /** 1 − specificity and sensitivity, along the curve. */
  fpr: number[];
  tpr: number[];
}
export interface RocCut {
  threshold: number;
  sensitivity: number;
  specificity: number;
  ppv: number;
  npv: number;
  accuracy: number;
  /** Youden's J = sensitivity + specificity − 1. */
  youden: number;
}
export interface RocResult {
  n: number;
  cases: number;
  controls: number;
  /** The outcome's values: controls, then cases. */
  levels: number[];
  direction: '<' | '>';
  auc: number;
  aucSe: number;
  aucCi: { low: number; high: number };
  ciMethod: 'delong' | 'bootstrap';
  curve: RocPoints;
  best: RocCut[];
  cutpoint: 'youden' | 'closest.topleft';
  logistic?: { term: string; est: number; se: number; z: number; p: number }[];
  partial?: { value: number; ciLow: number | null; ciHigh: number | null };
  comparison?: {
    type: 'paired' | 'groups';
    statistic: number;
    df: number | null;
    p: number;
    aucs: number[];
    ciLow: number | null;
    ciHigh: number | null;
    groups: number[] | null;
    curves: RocPoints[];
  };
  warnings: string[];
  engine: REngineInfo;
}

/** Every data column the analysis reads. */
export function rocColumns(i: RocInput): string[] {
  const predictors = i.source === 'column' ? [i.predictor] : i.predictors;
  return [
    ...new Set(
      [
        i.response,
        ...predictors,
        i.compare === 'paired' ? i.predictor2 : '',
        i.compare === 'groups' ? i.group : '',
      ].filter(Boolean),
    ),
  ];
}

export function rocRequest(data: Dataset, i: RocInput) {
  if (data.moments && data.cols.length === 0)
    throw new Error('ROC analysis needs raw data; this dataset is a covariance matrix.');
  return {
    kind: 'roc',
    response: i.response,
    ...(i.positive !== null ? { positive: i.positive } : {}),
    source: i.source,
    predictor: i.source === 'column' ? i.predictor : '',
    predictors: i.source === 'logistic' ? i.predictors : [],
    direction: i.direction,
    ciMethod: i.ciMethod,
    bootN: i.bootN,
    cutpoint: i.cutpoint,
    compare: i.compare,
    predictor2: i.compare === 'paired' ? i.predictor2 : '',
    group: i.compare === 'groups' ? i.group : '',
    ...(i.pauc ? { pauc: i.pauc } : {}),
    seed: i.seed,
    confidence: i.confidence,
    data: rColumns(data, rocColumns(i)),
  };
}

const points = (p: { fpr: unknown; tpr: unknown }): RocPoints => ({
  fpr: rList(p.fpr),
  tpr: rList(p.tpr),
});

export async function rocR(data: Dataset, input: RocInput): Promise<RocResult> {
  const raw = await rCall<Record<string, any>>('ps_roc', rocRequest(data, input), 'pROC');
  const comparison = raw.comparison
    ? {
        ...raw.comparison,
        df: raw.comparison.df ?? null,
        ciLow: raw.comparison.ciLow ?? null,
        ciHigh: raw.comparison.ciHigh ?? null,
        aucs: rList(raw.comparison.aucs),
        groups: raw.comparison.groups ? rList(raw.comparison.groups) : null,
        curves: rList<{ fpr: unknown; tpr: unknown }>(raw.comparison.curves).map(points),
      }
    : undefined;
  return {
    ...raw,
    levels: rList(raw.levels),
    curve: points(raw.curve),
    best: rList(raw.best),
    ...(raw.logistic ? { logistic: rList(raw.logistic) } : {}),
    ...(raw.partial
      ? {
          partial: {
            value: raw.partial.value,
            ciLow: raw.partial.ciLow ?? null,
            ciHigh: raw.partial.ciHigh ?? null,
          },
        }
      : {}),
    ...(comparison ? { comparison } : {}),
    warnings: rStrings(raw.warnings),
  } as RocResult;
}

export const rocScriptR = (data: Dataset, input: RocInput) =>
  rScript('ps_roc', rocRequest(data, input), 'pROC');
