// What cbRequest sends to R for multiple imputation: the auxiliary variables travel with the data, only then.
import { describe, expect, it } from 'vitest';
import { toSpec, type ModelState } from '../model/project';
import { cbRequest } from './lavaan';

describe('cbRequest and multiple imputation', () => {
  const m: ModelState = { constructs: [{ id: 'F', name: 'F', type: 'factor', mode: 'A', indicators: ['a1', 'a2', 'a3'], x: 0, y: 0, side: 'left' }], paths: [], moderations: [] };
  const data = { names: ['a1', 'a2', 'a3', 'age', 'other'], cols: Array.from({ length: 5 }, () => Float64Array.from([1, 2, NaN, 4])) };
  it('adds the auxiliary columns with imputation, and not otherwise', () => {
    const mi = { m: 20, seed: 456, method: 'amelia' as const, auxiliary: ['age'], nominal: [] };
    const withMi = cbRequest(data, toSpec(m), 'mi', 'ML', 'product', mi) as unknown as { data: { names: string[] }; mi: unknown };
    expect(withMi.data.names).toEqual(['a1', 'a2', 'a3', 'age']);
    expect(withMi.mi).toEqual(mi);
    const without = cbRequest(data, toSpec(m), 'casewise', 'ML', 'product', mi) as unknown as { data: { names: string[] }; mi?: unknown };
    expect(without.data.names).toEqual(['a1', 'a2', 'a3']);
    expect(without.mi).toBeUndefined();
  });
});
