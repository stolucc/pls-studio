// The bootstrap test of exact fit refers to the model whose fit the results
// show: categorical constructs are expanded as in estimatePls, and models with
// interaction terms, whose model-implied correlations are not defined, have
// neither a fit nor a test.

import { describe, expect, it } from 'vitest';
import { fitTestPls } from './bootstrap';
import { estimatePls } from './pls';
import { mulberry32 } from './stats';
import type { Dataset, ModelSpec } from './types';

function simulated(): Dataset {
  const rnd = mulberry32(5);
  const g = () => {
    const u = rnd() || 1e-9;
    const v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const n = 200;
  const fx = Array.from({ length: n }, g);
  const fm = Array.from({ length: n }, g);
  const fy = fx.map((x, i) => 0.4 * x + 0.3 * fm[i] + 0.3 * x * fm[i] + 0.7 * g());
  const names: string[] = [];
  const cols: Float64Array[] = [];
  for (const [prefix, f] of [
    ['x', fx],
    ['m', fm],
    ['y', fy],
  ] as const)
    for (let k = 0; k < 3; k++) {
      names.push(`${prefix}${k}`);
      cols.push(Float64Array.from(f, (v) => 0.8 * v + 0.6 * g()));
    }
  // A three-level group variable, related to y.
  names.push('group');
  cols.push(Float64Array.from(fy, (v) => (v < -0.5 ? 1 : v < 0.5 ? 2 : 3)));
  return { names, cols, categories: { group: ['a', 'b', 'c'] } };
}

const block = (name: string, prefix: string) => ({
  name,
  mode: 'A' as const,
  indicators: [`${prefix}0`, `${prefix}1`, `${prefix}2`],
});
const data = simulated();
const moderated: ModelSpec = {
  constructs: [block('X', 'x'), block('M', 'm'), block('Y', 'y')],
  paths: [
    { from: 'X', to: 'Y' },
    { from: 'M', to: 'Y' },
  ],
  moderations: [{ from: 'X', moderator: 'M', to: 'Y' }],
};

describe('overall fit of models with interaction terms', () => {
  it('is not reported (NaN), as the results explain', () => {
    const r = estimatePls(data, moderated);
    for (const which of ['saturated', 'estimated'] as const)
      expect(Object.values(r.fit[which]).every(Number.isNaN)).toBe(true);
  });

  it('has no bootstrap test', () => {
    expect(() => fitTestPls(data, moderated, {}, { samples: 20, seed: 1 })).toThrow(
      /interaction or copula terms/,
    );
  });
});

describe('the test of exact fit', () => {
  it('starts from the fit estimatePls reports, also with a categorical construct', () => {
    const spec: ModelSpec = {
      constructs: [
        {
          name: 'Group',
          mode: 'A',
          type: 'factor',
          indicators: ['group'],
          categorical: true,
          dominant: 'group',
        },
        block('X', 'x'),
        block('Y', 'y'),
      ],
      paths: [
        { from: 'Group', to: 'X' },
        { from: 'X', to: 'Y' },
      ],
    };
    const shown = estimatePls(data, spec).fit;
    const test = fitTestPls(data, spec, {}, { samples: 20, seed: 1 });
    for (const which of ['saturated', 'estimated'] as const)
      for (const d of ['srmr', 'dULS', 'dG'] as const)
        expect(test.observed[which][d]).toBeCloseTo(shown[which][d], 12);
  });
});
