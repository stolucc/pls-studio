// Fixing parameters at values from the canvas: store, menus, labels, files.

import { beforeEach, describe, expect, it } from 'vitest';
import { menuFor } from './components/canvasMenu';
import { indicatorLabels } from './diagramLabels';
import { DEFAULT_SETTINGS, parseProject, serializeProject, toSpec, validateModel, type ModelState } from './model/project';
import { useStore } from './store';

const C = (id: string, indicators: string[]) => ({ id, name: id, type: 'factor' as const, mode: 'A' as const, indicators, x: 0, y: 0, side: 'left' as const });
const model: ModelState = {
  constructs: [C('A', ['a1', 'a2', 'a3']), C('B', ['b1', 'b2', 'b3'])],
  paths: [{ id: 'p', from: 'A', to: 'B' }], moderations: [],
  correlations: [{ id: 'k', kind: 'indicator', a: 'a1', b: 'b1' }],
};
const s = () => useStore.getState();
const cb = { method: 'cbsem' as const, readOnly: false };
const data = { names: ['a1', 'a2', 'a3', 'b1', 'b2', 'b3'], cols: Array.from({ length: 6 }, () => new Float64Array(200).map(Math.random)) };

beforeEach(() => useStore.setState({ model, settings: { ...DEFAULT_SETTINGS, method: 'cbsem' }, past: [], future: [], toasts: [], cloud: null }));

describe('fixing parameters at values', () => {
  it('fixes and frees paths, loadings and covariances, undoably', () => {
    s().fixParameter({ kind: 'path', id: 'p' }, 0.5);
    s().fixParameter({ kind: 'loading', construct: 'A', indicator: 'a2' }, 0.8);
    s().fixParameter({ kind: 'correlation', id: 'k' }, 0.1);
    const spec = toSpec(s().model);
    expect(spec.paths[0].fixed).toBe(0.5);
    expect(spec.constructs[0].fixedLoadings).toEqual({ a2: 0.8 });
    expect(spec.covariances![0].fixed).toBe(0.1);
    s().fixParameter({ kind: 'loading', construct: 'A', indicator: 'a2' }, null);
    expect(s().model.constructs[0].fixedLoadings).toBeUndefined();
    s().undo();
    expect(s().model.constructs[0].fixedLoadings).toEqual({ a2: 0.8 });
    // An indicator that leaves its construct takes its fixed loading with it.
    s().removeIndicator('A', 'a2');
    expect(s().model.constructs[0].fixedLoadings).toBeUndefined();
  });

  it('offers fix / free in CB-SEM context menus only', () => {
    const acts = (t: Parameters<typeof menuFor>[0], m = s().model, ctx: Parameters<typeof menuFor>[2] = cb) => menuFor(t, m, ctx)?.items.map((i) => i.action) ?? [];
    expect(acts({ kind: 'path', id: 'p' })).toContain('fix-value');
    expect(acts({ kind: 'path', id: 'p' })).not.toContain('free-value');
    expect(acts({ kind: 'path', id: 'p' }, model, { ...cb, method: 'pls' })).not.toContain('fix-value');
    s().fixParameter({ kind: 'path', id: 'p' }, 0.5);
    expect(menuFor({ kind: 'path', id: 'p' }, s().model, cb)!.items.slice(0, 2).map((i) => i.label)).toEqual(['Change fixed value (0.5)…', 'Free coefficient (estimate it)']);
    expect(menuFor({ kind: 'indicator', construct: 'A', name: 'a1' }, s().model, cb)!.items[0].label).toBe('Fix loading at another value than 1…');
    expect(acts({ kind: 'correlation', id: 'k' })).toContain('fix-value');
  });

  it('labels fixed loadings on the diagram, results or not', () => {
    const c = { ...C('A', ['a1', 'a2', 'a3']), fixedLoadings: { a1: 0.9, a3: 0.75 } };
    expect(indicatorLabels(c, 'cbsem', null)!.map((l) => l?.text ?? null)).toEqual(['0.9', null, '0.75']);
    const src = { indicator: (n: string) => ({ a1: 0.9, a2: 1.1, a3: 0.75 })[n] ?? null, reflectiveThresholds: () => false };
    expect(indicatorLabels(c, 'cbsem', src)!.map((l) => [l?.text, l?.fixed])).toEqual([['0.9', true], ['1.100', false], ['0.75', true]]);
  });

  it('round-trips through project files and validates per method', () => {
    s().fixParameter({ kind: 'path', id: 'p' }, -0.25);
    s().fixParameter({ kind: 'loading', construct: 'B', indicator: 'b1' }, 2);
    const p = parseProject(serializeProject(s().model, s().settings, null, null));
    expect(p.model.paths[0].fixed).toBe(-0.25);
    expect(p.model.constructs[1].fixedLoadings).toEqual({ b1: 2 });
    const bad = JSON.parse(serializeProject(s().model, s().settings, null, null));
    bad.model.paths[0].fixed = '1); stop(';
    bad.model.constructs[1].fixedLoadings = { b1: 'x', nope: 1 };
    const q = parseProject(JSON.stringify(bad));
    expect(q.model.paths[0].fixed).toBeUndefined();
    expect(q.model.constructs[1].fixedLoadings).toBeUndefined();
    expect(validateModel(s().model, data, { ...s().settings, method: 'pls' }).some((i) => /only CB-SEM uses fixed values/.test(i.message))).toBe(true);
    expect(validateModel(s().model, data, { ...s().settings, estimator: '2SLS' }).some((i) => /not available with MIIV-2SLS/.test(i.message))).toBe(true);
  });
});

describe('ordinal indicators, WLSMV and FIML', () => {
  const few = { names: ['a1', 'a2', 'a3', 'b1', 'b2', 'b3'], cols: Array.from({ length: 6 }, (_, k) => Float64Array.from({ length: 200 }, (_, i) => (k < 3 ? (i % 4) + 1 : Math.random()))) };
  const issues = (over: Partial<typeof DEFAULT_SETTINGS> = {}, d = few) => validateModel(s().model, d, { ...s().settings, ...over }).map((i) => i.message);
  it('suggests, requires WLSMV, refuses the built-in engine and mean replacement', () => {
    expect(issues().some((m) => /a1, a2, a3 have four or fewer categories/.test(m))).toBe(true);
    s().setOrdered(['a1', 'a2', 'a3'], true);
    expect(issues().some((m) => /a1, a2, a3 are ordinal: choose the WLSMV estimator/.test(m))).toBe(true);
    expect(issues().some((m) => /Mean replacement would put/.test(m))).toBe(true);
    expect(issues({ estimator: 'WLSMV', missing: 'casewise' }).filter((m) => /ordinal|WLSMV|Mean/.test(m))).toEqual([]);
    expect(issues({ estimator: 'WLSMV', missing: 'casewise', engine: 'builtin' }).some((m) => /estimated by lavaan/.test(m))).toBe(true);
    expect(toSpec(s().model).ordered).toEqual(['a1', 'a2', 'a3']);
    expect(menuFor({ kind: 'indicator', construct: 'A', name: 'a1' }, s().model, cb)!.items.map((i) => i.label)).toContain('Treat as continuous');
    s().setOrdered(['a1', 'a2', 'a3'], false);
    expect(s().model.ordered).toBeUndefined();
  });
  it('FIML needs ML or MLR, and is CB-SEM only', () => {
    expect(issues({ missing: 'fiml', estimator: 'GLS' }).some((m) => /FIML needs the ML or MLR/.test(m))).toBe(true);
    expect(issues({ missing: 'fiml', estimator: 'MLR' }).some((m) => /FIML/.test(m))).toBe(false);
    expect(issues({ missing: 'fiml', method: 'pls' }).some((m) => /FIML is a CB-SEM option/.test(m))).toBe(true);
    const p = parseProject(serializeProject({ ...s().model, ordered: ['a1'] }, { ...s().settings, missing: 'fiml', estimator: 'WLSMV' }, null, null));
    expect(p.settings).toMatchObject({ missing: 'fiml', estimator: 'WLSMV' });
    expect(p.model.ordered).toEqual(['a1']);
  });
});

describe('labels, defined parameters and Wald tests', () => {
  it('validate names, expressions and the engine, and print R from the parsed form', () => {
    s().setLabel({ kind: 'path', id: 'p' }, 'a');
    s().setLabel({ kind: 'loading', construct: 'A', indicator: 'a2' }, 'b');
    s().setDefined([{ id: 'd', name: 'ab', expr: 'a*b' }]);
    s().setWaldTests([{ id: 'w', name: 'T', constraints: 'a == b' }]);
    const msgs = () => validateModel(s().model, data, s().settings).filter((i) => i.level === 'error').map((i) => i.message);
    expect(msgs()).toEqual([]);
    expect(toSpec(s().model)).toMatchObject({ defined: [{ name: 'ab', expr: '(a * b)' }], waldTests: [{ name: 'T', constraints: ['a == b'] }] });
    expect(toSpec(s().model).paths[0].label).toBe('a');
    expect(validateModel(s().model, data, { ...s().settings, engine: 'builtin' }).some((i) => /estimated by lavaan/.test(i.message))).toBe(true);
    s().setDefined([{ id: 'd', name: 'ab', expr: 'a*zz' }]);
    expect(msgs().some((m) => /zz is not a parameter label/.test(m))).toBe(true);
    expect(toSpec(s().model).defined).toBeUndefined();
    s().setLabel({ kind: 'path', id: 'p' }, 'A');
    expect(msgs().some((m) => /also the name of a construct/.test(m))).toBe(true);
    // Labels go with the indicator.
    s().removeIndicator('A', 'a2');
    expect(s().model.constructs[0].loadingLabels).toBeUndefined();
    const p = parseProject(serializeProject(s().model, s().settings, null, null));
    expect(p.model.defined).toEqual(s().model.defined);
    expect(p.model.waldTests).toEqual(s().model.waldTests);
    expect(menuFor({ kind: 'path', id: 'p' }, s().model, cb)!.items.map((i) => i.label)).toContain('Label (A)…');
  });
});

describe('multiple groups and measurement invariance', () => {
  const withGroup = { names: [...data.names, 'school'], cols: [...data.cols, Float64Array.from({ length: 200 }, (_, i) => (i % 2) + 1)] };
  it('validates the grouping column and maps freed parameters to construct names', () => {
    s().setMultigroup({ column: 'school', invariance: 'scalar', free: [{ kind: 'loading', construct: 'A', indicator: 'a2' }, { kind: 'intercept', indicator: 'b1' }] });
    const errs = (d = withGroup, over = {}) => validateModel(s().model, d, { ...s().settings, ...over }).filter((i) => i.level === 'error').map((i) => i.message);
    expect(errs()).toEqual([]);
    expect(errs(data).some((m) => /not in the dataset/.test(m))).toBe(true);
    expect(errs(withGroup, { engine: 'builtin' }).some((m) => /estimated by lavaan/.test(m))).toBe(true);
    expect(toSpec(s().model).multigroup).toEqual({ column: 'school', invariance: 'scalar', free: [{ kind: 'loading', construct: 'A', indicator: 'a2' }, { kind: 'intercept', indicator: 'b1' }] });
    const p = parseProject(serializeProject(s().model, s().settings, null, null));
    expect(p.model.multigroup).toEqual(s().model.multigroup);
    s().setMultigroup({ column: 'a1', invariance: 'configural', free: [] });
    expect(errs().some((m) => /is an indicator and cannot also define the groups/.test(m))).toBe(true);
    s().setMultigroup(null);
    expect(s().model.multigroup).toBeUndefined();
  });

  it('offers partial invariance on indicators when loadings or intercepts are held equal', () => {
    const labels = () => menuFor({ kind: 'indicator', construct: 'A', name: 'a2' }, s().model, cb)!.items.map((i) => i.label);
    s().setMultigroup({ column: 'school', invariance: 'configural', free: [] });
    expect(labels().some((l) => /across groups/.test(l))).toBe(false);
    s().setMultigroup({ column: 'school', invariance: 'scalar', free: [] });
    expect(labels()).toEqual(expect.arrayContaining(['Free loading across groups (partial invariance)', 'Free intercept across groups (partial invariance)']));
    // The marker's loading is fixed to 1 in every group: nothing to free.
    expect(menuFor({ kind: 'indicator', construct: 'A', name: 'a1' }, s().model, cb)!.items.map((i) => i.label)).not.toContain('Free loading across groups (partial invariance)');
  });

  it('switches the group shown', () => {
    const g = (n: number) => ({ estimates: [], n } as unknown as import('./engine/cbsem').CbResult);
    useStore.setState({ results: { pls: null, cb: { ...g(100), groups: { labels: ['1', '2'], results: [g(100), g(80)], score: [] }, groupIndex: 0, modindices: [] }, miiv: null, boot: null, fitTest: null, key: 'k' } });
    s().showGroup(1);
    expect(s().results!.cb).toMatchObject({ n: 80, groupIndex: 1, groups: { labels: ['1', '2'] } });
  });
});

describe('ESEM blocks', () => {
  it('are made from selected factors, validated, and drawn without markers', () => {
    s().setEsem({ rotation: 'geomin', blocks: [{ id: 'e', constructs: ['A', 'B'] }] });
    const errs = (over = {}) => validateModel(s().model, data, { ...s().settings, ...over }).filter((i) => i.level === 'error').map((i) => i.message);
    expect(errs()).toEqual([]);
    expect(toSpec(s().model).esem).toEqual({ rotation: 'geomin', blocks: [['A', 'B']] });
    expect(errs({ engine: 'builtin' }).some((m) => /ESEM\) is estimated by lavaan/.test(m))).toBe(true);
    s().fixParameter({ kind: 'loading', construct: 'A', indicator: 'a2' }, 0.5);
    expect(errs().some((m) => /loadings are rotated/.test(m))).toBe(true);
    s().fixParameter({ kind: 'loading', construct: 'A', indicator: 'a2' }, null);
    expect(indicatorLabels(C('A', ['a1', 'a2']), 'cbsem', null, true)).toEqual([null, null]);
    expect(menuFor({ kind: 'construct', id: 'A' }, s().model, cb)!.items.map((i) => i.action)).toContain('leave-esem');
    expect(parseProject(serializeProject(s().model, s().settings, null, null)).model.esem).toEqual(s().model.esem);
    s().setEsem(null);
    expect(menuFor({ kind: 'construct', id: 'A' }, s().model, { ...cb, selected: ['A', 'B'] })!.items.map((i) => i.label)).toContain('Make ESEM block of the 2 selected factors');
  });
});

describe('LMS / QML latent interactions', () => {
  it('need ML, the R engine, complete data and a single-group model', () => {
    useStore.setState({ model: { ...model, constructs: [...model.constructs, C('M', ['b2'])].map((c) => (c.id === 'B' ? { ...c, indicators: ['b1', 'b3'] } : c)),
      paths: [...model.paths, { id: 'q', from: 'M', to: 'B' }], moderations: [{ id: 'mo', moderator: 'M', path: 'p' }] } });
    const errs = (over: Partial<typeof DEFAULT_SETTINGS>) => validateModel(s().model, data, { ...s().settings, ...over }).filter((i) => i.level === 'error').map((i) => i.message);
    expect(errs({ interaction: 'lms' }).filter((m) => /LMS/.test(m))).toEqual([]);
    expect(errs({ interaction: 'lms', engine: 'builtin' }).some((m) => /LMS latent interactions are estimated by modsem/.test(m))).toBe(true);
    expect(errs({ interaction: 'qml', estimator: 'MLR' }).some((m) => /QML is a maximum-likelihood method/.test(m))).toBe(true);
    expect(errs({ interaction: 'lms', missing: 'fiml' }).some((m) => /LMS needs complete data/.test(m))).toBe(true);
    expect(parseProject(serializeProject(s().model, { ...s().settings, interaction: 'qml' }, null, null)).settings.interaction).toBe('qml');
  });
});
