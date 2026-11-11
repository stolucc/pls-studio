// Data screening rules of thumb, kept apart from the panel so they are tested.

import { quantileSorted } from '../engine/stats';

/**
 * Univariate non-normality (West, Finch & Curran 1995; Kline 2016): |skew| > 2
 * or |excess kurtosis| > 7 is severe; above 1 / 3 moderate.
 */
export function normalityLevel(skew: number, kurtosis: number): 'ok' | 'moderate' | 'severe' {
  if (Math.abs(skew) > 2 || Math.abs(kurtosis) > 7) return 'severe';
  if (Math.abs(skew) > 1 || Math.abs(kurtosis) > 3) return 'moderate';
  return 'ok';
}

/** Cases whose Mahalanobis p is below alpha, most extreme first. */
export function flaggedCases(
  cases: { rows: number[]; d2: number[]; p: number[] },
  alpha: number,
): { row: number; d2: number; p: number }[] {
  return cases.rows
    .map((row, i) => ({ row, d2: cases.d2[i], p: cases.p[i] }))
    .filter((c) => c.p < alpha)
    .sort((a, b) => b.d2 - a.d2);
}

/** Quantile (type 7, as R's default) of sorted values. */

/**
 * The extreme upper fence Q3 + 3 IQR of a statistic (Tukey's "far out"):
 * generalized Cook's distance has no cutoff in SEM (Pek & MacCallum 2011
 * advise inspecting it), so cases standing far out from the rest are flagged.
 */
export function farOut(values: number[]): number {
  const s = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (s.length < 4) return Infinity;
  const q1 = quantileSorted(s, 0.25),
    q3 = quantileSorted(s, 0.75);
  return q3 + 3 * (q3 - q1);
}

/** The most influential cases by generalized Cook's distance, flagged when far out from the rest. */
export function influentialCases(
  r: { rows: number[]; gcd: number[] },
  top = 10,
): { row: number; gcd: number; flagged: boolean }[] {
  const fence = farOut(r.gcd);
  return r.rows
    .map((row, i) => ({ row, gcd: r.gcd[i], flagged: r.gcd[i] > fence }))
    .sort((a, b) => b.gcd - a.gcd)
    .slice(0, top);
}

/**
 * Mardia's test verdict and what to do: multivariate normality is rejected when
 * either the skewness or the kurtosis test is significant; robust (MLR) or
 * bootstrap standard errors are then advised for ML estimation.
 */
export function mardiaVerdict(
  m: { pSkew: number; pSmall: number; pKurt: number; n: number },
  alpha = 0.05,
): { normal: boolean; skewP: number; text: string } {
  // Mardia's small-sample correction for the skewness test below n = 20 (psych's p.small).
  const skewP = m.n < 20 ? m.pSmall : m.pSkew;
  const normal = skewP >= alpha && m.pKurt >= alpha;
  // (the tests that reject it: skewness, kurtosis or both)
  const rejected: string[] = [];
  if (skewP < alpha) rejected.push('skewness');
  if (m.pKurt < alpha) rejected.push('kurtosis');
  return {
    normal,
    skewP,
    text: normal
      ? 'Multivariate normality is not rejected: maximum likelihood is appropriate.'
      : `Multivariate normality is rejected (${rejected.join(' and ')}): use robust ML (MLR) or bootstrap standard errors in CB-SEM.`,
  };
}

/** The case statistics of the influence card's index plot. */
export type InfluenceStat = 'gcd' | 'md' | 'chisq' | 'cfi' | 'rmsea' | 'kurtosis';
type InfluenceLike = {
  rows: number[];
  gcd: number[];
  md: number[];
  chisq: number[];
  cfi: number[];
  rmsea: number[];
  kurtosis?: { rows: number[]; contribution: number[] };
};
/**
 * One statistic per case for the index plot (cases without a value left out), with the far-out fence for the
 * statistics where large means unusual (generalized Cook's distance, Mahalanobis distance, kurtosis contribution);
 * the fit changes are signed and have none.
 */
export function influenceSeries(
  r: InfluenceLike,
  stat: InfluenceStat,
): { rows: number[]; values: number[]; fence: number | null } {
  const [rows, vals] =
    stat === 'kurtosis'
      ? [r.kurtosis?.rows ?? [], r.kurtosis?.contribution ?? []]
      : [r.rows, r[stat]];
  const keep = rows.map((_, i) => i).filter((i) => Number.isFinite(vals[i]));
  const values = keep.map((i) => vals[i]);
  return {
    rows: keep.map((i) => rows[i]),
    values,
    fence: stat === 'gcd' || stat === 'md' || stat === 'kurtosis' ? farOut(values) : null,
  };
}

/**
 * The cases contributing most to Mardia's multivariate kurtosis b₂,ₚ = Σ dᵢ⁴ / n: each case's share of it, and how
 * many times its contribution exceeds a case's expected one under normality, p(p + 2) / n (Mardia 1970).
 */
export function kurtosisCases(
  k: { rows: number[]; contribution: number[]; b2p: number; p: number },
  top = 10,
): { row: number; contribution: number; share: number; ratio: number }[] {
  const expected = (k.p * (k.p + 2)) / k.rows.length;
  return k.rows
    .map((row, i) => ({
      row,
      contribution: k.contribution[i],
      share: k.contribution[i] / k.b2p,
      ratio: k.contribution[i] / expected,
    }))
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, top);
}
