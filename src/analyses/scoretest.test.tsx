// The Score-based invariance test card: options survive a project file and bad values are replaced, the card says
// what it still needs, the request carries the covariate's values, and the view. (Its results against strucchange run
// natively and the published example: src/examples/cards/scoretest.webr.test.ts.)

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type ModelState } from '../model/project';
import { parseScoreOutput, scoreRequest, SCORE_TESTS } from '../rengine/scoretest';
import { ANALYSIS_TYPES } from './registry';
import { scoreBlocked, scoreTestAnalysis, ScoreTestView, type ScoreView } from './scoretest';
import type { AnalysisCtx } from './types';

const cols = ['x1', 'x2', 'x3', 'age'];
const data = { names: cols, cols: [new Float64Array([1, 2, 3, 4]), new Float64Array([2, 3, 4, 1]), new Float64Array([3, 1, 2, 4]), new Float64Array([10, NaN, 12, 13])] };
const model = { constructs: [{ id: 'F', name: 'F', type: 'factor', mode: 'A', indicators: ['x1', 'x2', 'x3'], x: 0, y: 0, side: 'left' }], paths: [], moderations: [] } as unknown as ModelState;
const ctx = { data, info: null, settings: { ...DEFAULT_SETTINGS, method: 'cbsem', estimator: 'ML', missing: 'casewise' }, pls: null, projectName: 'p', model } as unknown as AnalysisCtx;
const ENGINE = { package: 'strucchange', version: '1.6.0', lavaan: '0.7.3' };

describe('score-based invariance test card', () => {
  it('is in the Add menu under Measurement and fits the model', () => {
    expect(ANALYSIS_TYPES.find((t) => t.id === 'scoretest')?.group).toBe('Measurement');
    expect(scoreTestAnalysis.fitsModel).toBe(true);
  });
  it('parses its options from a file, replacing invalid values', () => {
    const d = scoreTestAnalysis.defaults(ctx);
    expect(scoreTestAnalysis.parseOptions(d)).toEqual(d);
    expect(scoreTestAnalysis.parseOptions(null)).toBeNull();
    // (a test that does not fit the kind of covariate falls back to that kind's first test; unknown sets are dropped)
    expect(scoreTestAnalysis.parseOptions({ covariate: 'age', scale: 'ordinal', fn: 'DM', sets: ['loadings', 'loadings', 'thresholds', 3], nrep: '2e9' }))
      .toEqual({ covariate: 'age', scale: 'ordinal', fn: 'WDMo', sets: ['loadings'], nrep: 200000 });
    expect(scoreTestAnalysis.parseOptions({ scale: 'nominal', fn: 'LMuo', sets: 'all' })).toEqual({ covariate: '', scale: 'continuous', fn: 'DM', sets: [], nrep: 50000 });
    expect(SCORE_TESTS.categorical).toEqual(['LMuo']);
  });
  it('says what it still needs', () => {
    const o = { ...scoreTestAnalysis.defaults(ctx), covariate: 'age' };
    expect(scoreBlocked(o, ctx)).toBeNull();
    expect(scoreTestAnalysis.blocked(o, ctx)).toBeNull();
    expect(scoreBlocked({ ...o, covariate: '' }, ctx)).toMatch(/Choose the covariate/);
    expect(scoreBlocked({ ...o, covariate: 'gone' }, ctx)).toMatch(/not in the data/);
    expect(scoreBlocked({ ...o, sets: [] }, ctx)).toMatch(/which parameters/);
    expect(scoreBlocked({ ...o, scale: 'ordinal' }, ctx)).toMatch(/test for a ordinal/);
    expect(scoreBlocked(o, { ...ctx, settings: { ...ctx.settings, estimator: 'WLSMV' } })).toMatch(/ML or MLR/);
    expect(scoreBlocked(o, { ...ctx, settings: { ...ctx.settings, missing: 'pairwise' } })).toMatch(/FIML/);
    expect(scoreBlocked(o, { ...ctx, model: { ...model, ordered: ['x1'] } as ModelState })).toMatch(/ordinal indicators/);
    expect(scoreTestAnalysis.blocked(o, { ...ctx, settings: { ...ctx.settings, method: 'pls' } })).toMatch(/CB-SEM/);
    // (the fingerprint follows the covariate's values and the seed only where the test uses it)
    const f = scoreTestAnalysis.fingerprint(o, ctx);
    expect(scoreTestAnalysis.fingerprint(o, { ...ctx, settings: { ...ctx.settings, seed: 9 } })).toBe(f);
    expect(scoreTestAnalysis.fingerprint({ ...o, scale: 'ordinal', fn: 'maxLMo' }, { ...ctx, settings: { ...ctx.settings, seed: 9 } })).not.toBe(scoreTestAnalysis.fingerprint({ ...o, scale: 'ordinal', fn: 'maxLMo' }, ctx));
    const moved = { ...data, cols: [...data.cols.slice(0, 3), new Float64Array([10, 11, 12, 14])] };
    expect(scoreTestAnalysis.fingerprint(o, { ...ctx, data: moved })).not.toBe(f);
  });
  it('sends the covariate’s values for every row (missing as null) beside the model’s columns', () => {
    const req = scoreRequest({ data, spec: { constructs: [{ name: 'F', type: 'factor', mode: 'A', indicators: ['x1', 'x2', 'x3'] }], paths: [] }, missing: 'casewise', estimator: 'ML', interaction: 'product' },
      { covariate: 'age', scale: 'continuous', fn: 'DM', sets: ['loadings'], seed: 1, nrep: 50000 });
    expect(req.data).toMatchObject({ names: ['x1', 'x2', 'x3'] });
    expect(req.scoretest).toEqual({ covariate: 'age', values: [10, null, 12, 13], scale: 'continuous', fn: 'DM', sets: ['loadings'], seed: 1, nrep: 50000 });
  });
  it('reads R’s output and shows the test, the process and the parameters', () => {
    const r = parseScoreOutput({ fn: 'WDMo', scale: 'ordinal', covariate: 'agegroup', n: 1405, nGroups: 6, statistic: 3.51, p: 0.0084, params: ['f → x2, all groups (equal)', 'f → x3, all groups (equal)'], kinds: ['loadings', 'loadings'],
      componentMax: [1.2, 1.9], critical: 2.95, peak: '4', levels: ['1', '2', '3', '4', '5', '6'], series: { x: [1, 2, 3, 4, 5], y: [1, 1.5, 2, 3.51, 2.5], boundary: [2.95, 2.95, 2.95, 2.95, 2.95], labels: ['1', '2', '3', '4', '5'] },
      seed: 1234, warnings: [], engine: ENGINE });
    expect(r.series.boundary).toHaveLength(5);
    expect(r.peak).toBe('4');
    const view: ScoreView = { ...r, categoryLabels: ['10-11', '12-13', '14', '15', '16', '17-19'] };
    const html = renderToStaticMarkup(<ScoreTestView r={view} />);
    expect(html).toContain('Weighted double maximum (WDMo) along agegroup');
    expect(html).toContain('the process peaks at 15 (the split after this category)');
    expect(html).toContain('not invariant');
    expect(html).toContain('f → x3, all groups (equal)');
    expect(html).toContain('>10-11<');
    // a continuous covariate: one boundary value, the peak a number; LMuo: per-category bars and no peak
    const dm = parseScoreOutput({ fn: 'DM', scale: 'continuous', covariate: 'age', n: 301, statistic: 1.1, p: 0.6, params: ['a'], kinds: ['loadings'], componentMax: [1.1], critical: 1.36, peak: 12.5, series: { x: [11, 12, 13], y: [0.4, 1.1, 0.2], boundary: 1.36, labels: null }, warnings: [], engine: ENGINE });
    expect(renderToStaticMarkup(<ScoreTestView r={dm} />)).toContain('No evidence that the tested parameters change along age');
    const lm = parseScoreOutput({ fn: 'LMuo', scale: 'categorical', covariate: 'g', n: 50, statistic: 4, p: 0.3, params: ['a'], kinds: ['loadings'], componentMax: [1], critical: 6, peak: null, series: { x: [1, 2], y: [1, 3], boundary: 6, labels: ['1', '2'] }, warnings: [], engine: ENGINE });
    expect(lm.peak).toBeNull();
    expect(renderToStaticMarkup(<ScoreTestView r={lm} />)).toContain('<rect');
    expect(scoreTestAnalysis.summary({ covariate: 'age', scale: 'continuous', fn: 'CvM', sets: ['loadings', 'intercepts'], nrep: 50000 })).toBe('CvM along age · loadings, intercepts of the indicators');
  });
});
