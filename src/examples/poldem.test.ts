import { describe, expect, it } from 'vitest';
import { estimateCb } from '../engine/cbsem';
import { DEFAULT_SETTINGS, toSpec, validateModel } from '../model/project';
import { makePoldemExample } from './poldem';

describe('Bollen political democracy example', () => {
  it('is valid and reproduces the published fit (lavaan: χ² = 38.125, df = 35)', () => {
    const ex = makePoldemExample(DEFAULT_SETTINGS);
    expect(
      validateModel(ex.model, ex.data, ex.settings).filter((i) => i.level === 'error'),
    ).toEqual([]);
    const r = estimateCb(ex.data, toSpec(ex.model), 'casewise', 'ML');
    expect(r.fit.df).toBe(35);
    expect(r.fit.chisq).toBeCloseTo(38.125, 3);
  });
});
