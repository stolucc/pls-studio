import { describe, expect, it } from 'vitest';
import { clampNum, clampStrict, isObj, oneOf } from './parse';

describe('guards for untrusted values', () => {
  it('clamps finite numbers and numbers typed into fields, and rejects everything else', () => {
    expect(clampNum(5, 1, 3, 2)).toBe(3);
    expect(clampNum(-1, 0, 1, 0.5)).toBe(0);
    expect(clampNum(2.6, 1, 10, 1, true)).toBe(3);
    // (an <input type="number"> gives its value as text)
    expect(clampNum('4', 0, 10, 7)).toBe(4);
    expect(clampNum(' 0.25 ', 0, 1, 0.5)).toBe(0.25);
    expect(clampNum('50', 0, 10, 7)).toBe(10);
    for (const bad of ['', '  ', 'abc', null, undefined, true, [2], NaN, Infinity, '1e999'])
      expect(clampNum(bad, 0, 10, 7)).toBe(7);
  });
  it('read numbers only from project files', () => {
    expect(clampStrict(5, 1, 3, 2)).toBe(3);
    expect(clampStrict(2.6, 1, 10, 1, true)).toBe(3);
    for (const bad of ['4', '0x10', ' 12 ', true, null])
      expect(clampStrict(bad, 0, 100, 7)).toBe(7);
  });
  it('accepts plain objects and listed values only', () => {
    expect(isObj({})).toBe(true);
    expect(isObj([])).toBe(false);
    expect(isObj(null)).toBe(false);
    expect(oneOf('b', ['a', 'b'] as const, 'a')).toBe('b');
    expect(oneOf('c', ['a', 'b'] as const, 'a')).toBe('a');
  });
});
