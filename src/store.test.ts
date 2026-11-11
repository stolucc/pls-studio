import { beforeEach, describe, expect, it } from 'vitest';
import { toSpec, validateModel } from './model/project';
import { emptyModel, resultsKey, useStore } from './store';

const s = () => useStore.getState();

function setup() {
  useStore.setState({ model: emptyModel(), past: [], future: [], toasts: [] });
  const x = s().addConstruct(0, 0, ['x1']);
  const y = s().addConstruct(300, 0, ['y1']);
  const m = s().addConstruct(150, -200, ['m1']);
  s().addPath(x, y);
  return { x, y, m, path: s().model.paths[0].id };
}

describe('moderation in the store', () => {
  beforeEach(() => useStore.setState({ toasts: [] }));

  it('implies the moderator main effect (not drawn, but estimated) and maps to the engine spec', () => {
    const { x, m, y, path } = setup();
    expect(s().addModeration(m, path)).toBe(true);
    expect(s().model.paths).toHaveLength(1);
    expect(s().toasts).toEqual([]);
    const names = Object.fromEntries(s().model.constructs.map((c) => [c.id, c.name]));
    const spec = toSpec(s().model);
    expect(spec.moderations).toEqual([{ from: names[x], moderator: names[m], to: names[y] }]);
    expect(spec.paths).toEqual([
      { from: names[x], to: names[y] },
      { from: names[m], to: names[y] },
    ]);
    expect(s().selection.moderations).toHaveLength(1);
    // Drawn by the user: estimated once, not twice.
    s().addPath(m, y);
    expect(toSpec(s().model).paths.filter((p) => p.from === names[m])).toHaveLength(1);
  });

  it('one implied main effect per moderator and outcome; none for a quadratic term', () => {
    const { x, m, y, path } = setup();
    const w = s().addConstruct(0, 200, ['w1']);
    s().addPath(w, y);
    const path2 = s().model.paths[1].id;
    s().addModeration(m, path);
    s().addModeration(m, path2);
    s().addQuadratic(path);
    const names = Object.fromEntries(s().model.constructs.map((c) => [c.id, c.name]));
    expect(toSpec(s().model).paths).toEqual([
      { from: names[x], to: names[y] },
      { from: names[w], to: names[y] },
      { from: names[m], to: names[y] },
    ]);
  });

  it('rejects the outcome as moderator, duplicates and cycles', () => {
    const { y, m, path } = setup();
    expect(s().addModeration(y, path)).toBe(false);
    expect(s().addModeration(m, path)).toBe(true);
    expect(s().addModeration(m, path)).toBe(false);
    // A construct downstream of the outcome cannot moderate (its main effect would be a cycle).
    const z = s().addConstruct(600, 0, ['z1']);
    s().addPath(y, z);
    expect(s().addModeration(z, path)).toBe(false);
    expect(s().model.moderations).toHaveLength(1);
  });

  it('adds a quadratic effect: the predictor moderating its own path, without extra paths', () => {
    const { x, y, path } = setup();
    expect(s().addQuadratic(path)).toBe(true);
    expect(s().model.moderations).toEqual([expect.objectContaining({ moderator: x, path })]);
    expect(s().model.paths).toHaveLength(1);
    expect(s().addQuadratic(path)).toBe(false);
    const names = Object.fromEntries(s().model.constructs.map((c) => [c.id, c.name]));
    expect(toSpec(s().model).moderations).toEqual([
      { from: names[x], moderator: names[x], to: names[y] },
    ]);
    const data = {
      names: ['x1', 'y1', 'm1'],
      cols: [0, 1, 2].map(() => Float64Array.from({ length: 50 }, (_, i) => i % 7)),
    };
    const errors = (st: Parameters<typeof validateModel>[2]) =>
      validateModel(s().model, data, st)
        .filter((i) => i.level === 'error' && !i.message.includes('not connected'))
        .map((i) => i.message);
    expect(errors({ method: 'pls', consistent: false })).toEqual([]);
    expect(errors({ method: 'cbsem', consistent: false })).toEqual([]);
    // PLSc with a quadratic term: cSEM and the built-in engine estimate it; seminr does not.
    expect(errors({ method: 'pls', consistent: true })).toEqual([]);
    expect(errors({ method: 'pls', consistent: true, engine: 'builtin' })).toEqual([]);
    expect(errors({ method: 'pls', consistent: true, plsPackage: 'seminr' })).toEqual([
      expect.stringMatching(
        /Quadratic effects \(the quadratic effect of .* on .*\) with PLSc need cSEM or the built-in engine/,
      ),
    ]);
    expect(errors({ method: 'cbsem', consistent: false, estimator: '2SLS' })).toEqual([
      expect.stringMatching(/Quadratic effects .* not available with MIIV-2SLS/),
    ]);
    // CB-SEM: the predictor must be exogenous (reported once, not twice).
    const { m } = { m: s().model.constructs[2].id };
    s().addPath(m, x);
    expect(errors({ method: 'cbsem', consistent: false })).toEqual([
      expect.stringMatching(
        /^The quadratic effect of .*: in CB-SEM the predictor must be exogenous/,
      ),
    ]);
  });

  it('deleting the path or the moderator removes the moderation; undo restores it', () => {
    const { m, path } = setup();
    s().addModeration(m, path);
    s().deleteItems([], [path]);
    expect(s().model.moderations).toHaveLength(0);
    s().undo();
    expect(s().model.moderations).toHaveLength(1);
    s().deleteItems([m], []);
    expect(s().model.moderations).toHaveLength(0);
    expect(s().model.paths.every((p) => p.from !== m)).toBe(true);
  });

  it('validates moderation per method (CB-SEM needs exogenous terms, PLSc not with seminr)', () => {
    const { m, path } = setup();
    s().addModeration(m, path);
    const data = {
      names: ['x1', 'y1', 'm1'],
      cols: [0, 1, 2].map(() => Float64Array.from({ length: 50 }, (_, i) => i % 7)),
    };
    expect(
      validateModel(s().model, data, { method: 'pls', consistent: false }).filter(
        (i) => i.level === 'error',
      ),
    ).toEqual([]);
    // CB-SEM: fine while predictor and moderator are exogenous…
    expect(
      validateModel(s().model, data, { method: 'cbsem', consistent: false }).filter(
        (i) => i.level === 'error',
      ),
    ).toEqual([]);
    // …but not once the predictor has an incoming path.
    const x = s().model.paths[0].from;
    s().addPath(m, x);
    expect(
      validateModel(s().model, data, { method: 'cbsem', consistent: false }).some((i) =>
        i.message.includes('exogenous'),
      ),
    ).toBe(true);
    expect(
      validateModel(s().model, data, { method: 'pls', consistent: true }).some((i) =>
        i.message.includes('PLSc'),
      ),
    ).toBe(false);
    expect(
      validateModel(s().model, data, { method: 'pls', consistent: true, engine: 'builtin' }).some(
        (i) => i.message.includes('PLSc need'),
      ),
    ).toBe(false);
    expect(
      validateModel(s().model, data, {
        method: 'pls',
        consistent: true,
        plsPackage: 'seminr',
      }).some((i) => i.message.includes('PLSc need')),
    ).toBe(true);
  });
});

describe('correlations in the store', () => {
  function cfa() {
    useStore.setState({
      model: emptyModel(),
      past: [],
      future: [],
      toasts: [],
      settings: { ...s().settings, method: 'cbsem' },
    });
    const a = s().addConstruct(0, 0, ['a1', 'a2', 'a3']);
    const b = s().addConstruct(300, 0, ['b1', 'b2', 'b3']);
    const x = s().addConstruct(0, 300, ['x1']);
    return { a, b, x };
  }

  it('adds, maps to the engine spec, and rejects duplicates, self-links, covariates and single indicators', () => {
    const { a, b, x } = cfa();
    expect(s().addCorrelation('construct', a, b)).toBe(true);
    expect(s().addCorrelation('construct', b, a)).toBe(false);
    expect(s().addCorrelation('indicator', 'a1', 'a1')).toBe(false);
    expect(s().addCorrelation('indicator', 'a1', 'b2')).toBe(true);
    expect(s().addCorrelation('indicator', 'a1', 'x1')).toBe(false);
    s().updateConstruct(x, { covariate: true });
    expect(s().addCorrelation('construct', a, x)).toBe(false);
    const names = Object.fromEntries(s().model.constructs.map((c) => [c.id, c.name]));
    expect(toSpec(s().model).covariances).toEqual([
      { a: names[a], b: names[b], kind: 'construct' },
      { a: 'a1', b: 'b2', kind: 'indicator' },
    ]);
    expect(s().selection.correlations).toHaveLength(1);
  });

  it('removes correlations with their constructs or indicators, and on delete', () => {
    const { a, b } = cfa();
    s().addCorrelation('construct', a, b);
    s().addCorrelation('indicator', 'a1', 'b2');
    s().addCorrelation('indicator', 'a2', 'a3');
    s().removeIndicator(a, 'a1');
    expect(s().model.correlations!.map((k) => k.a)).toEqual([a, 'a2']);
    s().deleteItems([], [], [], [s().model.correlations![1].id]);
    expect(s().model.correlations).toHaveLength(1);
    s().removeConstructs([b]);
    expect(s().model.correlations).toEqual([]);
    s().undo();
    expect(s().model.correlations).toHaveLength(1);
  });

  it('drawing a correlation does not invalidate PLS results', () => {
    const { a, b } = cfa();
    const keyOf = () => resultsKey(useStore.getState());
    useStore.setState({ settings: { ...s().settings, method: 'pls' } });
    const before = keyOf();
    s().addCorrelation('construct', a, b);
    expect(keyOf()).toBe(before);
    useStore.setState({ settings: { ...s().settings, method: 'cbsem' } });
    const cb = keyOf();
    s().addCorrelation('indicator', 'a1', 'a2');
    expect(keyOf()).not.toBe(cb);
  });
});

describe('GSCA', () => {
  it('needs cSEM in R', () => {
    const m = {
      constructs: [
        {
          id: 'a',
          name: 'A',
          type: 'composite' as const,
          mode: 'B' as const,
          indicators: ['a1', 'a2'],
          x: 0,
          y: 0,
          side: 'left' as const,
        },
        {
          id: 'b',
          name: 'B',
          type: 'composite' as const,
          mode: 'B' as const,
          indicators: ['b1', 'b2'],
          x: 0,
          y: 0,
          side: 'left' as const,
        },
      ],
      paths: [{ id: 'p', from: 'a', to: 'b' }],
      moderations: [],
    };
    const d = {
      names: ['a1', 'a2', 'b1', 'b2'],
      cols: Array.from({ length: 4 }, (_, k) =>
        Float64Array.from({ length: 50 }, (_, i) => Math.sin(i * (k + 2))),
      ),
    };
    const errs = (o: object) =>
      validateModel(m, d, { ...s().settings, method: 'pls', plsApproach: 'GSCA', ...o })
        .filter((i) => i.level === 'error')
        .map((i) => i.message);
    expect(errs({ engine: 'r', plsPackage: 'cSEM' })).toEqual([]);
    expect(
      errs({ engine: 'r', plsPackage: 'seminr' }).some((x) =>
        /GSCA is estimated with cSEM/.test(x),
      ),
    ).toBe(true);
    expect(errs({ engine: 'builtin' }).some((x) => /GSCA is estimated with cSEM/.test(x))).toBe(
      true,
    );
    expect(
      errs({ engine: 'builtin', plsApproach: 'unit' }).some((x) =>
        /Sum scores are estimated with cSEM/.test(x),
      ),
    ).toBe(true);
    expect(errs({ engine: 'r', plsPackage: 'cSEM', plsApproach: 'PCA' })).toEqual([]);
  });
});

describe('messages belong to a project', () => {
  it('opening or starting a project clears the previous project’s messages', () => {
    s().clearMessages();
    s().logMessage('warning', 'lavaan WARNING: not converged', 'lavaan');
    expect(s().messages.length).toBe(1);
    s().loadProject({
      name: 'Other',
      model: emptyModel(),
      settings: s().settings,
      data: null,
      info: null,
    });
    expect(s().messages).toEqual([]);
    s().logMessage('error', 'failed');
    s().newProject();
    expect(s().messages).toEqual([]);
  });
});

describe('examples', () => {
  it('are never kept: not in Recent projects, until kept as one’s own project', async () => {
    const { currentEntry } = await import('./io');
    s().loadProject({
      name: 'Example model',
      model: {
        constructs: [
          {
            id: 'c',
            name: 'A',
            type: 'factor',
            mode: 'A',
            indicators: ['a1'],
            x: 0,
            y: 0,
            side: 'left',
          },
        ],
        paths: [],
        moderations: [],
      },
      settings: s().settings,
      data: null,
      info: null,
      example: 'lavaan-hs',
    });
    expect(s().example).toBe('lavaan-hs');
    s().addConstruct(10, 10, []);
    expect(currentEntry()).toBeNull();
    const id = s().projectId;
    s().keepExample();
    expect(s().example).toBeNull();
    expect(s().projectId).not.toBe(id);
    expect(currentEntry()?.id).toBe(s().projectId);
    s().loadProject({
      name: 'x',
      model: emptyModel(),
      settings: s().settings,
      data: null,
      info: null,
    });
    expect(s().example).toBeNull();
  });
});

describe('implied main effects and cycles', () => {
  it('refuses a moderator downstream of the outcome, also in a loaded project', () => {
    const { x, y, m, path } = setup();
    s().addPath(y, m);
    expect(s().addModeration(m, path)).toBe(false);
    // A project file can still contain one: validation reports the cycle.
    useStore.setState({
      model: { ...s().model, moderations: [{ id: 'mo1', moderator: m, path }] },
    });
    const data = {
      names: ['x1', 'y1', 'm1'],
      cols: [0, 1, 2].map(() => Float64Array.from({ length: 50 }, (_, i) => i % 7)),
    };
    const errs = validateModel(s().model, data, { method: 'pls', consistent: false })
      .filter((i) => i.level === 'error')
      .map((i) => i.message);
    expect(errs).toContainEqual(expect.stringMatching(/implied effect on .* would create a cycle/));
    void x;
  });
});

describe('showing implied main effects', () => {
  it('is on by default and can be switched off (a view setting: the estimation is unchanged)', () => {
    const { m, path } = setup();
    s().addModeration(m, path);
    expect(s().showImpliedEffects).toBe(true);
    const before = toSpec(s().model);
    s().setShowImpliedEffects(false);
    expect(s().showImpliedEffects).toBe(false);
    expect(toSpec(s().model)).toEqual(before);
    s().setShowImpliedEffects(true);
  });

  it('hides a mean structure’s intercept arrows by default, on an option of their own that does not touch the estimates', () => {
    const { m, path } = setup();
    s().addModeration(m, path);
    expect(s().showIntercepts).toBe(false);
    const before = toSpec(s().model);
    s().setShowIntercepts(true);
    expect(s().showIntercepts).toBe(true);
    expect(s().showImpliedEffects).toBe(true);
    expect(toSpec(s().model)).toEqual(before);
    s().setShowImpliedEffects(false);
    expect(s().showIntercepts).toBe(true);
    s().setShowImpliedEffects(true);
    s().setShowIntercepts(false);
  });
});

describe('factors from an exploratory factor analysis', () => {
  it('adds common factors in one step, taking the variables from other constructs, correlated when oblique', () => {
    useStore.setState({ model: emptyModel(), past: [], future: [], toasts: [] });
    const old = s().addConstruct(0, 0, ['a1', 'q']);
    const before = s().past.length;
    const ids = s().addFactors(
      [
        ['a1', 'a2'],
        ['b1', 'b2'],
      ],
      true,
    );
    expect(s().past.length).toBe(before + 1);
    const made = s().model.constructs.filter((c) => ids.includes(c.id));
    expect(made.map((c) => [c.type, c.mode, c.indicators])).toEqual([
      ['factor', 'A', ['a1', 'a2']],
      ['factor', 'A', ['b1', 'b2']],
    ]);
    expect(s().model.constructs.find((c) => c.id === old)!.indicators).toEqual(['q']);
    expect(s().model.correlations).toEqual([
      expect.objectContaining({ kind: 'construct', a: ids[0], b: ids[1] }),
    ]);
    s().addFactors([['c1', 'c2']], false);
    expect(s().model.correlations).toHaveLength(1);
  });
});

describe('the constant in the store', () => {
  beforeEach(() => {
    useStore.getState().newProject();
    useStore.setState({ toasts: [], cloud: null });
  });
  const build = () => {
    const st = useStore.getState();
    st.setSettings({ method: 'cbsem' });
    const a = st.addConstruct(300, 100, ['a1', 'a2']),
      b = st.addConstruct(600, 100, ['b1', 'b2']);
    st.addPath(a, b);
    useStore.setState((x) => ({ model: { ...x.model, ordered: ['a1'] } }));
    return { a, b };
  };

  it('is added left of the model, takes one mean arrow per construct, and goes with its arrows; deletions keep the other model fields', () => {
    const { a, b } = build();
    const st = () => useStore.getState();
    st().addConstant();
    expect(st().model.constant!.x).toBeLessThan(300);
    st().addConstant(); // once
    expect(st().addMean(a)).toBe(true);
    expect(st().addMean(a)).toBe(false);
    expect(st().addMean(b)).toBe(true);
    expect(st().model.means).toHaveLength(2);
    const id = st().model.means![0].id;
    st().setMean(id, { fixed: 3 });
    expect(st().model.means![0]).toMatchObject({ target: a, fixed: 3 });
    st().setMean(id, { fixed: null, label: 'ma' });
    expect(st().model.means![0]).toEqual({ id, target: a, label: 'ma' });
    // Removing the arrow's construct removes the arrow; the other fields of the model stay.
    st().deleteItems([b], []);
    expect(st().model.means!.map((t) => t.target)).toEqual([a]);
    expect(st().model.ordered).toEqual(['a1']);
    expect(st().model.constant).toBeTruthy();
    // Deleting an arrow by its id; deleting the constant drops every arrow.
    st().deleteItems([], [id]);
    expect(st().model.means).toEqual([]);
    st().addMean(a);
    st().deleteItems(['constant'], []);
    expect(st().model.constant).toBeUndefined();
    expect(st().model.means).toBeUndefined();
    st().undo();
    expect(st().model.constant).toBeTruthy();
    expect(st().model.means).toHaveLength(1);
    st().moveConstant(-50, 40);
    expect(st().model.constant).toEqual({ x: -50, y: 40 });
  });
});

describe('held and labelled parameters in the store', () => {
  it('holds, labels, gives values per group and frees a variance, intercept or threshold; one term per parameter', () => {
    const { x } = setup();
    s().setHeldParameter({ kind: 'variance', target: x }, { fixed: 1 });
    s().setHeldParameter({ kind: 'variance', target: x }, { label: 'vx' });
    expect(s().model.parameters).toEqual([
      expect.objectContaining({ kind: 'variance', target: x, label: 'vx' }),
    ]);
    expect(s().model.parameters![0].fixed).toBeUndefined();
    s().setHeldParameter(
      { kind: 'threshold', target: 'u1', indicator: true, threshold: 2 },
      { byGroup: [0.5, null] },
    );
    s().setHeldParameter(
      { kind: 'threshold', target: 'u1', indicator: true, threshold: 1 },
      { fixed: 0 },
    );
    expect(s().model.parameters).toHaveLength(3);
    s().setHeldParameter({ kind: 'variance', target: x }, null);
    s().setHeldParameter({ kind: 'threshold', target: 'u1', indicator: true, threshold: 2 }, null);
    s().setHeldParameter({ kind: 'threshold', target: 'u1', indicator: true, threshold: 1 }, null);
    expect(s().model.parameters).toBeUndefined();
  });

  it('sets a covariance’s value, label or values per group, replacing the others', () => {
    const { x, y } = setup();
    s().addCorrelation('construct', x, y);
    const k = s().model.correlations![0].id;
    s().setCorrelationValue(k, { fixed: 0.3 });
    s().setCorrelationValue(k, { byGroup: [0.3, 'c'] });
    expect(s().model.correlations![0]).toMatchObject({ byGroup: [0.3, 'c'] });
    expect(s().model.correlations![0].fixed).toBeUndefined();
    s().setCorrelationValue(k, null);
    expect(s().model.correlations![0].byGroup).toBeUndefined();
  });

  it('sets and clears the theta parameterisation', () => {
    setup();
    s().setParameterization('theta');
    expect(s().model.parameterization).toBe('theta');
    s().setParameterization(null);
    expect(s().model.parameterization).toBeUndefined();
  });
});

describe('adding the constant', () => {
  it('shows its intercepts, so that the new triangle is drawn', () => {
    useStore.setState({
      model: {
        constructs: [
          {
            id: 'a',
            name: 'A',
            type: 'factor',
            mode: 'A',
            indicators: ['a1', 'a2'],
            x: 0,
            y: 0,
            side: 'left',
          },
        ],
        paths: [],
        moderations: [],
      },
      showIntercepts: false,
    } as never);
    useStore.getState().addConstant();
    expect(useStore.getState().model.constant).toBeTruthy();
    expect(useStore.getState().showIntercepts).toBe(true);
  });
});
