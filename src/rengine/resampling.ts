// Robust, bootstrap and permutation alternatives (R/robust.R: WRS2, boot, coin) on the t-test,
// ANOVA, correlation and regression cards: the options they send and the results they get back.

/** What a card computes besides its classical tests. */
export interface ResamplingOptions {
  /** Trimmed means: Yuen's tests, robust ANOVA (WRS2). */
  trimmed: boolean;
  /** The proportion trimmed from each end (0 to below 0.5). */
  trim: number;
  /** Bootstrap intervals, percentile and BCa (boot). */
  bootstrap: boolean;
  /** Permutation tests, Monte Carlo (coin). */
  permutation: boolean;
  /** Bootstrap and permutation resamples. */
  resamples: number;
}
export const RESAMPLING_DEFAULTS: ResamplingOptions = {
  trimmed: false,
  trim: 0.2,
  bootstrap: false,
  permutation: false,
  resamples: 5000,
};

/** A bootstrap interval: the estimate, the bootstrap SE, the percentile and BCa limits. */
export interface BootInterval {
  estimate: number;
  se: number;
  percLow: number;
  percHigh: number;
  bcaLow: number;
  bcaHigh: number;
}
/** A trimmed-means t-test (Yuen; one sample: Tukey–McLaughlin); `effsize`: WRS2's explanatory measure. */
export interface TrimmedTest {
  estimate: number;
  se: number;
  t: number;
  df: number;
  p: number;
  ciLow: number;
  ciHigh: number;
  effsize?: number | null;
}
/** A Monte Carlo permutation test: the standardised statistic and its p-value. */
export interface PermutationTest {
  z: number;
  p: number;
}
/** What R echoes of the options: the trimming, the resamples, the seed. */
export interface ResamplingEcho {
  trim?: number;
  resamples: number;
  seed: number;
}

/** The request's `resampling` field: the options and the project's seed; nothing when none is on. */
export function resamplingField(
  o: ResamplingOptions | null | undefined,
  seed: number,
): { resampling?: ResamplingOptions & { seed: number } } {
  if (!o || (!o.trimmed && !o.bootstrap && !o.permutation)) return {};
  return { resampling: { ...o, seed } };
}

/** An object of R's JSON, or null. */
export const rObj = <T>(v: unknown): T | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as T) : null;
