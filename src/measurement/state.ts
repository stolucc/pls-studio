// What the measurement-quality helpers keep in the project (ModelState.measurement): the
// construct pairs the author marked as conceptually similar (their HTMT threshold is 0.90
// instead of 0.85; Henseler, Ringle & Sarstedt 2015), and the log of indicators deleted from
// the loading triage, which the methods text and the reviewer checklist report. Project files
// are untrusted: parseMeasurement keeps only well-formed entries.

import { isObj } from '../parse';

/** A construct's reliability and convergent validity, as the triage records them. */
export interface QualitySnapshot {
  ave: number;
  rhoA: number;
  rhoC: number;
}

/** One indicator deleted from the loading triage. */
export interface DeletedItem {
  indicator: string;
  /** The construct's name when the indicator was deleted. */
  construct: string;
  loading: number;
  /** Why (written by the app from the triage rule that applied). */
  reason: string;
  /** The author's note, e.g. on content validity. */
  note?: string;
  /** The construct before the deletion. */
  before: QualitySnapshot;
  /** The construct re-estimated without the indicator (absent when it was not re-estimated). */
  after?: QualitySnapshot;
}

export interface MeasurementLog {
  /** Construct id pairs (sorted) marked as conceptually similar. */
  similarPairs?: [string, string][];
  deletedItems?: DeletedItem[];
}

const MAX_PAIRS = 2000;
const MAX_DELETED = 1000;
/** Loadings, AVE and reliabilities are near the unit interval; anything far outside is not ours. */
const LIMIT = 10;

const finite = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= LIMIT;

/** A short text field, or null when it is not a non-empty string. */
function text(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim().slice(0, max);
  return t ? t : null;
}

/** The sorted key of a construct pair. */
export function pairOf(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

function parseSnapshot(raw: unknown): QualitySnapshot | null {
  if (!isObj(raw)) return null;
  if (!finite(raw.ave) || !finite(raw.rhoA) || !finite(raw.rhoC)) return null;
  return { ave: raw.ave, rhoA: raw.rhoA, rhoC: raw.rhoC };
}

function parseDeleted(raw: unknown): DeletedItem | null {
  if (!isObj(raw)) return null;
  const indicator = text(raw.indicator, 200);
  const construct = text(raw.construct, 100);
  const reason = text(raw.reason, 500);
  const before = parseSnapshot(raw.before);
  if (!indicator || !construct || !reason || !before || !finite(raw.loading)) return null;
  const note = text(raw.note, 1000);
  const after = raw.after === undefined ? null : parseSnapshot(raw.after);
  if (raw.after !== undefined && !after) return null;
  return {
    indicator,
    construct,
    loading: raw.loading,
    reason,
    ...(note ? { note } : {}),
    before,
    ...(after ? { after } : {}),
  };
}

function parsePairs(raw: unknown, ids: Set<string>): [string, string][] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: [string, string][] = [];
  for (const p of raw.slice(0, MAX_PAIRS)) {
    if (!Array.isArray(p) || p.length !== 2) continue;
    const [a, b] = p;
    if (typeof a !== 'string' || typeof b !== 'string' || a === b) continue;
    if (!ids.has(a) || !ids.has(b)) continue;
    const pair = pairOf(a, b);
    const key = pair.join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(pair);
  }
  return out;
}

/**
 * Parse and strictly validate a file's `measurement` field: pairs of existing construct ids,
 * deleted-item entries with every number finite. Returns `{}` when nothing valid is left, so
 * it spreads into a parsed model without adding an empty field.
 */
export function parseMeasurement(raw: unknown, ids: Set<string>): { measurement?: MeasurementLog } {
  if (!isObj(raw)) return {};
  const similarPairs = parsePairs(raw.similarPairs, ids);
  const deletedItems = Array.isArray(raw.deletedItems)
    ? raw.deletedItems
        .slice(0, MAX_DELETED)
        .map(parseDeleted)
        .filter((d): d is DeletedItem => d !== null)
    : [];
  if (!similarPairs.length && !deletedItems.length) return {};
  return {
    measurement: {
      ...(similarPairs.length ? { similarPairs } : {}),
      ...(deletedItems.length ? { deletedItems } : {}),
    },
  };
}

/** Whether the author marked the two constructs (by id) as conceptually similar. */
export function isSimilarPair(log: MeasurementLog | undefined, a: string, b: string): boolean {
  const [x, y] = pairOf(a, b);
  return !!log?.similarPairs?.some((p) => p[0] === x && p[1] === y);
}

/** The log with the pair marked (or unmarked) as conceptually similar. */
export function withSimilarPair(
  log: MeasurementLog | undefined,
  a: string,
  b: string,
  similar: boolean,
): MeasurementLog | undefined {
  const [x, y] = pairOf(a, b);
  const rest = (log?.similarPairs ?? []).filter((p) => !(p[0] === x && p[1] === y));
  const similarPairs: [string, string][] = similar ? [...rest, [x, y]] : rest;
  return compact({ ...log, similarPairs });
}

/** The log with a deleted item appended. */
export function withDeletedItem(
  log: MeasurementLog | undefined,
  item: DeletedItem,
): MeasurementLog | undefined {
  return compact({ ...log, deletedItems: [...(log?.deletedItems ?? []), item] });
}

/** The log with the entry at `index` removed (the author restored the indicator by hand). */
export function withoutDeletedItem(
  log: MeasurementLog | undefined,
  index: number,
): MeasurementLog | undefined {
  const deletedItems = (log?.deletedItems ?? []).filter((_, i) => i !== index);
  return compact({ ...log, deletedItems });
}

/** Empty lists dropped; undefined when nothing is left. */
function compact(log: MeasurementLog): MeasurementLog | undefined {
  const out: MeasurementLog = {};
  if (log.similarPairs?.length) out.similarPairs = log.similarPairs;
  if (log.deletedItems?.length) out.deletedItems = log.deletedItems;
  return out.similarPairs || out.deletedItems ? out : undefined;
}
