import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../model/project';
import { rsaAnalysis as t } from './rsa';
import type { AnalysisCtx } from './types';

const col = (...v: number[]) => Float64Array.from(v);
const data = {
  names: ['z', 'x', 'y', 'c'],
  cols: [col(1, 2, 3, 4), col(1, 2, 2, 3), col(2, 2, 3, 3), col(0, 1, 0, 1)],
};
const ctx = (over: Partial<AnalysisCtx> = {}): AnalysisCtx => ({
  data,
  info: null,
  settings: DEFAULT_SETTINGS,
  pls: null,
  projectName: 'p',
  ...over,
});
const o = { ...t.defaults(ctx()), outcome: 'z', x: 'x', y: 'y' };

describe('polynomial regression card', () => {
  it('validates options from files', () => {
    expect(t.parseOptions('x')).toBeNull();
    expect(
      t.parseOptions({
        outcome: 'z',
        x: 3,
        estimation: 'WLS',
        center: 'midpoint',
        midpoint: 'abc',
        controls: ['c', 'c'],
      }),
    ).toEqual({
      outcome: 'z',
      x: '',
      y: '',
      controls: ['c'],
      estimation: 'OLS',
      center: 'midpoint',
      midpoint: 3,
    });
  });

  it('says why it cannot run', () => {
    expect(t.blocked(o, ctx())).toBeNull();
    expect(t.blocked({ ...o, y: '' }, ctx())).toBe('Choose the outcome and the two predictors.');
    expect(t.blocked({ ...o, y: 'x' }, ctx())).toContain('must be different');
    expect(t.blocked({ ...o, controls: ['q'] }, ctx())).toBe('Not in the data: q.');
    expect(t.blocked(o, ctx({ data: null }))).toContain('needs raw data');
  });

  it('is stale when its columns or the confidence level change, not other columns', () => {
    const f = t.fingerprint(o, ctx());
    expect(
      t.fingerprint(
        o,
        ctx({ data: { ...data, cols: [...data.cols.slice(0, 3), col(9, 9, 9, 9)] } }),
      ),
    ).toBe(f);
    expect(t.fingerprint({ ...o, controls: ['c'] }, ctx())).not.toBe(f);
    expect(
      t.fingerprint(o, ctx({ data: { ...data, cols: [col(1, 2, 3, 5), ...data.cols.slice(1)] } })),
    ).not.toBe(f);
    expect(t.fingerprint(o, ctx({ settings: { ...DEFAULT_SETTINGS, confidence: 0.9 } }))).not.toBe(
      f,
    );
  });
});
