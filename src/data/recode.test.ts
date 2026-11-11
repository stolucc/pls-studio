import { expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parseProject, serializeProject, type DataInfo } from '../model/project';
import { observedRange, reverseCode } from './recode';

const data = {
  names: ['a', 'b', 'g'],
  cols: [Float64Array.of(1, 2, 5, NaN), Float64Array.of(3, 3, 4, 1), Float64Array.of(1, 2, 1, 2)],
  categories: { g: ['x', 'y'] },
};
const info: DataInfo = { fileName: 'd.csv', rows: 4, missingCells: 1, excluded: [] };

it('reverses on the given scale, keeps missing values, and undoes on a second run', () => {
  const r = reverseCode(data, info, ['a', 'b'], 1, 5);
  expect(Array.from(r.data.cols[0])).toEqual([5, 4, 1, NaN]);
  expect(Array.from(r.data.cols[1])).toEqual([3, 3, 2, 5]);
  expect(r.info.reversed).toEqual([
    { name: 'a', min: 1, max: 5 },
    { name: 'b', min: 1, max: 5 },
  ]);
  expect(r.undone).toEqual([]);
  const back = reverseCode(r.data, r.info, ['a'], 1, 5);
  expect(Array.from(back.data.cols[0])).toEqual([1, 2, 5, NaN]);
  expect(back.undone).toEqual(['a']);
  expect(back.info.reversed).toEqual([{ name: 'b', min: 1, max: 5 }]);
  expect(data.cols[0][0]).toBe(1); // the input is not changed
});

it('refuses values outside the scale, text columns, another scale for a reversed item, and empty scales', () => {
  expect(() => reverseCode(data, info, ['a'], 1, 4)).toThrow(/outside 1–4/);
  expect(() => reverseCode(data, info, ['g'], 1, 2)).toThrow(/text column/);
  const r = reverseCode(data, info, ['a'], 1, 5);
  expect(() => reverseCode(r.data, r.info, ['a'], 0, 6)).toThrow(
    /already reversed on the scale 1–5/,
  );
  expect(() => reverseCode(data, info, ['a'], 5, 1)).toThrow(/lowest value below/);
});

it('the observed range and project files', () => {
  expect(observedRange(data, ['a', 'b'])).toEqual([1, 5]);
  const r = reverseCode(data, info, ['b'], 1, 7);
  const model = { constructs: [], paths: [], moderations: [] };
  const p = parseProject(serializeProject(model, DEFAULT_SETTINGS, r.data, r.info));
  expect(p.info!.reversed).toEqual([{ name: 'b', min: 1, max: 7 }]);
  expect(Array.from(p.data!.cols[1])).toEqual([5, 5, 4, 7]);
});
