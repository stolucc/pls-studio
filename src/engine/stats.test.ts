import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mulberry32, quantileSorted, sd, standardize, tTestP } from './stats';
import { invert, SingularMatrixError } from './linalg';

describe('tTestP', () => {
  const ref: { t: number; df: number; p: number }[] = JSON.parse(readFileSync(join(__dirname, '__fixtures__', 'tdist.json'), 'utf8'));
  it.each(ref)('matches R 2*pt(-|t|, df) for t=$t df=$df', ({ t, df, p }) => {
    expect(tTestP(t, df)).toBeCloseTo(p, 10);
    expect(tTestP(-t, df)).toBeCloseTo(p, 10);
  });
  it('handles infinite t', () => expect(tTestP(Infinity, 10)).toBe(0));
});

describe('stats helpers', () => {
  it('standardize gives mean 0 sd 1 and rejects constants', () => {
    const z = standardize([1, 2, 3, 4, 10]);
    expect(z.reduce((a, b) => a + b, 0)).toBeCloseTo(0, 12);
    expect(sd(z)).toBeCloseTo(1, 12);
    expect(() => standardize([2, 2, 2], 'X')).toThrow(/"X" has zero variance/);
  });
  it('quantileSorted matches R type 7', () => {
    expect(quantileSorted([1, 2, 3, 4], 0.25)).toBeCloseTo(1.75, 12);
    expect(quantileSorted([1, 2, 3, 4], 0.975)).toBeCloseTo(3.925, 12);
  });
  it('mulberry32 is deterministic per seed', () => {
    const a = mulberry32(42), b = mulberry32(42), c = mulberry32(43);
    const sa = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(sa);
    expect(c()).not.toBe(sa[0]);
    expect(sa.every((v) => v >= 0 && v < 1)).toBe(true);
  });
  it('invert works and detects singular matrices', () => {
    const inv = invert([[4, 7], [2, 6]]);
    expect(inv[0][0]).toBeCloseTo(0.6, 12);
    expect(inv[1][0]).toBeCloseTo(-0.2, 12);
    expect(() => invert([[1, 2], [2, 4]])).toThrow(SingularMatrixError);
  });
});

import { bisect, chisqCdf, ncChisqCdf, normalP, qlogis, qnorm } from './stats';
import { cholesky, invertPD, logDetPD, matMul, symEigen, symMatFn } from './linalg';

describe('chi-square distributions', () => {
  const ref: { x: number; df: number; p: number; pnc: number }[] = JSON.parse(readFileSync(join(__dirname, '__fixtures__', 'chisq.json'), 'utf8'));
  it.each(ref)('match R pchisq for x=$x df=$df', ({ x, df, p, pnc }) => {
    expect(chisqCdf(x, df)).toBeCloseTo(p, 10);
    expect(ncChisqCdf(x, df, 4.5)).toBeCloseTo(pnc, 9);
  });
  it('normal two-tailed p', () => {
    expect(normalP(1.959963984540054)).toBeCloseTo(0.05, 12);
    expect(normalP(0)).toBeCloseTo(1, 12);
  });
  it('bisect finds a root', () => expect(bisect((x) => x * x - 2, 0, 2)).toBeCloseTo(Math.SQRT2, 8));
});

describe('positive-definite and eigen helpers', () => {
  const A = [[4, 1, 0.5], [1, 3, 0.2], [0.5, 0.2, 2]];
  it('cholesky, logdet and inverse', () => {
    const L = cholesky(A)!;
    const inv = invertPD(L);
    const I = matMul(A, inv);
    I.forEach((r, i) => r.forEach((v, j) => expect(v).toBeCloseTo(i === j ? 1 : 0, 12)));
    expect(logDetPD(L)).toBeCloseTo(Math.log(4 * (3 * 2 - 0.04) - 1 * (2 - 0.1) + 0.5 * (0.2 - 1.5)), 12);
    expect(cholesky([[1, 2], [2, 1]])).toBeNull();
  });
  it('symEigen reconstructs and symMatFn gives a square root', () => {
    const { values } = symEigen(A);
    expect(values.reduce((s, v) => s + v, 0)).toBeCloseTo(9, 10);
    const R = symMatFn(A, Math.sqrt);
    matMul(R, R).forEach((r, i) => r.forEach((v, j) => expect(v).toBeCloseTo(A[i][j], 10)));
  });
});

describe('logistic quantile', () => {
  it('is ln(p / (1 − p)), kept finite by eps', () => {
    expect(qlogis(0.5)).toBe(0);
    expect(qlogis(0.75)).toBeCloseTo(Math.log(3), 12);
    expect(qlogis(0, 1e-4)).toBeCloseTo(Math.log(1e-4 / (1 - 1e-4)), 12);
    expect(qlogis(1, 1e-4)).toBeCloseTo(-qlogis(0, 1e-4), 12);
    // the starting values of the integration engines: qnorm agrees with Acklam's approximation used before
    expect(qnorm(0.975)).toBeCloseTo(1.959963985, 8);
  });
});
