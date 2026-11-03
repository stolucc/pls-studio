// For tests only: the checks the textbook examples share (Kline, Brown, Bollen, Bollen & Curran, EQS), recorded
// as validation evidence (record.ts): the fit against a native lavaan fixture, and every free estimate.

import { expect } from 'vitest';
import type { CbEstimate } from '../engine/cbsem';
import type { Dataset } from '../engine/types';
import { toSpec, type ModelState } from '../model/project';
import { near, same } from './record';

/**
 * What a built-in example is, for the evidence's staleness check: what is estimated (the model's specification,
 * by names: its constructs get new random ids each time it is made) and its data.
 */
export const builtinDefinition = (ex: { model: ModelState; data: Dataset }) => ({
  spec: toSpec(ex.model), data: { names: ex.data.names, moments: ex.data.moments ?? null, cols: ex.data.cols.map((c) => Array.from(c)) },
});

/** df exactly; χ², CFI and RMSEA to `digits` decimals. */
export function sameFit(fit: { df: number; chisq: number; cfi: number; rmsea: number }, want: { df: number; chisq: number; cfi: number; rmsea: number }, digits = 3) {
  same('df', fit.df, want.df);
  expect(fit.chisq, 'χ²').toBeCloseTo(want.chisq, digits);
  expect(fit.cfi, 'CFI').toBeCloseTo(want.cfi, digits);
  expect(fit.rmsea, 'RMSEA').toBeCloseTo(want.rmsea, digits);
}

type RefEstimate = { lhs: string; op: string; rhs: string; group?: number; est: number; se: number | null };

/**
 * Every free estimate of the reference (by group), within 1e-4 relative: loadings, paths, (co)variances (either
 * order), intercepts and means (by variable), defined parameters (by name). Fixed parameters the app does not
 * report are skipped. `name` maps the reference's names to the app's.
 */
export function sameEstimates(groups: { estimates: CbEstimate[] }[], want: RefEstimate[], name: (x: string) => string = (x) => x) {
  for (const w of want) {
    const g = groups[(w.group ?? 1) - 1];
    const pool = g.estimates.filter((e) => (e.op as string) === w.op && (w.op === ':=' || w.op === '~1'
      ? e.lhs === name(w.lhs)
      : (e.lhs === name(w.lhs) && e.rhs === name(w.rhs)) || (w.op === '~~' && e.lhs === name(w.rhs) && e.rhs === name(w.lhs))));
    if (!pool.length && (w.se === 0 || w.se === null)) continue;
    const label = `${w.lhs} ${w.op} ${w.rhs}${groups.length > 1 ? ` (group ${w.group ?? 1})` : ''}`;
    expect(pool.length, label).toBeGreaterThan(0);
    const best = pool.reduce((a, e) => (Math.abs(e.est - w.est) < Math.abs(a.est - w.est) ? e : a));
    near(label, best.est, w.est, 1e-4 * Math.max(1, Math.abs(w.est)));
  }
}

/** The estimate of `pool` closest to the reference, within `tolerance` (default 1e-4 relative), recorded. */
export function nearest(label: string, pool: { est: number }[], want: number, tolerance = 1e-4 * Math.max(1, Math.abs(want))) {
  const best = pool.reduce((a, e) => (Math.abs(e.est - want) < Math.abs(a.est - want) ? e : a));
  near(label, best.est, want, tolerance);
}
