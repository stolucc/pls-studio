// PLSc solutions outside the admissible region: ρA not in (0, 1] or a
// disattenuated correlation beyond ±1. The main estimate stops (ρA ≤ 0, where
// the corrections do not exist) or warns; the bootstrap drops such draws, as
// cSEM does by default, and reports them among the failed ones.

import { describe, expect, it } from 'vitest';
import { bootstrapPls } from './bootstrap';
import { estimatePls } from './pls';
import { mulberry32 } from './stats';
import type { Dataset, ModelSpec } from './types';

function gaussian(seed: number) {
  const rnd = mulberry32(seed);
  return () => {
    const u = rnd() || 1e-9;
    const v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
}

const spec: ModelSpec = {
  constructs: [
    { name: 'A', mode: 'A', indicators: ['a0', 'a1', 'a2'] },
    { name: 'B', mode: 'A', indicators: ['b0', 'b1', 'b2'] },
  ],
  paths: [{ from: 'A', to: 'B' }],
};

/** Two factors correlated .95, three items each, n = 60. */
function nearlyCollinear(seed: number): Dataset {
  const g = gaussian(seed);
  const n = 60;
  const f1 = Array.from({ length: n }, g);
  const f2 = f1.map((x) => 0.95 * x + Math.sqrt(1 - 0.95 ** 2) * g());
  const items = (f: number[]) =>
    [0, 1, 2].map(() => Float64Array.from(f, (x) => 0.7 * x + 0.71 * g()));
  return { names: ['a0', 'a1', 'a2', 'b0', 'b1', 'b2'], cols: [...items(f1), ...items(f2)] };
}

describe('PLSc admissibility', () => {
  it('stops with a clear message when a ρA is not positive', () => {
    const g = gaussian(3);
    const n = 200;
    const f1 = Array.from({ length: n }, g);
    const f3 = Array.from({ length: n }, g);
    const f2 = f3.map((x) => 0.7 * x + 0.5 * g());
    const data: Dataset = {
      names: ['a0', 'a1', 'b0', 'b1', 'b2'],
      cols: [
        Float64Array.from(f1, (x, i) => 0.4 * f3[i] + 0.6 * x + 0.5 * g()),
        Float64Array.from(f1, (x, i) => 0.4 * f3[i] - 0.6 * x + 0.5 * g()),
        ...[0, 1, 2].map(() => Float64Array.from(f2, (x) => 0.8 * x + 0.6 * g())),
      ],
    };
    const twoItems: ModelSpec = {
      ...spec,
      constructs: [{ name: 'A', mode: 'A', indicators: ['a0', 'a1'] }, spec.constructs[1]],
    };
    expect(() => estimatePls(data, twoItems, { consistent: true })).toThrow(
      /ρA of A is -0\.\d+, not positive/,
    );
    // Without the correction the model is estimated as before.
    expect(Number.isFinite(estimatePls(data, twoItems).pathCoef[0][1])).toBe(true);
  });

  it('warns when a disattenuated correlation exceeds 1', () => {
    const r = estimatePls(nearlyCollinear(2), spec, { consistent: true });
    expect(r.pathCoef[0][1]).toBeGreaterThan(1);
    expect(r.warnings?.[0]).toMatch(/correlation of A and B is 1\.0\d+, beyond ±1/);
    expect(estimatePls(nearlyCollinear(4), spec, { consistent: true }).warnings).toBeUndefined();
  });

  it('drops inadmissible bootstrap draws and counts them as failed', () => {
    const data = nearlyCollinear(4);
    const boot = bootstrapPls(
      data,
      spec,
      { consistent: true },
      { samples: 200, seed: 1, confidence: 0.95 },
    );
    expect(boot.failed).toBeGreaterThan(0);
    expect(boot.samples + boot.failed).toBe(200);
    const path = boot.stats.find((s) => s.group === 'path')!;
    expect(path.original).toBeLessThan(1);
    // Every kept draw is admissible, so the upper percentile bound stays at or below 1.
    expect(path.ciHigh).toBeLessThanOrEqual(1);
    // Without PLSc nothing is dropped.
    expect(bootstrapPls(data, spec, {}, { samples: 200, seed: 1, confidence: 0.95 }).failed).toBe(
      0,
    );
  });
});
