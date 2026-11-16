import { describe, expect, it } from 'vitest';
import { estimateCb } from './cbsem';
import {
  mcParameters,
  mcTasks,
  replicationSeed,
  runMcTask,
  summariseMc,
  withMissing,
  type McDesign,
  type McMissing,
} from './montecarlo';
import {
  buildPopulation,
  generateData,
  specFromPopulation,
  type PopulationSpec,
} from './population';

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
    // Two replications; the CI of X → M 0.1 and 0.3 wide in its own metric, nothing for the fit tests.
    const keys = mcParameters(buildPopulation(markers), true).map((p) => p.key);
    const perParam = (values: number[]) =>
      keys.map((k) =>
        k === 'path:X:M' ? Float64Array.from(values) : new Float64Array([NaN, NaN]),
      );
    const both = (values: number[]) => [perParam(values), perParam(values)];
    const truth = (v: number) => keys.map((k) => (k === 'path:X:M' ? v : NaN));
    const part = {
      n: 100,
      start: 0,
      est: both([0.4, 0.4]),
      lo: both([0.2, 0.1]),
      hi: both([0.3, 0.4]),
      sig: both([1, 1]),
      truthCI: [truth(0.25), truth(0.4)],
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

describe('PLS variants', () => {
  const twoConstructs: PopulationSpec = {
    constructs: [
      { name: 'X', type: 'factor', indicators: ['x1', 'x2', 'x3'], loadings: [0.9, 0.6, 0.4] },
      { name: 'Y', type: 'factor', indicators: ['y1', 'y2', 'y3'], loadings: [0.9, 0.6, 0.4] },
    ],
    paths: [{ from: 'X', to: 'Y', value: 0.3 }],
    exoCor: [],
  };
  const once = (estimators: McDesign['estimators']) => {
    const design: McDesign = {
      population: twoConstructs,
      estimators,
      sampleSizes: [150],
      replications: 1,
      seed: 7,
      alpha: 0.05,
      bootSamples: 0,
      mcDraws: 0,
    };
    const part = runMcTask({ design, n: 150, start: 0, end: 1 });
    const at = mcParameters(buildPopulation(twoConstructs), false).findIndex(
      (p) => p.key === 'path:X:Y',
    );
    return part.est.map((perParam) => perParam[at][0]);
  };

  it('unit weights: the correlation of the two sum scores (regression on summed scales)', () => {
    const [estimate] = once([{ id: 'Sum', method: 'pls', consistent: false, mode: 'unit' }]);
    const data = generateData(buildPopulation(twoConstructs), 150, replicationSeed(7, 150, 0));
    const z = (c: Float64Array) => {
      const m = c.reduce((a, b) => a + b, 0) / c.length;
      const sd = Math.sqrt(c.reduce((a, b) => a + (b - m) ** 2, 0) / (c.length - 1));
      return Array.from(c, (v) => (v - m) / sd);
    };
    const sum = (names: string[]) => {
      const cols = names.map((n) => z(data.cols[data.names.indexOf(n)]));
      return Float64Array.from(cols[0], (_, i) => cols.reduce((a, c) => a + c[i], 0));
    };
    const [x, y] = [z(sum(['x1', 'x2', 'x3'])), z(sum(['y1', 'y2', 'y3']))];
    const r = x.reduce((a, v, i) => a + v * y[i], 0) / (x.length - 1);
    expect(estimate).toBeCloseTo(r, 10);
  });

  it('mode and inner scheme change the estimate; omitted they are mode A and path', () => {
    const [plain, modeA, modeB, centroid] = once([
      { id: 'PLS', method: 'pls', consistent: false },
      { id: 'A', method: 'pls', consistent: false, mode: 'A', scheme: 'path' },
      { id: 'B', method: 'pls', consistent: false, mode: 'B' },
      { id: 'C', method: 'pls', consistent: false, scheme: 'centroid' },
    ]);
    expect(modeA).toBeCloseTo(plain, 12);
    expect(Math.abs(modeB - modeA)).toBeGreaterThan(1e-4);
    // (two constructs: path and centroid weighting give the same inner proxies up to sign)
    expect(centroid).toBeCloseTo(plain, 6);
  });
});

describe('the distribution of the estimates', () => {
  // Rönkkö & Evermann (2013): a null path between two constructs. PLS weights capitalise on chance
  // correlations, which pushes the estimates away from 0 (a dip in the middle); sum scores do not.
  const nullPath: PopulationSpec = {
    constructs: [
      { name: 'A', type: 'factor', indicators: ['a1', 'a2', 'a3'], loadings: [0.8, 0.7, 0.6] },
      { name: 'B', type: 'factor', indicators: ['b1', 'b2', 'b3'], loadings: [0.8, 0.7, 0.6] },
    ],
    paths: [{ from: 'A', to: 'B', value: 0 }],
    exoCor: [],
  };
  const design: McDesign = {
    population: nullPath,
    estimators: [
      { id: 'PLS', method: 'pls', consistent: false },
      { id: 'Sum scores', method: 'pls', consistent: false, mode: 'unit' },
    ],
    sampleSizes: [50, 100],
    replications: 300,
    seed: 13,
    alpha: 0.05,
    bootSamples: 0,
    mcDraws: 0,
  };
  const rows = run(design, 2);

  it('is a histogram over one range per parameter, holding every estimate', () => {
    const hs = rows.filter((r) => r.param.key === 'path:A:B').map((r) => r.hist!);
    expect(hs).toHaveLength(4);
    for (const h of hs) {
      expect(h.lo).toBe(hs[0].lo);
      expect(h.hi).toBe(hs[0].hi);
      expect(h.counts.reduce((a, b) => a + b, 0) + h.below + h.above).toBe(300);
      expect(h.lo).toBeLessThanOrEqual(0); // (the true value is inside)
      expect(h.hi).toBeGreaterThanOrEqual(0);
    }
  });

  it('shows PLS pushing a null effect away from 0, unlike sum scores', () => {
    const nearZero = (est: string) => {
      const h = row(rows, est, 'path:A:B', 50).hist!;
      const width = (h.hi - h.lo) / h.counts.length;
      return h.counts.reduce((a, c, b) => {
        const mid = h.lo + (b + 0.5) * width;
        return Math.abs(mid) < 0.05 ? a + c : a;
      }, 0);
    };
    expect(nearZero('PLS')).toBeLessThan(0.75 * nearZero('Sum scores'));
    // (and so a larger spread: the same data, a different estimator)
    expect(row(rows, 'PLS', 'path:A:B', 50).sd).toBeGreaterThan(
      row(rows, 'Sum scores', 'path:A:B', 50).sd,
    );
  });
});

describe('approximate fit indices', () => {
  it('are reported with their cutoffs; under the correct model they rarely reject at large n', () => {
    const design: McDesign = {
      population: pop,
      estimators: [{ id: 'ML', method: 'cb', estimator: 'ML' }],
      sampleSizes: [80, 1000],
      replications: 60,
      seed: 4,
      alpha: 0.05,
      bootSamples: 0,
      mcDraws: 0,
    };
    const rows = run(design, 1);
    for (const id of ['cfi', 'tli', 'rmsea', 'srmr']) {
      const r = row(rows, 'ML', `fit:${id}`, 1000);
      expect(r.param.kind).toBe('fit');
      expect(r.param.value).toBe(0);
      expect(r.reps).toBe(60);
      expect(r.bias).toBeNaN();
      expect(r.rejection!, id).toBeLessThan(0.05);
    }
    expect(row(rows, 'ML', 'fit:cfi', 1000).mean).toBeGreaterThan(0.99);
    expect(row(rows, 'ML', 'fit:rmsea', 1000).mean).toBeLessThan(0.02);
    // SRMR is biased upwards in small samples: it rejects correct models more often at n = 80.
    expect(row(rows, 'ML', 'fit:srmr', 80).mean).toBeGreaterThan(
      row(rows, 'ML', 'fit:srmr', 1000).mean,
    );
  });

  it('uses the robust indices for robust estimators', () => {
    const design: McDesign = {
      population: { ...pop, skew: 1.5, kurtosis: 6 },
      estimators: [{ id: 'MLR', method: 'cb', estimator: 'MLR' }],
      sampleSizes: [300],
      replications: 3,
      seed: 2,
      alpha: 0.05,
      bootSamples: 0,
      mcDraws: 0,
    };
    const part = runMcTask({ design, n: 300, start: 0, end: 3 });
    const keys = mcParameters(buildPopulation(design.population), true).map((p) => p.key);
    const cfi = part.est[0][keys.indexOf('fit:cfi')];
    expect(Array.from(cfi).every(Number.isFinite)).toBe(true);
    // (the robust CFI of the first replication, recomputed by the CB-SEM engine directly)
    const data = generateData(buildPopulation(design.population), 300, replicationSeed(2, 300, 0));
    const cb = estimateCb(data, specFromPopulation(design.population, 'factor'), 'casewise', 'MLR');
    expect(cb.fit.cfiRobust).toBeDefined();
    expect(cfi[0]).toBeCloseTo(cb.fit.cfiRobust!, 10);
  });
});

describe('a misspecified population', () => {
  it('turns the fit tests into power, and biases the paths the misspecification touches', () => {
    const design: McDesign = {
      population: { ...pop, crossLoadings: [{ indicator: 'y1', construct: 'X', value: 0.35 }] },
      estimators: [{ id: 'ML', method: 'cb', estimator: 'ML' }],
      sampleSizes: [500],
      replications: 40,
      seed: 21,
      alpha: 0.05,
      bootSamples: 0,
      mcDraws: 0,
    };
    const rows = run(design, 1);
    const chisq = row(rows, 'ML', 'fit:chisq');
    expect(chisq.param.value).toBe(1);
    expect(chisq.rejection!).toBeGreaterThan(0.8);
    // The unmodelled X → y1 loading is absorbed by the X → Y path (true value 0).
    expect(row(rows, 'ML', 'path:X:Y').mean).toBeGreaterThan(0.1);
  });
});

describe('missing values', () => {
  const complete = generateData(buildPopulation(pop), 4000, 1);
  const share = (c: Float64Array) => Array.from(c).filter(Number.isNaN).length / c.length;

  it('MCAR: the rate in every column, drawn by the seed', () => {
    const m: McMissing = { rate: 0.2, mechanism: 'MCAR', pls: 'mean', cb: 'casewise' };
    const d = withMissing(complete, m, 5);
    for (const c of d.cols) expect(share(c)).toBeCloseTo(0.2, 1);
    expect(withMissing(complete, m, 5).cols[3]).toEqual(d.cols[3]);
    expect(complete.cols.every((c) => share(c) === 0)).toBe(true); // (the complete data are not changed)
  });

  it('MAR: the first indicator stays complete; high values on it make the others missing', () => {
    const d = withMissing(
      complete,
      { rate: 0.2, mechanism: 'MAR', pls: 'mean', cb: 'casewise' },
      5,
    );
    expect(share(d.cols[0])).toBe(0);
    expect(share(d.cols[4])).toBeCloseTo(0.2, 1);
    const x = complete.cols[0];
    const missingAt = (lowHalf: boolean) => {
      const median = [...x].sort((a, b) => a - b)[x.length >> 1];
      const idx = Array.from(x.keys()).filter((i) => x[i] < median === lowHalf);
      return idx.filter((i) => Number.isNaN(d.cols[4][i])).length / idx.length;
    };
    expect(missingAt(false)).toBeGreaterThan(2 * missingAt(true));
  });

  it('casewise deletion costs precision; every estimator still runs', () => {
    const base: McDesign = {
      population: pop,
      estimators: [
        { id: 'PLS', method: 'pls', consistent: false },
        { id: 'ML', method: 'cb', estimator: 'ML' },
      ],
      sampleSizes: [200],
      replications: 80,
      seed: 31,
      alpha: 0.05,
      bootSamples: 0,
      mcDraws: 0,
    };
    const none = run(base, 1);
    const lost = run(
      { ...base, missing: { rate: 0.1, mechanism: 'MCAR', pls: 'casewise', cb: 'casewise' } },
      1,
    );
    for (const est of ['PLS', 'ML']) {
      expect(row(lost, est, 'path:X:M').failed).toBe(0);
      // About 1 − .9⁹ ≈ 61% of the cases lose a value: the SD grows by roughly 1/√.39.
      expect(row(lost, est, 'path:X:M').sd).toBeGreaterThan(1.3 * row(none, est, 'path:X:M').sd);
    }
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
