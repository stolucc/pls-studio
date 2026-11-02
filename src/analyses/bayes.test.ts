// The Bayesian cards: Bayes factors written for reading, the evidence
// categories, options from a file, and what each card still needs.
// (Their results against independent integrals: src/rengine/bayes.webr.test.ts.)

import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../model/project';
import { bayesAnovaAnalysis, bayesBinomialAnalysis, bayesContingencyAnalysis, bayesCorrelationAnalysis, bayesRegressionAnalysis, bayesRmAnovaAnalysis, bayesTtestAnalysis, evidence, fmtBF } from './bayes';
import { ANALYSIS_TYPES } from './registry';
import type { AnalysisCtx } from './types';

const data = { names: ['y', 'x', 'g'], cols: [new Float64Array([1, 2, 3, 4]), new Float64Array([2, 3, 4, 6]), new Float64Array([1, 1, 2, 2])], categories: { g: ['a', 'b'] } };
const ctx = { data, info: null, settings: DEFAULT_SETTINGS, pls: null, projectName: 'p' } as unknown as AnalysisCtx;

describe('Bayesian cards', () => {
  it('write Bayes factors for reading', () => {
    expect(fmtBF(17.25888)).toBe('17.259');
    expect(fmtBF(250)).toBe('250.0');
    expect(fmtBF(77198223)).toBe('7.72 × 10^7');
    expect(fmtBF(0.0004)).toBe('4.00 × 10^-4');
    expect(fmtBF(Infinity)).toBe('∞');
  });
  it('name the evidence (Lee & Wagenmakers 2013)', () => {
    expect(evidence(1)).toBe('none');
    expect(evidence(2)).toBe('anecdotal for H1');
    expect(evidence(17.26)).toBe('strong for H1');
    expect(evidence(1 / 5)).toBe('moderate for H0');
    expect(evidence(1e6)).toBe('extreme for H1');
  });
  it('are in the Add menu with JASP’s default priors', () => {
    for (const id of ['bttest', 'banova', 'brmanova', 'bregression', 'bcorrelation', 'bcontingency', 'bbinomial']) expect(ANALYSIS_TYPES.find((t) => t.id === id)?.group).toBe('Basic statistics');
    expect(bayesRmAnovaAnalysis.defaults(ctx)).toMatchObject({ priorFixed: 0.5, priorRandom: 1 });
    expect(bayesRegressionAnalysis.defaults(ctx)).toMatchObject({ modelPrior: 'betabinomial' });
    expect(bayesRegressionAnalysis.defaults(ctx).priorWidth).toBeCloseTo(Math.SQRT2 / 4, 12);
    expect(bayesTtestAnalysis.defaults(ctx)).toMatchObject({ robustness: false, sequential: false });
    expect(bayesAnovaAnalysis.defaults(ctx)).toMatchObject({ priorFixed: 0.5, interactions: true });
    expect(bayesAnovaAnalysis.defaults(ctx).priorCovariates).toBeCloseTo(Math.SQRT2 / 4, 12);
    expect(bayesContingencyAnalysis.defaults(ctx)).toMatchObject({ sampling: 'jointMulti', priorConcentration: 1 });
    expect(bayesTtestAnalysis.defaults(ctx).priorWidth).toBeCloseTo(Math.SQRT1_2, 12);
    expect(bayesCorrelationAnalysis.defaults(ctx).priorWidth).toBe(1);
    expect(bayesBinomialAnalysis.defaults(ctx)).toMatchObject({ priorA: 1, priorB: 1, testValue: 0.5 });
  });
  it('parse options from a file, replacing invalid values', () => {
    expect(bayesTtestAnalysis.parseOptions({ type: 'one', vars: ['y'], priorWidth: -1, iterations: 5, alternative: 'up' })).toMatchObject({ priorWidth: Math.SQRT1_2, iterations: 10000, alternative: 'two.sided' });
    expect(bayesBinomialAnalysis.parseOptions({ variable: 'g', priorA: 0, testValue: 1 })).toMatchObject({ priorA: 1, testValue: 0.5 });
    expect(bayesContingencyAnalysis.parseOptions({ rows: 'g', columns: 'y', sampling: 'binomial', priorConcentration: -2 })).toMatchObject({ sampling: 'jointMulti', priorConcentration: 1 });
    expect(bayesAnovaAnalysis.parseOptions({ dependent: 'y', factors: ['g'], priorFixed: 0 })).toMatchObject({ priorFixed: 0.5 });
    expect(bayesRegressionAnalysis.parseOptions({ outcome: 'y', predictors: ['x'], modelPrior: 'dirichlet' })).toMatchObject({ modelPrior: 'betabinomial' });
    expect(bayesTtestAnalysis.parseOptions({ type: 'one', vars: ['y'], robustness: 'yes', sequential: true })).toMatchObject({ robustness: false, sequential: true });
    for (const a of [bayesTtestAnalysis, bayesAnovaAnalysis, bayesRmAnovaAnalysis, bayesRegressionAnalysis, bayesCorrelationAnalysis, bayesContingencyAnalysis, bayesBinomialAnalysis]) { expect(a.parseOptions(null)).toBeNull(); expect(a.parseOptions(a.defaults(ctx))).toEqual(a.defaults(ctx)); }
  });
  it('say what they need, and rerun when the seed or the prior changes', () => {
    const t = bayesTtestAnalysis.defaults(ctx);
    expect(bayesTtestAnalysis.blocked(t, ctx)).toMatch(/at least one variable/);
    expect(bayesTtestAnalysis.blocked({ ...t, vars: ['y'], group: 'g' }, ctx)).toBeNull();
    expect(bayesCorrelationAnalysis.blocked({ ...bayesCorrelationAnalysis.defaults(ctx), vars: ['y'] }, ctx)).toMatch(/two variables/);
    expect(bayesAnovaAnalysis.blocked({ ...bayesAnovaAnalysis.defaults(ctx), dependent: 'y' }, ctx)).toMatch(/factor/);
    expect(bayesAnovaAnalysis.blocked({ ...bayesAnovaAnalysis.defaults(ctx), dependent: 'y', factors: ['g'], covariates: ['x'] }, ctx)).toBeNull();
    expect(bayesContingencyAnalysis.blocked({ ...bayesContingencyAnalysis.defaults(ctx), rows: 'g', columns: 'g' }, ctx)).toMatch(/two different/);
    expect(bayesRmAnovaAnalysis.blocked({ ...bayesRmAnovaAnalysis.defaults(ctx), levels: ['y', 'x'], factorName: 'subject' }, ctx)).toMatch(/not be subject/);
    expect(bayesRmAnovaAnalysis.blocked({ ...bayesRmAnovaAnalysis.defaults(ctx), levels: ['y', 'x'], between: 'g' }, ctx)).toBeNull();
    expect(bayesRegressionAnalysis.blocked({ ...bayesRegressionAnalysis.defaults(ctx), outcome: 'y' }, ctx)).toMatch(/predictor/);
    expect(bayesRegressionAnalysis.blocked({ ...bayesRegressionAnalysis.defaults(ctx), outcome: 'y', predictors: Array.from({ length: 11 }, (_, i) => `x${i}`) }, ctx)).toMatch(/ten/);
    expect(bayesRegressionAnalysis.blocked({ ...bayesRegressionAnalysis.defaults(ctx), outcome: 'y', predictors: ['x'] }, ctx)).toBeNull();
    const t0 = { ...bayesTtestAnalysis.defaults(ctx), vars: ['y'], group: 'g' };
    expect(bayesTtestAnalysis.fingerprint({ ...t0, sequential: true }, ctx)).not.toBe(bayesTtestAnalysis.fingerprint(t0, ctx));
    const o = { ...t, vars: ['y'], group: 'g' };
    const f = bayesTtestAnalysis.fingerprint(o, ctx);
    expect(bayesTtestAnalysis.fingerprint({ ...o, priorWidth: 1 }, ctx)).not.toBe(f);
    expect(bayesTtestAnalysis.fingerprint(o, { ...ctx, settings: { ...DEFAULT_SETTINGS, seed: 99 } })).not.toBe(f);
  });
});
