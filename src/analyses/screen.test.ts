import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type ModelState } from '../model/project';
import { influenceAnalysis as inf, screenAnalysis as t } from './screen';
import type { AnalysisCtx } from './types';

const col = (...v: number[]) => Float64Array.from(v);
const data = {
  names: ['a', 'b', 'c', 'd'],
  cols: [col(1, 2, 3, 4), col(2, 3, 4, 4), col(1, 1, 2, 3), col(4, 3, 2, 1)],
};
const C = (id: string, inds: string[]) => ({
  id,
  name: id,
  type: 'factor' as const,
  mode: 'A' as const,
  indicators: inds,
  x: 0,
  y: 0,
  side: 'left' as const,
});
const model: ModelState = { constructs: [C('f', ['a', 'b', 'c'])], paths: [], moderations: [] };
const ctx = (over: Partial<AnalysisCtx> = {}): AnalysisCtx => ({
  data,
  info: null,
  settings: { ...DEFAULT_SETTINGS, method: 'cbsem' },
  pls: null,
  projectName: 'p',
  model,
  ...over,
});

describe('data screening card', () => {
  it('starts with the model’s indicators', () => {
    expect(t.defaults(ctx())).toEqual({ vars: ['a', 'b', 'c'], alpha: 0.001 });
    expect(t.defaults(ctx({ model: undefined }))).toEqual({ vars: [], alpha: 0.001 });
  });

  it('validates options and says why it cannot run', () => {
    expect(t.parseOptions({ vars: ['a', 'a', 1], alpha: 0.5 })).toEqual({
      vars: ['a'],
      alpha: 0.1,
    });
    expect(t.blocked({ vars: ['a'], alpha: 0.01 }, ctx())).toBe('Choose at least two variables.');
    expect(t.blocked({ vars: ['a', 'z'], alpha: 0.01 }, ctx())).toBe('Not in the data: z.');
    expect(t.blocked({ vars: ['a', 'b'], alpha: 0.01 }, ctx())).toBeNull();
  });
});

describe('influential cases card', () => {
  it('needs a valid CB-SEM model on raw data with the R engine', () => {
    expect(inf.blocked({ approach: 'exact' }, ctx())).toBeNull();
    expect(
      inf.blocked({ approach: 'exact' }, ctx({ settings: { ...DEFAULT_SETTINGS, method: 'pls' } })),
    ).toContain('switch the model to CB-SEM');
    expect(
      inf.blocked(
        { approach: 'exact' },
        ctx({ model: { constructs: [], paths: [], moderations: [] } }),
      ),
    ).toContain('Draw a CB-SEM model first');
    expect(inf.blocked({ approach: 'exact' }, ctx({ data: null }))).toContain('need raw data');
  });

  it('keeps the approach; cards saved before it ran the refits', () => {
    expect(inf.parseOptions({})).toEqual({ approach: 'exact' });
    expect(inf.parseOptions({ approach: 'approximate' })).toEqual({ approach: 'approximate' });
    expect(inf.parseOptions({ approach: 'other' })).toEqual({ approach: 'exact' });
    expect(inf.summary!({ approach: 'approximate' })).toContain('approximate');
  });

  it('is stale when the model, the estimator or its indicators change', () => {
    const f = inf.fingerprint({ approach: 'exact' }, ctx());
    expect(f).toBeTruthy();
    expect(
      inf.fingerprint(
        { approach: 'exact' },
        ctx({ data: { ...data, cols: [...data.cols.slice(0, 3), col(0, 0, 0, 0)] } }),
      ),
    ).toBe(f);
    expect(
      inf.fingerprint(
        { approach: 'exact' },
        ctx({ data: { ...data, cols: [col(1, 2, 3, 5), ...data.cols.slice(1)] } }),
      ),
    ).not.toBe(f);
    expect(
      inf.fingerprint(
        { approach: 'exact' },
        ctx({ model: { ...model, constructs: [C('f', ['a', 'b', 'd'])] } }),
      ),
    ).not.toBe(f);
    expect(
      inf.fingerprint(
        { approach: 'exact' },
        ctx({ settings: { ...DEFAULT_SETTINGS, method: 'cbsem', estimator: 'MLR' } }),
      ),
    ).not.toBe(f);
    expect(
      inf.fingerprint(
        { approach: 'exact' },
        ctx({ settings: { ...DEFAULT_SETTINGS, method: 'pls' } }),
      ),
    ).toBeNull();
  });
});
