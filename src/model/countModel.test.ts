import { describe, expect, it } from 'vitest';
import { buildQuad } from '../analyses/quadmlSyntax';
import { quadAnalysis as quad, quadSpec } from '../analyses/quadml';
import type { AnalysisCtx } from '../analyses/types';
import { menuFor } from '../components/canvasMenu';
import { useStore } from '../store';
import { countIndicators, countModelSyntax } from './countModel';
import {
  DEFAULT_SETTINGS,
  parseProject,
  serializeProject,
  type ModelState,
  type Settings,
} from './project';
import { toMplus } from './syntax';
import { validateModel } from './validate';

const C = (id: string, name: string, indicators: string[], more: object = {}) => ({
  id,
  name,
  type: 'factor' as const,
  mode: 'A' as const,
  indicators,
  x: 0,
  y: 0,
  side: 'left' as const,
  ...more,
});
const U = ['u11', 'u12', 'u13', 'u14'];
/** Mplus ex. 6.6 drawn on the canvas: i and s with fixed loadings, free means, intercepts at 0, i with s, Poisson counts. */
const growthOnCanvas = (): ModelState => ({
  constructs: [
    C('i', 'i', U, { fixedLoadings: { u11: 1, u12: 1, u13: 1, u14: 1 } }),
    C('s', 's', U, { fixedLoadings: { u11: 0, u12: 1, u13: 2, u14: 3 } }),
  ],
  paths: [],
  moderations: [],
  correlations: [{ id: 'k', kind: 'construct', a: 'i', b: 's' }],
  constant: { x: 0, y: 0 },
  means: [
    { id: 'm1', target: 'i' },
    { id: 'm2', target: 's' },
  ],
  parameters: U.map((u) => ({
    id: `p${u}`,
    kind: 'intercept' as const,
    target: u,
    indicator: true,
    fixed: 0,
  })),
  count: Object.fromEntries(U.map((u) => [u, 'poisson' as const])),
});
const CB: Settings = { ...DEFAULT_SETTINGS, method: 'cbsem', estimator: 'MLR', missing: 'fiml' };
const n = 80;
const seq = (f: (i: number) => number) => Float64Array.from({ length: n }, (_, i) => f(i));
const names = [...U, 'y1', 'y2', 'y3', 'x', 'g'];
const data = {
  names,
  cols: [
    ...U.map((_, k) => seq((i) => (i * (k + 3)) % 5)),
    seq((i) => Math.sin(i)),
    seq((i) => i % 3),
    seq((i) => (i % 7) / 3),
    seq((i) => (i % 4) - 1.5),
    seq((i) => 1 + (i % 2)),
  ],
};
const syn = (m: ModelState, s: Partial<Settings> = {}) =>
  countModelSyntax(m, { ...CB, ...s }, data.names);
const ok = (m: ModelState, s: Partial<Settings> = {}) => {
  const r = syn(m, s);
  if ('error' in r) throw new Error(r.error);
  return r;
};
const why = (m: ModelState, s: Partial<Settings> = {}) => {
  const r = syn(m, s);
  return 'error' in r ? r.error : null;
};

describe('count indicators: the diagram in the integration card’s syntax', () => {
  it('writes the growth model of Mplus ex. 6.6 as the card reads it, with the Mplus parameters', () => {
    const r = ok(growthOnCanvas());
    expect(r.syntax).toBe(
      [
        'COUNT = u11 u12 u13 u14;',
        'ANALYSIS: ESTIMATOR = MLR;',
        'MODEL:',
        'i BY u11@1;',
        'i BY u12@1;',
        'i BY u13@1;',
        'i BY u14@1;',
        's BY u11@0;',
        's BY u12@1;',
        's BY u13@2;',
        's BY u14@3;',
        'i WITH s;',
        '[i];',
        '[s];',
        '[u11@0];',
        '[u12@0];',
        '[u13@0];',
        '[u14@0];',
      ].join('\n'),
    );
    expect(r.casewise).toBe(false);
    // (the same free parameters as Mplus's i s | u11@0 u12@1 u13@2 u14@3: two means, two variances, one covariance)
    const q = buildQuad(r.syntax, data);
    expect(q.spec.theta.map((t) => t.name).sort()).toEqual([
      'i ~1',
      'i ~~ i',
      's ~1',
      's ~~ i',
      's ~~ s',
    ]);
    expect(q.spec.outcomes.map((o) => o.type)).toEqual(['count', 'count', 'count', 'count']);
    expect(q.spec.se).toBe('mlr');
    expect(
      buildQuad('COUNT = u11-u14; MODEL: i s | u11@0 u12@1 u13@2 u14@3;', data).spec.theta,
    ).toHaveLength(5);
  });

  it('declares each kind, fixes undrawn factor pairs at 0, scales by the variance, writes labels, paths and the marker’s intercept', () => {
    const m: ModelState = {
      constructs: [
        C('a', 'Alpha 1', ['u11', 'u12', 'u13'], { loadingLabels: { u12: 'l2' } }),
        C('b', 'by', ['u14', 'y1', 'y2'], { scaling: 'variance' }),
        C('x', 'x', ['x'], { covariate: true }),
        C('y', 'y3', ['y3']),
      ],
      paths: [
        { id: 'p1', from: 'x', to: 'a' },
        { id: 'p2', from: 'x', to: 'b', label: 'bx' },
        { id: 'p3', from: 'a', to: 'y', fixed: 0.5 },
      ],
      moderations: [],
      constant: { x: 0, y: 0 },
      means: [{ id: 'm', target: 'a', label: 'ma' }],
      count: { u11: 'zip', u12: 'nb', u13: 'poisson', u14: 'zinb' },
      ordered: ['y2'],
    };
    const r = ok(m, { estimator: 'ML', missing: 'casewise' });
    const lines = r.syntax.split('\n');
    expect(lines.slice(0, 3)).toEqual([
      'CATEGORICAL = y2;',
      'COUNT = u12 (nb) u11 (i) u14 (nbi) u13;',
      'ANALYSIS: ESTIMATOR = ML;',
    ]);
    expect(lines).toContain('alpha_1 BY u11;');
    expect(lines).toContain('alpha_1 BY u12* (l2);');
    expect(lines).toContain('by_f BY u14*;');
    expect(lines).toContain('by_f@1;');
    expect(lines).toContain('by_f ON x (bx);');
    expect(lines).toContain('y3 ON alpha_1@0.5;');
    // (two endogenous factors: their residuals uncorrelated unless drawn, as on the canvas)
    expect(lines).toContain('alpha_1 WITH by_f@0;');
    expect(lines).toContain('[alpha_1] (ma);');
    expect(lines).toContain('[u11@0];');
    expect(r.names).toEqual({ alpha_1: 'Alpha 1', by_f: 'by' });
    expect(r.casewise).toBe(true);
    const q = buildQuad(r.syntax, data).spec;
    expect(Object.fromEntries(q.outcomes.map((o) => [o.name, o.type]))).toMatchObject({
      u11: 'zip',
      u12: 'nb',
      u13: 'count',
      u14: 'zinb',
      y2: 'cat',
    });
    expect(q.outcomes.find((o) => o.name === 'u14')!.disp).toBeGreaterThanOrEqual(0);
    expect(q.outcomes.find((o) => o.name === 'u14')!.infl).toBeTruthy();
    expect(q.se).toBe('ml');
  });

  it('refuses what the integration engine does not fit, with the reason', () => {
    const g = growthOnCanvas();
    expect(why({ ...g, count: {} })).toMatch(/No indicator is declared a count/);
    expect(why(g, { method: 'pls' })).toMatch(/CB-SEM/);
    for (const e of ['MLM', 'MLMV', 'WLSMV', 'ULS', 'GLS', 'WLS', 'RML', '2SLS'] as const)
      expect(why(g, { estimator: e })).toMatch(new RegExp(`choose ML, or MLR.*not ${e}`));
    for (const mi of ['mean', 'mi', 'pairwise', 'twostage', 'robusttwostage'] as const)
      expect(why(g, { missing: mi })).toMatch(/casewise deletion or FIML/);
    expect(why({ ...g, multigroup: { column: 'g', invariance: 'configural', free: [] } })).toMatch(
      /Multiple groups/,
    );
    expect(why({ ...g, multilevel: { column: 'g', between: 'same' } })).toMatch(/Two-level/);
    expect(why({ ...g, weights: 'x' })).toMatch(/Sampling weights/);
    expect(why({ ...g, cluster: 'g' })).toMatch(/Sampling clusters/);
    expect(
      why({ ...g, esem: { blocks: [{ id: 'e', constructs: ['i', 's'] }], rotation: 'geomin' } }),
    ).toMatch(/ESEM/);
    expect(why({ ...g, defined: [{ id: 'd', name: 'x', expr: 'a*b' }] })).toMatch(
      /Defined parameters/,
    );
    expect(
      why({
        ...g,
        constructs: [...g.constructs, C('y', 'Y', ['y1', 'y2']), C('z', 'Z', ['y3', 'x'])],
        paths: [{ id: 'p', from: 'y', to: 'z' }],
        moderations: [{ id: 'mo', moderator: 'i', path: 'p' }],
      }),
    ).toMatch(/interactions/);
    expect(
      why({ ...g, constructs: [{ ...g.constructs[0], type: 'composite' }, g.constructs[1]] }),
    ).toMatch(/composite/);
    expect(
      why({ ...g, constructs: [...g.constructs, { ...C('h', 'H', []), components: ['i', 's'] }] }),
    ).toMatch(/higher-order/);
    expect(
      why({
        ...g,
        constructs: [...g.constructs, C('x', 'x', ['x'], { covariate: true })],
        count: { ...g.count, x: 'poisson' },
      }),
    ).toMatch(/observed covariate/);
    expect(why({ ...g, ordered: ['u11'] })).toMatch(/both ordinal and a count/);
    expect(
      why({ ...g, correlations: [{ id: 'k2', kind: 'indicator', a: 'u11', b: 'u12' }] }),
    ).toMatch(/u11 is a count: its errors cannot be correlated/);
    expect(
      why({
        ...g,
        parameters: [{ id: 'v', kind: 'variance', target: 'u11', indicator: true, fixed: 1 }],
      }),
    ).toMatch(/no error variance/);
    expect(why({ ...g, means: [{ id: 'm1', target: 'i', byGroup: [1, null] }] })).toMatch(
      /per group/,
    );
    expect(
      why({
        ...g,
        constructs: [
          g.constructs[0],
          { ...g.constructs[1], loadingLabels: { u12: 'a b' }, fixedLoadings: {} },
        ],
      }),
    ).toMatch(/label “a b”/);
    expect(
      countModelSyntax(
        { ...g, constructs: [C('i', 'i', ['u 1', 'u12'])], count: { 'u 1': 'poisson' } },
        CB,
        null,
      ),
    ).toEqual({ error: expect.stringMatching(/“u 1” needs a plain name/) });
    expect(countModelSyntax(g, CB, ['u11', 'u12'])).toEqual({
      error: 'u13 is not a column of the data.',
    });
    expect(countModelSyntax(g, CB, data.names, { moments: true })).toEqual({
      error: expect.stringMatching(/raw data/),
    });
    // (a count variable cannot predict: it is an outcome or an indicator)
    expect(
      why({
        ...g,
        constructs: [...g.constructs, C('c', 'c', ['y1']), C('o', 'o', ['y2'])],
        paths: [{ id: 'q', from: 'c', to: 'o' }],
        count: { ...g.count, y1: 'poisson' },
      }),
    ).toMatch(/regressions on count variables/);
  });

  it('lists only declared indicators still in the model', () => {
    expect(
      countIndicators({ constructs: [C('i', 'i', ['u11'])], count: { u11: 'nb', gone: 'zip' } }),
    ).toEqual(['u11']);
  });
});

describe('count indicators in the project, the store, the checks and the canvas', () => {
  it('a project file keeps them and validates them strictly', () => {
    const m = growthOnCanvas();
    expect(
      parseProject(serializeProject({ ...m, count: { u11: 'zinb', u12: 'zip' } }, CB, null, null))
        .model.count,
    ).toEqual({ u11: 'zinb', u12: 'zip' });
    const file = (count: unknown, extra: object = {}) =>
      JSON.stringify({
        ...JSON.parse(serializeProject(m, CB, null, null)),
        model: { ...m, ...extra, count },
      });
    expect(() => parseProject(file({ u11: 'tobit' }))).toThrow(/unknown count kind/);
    expect(() => parseProject(file(['u11']))).toThrow(/must be an object/);
    expect(() => parseProject(file('u11'))).toThrow(/must be an object/);
    expect(() => parseProject(file({ u11: 'poisson' }, { ordered: ['u11'] }))).toThrow(
      /both ordinal and a count/,
    );
    expect(() => parseProject(file({ [`u${'x'.repeat(300)}`]: 'poisson' }))).toThrow(/too long/);
    // (a name that is no longer an indicator, removed since, is dropped; none left: no declaration)
    expect(parseProject(file({ u11: 'nb', gone: 'nb' })).model.count).toEqual({ u11: 'nb' });
    expect(parseProject(file({ gone: 'nb' })).model).not.toHaveProperty('count');
    expect(parseProject(file(undefined)).model).not.toHaveProperty('count');
  });

  it('the store keeps an indicator either ordinal or a count', () => {
    const s = useStore.getState();
    s.commit(() => ({ ...growthOnCanvas(), count: {} }));
    s.setOrdered(['u11'], true);
    useStore.getState().setCount(['u11', 'u12'], 'zip');
    expect(useStore.getState().model.count).toEqual({ u11: 'zip', u12: 'zip' });
    expect(useStore.getState().model.ordered ?? []).toEqual([]);
    useStore.getState().setOrdered(['u12'], true);
    expect(useStore.getState().model.count).toEqual({ u11: 'zip' });
    expect(useStore.getState().model.ordered).toEqual(['u12']);
    useStore.getState().setCount(['u11'], null);
    expect(useStore.getState().model).not.toHaveProperty('count');
  });

  it('the checks block lavaan’s run and offer the integration card, or say why it cannot be used; other methods warn', () => {
    const g = growthOnCanvas();
    const issues = validateModel(g, data, CB);
    const first = issues[0];
    expect(first).toMatchObject({ level: 'error', action: 'count-integration' });
    expect(first.message).toMatch(/u11, u12, u13, u14 are counts: lavaan has no count indicators/);
    const refused = validateModel(g, data, { ...CB, estimator: 'WLSMV' })[0];
    expect(refused.level).toBe('error');
    expect(refused.action).toBeUndefined();
    expect(refused.message).toMatch(/cannot be: .*choose ML, or MLR/);
    expect(
      validateModel(g, data, { ...CB, method: 'pls' }).find((i) => /count/.test(i.message)),
    ).toMatchObject({ level: 'warning' });
    // (ordinal indicators beside counts are logit under ML on the integration card: no "choose WLSMV")
    const mixed = {
      ...g,
      constructs: [...g.constructs, C('y', 'Y', ['y1', 'y2', 'y3'])],
      ordered: ['y1'],
      correlations: [
        ...g.correlations!,
        { id: 'k3', kind: 'construct' as const, a: 'i', b: 'y' },
        { id: 'k4', kind: 'construct' as const, a: 's', b: 'y' },
      ],
    };
    expect(
      validateModel(mixed, data, CB).some((i) => /choose the WLSMV estimator/.test(i.message)),
    ).toBe(false);
    expect(
      validateModel({ ...mixed, count: {} }, data, CB).some((i) =>
        /choose the WLSMV estimator/.test(i.message),
      ),
    ).toBe(true);
  });

  it('the canvas menu offers the declaration on CB-SEM indicators, not on covariates or in PLS-SEM', () => {
    const g = growthOnCanvas();
    const items = (m: ModelState, method: Settings['method'], name = 'u11', construct = 'i') =>
      menuFor({ kind: 'indicator', construct, name }, m, { method, readOnly: false })?.items ?? [];
    expect(items(g, 'cbsem').find((i) => i.action === 'set-count')?.label).toBe('Count (Poisson)…');
    expect(items({ ...g, count: {} }, 'cbsem').find((i) => i.action === 'set-count')?.label).toBe(
      'Treat as count…',
    );
    expect(items(g, 'pls').some((i) => i.action === 'set-count')).toBe(false);
    // (a count has no error variance to hold)
    expect(items(g, 'cbsem').some((i) => i.action === 'held-variance')).toBe(false);
    expect(items({ ...g, count: {} }, 'cbsem').some((i) => i.action === 'held-variance')).toBe(
      true,
    );
    const cov: ModelState = {
      constructs: [C('x', 'x', ['x'], { covariate: true })],
      paths: [],
      moderations: [],
    };
    expect(items(cov, 'cbsem', 'x', 'x').some((i) => i.action === 'set-count')).toBe(false);
  });

  it('the Mplus export declares them', () => {
    const e = toMplus(growthOnCanvas(), CB, null, null, 'p');
    expect(e.inp).toContain('COUNT = u11 u12 u13 u14;');
    expect(e.inp).toContain('ALGORITHM = INTEGRATION;');
    const k = toMplus(
      { ...growthOnCanvas(), count: { u11: 'zinb', u12: 'nb', u13: 'zip', u14: 'poisson' } },
      CB,
      null,
      null,
      'p',
    );
    expect(k.inp).toContain('COUNT = u12 (nb) u13 (i) u11 (nbi) u14;');
  });
});

describe('the integration card on the diagram', () => {
  const ctx = (model: ModelState, s: Partial<Settings> = {}): AnalysisCtx => ({
    data,
    info: null,
    settings: { ...CB, ...s },
    pls: null,
    projectName: 'p',
    model,
  });
  it('reads the source from files, offers an entry, and is titled for it', () => {
    expect(quad.parseOptions({ syntax: '', source: 'model' })).toEqual({
      syntax: '',
      source: 'model',
    });
    expect(quad.parseOptions({ syntax: '', source: 'canvas' })).toEqual({ syntax: '' });
    expect(
      quad
        .entries!.map((e) => e.options(quad.defaults(ctx(growthOnCanvas()))))
        .map((o) => o.source ?? null),
    ).toEqual([null, 'model']);
    expect(quad.cardTitle!({ syntax: '', source: 'model' })).toBe('Integration ML: the diagram');
    expect(quad.summary({ syntax: '', source: 'model' })).toBe('the diagram (count indicators)');
  });
  it('fits the diagram’s syntax, says why not, and is stale when the diagram changes', () => {
    const o = { syntax: '', source: 'model' as const };
    expect(quad.blocked(o, ctx(growthOnCanvas()))).toBeNull();
    expect(quad.blocked(o, ctx(growthOnCanvas(), { estimator: 'MLM' }))).toMatch(
      /choose ML, or MLR/,
    );
    expect(quad.blocked(o, { ...ctx(growthOnCanvas()), model: undefined })).toBe(
      'Draw the model first.',
    );
    const direct = buildQuad(
      'COUNT = u11-u14; ANALYSIS: ESTIMATOR = MLR; MODEL: i BY u11@1 u12@1 u13@1 u14@1; s BY u11@0 u12@1 u13@2 u14@3; i WITH s; [i s]; [u11-u14@0];',
      data,
    ).spec;
    const fromModel = quadSpec(o, ctx(growthOnCanvas())).spec;
    expect(fromModel.theta.map((t) => t.name).sort()).toEqual(
      direct.theta.map((t) => t.name).sort(),
    );
    expect(fromModel.outcomes).toEqual(direct.outcomes.map((x) => ({ ...x })));
    const fp = quad.fingerprint(o, ctx(growthOnCanvas()));
    expect(fp).toBeTruthy();
    expect(
      quad.fingerprint(
        o,
        ctx({ ...growthOnCanvas(), count: { ...growthOnCanvas().count, u11: 'nb' } }),
      ),
    ).not.toBe(fp);
    expect(quad.fingerprint(o, ctx(growthOnCanvas(), { estimator: 'ML' }))).not.toBe(fp);
  });
  it('drops incomplete cases under casewise deletion only', () => {
    const holes = {
      ...data,
      cols: data.cols.map((c, k) =>
        k === 0 ? Float64Array.from(c, (v, i) => (i < 5 ? NaN : v)) : c,
      ),
    };
    const o = { syntax: '', source: 'model' as const };
    expect(
      quadSpec(o, { ...ctx(growthOnCanvas(), { missing: 'casewise' }), data: holes }).data.cols[0]
        .length,
    ).toBe(n - 5);
    expect(
      quadSpec(o, { ...ctx(growthOnCanvas(), { missing: 'fiml' }), data: holes }).data.cols[0]
        .length,
    ).toBe(n);
  });
});
