import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type ModelState } from '../model/project';
import { bollenStineAnalysis as bs, cbFingerprint, cbModelBlocked, compareParamsAnalysis as cmp, quantile, scoreWeightsAnalysis as sw } from './cbModel';
import type { AnalysisCtx } from './types';

const col = (...v: number[]) => Float64Array.from(v);
const K = (id: string, inds: string[]) => ({ id, name: id, type: 'factor' as const, mode: 'A' as const, indicators: inds, x: 0, y: 0, side: 'left' as const });
const model: ModelState = { constructs: [K('A', ['a1', 'a2', 'a3']), K('B', ['b1', 'b2', 'b3'])], paths: [{ id: 'p', from: 'A', to: 'B' }], moderations: [] };
const data = { names: ['a1', 'a2', 'a3', 'b1', 'b2', 'b3', 'other'], cols: Array.from({ length: 7 }, (_, i) => col(i, i + 1, i + 3, i + 2)) };
const settings = { ...DEFAULT_SETTINGS, method: 'cbsem' as const, engine: 'r' as const };
const ctx = (over: Partial<AnalysisCtx> = {}): AnalysisCtx => ({ data, info: null, settings, pls: null, projectName: 'p', model, ...over });

describe('CB-SEM model cards', () => {
  it('need a valid CB-SEM model; Bollen–Stine needs raw data, the others not', () => {
    expect(cbModelBlocked(ctx(), 'X')).toBeNull();
    expect(cbModelBlocked(ctx({ settings: { ...settings, method: 'pls' } }), 'X')).toContain('switch the model to CB-SEM');
    expect(cbModelBlocked(ctx({ settings: { ...settings, engine: 'builtin' } }), 'X')).toContain('R engine');
    const matrix = { names: ['a1'], cols: [], moments: { S: [[1]], n: 10 } };
    expect(bs.blocked({}, ctx({ data: matrix }))).toContain('raw data');
    expect(cmp.blocked({ kinds: ['paths'] }, ctx({ data: matrix }))).not.toContain('raw data');
    expect(cmp.blocked({ kinds: [] }, ctx())).toBe('Choose which parameters to compare.');
    expect(sw.blocked({ method: 'regression' }, ctx({ model: { ...model, multigroup: { column: 'other', invariance: 'configural', free: [] } } }))).toContain('one group');
  });

  it('are stale when the model, the estimator or its columns change; Bollen–Stine also with the bootstrap settings', () => {
    const f = cbFingerprint(ctx());
    expect(f).toBeTruthy();
    expect(cbFingerprint(ctx({ data: { ...data, cols: [...data.cols.slice(0, 6), col(9, 9, 9, 9)] } }))).toBe(f);
    expect(cbFingerprint(ctx({ settings: { ...settings, estimator: 'MLR' } }))).not.toBe(f);
    expect(cbFingerprint(ctx({ model: { ...model, paths: [] } }))).not.toBe(f);
    expect(bs.fingerprint({}, ctx({ settings: { ...settings, seed: 99 } }))).not.toBe(bs.fingerprint({}, ctx()));
    expect(cmp.fingerprint({ kinds: ['paths'] }, ctx({ settings: { ...settings, seed: 99 } }))).toBe(cmp.fingerprint({ kinds: ['paths'] }, ctx()));
  });

  it('parameter comparisons say when there are too few structural paths, instead of failing in R', () => {
    // The test model has one path.
    expect(cmp.blocked({ kinds: ['paths'] }, ctx())).toMatch(/one free structural path: a comparison needs at least two/);
    expect(cmp.blocked({ kinds: ['paths'] }, ctx({ model: { ...model, paths: [] } }))).toMatch(/no free structural paths/);
    expect(cmp.blocked({ kinds: ['paths', 'loadings'] }, ctx())).toBeNull();
    const two = { ...model, constructs: [...model.constructs, K('C', ['a1', 'b1', 'other'])], paths: [...model.paths, { id: 'q', from: 'C', to: 'B' }] };
    expect(cmp.blocked({ kinds: ['paths'] }, ctx({ model: two }))).toBeNull();
    // Held equal by one label, or one fixed: one free parameter.
    expect(cmp.blocked({ kinds: ['paths'] }, ctx({ model: { ...two, paths: two.paths.map((p) => ({ ...p, label: 'b' })) } }))).toMatch(/one free/);
    expect(cmp.blocked({ kinds: ['paths'] }, ctx({ model: { ...two, paths: [two.paths[0], { ...two.paths[1], fixed: 0.5 }] } }))).toMatch(/one free/);
  });

  it('validate options from files', () => {
    expect(cmp.parseOptions({ kinds: ['paths', 'nonsense', 'paths', 'loadings'] })).toEqual({ kinds: ['paths', 'loadings'] });
    expect(sw.parseOptions({ method: 'ten Berge' })).toEqual({ method: 'regression' });
  });

  it('quantiles as R’s type 7', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([3, 1, 2], 0.95)).toBeCloseTo(2.9, 12);
  });
});

describe('the CB extras fingerprint', () => {
  it('changes when the sampling-cluster column changes', async () => {
    const { cbFingerprint } = await import('./cbModel');
    const { DEFAULT_SETTINGS } = await import('../model/project');
    const model = { constructs: [{ id: 'F', name: 'F', type: 'factor' as const, mode: 'A' as const, indicators: ['a1', 'a2', 'a3'], x: 0, y: 0, side: 'left' as const }], paths: [], moderations: [], cluster: 'k' };
    const col = (f: (i: number) => number) => Float64Array.from({ length: 30 }, (_, i) => f(i));
    const d1 = { names: ['a1', 'a2', 'a3', 'k'], cols: [col((i) => i % 5), col((i) => i % 7), col((i) => i % 3), col((i) => i % 3)] };
    const d2 = { ...d1, cols: [...d1.cols.slice(0, 3), col((i) => i % 4)] };
    const ctx = (data: typeof d1) => ({ data, info: null, settings: { ...DEFAULT_SETTINGS, method: 'cbsem' as const }, pls: null, projectName: 'p', model });
    expect(cbFingerprint(ctx(d1))).not.toBe(cbFingerprint(ctx(d2)));
    expect(cbFingerprint(ctx(d1))).toBe(cbFingerprint(ctx({ ...d1 })));
  });
});
