// The Dynamic fit cutoffs card seen from the CB-SEM Model fit tab: a link that opens (or focuses) the card for the
// model on the canvas, and the cutoffs of a card whose run is current for that model (the same check that marks a
// card out of date: its fingerprint against the model, settings and data now), to put beside the fixed cutoffs.

import { useEffect } from 'react';
import { fmt } from '../format';
import type { DfiResult } from '../rengine/dfi';
import { useStore } from '../store';
import { setDfiFitSlot } from '../components/results/dfiSlot';
import { DFI_CARD_ID, DFI_TITLE, dfiCutoffText, dfiVerdicts, type DfiIndex, type DfiVerdict } from './dfi';
import { addAnalysis, cardStatus, currentCtx, selectCard, unpackCard, useAnalyses } from './store';
import type { AnalysisCard, AnalysisCtx } from './types';

export interface DfiForFit { card: AnalysisCard; result: DfiResult; verdicts: DfiVerdict[] }

/** The Dynamic fit cutoffs card with a current run for this model, its result unpacked; the latest when several. */
export function dfiForFit(ctx: AnalysisCtx, cards: readonly { id: string }[], results: Record<string, unknown>, running: Record<string, true>): { card: AnalysisCard; result: DfiResult | null } | null {
  const current = cards
    .filter((k): k is AnalysisCard => (k as AnalysisCard).kind === 'analysis' && (k as AnalysisCard).type === DFI_CARD_ID && !!(k as AnalysisCard).run)
    .filter((k) => cardStatus(k, ctx, !!running[k.id], k.id in results).state === 'current')
    .sort((a, b) => (b.run?.at ?? 0) - (a.run?.at ?? 0));
  const card = current.find((k) => k.id in results) ?? current[0];
  return card ? { card, result: (results[card.id] as DfiResult | undefined) ?? null } : null;
}

export function useDfiForFit(): DfiForFit | null {
  const cards = useAnalyses((s) => s.cards), results = useAnalyses((s) => s.results), running = useAnalyses((s) => s.running);
  // (subscribed so that a model, settings or data change re-evaluates the fingerprint)
  useStore((s) => s.model); useStore((s) => s.settings); useStore((s) => s.data);
  const found = dfiForFit(currentCtx(), cards, results, running);
  const pending = found && !found.result ? found.card.id : null;
  useEffect(() => { if (pending) void unpackCard(pending); }, [pending]);
  return found?.result ? { card: found.card, result: found.result, verdicts: dfiVerdicts(found.result) } : null;
}

/** Open the Analyses tab on the Dynamic fit cutoffs card: the existing one, or a new card preset for the model on the canvas. */
export function openDfiCard() {
  const existing = useAnalyses.getState().cards.find((k): k is AnalysisCard => k.kind === 'analysis' && k.type === DFI_CARD_ID);
  if (existing) selectCard(existing.id); else addAnalysis(DFI_CARD_ID);
  useStore.getState().setWorkspace('analyses');
}

/** The verdict of one fit index for the fit table's extra column (null when the run has none for it). */
export function dfiFitCell(d: DfiForFit, index: DfiIndex): { text: string; verdict: string; ok: boolean | null } | null {
  const v = d.verdicts.find((x) => x.index === index);
  return v ? { text: dfiCutoffText(v), verdict: v.short ?? v.verdict, ok: v.ok } : null;
}

export const dfiFitNote = (d: DfiForFit) => `Dynamic fit index cutoffs from the card “${d.card.title ?? DFI_TITLE}” (dynamic::${d.result.fn}${d.result.reps ? `, ${d.result.reps} replications` : ''}, run ${new Date(d.card.run!.at).toLocaleString()}): the levels an index clears, by the package’s tables. They are shown while that run is current for the model on the canvas and disappear when the model, its settings or the data change. Hu & Bentler’s fixed cutoffs: CFI/TLI ≥ 0.95, RMSEA ≤ 0.06, SRMR ≤ 0.08.`;

export const dfiCompact = (cell: { text: string; verdict: string } | null, value?: number) => (cell ? `${cell.text} — ${cell.verdict}${value !== undefined ? ` (${fmt(value, 3)})` : ''}` : '');

// The fit tab reads these through a slot (components/results/dfiSlot.ts), which breaks an import cycle with the registry.
setDfiFitSlot({ use: useDfiForFit, cell: dfiFitCell, note: dfiFitNote, open: openDfiCard });
