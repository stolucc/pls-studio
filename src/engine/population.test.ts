import { describe, expect, it } from 'vitest';
import { rotateToImplied } from './bootstrap';
import { estimateCb } from './cbsem';
import { estimatePls } from './pls';
import {
  buildPopulation,
  generateData,
  specFromPopulation,
  type PopulationSpec,
} from './population';
import { corStd, standardize } from './stats';
import type { Dataset } from './types';

const factorPop: PopulationSpec = {
  constructs: [
    { name: 'X', type: 'factor', indicators: ['x1', 'x2', 'x3'], loadings: [0.8, 0.7, 0.75] },
    { name: 'W', type: 'factor', indicators: ['w1', 'w2', 'w3'], loadings: [0.7, 0.85, 0.6] },
    { name: 'M', type: 'factor', indicators: ['m1', 'm2', 'm3'], loadings: [0.75, 0.8, 0.7] },
    { name: 'Y', type: 'factor', indicators: ['y1', 'y2', 'y3'], loadings: [0.8, 0.8, 0.65] },
  ],
  paths: [
    { from: 'X', to: 'M', value: 0.4 },
    { from: 'W', to: 'M', value: 0.2 },
    { from: 'M', to: 'Y', value: 0.5 },
    { from: 'X', to: 'Y', value: 0.15 },
  ],
  exoCor: [{ a: 'X', b: 'W', value: 0.3 }],
};
const compositePop: PopulationSpec = {
  constructs: factorPop.constructs.map((c) => ({
    name: c.name,
    type: 'composite' as const,
    indicators: c.indicators,
    weights: [0.5, 0.3, 0.4],
    withinCor: 0.45,
  })),
  paths: factorPop.paths,
  exoCor: factorPop.exoCor,
};

/** A sample whose correlation matrix equals the population Σ exactly. */
function exactSample(spec: PopulationSpec, n = 400): Dataset {
  const pop = buildPopulation(spec);
  const d = generateData(pop, n, 7);
  const Z = d.cols.map((c) => standardize(c));
  const R = Z.map((a) => Z.map((b) => corStd(a, b)));
  return { names: d.names, cols: rotateToImplied(Z, R, pop.Sigma) };
}

describe('population model', () => {
  const pop = buildPopulation(factorPop);

  it('standardises every construct and derives R² and indirect effects', () => {
    pop.Phi.forEach((r, i) => expect(r[i]).toBe(1));
    expect(pop.Phi[0][1]).toBeCloseTo(0.3, 12);
    // Var(M) = 1: R² = .4² + .2² + 2·.4·.2·.3
    expect(pop.r2[2]).toBeCloseTo(0.16 + 0.04 + 0.048, 12);
    expect(pop.indirect[0][3]).toBeCloseTo(0.4 * 0.5, 12);
    pop.Sigma.forEach((r, i) => expect(r[i]).toBe(1));
  });

  it('rejects impossible populations', () => {
    expect(() =>
      buildPopulation({ ...factorPop, paths: [{ from: 'X', to: 'Y', value: 1.2 }] }),
    ).toThrow(/R² ≥ 1/);
    expect(() =>
      buildPopulation({
        ...factorPop,
        paths: [...factorPop.paths, { from: 'Y', to: 'X', value: 0.1 }],
      }),
    ).toThrow(/cycle/);
  });

  it('generates data whose correlations approach Σ', () => {
    const d = generateData(pop, 20000, 3);
    const Z = d.cols.map((c) => standardize(c));
    expect(corStd(Z[0], Z[1])).toBeCloseTo(pop.Sigma[0][1], 1);
    expect(corStd(Z[0], Z[9])).toBeCloseTo(pop.Sigma[0][9], 1);
    // Same seed, same data.
    expect(generateData(pop, 50, 3).cols[4]).toEqual(generateData(pop, 50, 3).cols[4]);
  });
});

describe('estimators recover the population from an exact sample', () => {
  it('CB-SEM ML recovers standardised paths of a common-factor population', () => {
    const cb = estimateCb(exactSample(factorPop), specFromPopulation(factorPop));
    for (const p of factorPop.paths) {
      const i = cb.constructs.indexOf(p.from),
        j = cb.constructs.indexOf(p.to);
      expect(cb.stdPaths[i][j]).toBeCloseTo(p.value, 6);
    }
    expect(cb.fit.chisq).toBeLessThan(1e-6);
  });

  it('PLSc recovers paths of a common-factor population; plain PLS is attenuated', () => {
    const d = exactSample(factorPop);
    const plsc = estimatePls(d, specFromPopulation(factorPop), {
      consistent: true,
      tolerance: 1e-12,
      maxIter: 1000,
    });
    const pls = estimatePls(d, specFromPopulation(factorPop), { tolerance: 1e-12, maxIter: 1000 });
    const i = plsc.constructs.indexOf('M'),
      j = plsc.constructs.indexOf('Y');
    expect(plsc.pathCoef[i][j]).toBeCloseTo(0.5, 6);
    expect(pls.pathCoef[i][j]).toBeLessThan(0.5);
  });

  it('PLS (Mode B) recovers paths of a composite population', () => {
    const pls = estimatePls(exactSample(compositePop), specFromPopulation(compositePop), {
      tolerance: 1e-12,
      maxIter: 1000,
    });
    for (const p of compositePop.paths) {
      expect(
        pls.pathCoef[pls.constructs.indexOf(p.from)][pls.constructs.indexOf(p.to)],
      ).toBeCloseTo(p.value, 6);
    }
    expect(pls.fit.estimated.srmr).toBeLessThan(1e-6);
  });
});
