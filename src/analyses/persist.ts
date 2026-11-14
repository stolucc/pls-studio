// Cards in project files and shared projects: written as they are, read back
// through the same validation as any untrusted input.

import type { McDesign } from '../engine/montecarlo';
import type { Dataset } from '../engine/types';
import { FORMAT_VERSION, migrateGroupValues } from '../model/project';
import { isObj } from '../parse';
import type { CompareModelsOptions } from './cbDiag';
import { MAX_PACKED } from './codec';
import { analysisType } from './registry';
import { dataFingerprint, runHash, type RunOptions } from './runHash';
import { MAX_CARDS, MAX_TEXT, MAX_TITLE } from './store';
import type { Card, CardRun } from './types';

/** Where cards come from: the format of their container and the data that came with it. */
export interface CardOrigin {
  version: number;
  data: Dataset | null;
}
const CURRENT: CardOrigin = { version: FORMAT_VERSION, data: null };

const ID = /^card-[A-Za-z0-9-]{1,64}$/;

function parseRun(r: unknown): CardRun | undefined {
  if (
    !isObj(r) ||
    typeof r.at !== 'number' ||
    !Number.isFinite(r.at) ||
    typeof r.fingerprint !== 'string' ||
    typeof r.options !== 'string'
  )
    return undefined;
  if (r.fingerprint.length > 200 || r.options.length > 100_000) return undefined;
  const packed =
    typeof r.packed === 'string' && r.packed.length <= MAX_PACKED ? r.packed : undefined;
  return {
    at: r.at,
    fingerprint: r.fingerprint,
    options: r.options,
    ...(packed ? { packed } : {}),
  };
}

/**
 * A model-run card's model, from a container of an older format, with its values per group in the
 * order of the group codes (model/project.ts migrateGroupValues, as the project's own model). Only
 * the data the run used can convert them: with other data the model stays marked (lavaan's order).
 * The version's id (hash) is that of the migrated model, so the migrated project model still finds
 * its version in the log.
 */
function migrateRun(o: RunOptions, origin: CardOrigin): RunOptions {
  const own = origin.data && dataFingerprint(origin.data) === o.data.fingerprint;
  const model = migrateGroupValues(o.model, origin.version, own ? origin.data : null);
  if (model === o.model) return o;
  return { ...o, model, hash: runHash(model, o.settings, o.data) };
}

/** The model comparison's saved alternative: it is fitted to the project's data. */
function migrateAlternative(o: CompareModelsOptions, origin: CardOrigin): CompareModelsOptions {
  if (!o.alternative) return o;
  const model = migrateGroupValues(o.alternative.model, origin.version, origin.data);
  if (model === o.alternative.model) return o;
  return { ...o, alternative: { ...o.alternative, model } };
}

/** The models kept in cards (model runs, a comparison's alternative), migrated like the project's model. */
function migrateOptions(type: string, options: unknown, origin: CardOrigin): unknown {
  if (type === 'run') return migrateRun(options as RunOptions, origin);
  if (type === 'cbmodels') return migrateAlternative(options as CompareModelsOptions, origin);
  return options;
}

/**
 * Validate cards from a project file or a collaborator. Unknown analysis kinds and malformed cards are dropped.
 * `origin`: the container's format and data, for the models kept in cards (default: the current format).
 */
export function parseCards(raw: unknown, origin: CardOrigin = CURRENT): Card[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Card[] = [];
  for (const c of raw.slice(0, MAX_CARDS)) {
    if (!isObj(c) || typeof c.id !== 'string' || !ID.test(c.id) || seen.has(c.id)) continue;
    if (c.kind === 'heading' || c.kind === 'note') {
      out.push({
        id: c.id,
        kind: c.kind,
        text: typeof c.text === 'string' ? c.text.slice(0, MAX_TEXT) : '',
      });
    } else if (c.kind === 'analysis' && typeof c.type === 'string') {
      const t = analysisType(c.type);
      const parsed = t?.parseOptions(c.options);
      if (!t || !parsed) continue;
      const options = migrateOptions(t.id, parsed, origin);
      const run = parseRun(c.run);
      const title =
        typeof c.title === 'string' ? c.title.replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE) : '';
      out.push({
        id: c.id,
        kind: 'analysis',
        type: t.id,
        options,
        ...(run ? { run } : {}),
        ...(title ? { title } : {}),
      });
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
  if (
    !design ||
    cards.some((c) => c.kind === 'analysis' && c.type === 'mc') ||
    cards.length >= MAX_CARDS
  )
    return cards;
  return [
    ...cards,
    { id: 'card-legacy-simulation', kind: 'analysis', type: 'mc', options: design },
  ];
}

export const shareableCards = (cards: Card[]): Card[] =>
  cards.map((c) =>
    c.kind === 'analysis' && c.run?.packed
      ? { ...c, run: { at: c.run.at, fingerprint: c.run.fingerprint, options: c.run.options } }
      : c,
  );
