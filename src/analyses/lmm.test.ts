import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../model/project';
import { lmmAnalysis as t } from './lmm';
import type { AnalysisCtx } from './types';

const col = (...v: number[]) => Float64Array.from(v);
const data = { names: ['y', 'g', 'x', 'w'], cols: [col(1, 2, 3, 4), col(1, 1, 2, 2), col(0, 1, 0, 1), col(3, 3, 3, 3)] };
const ctx = (over: Partial<AnalysisCtx> = {}): AnalysisCtx => ({ data, info: null, settings: DEFAULT_SETTINGS, pls: null, projectName: 'p', ...over });
const o = { ...t.defaults(ctx()), outcome: 'y', cluster: 'g', predictors: ['x'], slopes: ['x'] };

describe('multilevel regression card', () => {
  it('validates options from files: random slopes only for predictors', () => {
    expect(t.parseOptions({ outcome: 'y', cluster: 'g', predictors: ['x'], slopes: ['x', 'w'], center: 'group', estimation: 'ML' }))
      .toEqual({ outcome: 'y', cluster: 'g', predictors: ['x'], slopes: ['x'], center: 'none', estimation: 'ML' });
    expect(t.parseOptions(null)).toBeNull();
  });

  it('says why it cannot run', () => {
    expect(t.blocked(o, ctx())).toBeNull();
    expect(t.blocked({ ...o, cluster: '' }, ctx())).toBe('Choose the outcome and the cluster column.');
    expect(t.blocked({ ...o, predictors: ['g'] }, ctx())).toContain('must be different');
    expect(t.blocked({ ...o, predictors: ['q'] }, ctx())).toBe('Not in the data: q.');
    expect(t.blocked(o, ctx({ data: null }))).toContain('needs raw data');
  });

  it('is stale when its columns change, not others', () => {
    const f = t.fingerprint(o, ctx());
    expect(t.fingerprint(o, ctx({ data: { ...data, cols: [...data.cols.slice(0, 3), col(9, 9, 9, 9)] } }))).toBe(f);
    expect(t.fingerprint(o, ctx({ data: { ...data, cols: [data.cols[0], col(1, 2, 2, 2), ...data.cols.slice(2)] } }))).not.toBe(f);
  });
});
