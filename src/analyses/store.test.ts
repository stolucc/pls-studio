import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const interruptR = vi.fn();
vi.mock('../rengine/runtime', () => ({ interruptR: () => interruptR() }));
import { serializeProject, parseProject } from '../model/project';
import { useStore } from '../store';
import { fingerprint, packResult } from './codec';
import { runHash } from './runHash';
import { parseCards, shareableCards } from './persist';
import { ANALYSIS_TYPES } from './registry';
import {
  addAnalysis, addFrozenCard, addText, cancelCard, cardStatus, currentCtx, duplicateCard, loadCards, MAX_CARDS, MAX_TEXT, moveCard, moveCardNextTo, nudgeCard, removeCard, runCard, setOptions, setText, setTitle, unpackCard, updateFrozenCard, useAnalyses,
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

  it('moves a card before or after another (dropping in the outline)', () => {
    const [a, b, c] = [addText('note', 'a')!, addText('note', 'b')!, addText('note', 'c')!];
    const order = () => useAnalyses.getState().cards.map((x) => x.id);
    moveCardNextTo(a, c, true);
    expect(order()).toEqual([b, c, a]);
    moveCardNextTo(a, b, false);
    expect(order()).toEqual([a, b, c]);
    moveCardNextTo(c, a, true);
    expect(order()).toEqual([a, c, b]);
    moveCardNextTo(b, b, true);
    moveCardNextTo(b, 'card-gone', false);
    expect(order()).toEqual([a, c, b]);
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

  it('renames a card: one trimmed line of at most 80 characters, empty restores the analysis name, copies keep it', () => {
    const m = addAnalysis('test-mean')!;
    setTitle(m, '  Mean of  x\n(first wave)  ');
    expect(card(m).title).toBe('Mean of x (first wave)');
    const copy = duplicateCard(m)!;
    expect(card(copy).title).toBe('Mean of x (first wave)');
    setTitle(m, 'x'.repeat(100));
    expect(card(m).title).toHaveLength(80);
    setTitle(m, '   ');
    expect('title' in card(m)).toBe(false);
    // Only analysis cards, and not for viewers.
    const h = addText('heading', 'H')!;
    setTitle(h, 'nope');
    expect((a().cards.find((c) => c.id === h) as { title?: string }).title).toBeUndefined();
    useStore.setState({ cloud: { projectId: 'p', role: 'viewer', status: 'online' } });
    setTitle(copy, 'changed by a viewer');
    expect(card(copy).title).toBe('Mean of x (first wave)');
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
      { id: 'card-5', kind: 'analysis', type: 'test-mean', options: { col: 'x' }, run: { at: 'yesterday' }, title: { not: 'a string' } },
      { id: 'card-6', kind: 'analysis', type: 'test-mean', options: { col: 'x' }, title: ' My\ttitle ' + 'x'.repeat(100) },
      'junk',
    ]);
    expect(cards.map((c) => c.id)).toEqual(['card-1', 'card-4', 'card-5', 'card-6']);
    expect((cards[0] as { text: string }).text).toHaveLength(5000);
    expect((cards[1] as AnalysisCard).run).toEqual({ at: 1, fingerprint: 'f', options: '{}' });
    expect((cards[2] as AnalysisCard).run).toBeUndefined();
    expect((cards[2] as AnalysisCard).title).toBeUndefined();
    expect((cards[3] as AnalysisCard).title).toBe(('My title ' + 'x'.repeat(100)).slice(0, 80));
  });

  it('keep their titles through a project file', () => {
    const m = addAnalysis('test-mean')!;
    setTitle(m, 'Mean of x');
    const s = useStore.getState();
    const back = parseCards(parseProject(serializeProject(s.model, s.settings, null, null, null, a().cards)).analyses);
    expect((back[0] as AnalysisCard).title).toBe('Mean of x');
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

describe('card status, every state', () => {
  it('reports running, empty, unknown kind, missing result, changed options and changed inputs', async () => {
    setData([1, 2, 3]);
    const id = addAnalysis('test-mean')!;
    expect(status(id)).toEqual({ state: 'empty' });
    useAnalyses.setState((s) => ({ running: { ...s.running, [id]: true } }));
    expect(status(id)).toEqual({ state: 'running' });
    useAnalyses.setState({ running: {} });
    await runCard(id);
    expect(status(id)).toEqual({ state: 'current' });
    // The result gone (as on another computer of a shared project) and nothing packed: missing.
    const run = card(id).run!;
    useAnalyses.setState((s) => ({ results: {}, cards: s.cards.map((c) => (c.id === id ? { ...c, run: { ...run, packed: undefined } } : c)) }));
    expect(status(id).state).toBe('missing');
    useAnalyses.setState((s) => ({ cards: s.cards.map((c) => (c.id === id ? { ...c, run } : c)) }));
    await unpackCard(id);
    setOptions(id, { col: 'y' });
    expect(status(id)).toEqual({ state: 'stale', why: 'The options changed since this ran.' });
    setOptions(id, { col: 'x' });
    setData([4, 5, 6]);
    expect(status(id).state).toBe('stale');
    useStore.getState().setData({ names: ['q'], cols: [Float64Array.from([1, 2, 3])] }, { fileName: 'd.csv', rows: 3, missingCells: 0, excluded: [] });
    expect(status(id)).toEqual({ state: 'stale', why: 'No column x.' });
    // A card of a kind this version does not have.
    useAnalyses.setState((s) => ({ cards: s.cards.map((c) => (c.id === id ? { ...c, type: 'gone' } : c)) }));
    expect(status(id)).toEqual({ state: 'stale', why: 'This kind of analysis is not available in this version.' });
  });
});

describe('frozen cards (model snapshots)', () => {
  const frozenType: AnalysisType<{ n: number }, { ok: boolean }> = {
    id: 'test-frozen', title: 'Snapshot', sub: 'test', group: 'Data', frozen: true,
    defaults: () => ({ n: 1 }), parseOptions: (raw) => raw as { n: number }, Options: () => null, View: () => null, blocked: () => null,
    fingerprint: (o) => `fz-${o.n}`, run: async () => ({ ok: true }), summary: (o) => `n=${o.n}`,
  };
  beforeEach(() => { if (!ANALYSIS_TYPES.includes(frozenType)) ANALYSIS_TYPES.push(frozenType); });
  afterAll(() => { ANALYSIS_TYPES.splice(ANALYSIS_TYPES.indexOf(frozenType), 1); });

  it('adds a snapshot with its packed result, and refuses ordinary types, viewers and a full workspace', async () => {
    expect(await addFrozenCard('test-mean', { col: 'x' }, { mean: 1 })).toBeNull();
    expect(await addFrozenCard('nope', {}, {})).toBeNull();
    const id = (await addFrozenCard('test-frozen', { n: 2 }, { ok: true }))!;
    expect(id).toBeTruthy();
    expect(a().selected).toBe(id);
    expect(card(id).run).toMatchObject({ fingerprint: 'fz-2', options: '{"n":2}' });
    expect(typeof card(id).run!.packed).toBe('string');
    expect(a().results[id]).toEqual({ ok: true });
    useStore.setState({ cloud: { projectId: 'p', role: 'viewer', status: 'online' } });
    expect(await addFrozenCard('test-frozen', { n: 3 }, { ok: true })).toBeNull();
    useStore.setState({ cloud: null });
    loadCards(Array.from({ length: MAX_CARDS }, (_, i) => ({ id: `t${i}`, kind: 'note' as const, text: '' })));
    expect(await addFrozenCard('test-frozen', { n: 3 }, { ok: true })).toBeNull();
  });
  it('replaces a snapshot result in place, clearing its error, and refuses the rest', async () => {
    const id = (await addFrozenCard('test-frozen', { n: 2 }, { ok: true }))!;
    const before = card(id).run!;
    useAnalyses.setState({ errors: { [id]: 'old error' } });
    await new Promise((r) => setTimeout(r, 2));
    expect(await updateFrozenCard(id, { ok: false })).toBe(true);
    expect(a().results[id]).toEqual({ ok: false });
    expect(a().errors[id]).toBeUndefined();
    expect(card(id).run!.at).toBeGreaterThan(before.at);
    expect(card(id).run!.packed).not.toBe(before.packed);
    expect(await updateFrozenCard('missing', {})).toBe(false);
    const plain = addAnalysis('test-mean')!;
    expect(await updateFrozenCard(plain, {})).toBe(false);
    useStore.setState({ cloud: { projectId: 'p', role: 'viewer', status: 'online' } });
    expect(await updateFrozenCard(id, { ok: true })).toBe(false);
    expect(a().results[id]).toEqual({ ok: false });
  });
  it('gives the context stale results as none', () => {
    setData([1, 2, 3]);
    const ctx = currentCtx();
    expect(ctx.pls).toBeNull();
    expect(ctx.cb).toBeNull();
    expect(ctx.data?.names).toEqual(['x', 'y']);
    expect(ctx.projectName).toBe(useStore.getState().projectName);
  });
  it('caps text cards at MAX_TEXT characters', () => {
    const id = addText('note', 'x'.repeat(MAX_TEXT + 10))!;
    expect((a().cards.find((c) => c.id === id) as { text: string }).text).toHaveLength(MAX_TEXT);
  });
});

describe('cancelling, corrupt stored results, replacing the log and display-only options', () => {
  let release: ((v: { mean: number; values: Float64Array }) => void) | null = null;
  const cancelled = vi.fn();
  const slowType: AnalysisType<{ show: boolean; col: string }, { mean: number; values: Float64Array }> = {
    id: 'test-slow', title: 'Slow mean', sub: 'test', group: 'Data', display: ['show'], cancel: cancelled,
    defaults: () => ({ show: true, col: 'x' }), parseOptions: (raw) => raw as { show: boolean; col: string }, Options: () => null, View: () => null,
    blocked: meanType.blocked, fingerprint: meanType.fingerprint, summary: (o) => o.col,
    run: () => new Promise((r) => { release = r; }),
  };
  beforeEach(() => { if (!ANALYSIS_TYPES.includes(slowType)) ANALYSIS_TYPES.push(slowType); release = null; cancelled.mockClear(); interruptR.mockClear(); });
  afterAll(() => { ANALYSIS_TYPES.splice(ANALYSIS_TYPES.indexOf(slowType), 1); });

  it('cancels a running card: no result, no error, R interrupted, a toast; nothing when it is not running', async () => {
    setData([1, 2, 3]);
    const id = addAnalysis('test-slow')!;
    cancelCard(id);
    expect(useStore.getState().toasts).toHaveLength(0);
    const p = runCard(id);
    expect(status(id)).toEqual({ state: 'running' });
    cancelCard(id);
    await p;
    expect(cancelled).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(interruptR).toHaveBeenCalledTimes(1));
    expect(useStore.getState().toasts.map((t) => t.text)).toEqual(['Calculation cancelled.']);
    expect(status(id)).toEqual({ state: 'empty' });
    expect(a().errors[id]).toBeUndefined();
    expect(a().running[id]).toBeUndefined();
    // A result that R still delivers afterwards goes nowhere.
    release!({ mean: 1, values: Float64Array.from([1]) });
    await new Promise((r) => setTimeout(r, 0));
    expect(a().results[id]).toBeUndefined();
  });

  it('reports a stored result it cannot read, once, and unpacks only what is still on the card', async () => {
    setData([1, 2, 3]);
    const id = addAnalysis('test-mean')!;
    await runCard(id);
    const good = card(id).run!;
    useAnalyses.setState((s) => ({ results: {}, cards: s.cards.map((c) => (c.id === id ? { ...c, run: { ...good, packed: 'AAAA' } } : c)) }));
    await unpackCard(id);
    expect(a().errors[id]).toMatch(/^The stored result could not be read \(.+\)\. Run it again\.$/);
    expect(a().results[id]).toBeUndefined();
    expect(a().unpacking).toEqual({});
    // Already unpacking, or no packed result: nothing happens.
    useAnalyses.setState((s) => ({ errors: {}, unpacking: { [id]: true }, cards: s.cards.map((c) => (c.id === id ? { ...c, run: good } : c)) }));
    await unpackCard(id);
    expect(a().results[id]).toBeUndefined();
    useAnalyses.setState({ unpacking: {} });
    // The card changes while its result is being unpacked: the stale result is dropped.
    const other = await packResult({ mean: 99, values: Float64Array.from([99]) });
    const p = unpackCard(id);
    useAnalyses.setState((s) => ({ cards: s.cards.map((c) => (c.id === id ? { ...c, run: { ...good, packed: other! } } : c)) }));
    await p;
    expect(a().results[id]).toBeUndefined();
    await unpackCard(id);
    expect((a().results[id] as { mean: number }).mean).toBe(99);
  });

  it('replacing the log cancels runs of cards that are gone and prunes their errors, running flags and selection', async () => {
    setData([1, 2, 3]);
    const slow = addAnalysis('test-slow')!, keep = addAnalysis('test-mean')!;
    const p = runCard(slow);
    useAnalyses.setState((s) => ({ errors: { ...s.errors, [slow]: 'e1', [keep]: 'e2' }, selected: slow }));
    loadCards([card(keep)]);
    await p;
    expect(a().cards.map((c) => c.id)).toEqual([keep]);
    expect(a().errors).toEqual({ [keep]: 'e2' });
    expect(a().running).toEqual({});
    expect(a().selected).toBeNull();
    expect(a().results).toEqual({});
    // The selection survives when its card does.
    useAnalyses.setState({ selected: keep });
    loadCards([card(keep)]);
    expect(a().selected).toBe(keep);
  });

  it('ignores display-only options when deciding whether a result is current', async () => {
    setData([1, 2, 3]);
    const id = addAnalysis('test-slow')!;
    const p = runCard(id);
    release!({ mean: 2, values: Float64Array.from([1, 2, 3]) });
    await p;
    expect(status(id)).toEqual({ state: 'current' });
    setOptions(id, { show: false, col: 'x' });
    expect(status(id)).toEqual({ state: 'current' });
    setOptions(id, { show: false, col: 'y' });
    expect(status(id)).toEqual({ state: 'stale', why: 'The options changed since this ran.' });
    // A run record whose options cannot be parsed: stale rather than a crash.
    useAnalyses.setState((s) => ({ cards: s.cards.map((c) => (c.id === id ? { ...c, run: { ...card(id).run!, options: '{bad' } } : c)) }));
    setOptions(id, { show: true, col: 'x' });
    expect(status(id).state).toBe('stale');
  });

  it('marks a model run of another version as earlier', () => {
    const st = useStore.getState();
    const ctx = currentCtx();
    const run = { at: 1, fingerprint: 'f', options: '{}', packed: 'AAAA' };
    const mk = (hash: string): AnalysisCard => ({ id: 'r', kind: 'analysis', type: 'run', options: { hash }, run });
    expect(cardStatus(mk('not-this'), ctx, false, true)).toEqual({ state: 'earlier' });
    expect(cardStatus(mk(runHash(st.model, st.settings, st.data)), ctx, false, true)).toEqual({ state: 'current' });
    expect(cardStatus({ ...mk('x'), run: { ...run, packed: undefined } }, ctx, false, false).state).toBe('missing');
  });
});
