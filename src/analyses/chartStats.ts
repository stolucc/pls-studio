// The numbers behind the chart card: histogram bins, box-plot statistics,
// an OLS fit for a scatterplot and category counts. Pure functions over the
// dataset's columns; missing values are left out.

import type { Dataset } from '../engine/types';
import { quantileSorted } from '../engine/stats';

export interface HistogramBin { from: number; to: number; count: number }
export interface BoxStats { label: string; n: number; lo: number; q1: number; median: number; q3: number; hi: number; outliers: number[] }

const finite = (col: ArrayLike<number>) => Array.from(col).filter((v) => Number.isFinite(v));

/** Equal-width bins; `bins` 0 picks Sturges' number. The last bin includes its upper edge. */
export function histogram(col: ArrayLike<number>, bins = 0): { bins: HistogramBin[]; n: number; mean: number; sd: number } {
  const v = finite(col);
  const n = v.length;
  if (n === 0) return { bins: [], n: 0, mean: NaN, sd: NaN };
  const mean = v.reduce((s, x) => s + x, 0) / n;
  const sd = n > 1 ? Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1)) : 0;
  let lo = Infinity, hi = -Infinity;
  for (const x of v) { if (x < lo) lo = x; if (x > hi) hi = x; }
  const k = bins > 0 ? Math.min(200, Math.round(bins)) : Math.max(1, Math.ceil(Math.log2(n) + 1));
  if (hi === lo) return { bins: [{ from: lo, to: hi, count: n }], n, mean, sd };
  const step = niceStep((hi - lo) / k);
  const start = Math.floor(lo / step) * step;
  const count = Math.max(1, Math.ceil((hi - start) / step - 1e-9));  // (a maximum on an edge falls into the last bin, which is closed)
  const out: HistogramBin[] = Array.from({ length: count }, (_, i) => ({ from: start + i * step, to: start + (i + 1) * step, count: 0 }));
  for (const x of v) { let i = Math.floor((x - start) / step); if (i >= count) i = count - 1; out[i].count++; }
  return { bins: out, n, mean, sd };
}

/** A round bin width (1, 2, 2.5, 5 × 10^k) at or above the raw width. */
export function niceStep(raw: number): number {
  if (!(raw > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

/** Quantile by linear interpolation (R's type 7) of sorted values: the engine's. */
export const quantile = (sorted: number[], q: number): number => quantileSorted(sorted, q);

/** Tukey box: quartiles, whiskers to the last value within 1.5 IQR, the rest outliers. */
export function boxStats(col: ArrayLike<number>, label: string): BoxStats | null {
  const v = finite(col).sort((a, b) => a - b);
  if (!v.length) return null;
  const q1 = quantile(v, 0.25), median = quantile(v, 0.5), q3 = quantile(v, 0.75), iqr = q3 - q1;
  const inside = v.filter((x) => x >= q1 - 1.5 * iqr && x <= q3 + 1.5 * iqr);
  return { label, n: v.length, lo: inside[0], q1, median, q3, hi: inside[inside.length - 1], outliers: v.filter((x) => x < q1 - 1.5 * iqr || x > q3 + 1.5 * iqr) };
}

/** Ordinary least squares y on x over complete pairs. */
export function olsLine(x: ArrayLike<number>, y: ArrayLike<number>): { slope: number; intercept: number; r: number; n: number } | null {
  const xs: number[] = [], ys: number[] = [];
  for (let i = 0; i < x.length; i++) if (Number.isFinite(x[i]) && Number.isFinite(y[i])) { xs.push(x[i]); ys.push(y[i]); }
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((s, v) => s + v, 0) / n, my = ys.reduce((s, v) => s + v, 0) / n;
  let sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; sxy += (xs[i] - mx) * (ys[i] - my); }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx, r: syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN, n };
}

/** The distinct values of a column as group labels (category names when it is a text column), at most `max`. */
export function groupsOf(data: Dataset, name: string, max = 30): { label: string; value: number }[] | null {
  const j = data.names.indexOf(name);
  if (j < 0) return null;
  const levels = data.categories?.[name];
  const values = [...new Set(finite(data.cols[j]))].sort((a, b) => a - b);
  if (values.length > max) return null;
  return values.map((value) => ({ value, label: levels ? levels[value - 1] ?? String(value) : String(value) }));
}

/** Counts per group, in the groups' order. */
export function counts(data: Dataset, name: string, max = 30): { label: string; count: number }[] | null {
  const groups = groupsOf(data, name, max);
  if (!groups) return null;
  const col = data.cols[data.names.indexOf(name)];
  return groups.map((g) => ({ label: g.label, count: Array.from(col).filter((v) => v === g.value).length }));
}
