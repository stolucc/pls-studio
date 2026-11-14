// Negative loadings that may be a forgotten reverse-coding. A negatively worded item ("I am rarely
// satisfied") that was not reverse-coded loads with the opposite sign to the other indicators of
// its construct. The note asks the author whether the item is reverse-coded, offers to
// reverse-code it (the Data tab's dialog: components/reverseCodeDialog.ts), or to dismiss the
// note for that indicator (kept in the project: ModelState.measurement.notReversed).
//
// Only reflective indicators count: PLS-SEM Mode A blocks (common factors and Mode A composites)
// and CB-SEM factor loadings (=~), standardised. The weights of formative (Mode B) and CB-SEM
// composite (<~) indicators can be negative because the indicators are correlated (suppression),
// not because of their coding, so they are not flagged.

import type { CbResult } from '../engine/cbsem';
import type { PlsResult } from '../engine/types';
import type { DataInfo, ModelState } from '../model/project';

/** One reflective indicator's loading on its construct. */
export interface SignedLoading {
  construct: string;
  indicator: string;
  loading: number;
}

/**
 * - `negative`: the indicator loads negatively while most other indicators of its construct load
 *   positively (or as many: a tie flags the negative ones);
 * - `positive`: the indicator loads positively while most others load negatively, so the
 *   construct's scores follow the others' direction and this item is the odd one out;
 * - `all-negative`: every indicator of the construct loads negatively.
 */
export type NegativeLoadingKind = 'negative' | 'positive' | 'all-negative';

/** One note: the indicators it is about (one, or all of an all-negative construct). */
export interface NegativeLoadingFlag {
  kind: NegativeLoadingKind;
  construct: string;
  items: { indicator: string; loading: number }[];
}

/** What the detection leaves out: items already reversed in the app, and dismissed notes. */
export interface NegativeLoadingSkip {
  reversed: ReadonlySet<string>;
  dismissed: ReadonlySet<string>;
}

/** The loadings grouped by construct, in the order given. */
function byConstruct(loadings: SignedLoading[]): Map<string, SignedLoading[]> {
  const out = new Map<string, SignedLoading[]>();
  for (const l of loadings) {
    if (!Number.isFinite(l.loading)) continue;
    const block = out.get(l.construct) ?? [];
    block.push(l);
    out.set(l.construct, block);
  }
  return out;
}

/** The notes for these loadings: constructs of two or more indicators whose signs disagree, or are all negative. */
export function negativeLoadingFlags(
  loadings: SignedLoading[],
  skip: NegativeLoadingSkip,
): NegativeLoadingFlag[] {
  const open = (l: SignedLoading) =>
    !skip.reversed.has(l.indicator) && !skip.dismissed.has(l.indicator);
  const item = (l: SignedLoading) => ({ indicator: l.indicator, loading: l.loading });
  const out: NegativeLoadingFlag[] = [];
  for (const [construct, block] of byConstruct(loadings)) {
    if (block.length < 2) continue;
    const negative = block.filter((l) => l.loading < 0);
    const positive = block.filter((l) => l.loading > 0);
    if (negative.length === 0) continue;
    if (positive.length === 0) {
      const items = negative.filter(open).map(item);
      if (items.length) out.push({ kind: 'all-negative', construct, items });
      continue;
    }
    // The minority sign is the odd one out; a tie flags the negative ones.
    const flagNegative = negative.length <= positive.length;
    const odd = flagNegative ? negative : positive;
    for (const l of odd.filter(open)) {
      out.push({ kind: flagNegative ? 'negative' : 'positive', construct, items: [item(l)] });
    }
  }
  return out;
}

/** The reflective indicators of first-order PLS constructs (common factors and Mode A composites) with their loadings. */
export function plsSignedLoadings(model: ModelState, pls: PlsResult): SignedLoading[] {
  const out: SignedLoading[] = [];
  for (const k of model.constructs) {
    const reflective = k.type === 'factor' || k.mode === 'A';
    if (!reflective || k.components?.length) continue;
    const j = pls.constructs.indexOf(k.name);
    if (j < 0) continue;
    pls.indicators.forEach((x, i) => {
      if (x.construct !== j || !k.indicators.includes(x.name)) return;
      out.push({ construct: k.name, indicator: x.name, loading: pls.loadings[i] });
    });
  }
  return out;
}

/** The CB-SEM factor loadings (=~), standardised (std.all), of the model's indicators (not of first-order factors). */
export function cbSignedLoadings(cb: CbResult, indicators: ReadonlySet<string>): SignedLoading[] {
  return cb.estimates
    .filter((e) => e.op === '=~' && indicators.has(e.rhs))
    .map((e) => ({ construct: e.lhs, indicator: e.rhs, loading: e.std }));
}

/** Formative (Mode B) PLS indicators with a negative weight: not flagged, but worth one line. */
export function plsNegativeWeights(model: ModelState, pls: PlsResult): string[] {
  const modeB = new Set(
    model.constructs
      .filter((k) => k.type !== 'factor' && k.mode === 'B' && !k.components?.length)
      .map((k) => k.name),
  );
  return pls.indicators
    .filter((x, i) => modeB.has(pls.constructs[x.construct]) && pls.weights[i] < 0)
    .map((x) => x.name);
}

/** CB-SEM composite (<~) indicators with a negative standardised weight: not flagged, but worth one line. */
export function cbNegativeWeights(cb: CbResult): string[] {
  return cb.estimates.filter((e) => e.op === '<~' && e.std < 0).map((e) => e.rhs);
}

/** What to leave out: the items reversed in the app (DataInfo.reversed) and the dismissed notes. */
export function skipOf(model: ModelState, info: DataInfo | null | undefined): NegativeLoadingSkip {
  return {
    reversed: new Set((info?.reversed ?? []).map((r) => r.name)),
    dismissed: new Set(model.measurement?.notReversed ?? []),
  };
}

/** The notes for a PLS-SEM result. */
export function plsNegativeLoadingFlags(
  model: ModelState,
  info: DataInfo | null | undefined,
  pls: PlsResult,
): NegativeLoadingFlag[] {
  return negativeLoadingFlags(plsSignedLoadings(model, pls), skipOf(model, info));
}

/** The notes for a CB-SEM result (standardised loadings). */
export function cbNegativeLoadingFlags(
  model: ModelState,
  info: DataInfo | null | undefined,
  cb: CbResult,
): NegativeLoadingFlag[] {
  const indicators = new Set(model.constructs.flatMap((k) => k.indicators));
  return negativeLoadingFlags(cbSignedLoadings(cb, indicators), skipOf(model, info));
}

/** A loading as the note writes it: two decimals, with a true minus sign. */
export function signed(x: number): string {
  return x.toFixed(2).replace('-', '−');
}

/** The note's question. */
export function flagText(flag: NegativeLoadingFlag): string {
  const first = flag.items[0];
  if (flag.kind === 'negative') {
    return (
      `${first.indicator} loads negatively on ${flag.construct} (${signed(first.loading)}). ` +
      'Is it a negatively worded (reverse-coded) item?'
    );
  }
  if (flag.kind === 'positive') {
    return (
      `${first.indicator} loads positively on ${flag.construct} (${signed(first.loading)}), ` +
      `while most of its other indicators load negatively. Is ${first.indicator} a negatively ` +
      'worded (reverse-coded) item?'
    );
  }
  const list = flag.items.map((x) => `${x.indicator} ${signed(x.loading)}`).join(', ');
  return (
    `Every indicator of ${flag.construct} loads negatively (${list}): its scores run opposite ` +
    'to its indicators, and the signs of its paths flip with them. Are its items all negatively ' +
    'worded (reverse-coded)? If not, check how they were coded.'
  );
}

/** The one-line explanation of why negative weights are not flagged. */
export const WEIGHTS_NOT_FLAGGED =
  'Negative weights of formative (Mode B) or composite indicators are not flagged: a weight can ' +
  'be negative because the indicators are correlated (suppression), not because of their coding.';
