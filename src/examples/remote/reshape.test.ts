// The reshapes applied after loading downloaded data (reshape.ts): small cases, and the two examples that use them
// on their cached data (npm run data:fetch), against what their descriptions and Mplus outputs say.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Dataset } from '../../engine/types';
import { PACKAGE_EXAMPLES } from '../packages';
import { DATA_CACHE, remoteTestData } from '../testData';
import { reshape } from './reshape';

const ds = (cols: Record<string, number[]>): Dataset => ({ names: Object.keys(cols), cols: Object.values(cols).map((c) => Float64Array.from(c)) });
const rows = (d: Dataset) => Array.from(d.cols[0], (_, i) => d.cols.map((c) => c[i]));

describe('reshapes after loading', () => {
  it('person-period: a row per period at risk, until the event or the first missing period', () => {
    const d = reshape(ds({ u1: [0, 1, 0], u2: [1, NaN, 0], u3: [NaN, NaN, NaN], x: [5, 6, 7] }),
      { kind: 'personPeriod', events: ['u1', 'u2', 'u3'], id: 'id', period: 'period', event: 'u' });
    expect(d.names).toEqual(['id', 'period', 'u', 'x']);
    expect(rows(d)).toEqual([[1, 1, 0, 5], [1, 2, 1, 5], [2, 1, 1, 6], [3, 1, 0, 7], [3, 2, 0, 7]]);
  });

  it('wide to long (Mplus DATA WIDETOLONG): a row per id and repetition from 0, the other columns repeated', () => {
    const d = reshape(ds({ y1: [1, 2], z: [9, 8], y2: [3, 4], a1: [5, 6], a2: [7, NaN] }),
      { kind: 'wideToLong', wide: [['y1', 'y2'], ['a1', 'a2']], long: ['y', 'a'], id: 'person', repetition: 'time' });
    expect(d.names).toEqual(['person', 'time', 'y', 'a', 'z']);
    expect(rows(d)).toEqual([[1, 0, 1, 5, 9], [1, 1, 3, 7, 9], [2, 0, 2, 6, 8], [2, 1, 4, NaN, 8]]);
    expect(() => reshape(d, { kind: 'wideToLong', wide: [['y']], long: ['y', 'z'], id: 'i', repetition: 't' })).toThrow();
    expect(() => reshape(d, { kind: 'personPeriod', events: ['nope'], id: 'i', period: 'p', event: 'e' })).toThrow('no column nope');
  });
});

const cached = (key: string) => existsSync(join(DATA_CACHE, 'mplus', `ex${key}.csv`));
const remote = (id: string) => PACKAGE_EXAMPLES.find((e) => e.id === id)!.data.remote!;

describe.skipIf(!cached('6.19') || !cached('9.16'))('the examples’ reshapes on their data', () => {
  it('ex6.19: 500 persons give 1545 person-periods (the card’s n), each person’s rows ending at the event or period 4', () => {
    const d = remoteTestData(remote('mplus-ex6.19'));
    expect(d.names).toEqual(['id', 'period', 'u', 'x']);
    expect(d.cols[0].length).toBe(1545);
    const r = rows(d);
    expect(new Set(r.map((x) => x[0])).size).toBe(500);
    r.forEach((x, i) => {
      const next = r[i + 1];
      if (next?.[0] === x[0]) expect([x[2], next[1]]).toEqual([0, x[1] + 1]);
    });
  });

  it('ex9.16: 500 persons at four occasions, time 0–3', () => {
    const d = remoteTestData(remote('mplus-ex9.16'));
    expect(d.names).toEqual(['person', 'time', 'y', 'a3', 'x1', 'x2']);
    expect(d.cols[0].length).toBe(2000);
    expect(Array.from(d.cols[1].subarray(0, 8))).toEqual([0, 1, 2, 3, 0, 1, 2, 3]);
  });
});
