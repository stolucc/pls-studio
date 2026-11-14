// Values per group: lavaan's c(...) lists them in lavaan's group order (first appearance in the data), the app
// in the order of the group codes. Syntax and projects from before format 3 are in lavaan's order: marked, and
// converted with the data they refer to.

import { describe, expect, it } from 'vitest';
import type { Dataset } from '../engine/types';
import { codeOrderValues, groupOrder } from './heldValue';
import {
  DEFAULT_SETTINGS,
  parseProject,
  serializeProject,
  toSpec,
  type ModelState,
} from './project';
import { parseLavaanSyntax } from './syntax';

// Groups 3, 1, 2 in the order they first appear in the rows.
const data: Dataset = {
  names: ['x1', 'x2', 'x3', 'g'],
  cols: [
    Float64Array.from([1, 2, 3, 4, 5, 6]),
    Float64Array.from([2, 1, 4, 3, 6, 5]),
    Float64Array.from([3, 3, 1, 1, 2, 2]),
    Float64Array.from([3, 1, 2, 3, 1, 2]),
  ],
};
const SYNTAX = 'f =~ x1 + x2 + x3\nf ~~ c(0.5, NA, 2)*f\nf ~ c(NA, 0, NA)*1';
const withGroups = (m: ModelState): ModelState => ({
  ...m,
  multigroup: { column: 'g', invariance: 'configural', free: [] },
});
const variance = (m: ModelState) => m.parameters!.find((t) => t.kind === 'variance')!.byGroup;
const mean = (m: ModelState) => m.means![0].byGroup;

describe('values per group from lavaan syntax', () => {
  it('are kept in lavaan’s order and marked so until the data are known', () => {
    const m = withGroups(parseLavaanSyntax(SYNTAX).model);
    expect(m.groupValueOrder).toBe('appearance');
    expect(variance(m)).toEqual([0.5, null, 2]);
    // (R writes them as given: lavaan's order)
    expect(toSpec(m).multigroup!.valueOrder).toBe('appearance');
    expect(groupOrder(data, 'g', true)).toEqual(['3', '1', '2']);
    expect(parseLavaanSyntax('f =~ x1 + x2 + x3').model.groupValueOrder).toBeUndefined();
  });

  it('go to the order of the group codes with the data, the same values for the same groups', () => {
    const m = codeOrderValues(withGroups(parseLavaanSyntax(SYNTAX).model), data);
    expect(m.groupValueOrder).toBeUndefined();
    // group 3 had 0.5, group 1 NA, group 2 2: in code order 1, 2, 3
    expect(variance(m)).toEqual([null, 2, 0.5]);
    expect(mean(m)).toEqual([0, null, null]);
    expect(toSpec(m).multigroup!.valueOrder).toBeUndefined();
  });

  it('stay as they are without data or groups, and a stacked dataset keeps its order', () => {
    const m = withGroups(parseLavaanSyntax(SYNTAX).model);
    expect(codeOrderValues(m, null)).toBe(m);
    const { multigroup: _g, ...noGroups } = m;
    expect(codeOrderValues(noGroups, data)).toBe(noGroups);
    const stacked: Dataset = {
      names: ['x1'],
      cols: [],
      moments: {
        S: [[1]],
        n: 20,
        groups: [
          { label: 'B', S: [[1]], n: 10 },
          { label: 'A', S: [[1]], n: 10 },
        ],
      },
    } as Dataset;
    const s = codeOrderValues(m, stacked);
    expect(s.groupValueOrder).toBeUndefined();
    expect(variance(s)).toEqual([0.5, null, 2]);
  });
});

describe('projects saved before format 3', () => {
  const file = (version: number, model: ModelState, d: Dataset | null) => {
    const json = JSON.parse(
      serializeProject(
        model,
        DEFAULT_SETTINGS,
        d,
        d ? { fileName: 'd.csv', rows: 6, missingCells: 0, excluded: [] } : null,
      ),
    );
    return JSON.stringify({ ...json, version });
  };
  // A model as a format-2 project stored it: values in lavaan's order (groups 3, 1, 2 in the data).
  const { groupValueOrder: _m, ...stored } = withGroups(parseLavaanSyntax(SYNTAX).model);

  it('get their values per group in code order from their own data (the same results as before)', () => {
    const m = parseProject(file(2, stored, data)).model;
    expect(m.groupValueOrder).toBeUndefined();
    expect(variance(m)).toEqual([null, 2, 0.5]);
  });

  it('without data keep lavaan’s order, marked', () => {
    const m = parseProject(file(2, stored, null)).model;
    expect(m.groupValueOrder).toBe('appearance');
    expect(variance(m)).toEqual([0.5, null, 2]);
  });

  it('format 3 values are in code order already; a marked model is converted once data are there', () => {
    const now = parseProject(file(3, stored, data)).model;
    expect(variance(now)).toEqual([0.5, null, 2]);
    expect(now.groupValueOrder).toBeUndefined();
    const marked = parseProject(file(3, { ...stored, groupValueOrder: 'appearance' }, data)).model;
    expect(variance(marked)).toEqual([null, 2, 0.5]);
    // Saved and opened again: unchanged.
    const again = parseProject(file(3, marked, data)).model;
    expect(variance(again)).toEqual([null, 2, 0.5]);
  });
});

it('a marker intercept per group (bias) is put in code order too', () => {
  const m = withGroups(parseLavaanSyntax('f =~ x1 + x2 + x3\nf ~~ c(1, 1, 1)*f').model);
  const target = m.constructs[0].id;
  const biased: ModelState = { ...m, means: [{ id: 'b', target, bias: [0.3, 0.1, 0.2] }] };
  expect(codeOrderValues(biased, data).means![0].bias).toEqual([0.1, 0.2, 0.3]);
});
