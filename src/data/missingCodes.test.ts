import { describe, expect, it } from 'vitest';
import type { Dataset } from '../engine/types';
import {
  DEFAULT_SETTINGS,
  parseProject,
  serializeProject,
  type DataInfo,
  type ModelState,
} from '../model/project';
import { computeColumn } from './compute';
import {
  codesToText,
  isCode,
  mask,
  parseCodesText,
  parseMissingCodes,
  unmask,
  withCodes,
} from './missingCodes';
import { excludeCases, restoreCases, setFilter, setMissingCodes, transformData } from './pipeline';
import { reverseCode } from './recode';

const data: Dataset = {
  names: ['q', 'age', 't'],
  cols: [
    Float64Array.from([1, -99, 3, 999, 5, 2]),
    Float64Array.from([20, 30, 995, 40, 50, 60]),
    Float64Array.from([1, 2, 1, 2, 1, 2]),
  ],
  categories: { t: ['a', 'b'] },
};
const info: DataInfo = { fileName: 'd.csv', rows: 6, missingCells: 0, excluded: [] };
const model: ModelState = { constructs: [], paths: [], moderations: [] };
const col = (d: Dataset, n: string) =>
  Array.from(d.cols[d.names.indexOf(n)], (v) => (Number.isNaN(v) ? null : v));

describe('missing-value codes', () => {
  it('are typed as values and ranges', () => {
    expect(parseCodesText('999, -99; 990 to 999, -99')).toEqual({
      values: [-99, 999],
      ranges: [[990, 999]],
    });
    expect(codesToText({ values: [-99], ranges: [[990, 999]] })).toBe('-99, 990 to 999');
    expect(parseCodesText('')).toEqual({ values: [], ranges: [] });
    expect(() => parseCodesText('nine')).toThrow(/not a number/);
    expect(() => parseCodesText('5 to 1')).toThrow(/lower to a higher/);
    expect(() => parseCodesText('a to 3')).toThrow(/two numbers/);
    expect(isCode({ values: [-99], ranges: [[990, 999]] }, 995)).toBe(true);
    expect(isCode({ values: [-99], ranges: [] }, NaN)).toBe(false);
  });

  it('mask the values as missing, keeping them, and unmask them back', () => {
    const m = mask(data, withCodes(info, 'q', { values: [-99, 999], ranges: [] }));
    expect(col(m.data, 'q')).toEqual([1, null, 3, null, 5, 2]);
    expect(m.info.missingCodes![0].cells).toEqual({ at: [1, 3], values: [-99, 999] });
    expect(m.info.missingCells).toBe(2);
    const u = unmask(m.data, m.info);
    expect(col(u.data, 'q')).toEqual([1, -99, 3, 999, 5, 2]);
    expect(u.info.missingCodes![0].cells).toBeUndefined();
  });

  it('are set and removed on the data; computed columns and the filter follow', () => {
    const c = computeColumn(data, info, 'q2', 'q * 2');
    const f = setFilter(c.data, c.info, 'q2 > 0');
    expect(col(f.data, 'q')).toEqual([1, -99, 3, 999, 5, 2].filter((v) => v > 0));
    const r = setMissingCodes(f.data, f.info, 'q', parseCodesText('-99, 999'));
    // q2 is missing where q is a code, so the filter leaves those cases out.
    expect(col(r.data, 'q')).toEqual([1, 3, 5, 2]);
    expect(col(r.data, 'q2')).toEqual([2, 6, 10, 4]);
    const back = setMissingCodes(r.data, r.info, 'q', null);
    expect(back.info.missingCodes).toBeUndefined();
    expect(col(setFilter(back.data, back.info, null).data, 'q')).toEqual([1, -99, 3, 999, 5, 2]);
    expect(() => setMissingCodes(data, info, 't', parseCodesText('1'))).toThrow(/text column/);
    expect(() => setMissingCodes(c.data, c.info, 'q2', parseCodesText('1'))).toThrow(/computed/);
  });

  it('keep the original values through excluding and restoring cases, and reverse-coding', () => {
    const r = setMissingCodes(data, info, 'q', parseCodesText('-99, 999'));
    const ex = excludeCases(r.data, r.info, [2, 6], 'test');
    expect(col(ex.data, 'q')).toEqual([1, 3, null, 5]);
    expect(ex.info.droppedRows![0].values.q).toEqual([-99, 2]);
    const back = restoreCases(ex.data, ex.info);
    expect(col(setMissingCodes(back.data, back.info, 'q', null).data, 'q')).toEqual([
      1, -99, 3, 999, 5, 2,
    ]);
    // Reverse-coding sees the codes as missing (and leaves them as they were).
    const rev = transformData(r.data, r.info, (d, i) => reverseCode(d, i, ['q'], 1, 5));
    expect(col(rev.data, 'q')).toEqual([5, null, 3, null, 1, 4]);
    expect(col(setMissingCodes(rev.data, rev.info, 'q', null).data, 'q')).toEqual([
      5, -99, 3, 999, 1, 4,
    ]);
  });
});

describe('missing codes in project files', () => {
  it('are saved with the original values and read back', () => {
    const r = setMissingCodes(data, info, 'age', parseCodesText('990 to 999'));
    const f = setFilter(r.data, r.info, 'age < 55');
    const file = parseProject(serializeProject(model, DEFAULT_SETTINGS, f.data, f.info));
    expect(file.info!.missingCodes).toEqual(f.info.missingCodes);
    // (995 is missing, so the filter's condition is missing there: left out)
    expect(col(file.data!, 'age')).toEqual([20, 30, 40, 50]);
    const back = setFilter(file.data!, file.info!, null);
    expect(col(setMissingCodes(back.data, back.info, 'age', null).data, 'age')).toEqual([
      20, 30, 995, 40, 50, 60,
    ]);
  });

  it('are validated strictly; inconsistent cells are dropped', () => {
    const plain = { ...data, cols: [Float64Array.from([1, NaN, 3]), ...data.cols.slice(1)] };
    expect(
      parseMissingCodes(
        [
          { name: 'q', values: [-99, 'x', Infinity, -99], ranges: [[1, 0], [990, 999], [5]] },
          { name: 'q', values: [1] },
          { name: 't', values: [1] },
          { name: 'gone', values: [1] },
          { name: 'age', values: [] },
          { name: 'age', values: [7], cells: { at: [0], values: [7] } },
        ],
        plain,
      ),
    ).toEqual([
      { name: 'q', values: [-99], ranges: [[990, 999]] },
      { name: 'age', values: [7], ranges: [] },
    ]);
    const cells = (c: unknown) =>
      parseMissingCodes([{ name: 'q', values: [-99], ranges: [], cells: c }], plain)![0].cells;
    expect(cells({ at: [1], values: [-99] })).toEqual({ at: [1], values: [-99] });
    expect(cells({ at: [1], values: [5] })).toBeUndefined(); // not a code
    expect(cells({ at: [0], values: [-99] })).toBeUndefined(); // the cell is not missing
    expect(cells({ at: [9], values: [-99] })).toBeUndefined(); // outside the data
    expect(cells({ at: [1, 1], values: [-99, -99] })).toBeUndefined();
    expect(parseMissingCodes(['q'], plain)).toBeUndefined();
    expect(parseMissingCodes([{ name: 'q2', values: [1] }], plain, ['q2'])).toBeUndefined();
  });

  it('mask values a tampered file left in place', () => {
    const json = JSON.parse(serializeProject(model, DEFAULT_SETTINGS, data, info));
    json.data.info.missingCodes = [{ name: 'q', values: [999], ranges: [] }];
    const file = parseProject(JSON.stringify(json));
    expect(col(file.data!, 'q')).toEqual([1, -99, 3, null, 5, 2]);
    expect(file.info!.missingCells).toBe(1);
  });
});
