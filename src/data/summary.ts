import { mean, quantileSorted, sd } from '../engine/stats';

export interface ColumnSummary {
  n: number;
  missing: number;
  mean: number;
  sd: number;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  /** Number of different values (a hint at categorical or Likert items). */
  distinct: number;
  /** Sample skewness and excess kurtosis (moment estimators, as in e1071 type 1 / psych::describe type 1). */
  skew: number;
  kurtosis: number;
}

/** Descriptive statistics of one data column; NaN marks missing values. */
export function columnSummary(col: ArrayLike<number>): ColumnSummary {
  const x = Array.from(col).filter((v) => !Number.isNaN(v));
  const n = x.length;
  const sorted = Float64Array.from(x).sort();
  const m = n ? mean(x) : NaN;
  let m2 = 0,
    m3 = 0,
    m4 = 0;
  for (const v of x) {
    const d = v - m;
    m2 += d * d;
    m3 += d * d * d;
    m4 += d * d * d * d;
  }
  m2 /= n;
  m3 /= n;
  m4 /= n;
  return {
    n,
    missing: col.length - n,
    mean: m,
    sd: n > 1 ? sd(x) : NaN,
    min: n ? sorted[0] : NaN,
    q1: n ? quantileSorted(sorted, 0.25) : NaN,
    median: n ? quantileSorted(sorted, 0.5) : NaN,
    q3: n ? quantileSorted(sorted, 0.75) : NaN,
    max: n ? sorted[n - 1] : NaN,
    distinct: new Set(x).size,
    skew: n > 2 && m2 > 0 ? m3 / m2 ** 1.5 : NaN,
    kurtosis: n > 3 && m2 > 0 ? m4 / (m2 * m2) - 3 : NaN,
  };
}
