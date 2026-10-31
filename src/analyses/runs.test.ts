// The run log: Calculate logs model versions, unchanged models update their
// card, changes start a new version with a description, and a version can be
// opened on the Model tab again.

import { beforeEach, describe, expect, it } from 'vitest';
import type { Dataset, PlsResult } from '../engine/types';
import { parseProject, serializeProject, type Settings } from '../model/project';
import { resultsKey, useStore } from '../store';
import { parseCards } from './persist';
import { dataFingerprint, describeChanges, latestRun, runData, runHash, settingChanges, type RunCard } from './runHash';
import { currentRunHash, logCurrentRun, openRun, runCards, type RunOptions } from './runs';
import { cardStatus, currentCtx, loadCards, useAnalyses } from './store';
import type { AnalysisCard, Card } from './types';

const s = () => useStore.getState();
const col = (...v: number[]) => Float64Array.from(v);
const data = (k = 1) => ({ names: ['a1', 'a2', 'b1', 'b2'], cols: [col(1, 2, 3, 4, 5), col(2, 3, 4, 5, 7), col(1, 3, 2, 5, 4), col(k, 2, 2, 3, 1)] });
const info = { fileName: 'survey.csv', rows: 5, missingCells: 0, excluded: [] };

/** A two-construct PLS model on the canvas: A -> B. */
function model() {
  const a = s().addConstruct(0, 0, ['a1', 'a2']);
  const b = s().addConstruct(200, 0, ['b1', 'b2']);
  s().updateConstruct(a, { name: 'A' });
  s().updateConstruct(b, { name: 'B' });
  expect(s().addPath(a, b)).toBe(true);
  return { a, b };
}
/** Pretend the model was calculated: results on screen that match it. */
function calculated() {
  const st = s();
  const pls = { n: 5, converged: true, iterations: 3, constructs: st.model.constructs.map((c) => c.name), scores: [col(1, 2)] } as unknown as PlsResult;
  useStore.setState({ results: { pls, cb: null, miiv: null, boot: null, fitTest: null, key: resultsKey(st) } });
}
const runs = () => runCards(useAnalyses.getState().cards);

beforeEach(() => {
  s().newProject();
  useStore.setState({ cloud: null, toasts: [], workspace: 'analyses' });
  loadCards([]);
  s().setData(data(), info);
});

describe('logging a run', () => {
  it('logs nothing without current results, and a version 1 card with the model, settings, data and packed results once calculated', async () => {
    model();
    expect(await logCurrentRun()).toBeNull();
    calculated();
    const id = (await logCurrentRun())!;
    const [card] = runs();
    expect(card.id).toBe(id);
    expect(card.options).toMatchObject({ label: 'Model v1', version: 1, hash: currentRunHash(), changes: [], data: { fingerprint: expect.any(String), name: 'survey.csv', rows: 5 } });
    expect(card.options.model.constructs.map((c) => c.name)).toEqual(['A', 'B']);
    expect(card.options.settings.method).toBe('pls');
    expect(card.run?.packed).toBeTruthy();
    expect(cardStatus(card, currentCtx(), false, true)).toEqual({ state: 'current' });
  });

  it('calculating the unchanged model again updates its card; a bootstrap setting alone is not a new version', async () => {
    model(); calculated();
    const id = await logCurrentRun();
    const at = runs()[0].run!.at;
    await new Promise((r) => setTimeout(r, 2));
    s().setSettings({ bootSamples: 5000 });
    calculated();
    expect(await logCurrentRun()).toBe(id);
    expect(runs()).toHaveLength(1);
    expect(runs()[0].run!.at).toBeGreaterThan(at);
  });

  it('a changed model, setting or data starts a new version whose card says what changed', async () => {
    const { a, b } = model(); calculated();
    await logCurrentRun();
    // Model: a path removed and a construct renamed.
    s().removePaths([s().model.paths[0].id]);
    s().updateConstruct(b, { name: 'Loyalty' });
    calculated();
    await logCurrentRun();
    expect(runs().map((c) => c.options.label)).toEqual(['Model v1', 'Model v2']);
    expect(runs()[1].options.changes).toEqual(['+ constructs Loyalty', '− constructs B', '− path A → B']);
    expect(cardStatus(runs()[0], currentCtx(), false, true)).toEqual({ state: 'earlier' });
    // Settings that change the estimates.
    s().setSettings({ consistent: true, scheme: 'factor' });
    calculated();
    await logCurrentRun();
    expect(runs()[2].options.changes).toEqual(['PLSc off → on', 'weighting scheme path → factor']);
    // Data.
    s().setData(data(9), { ...info, fileName: 'wave2.csv' });
    calculated();
    await logCurrentRun();
    expect(runs()[3].options.changes).toEqual(['data: survey.csv (5 rows) → wave2.csv (5 rows)']);
    expect(runs()[3].options.hash).not.toBe(runs()[2].options.hash);
    expect(s().addPath(a, b)).toBe(true);
  });

  it('is not logged by a viewer of a shared project', async () => {
    model(); calculated();
    useStore.setState({ cloud: { projectId: 'p', role: 'viewer', status: 'online' } });
    expect(await logCurrentRun()).toBeNull();
    expect(runs()).toHaveLength(0);
  });
});

describe('opening a version', () => {
  it('puts the model and its settings back on the Model tab, through undo; calculating it again updates its own card; editing it makes a version noted as edited from it', async () => {
    const { b } = model(); calculated();
    const v1 = (await logCurrentRun())!;
    s().removePaths([s().model.paths[0].id]);
    s().setSettings({ consistent: true });
    calculated();
    await logCurrentRun();
    expect(runs()).toHaveLength(2);
    expect(await openRun(v1)).toBe(true);
    expect(s().model.paths).toHaveLength(1);
    expect(s().settings.consistent).toBe(false);
    expect(s().workspace).toBe('model');
    expect(currentRunHash()).toBe(runs()[0].options.hash);
    expect(cardStatus(runs()[0], currentCtx(), false, true)).toEqual({ state: 'current' });
    expect(s().toasts.at(-1)!.text).toContain('Model v1 opened on the Model tab');
    expect(s().toasts.at(-1)!.text).toContain('PLSc on → off');
    // Undo returns to the model before opening.
    s().undo();
    expect(s().model.paths).toHaveLength(0);
    s().redo();
    // Calculated again: v1's card is updated, no v3.
    calculated();
    expect(await logCurrentRun()).toBe(v1);
    expect(runs()).toHaveLength(2);
    // Edited from v1: v3, "from 1", with the changes relative to v1.
    s().removeIndicator(b, 'b2');
    calculated();
    await logCurrentRun();
    expect(runs()[2].options).toMatchObject({ version: 3, from: 1, changes: ['− B: b2'] });
  });

  it('asks what to do with an edited, uncalculated model: keep it as a card, discard it, or cancel', async () => {
    model(); calculated();
    const v1 = (await logCurrentRun())!;
    s().removePaths([s().model.paths[0].id]);
    // Cancel: nothing happens.
    expect(await openRun(v1, async () => null)).toBe(false);
    expect(s().model.paths).toHaveLength(0);
    expect(runs()).toHaveLength(1);
    // Keep: the working model becomes a card without results, then v1 opens.
    expect(await openRun(v1, async () => 'keep')).toBe(true);
    expect(runs().map((c) => c.options.label)).toEqual(['Model v1', 'Model v2 (not run)']);
    expect(runs()[1].run).toBeUndefined();
    expect(runs()[1].options.changes).toEqual(['− path A → B']);
    expect(cardStatus(runs()[1], currentCtx(), false, false)).toEqual({ state: 'empty' });
    expect(s().model.paths).toHaveLength(1);
    // Discard: the edit is just replaced (undo still has it).
    s().removePaths([s().model.paths[0].id]);
    s().updateConstruct(s().model.constructs[0].id, { name: 'A2' });
    expect(await openRun(v1, async () => 'discard')).toBe(true);
    expect(runs()).toHaveLength(2);
    expect(s().model.constructs[0].name).toBe('A');
    s().undo();
    expect(s().model.constructs[0].name).toBe('A2');
  });

  it('says so when the version is already the model on the Model tab, and refuses for viewers', async () => {
    model(); calculated();
    const v1 = (await logCurrentRun())!;
    expect(await openRun(v1)).toBe(true);
    expect(s().toasts.at(-1)!.text).toContain('is the model on the Model tab');
    useStore.setState({ cloud: { projectId: 'p', role: 'viewer', status: 'online' } });
    expect(await openRun(v1)).toBe(false);
  });
});

describe('run cards in files and shared projects', () => {
  it('keep the model and settings through a project file; a card with an invalid model is dropped', async () => {
    model(); calculated();
    await logCurrentRun();
    const st = s();
    const back = parseCards(parseProject(serializeProject(st.model, st.settings, null, null, null, useAnalyses.getState().cards)).analyses);
    expect(back).toHaveLength(1);
    const o = (back[0] as AnalysisCard).options as RunOptions;
    expect(o.model.constructs.map((c) => c.name)).toEqual(['A', 'B']);
    expect(o.hash).toBe(runs()[0].options.hash);
    expect(o.settings.method).toBe('pls');
    const bad = parseCards([{ id: 'card-x', kind: 'analysis', type: 'run', options: { ...o, model: { constructs: 'no' } } }, { id: 'card-y', kind: 'analysis', type: 'run', options: { ...o, version: -1 } }]);
    expect(bad).toHaveLength(0);
  });
});

describe('versions and changes', () => {
  it('hash the model specification, estimation settings and data, not inference options or styles', () => {
    model();
    const st = s();
    const h = runHash(st.model, st.settings, st.data);
    expect(runHash(st.model, { ...st.settings, bootSamples: 99, seed: 1, confidence: 0.9, figure: { ...st.settings.figure, fontSize: 30 } }, st.data)).toBe(h);
    expect(runHash(st.model, { ...st.settings, missing: 'casewise' }, st.data)).not.toBe(h);
    expect(runHash(st.model, st.settings, data(2))).not.toBe(h);
    expect(runHash({ ...st.model, constructs: st.model.constructs.map((c) => ({ ...c, x: c.x + 50 })) }, st.settings, st.data)).toBe(h);  // layout is not the model
  });

  it('describe setting changes in words, inference options included', () => {
    const a = s().settings;
    expect(settingChanges(a, { ...a, estimator: 'MLM', bootSamples: 5000, confidence: 0.9 })).toEqual(['estimator ML → MLM', 'bootstrap subsamples 1,000 → 5,000', 'confidence level 95% → 90%']);
    expect(describeChanges(null, { model: s().model, settings: a, data: { fingerprint: 'x', name: '', rows: 0 } })).toEqual([]);
  });
});

describe('the mean structure in run descriptions', () => {
  it('names the constant coming or going, and each mean arrow', () => {
    const a = s().addConstruct(0, 0, ['a1']), b = s().addConstruct(1, 0, ['b1']);
    s().addPath(a, b);
    const data = { fingerprint: 'x', name: '', rows: 0 };
    const before = { model: s().model, settings: s().settings, data };
    s().addConstant();
    s().addMean(a);
    const withArrow = { model: s().model, settings: s().settings, data };
    expect(describeChanges(before, withArrow)).toEqual(['+ mean structure (the constant)']);
    s().addMean(b);
    s().setMean(s().model.means![1].id, { fixed: 0 });
    expect(describeChanges(withArrow, { model: s().model, settings: s().settings, data })).toEqual([`+ mean ${s().model.constructs[1].name} = 0`]);
    expect(describeChanges({ model: s().model, settings: s().settings, data }, before)).toEqual(['− mean structure (the constant)']);
  });
});

describe('describeChanges, line by line', () => {
  const data = { fingerprint: 'x', name: 'a.csv', rows: 10 };
  const at = () => ({ model: structuredClone(s().model), settings: s().settings, data });
  it('names construct, indicator, type, mode, covariate, path, moderation, correlation and field changes', () => {
    const a = s().addConstruct(0, 0, ['a1', 'a2']), b = s().addConstruct(1, 0, ['b1']), c = s().addConstruct(2, 0, ['c1']);
    s().addPath(a, b);
    const v1 = at();
    s().removeIndicator(a, 'a2');
    s().updateConstruct(b, { type: 'composite', mode: 'B' });
    s().updateConstruct(c, { covariate: true });
    s().addPath(c, b);
    const v2 = at();
    const names = Object.fromEntries(s().model.constructs.map((k) => [k.id, k.name]));
    expect(describeChanges(v1, v2)).toEqual([
      `− ${names[a]}: a2`, `${names[b]}: factor → composite`, `${names[b]}: Mode A → Mode B`, `${names[c]}: now a covariate`, `+ path ${names[c]} → ${names[b]}`,
    ]);
    s().updateConstruct(c, { covariate: false });
    const v3 = at();
    expect(describeChanges(v2, v3)).toEqual([`${names[c]}: no longer a covariate`]);
    // Moderation, correlation, ordered indicators, groups.
    const p = s().model.paths.find((x) => x.from === a)!.id;
    s().addModeration(c, p);
    useStore.setState((st) => ({ model: { ...st.model, correlations: [{ id: 'k', kind: 'indicator', a: 'a1', b: 'b1' }], ordered: ['b1'], multigroup: { column: 'g', invariance: 'metric', free: [] } } }));
    const v4 = at();
    const d = describeChanges(v3, v4);
    expect(d).toContain(`+ moderation ${names[c]} on ${names[a]} → ${names[b]}`);
    expect(d).toContain('+ correlation a1 ↔ b1');
    expect(d).toContain('ordered indicators changed');
    expect(d).toContain('groups changed');
    // Nothing else changed than a fixed path value: caught through the specification.
    const v5 = { ...v4, model: { ...v4.model, paths: v4.model.paths.map((x) => (x.id === p ? { ...x, fixed: 0.5 } : x)) } };
    expect(describeChanges(v4, v5)).toEqual(['model parameters changed']);
    // Data.
    expect(describeChanges(v5, { ...v5, data: { fingerprint: 'y', name: 'b.csv', rows: 12 } })).toEqual(['data: a.csv (10 rows) → b.csv (12 rows)']);
    expect(describeChanges(v5, { ...v5, data: { fingerprint: 'y', name: '', rows: 0 } })).toEqual(['data: a.csv (10 rows) → none']);
  });
  it('writes settings values readably', () => {
    const a = s().settings;
    expect(settingChanges(a, { ...a, method: 'cbsem', consistent: true, counterfactual: { xref: 1, xcf: 2 } })).toEqual(['method PLS-SEM → CB-SEM', 'PLSc off → on', 'counterfactual none → {"xref":1,"xcf":2}']);
    expect(settingChanges(a, { ...a, seed: 12345 })).toEqual(['seed 1,234 → 12,345']);
    expect(settingChanges(a, { ...a, hocApproach: 'embedded' })).toEqual(['second-order approach two-stage (disjoint) → embedded two-stage']);
  });
});

describe('describeChanges, the remaining branches', () => {
  const data = { fingerprint: 'x', name: 'a.csv', rows: 10 };
  const at = () => ({ model: structuredClone(s().model), settings: s().settings, data });
  it('counts one new construct in the singular, matches renamed ids by name, and notes components, construct correlations and means', () => {
    const a = s().addConstruct(0, 0, ['a1']);
    const v1 = at();
    const b = s().addConstruct(1, 0, ['b1']);
    const v2 = at();
    const names = Object.fromEntries(s().model.constructs.map((k) => [k.id, k.name]));
    expect(describeChanges(v1, v2)).toEqual([`+ construct ${names[b]}`]);
    const c = s().addConstruct(2, 0, ['c1']);
    expect(describeChanges(v2, at())).toEqual([`+ construct ${names[c] ?? s().model.constructs[2].name}`]);
    expect(describeChanges(v1, at())).toEqual([`+ constructs ${names[b]}, ${s().model.constructs[2].name}`]);
    // The same construct under a new id (a project reloaded from another source): matched by name.
    const renamed = { ...v2, model: { ...v2.model, constructs: v2.model.constructs.map((k) => (k.id === a ? { ...k, id: 'other-id', type: 'composite' as const } : k)) } };
    expect(describeChanges(v2, renamed)).toEqual([`${names[a]}: factor → composite`]);
    const hoc = { ...v2, model: { ...v2.model, constructs: v2.model.constructs.map((k) => (k.id === a ? { ...k, components: [b] } : k)) } };
    expect(describeChanges(v2, hoc)).toEqual([`${names[a]}: components changed`]);
    const corr = { ...v2, model: { ...v2.model, correlations: [{ id: 'k', kind: 'construct' as const, a, b }] } };
    expect(describeChanges(v2, corr)).toEqual([`+ correlation ${names[a]} ↔ ${names[b]}`]);
    expect(describeChanges(corr, v2)).toEqual([`− correlation ${names[a]} ↔ ${names[b]}`]);
    const withK = { ...v2, model: { ...v2.model, constant: { x: 0, y: 0 } } };
    expect(describeChanges(v2, withK)).toEqual(['+ mean structure (the constant)']);
    expect(describeChanges(withK, v2)).toEqual(['− mean structure (the constant)']);
    const means = (ms: { id: string; target: string; fixed?: number; label?: string }[]) => ({ ...withK, model: { ...withK.model, means: ms } });
    expect(describeChanges(withK, means([{ id: 'm1', target: a }]))).toEqual([`+ mean ${names[a]}`]);
    expect(describeChanges(means([{ id: 'm1', target: a }]), means([{ id: 'm1', target: a, fixed: 0 }]))).toEqual([`+ mean ${names[a]} = 0`, `− mean ${names[a]}`]);
    expect(describeChanges(withK, means([{ id: 'm1', target: b, label: 'mb' }]))).toEqual([`+ mean ${names[b]} (mb)`]);
    expect(describeChanges(withK, means([{ id: 'm1', target: 'gone' }]))).toEqual(['+ mean gone']);
    expect(describeChanges(null, v2)).toEqual([]);
  });
  it('names every other model field that changed', () => {
    s().addConstruct(0, 0, ['a1']);
    const v = at();
    const fields: [string, unknown, string][] = [
      ['ordered', ['a1'], 'ordered indicators'], ['defined', [{ id: 'd', name: 'ind', expr: 'a*b' }], 'defined parameters'], ['waldTests', [{ id: 'w', name: 'w', constraints: 'a == 0' }], 'Wald tests'],
      ['inequalities', 'a > 0', 'inequalities'], ['positiveVariances', true, 'variance bounds'], ['multigroup', { column: 'g', invariance: 'metric', free: [] }, 'groups'],
      ['multilevel', { column: 'school', between: 'same' }, 'levels'], ['esem', { blocks: [], rotation: 'geomin' }, 'ESEM blocks'], ['weights', 'w', 'weights'], ['threeWay', [{ id: 't' }], 'moderated moderations'],
    ];
    for (const [k, value, label] of fields) {
      const next = { ...v, model: { ...v.model, [k]: value } };
      expect(describeChanges(v, next), k).toEqual([`${label} changed`]);
      expect(describeChanges(next, v), k).toEqual([`${label} changed`]);
    }
  });
  it('shows every setting it tracks by its name and formatted value', () => {
    const base = s().settings;
    const cases: [keyof Settings, unknown, string][] = [
      ['method', 'process', 'method PLS-SEM → conditional process analysis'], ['estimator', 'MLR', `estimator ${base.estimator} → MLR`], ['engine', base.engine === 'r' ? 'js' : 'r', `engine ${base.engine} → ${base.engine === 'r' ? 'js' : 'r'}`],
      ['plsPackage', 'zzz', `PLS package ${base.plsPackage} → zzz`], ['plsApproach', 'zzz', `weighting approach ${base.plsApproach} → zzz`], ['scheme', 'centroid', `weighting scheme ${base.scheme} → centroid`],
      ['maxIter', 7, `max. iterations ${base.maxIter} → 7`], ['stopExp', 3, `stop criterion (10^-k) ${base.stopExp} → 3`], ['missing', 'zzz', `missing values ${base.missing} → zzz`],
      ['miImputations', 99, `imputations ${base.miImputations} → 99`], ['interaction', 'zzz', `latent interactions ${base.interaction} → zzz`], ['probe', 'zzz', `probing ${base.probe} → zzz`],
      ['hc', 'zzz', `robust SEs ${base.hc} → zzz`], ['bootSamples', 12345, `bootstrap subsamples ${base.bootSamples.toLocaleString()} → 12,345`], ['confidence', 0.9, `confidence level ${Math.round(base.confidence * 100)}% → 90%`],
      ['bootTails', 'zzz', `tests ${base.bootTails} → zzz`], ['bootInterval', 'zzz', `bootstrap intervals ${base.bootInterval} → zzz`],
    ];
    for (const [k, value, text] of cases) expect(settingChanges(base, { ...base, [k]: value } as Settings), k).toEqual([text]);
    expect(settingChanges(base, base)).toEqual([]);
    expect(settingChanges(base, { ...base, estimator: 'MLR' }, ['seed'])).toEqual([]);
  });
  it('fingerprints data by values and keeps run cards in version order', () => {
    expect(dataFingerprint(null)).toBe('none');
    const cols = { names: ['x'], cols: [Float64Array.from([1, 2])] };
    expect(dataFingerprint(cols)).toBe(dataFingerprint({ names: ['x'], cols: [Float64Array.from([1, 2])] }));
    expect(dataFingerprint(cols)).not.toBe(dataFingerprint({ names: ['x'], cols: [Float64Array.from([1, 3])] }));
    expect(dataFingerprint(cols)).not.toBe(dataFingerprint({ names: ['y'], cols: [Float64Array.from([1, 2])] }));
    const mom = { names: ['x'], cols: [Float64Array.from([1, 2])], moments: { n: 2, cov: [[1]] } } as unknown as Dataset;
    expect(dataFingerprint(mom)).not.toBe(dataFingerprint(cols));
    expect(runData(null, null)).toEqual({ fingerprint: 'none', name: '', rows: 0 });
    expect(runData(cols, { fileName: 'f.csv', rows: 2, missingCells: 0, excluded: [] })).toMatchObject({ name: 'f.csv', rows: 2 });
    const run = (version: number): RunCard => ({ id: `r${version}`, kind: 'analysis', type: 'run', options: { version } as RunCard['options'] });
    const cards: Card[] = [run(2), { id: 'n', kind: 'note', text: '' }, { id: 'o', kind: 'analysis', type: 'test-mean', options: {} }, run(3), run(1)];
    expect(runCards(cards).map((c) => c.id)).toEqual(['r2', 'r3', 'r1']);
    expect(latestRun(runCards(cards))?.id).toBe('r3');
    expect(latestRun([])).toBeNull();
  });
});

describe('a moderation’s interaction method in the change log', () => {
  it('is part of the moderation’s name', () => {
    const a = s().addConstruct(0, 0, ['a1']), b = s().addConstruct(1, 0, ['b1']), c = s().addConstruct(2, 0, ['c1']);
    s().addPath(a, b);
    const p = s().model.paths[0].id;
    s().addModeration(c, p);
    const data = { fingerprint: 'x', name: 'a.csv', rows: 10 };
    const v1 = { model: structuredClone(s().model), settings: s().settings, data };
    s().setModerationMethod(s().model.moderations[0].id, 'product_indicator');
    const v2 = { model: structuredClone(s().model), settings: s().settings, data };
    const names = Object.fromEntries(s().model.constructs.map((k) => [k.id, k.name]));
    const d = describeChanges(v1, v2);
    expect(d).toEqual([`+ moderation ${names[c]} on ${names[a]} → ${names[b]} (product indicators)`, `− moderation ${names[c]} on ${names[a]} → ${names[b]}`]);
    expect(runHash(v1.model, v1.settings, data)).not.toBe(runHash(v2.model, v2.settings, data));
    s().setModerationMethod(s().model.moderations[0].id, undefined);
    expect(s().model.moderations[0]).not.toHaveProperty('method');
  });
});
