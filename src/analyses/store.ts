// The analysis log: the cards on the Analyses tab (analyses, headings, notes),
// in the user's order. Cards and their packed results are saved with the
// project; unpacked results live here for the session.

import { create } from 'zustand';
import { cancelGroup, isCancelled, type CancelGroup } from '../cancellable';
import { resultsKey, useStore } from '../store';
import { packResult, unpackResult } from './codec';
import { analysisType } from './registry';
import type { AnalysisCard, AnalysisCtx, Card } from './types';

export const MAX_CARDS = 200;
export const MAX_TEXT = 5000;

interface AnalysesState {
  cards: Card[];
  selected: string | null;
  /** Unpacked results by card id (this session). */
  results: Record<string, unknown>;
  running: Record<string, true>;
  /** Why the last run of a card failed (its previous result, if any, stays). */
  errors: Record<string, string>;
  /** Cards whose stored result is being unpacked. */
  unpacking: Record<string, true>;
  /** Progress of running cards that report it. */
  progress: Record<string, { done: number; total: number }>;
}

export const useAnalyses = create<AnalysesState>(() => ({ cards: [], selected: null, results: {}, running: {}, errors: {}, unpacking: {}, progress: {} }));

const groups = new Map<string, CancelGroup>();
const newCardId = () => `card-${crypto.randomUUID()}`;
const readOnly = () => useStore.getState().cloud?.role === 'viewer';

/** The project as an analysis sees it. */
export function currentCtx(): AnalysisCtx {
  const s = useStore.getState();
  const fresh = s.results && s.results.key === resultsKey(s) ? s.results : null;
  return { data: s.data, info: s.dataInfo, settings: s.settings, pls: s.settings.method === 'pls' ? fresh?.pls ?? null : null, cb: s.settings.method === 'cbsem' ? fresh?.cb ?? null : null, projectName: s.projectName, model: s.model };
}

function edit(fn: (cards: Card[]) => Card[]) {
  if (readOnly()) return;
  useAnalyses.setState((s) => ({ cards: fn(s.cards) }));
}
const without = <T,>(o: Record<string, T>, id: string) => { const { [id]: _drop, ...rest } = o; return rest; };

/** Add an analysis card (options: all or some of its options) and select it. */
export function addAnalysis(type: string, options?: unknown): string | null {
  const t = analysisType(type);
  if (!t || readOnly() || useAnalyses.getState().cards.length >= MAX_CARDS) return null;
  const id = newCardId();
  // Given options (an example's preset) may be partial: fill in the defaults, and validate.
  const defaults = t.defaults(currentCtx());
  const opts = options === undefined ? defaults : t.parseOptions({ ...defaults, ...(options as object) }) ?? defaults;
  edit((cs) => [...cs, { id, kind: 'analysis', type, options: opts }]);
  useAnalyses.setState({ selected: id });
  return id;
}

export function addText(kind: 'heading' | 'note', text = ''): string | null {
  if (readOnly() || useAnalyses.getState().cards.length >= MAX_CARDS) return null;
  const id = newCardId();
  edit((cs) => [...cs, { id, kind, text: text.slice(0, MAX_TEXT) }]);
  useAnalyses.setState({ selected: id });
  return id;
}

export function setOptions(id: string, options: unknown) {
  edit((cs) => cs.map((c) => (c.id === id && c.kind === 'analysis' ? { ...c, options } : c)));
}

export function setText(id: string, text: string) {
  edit((cs) => cs.map((c) => (c.id === id && c.kind !== 'analysis' ? { ...c, text: text.slice(0, MAX_TEXT) } : c)));
}

export function duplicateCard(id: string): string | null {
  const s = useAnalyses.getState();
  const i = s.cards.findIndex((c) => c.id === id);
  if (i < 0 || readOnly() || s.cards.length >= MAX_CARDS) return null;
  const src = s.cards[i];
  const copy: Card = src.kind === 'analysis' ? { id: newCardId(), kind: 'analysis', type: src.type, options: src.options } : { ...src, id: newCardId() };
  edit((cs) => [...cs.slice(0, i + 1), copy, ...cs.slice(i + 1)]);
  useAnalyses.setState({ selected: copy.id });
  return copy.id;
}

export function removeCard(id: string) {
  if (readOnly()) return;
  groups.get(id)?.cancel();
  useAnalyses.setState((s) => ({
    cards: s.cards.filter((c) => c.id !== id), selected: s.selected === id ? null : s.selected,
    results: without(s.results, id), running: without(s.running, id), errors: without(s.errors, id),
  }));
}

/** Move a card before another (null: to the end). */
export function moveCard(id: string, before: string | null) {
  if (id === before) return;
  edit((cs) => {
    const card = cs.find((c) => c.id === id);
    if (!card) return cs;
    const rest = cs.filter((c) => c.id !== id);
    const at = before === null ? rest.length : rest.findIndex((c) => c.id === before);
    return at < 0 ? cs : [...rest.slice(0, at), card, ...rest.slice(at)];
  });
}

/** Move a card one place up or down (keyboard). */
export function nudgeCard(id: string, delta: -1 | 1) {
  edit((cs) => {
    const i = cs.findIndex((c) => c.id === id), j = i + delta;
    if (i < 0 || j < 0 || j >= cs.length) return cs;
    const next = [...cs];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
}

export const selectCard = (id: string | null) => useAnalyses.setState({ selected: id });

export async function runCard(id: string) {
  const card = useAnalyses.getState().cards.find((c): c is AnalysisCard => c.id === id && c.kind === 'analysis');
  const t = card && analysisType(card.type);
  if (!card || !t || readOnly() || useAnalyses.getState().running[id]) return;
  const ctx = currentCtx();
  const blocked = t.blocked(card.options, ctx);
  if (blocked) { useAnalyses.setState((s) => ({ errors: { ...s.errors, [id]: blocked } })); return; }
  // The inputs as they are now: if the data change during the run, the card shows stale.
  const fp = t.fingerprint(card.options, ctx) ?? '';
  const options = card.options;
  const group = cancelGroup();
  groups.set(id, group);
  useAnalyses.setState((s) => ({ running: { ...s.running, [id]: true }, errors: without(s.errors, id) }));
  try {
    const result = await group.guard(t.run(options, ctx, (done, total) => useAnalyses.setState((s) => ({ progress: { ...s.progress, [id]: { done, total } } }))));
    const packed = await packResult(result);
    if (packed === null) useStore.getState().toast('info', `${t.title}: the result is too large to save with the project; it is kept until you close it.`);
    useAnalyses.setState((s) => ({
      cards: s.cards.map((c) => (c.id === id && c.kind === 'analysis' ? { ...c, run: { at: Date.now(), fingerprint: fp, options: JSON.stringify(options), ...(packed ? { packed } : {}) } } : c)),
      results: { ...s.results, [id]: result },
    }));
  } catch (e) {
    if (!isCancelled(e)) {
      const { rMessage } = await import('../rengine/bridge');
      useAnalyses.setState((s) => ({ errors: { ...s.errors, [id]: rMessage(e) } }));
    }
  } finally {
    groups.delete(id);
    useAnalyses.setState((s) => ({ running: without(s.running, id), progress: without(s.progress, id) }));
  }
}

export function cancelCard(id: string) {
  const card = useAnalyses.getState().cards.find((c) => c.id === id);
  if (!groups.get(id)?.cancel()) return;
  if (card?.kind === 'analysis') analysisType(card.type)?.cancel?.();
  void import('../rengine/runtime').then((m) => m.interruptR());
  useStore.getState().toast('info', 'Calculation cancelled.');
}

/** Unpack a card's stored result into memory (once). */
export async function unpackCard(id: string) {
  const s = useAnalyses.getState();
  const card = s.cards.find((c): c is AnalysisCard => c.id === id && c.kind === 'analysis');
  const packed = card?.run?.packed;
  if (!packed || id in s.results || s.unpacking[id]) return;
  useAnalyses.setState((st) => ({ unpacking: { ...st.unpacking, [id]: true } }));
  try {
    const result = await unpackResult(packed);
    // Only if the card still holds that run.
    const now = useAnalyses.getState().cards.find((c) => c.id === id);
    if (now?.kind === 'analysis' && now.run?.packed === packed) useAnalyses.setState((st) => ({ results: { ...st.results, [id]: result } }));
  } catch (e) {
    useAnalyses.setState((st) => ({ errors: { ...st.errors, [id]: `The stored result could not be read (${e instanceof Error ? e.message : String(e)}). Run it again.` } }));
  } finally {
    useAnalyses.setState((st) => ({ unpacking: without(st.unpacking, id) }));
  }
}

/** Replace the log (opening a project, or a collaborator's change). Keeps results of runs that are unchanged. */
export function loadCards(cards: Card[]) {
  for (const [id, g] of groups) if (!cards.some((c) => c.id === id)) { g.cancel(); groups.delete(id); }
  useAnalyses.setState((s) => {
    const keep = (id: string) => {
      const before = s.cards.find((c) => c.id === id), after = cards.find((c) => c.id === id);
      return before?.kind === 'analysis' && after?.kind === 'analysis' && !!before.run && before.run.at === after.run?.at;
    };
    const results: Record<string, unknown> = {};
    for (const [id, r] of Object.entries(s.results)) if (keep(id)) results[id] = r;
    return {
      cards: cards.map((c) => {
        // A collaborator's copy of a run arrives without its result; keep ours.
        const before = s.cards.find((b) => b.id === c.id);
        return c.kind === 'analysis' && c.run && !c.run.packed && before?.kind === 'analysis' && before.run?.at === c.run.at && before.run.packed
          ? { ...c, run: { ...c.run, packed: before.run.packed } } : c;
      }),
      selected: cards.some((c) => c.id === s.selected) ? s.selected : null,
      results,
      errors: Object.fromEntries(Object.entries(s.errors).filter(([id]) => cards.some((c) => c.id === id))),
      running: Object.fromEntries(Object.entries(s.running).filter(([id]) => cards.some((c) => c.id === id))),
    };
  });
}

/** Whether options equal those of a run, ignoring options that only change the display. */
function sameOptions(t: { display?: string[] }, options: unknown, ran: string): boolean {
  if (!t.display?.length) return JSON.stringify(options) === ran;
  try {
    const strip = (o: unknown) => JSON.stringify(Object.fromEntries(Object.entries(o as object).filter(([k]) => !t.display!.includes(k))));
    return strip(options) === strip(JSON.parse(ran));
  } catch { return false; }
}

export type CardStatus =
  | { state: 'empty' }
  | { state: 'running' }
  | { state: 'current' }
  | { state: 'stale'; why: string }
  | { state: 'missing'; why: string };

/** Whether a card's result still matches its options and inputs. */
export function cardStatus(card: AnalysisCard, ctx: AnalysisCtx, running: boolean, hasResult: boolean): CardStatus {
  if (running) return { state: 'running' };
  if (!card.run) return { state: 'empty' };
  const t = analysisType(card.type);
  if (!t) return { state: 'stale', why: 'This kind of analysis is not available in this version.' };
  if (!hasResult && !card.run.packed) return { state: 'missing', why: 'The result is not stored here (shared projects keep results on each computer, and very large results are not saved). Run it again to see it.' };
  if (!sameOptions(t, card.options, card.run.options)) return { state: 'stale', why: 'The options changed since this ran.' };
  const fp = t.fingerprint(card.options, ctx);
  if (fp === null) return { state: 'stale', why: t.blocked(card.options, ctx) ?? 'Its inputs are not available now.' };
  if (fp !== card.run.fingerprint) return { state: 'stale', why: 'The data it used changed since this ran.' };
  return { state: 'current' };
}
