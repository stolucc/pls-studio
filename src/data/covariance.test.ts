import { describe, expect, it } from 'vitest';
import { covarianceN } from '../engine/cbsem';
import { covarianceDataset } from './covariance';

describe('covariance matrix from raw data', () => {
  const data = {
    names: ['a', 'b', 'g', 'c'],
    cols: [
      Float64Array.from([1, 2, 3, 4, 5, 6, 7]),
      Float64Array.from([2, 1, 4, 3, 6, 5, NaN]),
      Float64Array.from([1, 1, 1, 2, 2, 2, 2]),
      Float64Array.from([5, 4, 3, 2, 1, 0, 1]),
    ],
    categories: { g: ['control', 'treated'] },
  };
  it('is unbiased (N − 1) over the rows complete in the chosen columns, in the chosen order', () => {
    const d = covarianceDataset(data, ['c', 'a']);
    expect(d.names).toEqual(['c', 'a']);
    expect(d.cols).toEqual([]);
    expect(d.moments!.n).toBe(7);
    expect(d.moments!.means).toEqual([16 / 7, 4]);
    const ref = covarianceN([data.cols[3], data.cols[0]]);
    expect(d.moments!.S[0][1]).toBeCloseTo((ref[0][1] * 7) / 6, 12);
    expect(d.moments!.S[1][1]).toBeCloseTo((ref[1][1] * 7) / 6, 12);
    // b has a missing value in the last row: listwise, N = 6.
    expect(covarianceDataset(data, ['a', 'b']).moments!.n).toBe(6);
    expect(covarianceDataset(data, ['a', 'b']).moments!.S[0][0]).toBeCloseTo(3.5, 12);
  });
  it('splits into groups by a grouping column, labelled by its categories, pooled into S and n', () => {
    const d = covarianceDataset(data, ['a', 'c'], 'g');
    expect(d.moments!.groups!.map((k) => [k.label, k.n])).toEqual([
      ['control', 3],
      ['treated', 4],
    ]);
    expect(d.moments!.n).toBe(7);
    expect(d.moments!.groups![0].S[0][0]).toBeCloseTo(1, 12);
    expect(d.moments!.groups!.map((k) => k.means![0])).toEqual([2, 5.5]);
    expect(d.moments!.means![0]).toBeCloseTo((3 * 2 + 4 * 5.5) / 7, 12);
    expect(d.moments!.S[0][0]).toBeCloseTo((2 * 1 + 3 * (5 / 3)) / 5, 12);
  });
  it('refuses unknown columns, too few rows and a one-valued grouping column; passes a matrix dataset through', () => {
    expect(() => covarianceDataset(data, ['a', 'zz'])).toThrow(/Not in the dataset: zz/);
    expect(() =>
      covarianceDataset({ names: ['a'], cols: [Float64Array.from([1, 2])] }, ['a']),
    ).toThrow(/Fewer than three complete rows/);
    expect(() => covarianceDataset(data, ['a'], 'zz')).toThrow(/grouping column/);
    expect(() =>
      covarianceDataset(
        { names: ['a', 'g'], cols: [Float64Array.from([1, 2, 3]), Float64Array.from([1, 1, 1])] },
        ['a'],
        'g',
      ),
    ).toThrow(/one value/);
    const m = { names: ['a'], cols: [], moments: { S: [[2]], n: 50 } };
    expect(covarianceDataset(m, ['a']).moments).toEqual(m.moments);
  });
});
