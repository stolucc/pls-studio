import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../model/project';
import { boxStats, counts, groupsOf, histogram, niceStep, olsLine } from './chartStats';
import { quantileSorted } from '../engine/stats';
import { chartAnalysis, chartColumns, chartResult, MAX_POINTS, type ChartOptions } from './charts';
import type { Dataset } from '../engine/types';
import type { AnalysisCtx } from './types';

const data = {
  names: ['x', 'y', 'g', 't'],
  cols: [Float64Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, NaN]), Float64Array.from([2.1, 3.9, 6.2, 7.8, 10.1, 12.2, 13.8, 16.1, 18.0, 20]), Float64Array.from([1, 1, 2, 2, 1, 2, 1, 2, 1, 2]), Float64Array.from([1, 2, 1, 2, 3, 3, 1, 2, 3, 1])],
  categories: { t: ['a', 'b', 'c'] },
};
const ctx = (d: Dataset = data): AnalysisCtx => ({ data: d, info: null, settings: DEFAULT_SETTINGS, pls: null, projectName: 'p' });
const o = (p: Partial<ChartOptions>): ChartOptions => ({ ...chartAnalysis.defaults(ctx()), ...p });

describe('chart statistics', () => {
  it('bins with a round width (Sturges by default), the last bin closed', () => {
    const h = histogram(data.cols[0]);
    expect(h.n).toBe(9);
    expect(h.bins.reduce((s, b) => s + b.count, 0)).toBe(9);
    expect(h.bins[0].from).toBeLessThanOrEqual(1);
    expect(h.bins[h.bins.length - 1].to).toBeGreaterThanOrEqual(9);
    expect(h.mean).toBe(5);
    expect(histogram(data.cols[0], 3).bins.every((b) => Number.isFinite(b.count))).toBe(true);
    expect(histogram(Float64Array.from([4, 4, 4]))).toMatchObject({ bins: [{ from: 4, to: 4, count: 3 }], n: 3, mean: 4, sd: 0 });
    // A maximum on a bin edge falls into the last bin (closed): no lone trailing bar.
    const edge = histogram(Float64Array.from({ length: 11 }, (_, i) => i));
    expect(edge.bins.map((b) => b.count).reduce((a, b) => a + b, 0)).toBe(11);
    expect(edge.bins[edge.bins.length - 1].count).toBeGreaterThan(1);
    expect(edge.bins[edge.bins.length - 1].to).toBe(10);
    expect(histogram(Float64Array.from([NaN]))).toMatchObject({ bins: [], n: 0 });
    expect([0.3, 1.2, 2.2, 4, 7, 23].map(niceStep)).toEqual([0.5, 2, 2.5, 5, 10, 25]);
  });
  it('computes quartiles as R does and Tukey whiskers', () => {
    const s = [1, 2, 3, 4, 5, 6, 7, 8, 9, 100];
    expect(quantileSorted(s, 0.5)).toBe(5.5);
    expect(quantileSorted(s, 0.25)).toBe(3.25);
    const b = boxStats(Float64Array.from(s), 'all')!;
    expect(b).toMatchObject({ n: 10, median: 5.5, q1: 3.25, q3: 7.75, lo: 1, hi: 9, outliers: [100] });
    expect(boxStats(Float64Array.from([NaN]), 'x')).toBeNull();
  });
  it('fits a least-squares line over complete pairs', () => {
    const f = olsLine(data.cols[0], data.cols[1])!;
    expect(f.n).toBe(9);
    expect(f.slope).toBeCloseTo(2.0, 1);
    expect(f.r).toBeGreaterThan(0.99);
    expect(olsLine(Float64Array.from([1, 1, 1]), Float64Array.from([1, 2, 3]))).toBeNull();
    expect(olsLine(Float64Array.from([1, 2]), Float64Array.from([1, 2]))).toBeNull();
  });
  it('lists groups with category names and counts them', () => {
    expect(groupsOf(data, 't')).toEqual([{ label: 'a', value: 1 }, { label: 'b', value: 2 }, { label: 'c', value: 3 }]);
    expect(counts(data, 't')).toEqual([{ label: 'a', count: 4 }, { label: 'b', count: 3 }, { label: 'c', count: 3 }]);
    expect(groupsOf(data, 'y', 5)).toBeNull();
    expect(groupsOf(data, 'nope')).toBeNull();
  });
});

describe('chart card', () => {
  it('says what it needs, and takes the chart kind from the Add menu entries', () => {
    expect(chartAnalysis.blocked(o({}), ctx())).toMatch(/Choose a variable/);
    expect(chartAnalysis.blocked(o({ x: 'x' }), { ...ctx(), data: null })).toMatch(/raw data/);
    expect(chartAnalysis.blocked(o({ kind: 'scatter', x: 'x' }), ctx())).toMatch(/vertical axis/);
    expect(chartAnalysis.blocked(o({ kind: 'scatter', x: 'x', y: 'x' }), ctx())).toMatch(/two different/);
    expect(chartAnalysis.blocked(o({ x: 't' }), ctx())).toMatch(/text column/);
    const many = { names: ['x', 'm'], cols: [Float64Array.from({ length: 20 }, (_, i) => i), Float64Array.from({ length: 20 }, (_, i) => i * 2)] };
    expect(chartAnalysis.blocked(o({ kind: 'bar', x: 'm' }), ctx(many))).toMatch(/too many distinct values/);
    expect(chartAnalysis.blocked(o({ kind: 'box', x: 'x', group: 'm' }), ctx(many))).toMatch(/group by/);
    expect(chartAnalysis.blocked(o({ x: 'gone' }), ctx())).toMatch(/gone/);
    expect(chartAnalysis.blocked(o({ kind: 'scatter', x: 'x', y: 'y', group: 't' }), ctx())).toBeNull();
    const entries = chartAnalysis.entries!.map((e) => e.options(chartAnalysis.defaults(ctx())).kind);
    expect(entries).toEqual(['histogram', 'scatter', 'box', 'bar']);
    expect(chartAnalysis.parseOptions({ kind: 'pie', x: 'x', bins: 999, fit: 'yes' })).toEqual({ kind: 'histogram', x: 'x', y: '', group: '', bins: 200, fit: false });
    expect(chartColumns(o({ kind: 'scatter', x: 'x', y: 'y', group: 'g' }))).toEqual(['x', 'y', 'g']);
    expect(chartColumns(o({ kind: 'histogram', x: 'x', group: 'g' }))).toEqual(['x']);
    expect(chartAnalysis.cardTitle!(o({ kind: 'scatter', x: 'x', y: 'y' }))).toBe('Scatterplot: x and y');
    expect(chartAnalysis.summary(o({ kind: 'box', x: 'x', group: 'g' }))).toBe('box plot of x by g');
    expect(chartAnalysis.fingerprint(o({ kind: 'histogram', x: 'x', bins: 5 }), ctx())).not.toBe(chartAnalysis.fingerprint(o({ kind: 'histogram', x: 'x', bins: 6 }), ctx()));
  });
  it('computes each chart and renders it as SVG', async () => {
    const hist = await chartAnalysis.run(o({ x: 'x' }), ctx(), () => {});
    expect(hist).toMatchObject({ kind: 'histogram', x: 'x', n: 9 });
    const sc = chartResult(o({ kind: 'scatter', x: 'x', y: 'y', group: 't', fit: true }), data);
    expect(sc).toMatchObject({ kind: 'scatter', n: 9, omitted: 0, groups: ['a', 'b', 'c'] });
    if (sc.kind === 'scatter') { expect(sc.points[2].g).toBe(0); expect(sc.points[4].g).toBe(2); expect(sc.fit!.slope).toBeCloseTo(2, 1); }
    const box = chartResult(o({ kind: 'box', x: 'y', group: 'g' }), data);
    if (box.kind === 'box') expect(box.boxes.map((b) => [b.label, b.n])).toEqual([['1', 5], ['2', 5]]);
    const bar = chartResult(o({ kind: 'bar', x: 't' }), data);
    expect(bar).toMatchObject({ kind: 'bar', n: 10 });
    for (const r of [hist, sc, box, bar]) {
      const html = renderToStaticMarkup(<chartAnalysis.View result={r} options={o({})} current />);
      expect(html).toContain('<svg');
      expect(html).toContain('axis-title');
    }
    expect(renderToStaticMarkup(<chartAnalysis.View result={sc} options={o({})} current />)).toContain('fit-line');
  });
  it('caps the points it stores and counts the rest', () => {
    const n = MAX_POINTS + 7;
    const big = { names: ['a', 'b'], cols: [Float64Array.from({ length: n }, (_, i) => i), Float64Array.from({ length: n }, (_, i) => i % 13)] };
    const r = chartResult(o({ kind: 'scatter', x: 'a', y: 'b', fit: false }), big);
    expect(r).toMatchObject({ kind: 'scatter', n, omitted: 7, fit: null });
  });
});
