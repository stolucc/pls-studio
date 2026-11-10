// The measurement invariance cards: options survive a project file, bad values are replaced, each card says what it
// still needs, the request it sends, and the views. (Their results against the R packages run natively:
// src/examples/cards/invariance.webr.test.ts and src/rengine/invariance.webr.test.ts.)

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type ModelState } from '../model/project';
import type { AlignmentResult, LongInvarianceResult, MnlfaResult } from '../rengine/invariance';
import { alignmentRequest, detectOccasions, longInvarianceRequest, mnlfaRequest, rows } from '../rengine/invariance';
import { ANALYSIS_TYPES } from './registry';
import type { AnalysisCtx } from './types';
import { alignmentAnalysis, alignmentInput, invLavaan, longInvarianceAnalysis, longInvarianceInput, mnlfaAnalysis, mnlfaInput, mnlfaUnidentified, modelFactors } from './invariance';

const cols = ['a1', 'a2', 'a3', 'b1', 'b2', 'g', 'x'];
const data = { names: cols, cols: cols.map((_, k) => Float64Array.from({ length: 12 }, (_, i) => ((i * (k + 2)) % 5) + (cols[k] === 'g' ? 0 : 1))), categories: { g: ['north', 'south', 'east', 'west', 'mid'] } };
const model = {
  constructs: [{ id: 'A', name: 'A', type: 'factor', mode: 'A', indicators: ['a1', 'a2', 'a3'], x: 0, y: 0, side: 'left' }, { id: 'B', name: 'B', type: 'factor', mode: 'A', indicators: ['b1', 'b2'], x: 0, y: 0, side: 'left' },
    { id: 'S', name: 'S', type: 'factor', mode: 'A', indicators: ['x'], x: 0, y: 0, side: 'left' }],
  paths: [], moderations: [],
} as unknown as ModelState;
const bare = { data, info: null, settings: DEFAULT_SETTINGS, pls: null, projectName: 'p' } as unknown as AnalysisCtx;
const ctx: AnalysisCtx = { ...bare, model };

describe('alignment card', () => {
  it('is in the Add menu under Measurement', () => {
    expect(ANALYSIS_TYPES.find((t) => t.id === 'alignment')?.group).toBe('Measurement');
  });
  it('parses its options from a file, replacing invalid values', () => {
    const d = alignmentAnalysis.defaults(ctx);
    expect(alignmentAnalysis.parseOptions(d)).toEqual(d);
    expect(alignmentAnalysis.parseOptions(null)).toBeNull();
    expect(alignmentAnalysis.parseOptions({ constructs: ['A', 3, 'A'], group: 7, groupWeights: 'n', powerLambda: '2', powerNu: -1, scaleLambda: 'x', tolLambda: 99 }))
      .toEqual({ ...d, constructs: ['A'], group: '', powerLambda: 2, powerNu: 0, tolLambda: 10 });
  });
  it('offers the diagram’s factors with two or more indicators in the data', () => {
    expect(modelFactors(ctx).map((f) => f.name)).toEqual(['A', 'B']);
    expect(modelFactors({ ...ctx, data: { ...data, names: cols.filter((c) => c !== 'b2') } }).map((f) => f.name)).toEqual(['A']);
  });
  it('says what it still needs, and runs when complete', () => {
    const d = alignmentAnalysis.defaults(ctx);
    expect(alignmentAnalysis.blocked(d, bare)).toMatch(/Draw a measurement model/);
    expect(alignmentAnalysis.blocked(d, { ...ctx, data: null })).toMatch(/raw data/);
    expect(alignmentAnalysis.blocked(d, ctx)).toMatch(/grouping column/);
    expect(alignmentAnalysis.blocked({ ...d, group: 'a1' }, ctx)).toMatch(/indicator/);
    expect(alignmentAnalysis.blocked({ ...d, constructs: ['S'], group: 'g' }, ctx)).toMatch(/Not a factor.*S/);
    expect(alignmentAnalysis.blocked({ ...d, group: 'gone' }, ctx)).toMatch(/gone/);
    expect(alignmentAnalysis.blocked({ ...d, group: 'g' }, ctx)).toBeNull();
    const shared = { ...model, constructs: [...model.constructs, { ...model.constructs[0], id: 'C', name: 'C' }] } as ModelState;
    expect(alignmentAnalysis.blocked({ ...d, group: 'g' }, { ...ctx, model: shared })).toMatch(/two of the chosen factors/);
  });
  it('sends the chosen factors, the group column and the alignment settings; ML or MLR with FIML or casewise deletion', () => {
    const o = { ...alignmentAnalysis.defaults(ctx), constructs: ['B'], group: 'g', powerLambda: 0.25 };
    const i = alignmentInput(o, ctx);
    expect(i).toMatchObject({ factors: [{ name: 'B', indicators: ['b1', 'b2'] }], group: 'g', power: { lambda: 0.25, nu: 0.5 }, tolerance: { lambda: 0.2, nu: 0.4 }, weights: 'sqrtN', estimator: 'ML', missing: 'casewise' });
    expect(alignmentInput({ ...o, constructs: [] }, ctx).factors.map((f) => f.name)).toEqual(['A', 'B']);
    expect(alignmentRequest(data, i).data.names).toEqual(['b1', 'b2', 'g']);
    expect(invLavaan({ settings: { ...DEFAULT_SETTINGS, estimator: 'MLR', missing: 'fiml' } })).toEqual({ estimator: 'MLR', missing: 'fiml' });
    expect(invLavaan({ settings: { ...DEFAULT_SETTINGS, estimator: 'WLSMV', missing: 'mean' } })).toEqual({ estimator: 'ML', missing: 'casewise' });
    expect(() => alignmentRequest({ names: [], cols: [], moments: { n: 10, names: [], cov: [] } } as never, i)).toThrow(/raw data/);
  });
  it('changes its fingerprint with the options and the data it reads', () => {
    const o = { ...alignmentAnalysis.defaults(ctx), group: 'g' };
    const f = alignmentAnalysis.fingerprint(o, ctx)!;
    expect(f).toBeTruthy();
    expect(alignmentAnalysis.fingerprint({ ...o, tolNu: 0.3 }, ctx)).not.toBe(f);
    expect(alignmentAnalysis.fingerprint({ ...o, constructs: ['A'] }, ctx)).not.toBe(f);
    expect(alignmentAnalysis.summary(o)).toBe('all factors · by g');
  });
  it('reads one-element rows from R', () => {
    expect(rows([[1, 2], 3, null])).toEqual([[1, 2], [3], []]);
  });
  it('shows aligned means, effect sizes and the non-invariant parameters', () => {
    const side = (dif: number[][]) => ({ tolerance: 0.2, noninvariant: 0.25, joint: [0.5, 0.6], dif, unique: [0, 1], uniqueGroups: [1, 0] });
    const r: AlignmentResult = {
      groups: ['north', 'south'], n: [100, 120], fit: { chisq: 3.2, df: 2, cfi: 0.99, rmsea: 0.03, srmr: 0.02 }, power: [0.5, 0.5], scale: [1, 1], weights: 'sqrtN',
      factors: [{ name: 'A', items: ['a1', 'a2'], lambda: [[0.5, 0.6], [0.55, 0.7]], nu: [[1, 2], [1.1, 2.2]], lambdaAligned: [[0.5, 0.6], [0.5, 0.71]], nuAligned: [[1, 2], [1, 2.3]],
        mean: [0, 0.4], sd: [1, 1.2], r2: { lambda: 0.97, nu: 0.99 }, sqrtU2: { lambda: 0.1, nu: 0.05 }, rbar: { lambda: 0.6, nu: 0.8 }, fopt: 1.5, converged: true, fixed: true,
        lambdaConstraints: side([[0, 0], [0, 0.11]]), nuConstraints: side([[0, 0], [0, 0.3]]) }],
      warnings: [], engine: { package: 'sirt', version: '4.2.133', lavaan: '0.7.3' },
    };
    const html = renderToStaticMarkup(<alignmentAnalysis.View result={r} options={alignmentAnalysis.defaults(ctx)} current />);
    for (const s of ['Group factor means and variances', 'south', '1.440', 'R², loadings', '25.0%', 'Aligned loadings', 'Joint (invariant) value', 'its SD 1', 'The alignment converged']) expect(html).toContain(s);
    expect(html).toMatch(/class="num warn"[^>]*>0\.710/);
  });
});

describe('moderated nonlinear factor analysis card', () => {
  const bin = ['u1', 'u2', 'u3', 'u4', 'sex', 'age', 'z'];
  const bd = { names: bin, cols: bin.map((n, k) => Float64Array.from({ length: 20 }, (_, i) => (n === 'z' ? i % 3 : n === 'age' ? i / 4 : n === 'u4' && i === 3 ? NaN : (i * (k + 1)) % 2))) };
  const bctx = { ...bare, data: bd } as AnalysisCtx;
  const o = { ...mnlfaAnalysis.defaults(bctx), items: ['u1', 'u2', 'u3', 'u4'], covariates: ['sex', 'age'], intercept: ['sex'], mean: ['sex', 'age'], moderated: ['u2'] };
  it('is in the Add menu under Measurement and parses its options', () => {
    expect(ANALYSIS_TYPES.find((t) => t.id === 'mnlfa')?.group).toBe('Measurement');
    expect(mnlfaAnalysis.parseOptions(o)).toEqual(o);
    expect(mnlfaAnalysis.parseOptions(null)).toBeNull();
    expect(mnlfaAnalysis.parseOptions({ items: ['a', 1], itemType: '3PL', mean: 'x' })).toEqual({ ...mnlfaAnalysis.defaults(bctx), items: ['a'] });
  });
  it('says what it still needs', () => {
    expect(mnlfaAnalysis.blocked({ ...o, items: ['u1', 'u2'] }, bctx)).toMatch(/three binary items/);
    expect(mnlfaAnalysis.blocked({ ...o, covariates: ['sex', 'age', 'u1'] }, bctx)).toMatch(/also be a covariate/);
    expect(mnlfaAnalysis.blocked({ ...o, covariates: ['sex', 'age', 'z'] }, bctx)).toMatch(/role/);
    expect(mnlfaAnalysis.blocked({ ...o, items: ['u1', 'u2', 'age'], covariates: ['sex'], mean: ['sex'] }, bctx)).toMatch(/age is not binary/);
    expect(mnlfaAnalysis.blocked({ ...o, moderated: [] }, bctx)).toMatch(/sex moderates the factor mean and the intercepts of every item/);
    expect(mnlfaAnalysis.blocked({ ...o, items: ['u1', 'u2', 'gone'] }, bctx)).toMatch(/gone/);
    expect(mnlfaAnalysis.blocked(o, bctx)).toBeNull();
    expect(mnlfaUnidentified(mnlfaInput({ ...o, itemType: '2PL', intercept: [], slope: ['age'], sd: ['age'], moderated: ['u1', 'u2', 'u3', 'u4'] }))).toMatch(/SD and the slopes/);
  });
  it('sends only the roles of chosen covariates, slopes only for the 2PL', () => {
    const i = mnlfaInput({ ...o, itemType: '1PL', slope: ['sex'], sd: ['gone'], categorical: ['sex', 'z'], moderated: ['u2', 'x9'] });
    expect(i).toMatchObject({ slope: [], sd: [], categorical: ['sex'], moderated: ['u2'] });
    expect(mnlfaRequest(bd, i).data.names).toEqual(['u1', 'u2', 'u3', 'u4', 'sex', 'age']);
    expect(mnlfaRequest(bd, i).data.cols[3][3]).toBeNull();
    const f = mnlfaAnalysis.fingerprint(o, bctx)!;
    expect(mnlfaAnalysis.fingerprint({ ...o, itemType: '1PL' }, bctx)).not.toBe(f);
    expect(mnlfaAnalysis.summary(o)).toBe('4 items · 2PL · moderated by sex, age');
  });
  it('shows the moderated intercepts and slopes and the factor’s mean and SD', () => {
    const r: MnlfaResult = {
      itemType: '2PL', n: 20, converged: true, iterations: 30, warnings: [], engine: { package: 'mnlfa', version: '0.3.4' },
      items: [{ item: 'u1', kind: 'b', term: '(Intercept)', est: -0.5, free: true }, { item: 'u1', kind: 'a', term: '(Intercept)', est: 1.2, free: true },
        { item: 'u2', kind: 'b', term: '(Intercept)', est: 0.3, free: true }, { item: 'u2', kind: 'b', term: 'z_2', est: 0.61, free: true }, { item: 'u2', kind: 'a', term: '(Intercept)', est: 0.9, free: true }],
      trait: [{ kind: 'mu', term: 'z_2', est: 0.25 }, { kind: 'sigma', term: 'z_2', est: Math.log(2) }],
      terms: [{ term: 'z_2', covariate: 'z', level: 'green' }],
      fit: { deviance: 100, logLik: -50, npar: 7, aic: 114, bic: 121, caic: 128, aicc: 115 },
    };
    const html = renderToStaticMarkup(<mnlfaAnalysis.View result={r} options={o} current />);
    for (const s of ['Item intercepts (b) and their moderation', 'z = green', '0.610', 'Item slopes (a)', 'Factor mean and SD', '2.000', 'converged in 30 EM iterations', '114.00']) expect(html).toContain(s);
  });
});

describe('longitudinal invariance card', () => {
  const lc = ['x1_t1', 'x2_t1', 'x3_t1', 'x1_t2', 'x2_t2', 'x3_t2', 'x1_t3', 'x2_t3', 'age'];
  const ld = { names: lc, cols: lc.map((_, k) => Float64Array.from({ length: 10 }, (_, i) => i * (k + 1))) };
  const lctx = { ...bare, data: ld } as AnalysisCtx;
  it('recognises repeated items from their names', () => {
    expect(detectOccasions(lc)).toEqual({ occasions: [['x1_t1', 'x2_t1'], ['x1_t2', 'x2_t2'], ['x1_t3', 'x2_t3']], labels: ['1', '2', '3'] });
    expect(detectOccasions(['anx.1', 'dep.1', 'anx.2', 'dep.2', 'id']).occasions).toEqual([['anx.1', 'dep.1'], ['anx.2', 'dep.2']]);
    expect(detectOccasions(['a_w2', 'b_w2', 'a_w1', 'b_w1']).occasions).toEqual([['a_w1', 'b_w1'], ['a_w2', 'b_w2']]);
    expect(detectOccasions(['y1', 'y2', 'y3']).occasions).toEqual([]);
    expect(detectOccasions(['x_t1', 'x_t2']).occasions).toEqual([]);
  });
  it('starts from the recognised occasions, is in the Longitudinal group, and parses its options', () => {
    const d = longInvarianceAnalysis.defaults(lctx);
    expect(d.occasions).toHaveLength(3);
    expect(longInvarianceAnalysis.defaults(bare).occasions).toEqual([[], []]);
    expect(ANALYSIS_TYPES.find((t) => t.id === 'longinvariance')?.group).toBe('Longitudinal');
    expect(longInvarianceAnalysis.parseOptions(d)).toEqual(d);
    expect(longInvarianceAnalysis.parseOptions({ factor: 5, occasions: [['a', 3], 'x'], lag: 'lag2' })).toEqual({ factor: '', occasions: [['a'], []], lag: 'all' });
  });
  it('says what it still needs', () => {
    const o = longInvarianceAnalysis.defaults(lctx);
    expect(longInvarianceAnalysis.blocked(o, lctx)).toBeNull();
    expect(longInvarianceAnalysis.blocked({ ...o, occasions: [['x1_t1', 'x2_t1']] }, lctx)).toMatch(/two or more occasions/);
    expect(longInvarianceAnalysis.blocked({ ...o, occasions: [...o.occasions, []] }, lctx)).toMatch(/has no indicators/);
    expect(longInvarianceAnalysis.blocked({ ...o, occasions: [['x1_t1'], ['x1_t2']] }, lctx)).toMatch(/at least two/);
    expect(longInvarianceAnalysis.blocked({ ...o, occasions: [['x1_t1', 'x2_t1', 'x3_t1'], ['x1_t2', 'x2_t2']] }, lctx)).toMatch(/same number/);
    expect(longInvarianceAnalysis.blocked({ ...o, occasions: [['x1_t1', 'x2_t1'], ['x1_t1', 'x2_t2']] }, lctx)).toMatch(/more than one occasion/);
    expect(longInvarianceAnalysis.blocked({ ...o, occasions: [['x1_t1', 'x2_t1'], ['x1_t2', 'gone']] }, lctx)).toMatch(/gone/);
  });
  it('sends the occasions and the lavaan settings', () => {
    const o = { ...longInvarianceAnalysis.defaults(lctx), factor: '  ' };
    const i = longInvarianceInput(o, lctx);
    expect(i).toMatchObject({ factor: 'F', lag: 'all', estimator: 'ML', missing: 'casewise' });
    expect(longInvarianceRequest(ld, i).data.names).toEqual(['x1_t1', 'x2_t1', 'x1_t2', 'x2_t2', 'x1_t3', 'x2_t3']);
    const f = longInvarianceAnalysis.fingerprint(o, lctx)!;
    expect(longInvarianceAnalysis.fingerprint({ ...o, lag: 'adjacent' }, lctx)).not.toBe(f);
    expect(longInvarianceAnalysis.summary(o)).toBe('F · 3 occasions × 2 items');
  });
  it('shows the sequence as the multigroup table does, and the means under scalar invariance', () => {
    const lv = (level: 'configural' | 'metric' | 'scalar' | 'strict', chisq: number, df: number, extra = {}) => ({ level, chisq, df, cfi: 0.98, rmsea: 0.05, srmr: 0.03, factor: [{ mean: 0, variance: 1 }, { mean: -0.21, meanSe: 0.067, variance: 0.95, varianceSe: 0.1 }], ...extra });
    const r: LongInvarianceResult = {
      robust: true, n: 75, occasions: 2, items: 4, lag: 'all', warnings: [], engine: { package: 'semTools', version: '0.5.10', lavaan: '0.7.3' },
      levels: [lv('configural', 24.9, 15), lv('metric', 29.7, 18, { chisqDiff: 4.66, dfDiff: 3, p: 0.198, cfiChange: -0.003, rmseaChange: -0.002 }), lv('scalar', 36.4, 21, { chisqDiff: 6.8, dfDiff: 3, p: 0.04, cfiChange: -0.012, rmseaChange: 0.004 }), lv('strict', 45.5, 25)],
    };
    const html = renderToStaticMarkup(<longInvarianceAnalysis.View result={r} options={{ factor: 'Democracy', occasions: [], lag: 'all' }} current />);
    for (const s of ['Longitudinal measurement invariance of Democracy', 'ΔCFI', 'scaled, for the robust estimator', 'Factor means and variances under scalar invariance', '-0.210', 'fixed']) expect(html).toContain(s);
    expect(html).toMatch(/class="num bad"[^>]*>-0\.012/);
  });
});
