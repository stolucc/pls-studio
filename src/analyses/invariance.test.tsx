// The measurement invariance cards: options survive a project file, bad values are replaced, each card says what it
// still needs, the request it sends, and the views. (Their results against the R packages run natively:
// src/examples/cards/invariance.webr.test.ts and src/rengine/invariance.webr.test.ts.)

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type ModelState } from '../model/project';
import type { AlignmentResult } from '../rengine/invariance';
import { alignmentRequest, rows } from '../rengine/invariance';
import { ANALYSIS_TYPES } from './registry';
import type { AnalysisCtx } from './types';
import { alignmentAnalysis, alignmentInput, invLavaan, modelFactors } from './invariance';

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
