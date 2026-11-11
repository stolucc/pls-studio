// The numbers behind the chart card: histogram bins, box-plot statistics,
// an OLS fit for a scatterplot and category counts. Pure functions over the
// dataset's columns; missing values are left out.

import type { Dataset } from '../engine/types';
import { mean, qnorm, quantileSorted, sd } from '../engine/stats';

export interface HistogramBin {
  from: number;
  to: number;
  count: number;
}
export interface BoxStats {
  label: string;
  n: number;
  lo: number;
  q1: number;
  median: number;
  q3: number;
  hi: number;
  outliers: number[];
}

const finite = (col: ArrayLike<number>) => Array.from(col).filter((v) => Number.isFinite(v));

/** Equal-width bins; `bins` 0 picks Sturges' number. The last bin includes its upper edge. */
export function histogram(
  col: ArrayLike<number>,
  bins = 0,
): { bins: HistogramBin[]; n: number; mean: number; sd: number } {
  const v = finite(col);
  const n = v.length;
  if (n === 0) return { bins: [], n: 0, mean: NaN, sd: NaN };
  const m = mean(v);
  const s = n > 1 ? sd(v) : 0;
  let lo = Infinity;
  let hi = -Infinity;
  for (const x of v) {
    if (x < lo) lo = x;
    if (x > hi) hi = x;
  }
  const k = bins > 0 ? Math.min(200, Math.round(bins)) : Math.max(1, Math.ceil(Math.log2(n) + 1));
  if (hi === lo) return { bins: [{ from: lo, to: hi, count: n }], n, mean: m, sd: s };
  const step = niceStep((hi - lo) / k);
  const start = Math.floor(lo / step) * step;
  const count = Math.max(1, Math.ceil((hi - start) / step - 1e-9)); // (a maximum on an edge falls into the last bin, which is closed)
  const out: HistogramBin[] = Array.from({ length: count }, (_, i) => ({
    from: start + i * step,
    to: start + (i + 1) * step,
    count: 0,
  }));
  for (const x of v) {
    let i = Math.floor((x - start) / step);
    if (i >= count) i = count - 1;
    out[i].count++;
  }
  return { bins: out, n, mean: m, sd: s };
}

/** A round bin width (1, 2, 2.5, 5 × 10^k) at or above the raw width. */
export function niceStep(raw: number): number {
  if (!(raw > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  const mantissa = [1, 2, 2.5, 5].find((m) => f <= m) ?? 10;
  return mantissa * p;
}

/** Quantile by linear interpolation (R's type 7) of sorted values: the engine's. */

/** Tukey box: quartiles, whiskers to the last value within 1.5 IQR, the rest outliers. */
export function boxStats(col: ArrayLike<number>, label: string): BoxStats | null {
  const v = finite(col).sort((a, b) => a - b);
  if (!v.length) return null;
  const q1 = quantileSorted(v, 0.25);
  const median = quantileSorted(v, 0.5);
  const q3 = quantileSorted(v, 0.75);
  const iqr = q3 - q1;
  const inside = v.filter((x) => x >= q1 - 1.5 * iqr && x <= q3 + 1.5 * iqr);
  return {
    label,
    n: v.length,
    lo: inside[0],
    q1,
    median,
    q3,
    hi: inside[inside.length - 1],
    outliers: v.filter((x) => x < q1 - 1.5 * iqr || x > q3 + 1.5 * iqr),
  };
}

/** Ordinary least squares y on x over complete pairs. */
export function olsLine(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
): { slope: number; intercept: number; r: number; n: number } | null {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < x.length; i++)
    if (Number.isFinite(x[i]) && Number.isFinite(y[i])) {
      xs.push(x[i]);
      ys.push(y[i]);
    }
  const n = xs.length;
  if (n < 3) return null;
  const mx = mean(xs);
  const my = mean(ys);
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx, r: syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN, n };
}

/** The distinct values of a column as group labels (category names when it is a text column), at most `max`. */
export function groupsOf(
  data: Dataset,
  name: string,
  max = 30,
): { label: string; value: number }[] | null {
  const j = data.names.indexOf(name);
  if (j < 0) return null;
  const levels = data.categories?.[name];
  const values = [...new Set(finite(data.cols[j]))].sort((a, b) => a - b);
  if (values.length > max) return null;
  return values.map((value) => ({
    value,
    label: levels ? (levels[value - 1] ?? String(value)) : String(value),
  }));
}

/** Counts per group, in the groups' order. */
export function counts(
  data: Dataset,
  name: string,
  max = 30,
): { label: string; count: number }[] | null {
  const groups = groupsOf(data, name, max);
  if (!groups) return null;
  const col = data.cols[data.names.indexOf(name)];
  return groups.map((g) => ({
    label: g.label,
    count: Array.from(col).filter((v) => v === g.value).length,
  }));
}

/** R's bw.nrd0: Silverman's rule of thumb, 0.9 min(SD, IQR / 1.34) n^(-1/5), with R's fallbacks. */
export function bandwidthNrd0(col: ArrayLike<number>): number {
  const v = finite(col).sort((a, b) => a - b);
  const n = v.length;
  if (n < 2) return NaN;
  const iqr = quantileSorted(v, 0.75) - quantileSorted(v, 0.25);
  let lo = Math.min(sd(v), iqr / 1.34);
  // (R: a zero spread falls back to the SD, then |x[1]|, then 1)
  if (!(lo > 0)) lo = sd(v);
  if (!(lo > 0)) lo = Math.abs(v[0]);
  if (!(lo > 0)) lo = 1;
  return 0.9 * lo * n ** -0.2;
}

/**
 * A Gaussian kernel density estimate with R's default bandwidth (bw.nrd0), evaluated exactly at `points` points
 * from 3 bandwidths below the minimum to 3 above the maximum (R's density() range; R bins the data first, so its
 * curve differs from this exact one in the third decimal or so).
 */
export function kernelDensity(col: ArrayLike<number>, points = 128): { x: number; y: number }[] {
  const v = finite(col);
  const n = v.length;
  const bw = bandwidthNrd0(v);
  if (!(bw > 0)) return [];
  let lo = Infinity;
  let hi = -Infinity;
  for (const x of v) {
    if (x < lo) lo = x;
    if (x > hi) hi = x;
  }
  const from = lo - 3 * bw;
  const to = hi + 3 * bw;
  const norm = 1 / (n * bw * Math.sqrt(2 * Math.PI));
  return Array.from({ length: points }, (_, i) => {
    const x = from + ((to - from) * i) / (points - 1);
    let s = 0;
    for (const xi of v) {
      const z = (x - xi) / bw;
      s += Math.exp(-0.5 * z * z);
    }
    return { x, y: s * norm };
  });
}

/** A normal Q-Q plot as R's qqnorm and qqline draw it. */
export interface QQPlot {
  /** Theoretical normal quantiles, qnorm(ppoints(n)), with the sorted sample. */
  points: { theoretical: number; sample: number }[];
  /** qqline: the line through the first and third quartiles (type 7). */
  intercept: number;
  slope: number;
}

/** The normal Q-Q plot of a column (missing values left out); null with fewer than 3 values. */
export function qqPlot(col: ArrayLike<number>): QQPlot | null {
  const v = finite(col).sort((a, b) => a - b);
  const n = v.length;
  if (n < 3) return null;
  // ppoints: (i - a) / (n + 1 - 2a), a = 3/8 up to 10 values, 1/2 beyond
  const a = n <= 10 ? 3 / 8 : 1 / 2;
  const points = v.map((sample, i) => ({
    theoretical: qnorm((i + 1 - a) / (n + 1 - 2 * a)),
    sample,
  }));
  const z1 = qnorm(0.25);
  const z3 = qnorm(0.75);
  const slope = (quantileSorted(v, 0.75) - quantileSorted(v, 0.25)) / (z3 - z1);
  return { points, intercept: quantileSorted(v, 0.25) - slope * z1, slope };
}
