import { describe, expect, it } from 'vitest';
import { dataFileFormat, toDataset } from './readFile';

describe('reading SPSS, Stata and Excel files', () => {
  it('knows the formats by extension', () => {
    expect(dataFileFormat('survey.SAV')).toBe('sav');
    expect(dataFileFormat('a.b.xlsx')).toBe('xlsx');
    expect(dataFileFormat('data.dta')).toBe('dta');
    expect(dataFileFormat('data.csv')).toBeNull();
    expect(dataFileFormat('noext')).toBeNull();
  });

  it('turns R’s columns into the dataset: numbers, factors with their levels, text as categories, free text left out', () => {
    const free = Array.from({ length: 60 }, (_, i) => `comment ${i}`);
    const { data, info, sheets } = toDataset(
      {
        names: ['x', 'f', 't', 'free', 'one'],
        n: 60,
        sheets: 'Sheet1',
        cols: [
          { kind: 'number', values: [1, null, ...Array(58).fill(2)] },
          { kind: 'factor', codes: [2, 1, ...Array(58).fill(null)], levels: ['high', 'low'] },
          { kind: 'text', values: ['b', 'a', 'NA', ...Array(57).fill('a')] },
          { kind: 'text', values: free },
          { kind: 'number', values: 7 },
        ],
        excluded: [{ name: 'd', reason: 'unsupported column type Date' }],
      },
      'f.xlsx',
    );
    expect(data.names).toEqual(['x', 'f', 't', 'one']);
    expect([...data.cols[0]].slice(0, 3)).toEqual([1, NaN, 2]);
    expect(data.categories).toEqual({ f: ['high', 'low'], t: ['a', 'b'] });
    expect([...data.cols[2]].slice(0, 3)).toEqual([2, 1, NaN]);
    expect([...data.cols[3]]).toEqual([7]);
    expect(info.excluded.map((x) => x.name)).toEqual(['d', 'free']);
    expect(info.rows).toBe(60);
    expect(sheets).toEqual(['Sheet1']);
  });

  it('keeps value labels of numeric columns, validated', () => {
    const { info } = toDataset(
      {
        names: ['x', 'y'],
        n: 2,
        cols: [
          {
            kind: 'number',
            values: [1, 2],
            labels: [
              { value: 2, label: 'high' },
              { value: 1, label: 'low' },
              { value: 1, label: 'twice' },
              { value: 'x', label: 'bad' },
            ],
          },
          { kind: 'number', values: [1, 2], labels: { value: 1, label: 'one' } },
        ],
      },
      'f.sav',
    );
    expect(info.variables).toEqual([
      {
        name: 'x',
        labels: [
          { value: 1, label: 'low' },
          { value: 2, label: 'high' },
        ],
      },
      { name: 'y', labels: [{ value: 1, label: 'one' }] },
    ]);
  });

  it('refuses a file with no usable column', () => {
    expect(() => toDataset({ names: [], cols: [], n: 0 }, 'empty.sav')).toThrow(
      'No usable columns',
    );
  });
});
