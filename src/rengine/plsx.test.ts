import { describe, expect, it } from 'vitest';
import type { ModelSpec } from '../engine/types';
import { blindfoldTargets } from './plsx';

describe('blindfoldTargets', () => {
  it('keeps endogenous constructs with Mode A indicators, as semPLS', () => {
    const spec: ModelSpec = {
      constructs: [
        { name: 'X', mode: 'A', indicators: ['x1', 'x2'] },
        { name: 'F', mode: 'B', type: 'composite', indicators: ['f1', 'f2'] },
        { name: 'C', mode: 'A', type: 'composite', indicators: ['c1', 'c2'] },
        { name: 'Y', mode: 'A', type: 'factor', indicators: ['y1'] },
        { name: 'H', mode: 'A', indicators: [], components: ['X', 'C'] },
      ],
      paths: [
        { from: 'X', to: 'F' },
        { from: 'X', to: 'C' },
        { from: 'F', to: 'Y' },
        { from: 'C', to: 'Y' },
        { from: 'Y', to: 'H' },
      ],
    };
    expect(blindfoldTargets(spec)).toEqual(['C', 'Y']);
  });
});
