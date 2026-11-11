// Kaplan–Meier survival (R/survival.R, the survival package): survfit's estimates with pointwise intervals, median
// survival, numbers at risk, and survdiff's log-rank and Peto & Peto tests between groups.

import type { Dataset } from '../engine/types';
import { rCall, rScript, rStrings } from './bridge';
import type { REngineInfo } from './lavaan';
import { rColumns, rList } from './rjson';

export type KmConfType = 'log' | 'log-log' | 'plain';

export interface KmInput {
  time: string;
  status: string;
  /** 1 = censored (Mplus's TIMECENSORED); otherwise 1 = event. */
  statusCensored?: boolean;
  /** Optional: one curve per group, and tests between them. */
  group: string;
  confidence: number;
  confType: KmConfType;
  /** The risk table's times; none: a pretty grid from 0 to the longest time. */
  riskTimes: number[];
}

/** One group's curve: survfit's steps (at every distinct time, events and censorings) and its summary. */
export interface KmStratum {
  name: string;
  n: number;
  events: number;
  /** Median survival and its interval (null when the curve does not fall to 0.5, or the bound is not reached). */
  median: number | null;
  medianLow: number | null;
  medianHigh: number | null;
  time: number[];
  surv: number[];
  lower: (number | null)[];
  upper: (number | null)[];
  nRisk: number[];
  nEvent: number[];
  nCensor: number[];
  /** Numbers at risk at the risk table's times. */
  riskAt: number[];
}

/** A survdiff test: χ², df, p and each group's observed and expected (weighted) events. */
export interface KmTest {
  chisq: number;
  df: number;
  p: number;
  observed: number[];
  expected: number[];
}

export interface KmResult {
  confidence: number;
  confType: KmConfType;
  n: number;
  strata: KmStratum[];
  riskTimes: number[];
  logrank: KmTest | null;
  peto: KmTest | null;
  warnings: string[];
  engine: REngineInfo & { desktop?: string };
}

/** The request: the three columns (with the group's category labels) and the options. */
export function kmRequest(data: Dataset, i: KmInput) {
  if (data.moments && data.cols.length === 0)
    throw new Error('Kaplan–Meier needs raw data; this dataset is a covariance matrix.');
  const names = [...new Set([i.time, i.status, i.group].filter(Boolean))];
  for (const n of names)
    if (!data.names.includes(n)) throw new Error(`“${n}” is not a column of the dataset.`);
  const categories = Object.fromEntries(
    names.filter((c) => data.categories?.[c]).map((c) => [c, data.categories![c]]),
  );
  return { ...i, categories, data: rColumns(data, names) };
}

const nums = (v: unknown) => rList<unknown>(v).map(Number);
const maybe = (v: unknown) => rList<unknown>(v).map((x) => (x === null ? null : Number(x)));
const numOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function kmTest(t: unknown): KmTest | null {
  if (!t || typeof t !== 'object' || Array.isArray(t)) return null;
  const r = t as Record<string, unknown>;
  return {
    chisq: Number(r.chisq),
    df: Number(r.df),
    p: Number(r.p),
    observed: nums(r.observed),
    expected: nums(r.expected),
  };
}

/** The reply as the card reads it. */
export function kmResult(r: Record<string, any>): KmResult {
  return {
    confidence: Number(r.confidence),
    confType: r.confType,
    n: Number(r.n),
    strata: rList<Record<string, unknown>>(r.strata).map((s) => ({
      name: String(s.name),
      n: Number(s.n),
      events: Number(s.events),
      median: numOrNull(s.median),
      medianLow: numOrNull(s.medianLow),
      medianHigh: numOrNull(s.medianHigh),
      time: nums(s.time),
      surv: nums(s.surv),
      lower: maybe(s.lower),
      upper: maybe(s.upper),
      nRisk: nums(s.nRisk),
      nEvent: nums(s.nEvent),
      nCensor: nums(s.nCensor),
      riskAt: nums(s.riskAt),
    })),
    riskTimes: nums(r.riskTimes),
    logrank: kmTest(r.logrank),
    peto: kmTest(r.peto),
    warnings: rStrings(r.warnings),
    engine: r.engine,
  };
}

/** Run the Kaplan–Meier analysis in R (survival). */
export async function kmR(data: Dataset, i: KmInput): Promise<KmResult> {
  return kmResult(await rCall<Record<string, any>>('ps_km', kmRequest(data, i), 'survival'));
}

/** The self-contained R script of the analysis. */
export const kmScriptR = (data: Dataset, i: KmInput) =>
  rScript('ps_km', kmRequest(data, i), 'survival');
