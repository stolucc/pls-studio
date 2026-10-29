import { describe, expect, it } from 'vitest';
import { irtRequest, lcaRequest } from './items';

const data = { names: ['q1', 'q2', 'q3', 'other'], cols: [1, 2, 3, 4].map((k) => Float64Array.from([k, NaN])) };

describe('item analysis requests', () => {
  it('send only the chosen items', () => {
    expect(irtRequest(data, ['q1', 'q3'], 'grm')).toMatchObject({ kind: 'irt', model: 'grm', data: { names: ['q1', 'q3'], cols: [[1, null], [3, null]] } });
    expect(lcaRequest(data, ['q1', 'q2'], [1, 2, 3], 10, 7)).toMatchObject({ kind: 'lca', classes: [1, 2, 3], nrep: 10, seed: 7, data: { names: ['q1', 'q2'] } });
  });
});
