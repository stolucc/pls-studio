// Post hoc modifications of a CB-SEM model, kept with the project (ModelState.modifications): parameters
// freed from the Diagnose misfit panel, and paths deleted that were not significant in the last result.
// They are listed in the reporting checklist as changes made after seeing the data, and successive
// deletions of non-significant paths raise a gentle warning (MacCallum, Roznowski & Necowitz 1992).

import type { CbResult } from '../engine/cbsem';
import type { MisfitMi, SarisDecision } from '../rengine/misfit';
import { newId, type Correlation, type ModelState, type Path } from './project';

export interface PostHocModification {
  id: string;
  /** 'free': a fixed parameter freed from the Diagnose misfit panel; 'remove': a path deleted. */
  kind: 'free' | 'remove';
  /** The parameter in lavaan's terms, by the app's names (constructs and indicators). */
  lhs: string;
  op: '=~' | '~' | '~~';
  rhs: string;
  /** The group whose modification index suggested it (several groups). */
  group?: string;
  /** When (milliseconds since 1970). */
  at: number;
  /** Freed: its modification index, standardised expected change and the decision rule's verdict. */
  mi?: number;
  sepc?: number;
  decision?: SarisDecision;
  /** Removed: its p-value in the last result. */
  p?: number;
}

/** At most this many entries are kept (the oldest dropped). */
export const MAX_MODIFICATIONS = 500;
const OPS = ['=~', '~', '~~'] as const;
const DECISIONS: readonly SarisDecision[] = ['M', 'EPC:M', 'EPC:NM', 'NM', 'I'];

function bad(what: string): never {
  throw new Error(`Invalid project file: ${what}`);
}

function shortText(v: unknown, max: number, what: string): string {
  if (typeof v !== 'string' || v.length === 0 || v.length > max) bad(what);
  return v;
}

function optionalNumber(v: unknown, lo: number, hi: number, what: string): number | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) bad(what);
  return v;
}

/**
 * The modification log of a project file (untrusted): absent stays absent; anything that is not a list of
 * well-formed entries makes the file invalid.
 */
export function parseModifications(raw: unknown): PostHocModification[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) bad('the post hoc modifications must be a list.');
  if (raw.length > MAX_MODIFICATIONS) bad('too many post hoc modifications.');
  return raw.map((e: unknown): PostHocModification => {
    if (typeof e !== 'object' || e === null || Array.isArray(e)) {
      bad('a post hoc modification is not an object.');
    }
    const x = e as Record<string, unknown>;
    if (x.kind !== 'free' && x.kind !== 'remove')
      bad('a post hoc modification has an unknown kind.');
    const op = OPS.find((o) => o === x.op);
    if (!op) bad('a post hoc modification has an unknown operator.');
    const at = optionalNumber(x.at, 0, 1e15, 'a post hoc modification has an invalid time.');
    if (at === undefined) bad('a post hoc modification has no time.');
    if (x.decision !== undefined && !DECISIONS.includes(x.decision as SarisDecision)) {
      bad('a post hoc modification has an unknown decision.');
    }
    const mi = optionalNumber(x.mi, 0, 1e12, 'a post hoc modification has an invalid MI.');
    const sepc = optionalNumber(x.sepc, -1e6, 1e6, 'a post hoc modification has an invalid SEPC.');
    const p = optionalNumber(x.p, 0, 1, 'a post hoc modification has an invalid p-value.');
    const group =
      x.group === undefined
        ? undefined
        : shortText(x.group, 200, 'a post hoc modification has an invalid group.');
    return {
      id: shortText(x.id, 64, 'a post hoc modification has an invalid id.'),
      kind: x.kind,
      lhs: shortText(x.lhs, 200, 'a post hoc modification has an invalid parameter.'),
      op,
      rhs: shortText(x.rhs, 200, 'a post hoc modification has an invalid parameter.'),
      ...(group !== undefined ? { group } : {}),
      at,
      ...(mi !== undefined ? { mi } : {}),
      ...(sepc !== undefined ? { sepc } : {}),
      ...(x.decision !== undefined ? { decision: x.decision as SarisDecision } : {}),
      ...(p !== undefined ? { p } : {}),
    };
  });
}

/** The log with `entries` appended (the oldest dropped beyond MAX_MODIFICATIONS); absent when empty. */
export function appendModifications(
  log: readonly PostHocModification[] | undefined,
  entries: readonly PostHocModification[],
): Pick<ModelState, 'modifications'> {
  const all = [...(log ?? []), ...entries].slice(-MAX_MODIFICATIONS);
  return all.length ? { modifications: all } : {};
}

// ---------- freeing a parameter ----------

/**
 * The model with the parameter of a modification index freed, and its log entry; null when the canvas has no
 * way to draw it (e.g. a path from a construct to an indicator of another kind of block):
 *   x ~~ y between indicators: a residual covariance; between constructs: a (disturbance) covariance;
 *   F =~ x: x becomes an indicator of F as well (a cross-loading);
 *   F ~ G: a path G → F.
 * With several groups the parameter is freed in every group.
 */
export function freeParameter(
  model: ModelState,
  m: Pick<MisfitMi, 'lhs' | 'op' | 'rhs' | 'mi' | 'sepc' | 'group'>,
  decision: SarisDecision | null,
  at: number,
): ModelState | null {
  const byName = new Map(model.constructs.map((c) => [c.name, c]));
  const indicators = new Set(model.constructs.flatMap((c) => c.indicators));
  const changed = applyFree(model, m, byName, indicators);
  if (!changed) return null;
  const entry: PostHocModification = {
    id: newId('h'),
    kind: 'free',
    lhs: m.lhs,
    op: m.op,
    rhs: m.rhs,
    ...(m.group ? { group: m.group } : {}),
    at,
    mi: m.mi,
    sepc: m.sepc,
    ...(decision ? { decision } : {}),
  };
  return { ...changed, ...appendModifications(model.modifications, [entry]) };
}

function applyFree(
  model: ModelState,
  m: Pick<MisfitMi, 'lhs' | 'op' | 'rhs'>,
  byName: Map<string, ModelState['constructs'][number]>,
  indicators: Set<string>,
): ModelState | null {
  if (m.op === '~~') {
    let kind: Correlation['kind'] | null = null;
    let a = m.lhs;
    let b = m.rhs;
    if (indicators.has(a) && indicators.has(b) && !byName.has(a) && !byName.has(b)) {
      kind = 'indicator';
    } else if (byName.has(a) && byName.has(b)) {
      kind = 'construct';
      a = byName.get(a)!.id;
      b = byName.get(b)!.id;
    }
    if (!kind || a === b) return null;
    const correlations = model.correlations ?? [];
    const same = (k: Correlation) =>
      k.kind === kind && ((k.a === a && k.b === b) || (k.a === b && k.b === a));
    // (a covariance held at zero is replaced by a free one)
    const kept = correlations.filter((k) => !(same(k) && (k.zero || k.fixed !== undefined)));
    if (kept.some(same)) return null;
    const added: Correlation = { id: newId('k'), kind, a, b };
    return { ...model, correlations: [...kept, added] };
  }
  if (m.op === '=~') {
    const factor = byName.get(m.lhs);
    if (!factor || factor.type !== 'factor' || !indicators.has(m.rhs) || byName.has(m.rhs)) {
      return null;
    }
    if (factor.indicators.includes(m.rhs)) return null;
    return {
      ...model,
      constructs: model.constructs.map((c) =>
        c.id === factor.id ? { ...c, indicators: [...c.indicators, m.rhs] } : c,
      ),
    };
  }
  // m.op === '~': lhs regressed on rhs
  const to = byName.get(m.lhs);
  const from = byName.get(m.rhs);
  if (!to || !from || to.id === from.id) return null;
  if (model.paths.some((p) => p.from === from.id && p.to === to.id)) return null;
  const path: Path = { id: newId('p'), from: from.id, to: to.id };
  return { ...model, paths: [...model.paths, path] };
}

// ---------- removing paths ----------

/** p below this counts as significant (the conventional α). */
const ALPHA = 0.05;

/**
 * Log entries for the paths about to be deleted (`pathIds`, of `model`): each path whose p-value the last
 * CB-SEM result `cb` reports (by its constructs' names), with that p.
 */
export function removalEntries(
  model: ModelState,
  pathIds: readonly string[],
  cb: Pick<CbResult, 'estimates'> | null | undefined,
  at: number,
): PostHocModification[] {
  if (!cb || !pathIds.length) return [];
  const name = new Map(model.constructs.map((c) => [c.id, c.name]));
  const out: PostHocModification[] = [];
  for (const path of model.paths) {
    if (!pathIds.includes(path.id)) continue;
    const to = name.get(path.to);
    const from = name.get(path.from);
    if (!to || !from) continue;
    const est = cb.estimates.find((e) => e.op === '~' && e.lhs === to && e.rhs === from);
    if (!est || est.p === null || !Number.isFinite(est.p)) continue;
    out.push({ id: newId('h'), kind: 'remove', lhs: to, op: '~', rhs: from, at, p: est.p });
  }
  return out;
}

/**
 * How many paths the user has deleted in a row that were not significant in the result before: the trailing
 * run of 'remove' entries with p ≥ .05. Freeing a parameter, or deleting a significant path, ends a run.
 */
export function removalStreak(log: readonly PostHocModification[] | undefined): number {
  let n = 0;
  for (let i = (log?.length ?? 0) - 1; i >= 0; i--) {
    const e = log![i];
    if (e.kind !== 'remove' || e.p === undefined || e.p < ALPHA) break;
    n++;
  }
  return n;
}

/** From this many successive deletions of non-significant paths on, the app warns. */
export const STREAK_WARNING = 2;

/** The warning for a run of deletions of non-significant paths, or null below STREAK_WARNING. */
export function removalWarning(log: readonly PostHocModification[] | undefined): string | null {
  const n = removalStreak(log);
  if (n < STREAK_WARNING) return null;
  return (
    `You have deleted ${n} non-significant paths one after another. ` +
    'Trimming a model by p-values capitalises on chance: the final model fits this sample better than it ' +
    'will fit the next one, and its p-values and fit are too optimistic (MacCallum, Roznowski & Necowitz 1992). ' +
    'Keep paths your theory predicts, report every deletion as a post hoc change, and confirm the trimmed model ' +
    'on new data or a holdout sample.'
  );
}

/** One entry in words, for the checklist and the panel. */
export function describeModification(e: PostHocModification): string {
  const group = e.group ? ` (suggested in group ${e.group})` : '';
  if (e.kind === 'remove') {
    const p =
      e.p === undefined ? '' : `, p = ${e.p < 0.001 ? '< .001' : e.p.toFixed(3).replace(/^0/, '')}`;
    return `Deleted the path ${e.rhs} → ${e.lhs}${p}`;
  }
  const stats =
    e.mi !== undefined && e.sepc !== undefined
      ? ` (MI = ${e.mi.toFixed(2)}, SEPC = ${e.sepc.toFixed(2)})`
      : '';
  if (e.op === '~~') return `Freed the covariance ${e.lhs} ↔ ${e.rhs}${stats}${group}`;
  if (e.op === '=~') return `Freed the cross-loading ${e.lhs} → ${e.rhs}${stats}${group}`;
  return `Added the path ${e.rhs} → ${e.lhs}${stats}${group}`;
}
