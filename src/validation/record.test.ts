import { describe, expect, it } from 'vitest';
import { definitionHash, UNHASHED_FIELDS } from './record';

describe('definitionHash', () => {
  const def = { id: 'x', settings: { method: 'cbsem', b: 1 }, paths: [['a', 'b']] };

  it('ignores key order', () => {
    expect(definitionHash({ paths: [['a', 'b']], settings: { b: 1, method: 'cbsem' }, id: 'x' })).toBe(definitionHash(def));
  });

  it('changes with what is estimated', () => {
    expect(definitionHash({ ...def, settings: { method: 'pls', b: 1 } })).not.toBe(definitionHash(def));
  });

  it('leaves out what an example shows and the messages it is expected to raise, so rewording them keeps its evidence current', () => {
    expect(UNHASHED_FIELDS).toEqual(['shows', 'expectedMessages']);
    expect(definitionHash({ ...def, shows: 'What it shows.', expectedMessages: [{ pattern: 'p', why: 'w' }] })).toBe(definitionHash(def));
    // (only at the top level: a nested field of the same name is part of the definition)
    expect(definitionHash({ ...def, settings: { ...def.settings, shows: 1 } })).not.toBe(definitionHash(def));
  });

  it('hashes non-objects as before', () => {
    expect(definitionHash(null)).toBe(definitionHash(undefined));
    expect(definitionHash([1, 2])).not.toBe(definitionHash([2, 1]));
  });
});
