// Monte Carlo confidence intervals for indirect effects (Preacher & Selig
// 2012): draw the regression coefficients from their asymptotic normal
// distribution N(θ̂, V̂), compute the (unstandardised) indirect effects for
// each draw, and take percentile limits. Validated against
// semTools::monteCarloCI.

import type { CbResult } from './cbsem';
import { cholesky, invert, zeros } from './linalg';
import { quantileSorted } from './stats';
import { normalRng } from './population';

export interface McIndirect {
  from: string;
  to: string;
  est: number;
  /** SD of the Monte Carlo draws. */
  se: number;
  ciLow: number;
  ciHigh: number;
}

/** Total indirect effects (T − B, T = (I − B)⁻¹ − I) from B[to][from]. */
function indirectOf(B: number[][]): number[][] {
  const A = invert(B.map((r, i) => r.map((v, j) => (i === j ? 1 : 0) - v)));
  return A.map((r, i) => r.map((v, j) => v - (i === j ? 1 : 0) - B[i][j]));
}

export function mcIndirect(cb: CbResult, draws = 20000, seed = 1, confidence = 0.95): McIndirect[] {
  if (!cb.vcov) throw new Error('Monte Carlo CIs need the parameter covariance matrix, which is unavailable.');
  const C = cb.constructs;
  const J = C.length;
  const regs = cb.estimates.filter((e) => e.op === '~' && e.index !== undefined);
  const k = regs.length;
  const pos = regs.map((e) => [C.indexOf(e.lhs), C.indexOf(e.rhs)] as const);
  const B0 = zeros(J, J);
  regs.forEach((e, a) => (B0[pos[a][0]][pos[a][1]] = e.est));
  const ind0 = indirectOf(B0);
  const pairs: [number, number][] = [];
  for (let t = 0; t < J; t++) for (let f = 0; f < J; f++) if (f !== t && Math.abs(ind0[t][f]) > 1e-12) pairs.push([t, f]);
  if (pairs.length === 0) return [];

  const V = regs.map((a) => regs.map((b) => cb.vcov![a.index!][b.index!]));
  const L = cholesky(V);
  if (!L) throw new Error('The covariance matrix of the regression coefficients is not positive definite.');
  const rnd = normalRng(seed);
  const samples = pairs.map(() => new Float64Array(draws));
  const z = new Float64Array(k);
  const B = zeros(J, J);
  for (let d = 0; d < draws; d++) {
    for (let a = 0; a < k; a++) z[a] = rnd();
    for (let a = 0; a < k; a++) {
      let s = regs[a].est;
      for (let b = 0; b <= a; b++) s += L[a][b] * z[b];
      B[pos[a][0]][pos[a][1]] = s;
    }
    const ind = indirectOf(B);
    pairs.forEach(([t, f], p) => (samples[p][d] = ind[t][f]));
  }
  const alpha = (1 - confidence) / 2;
  return pairs.map(([t, f], p) => {
    const v = samples[p];
    const m = v.reduce((s, x) => s + x, 0) / draws;
    const se = Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (draws - 1));
    const sorted = Float64Array.from(v).sort();
    return { from: C[f], to: C[t], est: ind0[t][f], se, ciLow: quantileSorted(sorted, alpha), ciHigh: quantileSorted(sorted, 1 - alpha) };
  });
}
