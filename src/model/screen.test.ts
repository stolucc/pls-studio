import { describe, expect, it } from 'vitest';
import { farOut, flaggedCases, influentialCases, mardiaVerdict, normalityLevel } from './screen';

describe('data screening rules', () => {
  it('grades univariate non-normality (West, Finch & Curran 1995)', () => {
    expect(normalityLevel(0.4, 0.5)).toBe('ok');
    expect(normalityLevel(-1.5, 0)).toBe('moderate');
    expect(normalityLevel(0, 3.5)).toBe('moderate');
    expect(normalityLevel(2.1, 0)).toBe('severe');
    expect(normalityLevel(0, -7.5)).toBe('severe');
  });
  it('flags Mahalanobis outliers below alpha, most extreme first', () => {
    const cases = { rows: [1, 2, 4, 9], d2: [3, 40, 28, 10], p: [0.9, 0.00001, 0.0007, 0.3] };
    expect(flaggedCases(cases, 0.001)).toEqual([{ row: 2, d2: 40, p: 0.00001 }, { row: 4, d2: 28, p: 0.0007 }]);
    expect(flaggedCases(cases, 0.0001)).toHaveLength(1);
  });
  it('ranks influential cases by generalized Cook’s distance, flagging those far out (Q3 + 3 IQR)', () => {
    // Quartiles as R's quantile(type = 7): 0.1, 0.2, 0.3, ..., Q1 = 0.3, Q3 = 0.7 for 0.1..0.9 → fence 1.9.
    const gcd = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 2.5];
    expect(farOut(gcd.slice(0, 9))).toBeCloseTo(0.7 + 3 * 0.4, 10);
    const r = { rows: gcd.map((_, i) => i + 1), gcd };
    expect(influentialCases(r, 2)).toEqual([{ row: 10, gcd: 2.5, flagged: true }, { row: 9, gcd: 0.9, flagged: false }]);
    expect(farOut([1, 2])).toBe(Infinity);
  });
  it('reads Mardia’s test, with the small-sample skewness test below n = 20', () => {
    expect(mardiaVerdict({ pSkew: 0.3, pSmall: 0.2, pKurt: 0.4, n: 300 }).normal).toBe(true);
    const v = mardiaVerdict({ pSkew: 1e-10, pSmall: 1e-10, pKurt: 0.02, n: 300 });
    expect(v.normal).toBe(false);
    expect(v.text).toContain('skewness and kurtosis');
    expect(mardiaVerdict({ pSkew: 0.01, pSmall: 0.2, pKurt: 0.5, n: 15 })).toMatchObject({ normal: true, skewP: 0.2 });
  });
});
