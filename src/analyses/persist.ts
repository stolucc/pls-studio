// Cards in project files and shared projects: written as they are, read back
// through the same validation as any untrusted input.

import type { McDesign } from '../engine/montecarlo';
import { MAX_PACKED } from './codec';
import { analysisType } from './registry';
import { MAX_CARDS, MAX_TEXT, MAX_TITLE } from './store';
import type { Card, CardRun } from './types';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const ID = /^card-[A-Za-z0-9-]{1,64}$/;

function parseRun(r: unknown): CardRun | undefined {
  if (!isObj(r) || typeof r.at !== 'number' || !Number.isFinite(r.at) || typeof r.fingerprint !== 'string' || typeof r.options !== 'string') return undefined;
  if (r.fingerprint.length > 200 || r.options.length > 100_000) return undefined;
  const packed = typeof r.packed === 'string' && r.packed.length <= MAX_PACKED ? r.packed : undefined;
  return { at: r.at, fingerprint: r.fingerprint, options: r.options, ...(packed ? { packed } : {}) };
}

/** Validate cards from a project file or a collaborator. Unknown analysis kinds and malformed cards are dropped. */
export function parseCards(raw: unknown): Card[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Card[] = [];
  for (const c of raw.slice(0, MAX_CARDS)) {
    if (!isObj(c) || typeof c.id !== 'string' || !ID.test(c.id) || seen.has(c.id)) continue;
    if (c.kind === 'heading' || c.kind === 'note') {
      out.push({ id: c.id, kind: c.kind, text: typeof c.text === 'string' ? c.text.slice(0, MAX_TEXT) : '' });
    } else if (c.kind === 'analysis' && typeof c.type === 'string') {
      const t = analysisType(c.type);
      const options = t?.parseOptions(c.options);
      if (!t || !options) continue;
      const run = parseRun(c.run);
      const title = typeof c.title === 'string' ? c.title.replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE) : '';
      out.push({ id: c.id, kind: 'analysis', type: t.id, options, ...(run ? { run } : {}), ...(title ? { title } : {}) });
    } else continue;
    seen.add(c.id);
  }
  return out;
}

/** Cards for a shared project: results stay on each computer (the shared document is not encrypted at rest, results can hold raw data). */
/**
 * Projects from before the Analyses tab kept one simulation design beside the
 * model: it becomes a Monte Carlo card (a fixed id, so two collaborators
 * converting the same project make the same card).
 */
export function withLegacySimulation(cards: Card[], design: McDesign | null): Card[] {
  if (!design || cards.some((c) => c.kind === 'analysis' && c.type === 'mc') || cards.length >= MAX_CARDS) return cards;
  return [...cards, { id: 'card-legacy-simulation', kind: 'analysis', type: 'mc', options: design }];
}

export const shareableCards = (cards: Card[]): Card[] =>
  cards.map((c) => (c.kind === 'analysis' && c.run?.packed ? { ...c, run: { at: c.run.at, fingerprint: c.run.fingerprint, options: c.run.options } } : c));
