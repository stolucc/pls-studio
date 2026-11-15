import { describe, expect, it } from 'vitest';
import { mcTasks, runMcTask, summariseMc, type McDesign } from './montecarlo';
import type { PopulationSpec } from './population';

const pop: PopulationSpec = {
  constructs: [
    { name: 'X', type: 'factor', indicators: ['x1', 'x2', 'x3'], loadings: [0.8, 0.75, 0.7] },
    { name: 'M', type: 'factor', indicators: ['m1', 'm2', 'm3'], loadings: [0.8, 0.7, 0.75] },
    { name: 'Y', type: 'factor', indicators: ['y1', 'y2', 'y3'], loadings: [0.75, 0.8, 0.7] },
  ],
  // X → Y is truly zero: its rejection rate is the Type I error rate.
  paths: [
    { from: 'X', to: 'M', value: 0.4 },
    { from: 'M', to: 'Y', value: 0.3 },
    { from: 'X', to: 'Y', value: 0 },
  ],
  exoCor: [],
};
const run = (design: McDesign, chunks: number) =>
  summariseMc(
    design,
    mcTasks(design, chunks).map((t) => runMcTask(t)),
  );
const row = (rows: ReturnType<typeof summariseMc>, est: string, key: string, n?: number) =>
  rows.find((r) => r.estimator === est && r.param.key === key && (n === undefined || r.n === n))!;

describe('Monte Carlo simulation', () => {
  it('gives identical results however replications are split', () => {
    const design: McDesign = {
      population: pop,
      estimators: [{ id: 'ML', method: 'cb', estimator: 'ML' }],
      sampleSizes: [120],
      replications: 12,
      seed: 5,
      alpha: 0.05,
      bootSamples: 0,
      mcDraws: 200,
    };
    expect(run(design, 3)).toEqual(run(design, 1));
  });

  it('CB-ML: unbiased, nominal coverage, high power, Type I ≈ α', () => {
    const design: McDesign = {
      population: pop,
      estimators: [{ id: 'ML', method: 'cb', estimator: 'ML' }],
      sampleSizes: [400],
      replications: 200,
      seed: 11,
      alpha: 0.05,
      bootSamples: 0,
      mcDraws: 500,
    };
    const rows = run(design, 1);
    const xm = row(rows, 'ML', 'path:X:M');
    expect(xm.reps).toBe(200);
    expect(Math.abs(xm.relBias!)).toBeLessThan(0.03);
    expect(xm.coverage!).toBeGreaterThan(0.9);
    expect(xm.coverage!).toBeLessThan(0.99);
    expect(xm.rejection!).toBeGreaterThan(0.99);
    const xy = row(rows, 'ML', 'path:X:Y');
    expect(xy.param.value).toBe(0);
    expect(xy.relBias).toBeNull();
    expect(xy.rejection!).toBeGreaterThan(0.01);
    expect(xy.rejection!).toBeLessThan(0.1);
    // Monte Carlo CI for the indirect effect.
    const ind = row(rows, 'ML', 'indirect:X:Y');
    expect(ind.param.value).toBeCloseTo(0.12, 12);
    expect(ind.coverage!).toBeGreaterThan(0.88);
    expect(ind.rejection!).toBeGreaterThan(0.9);
  });

  it('PLS is attenuated on common-factor data, PLSc is not (estimator comparison)', () => {
    const design: McDesign = {
      population: pop,
      estimators: [
        { id: 'PLS', method: 'pls', consistent: false },
        { id: 'PLSc', method: 'pls', consistent: true },
      ],
      sampleSizes: [500],
      replications: 80,
      seed: 3,
      alpha: 0.05,
      bootSamples: 0,
      mcDraws: 0,
    };
    const rows = run(design, 2);
    expect(row(rows, 'PLS', 'path:X:M').relBias!).toBeLessThan(-0.1);
    expect(Math.abs(row(rows, 'PLSc', 'path:X:M').relBias!)).toBeLessThan(0.04);
    expect(row(rows, 'PLS', 'path:X:M').coverage).toBeNull();
  });

  it('power grows with sample size (PLS with bootstrap inference)', () => {
    const design: McDesign = {
      population: pop,
      estimators: [{ id: 'PLS', method: 'pls', consistent: false }],
      sampleSizes: [40, 200],
      replications: 40,
      seed: 9,
      alpha: 0.05,
      bootSamples: 60,
      mcDraws: 0,
    };
    const rows = run(design, 1);
    expect(row(rows, 'PLS', 'path:M:Y', 200).rejection!).toBeGreaterThan(
      row(rows, 'PLS', 'path:M:Y', 40).rejection!,
    );
  });
});

describe('precision and admissibility', () => {
  it('reports the mean CI width, standardised for CB-SEM, shrinking with √n', () => {
    const design: McDesign = {
      population: pop,
      estimators: [{ id: 'ML', method: 'cb', estimator: 'ML' }],
      sampleSizes: [200, 800],
      replications: 100,
      seed: 3,
      alpha: 0.05,
      bootSamples: 0,
      mcDraws: 0,
    };
    const rows = run(design, 1);
    const small = row(rows, 'ML', 'path:X:M', 200);
    const large = row(rows, 'ML', 'path:X:M', 800);
    // A Wald interval is about 2 · 1.96 standard errors wide, the SE close to the empirical SD.
    expect(small.width! / (2 * 1.96 * small.sd)).toBeGreaterThan(0.8);
    expect(small.width! / (2 * 1.96 * small.sd)).toBeLessThan(1.25);
    expect(small.width! / large.width!).toBeGreaterThan(1.8);
    expect(small.width! / large.width!).toBeLessThan(2.2);
    // No interval for the χ² test, none without Monte Carlo draws for the indirect effect.
    expect(row(rows, 'ML', 'fit:chisq', 200).width).toBeNull();
    expect(row(rows, 'ML', 'indirect:X:Y', 200).width).toBeNull();
  });

  it('rescales a CB-SEM interval from the marker metric to the standardised one', () => {
    // Markers: X 0.8, M 0.5. The CI of X → M (true 0.4) is for β · 0.5 / 0.8 = 0.25.
    const markers: PopulationSpec = {
      constructs: [
        { name: 'X', type: 'factor', indicators: ['x1', 'x2', 'x3'], loadings: [0.8, 0.7, 0.7] },
        { name: 'M', type: 'factor', indicators: ['m1', 'm2', 'm3'], loadings: [0.5, 0.7, 0.7] },
      ],
      paths: [{ from: 'X', to: 'M', value: 0.4 }],
      exoCor: [],
    };
    const design: McDesign = {
      population: markers,
      estimators: [
        { id: 'ML', method: 'cb', estimator: 'ML' },
        { id: 'PLS', method: 'pls', consistent: false },
      ],
      sampleSizes: [100],
      replications: 2,
      seed: 1,
      alpha: 0.05,
      bootSamples: 0,
      mcDraws: 0,
    };
    const pick = (values: number[]) => [[new Float64Array([NaN, NaN]), Float64Array.from(values)]];
    const both = (values: number[]) => [...pick(values), ...pick(values)];
    // Parameters: the χ² test, then X → M; two replications, CI widths 0.1 and 0.3 in their own metric.
    const part = {
      n: 100,
      start: 0,
      est: both([0.4, 0.4]),
      lo: both([0.2, 0.1]),
      hi: both([0.3, 0.4]),
      sig: both([1, 1]),
      truthCI: [
        [NaN, 0.25],
        [NaN, 0.4],
      ],
      proper: [new Float64Array([1, 1]), new Float64Array([1, 1])],
    };
    const rows = summariseMc(design, [part]);
    expect(row(rows, 'ML', 'path:X:M').width).toBeCloseTo(0.2 / (0.5 / 0.8), 12);
    expect(row(rows, 'PLS', 'path:X:M').width).toBeCloseTo(0.2, 12);
  });

  it('counts inadmissible PLSc solutions (weak loadings, small n); PLS composites never are', () => {
    const weak: PopulationSpec = {
      constructs: [
        { name: 'X', type: 'factor', indicators: ['x1', 'x2', 'x3'], loadings: [0.45, 0.4, 0.35] },
        { name: 'Y', type: 'factor', indicators: ['y1', 'y2', 'y3'], loadings: [0.45, 0.4, 0.35] },
      ],
      paths: [{ from: 'X', to: 'Y', value: 0.5 }],
      exoCor: [],
    };
    const design: McDesign = {
      population: weak,
      estimators: [
        { id: 'PLS', method: 'pls', consistent: false },
        { id: 'PLSc', method: 'pls', consistent: true },
      ],
      sampleSizes: [40],
      replications: 60,
      seed: 9,
      alpha: 0.05,
      bootSamples: 0,
      mcDraws: 0,
    };
    const rows = run(design, 1);
    expect(row(rows, 'PLS', 'path:X:Y').improper).toBe(0);
    expect(row(rows, 'PLSc', 'path:X:Y').improper).toBeGreaterThan(0);
  });
});

describe('non-normal data and the model χ² test', () => {
  it('ML χ² over-rejects under heavy kurtosis; the Satorra–Bentler χ² (MLM) does not', () => {
    const design: McDesign = {
      population: { ...pop, skew: 2, kurtosis: 7 },
      estimators: [
        { id: 'ML', method: 'cb', estimator: 'ML' },
        { id: 'MLM', method: 'cb', estimator: 'MLM' },
      ],
      sampleSizes: [400],
      replications: 150,
      seed: 21,
      alpha: 0.05,
      bootSamples: 0,
      mcDraws: 0,
    };
    const rows = run(design, 2);
    const ml = row(rows, 'ML', 'fit:chisq'),
      mlm = row(rows, 'MLM', 'fit:chisq');
    expect(ml.rejection!).toBeGreaterThan(0.2);
    expect(mlm.rejection!).toBeLessThan(0.12);
    expect(mlm.rejection!).toBeLessThan(ml.rejection!);
    // Point estimates are unaffected: both estimators give the same ML path estimates.
    expect(row(rows, 'ML', 'path:X:M').mean).toBeCloseTo(row(rows, 'MLM', 'path:X:M').mean, 10);
  });

  it('under normal data both χ² tests hold their level', () => {
    const design: McDesign = {
      population: pop,
      estimators: [{ id: 'ML', method: 'cb', estimator: 'ML' }],
      sampleSizes: [400],
      replications: 150,
      seed: 22,
      alpha: 0.05,
      bootSamples: 0,
      mcDraws: 0,
    };
    const r = row(run(design, 1), 'ML', 'fit:chisq');
    expect(r.rejection!).toBeLessThan(0.11);
    expect(r.bias).toBeNaN();
  });
});

describe('the correlation of two exogenous constructs', () => {
  // Muthén & Muthén's (2002) CFA population: two factors of five indicators (loadings .8), correlated .25.
  const cfa: PopulationSpec = {
    constructs: [
      {
        name: 'F1',
        type: 'factor',
        indicators: ['a1', 'a2', 'a3', 'a4', 'a5'],
        loadings: [0.8, 0.8, 0.8, 0.8, 0.8],
      },
      {
        name: 'F2',
        type: 'factor',
        indicators: ['b1', 'b2', 'b3', 'b4', 'b5'],
        loadings: [0.8, 0.8, 0.8, 0.8, 0.8],
      },
    ],
    paths: [],
    exoCor: [{ a: 'F1', b: 'F2', value: 0.25 }],
  };
  it('is a parameter: unbiased with nominal coverage (CB-ML)', () => {
    const design: McDesign = {
      population: cfa,
      estimators: [{ id: 'ML', method: 'cb', estimator: 'ML' }],
      sampleSizes: [300],
      replications: 150,
      seed: 3,
      alpha: 0.05,
      bootSamples: 0,
      mcDraws: 0,
    };
    const rows = run(design, 1);
    const ml = row(rows, 'ML', 'cov:F1:F2');
    expect(ml.param).toMatchObject({ kind: 'covariance', from: 'F1', to: 'F2', value: 0.25 });
    expect(ml.reps).toBe(150);
    expect(Math.abs(ml.bias)).toBeLessThan(0.02);
    expect(ml.coverage!).toBeGreaterThan(0.88);
    expect(ml.rejection!).toBeGreaterThan(0.8);
  });
});
