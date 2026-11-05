import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../model/project';
import type { MixtureResult } from '../rengine/mixture';
import { blockOf, mixtureAnalysis as mix, mixtureSpec } from './mixture';
import { buildMixture } from './mixtureSyntax';
import type { AnalysisCtx } from './types';

const n = 40;
const seq = (f: (i: number) => number) => Float64Array.from({ length: n }, (_, i) => f(i));
const data = {
  names: ['y', 'x1', 'x2', 'u1', 'u2', 'u3', 'u4', 'g', 'cnt'],
  cols: [seq((i) => (i % 7) * 0.9 + (i % 3)), seq((i) => (i % 5) / 2), seq((i) => (i % 4) - 1.5), seq((i) => i % 2), seq((i) => (i >> 1) % 2), seq((i) => (i % 3 === 0 ? 1 : 0)), seq((i) => (i % 5 < 2 ? 1 : 0)), seq((i) => (i < 20 ? 0 : 1)), seq((i) => (i % 6 === 0 ? 0 : i % 4))],
};
const ctx = (over: Partial<AnalysisCtx> = {}): AnalysisCtx => ({ data, info: null, settings: DEFAULT_SETTINGS, pls: null, projectName: 'p', ...over });
const spec = (syntax: string) => buildMixture(syntax, data, { seed: 1 });
const free = (s: string) => spec(s).spec.theta.length;

describe('mixture model card: options', () => {
  it('reads options from files; anything else is dropped', () => {
    expect(mix.parseOptions({ syntax: 'CLASSES = c (2);', starts: 9999, order: { c: [2, 1], d: 'x' } })).toEqual({ syntax: 'CLASSES = c (2);', starts: 500, order: { c: [2, 1] } });
    expect(mix.parseOptions({ syntax: 5 })).toEqual({ syntax: '' });
    expect(mix.parseOptions(null)).toBeNull();
    expect(mix.defaults(ctx())).toEqual({ syntax: '' });
  });

  it('says why it cannot run', () => {
    expect(mix.blocked({ syntax: '' }, ctx())).toBe('Write the model (Mplus syntax).');
    expect(mix.blocked({ syntax: 'MODEL: %OVERALL% y ON x1;' }, ctx())).toContain('CLASSES');
    expect(mix.blocked({ syntax: 'CLASSES = c (2); MODEL: %OVERALL% y ON zz;' }, ctx())).toContain('zz is not a column');
    expect(mix.blocked({ syntax: 'CLASSES = c (2); PARAMETERIZATION = RESCOVARIANCES; MODEL: %OVERALL% y ON x1;' }, ctx())).toContain('LOGIT, LOGLINEAR and PROBABILITY');
    expect(mix.blocked({ syntax: 'CLASSES = c (2); CATEGORICAL = u1-u4; MODEL: %OVERALL% f BY u1-u4;' }, ctx())).toContain('numerical integration');
    expect(mix.blocked({ syntax: 'CLASSES = c (2); MODEL: %OVERALL% y ON x1; %c#3% y;' }, ctx())).toContain('c has 2 classes');
    expect(mix.blocked({ syntax: 'CLASSES = c (2); MODEL: %OVERALL% y ON x1; c ON x2;', order: { c: [1, 1] } }, ctx())).toContain('give each of its classes');
    expect(mix.blocked({ syntax: 'CLASSES = c (2); MODEL: %OVERALL% y ON x1; c ON x2;' }, ctx({ data: null }))).toBe('Import raw data first.');
    expect(mix.blocked({ syntax: 'CLASSES = c (2); MODEL: %OVERALL% y ON x1; c ON x2;' }, ctx())).toBeNull();
  });

  it('is stale when the syntax, starts or seed change', () => {
    const o = { syntax: 'CLASSES = c (2); MODEL: %OVERALL% y ON x1;' };
    expect(mix.fingerprint(o, ctx())).not.toBe(mix.fingerprint({ ...o, starts: 5 }, ctx()));
    expect(mix.fingerprint(o, ctx())).not.toBe(mix.fingerprint(o, ctx({ settings: { ...DEFAULT_SETTINGS, seed: 9 } })));
    expect(mix.fingerprint({ syntax: 'CLASSES = c (2); MODEL: %OVERALL% y ON nothere;' }, ctx())).toBeNull();
  });
});

describe('Mplus syntax with Mplus’s defaults', () => {
  it('mixture regression (ex. 7.1): class-specific intercepts, slopes and variances where stated', () => {
    const s = 'CLASSES = c (2);\nMODEL:\n%OVERALL%\ny ON x1 x2;\nc ON x1;\n%c#2%\ny ON x2;\ny;';
    const p = spec(s);
    // 2 intercepts, x1 slope, 2 x2 slopes, 2 variances, c#1 and c#1 ON x1
    expect(p.spec.theta).toHaveLength(9);
    expect(p.spec.blocks).toEqual([expect.objectContaining({ type: 'normal', y: ['y'], x: ['x1', 'x2'], by: [0] })]);
    expect(p.spec.classes[0]).toMatchObject({ name: 'c', k: 2, covariates: ['x1'], parents: [] });
    expect(p.spec.columns).toEqual(['y', 'x1', 'x2']);
  });

  it('latent class analysis: thresholds by class, direct effects, labels, fixed values and MODEL CONSTRAINT', () => {
    expect(free('CLASSES = c (2); CATEGORICAL = u1-u4; MODEL: %OVERALL% c ON x1; u4 ON x1;')).toBe(11);
    const s = 'CLASSES = c (2); CATEGORICAL = u1-u4; MODEL: %OVERALL% %c#1% [u1$1*-1]; [u2$1-u3$1*-1] (1); [u4$1*-1] (p1); %c#2% [u1$1@-15]; [u2$1-u3$1*1] (2); [u4$1*1] (p2); MODEL CONSTRAINT: p2 = - p1;';
    const p = spec(s);
    expect(p.spec.theta).toHaveLength(5);
    const fixed = p.spec.report.find((r) => r.lhs === 'u1' && r.at[0] === 2)!;
    expect(fixed.fixed).toBe(true);
    expect(p.spec.slots[fixed.slot!].c).toBe(-15);
  });

  it('several class variables, known classes, counts, probabilities', () => {
    const lta = spec('CLASSES = cg (2) c (2); KNOWNCLASS = cg (g = 0 g = 1); MODEL: %OVERALL% c ON cg; MODEL c: %c#1% [y]; %c#2% [y]; MODEL cg: %cg#1% y; %cg#2% y;');
    expect(lta.classes).toEqual([{ name: 'cg', k: 2, known: true }, { name: 'c', k: 2, known: false }]);
    expect(lta.spec.classes[1].parents).toEqual([0]);
    expect(lta.spec.theta).toHaveLength(7);  // 2 means, 2 variances, cg#1, c#1, c#1 ON cg#1
    expect(spec('CLASSES = c (2); COUNT = cnt (i); MODEL: %OVERALL% cnt ON x1;').spec.blocks[0].type).toBe('zip');
    const pr = spec('CLASSES = c1 (2) c2 (2); CATEGORICAL = u1 u2; PARAMETERIZATION = PROBABILITY; MODEL: %OVERALL% c2 ON c1; MODEL c1: %c1#1% [u1$1] (1); %c1#2% [u1$1] (2); MODEL c2: %c2#1% [u2$1] (1); %c2#2% [u2$1] (2);');
    expect(pr.spec.classes.every((c) => c.prob)).toBe(true);
    expect(pr.spec.theta.filter((t) => t.group !== undefined)).toHaveLength(3);
    expect(() => spec('CLASSES = c (2); MODEL: %OVERALL% c2 ON c;')).toThrow(/not a column/);
  });

  it('applies a class order', () => {
    const o = { syntax: 'CLASSES = c (2); MODEL: %OVERALL% y ON x1;', order: { c: [2, 1] } };
    expect(mixtureSpec(o, ctx()).spec.order).toEqual([[2, 1]]);
  });
});

describe('mixture model card: view', () => {
  const r: MixtureResult = {
    n: 40, rows: 40, logLik: -80.5, npar: 5, aic: 171, bic: 179.4, entropy: 0.8, lls: [-80.5, -80.5], converged: true, theta: [],
    classes: [{ name: 'c', k: 2, shares: [0.4, 0.6] }], patterns: [{ classes: [1], share: 0.4 }, { classes: [2], share: 0.6 }],
    params: [
      { lhs: 'y', op: '~1', rhs: '', at: [1], est: 1.2, se: 0.1, fixed: false },
      { lhs: 'y', op: '~', rhs: 'x1', at: [0], est: 0.5, se: 0.05, fixed: false },
      { lhs: 'c#1', op: '~1', rhs: '', at: [0], est: -0.4, se: 0.2, fixed: false },
    ],
    warnings: [], engine: { package: 'R', version: '4.5' },
  };
  it('groups the parameters by class', () => {
    expect(blockOf(r.params[0], ['c'])).toBe('Class c#1');
    expect(blockOf(r.params[1], ['c'])).toBe('All classes');
    expect(blockOf(r.params[2], ['c'])).toBe('Latent class variables');
    const View = mix.View;
    const html = renderToStaticMarkup(<View result={r} options={{ syntax: '' }} current />);
    for (const t of ['Classes of c', 'Class c#1', 'All classes', '[y]', 'y ON x1', 'reached by 2 of the 2 starts']) expect(html).toContain(t);
  });
});
