import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../model/project';
import { regressionPackages, regressionRequest } from '../rengine/regression';
import { useStore } from '../store';
import { drawRegressionModel, FAMILIES, parseCuts, regressionAnalysis, regressionColumns, regressionInput, regressionModel, type RegressionOptions } from './regression';
import type { AnalysisCtx } from './types';

const data = { names: ['y', 'a', 'b', 'g', 'n', 'w', 'k'], cols: Array.from({ length: 7 }, (_, k) => Float64Array.from([k, k + 1, k === 2 ? NaN : k + 2])), categories: { g: ['x', 'y', 'z'] } };
const ctx = (): AnalysisCtx => ({ data, info: null, settings: DEFAULT_SETTINGS, pls: null, projectName: 'p' });
const o = (p: Partial<RegressionOptions>): RegressionOptions => ({ ...regressionAnalysis.defaults(ctx()), ...p });

describe('regression card', () => {
  it('offers every family as an Add-menu entry, validates options and names what is missing', () => {
    expect(FAMILIES.map(([id]) => id)).toEqual(['gaussian', 'binomial', 'poisson', 'negbin', 'gamma', 'ordinal', 'multinomial', 'censored', 'survival']);
    expect(regressionAnalysis.entries!.map((e) => e.options(regressionAnalysis.defaults(ctx())).family)).toEqual(['gaussian', 'binomial', 'poisson', 'ordinal', 'multinomial', 'censored', 'survival']);
    expect(regressionAnalysis.blocked(o({}), ctx())).toMatch(/Choose the outcome/);
    expect(regressionAnalysis.blocked(o({ outcome: 'y' }), ctx())).toMatch(/at least one predictor/);
    expect(regressionAnalysis.blocked(o({ outcome: 'y', predictors: ['y'] }), ctx())).toMatch(/cannot be a predictor/);
    expect(regressionAnalysis.blocked(o({ outcome: 'y', predictors: ['a'], se: 'cluster' }), ctx())).toMatch(/cluster column/);
    expect(regressionAnalysis.blocked(o({ outcome: 'y', predictors: ['a'], interactions: [['a', 'nope']] }), ctx())).toMatch(/nope/);
    expect(regressionAnalysis.blocked(o({ outcome: 'y', interactions: [['a', 'b']] }), ctx())).toBeNull();
    expect(regressionAnalysis.blocked(o({ outcome: 'y', predictors: ['a'], family: 'ordinal', se: 'HC3' }), ctx())).toMatch(/model-based errors/);
    expect(regressionAnalysis.blocked(o({ outcome: 'y', predictors: ['a', 'g'], family: 'binomial', trials: 'n', weights: 'w', se: 'cluster', cluster: 'k' }), ctx())).toBeNull();
    expect(regressionAnalysis.parseOptions({ family: 'logit', predictors: ['a', 'a'], interactions: [['a'], ['a', 'b'], 'x'], se: 'HC2', link: 'probit' }))
      .toEqual({ outcome: '', predictors: ['a'], categorical: [], interactions: [['a', 'b']], family: 'gaussian', link: 'probit', trials: '', weights: '', se: 'model', cluster: '', plot: '' });
    expect(regressionAnalysis.display).toEqual(['plot']);
    expect(regressionAnalysis.blocked(o({ outcome: 'g', predictors: ['a'] }), ctx())).toMatch(/text column/);
    expect(regressionAnalysis.blocked(o({ outcome: 'g', predictors: ['a'], family: 'multinomial' }), ctx())).toBeNull();
    expect(regressionColumns(o({ outcome: 'y', predictors: ['a'], interactions: [['a', 'b']], trials: 'n', weights: 'w', se: 'model', cluster: 'k' }))).toEqual(['y', 'a', 'b', 'n', 'w']);
    expect(regressionAnalysis.cardTitle!(o({ family: 'negbin', outcome: 'y' }))).toBe('Negative binomial: y');
    expect(regressionAnalysis.summary(o({ family: 'binomial', outcome: 'y', predictors: ['a', 'b'], se: 'HC3' }))).toBe('logistic / probit · y on a, b · HC3 SEs');
    expect(regressionAnalysis.fingerprint(o({ outcome: 'y', predictors: ['a'] }), ctx())).not.toBe(regressionAnalysis.fingerprint(o({ outcome: 'y', predictors: ['a'], categorical: ['a'] }), ctx()));
  });
  it('sends the chosen columns with the categories of text columns, missing values as null', () => {
    const r = regressionRequest(data, regressionInput(o({ outcome: 'y', predictors: ['a', 'g'], interactions: [['a', 'b']], trials: 'n', cluster: 'k' }), ctx()));
    expect(r.cluster).toBe('');  // (a cluster column counts only with cluster-robust errors)
    expect(r.data.names).toEqual(['y', 'a', 'b', 'g', 'n']);
    expect(r.data.cols[2]).toEqual([2, 3, null]);
    expect(r.categories).toEqual({ g: ['x', 'y', 'z'] });
    expect(r.confidence).toBe(DEFAULT_SETTINGS.confidence);
    expect(() => regressionRequest({ names: ['a'], cols: [], moments: { S: [[1]], n: 5 } }, regressionInput(o({}), ctx()))).toThrow(/covariance matrix/);
  });
});

describe('censored, inflated, multinomial (reference level) and survival models', () => {
  it('validates their options: HC0 or model-based errors, the status column, no weights where unavailable', () => {
    expect(regressionAnalysis.blocked(o({ outcome: 'y', predictors: ['a'], family: 'multinomial', se: 'HC0' }), ctx())).toBeNull();
    expect(regressionAnalysis.blocked(o({ outcome: 'y', predictors: ['a'], family: 'multinomial', se: 'HC3' }), ctx())).toMatch(/model-based or HC0/);
    expect(regressionAnalysis.blocked(o({ outcome: 'y', predictors: ['a'], family: 'poisson', inflated: true, se: 'cluster', cluster: 'k' }), ctx())).toMatch(/model-based or HC0/);
    expect(regressionAnalysis.blocked(o({ outcome: 'y', predictors: ['a'], family: 'poisson', se: 'cluster', cluster: 'k' }), ctx())).toBeNull();
    expect(regressionAnalysis.blocked(o({ outcome: 'y', predictors: ['a'], family: 'censored', inflated: true, weights: 'w' }), ctx())).toMatch(/Weights/);
    expect(regressionAnalysis.blocked(o({ outcome: 'y', predictors: ['a'], family: 'survival' }), ctx())).toMatch(/status column/);
    expect(regressionAnalysis.blocked(o({ outcome: 'y', predictors: ['a'], family: 'survival', status: 'y' }), ctx())).toMatch(/cannot be the survival time/);
    expect(regressionAnalysis.blocked(o({ outcome: 'y', predictors: ['a'], family: 'survival', status: 'n', se: 'HC0' }), ctx())).toBeNull();
    expect(regressionAnalysis.blocked(o({ outcome: 'y', predictors: ['a'], family: 'survival', status: 'nope' }), ctx())).toMatch(/nope/);
  });
  it('keeps the options when set, and only then (earlier projects read as before)', () => {
    const raw = { family: 'survival', outcome: 't', predictors: ['x'], status: 'tc', statusCensored: true, cuts: [3, 1, 2, 2, -1, 'x'], censoring: 'above', inflated: true, reference: 'last' };
    expect(regressionAnalysis.parseOptions(raw)).toMatchObject({ family: 'survival', status: 'tc', statusCensored: true, cuts: [1, 2, 3], censoring: 'above', inflated: true, reference: 'last' });
    const plain = regressionAnalysis.parseOptions({ family: 'censored', censoring: 'sideways', inflated: 'yes', reference: 'middle', cuts: [] })!;
    for (const k of ['censoring', 'inflated', 'reference', 'status', 'statusCensored', 'cuts']) expect(plain, k).not.toHaveProperty(k);
    expect(parseCuts('1:3, 5; 7.5 0 -2 x 1')).toEqual([1, 2, 3, 5, 7.5]);
    expect(parseCuts('1:5000')).toEqual([]);  // (a range of more than 1000 values is ignored)
    expect(parseCuts('')).toEqual([]);
  });
  it('sends the status column and the cut points of a survival model only, and loads survival only when needed', () => {
    const r = regressionRequest(data, regressionInput(o({ outcome: 'y', predictors: ['a'], family: 'survival', status: 'n', statusCensored: true, cuts: [1, 2] }), ctx()));
    expect(r.data.names).toEqual(['y', 'a', 'n']);
    expect([r.status, r.cuts, r.statusCensored]).toEqual(['n', [1, 2], true]);
    const g = regressionRequest(data, regressionInput(o({ outcome: 'y', predictors: ['a'], status: 'n', cuts: [1] }), ctx()));
    expect([g.data.names, g.status, g.cuts]).toEqual([['y', 'a'], '', []]);
    expect(regressionColumns(o({ outcome: 'y', predictors: ['a'], family: 'survival', status: 'n' }))).toEqual(['y', 'a', 'n']);
    expect(regressionPackages({ family: 'survival' })).toBe('regressionSurvival');
    expect(regressionPackages({ family: 'censored' })).toBe('regressionSurvival');
    expect(regressionPackages({ family: 'censored', inflated: true })).toBe('regression');
    expect(regressionPackages({ family: 'poisson', inflated: true })).toBe('regression');
    const fp = (p: Partial<RegressionOptions>) => regressionAnalysis.fingerprint(o({ outcome: 'y', predictors: ['a'], ...p }), ctx());
    expect(fp({ family: 'multinomial' })).toBe(fp({ family: 'multinomial', reference: 'first' }));
    expect(fp({ family: 'multinomial' })).not.toBe(fp({ family: 'multinomial', reference: 'last' }));
    expect(fp({ family: 'poisson' })).not.toBe(fp({ family: 'poisson', inflated: true }));
    expect(fp({ family: 'survival', status: 'n' })).not.toBe(fp({ family: 'survival', status: 'n', cuts: [1] }));
  });
  it('shows the inflation and the baseline hazards in their own tables, and the residual variance', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server');
    const row = (term: string, part?: 'inflation' | 'baseline') => ({ term, part: part ?? null, est: 1, se: 0.1, stat: 10, p: 0, ciLow: 0.8, ciHigh: 1.2 });
    const res = (family: string, coefficients: unknown[], fit: object = {}) => ({ family, link: 'logit', formula: 'y ~ a', se: 'HC0', coefficients, thresholds: [], levels: null, fit: { n: 10, logLik: -5, aic: 14, bic: 15, npar: 3, ...fit }, lrt: null, diagnostics: {}, curves: [], warnings: [], engine: { package: 'survival', version: '3.8' }, input: regressionInput(o({ outcome: 'y', predictors: ['a'] }), ctx()) });
    const html = (r: unknown) => renderToStaticMarkup(<regressionAnalysis.View result={r as never} options={o({ outcome: 'y', predictors: ['a'] })} current />);
    const cens = html(res('censored', [row('a'), row('a', 'inflation')], { residualVariance: 1.156, residualVarianceSe: 0.155, censored: 4 }));
    expect(cens).toContain('Inflation (logistic model for the extra values)');
    expect(cens).toContain('Residual variance');
    expect(cens).toContain('1.156');
    const surv = html(res('survival', [row('a'), row('[0, 1)', 'baseline')], { events: 7 }));
    expect(surv).toContain('Baseline hazard by interval');
    expect(surv).toContain('[0, 1)');
    expect(surv).toContain('Events');
  });
});

describe('regression view', () => {
  it('renders a result stored by the previous version (one curve) and by this one (curves)', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server');
    const base = {
      family: 'gaussian' as const, link: 'logit', formula: 'y ~ a', se: 'model',
      coefficients: [{ term: '(Intercept)', est: 1, se: 0.1, stat: 10, p: 0, ciLow: 0.8, ciHigh: 1.2 }, { term: 'a', est: 2, se: 0.2, stat: 10, p: 0, ciLow: 1.6, ciHigh: 2.4 }],
      thresholds: [], levels: null, fit: { n: 10, logLik: -5, aic: 14, bic: 15, npar: 3, r2: 0.5, adjR2: 0.4 }, lrt: { stat: 3, df: 1, p: 0.08 }, diagnostics: {}, warnings: [], engine: { package: 'stats', version: '4.6' },
      input: regressionInput(o({ outcome: 'y', predictors: ['a'] }), ctx()),
    };
    const curve = { x: 'a', grid: [0, 1], y: [1, 3], points: { x: [0, 1], y: [1, 3] } };
    const html = (r: unknown) => renderToStaticMarkup(<regressionAnalysis.View result={r as never} options={o({ outcome: 'y', predictors: ['a'] })} current />);
    expect(html({ ...base, curves: [curve] })).toContain('Partial effect of a');
    expect(html({ ...base, curve })).toContain('Partial effect of a');   // the previous shape
    expect(html({ ...base, curve: null })).not.toContain('Partial effect');
    expect(html(base)).toContain('Coefficients');
  });
});

describe('a linear regression drawn as a path model', () => {
  it('maps the predictors to observed covariates and the outcome to a single indicator, one path each', () => {
    const m = regressionModel(o({ outcome: 'y', predictors: ['a', 'b'], se: 'cluster', cluster: 'k' }));
    expect(typeof m).toBe('object');
    const model = m as Exclude<typeof m, string>;
    expect(model.constructs.map((c) => [c.name, c.indicators, !!c.covariate])).toEqual([['a', ['a'], true], ['b', ['b'], true], ['y', ['y'], false]]);
    expect(model.paths.map((p) => [model.constructs.find((c) => c.id === p.from)!.name, model.constructs.find((c) => c.id === p.to)!.name])).toEqual([['a', 'y'], ['b', 'y']]);
    expect(model.cluster).toBe('k');
    expect(model.constructs.map((c) => c.y)).toEqual([-90, 90, 0]);
  });
  it('says why another specification cannot be drawn', () => {
    expect(regressionModel(o({ outcome: 'y', predictors: ['a'], family: 'binomial' }))).toMatch(/Only a linear regression/);
    expect(regressionModel(o({ outcome: 'y', predictors: ['a', 'g'], categorical: ['g'] }))).toMatch(/dummy variables/);
    expect(regressionModel(o({ outcome: 'y', predictors: ['a'], interactions: [['a', 'b']] }))).toMatch(/moderation arrow/);
    expect(regressionModel(o({ outcome: 'y', predictors: ['a'], weights: 'w' }))).toMatch(/sampling weights/);
    expect(regressionModel(o({ outcome: 'y', predictors: [] }))).toMatch(/at least one predictor/);
  });
  it('replaces the diagram, switches to CB-SEM with ML and opens the Model tab', async () => {
    const s = useStore.getState();
    s.newProject();
    useStore.setState({ toasts: [] });
    s.setData(data, { fileName: 'd.csv', rows: 3, missingCells: 1, excluded: [] });
    s.setSettings({ method: 'pls' });
    expect(await drawRegressionModel(o({ outcome: 'y', predictors: ['a', 'b'] }))).toBe(true);
    const st = useStore.getState();
    expect(st.settings).toMatchObject({ method: 'cbsem', estimator: 'ML' });
    expect(st.workspace).toBe('model');
    expect(st.model.constructs.map((c) => c.name)).toEqual(['a', 'b', 'y']);
    expect(st.model.paths.length).toBe(2);
    expect(st.toasts.at(-1)!.text).toMatch(/as a path model/);
    expect(await drawRegressionModel(o({ outcome: 'y', predictors: ['a'], family: 'poisson' }))).toBe(false);
    expect(st.model.constructs.length).toBe(3);
  });
});

describe('regression with a random slope (one level, Mplus TYPE = RANDOM)', () => {
  it('reads the option from files only when set, says when it cannot run, keeps it out of path models and the fingerprint of others', () => {
    expect(regressionAnalysis.parseOptions({ outcome: 'y', predictors: ['a'] })).not.toHaveProperty('randomSlope');
    expect(regressionAnalysis.parseOptions({ outcome: 'y', predictors: ['a'], randomSlope: 'a' })).toMatchObject({ randomSlope: 'a' });
    const rs = o({ outcome: 'y', predictors: ['a', 'b'], interactions: [['a', 'b']], randomSlope: 'a', se: 'HC0' });
    expect(regressionAnalysis.blocked(rs, ctx())).toBeNull();
    expect(regressionAnalysis.blocked({ ...rs, randomSlope: 'n' }, ctx())).toMatch(/must be one of the predictors/);
    expect(regressionAnalysis.blocked({ ...rs, categorical: ['a'] }, ctx())).toMatch(/numeric predictor/);
    expect(regressionAnalysis.blocked({ ...rs, weights: 'w' }, ctx())).toMatch(/Weights are not available/);
    expect(regressionAnalysis.blocked({ ...rs, se: 'HC3' }, ctx())).toMatch(/model-based or HC0/);
    // (another family ignores it)
    expect(regressionAnalysis.blocked({ ...rs, family: 'poisson' }, ctx())).toBeNull();
    expect(regressionModel(rs)).toMatch(/random slope/);
    expect(regressionAnalysis.fingerprint(rs, ctx())).not.toBe(regressionAnalysis.fingerprint({ ...rs, randomSlope: undefined }, ctx()));
    expect(regressionAnalysis.fingerprint(o({ outcome: 'y', predictors: ['a'] }), ctx())).toBe(regressionAnalysis.fingerprint(o({ outcome: 'y', predictors: ['a'], family: 'gaussian' }), ctx()));
    expect(regressionAnalysis.summary(rs)).toBe('linear (gaussian) · y on a, b · random slope of a · HC0 SEs');
    expect(regressionRequest(data, regressionInput(rs, ctx()))).toMatchObject({ randomSlope: 'a' });
  });
  it('shows the variances and the covariance of the random slope in their own table', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server');
    const row = (term: string, part: 'random' | null = null) => ({ term, part, est: 0.85, se: 0.078, stat: 10, p: 0, ciLow: 0.7, ciHigh: 1 });
    const rs = o({ outcome: 'y', predictors: ['a'], randomSlope: 'a' });
    const r = { family: 'gaussian', link: 'identity', formula: 'y ~ a', se: 'HC0', coefficients: [row('a'), row('Residual variance', 'random'), row('Variance of the slope of a', 'random')], thresholds: [], levels: null,
      fit: { n: 10, logLik: -5, aic: 14, bic: 15, npar: 4 }, lrt: null, diagnostics: {}, curves: [], warnings: [], engine: { package: 'stats', version: '4.6' }, input: regressionInput(rs, ctx()) };
    const html = renderToStaticMarkup(<regressionAnalysis.View result={r as never} options={rs} current />);
    expect(html).toContain('Random slope of a: variances and covariance');
    expect(html).toContain('Variance of the slope of a');
  });
});
