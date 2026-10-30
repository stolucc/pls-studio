import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../model/project';
import { ncaAnalysis as t } from './nca';
import type { AnalysisCtx } from './types';

const data = { names: ['x', 'y', 'z'], cols: [Float64Array.from([1, 2, 3]), Float64Array.from([2, 3, 5]), Float64Array.from([0, 0, 1])] };
const ctx = (over: Partial<AnalysisCtx> = {}): AnalysisCtx => ({ data, info: null, settings: DEFAULT_SETTINGS, pls: null, projectName: 'p', ...over });
const o = { source: 'data' as const, x: ['x'], y: 'y', permutations: 100 };

describe('NCA card', () => {
  it('validates options from files', () => {
    expect(t.parseOptions(null)).toBeNull();
    expect(t.parseOptions({ source: 'evil', x: ['a', 'a', 3], y: 'b', permutations: 1e9 })).toEqual({ source: 'data', x: ['a'], y: 'b', permutations: 20000 });
    expect(t.parseOptions({ source: 'scores', x: 'no', y: 4 })).toEqual({ source: 'scores', x: [], y: '', permutations: 1000 });
  });

  it('says why it cannot run', () => {
    expect(t.blocked(o, ctx())).toBeNull();
    expect(t.blocked({ ...o, y: '' }, ctx())).toBe('Choose the outcome (Y).');
    expect(t.blocked({ ...o, x: [] }, ctx())).toBe('Choose at least one condition (X).');
    expect(t.blocked({ ...o, x: ['q'] }, ctx())).toBe('Not in the data: q.');
    expect(t.blocked(o, ctx({ data: null }))).toContain('needs raw data');
    expect(t.blocked(o, ctx({ data: { names: ['x', 'y'], cols: [], moments: { S: [[1, 0], [0, 1]], n: 10 } } }))).toContain('needs raw data');
    expect(t.blocked({ ...o, source: 'scores' }, ctx())).toContain('Calculate a PLS-SEM model first');
  });

  it('fingerprints only the columns it uses', () => {
    const f = t.fingerprint(o, ctx());
    expect(f).toBeTruthy();
    expect(t.fingerprint(o, ctx({ data: { ...data, cols: [data.cols[0], data.cols[1], Float64Array.from([9, 9, 9])] } }))).toBe(f);
    expect(t.fingerprint(o, ctx({ data: { ...data, cols: [Float64Array.from([1, 2, 4]), data.cols[1], data.cols[2]] } }))).not.toBe(f);
    expect(t.fingerprint({ ...o, source: 'scores' }, ctx())).toBeNull();
  });
});
