import { describe, expect, it } from 'vitest';
import { estimateCb } from '../engine/cbsem';
import { DEFAULT_SETTINGS, toSpec, validateModel } from '../model/project';
import { makeMimicExample } from './mimic';

describe('MIMIC example (social participation; Jöreskog & Sörbom, Schumacker & Lomax)', () => {
  const ex = makeMimicExample(DEFAULT_SETTINGS);
  it('is a valid CB-SEM project on a correlation matrix with three observed causes', () => {
    expect(ex.settings).toMatchObject({ method: 'cbsem', estimator: 'ML' });
    expect(
      validateModel(ex.model, ex.data, ex.settings).filter((i) => i.level === 'error'),
    ).toEqual([]);
    expect(ex.model.constructs.filter((c) => c.covariate).map((c) => c.name)).toEqual([
      'income',
      'occupation',
      'education',
    ]);
    expect(ex.data.moments!.n).toBe(530);
  });
  it('reproduces the published maximum-likelihood solution', () => {
    const cb = estimateCb(ex.data, toSpec(ex.model), 'casewise', 'ML');
    const est = (op: string, lhs: string, rhs: string) =>
      cb.estimates.find((e) => e.op === op && e.lhs === lhs && e.rhs === rhs)!;
    // Scaled by church (loading 1): the book (SIMPLIS, social participation of variance 1) prints these divided by church's
    // standardised loading .47 (member .74, friends .40; income .23, occupation .097, education .33); the webR test pins those.
    expect(est('~', 'Social participation', 'income').est).toBeCloseTo(0.108, 3);
    expect(est('~', 'Social participation', 'occupation').est).toBeCloseTo(0.045, 3);
    expect(est('~', 'Social participation', 'education').est).toBeCloseTo(0.155, 3);
    expect(est('~', 'Social participation', 'income').se).toBeCloseTo(0.028, 3);
    expect(est('=~', 'Social participation', 'memberships').est).toBeCloseTo(1.579, 3);
    expect(est('=~', 'Social participation', 'friends').est).toBeCloseTo(0.862, 3);
    expect(est('=~', 'Social participation', 'memberships').se).toBeCloseTo(0.235, 3);
    // (the built-in engine uses lavaan's N; the example runs lavaan with N − 1, as LISREL: 12.498, checked in webR)
    expect(ex.model.likelihood).toBe('wishart');
    expect(cb.fit.chisq).toBeCloseTo(12.522, 3);
    expect(cb.fit.df).toBe(6);
    expect(cb.r2Constructs[cb.constructs.indexOf('Social participation')]).toBeCloseTo(0.258, 3);
  });
});
