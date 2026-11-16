import { describe, expect, it } from 'vitest';
import { runMcTask } from '../engine/montecarlo';
import { buildPopulation } from '../engine/population';
import { parseDesign } from './simulation';
import { MC_STUDIES, studyOf } from './studies';

describe('published studies as starting designs', () => {
  it('every study gives a valid design that a project file keeps, study included', () => {
    for (const study of MC_STUDIES) {
      const d = study.design();
      expect(() => buildPopulation(d.population)).not.toThrow();
      const kept = parseDesign(JSON.parse(JSON.stringify(d)))!;
      expect(kept.study).toBe(study.id);
      expect(kept.population.constructs).toEqual(d.population.constructs);
      expect(parseDesign(JSON.parse(JSON.stringify(kept)))).toEqual(kept);
      expect(studyOf(d.study)).toBe(study);
    }
    // (an unknown study is dropped, the design kept)
    const d = { ...MC_STUDIES[0].design(), study: '<script>' };
    expect(parseDesign(d)!.study).toBeUndefined();
  });

  it('Rönkkö & Evermann (2013): two factors, loadings .6/.7/.8, N = 100, 500 replications', () => {
    const d = studyOf('ronkko-evermann-2013-null')!.design();
    expect(d.population.constructs.map((c) => c.loadings)).toEqual([
      [0.6, 0.7, 0.8],
      [0.6, 0.7, 0.8],
    ]);
    expect(d.population.paths).toEqual([{ from: 'A', to: 'B', value: 0 }]);
    expect(d.sampleSizes).toEqual([100]);
    expect(d.replications).toBe(500);
    expect(d.estimators.map((e) => e.id)).toEqual(['PLS mode A', 'Sum scores', 'CB-ML']);
    expect(studyOf('ronkko-evermann-2013-beta')!.design().population.paths[0].value).toBe(0.3);
  });

  it('reproduces the bimodal PLS estimate of a null path (fewer estimates near 0 than at ±.1 to ±.2)', () => {
    const d = {
      ...studyOf('ronkko-evermann-2013-null')!.design(),
      estimators: [
        { id: 'PLS mode A', method: 'pls' as const, consistent: false, mode: 'A' as const },
      ],
      replications: 400,
      bootSamples: 0,
    };
    const part = runMcTask({ design: d, n: 100, start: 0, end: 400 });
    const est = Array.from(part.est[0][0]);
    const share = (lo: number, hi: number) =>
      est.filter((x) => Math.abs(x) >= lo && Math.abs(x) < hi).length / est.length;
    // (bands of equal width: a unimodal distribution around 0 would put the most in the first)
    expect(share(0, 0.05)).toBeLessThan(share(0.1, 0.15));
  });
});
