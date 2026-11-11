// Shared by the Mplus chapter tests of the multilevel regression card (random slopes, levels, wide data):
// the example's data with its computed columns, its card's request, and the comparison of every parameter
// Mplus prints with its place in the card's output (a fixed effect or a variance component).

import { expect } from 'vitest';
import { computeColumn } from '../../data/compute';
import type { Dataset } from '../../engine/types';
import type { DataInfo } from '../../model/project';
import { lmmR, type LmmInput, type LmmResult } from '../../rengine/mixed';
import { near, same } from '../../validation/record';
import { example, load, MPLUS, type Printed } from './testkit';

/** The example's data with its computed columns (Mplus's DEFINE / CENTER), as opening it gives. */
export function exampleData(key: string): Dataset {
  let d = load(key);
  let info: DataInfo = {
    fileName: example(key).data.file!,
    rows: d.cols[0].length,
    missingCells: 0,
    excluded: [],
  };
  for (const k of example(key).computed ?? [])
    ({ data: d, info } = computeColumn(d, info, k.name, k.expr));
  return d;
}
/** The card's options as the example opens it. */
export function lmmPanel(key: string): LmmInput {
  const p = example(key).panel;
  if (p?.kind !== 'lmm') throw new Error(`${key} has no multilevel regression card`);
  const { kind: _k, ...input } = p;
  return input;
}
/** Where a parameter Mplus prints sits in the card's output: a fixed effect, or a variance component (b: the covariance's other term). */
export type Where = { fixed: string } | { group: string; a: string | null; b?: string };
export const levelOf = (p: Printed) =>
  p.block.split(' ')[p.block.startsWith('Between') ? 1 : 0].toLowerCase();

/**
 * Every free parameter Mplus prints (standard error above 0), at its place in the card's output, within `tol`
 * (estimates) and `seTol` (standard errors); `wide`: the parameters with a stated larger difference.
 */
export function samePrintedLmm(
  key: string,
  r: LmmResult,
  where: (p: Printed) => Where,
  opts: {
    tol?: number;
    seTol?: number;
    wide?: (p: Printed) => { tol: number; seTol: number } | null;
  } = {},
) {
  for (const p of MPLUS[key].estimates) {
    if (p.se === 0) continue;
    const w = where(p);
    const label = `${levelOf(p)} ${p.lhs} ${p.op} ${p.rhs}`.trim();
    const hit =
      'fixed' in w
        ? r.fixed.find((f) => f.term === w.fixed) && {
            est: r.fixed.find((f) => f.term === w.fixed)!.est,
            se: r.fixed.find((f) => f.term === w.fixed)!.se,
          }
        : r.random
            .filter(
              (v) =>
                v.group === w.group &&
                ((v.a === w.a && (v.b ?? undefined) === w.b) ||
                  (w.b !== undefined && v.a === w.b && v.b === w.a)),
            )
            .map((v) => ({ est: v.variance, se: v.se ?? NaN }))[0];
    expect(hit, `${key}: ${label} is not in the card's output`).toBeDefined();
    const t = opts.wide?.(p) ?? { tol: opts.tol ?? 0.001, seTol: opts.seTol ?? 0.001 };
    near(label, hit!.est, p.est, t.tol);
    near(`SE of ${label}`, hit!.se, p.se, t.seTol);
  }
}

/** The card's run of the example, and its fit against Mplus's (`logl`: the tolerance of the log-likelihood, AIC and BIC). */
export async function runLmm(key: string, logl = 0.002) {
  const r = await lmmR(exampleData(key), lmmPanel(key));
  expect(r.reml).toBe(false);
  expect(r.robust).toBe(true);
  const want = MPLUS[key].fit;
  same('free parameters', r.npar!, want.npar!);
  near('log-likelihood', r.logLik, want.logl!, logl);
  near('AIC', r.aic, want.aic!, 2 * logl);
  near('BIC', r.bic, want.bic!, 2 * logl);
  return r;
}
