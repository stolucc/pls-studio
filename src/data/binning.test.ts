import { describe, expect, it } from 'vitest';
import type { Dataset } from '../engine/types';
import type { DataInfo } from '../model/project';
import {
  addRecodedColumn,
  binFormula,
  binLabels,
  equalCountCuts,
  equalWidthCuts,
  formulaName,
  parseCuts,
  parseRecode,
  recodeFormula,
  recodeLabels,
} from './binning';
import { evaluate, parseFormula } from './compute';
import { setFilter } from './pipeline';

const age = Float64Array.from([18, 22, 25, 31, 40, 47, 55, 63, NaN, 70]);
const data: Dataset = {
  names: ['age', 'my var'],
  cols: [age, Float64Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, -99])],
};
const info: DataInfo = { fileName: 'd.csv', rows: 10, missingCells: 1, excluded: [] };
const run = (expr: string) => Array.from(evaluate(parseFormula(expr), data));

describe('bins', () => {
  it('of equal width split the observed range', () => {
    expect(equalWidthCuts(age, 4)).toEqual([31, 44, 57]);
    expect(() => equalWidthCuts(Float64Array.from([3, 3, NaN]), 2)).toThrow(/one value/);
  });

  it('of equal counts cut at the quantiles (R type 7), ties merging bins', () => {
    // quantile(c(18,22,25,31,40,47,55,63,70), c(1/3, 2/3), type = 7) = 29, 49.66667
    expect(equalCountCuts(age, 3)).toEqual([29, 49.6667]);
    expect(equalCountCuts(Float64Array.from([1, 1, 1, 1, 2]), 4)).toEqual([]);
  });

  it('become a transparent formula with labels; a value at a cut goes up', () => {
    const f = binFormula('age', [31, 44, 57]);
    expect(f).toBe('1 + (age >= 31) + (age >= 44) + (age >= 57)');
    expect(run(f)).toEqual([1, 1, 1, 2, 2, 3, 3, 4, NaN, 4]);
    expect(binLabels([31, 44, 57])).toEqual([
      { value: 1, label: '< 31' },
      { value: 2, label: '31 to < 44' },
      { value: 3, label: '44 to < 57' },
      { value: 4, label: '≥ 57' },
    ]);
    expect(binFormula('my var', [0])).toBe('1 + (`my var` >= 0)');
    expect(formulaName('and')).toBe('`and`');
  });

  it('at cut points the user types', () => {
    expect(parseCuts('30, 18;50 18')).toEqual([18, 30, 50]);
    expect(() => parseCuts('')).toThrow();
    expect(() => parseCuts('10, x')).toThrow(/“x”/);
  });
});

describe('value recoding', () => {
  it('parses values, ranges, labels and else', () => {
    const r = parseRecode(
      '1, 2 = 1 low\n3 to 5 = 2 mid\n6 to highest = 3\nlowest to 0 = 0\nelse = missing',
    );
    expect(r.otherwise).toBe('missing');
    expect(r.rules).toEqual([
      { from: { value: 1 }, to: 1, label: 'low' },
      { from: { value: 2 }, to: 1, label: 'low' },
      { from: { lo: 3, hi: 5 }, to: 2, label: 'mid' },
      { from: { lo: 6, hi: Infinity }, to: 3 },
      { from: { lo: -Infinity, hi: 0 }, to: 0 },
    ]);
    expect(recodeLabels(r.rules)).toEqual([
      { value: 1, label: 'low' },
      { value: 2, label: 'mid' },
    ]);
    expect(() => parseRecode('5 to 3 = 1')).toThrow(/lower to a higher/);
    expect(() => parseRecode('a = 1')).toThrow();
    expect(() => parseRecode('1 = x')).toThrow(/number/);
    expect(() => parseRecode('else = sometimes')).toThrow();
    expect(() => parseRecode('else = copy')).toThrow(/at least one rule/);
  });

  it('becomes nested ifelse, the first matching rule deciding, missing kept', () => {
    const { rules, otherwise } = parseRecode('-99 = 0\n1 to 4 = 1\n3 to 9 = 2');
    const f = recodeFormula('my var', rules, otherwise);
    expect(f).toBe(
      'ifelse(`my var` == -99, 0, ifelse(`my var` >= 1 & `my var` <= 4, 1, ifelse(`my var` >= 3 & `my var` <= 9, 2, `my var`)))',
    );
    expect(run(f)).toEqual([1, 1, 1, 1, 2, 2, 2, 2, 2, 0]);
    expect(run(recodeFormula('age', parseRecode('lowest to 30 = 1').rules, 'missing'))).toEqual([
      1,
      1,
      1,
      NaN,
      NaN,
      NaN,
      NaN,
      NaN,
      NaN,
      NaN,
    ]);
    expect(
      run(recodeFormula('age', parseRecode('lowest to highest = 7').rules, { value: 0 })),
    ).toEqual([7, 7, 7, 7, 7, 7, 7, 7, NaN, 7]);
    const many = Array.from({ length: 40 }, (_, i) => `${i} = ${i + 1}`).join('\n');
    expect(() => recodeFormula('age', parseRecode(many).rules, 'copy')).toThrow(/too long/);
  });
});

describe('the recoded column', () => {
  it('is a computed column over every case, with labels and level, the filter applied after', () => {
    const f = setFilter(data, info, 'age < 50');
    const r = addRecodedColumn(f.data, f.info, {
      name: 'ageBin',
      expr: binFormula('age', [31, 44, 57]),
      labels: binLabels([31, 44, 57]),
      level: 'ordinal',
    });
    expect(r.info.computed).toEqual([
      { name: 'ageBin', expr: '1 + (age >= 31) + (age >= 44) + (age >= 57)' },
    ]);
    expect(Array.from(r.data.cols[2])).toEqual([1, 1, 1, 2, 2, 3]);
    expect(r.info.variables).toEqual([
      { name: 'ageBin', level: 'ordinal', labels: binLabels([31, 44, 57]) },
    ]);
    // The cases the filter leaves out have the new column too.
    expect(Array.from(setFilter(r.data, r.info, null).data.cols[2])).toEqual([
      1,
      1,
      1,
      2,
      2,
      3,
      3,
      4,
      NaN,
      4,
    ]);
  });
});
