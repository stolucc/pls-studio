// Parcels: a construct's items averaged in groups, used as its indicators. As commonly done: three parcels per construct
// (Little et al. 2013); items dealt by item-to-construct balance (Little et al. 2002: ranked by their loading in a
// one-factor model, in serpentine order), at random, or by hand; and the spread of results over random allocations
// (Sterba & MacCallum 2010; semTools::parcelAllocation). Only for unidimensional constructs: parcels can hide misfit.

import { estimateCb } from './cbsem';
import { mulberry32 } from './stats';
import type { Dataset, ModelSpec } from './types';

export type ParcelMethod = 'balance' | 'random' | 'manual';

/** The parcel (0-based) of the item ranked r: 1, 2, …, k, k, …, 2, 1, 1, 2, … */
export const serpentine = (r: number, k: number) => {
  const round = Math.floor(r / k),
    i = r % k;
  return round % 2 === 0 ? i : k - 1 - i;
};

/** Item-to-construct balance: the highest loadings anchor the parcels, the next fill them in reverse order, and so on. */
export function balanceParcels(
  loadings: { item: string; loading: number }[],
  k: number,
): string[][] {
  const ranked = [...loadings].sort((a, b) => b.loading - a.loading);
  const out: string[][] = Array.from({ length: k }, () => []);
  ranked.forEach((x, r) => out[serpentine(r, k)].push(x.item));
  return out;
}

/** Items shuffled into parcels of these sizes (the sizes of the parcels being replaced, or as equal as possible). */
export function randomParcels(items: string[], sizes: number[], rng: () => number): string[][] {
  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  let at = 0;
  return sizes.map((s) => pool.slice(at, (at += s)));
}

/** k parcel sizes for n items, as equal as possible (the larger first). */
export const parcelSizes = (n: number, k: number) =>
  Array.from({ length: k }, (_, i) => Math.floor(n / k) + (i < n % k ? 1 : 0));

/** Standardised loadings of the items in a one-factor model (the built-in ML engine, complete cases). */
export function itemLoadings(data: Dataset, items: string[]): { item: string; loading: number }[] {
  const r = estimateCb(
    data,
    { constructs: [{ name: 'F', mode: 'A', type: 'factor', indicators: items }], paths: [] },
    'casewise',
  );
  return items.map((item) => ({
    item,
    loading: r.estimates.find((e) => e.op === '=~' && e.rhs === item)?.std ?? NaN,
  }));
}

/** A parcel's formula (a computed column: the mean of its items), and back. */
export const parcelExpr = (items: string[]) => `mean(${items.join(', ')})`;
export function parcelItemsOf(expr: string): string[] | null {
  const m = /^\s*mean\(([^()]*)\)\s*$/.exec(expr);
  if (!m) return null;
  const items = m[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length >= 1 ? items : null;
}

export interface ParcelTarget {
  construct: string;
  parcels: string[];
  items: string[];
  sizes: number[];
}

/** Constructs measured by parcels: every indicator a computed mean of items, at least two of them. */
export function parcelTargets(
  spec: ModelSpec,
  computed: { name: string; expr: string }[],
): ParcelTarget[] {
  const exprs = new Map(computed.map((c) => [c.name, c.expr]));
  return spec.constructs.flatMap((c) => {
    const groups = c.indicators.map((i) => (exprs.has(i) ? parcelItemsOf(exprs.get(i)!) : null));
    if (c.indicators.length < 2 || groups.some((g) => !g)) return [];
    const items = groups.flat() as string[];
    return new Set(items).size === items.length
      ? [{ construct: c.name, parcels: c.indicators, items, sizes: groups.map((g) => g!.length) }]
      : [];
  });
}

/** Row means of the items (missing when an item is: as the formula's mean()). */
function rowMeans(data: Dataset, items: string[]): Float64Array {
  const cols = items.map((i) => {
    const k = data.names.indexOf(i);
    if (k < 0) throw new Error(`Item "${i}" is not in the data.`);
    return data.cols[k];
  });
  const n = cols[0]?.length ?? 0;
  return Float64Array.from(
    { length: n },
    (_, r) => cols.reduce((s, c) => s + c[r], 0) / cols.length,
  );
}

export interface Spread {
  label: string;
  current: number;
  mean: number;
  sd: number;
  min: number;
  max: number;
  percentile: number;
  significant?: number;
}
export interface AllocationResult {
  allocations: number;
  failed: number;
  fit: Spread[];
  estimates: Spread[];
}

const spread = (label: string, current: number, v: number[], sig?: boolean[]): Spread => {
  const n = v.length;
  if (n === 0) return { label, current, mean: NaN, sd: NaN, min: NaN, max: NaN, percentile: NaN };
  const mean = v.reduce((s, x) => s + x, 0) / n;
  return {
    label,
    current,
    mean,
    sd: n > 1 ? Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1)) : 0,
    min: Math.min(...v),
    max: Math.max(...v),
    percentile: v.filter((x) => x <= current).length / n,
    ...(sig ? { significant: sig.filter(Boolean).length / n } : {}),
  };
};

/**
 * The model refitted with the items of each parcelled construct allocated to its parcels at random, `allocations` times:
 * how much fit and estimates depend on the allocation, and where the current one stands.
 */
export async function allocationVariability(
  data: Dataset,
  spec: ModelSpec,
  targets: ParcelTarget[],
  opts: { allocations: number; seed: number },
  progress: (done: number, total: number) => void = () => {},
): Promise<AllocationResult> {
  if (!targets.length) throw new Error('No construct is measured by parcels.');
  const fitOf = (d: Dataset) => {
    const r = estimateCb(d, spec, 'casewise');
    const est = r.estimates.filter(
      (e) =>
        (e.op === '~' && spec.constructs.some((c) => c.name === e.lhs)) ||
        (e.op === '~~' &&
          e.lhs !== e.rhs &&
          spec.constructs.some((c) => c.name === e.lhs) &&
          spec.constructs.some((c) => c.name === e.rhs)),
    );
    return {
      fit: {
        'χ²': r.fit.chisq,
        CFI: r.fit.cfi,
        TLI: r.fit.tli,
        RMSEA: r.fit.rmsea,
        SRMR: r.fit.srmr,
      } as Record<string, number>,
      est: new Map(
        est.map((e) => [
          e.op === '~' ? `${e.rhs} → ${e.lhs}` : `${e.lhs} ↔ ${e.rhs}`,
          { std: e.std, sig: e.p !== null && e.p < 0.05 },
        ]),
      ),
    };
  };
  const current = fitOf(data);
  const rng = mulberry32(opts.seed);
  const runs: ReturnType<typeof fitOf>[] = [];
  let failed = 0;
  for (let a = 0; a < opts.allocations; a++) {
    const names = [...data.names],
      cols = [...data.cols];
    for (const t of targets) {
      randomParcels(t.items, t.sizes, rng).forEach((items, p) => {
        const k = names.indexOf(t.parcels[p]);
        if (k < 0) throw new Error(`Parcel "${t.parcels[p]}" is not in the data.`);
        cols[k] = rowMeans(data, items);
      });
    }
    try {
      runs.push(fitOf({ ...data, names, cols }));
    } catch {
      failed++;
    }
    if (a % 5 === 4 || a === opts.allocations - 1) {
      progress(a + 1, opts.allocations);
      await new Promise((r) => setTimeout(r));
    }
  }
  if (runs.length < 2) throw new Error('Too few allocations could be estimated.');
  return {
    allocations: runs.length,
    failed,
    fit: Object.keys(current.fit).map((k) =>
      spread(
        k,
        current.fit[k],
        runs.map((r) => r.fit[k]),
      ),
    ),
    estimates: [...current.est.keys()].map((k) =>
      spread(
        k,
        current.est.get(k)!.std,
        runs.map((r) => r.est.get(k)?.std ?? NaN).filter(Number.isFinite),
        runs.map((r) => !!r.est.get(k)?.sig),
      ),
    ),
  };
}
