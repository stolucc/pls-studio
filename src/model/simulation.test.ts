import { describe, expect, it } from 'vitest';
import { buildPopulation } from '../engine/population';
import { defaultDesign, parseDesign, populationFromModel } from './simulation';
import type { ModelState } from './project';

const C = (id: string, name: string, indicators: string[], type: 'factor' | 'composite' = 'factor') => ({ id, name, type, mode: 'A' as const, indicators, x: 0, y: 0, side: 'left' as const });
const model: ModelState = {
  constructs: [C('a', 'A', ['a1', 'a2']), C('b', 'B', ['b1', 'b2', 'b3'], 'composite'), C('y', 'Y', ['y1', 'y2'])],
  paths: [{ id: 'p1', from: 'a', to: 'y' }, { id: 'p2', from: 'b', to: 'y' }],
  moderations: [],
};

describe('simulation design', () => {
  it('builds a valid default population from the model', () => {
    const pop = populationFromModel(model, null, null);
    expect(pop.constructs[0].loadings).toEqual([0.75, 0.75]);
    expect(pop.constructs[1].weights).toEqual([1, 1, 1]);
    expect(pop.paths.map((p) => p.value)).toEqual([0.3, 0.3]);
    expect(pop.exoCor).toEqual([{ a: 'A', b: 'B', value: 0.3 }]);
    expect(() => buildPopulation(pop)).not.toThrow();
  });

  it('round-trips and clamps designs from untrusted files', () => {
    const d = defaultDesign(populationFromModel(model, null, null));
    expect(parseDesign(JSON.parse(JSON.stringify(d)))).toEqual(d);
    const evil = { ...JSON.parse(JSON.stringify(d)), replications: 1e12, sampleSizes: [5, 'x', 300], estimators: [{ id: '<script>' }] };
    const p = parseDesign(evil)!;
    expect(p.replications).toBe(100000);
    expect(p.sampleSizes).toEqual([10, 300]);
    expect(p.estimators.map((e) => e.id)).toEqual(['PLS']);
    expect(parseDesign({ nope: 1 })).toBeNull();
  });
});
