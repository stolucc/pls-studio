import { describe, expect, it } from 'vitest';
import { rotateToImplied } from './bootstrap';
import { estimateCb } from './cbsem';
import { cholesky } from './linalg';
import { estimatePls } from './pls';
import {
  buildPopulation,
  compositeReliability,
  generateData,
  idealReliability,
  normalRng,
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
    // Leaving out a path that is zero in the population is no misspecification
    const zero = { ...spec, paths: spec.paths.map((p) => (p.omitted ? { ...p, value: 0 } : p)) };
    expect(buildPopulation(zero).misspecified).toBe(false);
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

describe('a composite with its own indicator correlation matrix (Cho, Sarstedt & Hwang 2022)', () => {
  // (Table S10: the block of three whose first principal component has loadings .6, .7, .8)
  const S10 = [
    [1, 0.1225, 0.2603],
    [0.1225, 1, 0.3369],
    [0.2603, 0.3369, 1],
  ];
  const spec = (within: number[][]): PopulationSpec => ({
    constructs: [
      {
        name: 'A',
        type: 'composite',
        indicators: ['a1', 'a2', 'a3'],
        weights: [0.4027, 0.4698, 0.5369],
        withinMatrix: within,
      },
      { name: 'B', type: 'factor', indicators: ['b1', 'b2', 'b3'], loadings: [0.7, 0.7, 0.7] },
    ],
    paths: [{ from: 'A', to: 'B', value: 0.4 }],
    exoCor: [],
  });

  it('takes the block as given, and the composite loadings Σw come out .6, .7, .8', () => {
    const pop = buildPopulation(spec(S10));
    for (let a = 0; a < 3; a++)
      for (let d = 0; d < 3; d++) expect(pop.Sigma[a][d]).toBeCloseTo(S10[a][d], 12);
    // cov(a_i, b_1) = λ_i · .4 · .7
    [0.6, 0.7, 0.8].forEach((l, i) => expect(pop.Sigma[i][3]).toBeCloseTo(l * 0.4 * 0.7, 3));
  });

  it('refuses a matrix of the wrong size or without 1 on the diagonal', () => {
    expect(() =>
      buildPopulation(
        spec([
          [1, 0.2],
          [0.2, 1],
        ]),
      ),
    ).toThrow('3 × 3');
    const half = S10.map((row, a) => row.map((v, d) => (a === d ? 0.5 : v)));
    expect(() => buildPopulation(spec(half))).toThrow('1 on the diagonal');
  });
});

describe('latent interactions (Chin et al. 2003)', () => {
  const factor = (name: string) => ({
    name,
    type: 'factor' as const,
    indicators: [1, 2, 3].map((i) => `${name.toLowerCase()}${i}`),
    loadings: [0.7, 0.7, 0.7],
  });
  const spec = (r: number, more: Partial<PopulationSpec> = {}): PopulationSpec => ({
    constructs: [factor('X'), factor('Z'), factor('Y')],
    paths: [
      { from: 'X', to: 'Y', value: 0.3 },
      { from: 'Z', to: 'Y', value: 0.5 },
    ],
    exoCor: [{ a: 'X', b: 'Z', value: r }],
    interactions: [{ a: 'X', b: 'Z', to: 'Y', value: 0.3 }],
    ...more,
  });

  it('adds v² Var(XZ) to R², leaves Σ to the linear part and keeps Y standardised', () => {
    const pop = buildPopulation(spec(0));
    // R² = .3² + .5² + .3² (Var XZ = 1 with uncorrelated factors); ψ = 1 − R²
    expect(pop.r2[2]).toBeCloseTo(0.43, 12);
    expect(pop.latent!.psi).toEqual([0, 0, expect.closeTo(0.57, 12)]);
    expect(pop.latent!.exogenous).toEqual([true, true, false]);
    const linear = buildPopulation({ ...spec(0), interactions: undefined });
    expect(pop.Sigma).toEqual(linear.Sigma);
    expect(pop.interactions).toEqual([{ a: 0, b: 1, to: 2, value: 0.3, standardised: 0.3 }]);
    // Correlated .3: Var(XZ) = 1 + .3², so the standardised coefficient is .3 · √1.09
    const correlated = buildPopulation(spec(0.3));
    expect(correlated.interactions[0].standardised).toBeCloseTo(0.3 * Math.sqrt(1.09), 12);
    expect(correlated.r2[2]).toBeCloseTo(0.09 + 0.25 + 2 * 0.3 * 0.5 * 0.3 + 0.09 * 1.09, 12);
    expect(buildPopulation({ ...spec(0), interactions: undefined }).latent).toBeNull();
  });

  it('refuses an endogenous factor in the product, composites, non-normal data and an R² of 1', () => {
    const onY = { interactions: [{ a: 'X', b: 'Y', to: 'Y', value: 0.3 }] };
    expect(() => buildPopulation(spec(0, onY))).toThrow('exogenous');
    const composite = { ...factor('Z'), type: 'composite' as const, weights: [1, 1, 1] };
    expect(() =>
      buildPopulation(spec(0, { constructs: [factor('X'), composite, factor('Y')] })),
    ).toThrow('common factor');
    expect(() => buildPopulation(spec(0, { skew: 1 }))).toThrow('normal data');
    const big = { interactions: [{ a: 'X', b: 'Z', to: 'Y', value: 0.9 }] };
    expect(() => buildPopulation(spec(0, big))).toThrow('R² ≥ 1');
    const unknown = { interactions: [{ a: 'X', b: 'Q', to: 'Y', value: 0.3 }] };
    expect(() => buildPopulation(spec(0, unknown))).toThrow('unknown construct "Q"');
    const twice = {
      interactions: [
        { a: 'X', b: 'Z', to: 'Y', value: 0.3 },
        { a: 'Z', b: 'X', to: 'Y', value: 0.1 },
      ],
    };
    expect(() => buildPopulation(spec(0, twice))).toThrow('Z × X on "Y" is listed twice');
    const noMain = { paths: [{ from: 'X', to: 'Y', value: 0.3 }] };
    expect(() => buildPopulation(spec(0, noMain))).toThrow('needs the path Z → Y (it may be 0)');
  });

  // The constructs' scores drawn as mc.R's generateLatent does: exogenous factors, then each endogenous one from
  // its predictors, its centred products and a residual of variance ψ.
  const drawLatent = (pop: ReturnType<typeof buildPopulation>, n: number) => {
    const { B, psi, order, exogenous } = pop.latent!;
    const J = pop.constructs.length;
    const L = cholesky(
      pop.Phi.map((r, i) => r.map((v, j) => (exogenous[i] && exogenous[j] ? v : +(i === j)))),
    )!;
    const rng = normalRng(7);
    return Array.from({ length: n }, () => {
      const z = Array.from({ length: J }, () => rng());
      const eta = L.map((row) => row.reduce((s, v, k) => s + v * z[k], 0));
      for (const t of order) {
        if (exogenous[t]) continue;
        eta[t] =
          B[t].reduce((s, v, f) => s + v * eta[f], 0) +
          pop.interactions
            .filter((x) => x.to === t)
            .reduce((s, x) => s + x.value * (eta[x.a] * eta[x.b] - pop.Phi[x.a][x.b]), 0) +
          Math.sqrt(psi[t]) * rng();
      }
      return eta;
    });
  };
  const covOf = (rows: number[][], i: number, j: number) =>
    rows.reduce((s, r) => s + r[i] * r[j], 0) / rows.length;

  it('keeps unit variances and the right Φ when a product reaches a construct twice', () => {
    const four = [factor('X'), factor('Z'), factor('Y'), factor('W')];
    // A chain (X×Z → Y → W and X×Z → W) and siblings (X×Z → Y and → W, both → U).
    const chain = buildPopulation({
      constructs: four,
      paths: [
        { from: 'X', to: 'Y', value: 0.2 },
        { from: 'Z', to: 'Y', value: 0 },
        { from: 'X', to: 'W', value: 0 },
        { from: 'Z', to: 'W', value: 0 },
        { from: 'Y', to: 'W', value: 0.4 },
      ],
      exoCor: [{ a: 'X', b: 'Z', value: 0.3 }],
      interactions: [
        { a: 'X', b: 'Z', to: 'Y', value: 0.4 },
        { a: 'X', b: 'Z', to: 'W', value: 0.4 },
      ],
    });
    const siblings = buildPopulation({
      constructs: [...four, factor('U')],
      paths: [
        { from: 'X', to: 'Y', value: 0.2 },
        { from: 'Z', to: 'Y', value: 0 },
        { from: 'X', to: 'W', value: 0 },
        { from: 'Z', to: 'W', value: 0.2 },
        { from: 'Y', to: 'U', value: 0.4 },
        { from: 'W', to: 'U', value: 0.4 },
      ],
      exoCor: [{ a: 'X', b: 'Z', value: 0.3 }],
      interactions: [
        { a: 'X', b: 'Z', to: 'Y', value: 0.4 },
        { a: 'X', b: 'Z', to: 'W', value: 0.4 },
      ],
    });
    // Y and W share v² Var(XZ) = .16 · 1.09 beyond their linear parts.
    expect(chain.Phi[2][3]).toBeCloseTo(0.4 + 0.4 * 0.4 * 1.09, 12);
    for (const pop of [chain, siblings]) {
      const rows = drawLatent(pop, 200_000);
      pop.constructs.forEach((name, i) => {
        expect(covOf(rows, i, i), `Var ${name}`).toBeCloseTo(1, 1);
        for (let j = 0; j < i; j++)
          expect(
            Math.abs(covOf(rows, i, j) - pop.Phi[i][j]),
            `${name}, ${pop.constructs[j]}`,
          ).toBeLessThan(0.02);
      });
    }
  });
});
