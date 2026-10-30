import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../model/project';
import { matchAnalysis as t, toInput } from './match';
import type { AnalysisCtx } from './types';

const col = (...v: number[]) => Float64Array.from(v);
const data = { names: ['treat', 'age', 'educ', 're78', 'other'], cols: [col(0, 1, 0, 1), col(20, 30, 40, 50), col(10, 12, 9, 16), col(1, 2, 3, 4), col(5, 5, 5, 5)] };
const ctx = (over: Partial<AnalysisCtx> = {}): AnalysisCtx => ({ data, info: null, settings: DEFAULT_SETTINGS, pls: null, projectName: 'p', ...over });
const o = { ...t.defaults(ctx()), treatment: 'treat', covariates: ['age', 'educ'], outcome: 're78' };

describe('matching card', () => {
  it('validates options from files', () => {
    expect(t.parseOptions([])).toBeNull();
    expect(t.parseOptions({ treatment: 'treat', method: 'magic', ratio: 99, caliper: 'x', replace: 'yes', estimand: 'ATE', effectModel: 'ipw' }))
      .toEqual({ treatment: 'treat', covariates: [], outcome: '', method: 'nearest', distance: 'glm', estimand: 'ATE', ratio: 10, caliper: -1, replace: false, effectModel: 'ipw' });
  });

  it('says why it cannot run', () => {
    expect(t.blocked(o, ctx())).toBeNull();
    expect(t.blocked({ ...o, treatment: '' }, ctx())).toBe('Choose the treatment.');
    expect(t.blocked({ ...o, covariates: [] }, ctx())).toBe('Choose at least one covariate.');
    expect(t.blocked({ ...o, caliper: -1 }, ctx())).toContain('caliper must be a positive number');
    expect(t.blocked({ ...o, method: 'full', caliper: -1 }, ctx())).toBeNull();
    expect(t.blocked({ ...o, outcome: 'gone' }, ctx())).toBe('Not in the data: gone.');
  });

  it('is stale when its columns, the seed or the confidence level change', () => {
    const f = t.fingerprint(o, ctx());
    expect(t.fingerprint(o, ctx({ data: { ...data, cols: [...data.cols.slice(0, 4), col(1, 1, 1, 1)] } }))).toBe(f);
    expect(t.fingerprint(o, ctx({ settings: { ...DEFAULT_SETTINGS, seed: DEFAULT_SETTINGS.seed + 1 } }))).not.toBe(f);
    expect(t.fingerprint(o, ctx({ settings: { ...DEFAULT_SETTINGS, confidence: 0.99 } }))).not.toBe(f);
    expect(t.fingerprint({ ...o, outcome: '' }, ctx())).not.toBe(f);
  });

  it('sends R only what applies to the method', () => {
    expect(toInput({ ...o, method: 'full', estimand: 'ATE', ratio: 3, caliper: 0.2, replace: true }, 7, 0.9))
      .toEqual({ treatment: 'treat', covariates: ['age', 'educ'], outcome: 're78', method: 'full', distance: 'glm', estimand: 'ATE', ratio: 1, caliper: null, replace: false, seed: 7, confidence: 0.9 });
    expect(toInput({ ...o, method: 'nearest', estimand: 'ATE', ratio: 2, caliper: 0.2, replace: true }, 7, 0.95))
      .toMatchObject({ estimand: 'ATT', ratio: 2, caliper: 0.2, replace: true });
    expect(toInput({ ...o, method: 'weighting', effectModel: 'ipw' }, 1, 0.95).effectModel).toBe('ipw');
    expect(toInput(o, 1, 0.95).effectModel).toBeUndefined();
  });
});
