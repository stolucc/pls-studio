import { describe, expect, it } from 'vitest';
import { minresLoadings, omegaUnit, regressionFit, tCrit } from './mcRegression';
import { mcTasks, runMcTask, summariseMc, type McDesign } from './montecarlo';
import {
  buildPopulation,
  generateData,
  specFromPopulation,
  type PopulationSpec,
} from './population';

const pop: PopulationSpec = {
  constructs: [
    { name: 'A', type: 'factor', indicators: ['a1', 'a2', 'a3'], loadings: [0.8, 0.7, 0.6] },
    { name: 'B', type: 'factor', indicators: ['b1', 'b2', 'b3'], loadings: [0.8, 0.7, 0.6] },
  ],
  paths: [{ from: 'A', to: 'B', value: 0.3 }],
  exoCor: [],
};

describe('regression on composites', () => {
  it('MINRES recovers one-factor loadings from their correlation matrix', () => {
    const l = [0.8, 0.7, 0.6, 0.5];
    const R = l.map((a, i) => l.map((b, j) => (i === j ? 1 : a * b)));
    minresLoadings(R).forEach((v, i) => expect(v).toBeCloseTo(l[i], 8));
  });

  it('ω of a unit-weighted composite: (Σλ)² / ((Σλ)² + Σθ)', () => {
    expect(omegaUnit([0.8, 0.7, 0.6])).toBeCloseTo(2.1 ** 2 / (2.1 ** 2 + 0.36 + 0.51 + 0.64), 12);
    expect(omegaUnit([1])).toBe(1);
  });

  it('sum scores are attenuated by unreliability; DR corrects for it', () => {
    const data = generateData(buildPopulation(pop), 100000, 3);
    const spec = specFromPopulation(pop);
    const sum = regressionFit(data, spec, 'mean', false);
    const dr = regressionFit(data, spec, 'mean', true);
    const omega = omegaUnit([0.8, 0.7, 0.6]);
    expect(sum.paths[0][1]).toBeCloseTo(0.3 * omega, 2);
    expect(dr.paths[0][1]).toBeCloseTo(0.3, 2);
    expect(dr.reliability[0]).toBeCloseTo(omega, 2);
    expect(sum.reliability).toEqual([1, 1]);
    expect(dr.admissible).toBe(true);
    expect(sum.df[1]).toBe(100000 - 2);
  });

  it('casewise deletion drops incomplete cases; the t critical value is the t quantile', () => {
    const data = generateData(buildPopulation(pop), 50, 4);
    data.cols[0][3] = NaN;
    expect(regressionFit(data, specFromPopulation(pop), 'casewise', false).df[1]).toBe(49 - 2);
    expect(tCrit(0.05, 10)).toBeCloseTo(2.228139, 5);
  });

  it('in a simulation: OLS t tests hold their level for a null path, and SEs match the spread', () => {
    const design: McDesign = {
      population: { ...pop, paths: [{ from: 'A', to: 'B', value: 0 }] },
      estimators: [
        { id: 'Sum', method: 'regression', dr: false },
        { id: 'DR', method: 'regression', dr: true },
      ],
      sampleSizes: [100],
      replications: 400,
      seed: 8,
      alpha: 0.05,
      bootSamples: 0,
      mcDraws: 0,
    };
    const rows = summariseMc(
      design,
      mcTasks(design, 2).map((t) => runMcTask(t)),
    );
    const sum = rows.find((r) => r.estimator === 'Sum' && r.param.key === 'path:A:B')!;
    expect(sum.rejection!).toBeGreaterThan(0.025);
    expect(sum.rejection!).toBeLessThan(0.08);
    expect(sum.coverage!).toBeGreaterThan(0.92);
    expect(sum.width! / (2 * 1.98 * sum.sd)).toBeCloseTo(1, 0);
    expect(rows.find((r) => r.estimator === 'DR' && r.param.key === 'path:A:B')!.failed).toBe(0);
  });
});
