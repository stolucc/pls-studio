// Partial and semi-partial correlations (R/partial.R, ppcor): each pair of variables controlling for chosen
// variables, or for all the other variables of the set.

import type { Dataset } from '../engine/types';
import { rCall, rScript, rStrings } from './bridge';
import type { REngineInfo } from './lavaan';
import { rColumns, rList } from './rjson';

export const PCOR_METHODS = ['pearson', 'spearman', 'kendall'] as const;
export type PcorMethod = (typeof PCOR_METHODS)[number];

export interface PcorInput {
  vars: string[];
  /** Controlled for in every pair; none: each pair controls for the other variables. */
  controls: string[];
  method: PcorMethod;
}

/** A correlation with its test statistic (t, or z for Kendall) and p value. */
export interface PcorTest {
  r: number;
  stat: number;
  p: number;
}

export interface PcorPair {
  a: string;
  b: string;
  /** What the pair is controlled for. */
  given: string[];
  n: number;
  gp: number;
  partial: PcorTest;
  /** Semi-partial: a with b adjusted for the controls; and b with a adjusted. */
  semiAB: PcorTest;
  semiBA: PcorTest;
}

export interface PcorResult {
  method: PcorMethod;
  vars: string[];
  controls: string[];
  n: number;
  pairs: PcorPair[];
  warnings: string[];
  engine: REngineInfo & { desktop?: string };
}

/** The request: the chosen columns' data (the card offers numeric columns only). */
export function pcorRequest(data: Dataset, i: PcorInput) {
  if (data.moments && data.cols.length === 0)
    throw new Error('Partial correlations need raw data; this dataset is a covariance matrix.');
  const names = [...new Set([...i.vars, ...i.controls])];
  for (const n of names)
    if (!data.names.includes(n)) throw new Error(`“${n}” is not a column of the dataset.`);
  return { ...i, data: rColumns(data, names) };
}

const test = (t: Record<string, unknown>): PcorTest => ({
  r: Number(t.r),
  stat: Number(t.stat),
  p: Number(t.p),
});

/** The reply as the card reads it. */
export function pcorResult(r: Record<string, any>): PcorResult {
  return {
    method: r.method,
    vars: rList<string>(r.vars),
    controls: rList<string>(r.controls),
    n: Number(r.n),
    pairs: rList<Record<string, any>>(r.pairs).map((p) => ({
      a: String(p.a),
      b: String(p.b),
      given: rList<string>(p.given),
      n: Number(p.n),
      gp: Number(p.gp),
      partial: test(p.partial),
      semiAB: test(p.semiAB),
      semiBA: test(p.semiBA),
    })),
    warnings: rStrings(r.warnings),
    engine: r.engine,
  };
}

/** Run the partial correlations in R (ppcor). */
export async function pcorR(data: Dataset, i: PcorInput): Promise<PcorResult> {
  return pcorResult(await rCall<Record<string, any>>('ps_pcor', pcorRequest(data, i), 'ppcor'));
}

/** The self-contained R script of the analysis. */
export const pcorScriptR = (data: Dataset, i: PcorInput) =>
  rScript('ps_pcor', pcorRequest(data, i), 'ppcor');
