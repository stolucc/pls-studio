// Bootstrap inference in a simulation, as the studies of PLS inference do it
// (Rönkkö, McIntosh & Antonakis 2015; Aguirre-Urreta & Rönkkö 2018): several
// tests from the same bootstrap draws of a replication, after an optional
// sign-change correction of the draws.
//
// Sign-change corrections (Tenenhaus et al. 2005; Hair et al. 2014):
// - individual: every draw of an estimate takes the sign of the original
//   estimate, |θ*| · sign(θ̂);
// - construct: a draw's composite is flipped when its weights are closer to
//   minus the original weights (Σ|ŵ − w*| > Σ|ŵ + w*|); an effect between two
//   constructs then changes sign when exactly one of them was flipped, which is
//   what re-estimating with the flipped composite gives (cSEM's
//   construct_reestimate).
//
// Tests of H0: θ = 0, two-sided at α (R/mc.R computes the same):
// - t: θ̂ / SE*, SE* the standard deviation of the draws, on n − 1 df (Hair et al.);
// - normal: θ̂ − bias* ± z · SE* (bias* = mean of the draws − θ̂; boot's "norm");
// - basic: [2θ̂ − q(1 − α/2), 2θ̂ − q(α/2)];
// - percentile: [q(α/2), q(1 − α/2)];
// - BCa: percentile levels shifted by z0 and the jackknife acceleration (bootstrap.ts summarise).
// An interval test rejects when its interval excludes 0.

import { summarise } from './bootstrap';
import { bootQuantile, tTestP, zCrit } from './stats';

export type McSignChange = 'none' | 'individual' | 'construct';
export type McInterval = 'percentile' | 'normal' | 'basic' | 'bca';

export interface McInference {
  signChange: McSignChange;
  /** The interval coverage and width are reported for (and BCa computed at all: it needs the jackknife). */
  interval: McInterval;
}

export const DEFAULT_INFERENCE: McInference = { signChange: 'none', interval: 'percentile' };

export const MC_TESTS = ['t', 'normal', 'basic', 'percentile', 'bca'] as const;
export type McTest = (typeof MC_TESTS)[number];

export const MC_TEST_LABELS: Record<McTest, string> = {
  t: 't test (n − 1 df)',
  normal: 'Normal CI',
  basic: 'Basic CI',
  percentile: 'Percentile CI',
  bca: 'BCa CI',
};

/**
 * The construct flips of each draw (+1 / −1) by the construct-level rule, from the draws and originals of
 * the indicator weights (keys weight:<indicator>).
 */
export function constructFlips(
  blocks: { construct: string; indicators: string[] }[],
  keys: string[],
  originals: number[],
  draws: Float64Array[],
): Map<string, Int8Array> {
  const count = draws[0]?.length ?? 0;
  const flips = new Map<string, Int8Array>();
  for (const b of blocks) {
    const idx = b.indicators.map((name) => keys.indexOf(`weight:${name}`)).filter((i) => i >= 0);
    const s = new Int8Array(count).fill(1);
    for (let k = 0; k < count; k++) {
      let same = 0;
      let opposite = 0;
      for (const i of idx) {
        same += Math.abs(originals[i] - draws[i][k]);
        opposite += Math.abs(originals[i] + draws[i][k]);
      }
      if (same > opposite) s[k] = -1;
    }
    flips.set(b.construct, s);
  }
  return flips;
}

/** A parameter's draws after the correction (from / to: the constructs the effect links). */
export function correctedDraws(
  draws: Float64Array,
  original: number,
  mode: McSignChange,
  link?: { from: Int8Array; to: Int8Array },
): number[] {
  const v = Array.from(draws);
  if (mode === 'individual') return v.map((x) => Math.abs(x) * Math.sign(original));
  if (mode === 'construct' && link) return v.map((x, k) => x * link.from[k] * link.to[k]);
  return v;
}

export interface McTestResult {
  /** Rejection (1) or not (0) per test; NaN where it cannot be computed. */
  reject: Record<McTest, number>;
  /** The intervals of the interval tests. */
  ci: Record<Exclude<McTest, 't'>, [number, number]>;
}

/** Every test from one parameter's (corrected) draws; jack: its jackknife estimates, for BCa. */
export function bootTests(
  draws: number[],
  original: number,
  alpha: number,
  n: number,
  jack?: number[],
): McTestResult {
  const v = draws.filter(Number.isFinite);
  const nan: [number, number] = [NaN, NaN];
  const none = {
    reject: { t: NaN, normal: NaN, basic: NaN, percentile: NaN, bca: NaN },
    ci: { normal: nan, basic: nan, percentile: nan, bca: nan },
  };
  if (v.length < 2) return none;
  const mean = v.reduce((s, x) => s + x, 0) / v.length;
  const se = Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / (v.length - 1));
  const sorted = Float64Array.from(v).sort();
  const q = (p: number) => bootQuantile(sorted, p);
  const z = zCrit(alpha);
  const bias = mean - original;
  const ci: McTestResult['ci'] = {
    normal: [original - bias - z * se, original - bias + z * se],
    basic: [2 * original - q(1 - alpha / 2), 2 * original - q(alpha / 2)],
    percentile: [q(alpha / 2), q(1 - alpha / 2)],
    bca: nan,
  };
  if (jack && jack.some(Number.isFinite)) {
    const b = summarise(v, original, 1 - alpha, 2, jack);
    ci.bca = [b.ciLow, b.ciHigh];
  }
  const excludes0 = ([lo, hi]: [number, number]) =>
    Number.isFinite(lo) && Number.isFinite(hi) ? (lo > 0 || hi < 0 ? 1 : 0) : NaN;
  const t = se > 0 ? (tTestP(original / se, n - 1) < alpha ? 1 : 0) : NaN;
  return {
    reject: {
      t,
      normal: excludes0(ci.normal),
      basic: excludes0(ci.basic),
      percentile: excludes0(ci.percentile),
      bca: excludes0(ci.bca),
    },
    ci,
  };
}
