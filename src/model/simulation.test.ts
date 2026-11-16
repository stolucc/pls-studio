import { describe, expect, it } from 'vitest';
import { buildPopulation } from '../engine/population';
import { defaultDesign, parseDesign, populationFromModel } from './simulation';
import type { ModelState } from './project';

const C = (
  id: string,
  name: string,
  indicators: string[],
  type: 'factor' | 'composite' = 'factor',
) => ({ id, name, type, mode: 'A' as const, indicators, x: 0, y: 0, side: 'left' as const });
const model: ModelState = {
  constructs: [
    C('a', 'A', ['a1', 'a2']),
    C('b', 'B', ['b1', 'b2', 'b3'], 'composite'),
    C('y', 'Y', ['y1', 'y2']),
  ],
  paths: [
    { id: 'p1', from: 'a', to: 'y' },
    { id: 'p2', from: 'b', to: 'y' },
  ],
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
    const evil = {
      ...JSON.parse(JSON.stringify(d)),
      replications: 1e12,
      sampleSizes: [5, 'x', 300],
      estimators: [{ id: '<script>' }],
    };
    const p = parseDesign(evil)!;
    expect(p.replications).toBe(100000);
    expect(p.sampleSizes).toEqual([10, 300]);
    expect(p.estimators.map((e) => e.id)).toEqual(['PLS']);
    expect(parseDesign({ nope: 1 })).toBeNull();
  });

  it('keeps a misspecified population (cross-loadings, error correlations, omitted paths), clamped', () => {
    const d = defaultDesign(populationFromModel(model, null, null));
    const wrong = {
      ...d,
      population: {
        ...d.population,
        paths: d.population.paths.map((p) => ({ ...p, omitted: true })),
        crossLoadings: [{ indicator: 'a1', construct: 'B', value: 0.3 }],
        errorCors: [{ a: 'a1', b: 'a2', value: 0.2 }],
      },
    };
    expect(parseDesign(JSON.parse(JSON.stringify(wrong)))).toEqual(wrong);
    const evil = parseDesign({
      ...wrong,
      population: {
        ...wrong.population,
        paths: wrong.population.paths.map((p) => ({ ...p, omitted: 'yes' })),
        crossLoadings: [{ indicator: 'a1', construct: 'B', value: 7 }, 'x'],
        errorCors: [],
      },
    })!;
    expect(evil.population.paths.every((p) => p.omitted === undefined)).toBe(true);
    expect(evil.population.crossLoadings).toEqual([
      { indicator: 'a1', construct: 'B', value: 0.999 },
    ]);
    expect(evil.population.errorCors).toBeUndefined();
  });

  it('keeps the missing values of a design, clamped; rate 0 is no missing values', () => {
    const d = defaultDesign(populationFromModel(model, null, null));
    const m = {
      rate: 0.2,
      mechanism: 'MAR' as const,
      pls: 'casewise' as const,
      cb: 'fiml' as const,
    };
    expect(parseDesign(JSON.parse(JSON.stringify({ ...d, missing: m })))!.missing).toEqual(m);
    expect(
      parseDesign({ ...d, missing: { rate: 3, mechanism: 'x', pls: 'x', cb: 'x' } })!.missing,
    ).toEqual({ rate: 0.5, mechanism: 'MCAR', pls: 'mean', cb: 'casewise' });
    expect(parseDesign({ ...d, missing: { rate: 0 } })!.missing).toBeUndefined();
  });

  it('keeps the bootstrap inference of a design; unknown values fall back', () => {
    const d = defaultDesign(populationFromModel(model, null, null));
    const inf = { signChange: 'construct' as const, interval: 'basic' as const };
    expect(parseDesign(JSON.parse(JSON.stringify({ ...d, inference: inf })))!.inference).toEqual(
      inf,
    );
    expect(
      parseDesign({ ...d, inference: { signChange: '<x>', interval: 'bootstrap' } })!.inference,
    ).toEqual({ signChange: 'none', interval: 'percentile' });
    expect(parseDesign(d)!.inference).toBeUndefined();
  });

  it('keeps ordinal indicators of a design, clamped', () => {
    const d = defaultDesign(populationFromModel(model, null, null));
    const o = { categories: 4, thresholds: 'asymmetric' as const };
    expect(parseDesign(JSON.parse(JSON.stringify({ ...d, ordinal: o })))!.ordinal).toEqual(o);
    expect(parseDesign({ ...d, ordinal: { categories: 99, thresholds: '<x>' } })!.ordinal).toEqual({
      categories: 10,
      thresholds: 'symmetric',
    });
    expect(parseDesign(d)!.ordinal).toBeUndefined();
  });
});
