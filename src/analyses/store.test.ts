import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { serializeProject, parseProject } from '../model/project';
import { useStore } from '../store';
import { fingerprint } from './codec';
import { parseCards, shareableCards } from './persist';
import { ANALYSIS_TYPES } from './registry';
import {
  addAnalysis, addText, cardStatus, currentCtx, duplicateCard, loadCards, moveCard, nudgeCard, removeCard, runCard, setOptions, setText, unpackCard, useAnalyses,
} from './store';
import type { AnalysisCard, AnalysisType } from './types';

// A stand-in analysis: the mean of one data column.
let failNext = false;
const meanType: AnalysisType<{ col: string }, { mean: number; values: Float64Array }> = {
  id: 'test-mean', title: 'Mean', sub: 'test', group: 'Data',
  defaults: () => ({ col: 'x' }),
  parseOptions: (raw) => (raw && typeof (raw as { col?: unknown }).col === 'string' ? { col: (raw as { col: string }).col } : null),
  Options: () => null, View: () => null,
  blocked: (o, ctx) => (ctx.data?.names.includes(o.col) ? null : `No column ${o.col}.`),
  fingerprint: (o, ctx) => { const k = ctx.data?.names.indexOf(o.col) ?? -1; return k < 0 ? null : fingerprint([o.col, ctx.data!.cols[k]]); },
  run: async (o, ctx) => {
    if (failNext) { failNext = false; throw new Error('R said no'); }
    const col = ctx.data!.cols[ctx.data!.names.indexOf(o.col)];
    return { mean: col.reduce((a, b) => a + b, 0) / col.length, values: col };
  },
  summary: (o) => o.col,
};
ANALYSIS_TYPES.push(meanType);
afterAll(() => { ANALYSIS_TYPES.splice(ANALYSIS_TYPES.indexOf(meanType), 1); });

const a = () => useAnalyses.getState();
const card = (id: string) => a().cards.find((c) => c.id === id) as AnalysisCard;
const setData = (x: number[], y = [0, 0, 0]) => useStore.getState().setData(
  { names: ['x', 'y'], cols: [Float64Array.from(x), Float64Array.from(y)] }, { fileName: 'd.csv', rows: x.length, missingCells: 0, excluded: [] });
const status = (id: string) => cardStatus(card(id), currentCtx(), !!a().running[id], id in a().results);

beforeEach(() => {
  useStore.getState().newProject();
  useStore.setState({ cloud: null, toasts: [] });
  loadCards([]);
  useAnalyses.setState({ results: {}, errors: {}, running: {}, unpacking: {} });
  setData([1, 2, 3]);
});

describe('analysis log', () => {
  it('adds, orders, duplicates and removes cards', () => {
    const h = addText('heading', 'Checks')!;
    const m = addAnalysis('test-mean')!;
    const n = addText('note', 'why')!;
    expect(a().cards.map((c) => c.id)).toEqual([h, m, n]);
    expect(a().selected).toBe(n);
    moveCard(n, h);
    expect(a().cards.map((c) => c.id)).toEqual([n, h, m]);
    moveCard(n, null);
    expect(a().cards.map((c) => c.id)).toEqual([h, m, n]);
    nudgeCard(h, 1);
    expect(a().cards.map((c) => c.id)).toEqual([m, h, n]);
    nudgeCard(m, -1);
    expect(a().cards.map((c) => c.id)).toEqual([m, h, n]);
    const d = duplicateCard(m)!;
    expect(a().cards.map((c) => c.id)).toEqual([m, d, h, n]);
    expect(card(d).options).toEqual(card(m).options);
    setText(h, 'x'.repeat(9000));
    expect((a().cards[2] as { text: string }).text).toHaveLength(5000);
    removeCard(h);
    expect(a().cards.map((c) => c.id)).toEqual([m, d, n]);
    expect(addAnalysis('no-such-analysis')).toBeNull();
  });

  it('lets viewers of a shared project change nothing', () => {
    const m = addAnalysis('test-mean')!;
    useStore.setState({ cloud: { projectId: 'p', role: 'viewer', status: 'online' } });
    expect(addText('note')).toBeNull();
    setOptions(m, { col: 'y' });
    removeCard(m);
    expect(a().cards).toHaveLength(1);
    expect(card(m).options).toEqual({ col: 'x' });
  });
});

describe('running a card', () => {
  it('keeps the result, packed for the project, and tells when it is stale', async () => {
    const m = addAnalysis('test-mean')!;
    expect(status(m).state).toBe('empty');
    await runCard(m);
    expect((a().results[m] as { mean: number }).mean).toBe(2);
    expect(card(m).run?.packed).toBeTruthy();
    expect(status(m).state).toBe('current');

    setData([1, 2, 3], [5, 5, 5]);  // another column changed: still current
    expect(status(m).state).toBe('current');
    setData([1, 2, 4]);
    expect(status(m)).toEqual({ state: 'stale', why: 'The data it used changed since this ran.' });
    setData([1, 2, 3]);
    expect(status(m).state).toBe('current');
    setOptions(m, { col: 'y' });
    expect(status(m)).toEqual({ state: 'stale', why: 'The options changed since this ran.' });
    setOptions(m, { col: 'z' });
    expect(status(m)).toMatchObject({ state: 'stale' });
    await runCard(m);
    expect(a().errors[m]).toBe('No column z.');
  });

  it('reports a failed run and keeps the previous result', async () => {
    const m = addAnalysis('test-mean')!;
    await runCard(m);
    const before = card(m).run;
    failNext = true;
    await runCard(m);
    expect(a().errors[m]).toContain('R said no');
    expect(card(m).run).toBe(before);
    expect((a().results[m] as { mean: number }).mean).toBe(2);
  });

  it('restores results from a saved project, typed arrays included', async () => {
    const m = addAnalysis('test-mean')!;
    await runCard(m);
    const s = useStore.getState();
    const text = serializeProject(s.model, s.settings, s.data, s.dataInfo, null, a().cards);
    loadCards([]);
    useAnalyses.setState({ results: {} });
    const p = parseProject(text);
    loadCards(parseCards(p.analyses));
    expect(m in a().results).toBe(false);
    await unpackCard(m);
    const r = a().results[m] as { mean: number; values: Float64Array };
    expect(r.mean).toBe(2);
    expect(r.values).toBeInstanceOf(Float64Array);
    expect(status(m).state).toBe('current');
  });
});

describe('cards from files and collaborators', () => {
  it('are validated: bad ids, unknown kinds, oversized fields dropped or capped', () => {
    const cards = parseCards([
      { id: 'card-1', kind: 'heading', text: 'H'.repeat(6000) },
      { id: 'card-1', kind: 'note', text: 'duplicate id' },
      { id: '../etc', kind: 'note', text: 'bad id' },
      { id: 'card-2', kind: 'analysis', type: 'no-such', options: {} },
      { id: 'card-3', kind: 'analysis', type: 'test-mean', options: { col: 7 } },
      { id: 'card-4', kind: 'analysis', type: 'test-mean', options: { col: 'x' }, run: { at: 1, fingerprint: 'f', options: '{}', packed: 'x'.repeat(9_000_000) } },
      { id: 'card-5', kind: 'analysis', type: 'test-mean', options: { col: 'x' }, run: { at: 'yesterday' } },
      'junk',
    ]);
    expect(cards.map((c) => c.id)).toEqual(['card-1', 'card-4', 'card-5']);
    expect((cards[0] as { text: string }).text).toHaveLength(5000);
    expect((cards[1] as AnalysisCard).run).toEqual({ at: 1, fingerprint: 'f', options: '{}' });
    expect((cards[2] as AnalysisCard).run).toBeUndefined();
  });

  it('go to shared projects without their results; a collaborator’s copy keeps ours', async () => {
    const m = addAnalysis('test-mean')!;
    await runCard(m);
    const shared = shareableCards(a().cards);
    expect((shared[0] as AnalysisCard).run?.packed).toBeUndefined();
    expect(JSON.stringify(shared)).not.toContain(card(m).run!.packed!);
    loadCards(shared);
    expect(card(m).run?.packed).toBeTruthy();
    expect(m in a().results).toBe(true);
    // A collaborator's new run: our old result goes.
    loadCards([{ ...shared[0], run: { ...(shared[0] as AnalysisCard).run!, at: Date.now() + 1 } } as AnalysisCard]);
    expect(m in a().results).toBe(false);
    expect(status(m).state).toBe('missing');
  });
});
