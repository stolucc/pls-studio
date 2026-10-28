// Importance–performance map analysis (Ringle & Sarstedt 2016).
//
// Performance: indicators are rescaled to 0–100 (optional), standardised PLS
// weights are unstandardised (w / sd(x̃)) and normalised to sum to one per
// construct, and a construct's performance is the mean of the resulting
// scores. Importance: the unstandardised total effect on the target,
// β_std · sd(score_target) / sd(score_predictor). Matches cSEM's doIPMA().

import { preparePls } from './pls';
import { mean, sd } from './stats';
import type { Dataset, ModelSpec, PlsOptions } from './types';
import { DEFAULT_OPTIONS } from './types';

export interface IpmaOptions {
  target: string;
  /** Rescale indicators to 0–100 before computing performance. */
  rescale: boolean;
  /** Theoretical scale bounds for all indicators; observed min/max when omitted. */
  min?: number;
  max?: number;
}

export interface IpmaPoint { name: string; importance: number; performance: number }

export interface IpmaResult {
  target: string;
  targetPerformance: number;
  /** Every construct other than the target (importance 0 if it has no effect on it). */
  constructs: IpmaPoint[];
  /** Every indicator; those of the target carry their normalised weight as importance (as cSEM). */
  indicators: (IpmaPoint & { construct: string; weight: number })[];
  /** Indicators with negative weights, which make IPMA questionable. */
  negativeWeights: string[];
}

export function ipma(data: Dataset, spec: ModelSpec, options: Partial<PlsOptions>, io: IpmaOptions): IpmaResult {
  if (spec.moderations?.length) throw new Error('IPMA is not defined for models with interaction terms.');
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const prep = preparePls(data, spec, opts);
  const { m, core, st } = prep.estimate(prep.cols);
  const T = m.constructs.indexOf(io.target);
  if (T < 0) throw new Error(`Unknown target construct "${io.target}".`);

  const scaled = prep.cols.map((col) => {
    if (!io.rescale) return col;
    let lo = io.min ?? Infinity, hi = io.max ?? -Infinity;
    if (io.min === undefined || io.max === undefined) {
      for (const v of col) { if (io.min === undefined) lo = Math.min(lo, v); if (io.max === undefined) hi = Math.max(hi, v); }
    }
    if (!(hi > lo)) throw new Error('Scale maximum must exceed the minimum.');
    return col.map((v) => ((v - lo) / (hi - lo)) * 100);
  });

  const wUnstd = m.indicatorNames.map((_, k) => core.w[k] / sd(scaled[k]));
  const wNorm = wUnstd.slice();
  m.blocks.forEach((b) => {
    const sum = b.reduce((s, k) => s + wUnstd[k], 0);
    b.forEach((k) => (wNorm[k] = wUnstd[k] / sum));
  });
  const n = scaled[0].length;
  const scores = m.blocks.map((b) => {
    const y = new Float64Array(n);
    for (const k of b) for (let r = 0; r < n; r++) y[r] += wNorm[k] * scaled[k][r];
    return y;
  });
  const sds = scores.map((y) => sd(y));
  const perf = scores.map((y) => mean(y));
  const importanceOf = (j: number) => (j === T ? 1 : st.totalEffects[j][T] * (sds[T] / sds[j]));

  return {
    target: io.target,
    targetPerformance: perf[T],
    constructs: m.constructs.flatMap((name, j) => (j === T ? [] : [{ name, importance: importanceOf(j), performance: perf[j] }])),
    indicators: m.indicatorNames.map((name, k) => {
      const j = m.indicatorConstruct[k];
      return { name, construct: m.constructs[j], weight: wNorm[k], importance: wNorm[k] * importanceOf(j), performance: mean(scaled[k]) };
    }),
    negativeWeights: m.indicatorNames.filter((_, k) => wNorm[k] < 0),
  };
}
