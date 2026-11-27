// Time-varying effect models (R/longitudinal.R, ps_tvem; mgcv): an intercept and predictor effects that change
// smoothly with time, as the tvem package specifies them, with standard errors clustered by subject.

import type { Dataset } from '../engine/types';
import { rCall, rScript, rStrings } from './bridge';
import type { REngineInfo } from './lavaan';
import { rColumns, rList } from './rjson';

export interface TvemInput {
  outcome: string;
  time: string;
  /** The subject column ('' : each row its own cluster). */
  subject: string;
  varying: string[];
  /** Interior knots of each spline. */
  knots: number;
}

/** One coefficient over the grid of times: estimate, standard error and pointwise 95% interval. */
export interface TvemCurve {
  name: string;
  estimate: number[];
  se: number[];
  lower: number[];
  upper: number[];
}

export interface TvemResult {
  n: number;
  clusters: number;
  knots: number;
  grid: number[];
  /** The intercept first, then each predictor's effect. */
  curves: TvemCurve[];
  edf: number;
  warnings: string[];
  engine: REngineInfo;
}

export function tvemRequest(data: Dataset, i: TvemInput) {
  if (data.moments && data.cols.length === 0)
    throw new Error('A time-varying effect model needs raw data, not a covariance matrix.');
  const names = [i.outcome, i.time, ...i.varying, ...(i.subject ? [i.subject] : [])];
  for (const n of names)
    if (!data.names.includes(n)) throw new Error(`“${n}” is not a column of the dataset.`);
  return { ...i, data: rColumns(data, names) };
}

export function tvemResult(r: Record<string, any>): TvemResult {
  return {
    n: Number(r.n),
    clusters: Number(r.clusters),
    knots: Number(r.knots),
    grid: rList<number>(r.grid),
    curves: rList<Record<string, any>>(r.curves).map((c) => ({
      name: String(c.name),
      estimate: rList<number>(c.estimate),
      se: rList<number>(c.se),
      lower: rList<number>(c.lower),
      upper: rList<number>(c.upper),
    })),
    edf: Number(r.edf),
    warnings: rStrings(r.warnings),
    engine: r.engine,
  };
}

export async function tvemR(data: Dataset, i: TvemInput): Promise<TvemResult> {
  return tvemResult(await rCall<Record<string, any>>('ps_tvem', tvemRequest(data, i), 'mgcv'));
}

export const tvemScriptR = (data: Dataset, i: TvemInput) =>
  rScript('ps_tvem', tvemRequest(data, i), 'mgcv');
