import { expect, it } from 'vitest';
import { scoreColumns } from './lavaan';

it('adds one score column per construct, NaN where a row has no score, without clashing names', () => {
  const data = {
    names: ['a', 'F 1_score'],
    cols: [Float64Array.of(1, 2, 3), Float64Array.of(0, 0, 0)],
  };
  const d = scoreColumns(
    data,
    ['F 1', 'G'],
    [1, 3],
    [
      [0.5, -0.5],
      [1, 2],
    ],
  );
  expect(d.names).toEqual(['a', 'F 1_score', 'F_1_score', 'G_score']);
  expect(Array.from(d.cols[2])).toEqual([0.5, NaN, -0.5]);
  expect(Array.from(d.cols[3])).toEqual([1, NaN, 2]);
  expect(data.names).toHaveLength(2);
});
