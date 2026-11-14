import { expect, it } from 'vitest';
import { rBound, rNum } from './rjson';

it('reads an infinite bound from R ("Inf" / "-Inf"), and tells it from a missing one (null)', () => {
  expect(rBound('Inf')).toBe(Infinity);
  expect(rBound('-Inf')).toBe(-Infinity);
  expect(rBound(1.5)).toBe(1.5);
  expect(rBound(null)).toBeNull();
  expect(rBound(undefined)).toBeNull();
  expect(rBound('NA')).toBeNull();
  // (elsewhere a non-finite value stays missing)
  expect(rNum('Inf')).toBeNull();
});
