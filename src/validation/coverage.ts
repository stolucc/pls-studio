// What the Validation page's "Analyses" tab lists: every entry of the evidence manifest (cards.ts), with the checks of
// the record (public/validation.json) that are its evidence, and the references the record does not have yet (a test
// written since the record was last regenerated, or a desktop-only package's run not recorded).

import { CARD_EVIDENCE, entryNames, evidenceClass, featureMatches, type CardEvidence, type EvidenceClass } from './cards';
import type { Check, Evidence } from './types';

export interface CoverageRow {
  key: string;
  /** The card's id (`model` / `builtin` for the Model tab and the built-in engine). */
  card: string;
  /** A mode of a card (`card:…`). */
  mode: boolean;
  group: 'cards' | 'model' | 'builtin';
  title: string;
  entry: CardEvidence;
  cls: EvidenceClass;
  /** The record's checks that are this entry's evidence. */
  checks: Check[];
  /** The entry's examples and validated tests that have no check in the record. */
  pending: string[];
}

/** Whether a check is evidence for a manifest entry: it names the entry, or the entry names it. */
export function checkIsFor(key: string, entry: CardEvidence, c: Check): boolean {
  return !!c.cards?.includes(key) || entryNames(entry, c.subject, c.id);
}

/** Every manifest entry in registry order (`order`: the cards' ids), its checks and what the record lacks. */
export function coverage(e: Evidence | null, order: string[], titleOf: (card: string) => string | undefined): CoverageRow[] {
  const rank = (k: string) => { const card = k.split(':')[0]; const i = order.indexOf(card); return i < 0 ? order.length + (card === 'model' ? 0 : 1) : i; };
  // (a stable sort: registry order, the manifest's order within a card)
  return Object.keys(CARD_EVIDENCE).sort((a, b) => rank(a) - rank(b)).map((key) => {
    const entry = CARD_EVIDENCE[key];
    const card = key.split(':')[0];
    const group = card === 'model' ? 'model' : card === 'builtin' ? 'builtin' : 'cards';
    const checks = e?.checks.filter((c) => checkIsFor(key, entry, c)) ?? [];
    const pending = [
      ...(entry.examples ?? []).filter((id) => !checks.some((c) => c.subject === 'example' && c.id === id)),
      ...(entry.features ?? []).filter((f) => !checks.some((c) => c.subject === 'feature' && featureMatches(f, c.id))),
    ];
    return { key, card, mode: group === 'cards' && key !== card, group, title: entry.title ?? titleOf(card) ?? key, entry, cls: evidenceClass(entry), checks, pending };
  });
}
