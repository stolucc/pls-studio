import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fleishman, intermediateCor, valeMaurelli } from './nonnormal';
import { buildPopulation, generateData, type PopulationSpec } from './population';
import { corStd, mean, standardize } from './stats';

interface FlRef {
  skew: number;
  kurt: number;
  a: number;
  b: number;
  c: number;
  d: number;
}
const ref: {
  fleishman: FlRef[];
  intermediate: { i: number; j: number; r: number; rho: number }[];
} = JSON.parse(readFileSync(join(__dirname, '__fixtures__', 'vale-maurelli.json'), 'utf8'));

describe('Fleishman coefficients vs high-precision R solutions', () => {
  it.each(ref.fleishman)('skew $skew, kurtosis $kurt', ({ skew, kurt, a, b, c, d }) => {
    const f = fleishman(skew, kurt);
    expect(f.a).toBeCloseTo(a, 9);
    expect(f.b).toBeCloseTo(b, 9);
    expect(f.c).toBeCloseTo(c, 9);
    expect(f.d).toBeCloseTo(d, 9);
  });
  it('matches Fleishman’s (1978) table for skewness 2, kurtosis 7', () => {
    const f = fleishman(2, 7);
    // The published table has six decimals.
    expect(f.b).toBeCloseTo(0.761585, 5);
    expect(f.c).toBeCloseTo(0.260022, 5);
    expect(f.d).toBeCloseTo(0.053072, 5);
  });
  it('rejects unattainable combinations', () => {
    expect(() => fleishman(3, 0)).toThrow(/cannot be generated/);
  });
});

describe('intermediate correlations', () => {
  it.each(ref.intermediate)('pair $i/$j, r = $r', ({ i, j, r, rho }) => {
    const f = ref.fleishman;
    const F = (k: number) => ({ a: f[k].a, b: f[k].b, c: f[k].c, d: f[k].d });
    expect(intermediateCor(F(i), F(j), r)).toBeCloseTo(rho, 9);
  });
  it('is the identity for normal variables', () => {
    expect(intermediateCor(fleishman(0, 0), fleishman(0, 0), 0.37)).toBeCloseTo(0.37, 12);
  });
  it('reports non-positive-definite intermediate matrices', () => {
    const R = [
      [1, 0.95, 0.95],
      [0.95, 1, 0.81],
      [0.95, 0.81, 1],
    ];
    expect(() => valeMaurelli(R, [2, -2, 2], [7, 7, 7])).toThrow();
  });
});

describe('non-normal populations', () => {
  const pop: PopulationSpec = {
    constructs: [
      { name: 'X', type: 'factor', indicators: ['x1', 'x2', 'x3'], loadings: [0.8, 0.7, 0.75] },
      {
        name: 'Y',
        type: 'factor',
        indicators: ['y1', 'y2', 'y3'],
        loadings: [0.75, 0.8, 0.7],
        skew: 0,
        kurtosis: 0,
      },
    ],
    paths: [{ from: 'X', to: 'Y', value: 0.5 }],
    exoCor: [],
    skew: 2,
    kurtosis: 7,
  };
  const P = buildPopulation(pop);
  const d = generateData(P, 200000, 11);
  const moments = (x: Float64Array) => {
    const z = standardize(x);
    return { skew: mean(z.map((v) => v ** 3)), kurt: mean(z.map((v) => v ** 4)) - 3 };
  };

  it('hits the target skewness and kurtosis, with per-construct overrides', () => {
    const m = moments(d.cols[0]);
    expect(m.skew).toBeCloseTo(2, 0);
    expect(Math.abs(m.kurt - 7)).toBeLessThan(1.2); // sample kurtosis converges slowly
    const y = moments(d.cols[3]);
    expect(Math.abs(y.skew)).toBeLessThan(0.05);
    expect(Math.abs(y.kurt)).toBeLessThan(0.1);
  });

  it('preserves the population correlations', () => {
    const Z = d.cols.map((c) => standardize(c));
    expect(corStd(Z[0], Z[1])).toBeCloseTo(P.Sigma[0][1], 2);
    expect(corStd(Z[0], Z[4])).toBeCloseTo(P.Sigma[0][4], 2);
    expect(corStd(Z[3], Z[5])).toBeCloseTo(P.Sigma[3][5], 2);
  });

  it('stays multivariate normal by default', () => {
    expect(buildPopulation({ ...pop, skew: 0, kurtosis: 0 }).vm).toBeNull();
  });
});
