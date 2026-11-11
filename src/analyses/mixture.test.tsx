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
  cols: [
    seq((i) => (i % 7) * 0.9 + (i % 3)),
    seq((i) => (i % 5) / 2),
    seq((i) => (i % 4) - 1.5),
    seq((i) => i % 2),
    seq((i) => (i >> 1) % 2),
    seq((i) => (i % 3 === 0 ? 1 : 0)),
    seq((i) => (i % 5 < 2 ? 1 : 0)),
    seq((i) => (i < 20 ? 0 : 1)),
    seq((i) => (i % 6 === 0 ? 0 : i % 4)),
  ],
};
const ctx = (over: Partial<AnalysisCtx> = {}): AnalysisCtx => ({
  data,
  info: null,
  settings: DEFAULT_SETTINGS,
  pls: null,
  projectName: 'p',
  ...over,
});
const spec = (syntax: string) => buildMixture(syntax, data, { seed: 1 });
const free = (s: string) => spec(s).spec.theta.length;

describe('mixture model card: options', () => {
  it('reads options from files; anything else is dropped', () => {
    expect(
      mix.parseOptions({ syntax: 'CLASSES = c (2);', starts: 9999, order: { c: [2, 1], d: 'x' } }),
    ).toEqual({ syntax: 'CLASSES = c (2);', starts: 500, order: { c: [2, 1] } });
    expect(mix.parseOptions({ syntax: 5 })).toEqual({ syntax: '' });
    expect(mix.parseOptions(null)).toBeNull();
    expect(mix.defaults(ctx())).toEqual({ syntax: '' });
  });

  it('says why it cannot run', () => {
    expect(mix.blocked({ syntax: '' }, ctx())).toBe('Write the model (Mplus syntax).');
    expect(mix.blocked({ syntax: 'MODEL: %OVERALL% y ON x1;' }, ctx())).toContain('CLASSES');
    expect(mix.blocked({ syntax: 'CLASSES = c (2); MODEL: %OVERALL% y ON zz;' }, ctx())).toContain(
      'zz is not a column',
    );
    expect(
      mix.blocked(
        { syntax: 'CLASSES = c (2); PARAMETERIZATION = THETA; MODEL: %OVERALL% y ON x1;' },
        ctx(),
      ),
    ).toContain('LOGIT, LOGLINEAR, PROBABILITY and RESCOVARIANCES');
    expect(
      mix.blocked(
        { syntax: 'CLASSES = c (2); CATEGORICAL = u1-u4; MODEL: %OVERALL% f BY u1-u4;' },
        ctx(),
      ),
    ).toContain('numerical integration');
    expect(
      mix.blocked({ syntax: 'CLASSES = c (2); MODEL: %OVERALL% y ON x1; %c#3% y;' }, ctx()),
    ).toContain('c has 2 classes');
    expect(
      mix.blocked(
        { syntax: 'CLASSES = c (2); MODEL: %OVERALL% y ON x1; c ON x2;', order: { c: [1, 1] } },
        ctx(),
      ),
    ).toContain('give each of its classes');
    expect(
      mix.blocked(
        { syntax: 'CLASSES = c (2); MODEL: %OVERALL% y ON x1; c ON x2;' },
        ctx({ data: null }),
      ),
    ).toBe('Import raw data first.');
    expect(
      mix.blocked({ syntax: 'CLASSES = c (2); MODEL: %OVERALL% y ON x1; c ON x2;' }, ctx()),
    ).toBeNull();
  });

  it('is stale when the syntax, starts or seed change', () => {
    const o = { syntax: 'CLASSES = c (2); MODEL: %OVERALL% y ON x1;' };
    expect(mix.fingerprint(o, ctx())).not.toBe(mix.fingerprint({ ...o, starts: 5 }, ctx()));
    expect(mix.fingerprint(o, ctx())).not.toBe(
      mix.fingerprint(o, ctx({ settings: { ...DEFAULT_SETTINGS, seed: 9 } })),
    );
    expect(
      mix.fingerprint({ syntax: 'CLASSES = c (2); MODEL: %OVERALL% y ON nothere;' }, ctx()),
    ).toBeNull();
  });
});

describe('Mplus syntax with Mplus’s defaults', () => {
  it('mixture regression (ex. 7.1): class-specific intercepts, slopes and variances where stated', () => {
    const s = 'CLASSES = c (2);\nMODEL:\n%OVERALL%\ny ON x1 x2;\nc ON x1;\n%c#2%\ny ON x2;\ny;';
    const p = spec(s);
    // 2 intercepts, x1 slope, 2 x2 slopes, 2 variances, c#1 and c#1 ON x1
    expect(p.spec.theta).toHaveLength(9);
    expect(p.spec.blocks).toEqual([
      expect.objectContaining({ type: 'normal', y: ['y'], x: ['x1', 'x2'], by: [0] }),
    ]);
    expect(p.spec.classes[0]).toMatchObject({ name: 'c', k: 2, covariates: ['x1'], parents: [] });
    expect(p.spec.columns).toEqual(['y', 'x1', 'x2']);
  });

  it('latent class analysis: thresholds by class, direct effects, labels, fixed values and MODEL CONSTRAINT', () => {
    expect(free('CLASSES = c (2); CATEGORICAL = u1-u4; MODEL: %OVERALL% c ON x1; u4 ON x1;')).toBe(
      11,
    );
    const s =
      'CLASSES = c (2); CATEGORICAL = u1-u4; MODEL: %OVERALL% %c#1% [u1$1*-1]; [u2$1-u3$1*-1] (1); [u4$1*-1] (p1); %c#2% [u1$1@-15]; [u2$1-u3$1*1] (2); [u4$1*1] (p2); MODEL CONSTRAINT: p2 = - p1;';
    const p = spec(s);
    expect(p.spec.theta).toHaveLength(5);
    const fixed = p.spec.report.find((r) => r.lhs === 'u1' && r.at[0] === 2)!;
    expect(fixed.fixed).toBe(true);
    expect(p.spec.slots[fixed.slot!].c).toBe(-15);
  });

  it('several class variables, known classes, counts, probabilities', () => {
    const lta = spec(
      'CLASSES = cg (2) c (2); KNOWNCLASS = cg (g = 0 g = 1); MODEL: %OVERALL% c ON cg; MODEL c: %c#1% [y]; %c#2% [y]; MODEL cg: %cg#1% y; %cg#2% y;',
    );
    expect(lta.classes).toEqual([
      { name: 'cg', k: 2, known: true },
      { name: 'c', k: 2, known: false },
    ]);
    expect(lta.spec.classes[1].parents).toEqual([0]);
    expect(lta.spec.theta).toHaveLength(7); // 2 means, 2 variances, cg#1, c#1, c#1 ON cg#1
    expect(
      spec('CLASSES = c (2); COUNT = cnt (i); MODEL: %OVERALL% cnt ON x1;').spec.blocks[0].type,
    ).toBe('zip');
    const pr = spec(
      'CLASSES = c1 (2) c2 (2); CATEGORICAL = u1 u2; PARAMETERIZATION = PROBABILITY; MODEL: %OVERALL% c2 ON c1; MODEL c1: %c1#1% [u1$1] (1); %c1#2% [u1$1] (2); MODEL c2: %c2#1% [u2$1] (1); %c2#2% [u2$1] (2);',
    );
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
    n: 40,
    rows: 40,
    logLik: -80.5,
    npar: 5,
    aic: 171,
    bic: 179.4,
    entropy: 0.8,
    lls: [-80.5, -80.5],
    converged: true,
    theta: [],
    classes: [{ name: 'c', k: 2, shares: [0.4, 0.6] }],
    patterns: [
      { classes: [1], share: 0.4 },
      { classes: [2], share: 0.6 },
    ],
    params: [
      { lhs: 'y', op: '~1', rhs: '', at: [1], est: 1.2, se: 0.1, fixed: false },
      { lhs: 'y', op: '~', rhs: 'x1', at: [0], est: 0.5, se: 0.05, fixed: false },
      { lhs: 'c#1', op: '~1', rhs: '', at: [0], est: -0.4, se: 0.2, fixed: false },
    ],
    warnings: [],
    engine: { package: 'R', version: '4.5' },
  };
  it('groups the parameters by class', () => {
    expect(blockOf(r.params[0], ['c'])).toBe('Class c#1');
    expect(blockOf(r.params[1], ['c'])).toBe('All classes');
    expect(blockOf(r.params[2], ['c'])).toBe('Latent class variables');
    const View = mix.View;
    const html = renderToStaticMarkup(<View result={r} options={{ syntax: '' }} current />);
    for (const t of [
      'Classes of c',
      'Class c#1',
      'All classes',
      '[y]',
      'y ON x1',
      'reached by 2 of the 2 starts',
    ])
      expect(html).toContain(t);
  });
});

describe('mixture model card: numerical integration and two-level models', () => {
  const intSpec = (syntax: string) => spec(`ALGORITHM = INTEGRATION; ${syntax}`).spec;
  it('integrates factors of categorical outcomes (within each case), with Mplus’s rule by default', () => {
    const s = intSpec('CLASSES = c (2); CATEGORICAL = u1-u4; MODEL: %OVERALL% f BY u1-u4;');
    expect(s.lat).toMatchObject({ level: 'within', d: 1, names: ['f'], rule: 'rect', points: 15 });
    // (loadings 3, thresholds equal across classes 4, factor variance, mean in class 1, class logit)
    expect(s.theta.length).toBe(10);
    expect(s.blocks.every((b) => b.nl === 1)).toBe(true);
    expect(
      spec(
        'CLASSES = c (2); CATEGORICAL = u1-u4; ALGORITHM = INTEGRATION; INTEGRATION = GAUSSHERMITE (10); MODEL: %OVERALL% f BY u1-u4;',
      ).spec.lat,
    ).toMatchObject({ rule: 'gh', points: 10 });
  });
  it('a latent class variable regressed on a factor integrates it outside the classes', () => {
    const s = intSpec('CLASSES = c (2); CATEGORICAL = u1-u4; MODEL: %OVERALL% f BY; f@1; c ON f;');
    expect(s.lat).toMatchObject({ level: 'between', names: ['f'] });
    expect(s.classes[0].nl).toBe(1);
    expect(() =>
      spec('CLASSES = c (2); CATEGORICAL = u1-u4; MODEL: %OVERALL% f BY u1-u4; c ON f;'),
    ).toThrow(/ALGORITHM = INTEGRATION/);
  });
  it('reads negative binomial counts, label lists, ranges of latent variables and non-linear constraints', () => {
    const nb = intSpec('CLASSES = c (2); COUNT = cnt (nb); MODEL: %OVERALL% i s | cnt@0; ');
    expect(nb.blocks[0].type).toBe('nb');
    const s = intSpec(
      `CLASSES = c (1); CATEGORICAL = u1-u4; MODEL: %OVERALL% f1 BY u1 u2 (l2); f2 BY u3 u4 (l2); f1-f2 (v); MODEL CONSTRAINT: NEW(a); v = a**2;`,
    );
    expect(s.derived?.map((d) => d.name)).toEqual(['v']);
    expect(s.theta.map((t) => t.name)).toContain('a');
    expect(s.report.find((r) => r.op === 'new')).toMatchObject({ lhs: 'a' });
  });
  it('a residual covariance of categorical outcomes (RESCOVARIANCES) is an integrated factor', () => {
    const s = spec(
      'CLASSES = c (2); CATEGORICAL = u1-u4; PARAMETERIZATION = RESCOVARIANCES; MODEL: %OVERALL% %c#1% u2 WITH u3;',
    ).spec;
    expect(s.lat?.d).toBe(1);
    expect(s.report.some((r) => r.lhs === 'u3' && r.op === '~~' && r.rhs === 'u2')).toBe(true);
  });
  it('two-level: random intercepts, between-level classes and outcomes, levels in the report', () => {
    const tl = (syntax: string) => spec(`TYPE = TWOLEVEL MIXTURE; CLUSTER = g; ${syntax}`).spec;
    const s = tl(
      'CLASSES = c (2); WITHIN = x1; BETWEEN = x2; MODEL: %WITHIN% %OVERALL% y ON x1; %BETWEEN% %OVERALL% y ON x2; c#1; c#1 ON x2;',
    );
    expect(s.cluster).toBe('g');
    expect(s.lat).toMatchObject({ level: 'between', names: ['c#1@b', 'y@b'] });
    expect(
      s.report.find((r) => r.lhs === 'y' && r.op === '~~' && r.level === 'between'),
    ).toBeTruthy();
    expect(s.report.find((r) => r.lhs === 'y' && r.op === '~' && r.rhs === 'x1')?.level).toBe(
      'within',
    );
    const b = tl(
      'CLASSES = cb (2); CATEGORICAL = u1; BETWEEN = cb u1 x2; MODEL: %WITHIN% %OVERALL% y ON x1; %BETWEEN% %OVERALL% cb ON x2;',
    );
    expect(b.classes[0].level).toBe('b');
    expect(b.blocks.find((x) => x.y[0] === 'u1')?.level).toBe('b');
    const r = tl(
      'CLASSES = cb (2); BETWEEN = cb; MODEL: %WITHIN% %OVERALL% s | y ON x1; %BETWEEN% %OVERALL% s@0; %cb#1% [s]; %cb#2% [s];',
    );
    expect(r.report.filter((x) => x.lhs === 's' && x.op === '~1').length).toBe(2);
    expect(() =>
      spec('CLASSES = c (2); TYPE = TWOLEVEL MIXTURE; MODEL: %WITHIN% %OVERALL% y ON x1;'),
    ).toThrow(/CLUSTER/);
    expect(() =>
      tl('CLASSES = cb (2); BETWEEN = cb; MODEL: %WITHIN% %OVERALL% s | y ON x1;'),
    ).toThrow(/random slopes with a variance/);
  });
  it('a class-specific regression of one latent class variable on another adds to the overall one', () => {
    const s = spec(
      'CLASSES = cb (2) c1 (2) c2 (2); CATEGORICAL = u1-u2; MODEL: %OVERALL% c2 ON c1; MODEL cb: %cb#1% c2 ON c1;',
    ).spec;
    const rows = s.report.filter((r) => r.lhs === 'c2#1' && r.op === '~' && r.rhs === 'c1#1');
    expect(rows.map((r) => r.at)).toEqual([
      [0, 0, 0],
      [1, 0, 0],
    ]);
  });
});
