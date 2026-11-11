import { describe, expect, it } from 'vitest';
import type { Dataset } from '../engine/types';
import {
  DEFAULT_SETTINGS,
  parseProject,
  serializeProject,
  type DataInfo,
  type ModelState,
} from '../model/project';
import { computeColumn, removeComputed } from './compute';
import {
  excludeCases,
  filterKeeps,
  filterSummary,
  restoreCases,
  setFilter,
  transformData,
} from './pipeline';

const data: Dataset = {
  names: ['age', 'group', 'x', 'country'],
  cols: [
    Float64Array.from([15, 20, 30, 40, 17, NaN]),
    Float64Array.from([1, 2, 2, 1, 2, 2]),
    Float64Array.from([1, 2, 3, 4, 5, 6]),
    Float64Array.from([1, 2, 1, 1, NaN, 2]),
  ],
  categories: { country: ['Ireland', 'Spain'] },
};
const info: DataInfo = { fileName: 'd.csv', rows: 6, missingCells: 2, excluded: [] };
const col = (d: Dataset, name: string) => Array.from(d.cols[d.names.indexOf(name)]);
const model: ModelState = { constructs: [], paths: [], moderations: [] };

describe('the dataset filter', () => {
  it('keeps the rows where the condition is true; false or missing leave a row out', () => {
    expect(filterKeeps(data, 'age >= 18 and group == 2')).toEqual([
      false,
      true,
      true,
      false,
      false,
      false,
    ]);
    expect(filterKeeps(data, 'country == "Ireland" or not group == 2')).toEqual([
      true,
      false,
      true,
      true,
      false,
      false,
    ]);
  });

  it('is applied to the data, shown with N kept, and removed again', () => {
    const r = setFilter(data, info, ' age >= 18 ');
    expect(col(r.data, 'x')).toEqual([2, 3, 4]);
    expect(r.info.filter).toEqual({ expr: 'age >= 18' });
    expect(filterSummary(r.info)).toEqual({ expr: 'age >= 18', kept: 3, total: 6 });
    expect(r.info.droppedRows).toHaveLength(1);
    expect(r.info.droppedRows![0].filter).toBe(true);
    const back = setFilter(r.data, r.info, null);
    expect(col(back.data, 'x')).toEqual([1, 2, 3, 4, 5, 6]);
    expect(back.info.filter).toBeUndefined();
    expect(back.info.droppedRows).toBeUndefined();
  });

  it('rejects conditions that do not parse or read unknown columns', () => {
    expect(() => setFilter(data, info, 'age >=')).toThrow();
    expect(() => setFilter(data, info, 'height > 2')).toThrow(/height/);
    expect(() => setFilter(data, info, 'x == "a"')).toThrow(/text column/);
  });

  it('is re-evaluated when the data change (a computed column it reads)', () => {
    const c = computeColumn(data, info, 'adult', 'age >= 18');
    const f = setFilter(c.data, c.info, 'adult == 1');
    expect(col(f.data, 'x')).toEqual([2, 3, 4]);
    // Redefine the column over every case: the filter follows.
    const g = transformData(f.data, f.info, (d, i) => computeColumn(d, i, 'adult', 'age >= 25'));
    expect(col(g.data, 'x')).toEqual([3, 4]);
    expect(filterSummary(g.info)).toMatchObject({ kept: 2, total: 6 });
    expect(() => removeComputed(g.data, g.info, 'adult')).toThrow(/filter/);
  });

  it('computes column-wise formulas over every case, before the filter', () => {
    const f = setFilter(data, info, 'group == 2');
    const r = transformData(f.data, f.info, (d, i) => computeColumn(d, i, 'cx', 'center(x)'));
    // The mean of x over all six cases is 3.5.
    expect(col(r.data, 'cx')).toEqual([-1.5, -0.5, 1.5, 2.5]);
  });

  it('maps cases excluded in the filtered data to the right rows, and keeps the filter on restore', () => {
    const f = setFilter(data, info, 'group == 2');
    expect(col(f.data, 'x')).toEqual([2, 3, 5, 6]);
    // Row 2 of the filtered data is x = 3.
    const ex = excludeCases(f.data, f.info, [2], 'outlier');
    expect(col(ex.data, 'x')).toEqual([2, 5, 6]);
    const outlier = ex.info.droppedRows!.find((d) => !d.filter)!;
    expect(outlier.values.x).toEqual([3]);
    expect(filterSummary(ex.info)).toMatchObject({ kept: 3, total: 5 });
    const back = restoreCases(ex.data, ex.info);
    expect(col(back.data, 'x')).toEqual([2, 3, 5, 6]);
    expect(back.info.filter).toEqual({ expr: 'group == 2' });
    expect(setFilter(back.data, back.info, null).data.cols[2].length).toBe(6);
  });

  it('is saved in the project, and its rows derived again from the condition when read', () => {
    const f = setFilter(data, info, 'age >= 18');
    const file = parseProject(serializeProject(model, DEFAULT_SETTINGS, f.data, f.info));
    expect(file.info!.filter).toEqual({ expr: 'age >= 18' });
    expect(col(file.data!, 'x')).toEqual([2, 3, 4]);
    // A tampered file: the stored rows do not match the condition; they are derived again.
    const json = JSON.parse(serializeProject(model, DEFAULT_SETTINGS, f.data, f.info));
    json.data.info.filter = { expr: 'age >= 35' };
    const tampered = parseProject(JSON.stringify(json));
    expect(col(tampered.data!, 'x')).toEqual([4]);
    expect(filterSummary(tampered.info!)).toMatchObject({ kept: 1, total: 6 });
  });

  it('drops an invalid filter from a file and puts its rows back', () => {
    const f = setFilter(data, info, 'age >= 18');
    for (const bad of [{ expr: 'nope >= 1' }, { expr: 'age >=' }, 'age > 1', { expr: 7 }]) {
      const json = JSON.parse(serializeProject(model, DEFAULT_SETTINGS, f.data, f.info));
      json.data.info.filter = bad;
      const r = parseProject(JSON.stringify(json));
      expect(r.info!.filter).toBeUndefined();
      // The rows stay excluded as an ordinary (restorable) exclusion.
      expect(r.info!.droppedRows![0].filter).toBeUndefined();
      expect(col(restoreCases(r.data!, r.info!).data, 'x')).toEqual([1, 2, 3, 4, 5, 6]);
    }
  });
});

it('refuses a filter that would leave no case', () => {
  expect(() => setFilter(data, info, 'age > 100')).toThrow(/leave none/);
});
