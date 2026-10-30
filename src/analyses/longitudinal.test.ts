import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../model/project';
import { gmmAnalysis as gmm, gmmInput, growthAnalysis as growth, growthInput, riclpmAnalysis as ri } from './longitudinal';
import type { AnalysisCtx } from './types';

const col = (...v: number[]) => Float64Array.from(v);
const data = { names: ['t1', 't2', 't3', 't4', 'c', 'id'], cols: [col(1, 2), col(2, 3), col(3, 4), col(4, 5), col(0, 1), col(1, 2)] };
const ctx = (over: Partial<AnalysisCtx> = {}): AnalysisCtx => ({ data, info: null, settings: DEFAULT_SETTINGS, pls: null, projectName: 'p', ...over });
const t = ['t1', 't2', 't3', 't4'];

describe('growth curve card', () => {
  it('defaults the time scores to 0, 1, 2, … and takes the estimator and missing data from the settings', () => {
    const o = { ...growth.defaults(ctx()), measures: t };
    expect(growthInput(o, ctx({ settings: { ...DEFAULT_SETTINGS, estimator: 'MLR', missing: 'fiml' } })))
      .toEqual({ measures: t, times: [0, 1, 2, 3], shape: 'linear', covariates: [], estimator: 'MLR', missing: 'fiml' });
    expect(growthInput({ ...o, times: [0, 0.5, 1, 2] }, ctx()).times).toEqual([0, 0.5, 1, 2]);
    expect(growthInput(o, ctx({ settings: { ...DEFAULT_SETTINGS, estimator: 'WLSMV' } })).estimator).toBe('ML');
  });

  it('says why it cannot run, and is stale when the estimator changes', () => {
    const o = { ...growth.defaults(ctx()), measures: t };
    expect(growth.blocked(o, ctx())).toBeNull();
    expect(growth.blocked({ ...o, measures: t.slice(0, 2) }, ctx())).toContain('at least three');
    expect(growth.blocked({ ...o, times: [0, 1] }, ctx())).toContain('one time score per measure');
    expect(growth.fingerprint(o, ctx({ settings: { ...DEFAULT_SETTINGS, estimator: 'MLR' } }))).not.toBe(growth.fingerprint(o, ctx()));
    expect(growth.parseOptions({ measures: t, times: [0, 'x', 2], shape: 'cubic' })).toEqual({ measures: t, times: [0, 2], shape: 'linear', covariates: [] });
  });
});

describe('RI-CLPM card', () => {
  it('needs X and Y at the same three or more waves', () => {
    expect(ri.blocked({ x: t.slice(0, 2), y: t.slice(2), equal: false }, ctx())).toContain('three or more waves');
    expect(ri.blocked({ x: ['t1', 't2', 't3'], y: ['t4', 'c'], equal: false }, ctx())).toContain('same number of waves');
    expect(ri.blocked({ x: ['t1', 't2', 't3'], y: ['t4', 'c', 'id'], equal: true }, ctx())).toBeNull();
  });
});

describe('growth mixture card', () => {
  it('builds the lcmm input for wide and long data', () => {
    const wide = { ...gmm.defaults(ctx()), measures: t, to: 3 };
    expect(gmmInput(wide, 5)).toEqual({ format: 'wide', measures: t, times: [0, 1, 2, 3], shape: 'linear', random: 'intercept', classes: [1, 2, 3], covariates: [], nrep: 30, seed: 5 });
    const long = { ...gmm.defaults(ctx()), format: 'long' as const, subject: 'id', time: 't1', outcome: 't2' };
    expect(gmmInput(long, 5)).toMatchObject({ format: 'long', subject: 'id', time: 't1', outcome: 't2' });
    expect(gmm.blocked(long, ctx())).toBeNull();
    expect(gmm.blocked({ ...long, time: 'id' }, ctx())).toContain('must be different');
    expect(gmm.fingerprint(long, ctx({ settings: { ...DEFAULT_SETTINGS, seed: 9 } }))).not.toBe(gmm.fingerprint(long, ctx()));
    expect(gmm.parseOptions({ to: 50, nrep: 1, random: 'all' })).toMatchObject({ to: 6, nrep: 5, random: 'intercept' });
  });
});
