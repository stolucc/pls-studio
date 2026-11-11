// Descriptives / Explore (R/explore.R): descriptive statistics by group, frequency
// tables and normality tests (base R; nortest for Lilliefors and Anderson-Darling).

import type { Dataset } from '../engine/types';
import { rCall, rScript, rStrings, type RPackage } from './bridge';
import { rColumns, rList, rNum } from './rjson';
import type { REngineInfo } from './lavaan';

export interface ExploreInput {
  /** Numeric variables to describe. */
  vars: string[];
  /** Variables (any type) for frequency tables. */
  frequencies: string[];
  /** The grouping column ('' for none). */
  group: string;
  /** Extra percentiles, between 0 and 100. */
  percentiles: number[];
  /** R's quantile type: 7 (R, JASP) or 6 (SPSS's weighted average). */
  quantileType: 6 | 7;
  normality: boolean;
  confidence: number;
}

/** The descriptives of one variable in one group (null where they need more values). */
export interface ExploreStats {
  variable: string;
  group: string;
  n: number;
  missing: number;
  mean: number | null;
  sd: number | null;
  se: number | null;
  ciLow: number | null;
  ciHigh: number | null;
  median: number | null;
  q1: number | null;
  q3: number | null;
  iqr: number | null;
  percentiles: (number | null)[];
  min: number | null;
  max: number | null;
  range: number | null;
  skewness: number | null;
  seSkewness: number | null;
  kurtosis: number | null;
  seKurtosis: number | null;
  cv: number | null;
  /** The smallest of the most frequent values; `modes`: how many values share that count. */
  mode: number | null;
  modes: number;
}

export interface ExploreTest {
  stat: number;
  p: number;
}

export interface ExploreNormality {
  variable: string;
  group: string;
  n: number;
  shapiro: ExploreTest | null;
  lilliefors: ExploreTest | null;
  anderson: ExploreTest | null;
}

export interface ExploreFrequencies {
  variable: string;
  group: string;
  levels: string[];
  counts: number[];
  percent: number[];
  validPercent: number[];
  cumulative: number[];
  missing: number;
  total: number;
}

export interface ExploreResult {
  vars: string[];
  frequencyVars: string[];
  group: string;
  /** The groups' labels (none without a grouping variable: one group, "All"). */
  groups: string[];
  /** Rows left out because their group is missing. */
  droppedRows: number;
  quantileType: 6 | 7;
  percentiles: number[];
  confidence: number;
  stats: ExploreStats[];
  normality: ExploreNormality[];
  frequencies: ExploreFrequencies[];
  warnings: string[];
  engine: REngineInfo;
}

/** The R package of a run: nortest when it tests normality, base R otherwise. */
export const explorePackage = (i: ExploreInput): RPackage => (i.normality ? 'nortest' : 'stats');

/** The request: the named columns (missing values as null) and the category names of text columns. */
export function exploreRequest(data: Dataset, i: ExploreInput) {
  if (data.moments && data.cols.length === 0) {
    throw new Error('Descriptives need raw data; the dataset is a covariance matrix.');
  }
  const names = [...new Set([...i.vars, ...i.frequencies, i.group].filter(Boolean))];
  for (const n of names) {
    if (!data.names.includes(n)) throw new Error(`“${n}” is not a column of the dataset.`);
  }
  const categories = Object.fromEntries(
    names.filter((c) => data.categories?.[c]).map((c) => [c, data.categories![c]]),
  );
  return { ...i, categories, data: rColumns(data, names) };
}

const test = (v: unknown): ExploreTest | null => {
  if (!v || typeof v !== 'object') return null;
  const t = v as Record<string, unknown>;
  return { stat: rNum(t.stat) ?? NaN, p: rNum(t.p) ?? NaN };
};
const nums = (v: unknown) => rList<unknown>(v).map((x) => rNum(x) ?? NaN);
const numOrNull = (v: unknown) => rNum(v);

/** One row of descriptives from R (absent fields, for an empty group, as null). */
function statsRow(x: Record<string, unknown>): ExploreStats {
  const f = (k: string) => numOrNull(x[k]);
  return {
    variable: String(x.variable),
    group: String(x.group),
    n: rNum(x.n) ?? 0,
    missing: rNum(x.missing) ?? 0,
    mean: f('mean'),
    sd: f('sd'),
    se: f('se'),
    ciLow: f('ciLow'),
    ciHigh: f('ciHigh'),
    median: f('median'),
    q1: f('q1'),
    q3: f('q3'),
    iqr: f('iqr'),
    percentiles: rList<unknown>(x.percentiles).map(numOrNull),
    min: f('min'),
    max: f('max'),
    range: f('range'),
    skewness: f('skewness'),
    seSkewness: f('seSkewness'),
    kurtosis: f('kurtosis'),
    seKurtosis: f('seKurtosis'),
    cv: f('cv'),
    mode: f('mode'),
    modes: rNum(x.modes) ?? 0,
  };
}

/** Run the descriptives in R. */
export async function exploreR(data: Dataset, i: ExploreInput): Promise<ExploreResult> {
  const r = await rCall<Record<string, any>>(
    'ps_explore',
    exploreRequest(data, i),
    explorePackage(i),
  );
  return {
    vars: rStrings(r.vars),
    frequencyVars: rStrings(r.frequencyVars),
    group: String(r.group ?? ''),
    groups: rStrings(r.groups),
    droppedRows: rNum(r.droppedRows) ?? 0,
    quantileType: r.quantileType === 6 ? 6 : 7,
    percentiles: nums(r.percentiles),
    confidence: rNum(r.confidence) ?? i.confidence,
    stats: rList<Record<string, unknown>>(r.stats).map(statsRow),
    normality: rList<Record<string, unknown>>(r.normality).map((x) => ({
      variable: String(x.variable),
      group: String(x.group),
      n: rNum(x.n) ?? 0,
      shapiro: test(x.shapiro),
      lilliefors: test(x.lilliefors),
      anderson: test(x.anderson),
    })),
    frequencies: rList<Record<string, unknown>>(r.frequencies).map((x) => ({
      variable: String(x.variable),
      group: String(x.group),
      levels: rStrings(x.levels),
      counts: nums(x.counts),
      percent: nums(x.percent),
      validPercent: nums(x.validPercent),
      cumulative: nums(x.cumulative),
      missing: rNum(x.missing) ?? 0,
      total: rNum(x.total) ?? 0,
    })),
    warnings: rStrings(r.warnings),
    engine: r.engine as REngineInfo,
  };
}

/** The R script of a run. */
export const exploreScriptR = (data: Dataset, i: ExploreInput) =>
  rScript('ps_explore', exploreRequest(data, i), explorePackage(i));
