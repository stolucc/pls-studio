import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type ModelState } from '../model/project';
import { alternativeSpec, assessmentCard, blindfoldAnalysis, compareAnalysis, groupsAnalysis, plsModelBlocked, predictAnalysis, predictivePower } from './plsAssessment';
import type { AnalysisCtx } from './types';

const row = (q2: number, rmsePls: number, rmseLm: number) => ({ indicator: 'i', construct: 'C', maePls: 1, maeLm: 1, rmsePls, rmseLm, q2 });

it('classifies predictive power as Shmueli et al. (2019)', () => {
  expect(predictivePower([row(0.2, 1, 2), row(0.1, 1, 2)])).toMatch(/^High/);
  expect(predictivePower([row(0.2, 1, 2), row(0.1, 1, 2), row(0.1, 3, 2)])).toMatch(/^Medium/);
  expect(predictivePower([row(0.2, 1, 2), row(0.1, 3, 2), row(0.1, 3, 2)])).toMatch(/^Low/);
  expect(predictivePower([row(0.2, 3, 2)])).toMatch(/^No predictive power/);
  expect(predictivePower([row(-0.1, 1, 2)])).toMatch(/not above 0/);
});


const col = (...v: number[]) => Float64Array.from(v);
const K = (id: string, inds: string[]) => ({ id, name: id, type: 'factor' as const, mode: 'A' as const, indicators: inds, x: 0, y: 0, side: 'left' as const });
const model: ModelState = { constructs: [K('A', ['a1', 'a2']), K('B', ['b1', 'b2']), K('C', ['c1', 'c2'])], paths: [{ id: 'p1', from: 'A', to: 'B' }, { id: 'p2', from: 'B', to: 'C' }], moderations: [] };
const data = { names: ['a1', 'a2', 'b1', 'b2', 'c1', 'c2', 'g', 'w'], cols: [col(1, 2, 3, 4), col(2, 3, 4, 5), col(1, 3, 2, 4), col(2, 2, 3, 3), col(4, 3, 2, 1), col(1, 1, 2, 2), col(1, 2, 1, 2), col(1, 2, 3, 4)] };
const ctx = (over: Partial<AnalysisCtx> = {}): AnalysisCtx => ({ data, info: null, settings: { ...DEFAULT_SETTINGS, method: 'pls' }, pls: null, projectName: 'p', model, ...over });

describe('PLS-SEM assessment cards', () => {
  it('need a PLS-SEM model on raw data', () => {
    expect(plsModelBlocked(ctx())).toBeNull();
    expect(plsModelBlocked(ctx({ settings: { ...DEFAULT_SETTINGS, method: 'cbsem' } }))).toContain('switch the model to PLS-SEM');
    expect(plsModelBlocked(ctx({ model: { ...model, paths: [] } }))).toContain('Draw a PLS path model first');
    expect(plsModelBlocked(ctx({ data: null }))).toContain('Import raw data');
  });

  it('are for continuous indicators: ordinal PLS is the estimation and bootstrap only', () => {
    expect(plsModelBlocked(ctx({ model: { ...model, ordered: ['a1', 'a2'] } }))).toBe('This assessment is for continuous indicators; a1, a2 are ordinal (OrdPLS: the estimation and bootstrap on the Model tab). Treat them as continuous (right-click) to run it.');
  });

  it('are stale when the model, the PLS settings or its indicators change', () => {
    const f = predictAnalysis.fingerprint({ folds: 10, repetitions: 10 }, ctx());
    expect(f).toBeTruthy();
    expect(predictAnalysis.fingerprint({ folds: 10, repetitions: 10 }, ctx({ model: { ...model, paths: model.paths.slice(0, 1) } }))).not.toBe(f);
    expect(predictAnalysis.fingerprint({ folds: 10, repetitions: 10 }, ctx({ settings: { ...DEFAULT_SETTINGS, method: 'pls', scheme: 'centroid' } }))).not.toBe(f);
    expect(predictAnalysis.fingerprint({ folds: 10, repetitions: 10 }, ctx({ data: { ...data, cols: [...data.cols.slice(0, 7), col(0, 0, 0, 0)] } }))).toBe(f);
    expect(blindfoldAnalysis.fingerprint({ distance: 7 }, ctx({ settings: { ...DEFAULT_SETTINGS, method: 'pls', seed: 5 } }))).toBe(blindfoldAnalysis.fingerprint({ distance: 7 }, ctx()));
  });

  it('compare against saved paths of the same constructs', () => {
    expect(compareAnalysis.blocked({ alternative: null }, ctx())).toContain('Save the current paths');
    const alt = { paths: [['A', 'B'], ['A', 'C']] as [string, string][], savedAt: 1 };
    expect(compareAnalysis.blocked({ alternative: alt }, ctx())).toBeNull();
    expect(compareAnalysis.blocked({ alternative: { paths: [['A', 'B'], ['B', 'C']], savedAt: 1 } }, ctx())).toContain('still has the alternative');
    expect(compareAnalysis.blocked({ alternative: { paths: [['A', 'Z']], savedAt: 1 } }, ctx())).toContain('(Z)');
    expect(alternativeSpec({ constructs: [], paths: [{ from: 'x', to: 'y' }] }, alt).paths).toEqual([{ from: 'A', to: 'B' }, { from: 'A', to: 'C' }]);
    expect(compareAnalysis.parseOptions({ alternative: { paths: [['A', 'B'], ['x'], 'bad'], savedAt: 'now' } })).toEqual({ alternative: { paths: [['A', 'B']], savedAt: 0 } });
  });

  it('group by a column outside the model with few values', () => {
    expect(groupsAnalysis.blocked({ group: 'g', approaches: ['Henseler'] }, ctx())).toBeNull();
    expect(groupsAnalysis.blocked({ group: 'a1', approaches: ['Henseler'] }, ctx())).toContain('not a grouping column');
    expect(groupsAnalysis.blocked({ group: 'g', approaches: [] }, ctx())).toContain('at least one');
    expect(groupsAnalysis.parseOptions({ group: 'g', approaches: ['Chin', 'Evil', 'Chin'] })).toEqual({ group: 'g', approaches: ['Chin'] });
  });

  it('examples open the right card', () => {
    expect(assessmentCard({ tab: 'groups', group: 'gender' })).toEqual(['mga', { group: 'gender' }]);
    expect(assessmentCard({ tab: 'blindfold', distance: 4 })).toEqual(['blindfold', { distance: 4 }]);
    expect(assessmentCard({ tab: 'cca' })).toEqual(['cca', {}]);
  });
});

describe('the PLS options every assessment sends', () => {
  it('carry the weighting and second-order approaches from the settings', async () => {
    const { plsOptions } = await import('./plsAssessment');
    const { DEFAULT_SETTINGS } = await import('../model/project');
    expect(plsOptions({ ...DEFAULT_SETTINGS, plsApproach: 'GSCA', hocApproach: 'repeated', missing: 'fiml' })).toMatchObject({ approach: 'GSCA', hocApproach: 'repeated', missing: 'casewise' });
  });
});
