// The run log: Calculate logs model versions, unchanged models update their
// card, changes start a new version with a description, and a version can be
// opened on the Model tab again.

import { beforeEach, describe, expect, it } from 'vitest';
import type { PlsResult } from '../engine/types';
import { parseProject, serializeProject } from '../model/project';
import { resultsKey, useStore } from '../store';
import { parseCards } from './persist';
import { describeChanges, runHash, settingChanges } from './runHash';
import { currentRunHash, logCurrentRun, openRun, runCards, type RunOptions } from './runs';
import { cardStatus, currentCtx, loadCards, useAnalyses } from './store';
import type { AnalysisCard } from './types';

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
