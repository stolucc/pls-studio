// Mediation typology (Zhao, Lynch & Chen, 2010), as adopted for PLS-SEM by Nitzl, Roldán & Cepeda (2016)
// and Hair et al. (2021, ch. 7). Every indirect effect is classified by two tests and one sign comparison:
//
//   1. Is the indirect effect a×b significant?  2. Is the direct effect c' significant?
//   3. If both are: do a×b and c' have the same sign?
//
//   a×b yes, c' yes, same sign      complementary (partial) mediation
//   a×b yes, c' yes, opposite sign  competitive (partial) mediation
//   a×b yes, c' no                  indirect-only (full) mediation
//   a×b no,  c' yes                 direct-only (no mediation)
//   a×b no,  c' no                  no effect (no mediation)
//
// Significance is read off the confidence interval the user chose (bootstrap percentile, BCa, ...): an
// interval that excludes zero. Bootstrap p-values are approximate (seminr and cSEM maintainers), so they
// are not used. An interval with a bound exactly at zero does not exclude it.
//
// Pure functions: the results tabs, the reporting checklist and the methods text all call these.

import type { BootstrapResult, BootstrapStat } from '../engine/types';

/** The five types of Zhao et al. (2010). */
export type MediationType =
  | 'complementary'
  | 'competitive'
  | 'indirect-only'
  | 'direct-only'
  | 'no-effect';

/** An estimate with its confidence interval. */
export interface Interval {
  est: number;
  lo: number;
  hi: number;
}

/** The classification of one indirect effect against the direct effect of the same X → Y pair. */
export interface MediationClass {
  type: MediationType;
  indirectSignificant: boolean;
  /** False when the model has no direct path X → Y: the direct effect is fixed at zero, not tested. */
  directTested: boolean;
  directSignificant: boolean;
}

/** Short names, as the results tables show them. */
export const MEDIATION_LABEL: Record<MediationType, string> = {
  complementary: 'Complementary (partial) mediation',
  competitive: 'Competitive (partial) mediation',
  'indirect-only': 'Indirect-only (full) mediation',
  'direct-only': 'Direct-only (no mediation)',
  'no-effect': 'No effect (no mediation)',
};

/** One line on what each type means, for the explanation. */
export const MEDIATION_MEANING: Record<MediationType, string> = {
  complementary:
    'The indirect and the direct effect are both significant and point the same way. The mediator explains part of the effect.',
  competitive:
    'The indirect and the direct effect are both significant but point in opposite directions. The mediator explains part of the effect, and another mediator may be missing (Zhao et al., 2010).',
  'indirect-only': 'Only the indirect effect is significant. The effect runs through the mediator.',
  'direct-only':
    'Only the direct effect is significant. The mediator does not carry the effect, and another mediator may be missing (Zhao et al., 2010).',
  'no-effect': 'Neither the indirect nor the direct effect is significant.',
};

/** True when the interval excludes zero (a bound exactly at zero does not; NaN never does). */
export function excludesZero(e: Interval): boolean {
  return e.lo > 0 || e.hi < 0;
}

/**
 * Classify one indirect effect (Zhao et al., 2010). `direct` is null when the model has no direct path
 * X → Y: then the direct effect counts as not significant, and directTested is false.
 */
export function classifyMediation(indirect: Interval, direct: Interval | null): MediationClass {
  const indirectSignificant = excludesZero(indirect);
  const directSignificant = direct !== null && excludesZero(direct);
  let type: MediationType;
  if (indirectSignificant && directSignificant) {
    // Both intervals exclude zero, so the signs of the estimates are the signs of the effects.
    const sameSign = Math.sign(indirect.est) === Math.sign(direct!.est);
    type = sameSign ? 'complementary' : 'competitive';
  } else if (indirectSignificant) {
    type = 'indirect-only';
  } else if (directSignificant) {
    type = 'direct-only';
  } else {
    type = 'no-effect';
  }
  return { type, indirectSignificant, directTested: direct !== null, directSignificant };
}

/** One indirect effect: a specific one (one chain of mediators) or the total over all chains. */
export interface MediationEffect {
  kind: 'specific' | 'total';
  /** The chain X, M1, (M2, ...), Y; for the total, just [X, Y]. */
  path: string[];
  indirect: Interval;
  cls: MediationClass;
}

/** Everything about one X → Y pair that has at least one indirect effect. */
export interface MediationPair {
  from: string;
  to: string;
  /** null: no direct path X → Y in the model. */
  direct: Interval | null;
  specific: MediationEffect[];
  total: MediationEffect | null;
  /** Significant specific indirect effects with opposite signs (inconsistent mediation). */
  opposingSpecific: boolean;
  /** Specific indirect effects that are significant, out of specific.length. */
  significantSpecific: number;
  /** The total indirect effect is not significant although a specific one is: they cancel out. */
  totalHidesSpecific: boolean;
}

const statInterval = (s: BootstrapStat): Interval => ({
  est: s.original,
  lo: s.ciLow,
  hi: s.ciHigh,
});

/**
 * Split "X:M:Y" (a specific effect's key without "specific:") into construct names. Names can
 * contain ':' (an interaction term), so the split follows the model's names.
 */
export function splitChain(rest: string, names: string[]): string[] | null {
  if (rest === '') return [];
  // Longer names first, so "X:Z" is preferred over "X" when both exist.
  const sorted = [...names].sort((a, b) => b.length - a.length);
  for (const name of sorted) {
    if (rest === name) return [name];
    if (rest.startsWith(`${name}:`)) {
      const tail = splitChain(rest.slice(name.length + 1), names);
      if (tail) return [name, ...tail];
    }
  }
  return null;
}

/**
 * The mediation pairs of a PLS-SEM or CB-SEM bootstrap: for every X → Y with a total indirect effect
 * (`indirect:X:Y`), its specific indirect effects (`specific:X:M...:Y`, when the bootstrap computed
 * them) and the direct effect (`path:X:Y`, or null without that path). `hasPath(from, to)` says whether
 * the model has the direct path. Pairs keep the order of the bootstrap's statistics.
 */
export function mediationPairs(
  boot: Pick<BootstrapResult, 'stats'>,
  constructs: string[],
  hasPath: (from: string, to: string) => boolean,
): MediationPair[] {
  const byKey = new Map(boot.stats.map((s) => [s.key, s]));
  const specificByPair = new Map<string, { path: string[]; stat: BootstrapStat }[]>();
  for (const s of boot.stats) {
    if (s.group !== 'specific' || !s.key.startsWith('specific:')) continue;
    const path = splitChain(s.key.slice('specific:'.length), constructs);
    if (!path || path.length < 3) continue;
    const pairKey = `${path[0]}\u0000${path[path.length - 1]}`;
    const list = specificByPair.get(pairKey) ?? [];
    list.push({ path, stat: s });
    specificByPair.set(pairKey, list);
  }
  const pairs: MediationPair[] = [];
  for (const from of constructs) {
    for (const to of constructs) {
      if (from === to) continue;
      const totalStat = byKey.get(`indirect:${from}:${to}`);
      const specs = specificByPair.get(`${from}\u0000${to}`) ?? [];
      if (!totalStat && !specs.length) continue;
      const directStat = byKey.get(`path:${from}:${to}`);
      const direct = hasPath(from, to) && directStat ? statInterval(directStat) : null;
      pairs.push(buildPair(from, to, direct, totalStat ? statInterval(totalStat) : null, specs));
    }
  }
  return pairs;
}

/** A pair from its intervals (also used for PROCESS models, whose effects are not bootstrap statistics). */
export function buildPair(
  from: string,
  to: string,
  direct: Interval | null,
  total: Interval | null,
  specs: { path: string[]; stat?: BootstrapStat; interval?: Interval }[],
): MediationPair {
  const specific: MediationEffect[] = specs.map((s) => {
    const indirect = s.interval ?? statInterval(s.stat!);
    return { kind: 'specific', path: s.path, indirect, cls: classifyMediation(indirect, direct) };
  });
  const totalEffect: MediationEffect | null = total
    ? { kind: 'total', path: [from, to], indirect: total, cls: classifyMediation(total, direct) }
    : null;
  const significant = specific.filter((e) => e.cls.indirectSignificant);
  const positive = significant.some((e) => e.indirect.est > 0);
  const negative = significant.some((e) => e.indirect.est < 0);
  return {
    from,
    to,
    direct,
    specific,
    total: totalEffect,
    opposingSpecific: positive && negative,
    significantSpecific: significant.length,
    totalHidesSpecific:
      totalEffect !== null && !totalEffect.cls.indirectSignificant && significant.length > 0,
  };
}

// ---------------------------------------------------------------- reporting sentences

/** How the numbers are written: β (standardised, no leading zero, APA) or b (unstandardised). */
export interface SentenceStyle {
  symbol: 'β' | 'b';
  /** e.g. "95% CI", "95% BCa CI". */
  ci: string;
}

/** The interval's name for a sentence: "95% CI", "95% BCa CI", "90% CI (one-sided)". */
export function ciName(
  boot: Pick<BootstrapResult, 'confidence' | 'interval' | 'tails'> | { confidence: number },
): string {
  const b = boot as Partial<BootstrapResult> & { confidence: number };
  const level = `${Math.round(b.confidence * 100)}%`;
  let kind = '';
  if (b.interval === 'bca') kind = ' BCa';
  else if (b.interval === 'studentized') kind = ' studentized';
  const sided = b.tails === 1 ? ' (one-sided)' : '';
  return `${level}${kind} CI${sided}`;
}

/** A number as APA writes it: two decimals, a true minus sign, no leading zero for standardised values. */
export function apaNumber(v: number, standardised: boolean, digits = 2): string {
  const text = Math.abs(v).toFixed(digits);
  const body = standardised && Math.abs(v) < 1 ? text.replace(/^0/, '') : text;
  // (a value that rounds to zero is written without a sign)
  const sign = v < 0 && Number(text) !== 0 ? '−' : '';
  return `${sign}${body}`;
}

/**
 * Decimals for an estimate and its interval: two, or up to four when a bound would round to zero
 * (so "[.00, .13]" never stands for an interval whose decision hangs on that bound's sign).
 */
export function intervalDigits(e: Interval): number {
  for (let digits = 2; digits < 4; digits++) {
    const roundsToZero = (v: number) => v !== 0 && Number(Math.abs(v).toFixed(digits)) === 0;
    if (!roundsToZero(e.lo) && !roundsToZero(e.hi)) return digits;
  }
  return 4;
}

function estimateText(e: Interval, style: SentenceStyle): string {
  const std = style.symbol === 'β';
  const digits = intervalDigits(e);
  const n = (v: number) => apaNumber(v, std, digits);
  return `${style.symbol} = ${n(e.est)}, ${style.ci} [${n(e.lo)}, ${n(e.hi)}]`;
}

/** "through M" or "through M1 and then M2" (serial). */
function throughText(path: string[]): string {
  const mediators = path.slice(1, -1);
  if (mediators.length === 1) return `through ${mediators[0]}`;
  return `serially through ${mediators.join(' and then ')}`;
}

/**
 * The reporting sentence of one indirect effect, with its type and the source of the typology,
 * e.g. "The indirect effect of X on Y through M was significant (β = .21, 95% CI [.12, .31]) and the
 * direct effect remained significant with the same sign (β = .15, 95% CI [.05, .25]): complementary
 * (partial) mediation (Zhao et al., 2010)."
 */
export function mediationSentence(
  pair: MediationPair,
  effect: MediationEffect,
  style: SentenceStyle,
): string {
  const { from, to, direct } = pair;
  const subject =
    effect.kind === 'total'
      ? `The total indirect effect of ${from} on ${to} (through all mediators)`
      : `The indirect effect of ${from} on ${to} ${throughText(effect.path)}`;
  const ind = estimateText(effect.indirect, style);
  const cls = effect.cls;
  const label = MEDIATION_LABEL[cls.type].replace(/^./, (ch) => ch.toLowerCase());
  const source = '(Zhao et al., 2010)';
  if (!direct) {
    const verdict = cls.indirectSignificant ? 'was significant' : 'was not significant';
    const consequence = cls.indirectSignificant
      ? 'consistent with indirect-only (full) mediation, but the direct effect was not tested'
      : 'no mediation, and the direct effect was not tested';
    return (
      `${subject} ${verdict} (${ind}). The model has no direct path from ${from} to ${to}, ` +
      `so the direct effect is fixed at zero: ${consequence} ${source}. ` +
      `Add the direct path to classify the mediation (Nitzl et al., 2016).`
    );
  }
  const dir = estimateText(direct, style);
  switch (cls.type) {
    case 'complementary':
      return `${subject} was significant (${ind}) and the direct effect remained significant with the same sign (${dir}): ${label} ${source}.`;
    case 'competitive':
      return `${subject} was significant (${ind}) and the direct effect remained significant with the opposite sign (${dir}): ${label} ${source}.`;
    case 'indirect-only':
      return `${subject} was significant (${ind}) and the direct effect was not (${dir}): ${label} ${source}.`;
    case 'direct-only':
      return `${subject} was not significant (${ind}), while the direct effect was (${dir}): ${label} ${source}.`;
    default:
      return `Neither ${subject.replace(/^The/, 'the')} (${ind}) nor the direct effect (${dir}) was significant: ${label} ${source}.`;
  }
}

/**
 * Notes on a pair with several specific indirect effects: how many are significant (and that one is
 * enough for mediation through that mediator), inconsistent mediation, and a total that hides them.
 */
export function pairNotes(pair: MediationPair): string[] {
  const notes: string[] = [];
  const n = pair.specific.length;
  if (n > 1) {
    const k = pair.significantSpecific;
    notes.push(
      `${k} of ${n} specific indirect effects of ${pair.from} on ${pair.to} ${k === 1 ? 'is' : 'are'} significant.`,
    );
  }
  if (pair.opposingSpecific)
    notes.push(
      `Significant specific indirect effects of ${pair.from} on ${pair.to} have opposite signs ` +
        '(inconsistent mediation): they partly cancel out in the total indirect effect (Zhao et al., 2010).',
    );
  if (pair.totalHidesSpecific)
    notes.push(
      `The total indirect effect of ${pair.from} on ${pair.to} is not significant although a specific one is: ` +
        'read the specific effects, not the total (Hair et al., 2021).',
    );
  return notes;
}

/** Shown once with the notes when a pair has several specific indirect effects. */
export const SEVERAL_MEDIATORS_NOTE =
  'Each specific indirect effect is a mediation through its own mediator(s): one significant specific ' +
  'effect is mediation through that path, whatever the others show (Nitzl et al., 2016). Report each one.';

/** Counts of the types over the pairs' specific effects (or the total, where no specific ones exist). */
export function typeCounts(pairs: MediationPair[]): Partial<Record<MediationType, number>> {
  const counts: Partial<Record<MediationType, number>> = {};
  for (const p of pairs) {
    const effects = p.specific.length ? p.specific : p.total ? [p.total] : [];
    for (const e of effects) counts[e.cls.type] = (counts[e.cls.type] ?? 0) + 1;
  }
  return counts;
}

/** The parts of a PROCESS result the typology reads (rengine/cpa.ts CpaResult). */
export interface ProcessEffects {
  direct: { moderators: string[]; rows: { est: number; lo: number; hi: number }[] } | null;
  directs: unknown[];
  counterfactual?: unknown;
  indirect: {
    path: string[];
    moderators: string[];
    rows: { est: number; lo: number; hi: number }[];
  }[];
  total: { est: number; lo: number; hi: number } | null;
}

/**
 * The mediation pair of a PROCESS model without moderation of any effect (models 4 and 6 and their
 * like): its indirect effects, the total indirect effect and the direct effect. null when an effect is
 * conditional on a moderator (classify the conditional effects at each value instead), X is
 * multicategorical, or the effects are counterfactual.
 */
export function processMediationPair(res: ProcessEffects): MediationPair | null {
  if (!res.indirect.length || res.directs.length || res.counterfactual) return null;
  const d = res.direct;
  if (d && (d.moderators.length || d.rows.length !== 1)) return null;
  if (res.indirect.some((p) => p.moderators.length || p.rows.length !== 1)) return null;
  const path0 = res.indirect[0].path;
  const from = path0[0];
  const to = path0[path0.length - 1];
  const interval = (r: { est: number; lo: number; hi: number }): Interval => ({
    est: r.est,
    lo: r.lo,
    hi: r.hi,
  });
  const specs = res.indirect.map((p) => ({ path: p.path, interval: interval(p.rows[0]) }));
  const total = res.total ? interval(res.total) : null;
  return buildPair(from, to, d ? interval(d.rows[0]) : null, total, specs);
}
