import { describe, expect, it } from 'vitest';
import { clampNum, isObj, oneOf } from './parse';

describe('guards for untrusted values', () => {
  it('clamps finite numbers and rejects everything else, strings included', () => {
    expect(clampNum(5, 1, 3, 2)).toBe(3);
    expect(clampNum(-1, 0, 1, 0.5)).toBe(0);
    expect(clampNum(2.6, 1, 10, 1, true)).toBe(3);
    for (const bad of ['2', '', null, undefined, true, [2], NaN, Infinity]) expect(clampNum(bad, 0, 10, 7)).toBe(7);
  });
  it('accepts plain objects and listed values only', () => {
    expect(isObj({})).toBe(true);
    expect(isObj([])).toBe(false);
    expect(isObj(null)).toBe(false);
    expect(oneOf('b', ['a', 'b'] as const, 'a')).toBe('b');
    expect(oneOf('c', ['a', 'b'] as const, 'a')).toBe('a');
  });
});
