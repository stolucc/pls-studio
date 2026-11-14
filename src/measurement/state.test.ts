// The measurement log in project files: strict validation of untrusted input (similar pairs,
// deleted items), the round trip through serializeProject / parseProject, and the edits.

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  parseProject,
  serializeProject,
  type ModelState,
} from '../model/project';
import {
  isSimilarPair,
  pairOf,
  parseMeasurement,
  withDeletedItem,
  withoutDeletedItem,
  withSimilarPair,
  type DeletedItem,
} from './state';

const ids = new Set(['a', 'b', 'c']);
const item: DeletedItem = {
  indicator: 'x3',
  construct: 'X',
  loading: 0.35,
  reason: 'Loading 0.35, below 0.40 (Hair et al. 2017, 2021).',
  before: { ave: 0.45, rhoA: 0.71, rhoC: 0.69 },
  after: { ave: 0.56, rhoA: 0.74, rhoC: 0.79 },
};

describe('parseMeasurement', () => {
  it('keeps valid pairs, sorted, once, of existing distinct constructs', () => {
    const r = parseMeasurement(
      {
        similarPairs: [
          ['b', 'a'],
          ['a', 'b'], // duplicate
          ['a', 'a'], // same construct
          ['a', 'zz'], // unknown id
          ['a'], // not a pair
          ['a', 'b', 'c'],
          [1, 2],
          'a|b',
          ['c', 'a'],
        ],
      },
      ids,
    );
    expect(r.measurement?.similarPairs).toEqual([
      ['a', 'b'],
      ['a', 'c'],
    ]);
  });

  it('keeps well-formed deleted items and drops malformed ones', () => {
    const r = parseMeasurement(
      {
        deletedItems: [
          item,
          { ...item, loading: 'high' },
          { ...item, loading: Infinity },
          { ...item, loading: 1e9 },
          { ...item, indicator: '' },
          { ...item, reason: 42 },
          { ...item, before: { ave: 0.5, rhoA: 0.7 } },
          { ...item, after: { ave: NaN, rhoA: 0.7, rhoC: 0.7 } },
          { ...item, after: undefined, note: '  checked with the scale authors  ' },
          null,
          'x',
        ],
      },
      ids,
    );
    expect(r.measurement?.deletedItems).toEqual([
      item,
      {
        indicator: 'x3',
        construct: 'X',
        loading: 0.35,
        reason: item.reason,
        note: 'checked with the scale authors',
        before: item.before,
      },
    ]);
  });

  it('cuts long text and ignores unknown fields', () => {
    const r = parseMeasurement(
      {
        deletedItems: [{ ...item, indicator: 'i'.repeat(500), note: 'n'.repeat(5000), evil: 1 }],
        extra: true,
      },
      ids,
    );
    const d = r.measurement!.deletedItems![0];
    expect(d.indicator).toHaveLength(200);
    expect(d.note).toHaveLength(1000);
    expect(Object.keys(d)).not.toContain('evil');
    expect(Object.keys(r.measurement!)).toEqual(['deletedItems']);
  });

  it('returns nothing for nothing valid', () => {
    expect(parseMeasurement(undefined, ids)).toEqual({});
    expect(parseMeasurement([], ids)).toEqual({});
    expect(parseMeasurement({ similarPairs: [['a', 'q']], deletedItems: [{}] }, ids)).toEqual({});
  });

  it('limits the number of entries', () => {
    const many = Array.from({ length: 1500 }, () => item);
    const r = parseMeasurement({ deletedItems: many }, ids);
    expect(r.measurement!.deletedItems).toHaveLength(1000);
  });
});

describe('in a project file', () => {
  const model: ModelState = {
    constructs: ['a', 'b', 'c'].map((id) => ({
      id,
      name: id.toUpperCase(),
      type: 'factor' as const,
      mode: 'A' as const,
      indicators: [`${id}1`, `${id}2`],
      x: 0,
      y: 0,
      side: 'left' as const,
    })),
    paths: [],
    moderations: [],
    measurement: { similarPairs: [['a', 'b']], deletedItems: [item] },
  };

  it('survives a round trip', () => {
    const back = parseProject(serializeProject(model, DEFAULT_SETTINGS, null, null)).model;
    expect(back.measurement).toEqual(model.measurement);
  });

  it('drops a pair whose construct is gone, and a tampered entry', () => {
    const file = JSON.parse(serializeProject(model, DEFAULT_SETTINGS, null, null));
    file.model.constructs = file.model.constructs.filter((k: { id: string }) => k.id !== 'b');
    file.model.measurement.deletedItems.push({ ...item, before: '<script>' });
    const back = parseProject(JSON.stringify(file)).model;
    expect(back.measurement).toEqual({ deletedItems: [item] });
  });

  it('a file without the field has none', () => {
    const { measurement: _m, ...plain } = model;
    const back = parseProject(serializeProject(plain, DEFAULT_SETTINGS, null, null)).model;
    expect(back.measurement).toBeUndefined();
  });
});

describe('edits', () => {
  it('marks and unmarks a pair in either order', () => {
    expect(pairOf('b', 'a')).toEqual(['a', 'b']);
    const on = withSimilarPair(undefined, 'b', 'a', true);
    expect(on).toEqual({ similarPairs: [['a', 'b']] });
    expect(isSimilarPair(on, 'a', 'b')).toBe(true);
    expect(isSimilarPair(on, 'b', 'a')).toBe(true);
    expect(isSimilarPair(on, 'a', 'c')).toBe(false);
    expect(withSimilarPair(withSimilarPair(on, 'a', 'b', true), 'a', 'b', true)).toEqual(on);
    expect(withSimilarPair(on, 'a', 'b', false)).toBeUndefined();
  });

  it('appends and removes log entries, keeping the pairs', () => {
    const log = withDeletedItem({ similarPairs: [['a', 'b']] }, item);
    expect(log?.deletedItems).toEqual([item]);
    const two = withDeletedItem(log, { ...item, indicator: 'y1' });
    expect(two?.deletedItems?.map((d) => d.indicator)).toEqual(['x3', 'y1']);
    expect(withoutDeletedItem(two, 0)?.deletedItems?.map((d) => d.indicator)).toEqual(['y1']);
    expect(withoutDeletedItem(log, 0)).toEqual({ similarPairs: [['a', 'b']] });
  });
});
