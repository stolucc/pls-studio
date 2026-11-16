import { describe, expect, it } from 'vitest';
import { rotateToImplied } from './bootstrap';
import { estimateCb } from './cbsem';
import { estimatePls } from './pls';
import {
  buildPopulation,
  compositeReliability,
  generateData,
  idealReliability,
  specFromPopulation,
  unitReliability,
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

  it('skewed indicators: Vale–Maurelli keeps the correlations, Fleishman per indicator lowers them', () => {
    // Goodhue et al.'s (2012) loadings and their extreme skew; Appendix D applies the polynomial per indicator.
    const spec: PopulationSpec = {
      constructs: [
        { name: 'K', type: 'factor', indicators: ['x1', 'x2', 'x3'], loadings: [0.7, 0.8, 0.9] },
      ],
      paths: [],
      exoCor: [],
      skew: 1.75,
      kurtosis: 3.75,
    };
    const skewOf = (x: Float64Array) => {
      const z = standardize(x);
      return z.reduce((s, v) => s + v ** 3, 0) / z.length;
    };
    const r12 = (p: PopulationSpec) => {
      const d = generateData(buildPopulation(p), 40000, 7);
      return { r: corStd(standardize(d.cols[0]), standardize(d.cols[1])), skew: skewOf(d.cols[0]) };
    };
    const vm = r12(spec);
    const direct = r12({ ...spec, nonnormal: 'fleishman' });
    expect(vm.r).toBeCloseTo(0.56, 1);
    expect(vm.skew).toBeCloseTo(1.75, 0);
    expect(direct.skew).toBeCloseTo(1.75, 0);
    // (Fleishman's correlation for two such variables: ρ(b² + 6bd + 9d²) + 2ρ²c² + 6ρ³d², .43 at ρ = .56)
    expect(direct.r).toBeCloseTo(0.43, 1);
  });
});

describe('misspecified populations', () => {
  const at = (pop: ReturnType<typeof buildPopulation>, a: string, b: string) =>
    pop.Sigma[pop.names.indexOf(a)][pop.names.indexOf(b)];

  it('a cross-loading adds λ′ · cov(η_other, ·) and keeps every variance 1', () => {
    const pop = buildPopulation({
      ...factorPop,
      crossLoadings: [{ indicator: 'x1', construct: 'W', value: 0.3 }],
    });
    // x1 = .8 X + .3 W + ε; w1 = .7 W + ε; corr(X, W) = .3
    expect(at(pop, 'x1', 'w1')).toBeCloseTo((0.8 * 0.3 + 0.3 * 1) * 0.7, 12);
    expect(at(pop, 'x1', 'x2')).toBeCloseTo((0.8 + 0.3 * 0.3) * 0.7, 12);
    pop.Sigma.forEach((r, i) => expect(r[i]).toBe(1));
    expect(pop.misspecified).toBe(true);
    expect(buildPopulation(factorPop).misspecified).toBe(false);
  });

  it('an error correlation is a correlation of the two errors', () => {
    const pop = buildPopulation({ ...factorPop, errorCors: [{ a: 'x1', b: 'x2', value: 0.4 }] });
    const theta = (l: number) => 1 - l * l;
    expect(at(pop, 'x1', 'x2')).toBeCloseTo(
      0.8 * 0.7 + 0.4 * Math.sqrt(theta(0.8) * theta(0.7)),
      12,
    );
    expect(at(pop, 'x1', 'x3')).toBeCloseTo(0.8 * 0.75, 12);
  });

  it('an omitted path shapes the population but not the estimated model', () => {
    const spec: PopulationSpec = {
      ...factorPop,
      paths: factorPop.paths.map((p) =>
        p.from === 'X' && p.to === 'Y' ? { ...p, omitted: true } : p,
      ),
    };
    const pop = buildPopulation(spec);
    expect(pop.Sigma).toEqual(buildPopulation(factorPop).Sigma);
    expect(pop.specified[0][3]).toBe(false);
    expect(specFromPopulation(spec).paths).not.toContainEqual({ from: 'X', to: 'Y' });
    expect(pop.misspecified).toBe(true);
    // Estimated without it, the model no longer fits the population exactly.
    expect(estimateCb(exactSample(spec), specFromPopulation(spec)).fit.chisq).toBeGreaterThan(1);
  });

  it('refuses what a common-factor population cannot have', () => {
    expect(() =>
      buildPopulation({
        ...compositePop,
        crossLoadings: [{ indicator: 'x1', construct: 'W', value: 0.2 }],
      }),
    ).toThrow(/composite indicator/);
    expect(() =>
      buildPopulation({
        ...factorPop,
        crossLoadings: [{ indicator: 'x1', construct: 'W', value: 0.7 }],
      }),
    ).toThrow(/no error variance/);
    expect(() =>
      buildPopulation({
        ...factorPop,
        crossLoadings: [{ indicator: 'x1', construct: 'X', value: 0.1 }],
      }),
    ).toThrow(/already loads/);
    expect(() =>
      buildPopulation({ ...factorPop, errorCors: [{ a: 'x1', b: 'zz', value: 0.1 }] }),
    ).toThrow(/unknown indicator/);
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

describe('the reliability of a composite', () => {
  const loadings = [0.9, 0.6, 0.4];
  const population = buildPopulation({
    constructs: [
      { name: 'X', type: 'factor', indicators: ['x1', 'x2', 'x3'], loadings },
      { name: 'Y', type: 'factor', indicators: ['y1', 'y2', 'y3'], loadings: [0.7, 0.7, 0.7] },
    ],
    paths: [{ from: 'X', to: 'Y', value: 0.5 }],
    exoCor: [],
  });

  it('ideal weights give coefficient H, unit weights the sum score’s ω', () => {
    // H = s / (1 + s), s = Σ λ² / (1 − λ²) (Hancock & Mueller 2001); ω = (Σλ)² / ((Σλ)² + Σ(1 − λ²)).
    const s = loadings.reduce((a, l) => a + (l * l) / (1 - l * l), 0);
    expect(idealReliability(population, 0)).toBeCloseTo(s / (1 + s), 12);
    const sum = loadings.reduce((a, l) => a + l, 0);
    const error = loadings.reduce((a, l) => a + 1 - l * l, 0);
    expect(unitReliability(population, 0)).toBeCloseTo((sum * sum) / (sum * sum + error), 12);
    // The ideal weights λ / (1 − λ²) reach H; no weights do better; the scale of the weights does not matter.
    const ideal = loadings.map((l) => l / (1 - l * l));
    expect(compositeReliability(population, 0, ideal)).toBeCloseTo(s / (1 + s), 12);
    expect(
      compositeReliability(
        population,
        0,
        ideal.map((w) => w * -3),
      ),
    ).toBeCloseTo(s / (1 + s), 12);
    expect(compositeReliability(population, 0, [1, 0, 0])).toBeCloseTo(0.81, 12);
    expect(unitReliability(population, 0)).toBeLessThan(idealReliability(population, 0));
  });

  it('measures the composite against its own construct, not a correlated one', () => {
    // With equal loadings unit weights are ideal.
    expect(unitReliability(population, 1)).toBeCloseTo(idealReliability(population, 1), 12);
    expect(population.indicatorCov[population.names.indexOf('y1')][0]).toBeCloseTo(0.7 * 0.5, 12);
  });
});
