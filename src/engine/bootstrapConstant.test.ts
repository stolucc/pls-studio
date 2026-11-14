// A parameter that does not vary across the bootstrap draws (a single item's loading and weight
// of 1, a fixed value) has no t test: t and p are NaN (shown as —), not t = ∞ and p = 0.

import { describe, expect, it } from 'vitest';
import { bootstrapPls, summarise } from './bootstrap';
import { mulberry32 } from './stats';
import type { Dataset, ModelSpec } from './types';

describe('bootstrap statistics of a constant parameter', () => {
  it('have no t or p', () => {
    for (const value of [1, 0]) {
      const s = summarise([value, value, value, value], value, 0.95);
      expect(s.sd).toBe(0);
      expect(s.t).toBeNaN();
      expect(s.p).toBeNaN();
      expect(s.ciLow).toBe(value);
      expect(s.ciHigh).toBe(value);
    }
    // A varying parameter is tested as before.
    const v = summarise([0.4, 0.5, 0.6, 0.5], 0.5, 0.95);
    expect(v.t).toBeCloseTo(0.5 / v.sd, 12);
    expect(v.p).toBeGreaterThan(0);
  });

  it('a single-item construct’s loading in a PLS bootstrap', () => {
    const rnd = mulberry32(2);
    const g = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
    const n = 100;
    const f = Array.from({ length: n }, g);
    const data: Dataset = {
      names: ['a0', 'a1', 'y'],
      cols: [
        Float64Array.from(f, (x) => 0.8 * x + 0.6 * g()),
        Float64Array.from(f, (x) => 0.8 * x + 0.6 * g()),
        Float64Array.from(f, (x) => 0.5 * x + 0.8 * g()),
      ],
    };
    const spec: ModelSpec = {
      constructs: [
        { name: 'A', mode: 'A', indicators: ['a0', 'a1'] },
        { name: 'Y', mode: 'A', indicators: ['y'] },
      ],
      paths: [{ from: 'A', to: 'Y' }],
    };
    const boot = bootstrapPls(data, spec, {}, { samples: 50, seed: 1, confidence: 0.95 });
    const single = boot.stats.find((s) => s.group === 'loading' && s.label.includes('y'))!;
    expect(single.original).toBeCloseTo(1, 12);
    expect(single.t).toBeNaN();
    expect(single.p).toBeNaN();
    const path = boot.stats.find((s) => s.group === 'path')!;
    expect(path.t).toBeGreaterThan(2);
  });
});
