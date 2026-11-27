// Tests of the independencies a path model implies (R/partial.R, ps_dsep, base R): the basis set's claims from
// model/dsep.ts, each by the t test of the partial correlation, and Shipley's Fisher's C.

import type { Dataset } from '../engine/types';
import type { DsepClaim } from '../model/dsep';
import { rCall, rScript, rStrings } from './bridge';
import type { REngineInfo } from './lavaan';
import { rColumns, rList } from './rjson';

export interface DsepInput {
  /** The model's variables (data columns): complete cases on all of them. */
  variables: string[];
  claims: DsepClaim[];
}

export interface DsepTest extends DsepClaim {
  /** The partial correlation, its t test and Fisher-z 95% interval, and the Holm-adjusted p. */
  r: number;
  t: number;
  df: number;
  p: number;
  lower: number;
  upper: number;
  holm: number;
}

export interface DsepResult {
  n: number;
  claims: DsepTest[];
  fisherC: number;
  fisherDf: number;
  fisherP: number;
  warnings: string[];
  engine: REngineInfo;
}

export function dsepRequest(data: Dataset, i: DsepInput) {
  if (data.moments && data.cols.length === 0)
    throw new Error('The tests of implied independencies need raw data, not a covariance matrix.');
  return { ...i, data: rColumns(data, i.variables) };
}

export function dsepResult(r: Record<string, any>): DsepResult {
  return {
    n: Number(r.n),
    claims: rList<Record<string, any>>(r.claims).map((c) => ({
      x: String(c.x),
      y: String(c.y),
      given: rList<string>(c.given),
      r: Number(c.r),
      t: Number(c.t),
      df: Number(c.df),
      p: Number(c.p),
      lower: Number(c.lower),
      upper: Number(c.upper),
      holm: Number(c.holm),
    })),
    fisherC: Number(r.fisherC),
    fisherDf: Number(r.fisherDf),
    fisherP: Number(r.fisherP),
    warnings: rStrings(r.warnings),
    engine: r.engine,
  };
}

export async function dsepR(data: Dataset, i: DsepInput): Promise<DsepResult> {
  return dsepResult(await rCall<Record<string, any>>('ps_dsep', dsepRequest(data, i), 'stats'));
}

export const dsepScriptR = (data: Dataset, i: DsepInput) =>
  rScript('ps_dsep', dsepRequest(data, i), 'stats');
