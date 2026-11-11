import { describe, expect, it } from 'vitest';
import { expandCategorical } from './categorical';
import type { ModelSpec } from './types';

describe('categorical exogenous variables (dummy-coded composite)', () => {
  const data = {
    names: ['g', 'y'],
    cols: [Float64Array.from([1, 2, 3, NaN, 2]), Float64Array.from([5, 6, 7, 8, 9])],
    categories: { g: ['north', 'south', 'west'] },
  };
  const spec: ModelSpec = {
    constructs: [
      {
        name: 'Region',
        mode: 'A',
        type: 'factor',
        indicators: ['g'],
        categorical: true,
        dominant: 'g',
      },
      { name: 'Y', mode: 'A', indicators: ['y'] },
    ],
    paths: [{ from: 'Region', to: 'Y' }],
  };
  it('makes k − 1 dummies (first category the reference), missing stays missing, as a Mode B composite', () => {
    const r = expandCategorical(data, spec);
    expect(r.data.names).toEqual(['g', 'y', 'g: south', 'g: west']);
    expect(Array.from(r.data.cols[2])).toEqual([0, 1, 0, NaN, 1]);
    expect(Array.from(r.data.cols[3])).toEqual([0, 0, 1, NaN, 0]);
    expect(r.spec.constructs[0]).toEqual({
      name: 'Region',
      mode: 'B',
      type: 'composite',
      indicators: ['g: south', 'g: west'],
    });
    expect(r.spec.constructs[1]).toBe(spec.constructs[1]);
  });
  it('labels numeric categories by value and leaves other models alone', () => {
    const num = { names: ['g', 'y'], cols: data.cols };
    expect(expandCategorical(num, spec).data.names.slice(2)).toEqual(['g: 2', 'g: 3']);
    const plain = {
      ...spec,
      constructs: spec.constructs.map((c) => ({ ...c, categorical: false })),
    };
    expect(expandCategorical(data, plain).spec).toBe(plain);
  });
});
