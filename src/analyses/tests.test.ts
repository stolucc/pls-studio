// The basic-statistics cards: options survive a project file, bad values are
// replaced, and each card says what it still needs before it can run.
// (Their results against base R: src/rengine/tests.webr.test.ts.)

import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../model/project';
import { ANALYSIS_TYPES } from './registry';
import { anovaAnalysis, contingencyAnalysis, correlationAnalysis, freqTestAnalysis, manovaAnalysis, rmAnovaAnalysis, ttestAnalysis } from './tests';
import type { AnalysisCtx } from './types';

const data = { names: ['y', 'x', 'g', 'h'], cols: [new Float64Array([1, 2, 3, 4]), new Float64Array([2, 3, 4, 6]), new Float64Array([1, 1, 2, 2]), new Float64Array([1, 2, 1, 2])], categories: { g: ['a', 'b'] } };
const ctx = { data, info: null, settings: DEFAULT_SETTINGS, pls: null, projectName: 'p' } as unknown as AnalysisCtx;

describe('basic-statistics cards', () => {
  it('are in the Add menu under Basic statistics, before regression', () => {
    const ids = ANALYSIS_TYPES.map((t) => t.id);
    for (const id of ['ttest', 'anova', 'rmanova', 'manova', 'correlation', 'contingency', 'freqtest']) {
      expect(ids, id).toContain(id);
      expect(ANALYSIS_TYPES.find((t) => t.id === id)!.group).toBe('Basic statistics');
      expect(ids.indexOf(id)).toBeLessThan(ids.indexOf('regression'));
    }
  });
  it('parse their options from a file, replacing invalid values', () => {
    const t = ttestAnalysis.parseOptions({ type: 'paired', pairs: [['y', 'x'], 'junk'], alternative: 'sideways', testValue: 'NaN', student: false, rank: true })!;
    expect(t).toMatchObject({ type: 'paired', pairs: [['y', 'x']], alternative: 'two.sided', testValue: 0, student: false, rank: true, welch: false });
    expect(anovaAnalysis.parseOptions({ dependent: 'y', factors: ['g'], ssType: 'II' })).toMatchObject({ ssType: 'III', interactions: true });
    expect(rmAnovaAnalysis.parseOptions({ levels: ['y', 'x'], factorName: '' })).toMatchObject({ factorName: 'condition' });
    expect(correlationAnalysis.parseOptions({ vars: ['y', 'x'], method: 'distance' })).toMatchObject({ method: 'pearson', deletion: 'pairwise' });
    expect(freqTestAnalysis.parseOptions({ type: 'multinomial', variable: 'g', proportions: [1, -1, 'x', 2], testValue: 2 })).toMatchObject({ proportions: [1, 2], testValue: 0.5 });
    for (const a of [ttestAnalysis, anovaAnalysis, rmAnovaAnalysis, manovaAnalysis, correlationAnalysis, contingencyAnalysis, freqTestAnalysis]) {
      expect(a.parseOptions(null), a.id).toBeNull();
      expect(a.parseOptions(a.defaults(ctx)), a.id).toEqual(a.defaults(ctx));
    }
  });
  it('say what they still need, and run when complete', () => {
    const tt = ttestAnalysis.defaults(ctx);
    expect(ttestAnalysis.blocked(tt, ctx)).toMatch(/at least one variable/);
    expect(ttestAnalysis.blocked({ ...tt, vars: ['y'] }, ctx)).toMatch(/grouping variable/);
    expect(ttestAnalysis.blocked({ ...tt, vars: ['y'], group: 'g' }, ctx)).toBeNull();
    expect(ttestAnalysis.blocked({ ...tt, type: 'paired', pairs: [['y', 'y']] }, ctx)).toMatch(/two different/);
    expect(ttestAnalysis.blocked({ ...tt, vars: ['y'], group: 'g', student: false, welch: false, rank: false }, ctx)).toMatch(/at least one test/);
    expect(anovaAnalysis.blocked({ ...anovaAnalysis.defaults(ctx), dependent: 'y' }, ctx)).toMatch(/factor/);
    expect(anovaAnalysis.blocked({ ...anovaAnalysis.defaults(ctx), dependent: 'y', factors: ['g'], covariates: ['x'] }, ctx)).toBeNull();
    expect(rmAnovaAnalysis.blocked({ levels: ['y', 'x'], factorName: '1bad', between: '' }, ctx)).toMatch(/start with a letter/);
    expect(rmAnovaAnalysis.blocked({ levels: ['y', 'x'], factorName: 'time', between: 'g' }, ctx)).toBeNull();
    expect(manovaAnalysis.blocked({ dependents: ['y'], factors: ['g'], interactions: true }, ctx)).toMatch(/two dependent/);
    expect(correlationAnalysis.blocked({ ...correlationAnalysis.defaults(ctx), vars: ['y', 'gone'] }, ctx)).toMatch(/gone/);
    expect(contingencyAnalysis.blocked({ rows: 'g', columns: 'g', counts: '' }, ctx)).toMatch(/two different/);
    expect(freqTestAnalysis.blocked({ ...freqTestAnalysis.defaults(ctx), variable: 'g' }, ctx)).toBeNull();
  });
  it('change their fingerprint with the options that change the result', () => {
    const o = { ...correlationAnalysis.defaults(ctx), vars: ['y', 'x'] };
    expect(correlationAnalysis.fingerprint(o, ctx)).not.toBe(correlationAnalysis.fingerprint({ ...o, method: 'kendall' }, ctx));
    expect(correlationAnalysis.fingerprint(o, ctx)).not.toBe(correlationAnalysis.fingerprint(o, { ...ctx, settings: { ...DEFAULT_SETTINGS, confidence: 0.9 } }));
  });
});
