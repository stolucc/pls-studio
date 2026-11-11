// The measurement invariance cards: options survive a project file, bad values are replaced, each card says what it
// still needs, the request it sends, and the views. (Their results against the R packages run natively:
// src/examples/cards/invariance.webr.test.ts and src/rengine/invariance.webr.test.ts.)

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type ModelState } from '../model/project';
import type { AlignmentResult, DmacsResult, LongInvarianceResult, LsemResult, MimicDifResult, MnlfaResult } from '../rengine/invariance';
import { alignmentRequest, detectOccasions, dmacsRequest, longInvarianceRequest, lsemRequest, lsemResult, mimicDifRequest, mnlfaRequest, rows } from '../rengine/invariance';
import { ANALYSIS_TYPES } from './registry';
import type { AnalysisCtx } from './types';
import { alignmentAnalysis, alignmentInput, dmacsAnalysis, dmacsInput, invLavaan, modelGroups, lsemAnalysis, lsemInput, lsemKind, lsemLabel, moderatorRange, longInvarianceAnalysis, longInvarianceInput, mimicDifAnalysis, mimicDifInput, mnlfaAnalysis, mnlfaInput, mnlfaUnidentified, modelFactors } from './invariance';

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

describe('DIF by MIMIC card', () => {
  it('is in the Add menu under Measurement, starts from a factor with three indicators, and parses its options', () => {
    expect(ANALYSIS_TYPES.find((t) => t.id === 'mimicdif')?.group).toBe('Measurement');
    const d = mimicDifAnalysis.defaults(ctx);
    expect(d).toEqual({ construct: 'A', covariate: '', adjust: 'holm', alpha: 0.05, free: true });
    expect(mimicDifAnalysis.parseOptions(d)).toEqual(d);
    expect(mimicDifAnalysis.parseOptions({ construct: 1, adjust: 'fdr', alpha: 2, free: 'yes' })).toEqual({ construct: '', covariate: '', adjust: 'holm', alpha: 0.5, free: false });
    expect(mimicDifAnalysis.parseOptions(null)).toBeNull();
  });
  it('says what it still needs', () => {
    const d = { ...mimicDifAnalysis.defaults(ctx), covariate: 'x' };
    expect(mimicDifAnalysis.blocked(d, ctx)).toBeNull();
    expect(mimicDifAnalysis.blocked({ ...d, construct: '' }, ctx)).toMatch(/Choose a factor/);
    expect(mimicDifAnalysis.blocked({ ...d, construct: '' }, bare)).toMatch(/Draw a measurement model/);
    expect(mimicDifAnalysis.blocked({ ...d, construct: 'B' }, ctx)).toMatch(/at least three/);
    expect(mimicDifAnalysis.blocked({ ...d, covariate: '' }, ctx)).toMatch(/covariate/);
    expect(mimicDifAnalysis.blocked({ ...d, covariate: 'a2' }, ctx)).toMatch(/indicator/);
    expect(mimicDifAnalysis.blocked({ ...d, covariate: 'g' }, ctx)).toMatch(/5 categories/);
    expect(mimicDifAnalysis.blocked({ ...d, covariate: 'gone' }, ctx)).toMatch(/gone/);
  });
  it('sends the factor, the covariate and the settings', () => {
    const o = { ...mimicDifAnalysis.defaults(ctx), covariate: 'x', adjust: 'BH' as const };
    const i = mimicDifInput(o, ctx);
    expect(i).toMatchObject({ factors: [{ name: 'A', indicators: ['a1', 'a2', 'a3'] }], covariate: 'x', adjust: 'BH', alpha: 0.05, free: true, estimator: 'ML', missing: 'casewise' });
    expect(mimicDifRequest(data, i).data.names).toEqual(['a1', 'a2', 'a3', 'x']);
    const f = mimicDifAnalysis.fingerprint(o, ctx)!;
    expect(mimicDifAnalysis.fingerprint({ ...o, free: false }, ctx)).not.toBe(f);
    expect(mimicDifAnalysis.summary(o)).toBe('A on x · Benjamini–Hochberg · flagged freed');
  });
  it('shows the direct effects, the flagged items and the corrected factor difference', () => {
    const e = (est: number, p = 0.5) => ({ est, se: 0.1, z: est / 0.1, p, std: est / 2 });
    const item = (it: string, est: number, pAdj: number) => ({ item: it, ...e(est, pAdj / 2), chisq: 3, df: 1, pLrt: pAdj / 2, pAdj, flagged: pAdj < 0.05, score: 2.9, scoreP: 0.09 });
    const fit = { chisq: 13.6, df: 5, cfi: 0.95, rmsea: 0.075, srmr: 0.044 };
    const r: MimicDifResult = {
      n: 301, factor: 'visual', covariate: 'sex', adjust: 'holm', alpha: 0.05, effect: e(-0.25, 0.02), fit, items: [item('x1', 0.1, 0.67), item('x9', 0.324, 0.016)], flagged: ['x9'],
      final: { effect: e(-0.319, 0.004), fit, direct: [{ item: 'x9', ...e(0.324, 0.004) }] }, scoreError: false, warnings: [], engine: { package: 'lavaan', version: '0.7.3' },
    };
    const html = renderToStaticMarkup(<mimicDifAnalysis.View result={r} options={mimicDifAnalysis.defaults(ctx)} current />);
    for (const s of ['Uniform DIF: direct effects of sex on the items of visual', 'p (Holm)', 'With the flagged items’ direct effects (x9)', '-0.319', 'Direct effects in the final model']) expect(html).toContain(s);
    expect(html).toMatch(/class="bad"[^>]*>0\.016/);
  });
});

describe('local SEM card', () => {
  const lc = ['a1', 'a2', 'a3', 'g', 'x'];
  const ldata = { names: lc, cols: lc.map((n, k) => Float64Array.from({ length: 40 }, (_, i) => (n === 'g' ? i : n === 'x' ? i % 7 : Math.sin(i * (k + 1) * 1.3) + i / 20))) };
  const lmodel = { constructs: [model.constructs[0]], paths: [], moderations: [] } as unknown as ModelState;
  const cb: AnalysisCtx = { ...bare, data: ldata, model: lmodel, settings: { ...DEFAULT_SETTINGS, method: 'cbsem', estimator: 'ML', missing: 'casewise' } };
  const d = lsemAnalysis.defaults(cb);
  it('is in the Add menu under Measurement, beside MNLFA, and parses its options', () => {
    const ids = ANALYSIS_TYPES.map((t) => t.id);
    expect(ids.indexOf('lsem')).toBe(ids.indexOf('mnlfa') + 1);
    expect(lsemAnalysis.group).toBe('Measurement');
    expect(lsemAnalysis.parseOptions(d)).toEqual(d);
    expect(lsemAnalysis.parseOptions(null)).toBeNull();
    expect(lsemAnalysis.parseOptions({ moderator: 'g', from: '2', to: 'x', points: 500, h: -1, kernel: 'box', bootstrap: 'yes', bootR: 3, permutation: false, permB: 1e9 }))
      .toEqual({ ...d, moderator: 'g', from: 2, to: null, points: 100, h: 0.05, kernel: 'gaussian', bootstrap: false, bootR: 10, permutation: false, permB: 5000 });
    expect(lsemAnalysis.parseOptions({ from: Infinity, to: 1e300 })).toMatchObject({ from: null, to: null });
  });
  it('says what it still needs', () => {
    expect(lsemAnalysis.blocked(d, ctx)).toMatch(/CB-SEM/);
    expect(lsemAnalysis.blocked(d, cb)).toMatch(/moderator/);
    expect(lsemAnalysis.blocked({ ...d, moderator: 'a1' }, cb)).toMatch(/variable of the model/);
    expect(lsemAnalysis.blocked({ ...d, moderator: 'gone' }, cb)).toMatch(/gone/);
    expect(lsemAnalysis.blocked({ ...d, moderator: 'g', from: 5, to: 1 }, cb)).toMatch(/above the first/);
    expect(lsemAnalysis.blocked({ ...d, moderator: 'g' }, cb)).toBeNull();
    expect(lsemAnalysis.blocked({ ...d, moderator: 'g' }, { ...cb, settings: { ...cb.settings, estimator: 'WLSMV' } })).toMatch(/ML or MLR/);
    expect(lsemAnalysis.blocked({ ...d, moderator: 'g' }, { ...cb, settings: { ...cb.settings, missing: 'pairwise' } })).toMatch(/FIML, casewise/);
    expect(lsemAnalysis.blocked({ ...d, moderator: 'g' }, { ...cb, model: { ...lmodel, multigroup: { column: 'x', invariance: 'configural', free: [] } } })).toMatch(/remove the grouping/);
    expect(lsemAnalysis.blocked({ ...d, moderator: 'g' }, { ...cb, model: { ...lmodel, ordered: ['a1'] } })).toMatch(/ordinal/);
  });
  it('sends the moderator column, the focal points (the moderator’s range by default), the kernel and the project’s seed', () => {
    expect(moderatorRange(cb, 'g')).toEqual([0, 39]);
    expect(moderatorRange(cb, 'nope')).toBeNull();
    const i = lsemInput({ ...d, moderator: 'g', bootstrap: true, bootR: 50 }, cb);
    expect(i).toEqual({ moderator: 'g', from: 0, to: 39, points: 15, h: 1.1, kernel: 'gaussian', bootstrap: 50, permutations: 100, seed: 1234 });
    expect(lsemInput({ ...d, moderator: 'g', from: 1, permutation: false }, cb)).toMatchObject({ from: 1, to: 39, bootstrap: 0, permutations: 0 });
    const req = lsemRequest({ data: { ...ldata, cols: ldata.cols.map((c, k) => (k === 3 ? Float64Array.from(c, (v, j) => (j === 0 ? NaN : v)) : c)) }, spec: { constructs: [], paths: [] } as never, missing: 'casewise', estimator: 'ML', interaction: 'product' }, { ...i, bootstrap: 0 }) as unknown as { lsem: unknown; moderator: { name: string; col: (number | null)[] } };
    expect(req.lsem).toEqual({ from: 0, to: 39, points: 15, h: 1.1, kernel: 'gaussian', permutations: 100, seed: 1234 });
    expect(req.moderator.name).toBe('g');
    expect(req.moderator.col.slice(0, 3)).toEqual([null, 1, 2]);
    expect(() => lsemRequest({ data: ldata, spec: { constructs: [], paths: [] } as never, missing: 'casewise', estimator: 'ML', interaction: 'product' }, { ...i, moderator: 'nope' })).toThrow(/nope/);
  });
  it('changes its fingerprint with the options', () => {
    const o = { ...d, moderator: 'g' };
    const f = lsemAnalysis.fingerprint(o, cb);
    expect(f).toBeTruthy();
    expect(lsemAnalysis.fingerprint({ ...o, h: 2 }, cb)).not.toBe(f);
    expect(lsemAnalysis.fingerprint({ ...o, moderator: 'x' }, cb)).not.toBe(f);
  });
  const raw = {
    moderator: 'g', grid: [1, 2], n: 12, h: 2, bw: 0.9, kernel: 'gaussian', weight: [0.5, 0.5], neff: [10, 9], bootstrap: 20, permutations: 10, seed: 1234, warnings: [], engine: { package: 'sirt', version: '4.2.133', lavaan: '0.7.3' },
    params: [
      { par: 'A=~a1', op: '=~', lhs: 'A', rhs: 'a1', est: [1.2, 1.4], se: [0.1, 0.12], summary: { mean: 1.3, sd: 0.1, mad: 0.1, min: 1.2, max: 1.4, linInt: 1, linSlope: 0.2, sdNonlin: 0 }, boot: { se: [0.2, 0.2], lower: [0.8, 1], upper: [1.6, 1.8] }, test: { sdP: 0.1, madP: 0.2, linSlopeP: 0.3, pointwise: [0.5, null] } },
      { par: 'A~~A', op: '~~', lhs: 'A', rhs: 'A', est: [1, 1], se: [0, 0] },
      { par: 'a1~~a1', op: '~~', lhs: 'a1', rhs: 'a1', est: 0.5, se: 0.1 },
      { par: 'a1~1', op: '~1', lhs: 'a1', rhs: '', est: [3, 3], se: [0.1, 0.1] },
      { par: 'rmsea', op: 'fit', lhs: 'rmsea', rhs: '', est: [0.01, 0.02], se: [null, null] },
    ],
  };
  it('reads R’s reply (single values unboxed) and sorts the parameters by kind', () => {
    const r = lsemResult(raw);
    expect(r.params[2].est).toEqual([0.5]);
    expect(r.params[0].test?.pointwise).toEqual([0.5, null]);
    expect(r.params[1].boot).toBeUndefined();
    const factors = new Set(['A']);
    expect(r.params.map((p) => lsemKind(p, factors))).toEqual(['loading', 'variance', 'residual', 'intercept', 'fit']);
    expect(lsemKind({ ...r.params[0], op: '~' }, factors)).toBe('path');
    expect(lsemKind({ ...r.params[3], lhs: 'A' }, factors)).toBe('mean');
    expect(lsemKind({ ...r.params[1], rhs: 'B' }, factors)).toBe('covariance');
    expect(r.params.map(lsemLabel)).toEqual(['A =~ a1', 'A ~~ A', 'a1 ~~ a1', 'a1 ~1', 'RMSEA']);
  });
  it('charts the curves with bootstrap bands and tables the variation, the permutation p values and the focal points', () => {
    const r = lsemResult(raw) as LsemResult;
    const html = renderToStaticMarkup(<lsemAnalysis.View result={r} options={d} current />);
    expect(html).toContain('Variation of the parameters along the moderator');
    expect(html).toContain('<polygon');
    expect(html).toContain('p (SD)');
    expect(html).toContain('Bootstrap standard errors at the focal points');
    expect(html).toContain('Pointwise permutation p values');
    expect(html).toContain('Effective N');
    expect(html).toContain('A =~ a1');
  });
});

describe('dMACS card', () => {
  const grouped = { ...model, multigroup: { column: 'g', invariance: 'configural', free: [] } } as unknown as ModelState;
  const settings = { ...DEFAULT_SETTINGS, method: 'cbsem' as const, estimator: 'ML' as const, missing: 'casewise' as const };
  // (a model the validation accepts: three varying indicators of A, the grouping column g)
  const gc = ['a1', 'a2', 'a3', 'g'];
  const gcols = gc.map((n, k) => Float64Array.from({ length: 40 }, (_, i) => {
    if (n === 'g') return i < 20 ? 2 : 1;
    return Math.sin(i * (k + 1) * 1.3) + i / 20;
  }));
  const gdata = { names: gc, cols: gcols, categories: { g: ['north', 'south'] } };
  const gmodel = { constructs: [model.constructs[0]], paths: [], moderations: [], multigroup: grouped.multigroup } as unknown as ModelState;
  const gctx: AnalysisCtx = { ...bare, data: gdata, model: gmodel, settings };
  const d = dmacsAnalysis.defaults(gctx);

  it('is in the Add menu under Measurement and parses its options', () => {
    expect(dmacsAnalysis.group).toBe('Measurement');
    expect(dmacsAnalysis.parseOptions(d)).toEqual(d);
    expect(dmacsAnalysis.parseOptions(null)).toBeNull();
    expect(dmacsAnalysis.parseOptions({ reference: 3, sd: 'glass' })).toEqual({ reference: '', sd: 'pooled' });
    expect(dmacsAnalysis.parseOptions({ reference: 'south', sd: 'reference' })).toEqual({ reference: 'south', sd: 'reference' });
  });

  it('lists the groups in order of appearance, by name, with their lavaan codes', () => {
    expect(modelGroups(gctx)).toEqual([{ label: '2', name: 'south' }, { label: '1', name: 'north' }]);
    expect(modelGroups({ ...gctx, model: lmodelOf(gmodel) })).toEqual([]);
    expect(dmacsInput({ reference: 'north', sd: 'pooled' }, gctx)).toEqual({ reference: '1', sd: 'pooled' });
    expect(dmacsInput(d, gctx)).toEqual({ reference: null, sd: 'pooled' });
  });

  it('says what it still needs', () => {
    expect(dmacsAnalysis.blocked(d, { ...gctx, settings: DEFAULT_SETTINGS })).toMatch(/CB-SEM/);
    expect(dmacsAnalysis.blocked(d, { ...gctx, model: lmodelOf(gmodel) })).toMatch(/grouping column/);
    const noMeans = { ...gmodel, multigroup: { ...gmodel.multigroup!, meanStructure: false as const } };
    expect(dmacsAnalysis.blocked(d, { ...gctx, model: noMeans })).toMatch(/mean structure/);
    expect(dmacsAnalysis.blocked(d, { ...gctx, model: { ...gmodel, ordered: ['a1'] } })).toMatch(/ordinal/);
    expect(dmacsAnalysis.blocked({ ...d, reference: 'east' }, gctx)).toMatch(/east is not a group/);
    expect(dmacsAnalysis.blocked(d, gctx)).toBeNull();
  });

  it('sends the reference group’s code and the SD', () => {
    const call = { data: gdata, spec: { constructs: [], paths: [] } as never, missing: 'casewise' as const, estimator: 'ML' as const, interaction: 'product' as const };
    const withRef = dmacsRequest(call, { reference: '1', sd: 'reference' }) as unknown as { dmacs: unknown };
    expect(withRef.dmacs).toEqual({ sd: 'reference', reference: '1' });
    const first = dmacsRequest(call, { reference: null, sd: 'pooled' }) as unknown as { dmacs: unknown };
    expect(first.dmacs).toEqual({ sd: 'pooled' });
  });

  it('shows each focal group’s items, marking dMACS from .2, and the scale biases', () => {
    const item = { focal: 'north', factor: 'A', lambdaRef: 1, nuRef: 0, lambdaFocal: 1, nuFocal: 0, sd: 1, signed: 0, meanBias: 0, varBias: 0 };
    const r: DmacsResult = {
      groups: ['south', 'north', 'east'], reference: 'south', sd: 'pooled', n: [20, 20, 5],
      items: [{ ...item, item: 'a1', dmacs: 0.05 }, { ...item, item: 'a2', dmacs: 0.45 }, { ...item, focal: 'east', item: 'a1', dmacs: 0 }],
      scales: [{ focal: 'north', factor: 'A', items: 2, kappa: 0.1, phi: 1.2, meanBias: 0.3, varBias: -0.2 }],
      warnings: [], engine: { package: 'lavaan', version: '0.7.3' },
    };
    const html = renderToStaticMarkup(<dmacsAnalysis.View result={r} options={d} current />);
    expect(html).toContain('dMACS by item: north against south');
    expect(html).toContain('dMACS by item: east against south');
    expect(html).toContain('Expected bias in the scale scores');
    expect(html).toContain('Focal group');
    expect((html.match(/warn/g) ?? []).length).toBe(1);
  });
});

function lmodelOf(m: ModelState): ModelState {
  const { multigroup: _drop, ...rest } = m;
  return rest as ModelState;
}
