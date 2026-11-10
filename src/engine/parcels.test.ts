// Parcels against plain lavaan and semTools calls (scripts/validation/parcels.R) on the Big Five items of psych::bfi.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { estimateCb } from './cbsem';
import { parseCsv } from './dataset';
import { allocationVariability, balanceParcels, itemLoadings, parcelExpr, parcelItemsOf, parcelSizes, parcelTargets, randomParcels, serpentine } from './parcels';
import { mulberry32 } from './stats';
import type { Dataset, ModelSpec } from './types';
import { near } from '../validation/record';

const ROOT = join(__dirname, '..', '..');
const ref = JSON.parse(readFileSync(join(__dirname, '__fixtures__', 'parcels', 'reference.json'), 'utf8'));
const F = ['A', 'C', 'E', 'N', 'O'];
/** bfi with its negatively keyed items reversed (as the example's computed columns: 7 − x). */
const bfi = (): Dataset => {
  const d = parseCsv(readFileSync(join(ROOT, 'public', 'examples', 'samples', 'bfi.csv'), 'utf8')).dataset;
  const rev = (ref.reversed as string[]).map((k) => Float64Array.from(d.cols[d.names.indexOf(k)], (v) => 7 - v));
  return { ...d, names: [...d.names, ...(ref.reversed as string[]).map((k) => `${k}r`)], cols: [...d.cols, ...rev] };
};
const mean = (d: Dataset, items: string[]) => Float64Array.from({ length: d.cols[0].length }, (_, r) => items.reduce((s, i) => s + d.cols[d.names.indexOf(i)][r], 0) / items.length);

/** The data with these parcels as computed columns, and the five-factor CFA on them. */
function parcelled(groups: Record<string, string[][]>, tag: string) {
  const d = bfi();
  const computed = F.flatMap((f) => groups[f].map((items, p) => ({ name: `${f}_${tag}${p + 1}`, expr: parcelExpr(items) })));
  const data: Dataset = { ...d, names: [...d.names, ...computed.map((c) => c.name)], cols: [...d.cols, ...computed.map((c) => mean(d, parcelItemsOf(c.expr)!))] };
  const spec: ModelSpec = { constructs: F.map((f) => ({ name: f, mode: 'A' as const, type: 'factor' as const, indicators: groups[f].map((_, p) => `${f}_${tag}${p + 1}`) })), paths: [] };
  return { data, spec, computed };
}

describe('item-to-construct balance', () => {
  it('deals in serpentine order', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((r) => serpentine(r, 3))).toEqual([0, 1, 2, 2, 1, 0, 0]);
    expect(balanceParcels([{ item: 'a', loading: 0.9 }, { item: 'b', loading: 0.8 }, { item: 'c', loading: 0.7 }, { item: 'd', loading: 0.6 }], 2)).toEqual([['a', 'd'], ['b', 'c']]);
  });
  it.each(F)('reproduces lavaan’s loadings and allocations for %s', (f) => {
    const l = itemLoadings(bfi(), ref.items[f]);
    for (const x of l) expect(x.loading, x.item).toBeCloseTo(ref.balance[f].loadings[x.item], 3);
    expect(balanceParcels(l, 3)).toEqual(ref.balance[f].parcels);
    expect(balanceParcels(l, 2)).toEqual(ref.balance2[f]);
  });
});

describe('random allocation', () => {
  it('keeps the sizes and uses every item once, reproducibly', () => {
    const items = ['a', 'b', 'c', 'd', 'e', 'f', 'g'], sizes = parcelSizes(7, 3);
    expect(sizes).toEqual([3, 2, 2]);
    const a = randomParcels(items, sizes, mulberry32(1));
    expect(randomParcels(items, sizes, mulberry32(1))).toEqual(a);
    expect(a.map((p) => p.length)).toEqual(sizes);
    expect(a.flat().sort()).toEqual(items);
    expect(randomParcels(items, sizes, mulberry32(2))).not.toEqual(a);
  });
});

describe('parcels in the model', () => {
  it('fit as lavaan fits them, a proper solution', () => {
    const { data, spec } = parcelled(Object.fromEntries(F.map((f) => [f, ref.balance[f].parcels])), 'P');
    const r = estimateCb(data, spec, 'casewise');
    expect(r.n).toBe(ref.n);
    expect(r.fit.chisq).toBeCloseTo(ref.fit.chisq, 1);
    expect(r.fit.df).toBe(ref.fit.df);
    expect(r.fit.cfi).toBeCloseTo(ref.fit.cfi, 3);
    expect(r.fit.rmsea).toBeCloseTo(ref.fit.rmsea, 3);
  });
  it('are found from their formulas, and a construct with a plain item is not one', () => {
    const { spec, computed } = parcelled(Object.fromEntries(F.map((f) => [f, ref.balance[f].parcels])), 'P');
    expect(parcelTargets(spec, computed).map((t) => [t.construct, t.items.length, t.sizes])).toEqual(F.map((f) => [f, 5, [1, 2, 2]]));
    const mixed = { ...spec, constructs: spec.constructs.map((c, i) => (i === 0 ? { ...c, indicators: ['A3', ...c.indicators.slice(1)] } : c)) };
    expect(parcelTargets(mixed, computed).map((t) => t.construct)).not.toContain('A');
    expect(parcelItemsOf('mean(a, b)')).toEqual(['a', 'b']);
    expect(parcelItemsOf('a + b')).toBeNull();
  });
  it('vary over random allocations as semTools::parcelAllocation finds', async () => {
    const { data, spec, computed } = parcelled(Object.fromEntries(F.map((f) => [f, ref.balance2[f]])), 'Q');
    const r = await allocationVariability(data, spec, parcelTargets(spec, computed), { allocations: 100, seed: 12345 });
    expect(r.allocations + r.failed).toBe(100);
    const row = (k: string) => r.fit.find((x) => x.label === k)!;
    // (different random allocations: the averages agree to within a fraction of their spread)
    for (const [mine, theirs] of [['CFI', 'cfi'], ['χ²', 'chisq'], ['RMSEA', 'rmsea'], ['SRMR', 'srmr']] as const) {
      const t = ref.allocation2[theirs];
      near(`${mine}: mean over allocations (within half an SD; random)`, row(mine).mean, t.Avg, 0.5 * t.SD);
      near(`${mine}: SD over allocations (within 35%; random)`, row(mine).sd, t.SD, 0.35 * t.SD);
    }
    expect(r.estimates.map((e) => e.label)).toContain('A ↔ C');
  }, 300_000);
});

describe('the example card', () => {
  it('is the reference model, and states what the app computes', async () => {
    const { PACKAGE_EXAMPLES, exampleModel } = await import('../examples/packages');
    const { DEFAULT_SETTINGS, toSpec } = await import('../model/project');
    const ex = PACKAGE_EXAMPLES.find((e) => e.id === 'parcels-bfi')!;
    expect(ex.computed!.filter((c) => /^7 - /.test(c.expr)).map((c) => c.name)).toEqual((ref.reversed as string[]).map((k) => `${k}r`));
    for (const f of F) expect(ex.computed!.filter((c) => c.name.startsWith(`${f}_P`)).map((c) => parcelItemsOf(c.expr))).toEqual(ref.balance[f].parcels);
    const { data, spec, computed } = parcelled(Object.fromEntries(F.map((f) => [f, ref.balance[f].parcels])), 'P');
    expect(toSpec(exampleModel(ex)).constructs.map((k) => k.indicators)).toEqual(spec.constructs.map((k) => k.indicators));
    const r = await allocationVariability(data, { ...spec, covariances: toSpec(exampleModel(ex)).covariances }, parcelTargets(spec, computed), { allocations: 100, seed: DEFAULT_SETTINGS.seed });
    const cfi = r.fit.find((x) => x.label === 'CFI')!, x2 = r.fit.find((x) => x.label === 'χ²')!, ac = r.estimates.find((x) => x.label === 'A ↔ C')!;
    for (const v of [ref.itemFit.cfi, cfi.current, cfi.min, cfi.max, cfi.mean, x2.min, x2.max, ac.min, ac.max]) expect(ex.shows).toContain(v.toFixed(3));
    expect(ex.shows).toContain(`${Math.round(cfi.percentile * 100)}%`);
  }, 300_000);
});

describe('allocation guards', () => {
  it('refuses a parcel that is not in the data instead of writing past the columns', async () => {
    const { data, spec, computed } = parcelled(Object.fromEntries(F.map((f) => [f, ref.balance[f].parcels])), 'P');
    const targets = parcelTargets(spec, computed).map((t, i) => (i === 0 ? { ...t, parcels: ['nope', ...t.parcels.slice(1)] } : t));
    const r = await allocationVariability(data, spec, targets, { allocations: 3, seed: 1 }).catch((e: Error) => e);
    expect(r instanceof Error ? r.message : '').toMatch(/Too few allocations|not in the data/);
  });
});
