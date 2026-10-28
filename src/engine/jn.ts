// Johnson–Neyman analysis for a latent interaction in CB-SEM: the
// conditional effect of X on Y at moderator value m is θ(m) = γ_X + γ_XM·m,
// with Var θ(m) = Var γ_X + 2m Cov(γ_X, γ_XM) + m² Var γ_XM from the
// parameter covariance matrix. The region of significance is where
// |θ(m)| / SE(m) ≥ z_crit; its boundaries solve a quadratic in m.

import type { CbModeration, CbResult } from './cbsem';
import { zCrit } from './stats';

export { zCrit };

export interface JohnsonNeyman {
  /** Moderator values are in the latent moderator's own (marker) units; sdM converts to SD units. */
  sdM: number;
  crit: number;
  bx: number;
  bint: number;
  effect: (m: number) => number;
  se: (m: number) => number;
  /** Real roots of the boundary equation, ascending (0, 1 or 2). */
  boundaries: number[];
  significantAt: (m: number) => boolean;
}

export function johnsonNeyman(cb: CbResult, mo: CbModeration, alpha = 0.05): JohnsonNeyman {
  if (!cb.vcov) throw new Error('Johnson–Neyman needs standard errors, which are unavailable for this model.');
  const name = cb.constructs[mo.construct];
  const find = (rhs: string) => cb.estimates.find((e) => e.op === '~' && e.lhs === mo.to && e.rhs === rhs);
  const ex = find(mo.from), ei = find(name);
  const vm = cb.estimates.find((e) => e.op === '~~' && e.lhs === mo.moderator && e.rhs === mo.moderator);
  if (ex?.index === undefined || ei?.index === undefined || !vm) throw new Error('Interaction parameters not found.');
  const V = cb.vcov;
  const vx = V[ex.index][ex.index], vi = V[ei.index][ei.index], c = V[ex.index][ei.index];
  const bx = ex.est, bint = ei.est;
  const crit = zCrit(alpha);
  const effect = (m: number) => bx + bint * m;
  const se = (m: number) => Math.sqrt(Math.max(vx + 2 * m * c + m * m * vi, 0));
  const z2 = crit * crit;
  const A = bint * bint - z2 * vi, B = 2 * (bx * bint - z2 * c), C = bx * bx - z2 * vx;
  let boundaries: number[] = [];
  if (Math.abs(A) < 1e-14) {
    if (Math.abs(B) > 1e-14) boundaries = [-C / B];
  } else {
    const disc = B * B - 4 * A * C;
    if (disc >= 0) boundaries = [(-B - Math.sqrt(disc)) / (2 * A), (-B + Math.sqrt(disc)) / (2 * A)].sort((a, b) => a - b);
  }
  return {
    sdM: Math.sqrt(vm.est), crit, bx, bint, effect, se, boundaries,
    significantAt: (m) => Math.abs(effect(m)) / se(m) >= crit,
  };
}
