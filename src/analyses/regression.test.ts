import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../model/project';
import { regressionRequest } from '../rengine/regression';
import { FAMILIES, regressionAnalysis, regressionColumns, regressionInput, type RegressionOptions } from './regression';
import type { AnalysisCtx } from './types';

const data = { names: ['y', 'a', 'b', 'g', 'n', 'w', 'k'], cols: Array.from({ length: 7 }, (_, k) => Float64Array.from([k, k + 1, k === 2 ? NaN : k + 2])), categories: { g: ['x', 'y', 'z'] } };
const ctx = (): AnalysisCtx => ({ data, info: null, settings: DEFAULT_SETTINGS, pls: null, projectName: 'p' });
const o = (p: Partial<RegressionOptions>): RegressionOptions => ({ ...regressionAnalysis.defaults(ctx()), ...p });

describe('regression card', () => {
  it('offers every family as an Add-menu entry, validates options and names what is missing', () => {
    expect(FAMILIES.map(([id]) => id)).toEqual(['gaussian', 'binomial', 'poisson', 'negbin', 'gamma', 'ordinal', 'multinomial']);
    expect(regressionAnalysis.entries!.map((e) => e.options(regressionAnalysis.defaults(ctx())).family)).toEqual(['gaussian', 'binomial', 'poisson', 'ordinal', 'multinomial']);
    expect(regressionAnalysis.blocked(o({}), ctx())).toMatch(/Choose the outcome/);
    expect(regressionAnalysis.blocked(o({ outcome: 'y' }), ctx())).toMatch(/at least one predictor/);
    expect(regressionAnalysis.blocked(o({ outcome: 'y', predictors: ['y'] }), ctx())).toMatch(/cannot be a predictor/);
    expect(regressionAnalysis.blocked(o({ outcome: 'y', predictors: ['a'], se: 'cluster' }), ctx())).toMatch(/cluster column/);
    expect(regressionAnalysis.blocked(o({ outcome: 'y', predictors: ['a'], interactions: [['a', 'nope']] }), ctx())).toMatch(/nope/);
    expect(regressionAnalysis.blocked(o({ outcome: 'y', interactions: [['a', 'b']] }), ctx())).toBeNull();
    expect(regressionAnalysis.blocked(o({ outcome: 'y', predictors: ['a', 'g'], family: 'binomial', trials: 'n', weights: 'w', se: 'cluster', cluster: 'k' }), ctx())).toBeNull();
    expect(regressionAnalysis.parseOptions({ family: 'logit', predictors: ['a', 'a'], interactions: [['a'], ['a', 'b'], 'x'], se: 'HC2', link: 'probit' }))
      .toEqual({ outcome: '', predictors: ['a'], categorical: [], interactions: [['a', 'b']], family: 'gaussian', link: 'probit', trials: '', weights: '', se: 'model', cluster: '' });
    expect(regressionColumns(o({ outcome: 'y', predictors: ['a'], interactions: [['a', 'b']], trials: 'n', weights: 'w', se: 'model', cluster: 'k' }))).toEqual(['y', 'a', 'b', 'n', 'w']);
    expect(regressionAnalysis.cardTitle!(o({ family: 'negbin', outcome: 'y' }))).toBe('Negative binomial: y');
    expect(regressionAnalysis.summary(o({ family: 'binomial', outcome: 'y', predictors: ['a', 'b'], se: 'HC3' }))).toBe('logistic / probit · y on a, b · HC3 SEs');
    expect(regressionAnalysis.fingerprint(o({ outcome: 'y', predictors: ['a'] }), ctx())).not.toBe(regressionAnalysis.fingerprint(o({ outcome: 'y', predictors: ['a'], categorical: ['a'] }), ctx()));
  });
  it('sends the chosen columns with the categories of text columns, missing values as null', () => {
    const r = regressionRequest(data, regressionInput(o({ outcome: 'y', predictors: ['a', 'g'], interactions: [['a', 'b']], trials: 'n' }), ctx()));
    expect(r.data.names).toEqual(['y', 'a', 'b', 'g', 'n']);
    expect(r.data.cols[2]).toEqual([2, 3, null]);
    expect(r.categories).toEqual({ g: ['x', 'y', 'z'] });
    expect(r.confidence).toBe(DEFAULT_SETTINGS.confidence);
    expect(() => regressionRequest({ names: ['a'], cols: [], moments: { S: [[1]], n: 5 } }, regressionInput(o({}), ctx()))).toThrow(/covariance matrix/);
  });
});
