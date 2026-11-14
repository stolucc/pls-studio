// The failed-HTMT helper's computations, all on results the app already has or on the
// indicator correlations: the threshold that applies to a pair, the verdict from its value and
// its bootstrap upper bound, the bootstrap itself (resampled rows, HTMT recomputed), and the
// items that drive a high value.
//
// Rules and sources:
// - HTMT at or above 0.85 (conceptually distinct constructs) or 0.90 (conceptually similar ones)
//   indicates a lack of discriminant validity (Henseler, Ringle & Sarstedt 2015).
// - The upper bound of the one-sided 95% bootstrap interval should be below the threshold too:
//   a value just below the threshold whose upper bound reaches it does not establish
//   discriminant validity (Franke & Sarstedt 2019).
// - HTMT takes precedence over the Fornell–Larcker criterion, which misses most problems
//   (Henseler et al. 2015; Hair et al. 2021).

import { expandCategorical } from '../engine/categorical';
import { compileModel, extractColumns } from '../engine/pls';
import type { Dataset, MissingTreatment, ModelSpec, PlsResult } from '../engine/types';

/** Henseler et al. (2015): conceptually distinct constructs. */
export const HTMT_DISTINCT = 0.85;
/** Henseler et al. (2015): conceptually similar constructs. */
export const HTMT_SIMILAR = 0.9;
/** One-sided 95% interval: its upper bound is the 95th percentile (Franke & Sarstedt 2019). */
export const HTMT_UPPER_PROBABILITY = 0.95;

/** The HTMT threshold of a pair. */
export function htmtThreshold(similar: boolean): number {
  return similar ? HTMT_SIMILAR : HTMT_DISTINCT;
}

/**
 * - `fails`: the HTMT itself is at or above the threshold.
 * - `boundFails`: the HTMT is below, but the bootstrap upper bound reaches the threshold: not established.
 * - `established`: both below the threshold.
 * - `unconfirmed`: the HTMT is below, and no bootstrap upper bound has been computed yet.
 */
export type HtmtVerdict = 'fails' | 'boundFails' | 'established' | 'unconfirmed';

/** The verdict for a pair (at or above the threshold counts as failing, as the reviewer checklist does). */
export function htmtVerdict(
  value: number,
  upper: number | null | undefined,
  threshold: number,
): HtmtVerdict {
  if (value >= threshold) return 'fails';
  if (upper === null || upper === undefined || !Number.isFinite(upper)) return 'unconfirmed';
  if (upper >= threshold) return 'boundFails';
  return 'established';
}

/** The p-quantile of sorted values, R's default (type 7), as cSEM's percentile intervals. */
export function quantileType7(sorted: ArrayLike<number>, p: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  const h = (n - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.min(n - 1, lo + 1);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

/** The model's indicator columns after the missing-value treatment, and each construct's block. */
export interface IndicatorData {
  names: string[];
  cols: Float64Array[];
  /** Indicator indices (into names) of each construct, by name. */
  blocks: Map<string, number[]>;
}

/**
 * The indicator columns the HTMT is computed from: casewise deletion or mean replacement, as
 * the estimation (other treatments, such as multiple imputation, fall back to mean replacement:
 * the panel says so).
 */
export function indicatorData(
  data: Dataset,
  spec: ModelSpec,
  missing: MissingTreatment,
): IndicatorData {
  const expanded = expandCategorical(data, spec);
  const m = compileModel({ constructs: expanded.spec.constructs, paths: [] });
  const treatment = missing === 'casewise' ? 'casewise' : 'mean';
  const { cols } = extractColumns(expanded.data, m, treatment);
  const blocks = new Map(m.constructs.map((name, j) => [name, m.blocks[j]]));
  return { names: m.indicatorNames, cols, blocks };
}

/** Pearson correlations of the columns `which` over the rows `rows` (all rows when absent). */
export function correlations(
  cols: Float64Array[],
  which: number[],
  rows?: ArrayLike<number>,
): number[][] {
  const n = rows ? rows.length : (cols[0]?.length ?? 0);
  const at = (c: Float64Array, r: number) => (rows ? c[rows[r]] : c[r]);
  // Centred, unit-length columns: their dot products are the correlations.
  const z = which.map((k) => {
    const c = cols[k];
    let sum = 0;
    for (let r = 0; r < n; r++) sum += at(c, r);
    const mean = sum / n;
    const v = new Float64Array(n);
    let ss = 0;
    for (let r = 0; r < n; r++) {
      v[r] = at(c, r) - mean;
      ss += v[r] * v[r];
    }
    const norm = Math.sqrt(ss);
    for (let r = 0; r < n; r++) v[r] /= norm;
    return v;
  });
  const p = which.length;
  const R = Array.from({ length: p }, () => new Array<number>(p).fill(1));
  for (let a = 0; a < p; a++)
    for (let b = 0; b < a; b++) {
      let s = 0;
      const za = z[a];
      const zb = z[b];
      for (let r = 0; r < n; r++) s += za[r] * zb[r];
      R[a][b] = s;
      R[b][a] = s;
    }
  return R;
}

/**
 * How item correlations enter the HTMT. 'absolute': every correlation as its absolute value
 * (seminr and the built-in engine). 'signed': the mean of the signed correlations, its absolute
 * value taken at the end (cSEM's calculateHTMT with .absolute = TRUE). They agree when every
 * item correlation is positive.
 */
export type HtmtVariant = 'absolute' | 'signed';

/** The convention of the package that computed a result (cSEM: signed; otherwise absolute). */
export function htmtVariantOf(pls: PlsResult): HtmtVariant {
  const engine = (pls as PlsResult & { engine?: { package?: string } }).engine;
  return engine?.package?.startsWith('cSEM') ? 'signed' : 'absolute';
}

const term = (r: number, variant: HtmtVariant) => (variant === 'absolute' ? Math.abs(r) : r);

/** Mean correlation among the items of one block (1 for a single item, as the packages do). */
function monotrait(R: number[][], block: number[], variant: HtmtVariant): number {
  if (block.length < 2) return 1;
  let sum = 0;
  let count = 0;
  for (let a = 0; a < block.length; a++)
    for (let d = a + 1; d < block.length; d++) {
      sum += term(R[block[a]][block[d]], variant);
      count++;
    }
  return sum / count;
}

/**
 * The HTMT of two blocks (indices into R): the mean heterotrait correlation over the geometric
 * mean of the two mean monotrait correlations (Henseler et al. 2015). NaN when the monotrait
 * means have opposite signs (the packages leave such a value out).
 */
export function pairHtmt(
  R: number[][],
  a: number[],
  b: number[],
  variant: HtmtVariant = 'absolute',
): number {
  let sum = 0;
  for (const x of a) for (const y of b) sum += term(R[x][y], variant);
  const hetero = Math.abs(sum / (a.length * b.length));
  const mono = monotrait(R, a, variant) * monotrait(R, b, variant);
  if (!(mono > 0)) return NaN;
  return hetero / Math.sqrt(mono);
}

/** The HTMT of construct pairs from indicator columns, over the rows given (all when absent). */
export function htmtOfPairs(
  ind: IndicatorData,
  pairs: [string, string][],
  rows?: ArrayLike<number>,
  variant: HtmtVariant = 'absolute',
): number[] {
  // Only the indicators of the constructs involved, re-indexed.
  const used = [...new Set(pairs.flatMap(([a, b]) => [...blockOf(ind, a), ...blockOf(ind, b)]))];
  const local = new Map(used.map((k, i) => [k, i]));
  const R = correlations(ind.cols, used, rows);
  return pairs.map(([a, b]) => {
    const ia = blockOf(ind, a).map((k) => local.get(k)!);
    const ib = blockOf(ind, b).map((k) => local.get(k)!);
    return pairHtmt(R, ia, ib, variant);
  });
}

function blockOf(ind: IndicatorData, construct: string): number[] {
  const b = ind.blocks.get(construct);
  if (!b || !b.length) throw new Error(`${construct} has no indicators.`);
  return b;
}

/** One pair's bootstrap: the HTMT on the data, its resampled values, and the 95th percentile. */
export interface HtmtBootPair {
  a: string;
  b: string;
  original: number;
  upper: number;
}

export interface HtmtBootstrap {
  variant: HtmtVariant;
  samples: number;
  /** Resamples with an undefined HTMT (a constant column), left out. */
  failed: number;
  seed: number;
  pairs: HtmtBootPair[];
}

/**
 * The resampled HTMT values of each pair for resamples [from, to): `rowsOf(b)` gives the rows
 * of resample b. Returns one array of draws per pair (NaN where undefined).
 */
export function htmtDraws(
  ind: IndicatorData,
  pairs: [string, string][],
  rowsOf: (b: number) => ArrayLike<number>,
  from: number,
  to: number,
  variant: HtmtVariant = 'absolute',
): number[][] {
  const out = pairs.map(() => [] as number[]);
  for (let b = from; b < to; b++) {
    const values = htmtOfPairs(ind, pairs, rowsOf(b), variant);
    values.forEach((v, i) => out[i].push(v));
  }
  return out;
}

/** Summarise the draws: each pair's upper bound (95th percentile, type 7) over the defined draws. */
export function summariseHtmtDraws(
  ind: IndicatorData,
  pairs: [string, string][],
  draws: number[][],
  seed: number,
  variant: HtmtVariant = 'absolute',
): HtmtBootstrap {
  const original = htmtOfPairs(ind, pairs, undefined, variant);
  const samples = draws[0]?.length ?? 0;
  // A resample counts as failed when any pair is undefined in it (as cSEM's na.omit).
  const ok = Array.from({ length: samples }, (_, b) => draws.every((d) => Number.isFinite(d[b])));
  const failed = ok.filter((x) => !x).length;
  return {
    variant,
    samples,
    failed,
    seed,
    pairs: pairs.map(([a, b], i) => {
      const kept = draws[i].filter((_, r) => ok[r]).sort((x, y) => x - y);
      return { a, b, original: original[i], upper: quantileType7(kept, HTMT_UPPER_PROBABILITY) };
    }),
  };
}

/** One indicator of a pair, with what drives the pair's HTMT. */
export interface ItemDriver {
  indicator: string;
  construct: string;
  /** Its loading on its own construct, as reported. */
  loading: number;
  /** Its correlation with the other construct's scores (cross-loading). */
  crossLoading: number;
  /** Mean absolute correlation with the other construct's items (heterotrait). */
  hetero: number;
  /** Mean absolute correlation with the other items of its own construct (monotrait). */
  mono: number | null;
}

export interface ItemPairCorrelation {
  a: string;
  b: string;
  r: number;
}

export interface PairDrivers {
  items: ItemDriver[];
  /** Heterotrait item correlations, largest |r| first. */
  itemPairs: ItemPairCorrelation[];
}

/**
 * The items behind a pair's HTMT: each item's cross-loading on the other construct (the
 * correlation with its scores, from the reported outer weights: scores are weighted sums of the
 * standardised items), and its mean heterotrait and monotrait correlations. Sorted by heterotrait
 * correlation, largest first: removing such items is one of Henseler et al.'s (2015) options.
 */
export function pairDrivers(ind: IndicatorData, pls: PlsResult, a: string, b: string): PairDrivers {
  const ba = blockOf(ind, a);
  const bb = blockOf(ind, b);
  const used = [...ba, ...bb];
  const local = new Map(used.map((k, i) => [k, i]));
  const R = correlations(ind.cols, used);
  const ia = ba.map((k) => local.get(k)!);
  const ib = bb.map((k) => local.get(k)!);
  const weightsOf = (construct: string, items: number[]) => {
    const j = pls.constructs.indexOf(construct);
    return items.map((k) => {
      const name = ind.names[used[k]];
      const at = pls.indicators.findIndex((x) => x.name === name && x.construct === j);
      return at >= 0 ? pls.weights[at] : NaN;
    });
  };
  const loadingOf = (construct: string, name: string) => {
    const j = pls.constructs.indexOf(construct);
    const at = pls.indicators.findIndex((x) => x.name === name && x.construct === j);
    return at >= 0 ? pls.loadings[at] : NaN;
  };
  const wa = weightsOf(a, ia);
  const wb = weightsOf(b, ib);
  const drivers = [
    ...ia.map((x) => driver(R, x, a, ia, ib, wb)),
    ...ib.map((x) => driver(R, x, b, ib, ia, wa)),
  ];
  const items: ItemDriver[] = drivers.map(({ at, ...d }) => ({
    ...d,
    indicator: ind.names[used[at]],
    loading: loadingOf(d.construct, ind.names[used[at]]),
  }));
  items.sort((x, y) => y.hetero - x.hetero);
  const itemPairs: ItemPairCorrelation[] = [];
  for (const x of ia)
    for (const y of ib)
      itemPairs.push({ a: ind.names[used[x]], b: ind.names[used[y]], r: R[x][y] });
  itemPairs.sort((x, y) => Math.abs(y.r) - Math.abs(x.r));
  return { items, itemPairs };
}

function driver(
  R: number[][],
  x: number,
  construct: string,
  own: number[],
  other: number[],
  otherWeights: number[],
) {
  let hetero = 0;
  for (const y of other) hetero += Math.abs(R[x][y]);
  hetero /= other.length;
  const mates = own.filter((y) => y !== x);
  let mono: number | null = null;
  if (mates.length) {
    mono = 0;
    for (const y of mates) mono += Math.abs(R[x][y]);
    mono /= mates.length;
  }
  return {
    at: x,
    construct,
    crossLoading: scoreCorrelation(R, x, other, otherWeights),
    hetero,
    mono,
  };
}

/**
 * The correlation of item x with the composite Σ w_k z_k of a block: (Σ w_k r_xk) / √(w'Rw).
 * Dividing by the composite's standard deviation makes it independent of how the weights are scaled.
 */
export function scoreCorrelation(R: number[][], x: number, block: number[], w: number[]): number {
  let cov = 0;
  for (let k = 0; k < block.length; k++) cov += w[k] * R[x][block[k]];
  let v = 0;
  for (let k = 0; k < block.length; k++)
    for (let l = 0; l < block.length; l++) v += w[k] * w[l] * R[block[k]][block[l]];
  return cov / Math.sqrt(v);
}

/** The Fornell–Larcker comparison of a pair: |r| against the smaller √AVE. */
export interface FornellLarcker {
  r: number;
  sqrtAveA: number;
  sqrtAveB: number;
  met: boolean;
}

export function fornellLarckerPair(pls: PlsResult, a: string, b: string): FornellLarcker | null {
  const i = pls.constructs.indexOf(a);
  const j = pls.constructs.indexOf(b);
  if (i < 0 || j < 0) return null;
  const r = pls.constructCor[i][j];
  const sqrtAveA = Math.sqrt(pls.quality[i].ave);
  const sqrtAveB = Math.sqrt(pls.quality[j].ave);
  if (![r, sqrtAveA, sqrtAveB].every(Number.isFinite)) return null;
  return { r, sqrtAveA, sqrtAveB, met: Math.abs(r) < Math.min(sqrtAveA, sqrtAveB) };
}

/** A pair of the HTMT matrix (row construct, column construct) with its values. */
export interface HtmtPair {
  /** The row construct (later in the results). */
  a: string;
  b: string;
  htmt: number;
  htmt2: number | null;
}

/** Every pair with a reported HTMT, in the results' order. */
export function htmtPairs(pls: PlsResult): HtmtPair[] {
  const out: HtmtPair[] = [];
  pls.htmt.forEach((row, i) =>
    row.forEach((v, j) => {
      if (j >= i || v === null || !Number.isFinite(v)) return;
      const h2 = pls.htmt2[i]?.[j];
      out.push({
        a: pls.constructs[i],
        b: pls.constructs[j],
        htmt: v,
        htmt2: h2 !== null && h2 !== undefined && Number.isFinite(h2) ? h2 : null,
      });
    }),
  );
  return out;
}
