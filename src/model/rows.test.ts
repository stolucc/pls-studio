import { describe, expect, it } from 'vitest';
import { parseProject, serializeProject, DEFAULT_SETTINGS, type DataInfo, type ModelState } from './project';
import { excludeRows, parseDroppedRows, restoreRows } from './rows';

const data = { names: ['a', 'b'], cols: [Float64Array.from([1, 2, 3, 4, 5]), Float64Array.from([10, NaN, 30, 40, 50])] };
const info: DataInfo = { fileName: 'd.csv', rows: 5, missingCells: 1, excluded: [] };

describe('excluding cases and restoring them', () => {
  it('removes 1-based rows, records them, and updates the counts', () => {
    const r = excludeRows(data, info, [4, 2, 4], 'outliers');
    expect(r.data.cols.map((c) => Array.from(c))).toEqual([[1, 3, 5], [10, 30, 50]]);
    expect(r.info).toMatchObject({ rows: 3, missingCells: 0 });
    expect(r.info.droppedRows).toEqual([{ reason: 'outliers', at: [1, 3], values: { a: [2, 4], b: [null, 40] } }]);
  });
  it('restores stacked exclusions in reverse order, columns added since getting missing values', () => {
    const one = excludeRows(data, info, [2], 'first');
    const two = excludeRows(one.data, one.info, [1, 4], 'second');  // rows of the shortened data: values 1 and 5
    expect(Array.from(two.data.cols[0])).toEqual([3, 4]);
    const added = { ...two.data, names: [...two.data.names, 'score'], cols: [...two.data.cols, Float64Array.from([0.3, 0.4])] };
    const back = restoreRows(added, two.info);
    expect(Array.from(back.data.cols[0])).toEqual([1, 2, 3, 4, 5]);
    expect(Array.from(back.data.cols[1])).toEqual([10, NaN, 30, 40, 50]);
    expect(Array.from(back.data.cols[2])).toEqual([NaN, NaN, 0.3, 0.4, NaN]);
    expect(back.info).toMatchObject({ rows: 5, missingCells: 4 });
    expect(back.info.droppedRows).toBeUndefined();
  });
  it('ignores rows out of range and keeps exclusions through a project file (validated)', () => {
    expect(excludeRows(data, info, [0, 9], 'none').data).toBe(data);
    const ex = excludeRows(data, info, [5], 'outlier');
    const m: ModelState = { constructs: [], paths: [], moderations: [] };
    const file = parseProject(serializeProject(m, DEFAULT_SETTINGS, ex.data, ex.info));
    expect(file.info!.droppedRows).toEqual(ex.info.droppedRows);
    expect(parseDroppedRows([{ at: [-1, 2], values: { a: [1], evil: [2] }, reason: 'x' }], ['a'])).toEqual([{ reason: 'x', at: [2], values: { a: [1] } }]);
    expect(parseDroppedRows('nope', ['a'])).toBeUndefined();
  });
});
