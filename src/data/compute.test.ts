import { describe, expect, it } from 'vitest';
import {
  columnsIn,
  computeColumn,
  evaluate,
  parseFormula,
  recomputeAll,
  removeComputed,
  nameError,
} from './compute';
import type { Dataset } from '../engine/types';
import type { DataInfo } from '../model/project';

const data: Dataset = {
  names: ['x', 'y', 'g'],
  cols: [
    Float64Array.from([1, 2, 3, 4, NaN]),
    Float64Array.from([10, 20, 30, 40, 50]),
    Float64Array.from([0, 1, 1, 0, 1]),
  ],
};
const info: DataInfo = { fileName: 'd.csv', rows: 5, missingCells: 1, excluded: [] };
const ev = (src: string, d = data) => Array.from(evaluate(parseFormula(src), d));

describe('formulas', () => {
  it('follow the usual precedence and propagate missing values', () => {
    expect(ev('x + y * 2')).toEqual([21, 42, 63, 84, NaN]);
    expect(ev('(x + y) * 2')).toEqual([22, 44, 66, 88, NaN]);
    expect(ev('-x ^ 2')).toEqual([-1, -4, -9, -16, NaN]);
    expect(ev('2 ^ 3 ^ 2')).toEqual([512, 512, 512, 512, 512]);
    expect(ev('y / (x - 1)')).toEqual([NaN, 20, 15, 13.333333333333334, NaN]);
    expect(ev('1e2 + .5')).toEqual([100.5, 100.5, 100.5, 100.5, 100.5]);
  });
  it('has comparisons, logic and ifelse', () => {
    expect(ev('x >= 2 & y < 40')).toEqual([0, 1, 1, 0, 0]); // a false side decides an & (R's NA & FALSE)
    expect(ev('x >= 2 & y < 60')).toEqual([0, 1, 1, 1, NaN]);
    expect(ev('x >= 2 | y > 45')).toEqual([0, 1, 1, 1, 1]);
    expect(ev('x >= 2 | y > 55')).toEqual([0, 1, 1, 1, NaN]);
    expect(ev('x == 1 | g')).toEqual([1, 1, 1, 0, 1]);
    expect(ev('!g')).toEqual([1, 0, 0, 1, 0]);
    expect(ev('ifelse(x > 2, y, -1)')).toEqual([-1, -1, 30, 40, NaN]);
    expect(ev('isna(x)')).toEqual([0, 0, 0, 0, 1]);
    expect(ev('x != 2 && y >= 20 || g')).toEqual([0, 1, 1, 1, 1]);
  });
  it('offers row-wise and column-wise functions', () => {
    expect(ev('log(y)').map((v) => Number(v.toFixed(4)))).toEqual([
      2.3026, 2.9957, 3.4012, 3.6889, 3.912,
    ]);
    expect(ev('sqrt(y) + abs(-x)').slice(0, 1)[0]).toBeCloseTo(Math.sqrt(10) + 1, 12);
    expect(ev('round(y / 3, 1)')).toEqual([3.3, 6.7, 10, 13.3, 16.7]);
    expect(ev('floor(y / 3) + ceiling(x / 3)')).toEqual([4, 7, 11, 15, NaN]);
    expect(ev('min(x, y, 25)')).toEqual([1, 2, 3, 4, NaN]);
    expect(ev('max(x, g)')).toEqual([1, 2, 3, 4, NaN]);
    expect(ev('sum(x, y)')).toEqual([11, 22, 33, 44, NaN]);
    expect(ev('mean(x, y)')).toEqual([5.5, 11, 16.5, 22, NaN]);
    expect(ev('center(x)')).toEqual([-1.5, -0.5, 0.5, 1.5, NaN]);
    // Group-mean centring (Mplus CENTER … GROUPMEAN): g = 0 rows have x 1, 4 (mean 2.5); g = 1 rows 2, 3 (x missing in the fifth).
    expect(ev('center(x, g)')).toEqual([-1.5, -0.5, 0.5, 1.5, NaN]);
    expect(ev('center(y, g)').map((v) => Number(v.toFixed(6)))).toEqual([
      -15, -13.333333, -3.333333, 15, 16.666667,
    ]);
    const z = ev('z(x)');
    expect(z[4]).toBeNaN();
    expect(z[0]).toBeCloseTo(-1.5 / Math.sqrt(5 / 3), 12);
    expect(ev('rank(y)')).toEqual([1, 2, 3, 4, 5]);
    expect(ev('rank(g)')).toEqual([1.5, 4, 4, 1.5, 4]);
    // A time series in row order: the value k rows earlier (Mplus LAGGED = y(k)).
    expect(ev('lag(y)')).toEqual([NaN, 10, 20, 30, 40]);
    expect(ev('lag(y, 2)')).toEqual([NaN, NaN, 10, 20, 30]);
    expect(ev('lag(x)')).toEqual([NaN, 1, 2, 3, 4]);
    expect(() => ev('lag(y, 0.5)')).toThrow(/whole number/);
    expect(ev('exp(log(y))').map(Math.round)).toEqual([10, 20, 30, 40, 50]);
    expect(ev('log10(y)')[0]).toBeCloseTo(1, 12);
    expect(ev('log2(y)')[0]).toBeCloseTo(Math.log2(10), 12);
    expect(ev('log(x - 2)')).toEqual([NaN, NaN, 0, Math.log(2), NaN]); // no infinities
  });
  it('reads names in backticks and lists the columns used', () => {
    const d: Dataset = {
      names: ['my var', 'a.b'],
      cols: [Float64Array.from([1, 2]), Float64Array.from([3, 4])],
    };
    expect(ev('`my var` * a.b', d)).toEqual([3, 8]);
    expect(columnsIn(parseFormula('log(`my var`) + a.b + a.b'))).toEqual(['my var', 'a.b']);
  });
  it('says what is wrong', () => {
    expect(() => parseFormula('')).toThrow(/Enter a formula/);
    expect(() => parseFormula('x +')).toThrow(/ends too early/);
    expect(() => parseFormula('x y')).toThrow(/after the end/);
    expect(() => parseFormula('foo(x)')).toThrow(/Unknown function “foo”/);
    expect(() => parseFormula('log(x, 2)')).toThrow(/log\(\) takes 1 argument/);
    expect(() => parseFormula('ifelse(x)')).toThrow(/takes 3 arguments/);
    expect(() => parseFormula('x $ 2')).toThrow(/Unexpected character/);
    expect(() => parseFormula('`open')).toThrow(/not closed/);
    expect(() => parseFormula('(x')).toThrow(/Expected “\)”/);
    expect(() => parseFormula('x'.repeat(600))).toThrow(/too long/);
    expect(() => evaluate(parseFormula('nope + 1'), data)).toThrow(/“nope” is not a column/);
    expect(() =>
      evaluate(parseFormula('t + 1'), {
        names: ['t'],
        cols: [Float64Array.from([1])],
        categories: { t: ['a'] },
      }),
    ).toThrow(/text column/);
  });
});

describe('computed columns in the dataset', () => {
  it('adds, replaces, recomputes and removes columns, keeping the formulas', () => {
    const r1 = computeColumn(data, info, 'lx', 'log(y)');
    expect(r1.data.names).toEqual(['x', 'y', 'g', 'lx']);
    expect(r1.info.computed).toEqual([{ name: 'lx', expr: 'log(y)' }]);
    expect(r1.info.missingCells).toBe(1);
    const r2 = computeColumn(r1.data, r1.info, 'both', 'lx + x');
    expect(r2.info.computed!.map((c) => c.name)).toEqual(['lx', 'both']);
    expect(r2.info.missingCells).toBe(2);
    // Editing a formula keeps the column where it is.
    const r3 = computeColumn(r2.data, r2.info, 'lx', 'log10(y)');
    expect(r3.data.names).toEqual(['x', 'y', 'g', 'lx', 'both']);
    expect(r3.info.computed![0]).toEqual({ name: 'lx', expr: 'log10(y)' });
    expect(Array.from(r3.data.cols[3])[0]).toBeCloseTo(1, 12);
    // Recomputing in order propagates the edit to columns built on it.
    const r4 = recomputeAll(r3.data, r3.info);
    expect(Array.from(r4.data.cols[4])[0]).toBeCloseTo(2, 12);
    // A column may use only columns computed before it; nothing uses itself; names must be free.
    expect(() => computeColumn(r4.data, r4.info, 'lx', 'both + 1')).toThrow(/computed after/);
    expect(() => computeColumn(r4.data, r4.info, 'q', 'q + 1')).toThrow(/from itself/);
    expect(() => computeColumn(r4.data, r4.info, 'x', 'y')).toThrow(/already a column/);
    expect(nameError('lx', r4.data, r4.info)).toMatch(/already a computed column/);
    expect(nameError('', r4.data, r4.info)).toMatch(/Give the new column a name/);
    expect(nameError('a`b', r4.data, r4.info)).toMatch(/backtick/);
    expect(nameError('fine name', r4.data, r4.info)).toBeNull();
    // Removal refuses a column another formula uses, then drops column and formula.
    expect(() => removeComputed(r4.data, r4.info, 'lx')).toThrow(/used by both/);
    const r5 = removeComputed(r4.data, r4.info, 'both');
    const r6 = removeComputed(r5.data, r5.info, 'lx');
    expect(r6.data.names).toEqual(['x', 'y', 'g']);
    expect(r6.info.computed).toBeUndefined();
    expect(() => removeComputed(r6.data, r6.info, 'x')).toThrow(/not a computed column/);
    expect(() =>
      computeColumn({ names: ['a'], cols: [], moments: { S: [[1]], n: 10 } }, info, 'b', 'a'),
    ).toThrow(/covariance matrix/);
  });
  it('recomputes after the rows changed and tolerates a formula whose column is gone', () => {
    const r1 = computeColumn(data, info, 'lx', 'log(y)');
    const more: Dataset = {
      ...r1.data,
      cols: r1.data.cols.map((c, i) =>
        i === 3
          ? Float64Array.from([NaN, NaN, NaN, NaN, NaN, NaN])
          : Float64Array.from([...c, i === 1 ? 60 : 1]),
      ),
    };
    const r2 = recomputeAll(more, r1.info);
    expect(Array.from(r2.data.cols[3]).map((v) => Number(v.toFixed(3)))).toEqual([
      2.303, 2.996, 3.401, 3.689, 3.912, 4.094,
    ]);
    const gone: Dataset = { names: ['x', 'lx'], cols: [data.cols[0], r1.data.cols[3]] };
    expect(recomputeAll(gone, r1.info).data).toBe(gone);
  });
});
