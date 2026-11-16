// The index plot of influential cases: one dot per case while the cases fit
// the plot's width, otherwise the extremes of each pixel column plus every
// far-out case; far-out cases are drawn on top, the dots shrink with n.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { InfluenceResult } from '../rengine/screen';
import { indexPlotMarks } from './indexPlotMarks';
import { influenceAnalysis } from './screen';

const WIDTH = 448; // W - pad.l - pad.r in charts.tsx

/** Pixel positions of n cases spread over the width, as the plot places them. */
function positions(n: number): number[] {
  return Array.from({ length: n }, (_, i) => (n === 1 ? 0 : (i / (n - 1)) * WIDTH));
}

describe('indexPlotMarks', () => {
  it('draws every case when they fit, the far-out ones last', () => {
    const values = [0.1, 5, 0.2, 0.3, 7, 0.1];
    const marks = indexPlotMarks(positions(6), values, WIDTH, (v) => v > 1);
    expect(marks.thinned).toBe(false);
    expect(marks.radius).toBe(3);
    expect(marks.order).toEqual([0, 2, 3, 5, 1, 4]);
  });

  it('shrinks the dots as the cases get denser', () => {
    const at = (n: number) => {
      const values = new Array<number>(n).fill(1);
      return indexPlotMarks(positions(n), values, WIDTH, () => false).radius;
    };
    expect(at(100)).toBe(3);
    expect(at(200)).toBe(2);
    expect(at(400)).toBe(1.5);
  });

  it('keeps each pixel column’s largest and smallest value and every far-out case', () => {
    const n = 100_000;
    // A smooth wave plus noise-free spikes: rows 777 and 54321 far out.
    const values = Array.from({ length: n }, (_, i) => Math.sin(i / 50) + 2);
    values[777] = 40;
    values[54321] = 30;
    const isFar = (v: number) => v > 10;
    const xs = positions(n);
    const marks = indexPlotMarks(xs, values, WIDTH, isFar);
    expect(marks.thinned).toBe(true);
    expect(marks.radius).toBe(1.5);
    expect(marks.order.length).toBeLessThanOrEqual(2 * (WIDTH + 1) + 2);
    expect(marks.order.slice(-2).sort((a, b) => a - b)).toEqual([777, 54321]);

    // Every column's extremes are among the drawn cases.
    const drawn = new Set(marks.order);
    const hi = new Map<number, number>();
    const lo = new Map<number, number>();
    values.forEach((v, i) => {
      const col = Math.floor(xs[i]);
      hi.set(col, Math.max(hi.get(col) ?? -Infinity, v));
      lo.set(col, Math.min(lo.get(col) ?? Infinity, v));
    });
    for (const [col, v] of hi) {
      const found = marks.order.some((i) => Math.floor(xs[i]) === col && values[i] === v);
      expect(found, `column ${col} max`).toBe(true);
    }
    for (const [col, v] of lo) {
      const found = marks.order.some((i) => Math.floor(xs[i]) === col && values[i] === v);
      expect(found, `column ${col} min`).toBe(true);
    }
    expect(drawn.size).toBe(marks.order.length);
  });
});

describe('the index plot of influential cases', () => {
  function inf(n: number, far: number[]): InfluenceResult {
    const rows = Array.from({ length: n }, (_, i) => i + 1);
    const gcd = rows.map((r) => 0.01 + (r % 7) / 1000);
    for (const i of far) gcd[i] = 2;
    return {
      approach: 'approximate',
      rows,
      gcd,
      md: rows.map((r) => r % 5),
      chisq: rows.map(() => 0.1),
      cfi: rows.map(() => 0),
      rmsea: rows.map(() => 0),
      tli: rows.map(() => 0),
      warnings: [],
      engine: { package: 'semfindr', version: '0.2.1' } as InfluenceResult['engine'],
    } as InfluenceResult;
  }

  function plotSvg(result: InfluenceResult): string {
    const html = renderToStaticMarkup(
      <influenceAnalysis.View result={result} options={{ approach: 'approximate' }} current />,
    );
    const start = html.indexOf('aria-label="Index plot');
    return html.slice(start, html.indexOf('</svg>', start));
  }

  it('one dot per case for a small sample', () => {
    const svg = plotSvg(inf(50, [10]));
    // (the legend's two dots, Case and Far-out case, come first)
    const marks = svg.slice(svg.indexOf('class="plot-panel-group"'));
    expect(marks.match(/<circle/g)).toHaveLength(50);
    expect(svg).toContain('r="3"');
  });

  it('a bounded number of dots for 50,000 cases, the far-out cases among them, on top', () => {
    const svg = plotSvg(inf(50_000, [123, 45_678]));
    const circles = svg.match(/<circle[^>]*>.*?<\/circle>/g) ?? [];
    expect(circles.length).toBeLessThanOrEqual(2 * (WIDTH + 1) + 2);
    expect(circles.length).toBeGreaterThan(WIDTH);
    const last = circles.slice(-2).join('');
    expect(last).toContain('Row 124:');
    expect(last).toContain('Row 45679:');
  });
});
