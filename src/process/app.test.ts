// Conditional process analysis in the app: store actions, method switching,
// project files, validation, results freshness and context menus.

import { beforeEach, describe, expect, it } from 'vitest';
import { menuFor } from '../components/canvasMenu';
import { covarianceLayout } from '../components/CovarianceLayer';
import { switchMethod } from '../methodSwitch';
import { DEFAULT_SETTINGS, parseProject, serializeProject, validateModel, type ModelState } from '../model/project';
import { emptyModel, resultsKey, useStore } from '../store';
import { processGraph } from './fromModel';

const s = () => useStore.getState();
const named = (name: string) => s().model.constructs.find((c) => c.name === name)!;
const data = { names: ['stress', 'sup', 'burn', 'r1', 'r2', 'age'], cols: Array.from({ length: 6 }, () => new Float64Array([1, 2, 3, 4, 5])) };
const yes = () => Promise.resolve(true);

beforeEach(() => useStore.setState({
  model: emptyModel(), settings: { ...DEFAULT_SETTINGS, method: 'process' }, data, past: [], future: [], toasts: [], cloud: null,
}));

describe('PROCESS templates in the store', () => {
  it('applies a template as empty slots, and names a slot after the variable dropped on it', () => {
    s().applyTemplate(7, 1);
    expect(s().model.constructs.map((c) => c.name).sort()).toEqual(['M', 'W', 'X', 'Y']);
    expect(validateModel(s().model, data, s().settings).some((i) => /has no variable yet/.test(i.message))).toBe(true);
    s().assignIndicators(named('X').id, ['stress']);
    expect(named('stress').indicators).toEqual(['stress']);
    // A scale (several items) keeps the role name: the user names it.
    s().assignIndicators(named('M').id, ['r1', 'r2']);
    expect(named('M').indicators).toEqual(['r1', 'r2']);
    s().assignIndicators(named('W').id, ['sup']);
    s().assignIndicators(named('Y').id, ['burn']);
    expect(validateModel(s().model, data, s().settings).filter((i) => i.level === 'error')).toEqual([]);
    expect(processGraph(s().model).recognised).toMatchObject({ model: 7, roles: { x: 'stress', m: ['M'], w: 'sup', y: 'burn' } });
    s().undo();
    expect(named('Y').indicators).toEqual([]);
  });

  it('adds and removes mediators of the recognised model, keeping its variables', () => {
    s().applyTemplate(4, 1);
    s().assignIndicators(named('M').id, ['r1']);
    expect(s().setMediatorCount(3)).toBe(true);
    const info = processGraph(s().model);
    expect(info.recognised).toMatchObject({ model: 4 });
    expect(info.recognised!.roles.m).toEqual(['r1', 'M1', 'M2']);
    expect(s().setMediatorCount(1)).toBe(true);
    expect(processGraph(s().model).recognised!.roles.m).toEqual(['r1']);
    // Serial models take two to six.
    s().applyTemplate(6, 2);
    expect(s().setMediatorCount(7)).toBe(false);
    expect(s().toasts.at(-1)?.text).toMatch(/takes 2 to 6 mediators/);
  });

  it('moderation implies the main effect, and a moderation can be moderated (three-way)', () => {
    s().applyTemplate(1, 0);
    const paths = s().model.paths.length;
    s().addConstruct(0, 0);
    const z = s().model.constructs.at(-1)!;
    expect(s().addThreeWay(z.id, s().model.moderations[0].id)).toBe(true);
    expect(s().model.paths.length).toBe(paths);
    expect(processGraph(s().model).recognised?.model).toBe(3);
    // At most one moderator per moderation; never the predictor, outcome or first moderator.
    expect(s().addThreeWay(named('W').id, s().model.moderations[0].id)).toBe(false);
    expect(s().addThreeWay(named('X').id, s().model.moderations[0].id)).toBe(false);
    // Deleting the moderation deletes the three-way term with it.
    s().deleteItems([], [], [s().model.moderations[0].id]);
    expect(s().model.threeWay).toEqual([]);
  });
});

describe('switching methods', () => {
  it('leaving process analysis adds the main-effect paths SEM draws', async () => {
    s().applyTemplate(7, 1);
    expect(await switchMethod('pls', yes)).toBe(true);
    const w = named('W').id, m = named('M').id;
    expect(s().model.paths.some((p) => p.from === w && p.to === m)).toBe(true);
    // And they read as implied main effects again in process analysis.
    expect(await switchMethod('process', yes)).toBe(true);
    expect(processGraph(s().model).recognised?.model).toBe(7);
  });

  it('refuses SEM while a moderated moderation exists, and process analysis for matrix data', async () => {
    s().applyTemplate(3, 0);
    expect(await switchMethod('cbsem', yes)).toBe(false);
    expect(s().toasts.at(-1)?.text).toMatch(/Moderated moderations/);
    useStore.setState({ settings: { ...DEFAULT_SETTINGS, method: 'cbsem' }, model: emptyModel(), data: { names: ['a'], cols: [], moments: { S: [[1]], n: 50 } } });
    expect(await switchMethod('process', yes)).toBe(false);
    expect(s().toasts.at(-1)?.text).toMatch(/needs raw data/);
  });
});

describe('project files and results', () => {
  it('round-trips the method, probing choice and moderated moderations', () => {
    s().applyTemplate(3, 0);
    const text = serializeProject(s().model, { ...s().settings, probe: 'meansd' }, null, null);
    const p = parseProject(text);
    expect(p.settings).toMatchObject({ method: 'process', probe: 'meansd' });
    expect(p.model.threeWay).toEqual(s().model.threeWay);
    const bad = JSON.parse(text);
    bad.model.threeWay[0].moderation = 'nope';
    expect(() => parseProject(JSON.stringify(bad))).toThrow(/moderated moderation references/);
  });

  it('results go stale when a three-way term, the probing or the bootstrap changes', () => {
    s().applyTemplate(3, 0);
    const key = resultsKey(s());
    expect(resultsKey({ ...s(), settings: { ...s().settings, probe: 'meansd' } })).not.toBe(key);
    expect(resultsKey({ ...s(), settings: { ...s().settings, bootSamples: 2000 } })).not.toBe(key);
    expect(resultsKey({ ...s(), model: { ...s().model, threeWay: [] } })).not.toBe(key);
  });

  it('SEM methods reject moderated moderation', () => {
    s().applyTemplate(3, 0);
    expect(validateModel(s().model, data, { ...s().settings, method: 'pls' }).some((i) => /Moderated moderation/.test(i.message))).toBe(true);
  });
});

describe('context menus in process analysis', () => {
  const m: ModelState = {
    constructs: ['X', 'Y', 'Age'].map((id) => ({ id, name: id, type: 'factor', mode: 'A', indicators: [id], x: 0, y: 0, side: 'left' })),
    paths: [{ id: 'p', from: 'X', to: 'Y' }], moderations: [],
  };
  const ctx = { method: 'process' as const, readOnly: false };
  it('offers covariates and templates, not composites or quadratic terms', () => {
    const actions = (t: Parameters<typeof menuFor>[0], model = m) => menuFor(t, model, ctx)?.items.map((i) => i.action) ?? [];
    expect(actions({ kind: 'construct', id: 'Age' })).toContain('make-covariate');
    expect(actions({ kind: 'construct', id: 'X' })).not.toContain('make-covariate');
    expect(actions({ kind: 'construct', id: 'X' })).not.toContain('make-composite');
    expect(actions({ kind: 'path', id: 'p' })).not.toContain('add-quadratic');
    expect(actions({ kind: 'pane', x: 0, y: 0 })).toContain('process-template');
    const withCov = { ...m, constructs: m.constructs.map((c) => (c.id === 'Age' ? { ...c, covariate: true } : c)) };
    expect(actions({ kind: 'construct', id: 'Age' }, withCov)).toContain('unmake-covariate');
  });
});

describe('implied covariances can be fixed at zero', () => {
  it('right-click on an implied arc fixes it; the fixed zero can be removed again', () => {
    useStore.setState({ settings: { ...DEFAULT_SETTINGS, method: 'cbsem' } });
    s().applyTemplate(1, 0);
    const [x, w] = [named('X').id, named('W').id];
    s().assignIndicators(x, ['r1', 'r2']);
    s().assignIndicators(w, ['sup', 'age']);
    expect(covarianceLayout(s().model, true, false).curves).toHaveLength(1);
    const ctx = { method: 'cbsem' as const, readOnly: false };
    expect(menuFor({ kind: 'implied', a: x, b: w }, s().model, ctx)?.items.map((i) => i.action)).toEqual(['fix-zero']);
    expect(menuFor({ kind: 'implied', a: x, b: w }, s().model, { ...ctx, method: 'pls' })).toBeNull();
    expect(s().addCorrelation('construct', x, w, true)).toBe(true);
    const k = s().model.correlations![0];
    expect(k).toMatchObject({ a: x, b: w, zero: true });
    // Not drawn (no arrow means zero), and drawing the correlation frees it again.
    expect(covarianceLayout(s().model, true, false).curves).toEqual([]);
    // Survives a project file, and reaches the engines as a fixed zero.
    const p = parseProject(serializeProject(s().model, s().settings, null, null));
    expect(p.model.correlations![0].zero).toBe(true);
    expect(validateModel(s().model, data, s().settings).some((i) => /fixed as uncorrelated/.test(i.message))).toBe(false);
    expect(s().addCorrelation('construct', w, x)).toBe(true);
    expect(s().model.correlations).toEqual([]);
    expect(covarianceLayout(s().model, true, false).curves.map((c) => c.k.id)).toEqual([expect.stringMatching(/^auto:/)]);
  });
});

describe('session messages', () => {
  it('keeps every engine warning and error toast; not toasts logged elsewhere', () => {
    useStore.setState({ messages: [] });
    s().toast('error', 'Import a dataset first.');
    s().toast('error', 'lavaan: 2 warnings (see Messages).', { log: false });
    s().toast('info', 'Saved.');
    s().setResults({ cb: { warnings: ['lavaan WARNING: the optimizer warns that a solution has NOT been found!', 'second'], engine: { package: 'lavaan', version: '0.7-3' } } as never }, 'k');
    expect(s().messages.map((m) => [m.level, m.text, m.source])).toEqual([
      ['error', 'Import a dataset first.', undefined],
      ['warning', 'lavaan WARNING: the optimizer warns that a solution has NOT been found!', 'lavaan 0.7-3'],
      ['warning', 'second', 'lavaan 0.7-3'],
    ]);
    s().clearMessages();
    expect(s().messages).toEqual([]);
  });
});

describe('latent variables in process analysis', () => {
  it('needs two or more items, excludes three-way terms, and reaches the request', async () => {
    const { processInput } = await import('./input');
    s().applyTemplate(3, 0);
    s().assignIndicators(named('X').id, ['r1', 'r2']);
    s().updateConstruct(named('X').id, { latent: true });
    expect(validateModel(s().model, data, s().settings).some((i) => /three-way interaction\) is not available with latent/.test(i.message))).toBe(true);
    s().applyTemplate(1, 0);
    s().assignIndicators(named('X').id, ['r1']);
    s().updateConstruct(named('r1').id, { latent: true });
    expect(validateModel(s().model, data, s().settings).some((i) => /needs at least two/.test(i.message))).toBe(true);
    s().assignIndicators(named('r1').id, ['r2']);
    expect(validateModel(s().model, data, s().settings).some((i) => /two items; it is identified only/.test(i.message))).toBe(true);
    expect(processInput(s().model, s().settings)!.variables.find((v) => v.name === 'r1')).toMatchObject({ latent: true, indicators: ['r1', 'r2'] });
    // Round trip through a project file.
    expect(parseProject(serializeProject(s().model, s().settings, null, null)).model.constructs.find((c) => c.name === 'r1')!.latent).toBe(true);
  });
});

describe('categorical X in the app', () => {
  it('codes X from the data, refuses categorical non-X variables, and survives files', async () => {
    const { processInput } = await import('./input');
    const groups = { names: ['g', 'm', 'y'], cols: [Float64Array.from([1, 2, 3, 1, 2]), Float64Array.from([1, 2, 3, 4, 5]), Float64Array.from([2, 3, 4, 5, 6])] };
    useStore.setState({ data: groups });
    s().applyTemplate(4, 1);
    s().assignIndicators(named('X').id, ['g']);
    s().assignIndicators(named('M').id, ['m']);
    s().assignIndicators(named('Y').id, ['y']);
    s().updateConstruct(named('g').id, { categorical: 'helmert' });
    expect(validateModel(s().model, groups, s().settings).filter((i) => i.level === 'error')).toEqual([]);
    const input = processInput(s().model, s().settings, groups)!;
    expect(input.categorical).toMatchObject({ x: 'g', coding: 'helmert', levels: [1, 2, 3], names: ['g D1', 'g D2'] });
    s().updateConstruct(named('m').id, { categorical: 'indicator' });
    expect(validateModel(s().model, groups, s().settings).some((i) => /applies to X only/.test(i.message))).toBe(true);
    expect(parseProject(serializeProject(s().model, s().settings, null, null)).model.constructs.find((c) => c.name === 'g')!.categorical).toBe('helmert');
  });
});

describe('dichotomous Y and counterfactual effects', () => {
  it('detects a two-valued Y, derives the compared X values, and checks combinations', async () => {
    const { processInput, defaultCounterfactual } = await import('./input');
    const d = { names: ['x', 'm', 'y'], cols: [Float64Array.from([0, 1, 0, 1, 1]), Float64Array.from([1, 2, 3, 4, 5]), Float64Array.from([0, 1, 1, 0, 1])] };
    useStore.setState({ data: d });
    s().applyTemplate(74, 1);
    s().assignIndicators(named('X').id, ['x']);
    s().assignIndicators(named('M').id, ['m']);
    s().assignIndicators(named('Y').id, ['y']);
    expect(validateModel(s().model, d, s().settings).some((i) => /model 74\) needs a continuous Y/.test(i.message))).toBe(true);
    const inp = processInput(s().model, s().settings, d)!;
    expect(inp.binaryY).toBe(true);
    expect(inp.counterfactual).toEqual({ xref: 0, xcf: 1 });
    expect(defaultCounterfactual(Float64Array.from([1, 2, 3]))).toEqual({ xref: 2, xcf: 3 });
    expect(processInput(s().model, { ...s().settings, counterfactual: { xref: 2, xcf: 5 } }, d)!.counterfactual).toEqual({ xref: 2, xcf: 5 });
  });
});
