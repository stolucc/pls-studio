import { describe, expect, it } from 'vitest';
import { buildPopulation } from '../engine/population';
import { defaultDesign, ESTIMATOR_CHOICES, parseDesign, populationFromModel } from './simulation';
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

  it('keeps how non-normal data are generated, and nothing but the two known methods', () => {
    const d = defaultDesign(populationFromModel(model, null, null));
    const skewed = {
      ...d,
      population: { ...d.population, skew: 1.75, kurtosis: 3.75, nonnormal: 'fleishman' as const },
    };
    expect(parseDesign(JSON.parse(JSON.stringify(skewed)))).toEqual(skewed);
    const other = parseDesign({ ...skewed, population: { ...skewed.population, nonnormal: 'x' } })!;
    expect(other.population.nonnormal).toBeUndefined();
  });

  it('keeps the CB-SEM measurement checks when asked for, and only a literal true', () => {
    const d = defaultDesign(populationFromModel(model, null, null));
    expect(parseDesign(JSON.parse(JSON.stringify({ ...d, cbChecks: true })))!.cbChecks).toBe(true);
    expect(parseDesign({ ...d, cbChecks: 'yes' })!.cbChecks).toBeUndefined();
    expect(parseDesign(d)!.cbChecks).toBeUndefined();
  });

  it('keeps a composite’s indicator correlation matrix when it fits its block, symmetrised from the lower triangle', () => {
    const d = defaultDesign(populationFromModel(model, null, null));
    const block = {
      name: 'A',
      type: 'composite',
      indicators: ['a1', 'a2', 'a3'],
      weights: [1, 1, 1],
      withinMatrix: [
        [7, 0, 0],
        [0.2, 1, 9],
        [0.3, 0.4, 1],
      ],
    };
    const keep = parseDesign({ ...d, population: { ...d.population, constructs: [block] } })!;
    expect(keep.population.constructs[0].withinMatrix).toEqual([
      [1, 0.2, 0.3],
      [0.2, 1, 0.4],
      [0.3, 0.4, 1],
    ]);
    const short = { ...block, withinMatrix: [[1]] };
    const drop = parseDesign({ ...d, population: { ...d.population, constructs: [short] } })!;
    expect(drop.population.constructs[0].withinMatrix).toBeUndefined();
  });

  it('offers GSCA among the estimators and keeps it through a project file', () => {
    const d = defaultDesign(populationFromModel(model, null, null));
    const gsca = ESTIMATOR_CHOICES.find((e) => e.id === 'GSCA')!;
    expect(gsca).toEqual({ id: 'GSCA', method: 'pls', consistent: false, approach: 'GSCA' });
    const parsed = parseDesign(JSON.parse(JSON.stringify({ ...d, estimators: [gsca] })))!;
    expect(parsed.estimators).toEqual([gsca]);
  });

  it('keeps the common-factor estimation of a composite population only as a literal true', () => {
    const d = defaultDesign(populationFromModel(model, null, null));
    const on = parseDesign(JSON.parse(JSON.stringify({ ...d, factorModel: true })))!;
    expect(on.factorModel).toBe(true);
    expect(parseDesign({ ...d, factorModel: 1 })!.factorModel).toBeUndefined();
    expect(parseDesign(d)!.factorModel).toBeUndefined();
  });

  it('keeps a construct correlation of 1 (one factor split in two), clamped to ±1', () => {
    const d = defaultDesign(populationFromModel(model, null, null));
    const one = { ...d, population: { ...d.population, exoCor: [{ a: 'A', b: 'B', value: 1 }] } };
    expect(parseDesign(JSON.parse(JSON.stringify(one)))!.population.exoCor[0].value).toBe(1);
    const over = {
      ...d,
      population: { ...d.population, exoCor: [{ a: 'A', b: 'B', value: 1.5 }] },
    };
    expect(parseDesign(over)!.population.exoCor[0].value).toBe(1);
    expect(() => buildPopulation(parseDesign(one)!.population)).not.toThrow();
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
