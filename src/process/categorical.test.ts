// The codes of a multicategorical X against PROCESS's coding tables (three groups).

import { describe, expect, it } from 'vitest';
import { codeValue, dummies, expandPlan, type XCoding } from './categorical';
import { planFor } from './plan';
import { materialise, template } from './templates';

import ext from './__fixtures__/reference/extensions.json';

describe('multicategorical X', () => {
  it.each([[1, 'indicator'], [2, 'sequential'], [3, 'helmert'], [4, 'effect']] as const)('mcx = %i (%s) codes as PROCESS', (mcx, coding) => {
    const rows = (ext as unknown as Record<string, { coding: { rows: { values: number[] }[] } }>)[`mcx${mcx}_model4`].coding.rows;
    rows.forEach((r, g) => [0, 1].forEach((j) => expect(codeValue(coding as XCoding, 3, g, j)).toBeCloseTo(r.values[j + 1], 6)));
  });

  it('turns a column into codes and the plan into relative effects', () => {
    const d = dummies('G', Float64Array.from([3, 1, 2, NaN]), 'indicator');
    expect(d.levels).toEqual([1, 2, 3]);
    expect(d.names).toEqual(['G D1', 'G D2']);
    expect([...d.codes[0]]).toEqual([0, 0, 1, NaN]);
    expect(() => dummies('G', Float64Array.from([1, 1]), 'indicator')).toThrow(/fewer than two groups/);
    const plan = expandPlan(planFor(materialise(template(7)!, { x: 'G', y: 'Y', m: ['M'], w: 'W' })), 'G', d.names);
    expect(plan.equations[0].terms).toEqual([['G D1'], ['G D2'], ['W'], ['G D1', 'W'], ['G D2', 'W']]);
    expect(plan.indirect.map((p) => p.vars)).toEqual([['G D1', 'M', 'Y'], ['G D2', 'M', 'Y']]);
    expect(plan.directs).toEqual([{ x: 'G D1', moderators: [] }, { x: 'G D2', moderators: [] }]);
  });
});
