import { describe, expect, it } from 'vitest';
import { bootTests, constructFlips, correctedDraws } from './mcInference';
import { mcTasks, runMcTask, summariseMc, type McDesign } from './montecarlo';

describe('bootstrap tests in a simulation', () => {
  it('computes every interval from one set of draws', () => {
    const draws = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
    const r = bootTests(draws, 0.5, 0.2, 50);
    // mean .55, bias .05: the normal interval is centred at .45
    expect((r.ci.normal[0] + r.ci.normal[1]) / 2).toBeCloseTo(0.45, 12);
    expect(r.ci.basic[0]).toBeCloseTo(1 - r.ci.percentile[1], 12);
    expect(r.reject.percentile).toBe(1);
    expect(r.reject.bca).toBeNaN(); // (no jackknife)
  });

  it('sign corrections: individual takes the original sign; construct flips by the weights', () => {
    expect(correctedDraws(Float64Array.from([-0.2, 0.3]), 0.1, 'individual')).toEqual([0.2, 0.3]);
    const flips = constructFlips(
      [{ construct: 'A', indicators: ['a1', 'a2'] }],
      ['weight:a1', 'weight:a2'],
      [0.6, 0.5],
      [Float64Array.from([0.6, -0.55]), Float64Array.from([0.4, -0.5])],
    );
    expect(Array.from(flips.get('A')!)).toEqual([1, -1]);
    const one = Int8Array.from([1, 1]);
    expect(
      correctedDraws(Float64Array.from([0.2, 0.2]), 0.2, 'construct', {
        from: flips.get('A')!,
        to: one,
      }),
    ).toEqual([0.2, -0.2]);
  });

  // Rönkkö, McIntosh & Antonakis (2015): a null path, two factors with loadings .6, .7, .8, n = 100, PLS
  // mode A. Individual sign correction makes every percentile interval exclude 0 (1000 of 1000 there);
  // without it the percentile interval holds its level and the basic interval does not (444 of 1000).
  it('reproduces the false positives of Rönkkö, McIntosh & Antonakis (2015)', () => {
    const design = (signChange: 'none' | 'individual'): McDesign => ({
      population: {
        constructs: [
          { name: 'A', type: 'factor', indicators: ['a1', 'a2', 'a3'], loadings: [0.6, 0.7, 0.8] },
          { name: 'B', type: 'factor', indicators: ['b1', 'b2', 'b3'], loadings: [0.6, 0.7, 0.8] },
        ],
        paths: [{ from: 'A', to: 'B', value: 0 }],
        exoCor: [],
      },
      estimators: [{ id: 'PLS mode A', method: 'pls', consistent: false, mode: 'A' }],
      sampleSizes: [100],
      replications: 80,
      seed: 15,
      alpha: 0.05,
      bootSamples: 150,
      mcDraws: 0,
      inference: { signChange, interval: 'percentile' },
    });
    const at = (signChange: 'none' | 'individual') =>
      summariseMc(
        design(signChange),
        mcTasks(design(signChange), 2).map((t) => runMcTask(t)),
      ).find((r) => r.param.key === 'path:A:B')!.tests!;
    const none = at('none');
    const individual = at('individual');
    expect(individual.percentile!).toBeGreaterThan(0.95);
    expect(none.percentile!).toBeLessThan(0.15);
    expect(none.basic!).toBeGreaterThan(0.25);
    expect(none.t).toBeDefined();
    expect(none.bca).toBeUndefined(); // (not computed: the interval is percentile)
  });
});
