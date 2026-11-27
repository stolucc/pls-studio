// Dominance analysis of a linear regression (R/partial.R, ps_dominance, base R): the R² of every subset of the
// predictors, and from them conditional, general and complete dominance (Budescu 1993; Azen & Budescu 2003).

import type { Dataset } from '../engine/types';
import { rCall, rScript, rStrings } from './bridge';
import type { REngineInfo } from './lavaan';
import { rColumns, rList } from './rjson';

export interface DominanceInput {
  outcome: string;
  predictors: string[];
  /** The loss of R² that defines the fungible weights (Waller 2008). */
  loss: number;
}

export interface DominanceResult {
  outcome: string;
  predictors: string[];
  n: number;
  /** R² of the full model. */
  r2: number;
  /** General dominance per predictor (sums to r2). */
  general: number[];
  /** Per predictor, its average increment over the subsets of the others of size 0, 1, …, k − 1. */
  conditional: number[][];
  /** [i][j]: the share of the subsets of the other predictors to which i adds more than j (null on the diagonal). */
  complete: (number | null)[][];
  /** Standardised coefficients of the full model, and each predictor's R² alone (r²). */
  beta: number[];
  r2Alone: number[];
  /** The range of each standardised weight over the fungible weights: R² lower by `loss`, correlation r with the OLS composite. */
  fungible: { loss: number; r: number; lower: number[]; upper: number[] };
  warnings: string[];
  engine: REngineInfo;
}

/** The request: the outcome's and the predictors' data. */
export function dominanceRequest(data: Dataset, i: DominanceInput) {
  if (data.moments && data.cols.length === 0)
    throw new Error('Dominance analysis needs raw data; this dataset is a covariance matrix.');
  const names = [i.outcome, ...i.predictors];
  for (const n of names)
    if (!data.names.includes(n)) throw new Error(`“${n}” is not a column of the dataset.`);
  return { ...i, data: rColumns(data, names) };
}

const nums = (v: unknown) => rList<number | null>(v).map((x) => (typeof x === 'number' ? x : null));

/** The reply as the card reads it. */
export function dominanceResult(r: Record<string, any>): DominanceResult {
  return {
    outcome: String(r.outcome),
    predictors: rList<string>(r.predictors),
    n: Number(r.n),
    r2: Number(r.r2),
    general: rList<number>(r.general),
    conditional: rList<unknown>(r.conditional).map((row) => nums(row) as number[]),
    complete: rList<unknown>(r.complete).map(nums),
    beta: rList<number>(r.beta),
    r2Alone: rList<number>(r.r2Alone),
    fungible: {
      loss: Number(r.fungible.loss),
      r: Number(r.fungible.r),
      lower: rList<number>(r.fungible.lower),
      upper: rList<number>(r.fungible.upper),
    },
    warnings: rStrings(r.warnings),
    engine: r.engine,
  };
}

/** Run the dominance analysis in R. */
export async function dominanceR(data: Dataset, i: DominanceInput): Promise<DominanceResult> {
  return dominanceResult(
    await rCall<Record<string, any>>('ps_dominance', dominanceRequest(data, i), 'stats'),
  );
}

/** The self-contained R script of the analysis. */
export const dominanceScriptR = (data: Dataset, i: DominanceInput) =>
  rScript('ps_dominance', dominanceRequest(data, i), 'stats');
