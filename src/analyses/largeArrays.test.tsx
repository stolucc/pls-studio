// Per-case arrays of 200,000 values: the smallest and largest are found
// without spreading the array into Math.min / Math.max (which overflows the
// stack above roughly 125,000 values), and the Q-Q plot draws at most 1,000
// points, not one circle per case.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { extent } from '../format';
import type { InfluenceResult } from '../rengine/screen';
import { qqPlot } from './chartStats';
import { scoreSummary } from './cbModel';
import { explorePlots, PlotsView, exploreAnalysis, type ExploreCardResult } from './explore';
import { columnStats } from './mixtureSyntax';
import { influenceAnalysis } from './screen';
import type { AnalysisCtx } from './types';
import { DEFAULT_SETTINGS } from '../model/project';

const N = 200_000;
// Values 0..999 (repeated), one of them far out.
const values = Float64Array.from({ length: N }, (_, i) => (i === 1234 ? 5000 : i % 1000));

describe('200,000 values', () => {
  it('extent finds the smallest and largest', () => {
    expect(extent(values)).toEqual([0, 5000]);
    expect(extent([])).toEqual([Infinity, -Infinity]);
  });

  it('the starting-value statistics of a mixture model count the levels in one pass', () => {
    const d = { names: ['x'], cols: [values] };
    const s = columnStats(d, 'x');
    expect(s.min).toBe(0);
    expect(s.max).toBe(5000);
    expect(s.levels).toHaveLength(1001);
    expect(s.counts[0]).toBe(200);
    expect(s.counts.reduce((a, b) => a + b, 0)).toBe(N);
  });

  it('the factor score summary', () => {
    const summary = scoreSummary({
      method: 'regression',
      names: ['F'],
      rows: Array.from({ length: N }, (_, i) => i + 1),
      scores: [Array.from(values)],
      warnings: [],
      engine: { package: 'lavaan', version: '0.6-19' },
    } as Parameters<typeof scoreSummary>[0]);
    expect(summary.stats[0]).toMatchObject({ min: 0, max: 5000, n: N });
  });

  it('the Q-Q plot: at most 1,000 points with the extremes, also from a result stored with every case', () => {
    const ctx: AnalysisCtx = {
      data: { names: ['y'], cols: [values] },
      info: null,
      settings: DEFAULT_SETTINGS,
      pls: null,
      projectName: 'p',
    };
    const o = { ...exploreAnalysis.defaults(ctx), vars: ['y'] };
    const [plot] = explorePlots(o, ctx.data!);
    expect(plot.qq!.points).toHaveLength(1000);
    expect(plot.qq!.points[0].sample).toBe(0);
    expect(plot.qq!.points.at(-1)!.sample).toBe(5000);

    const stored = { ...plot, qq: qqPlot(values) };
    expect(stored.qq!.points).toHaveLength(N);
    const r = { vars: ['y'], groups: [], plots: [stored] } as unknown as ExploreCardResult;
    const html = renderToStaticMarkup(<PlotsView r={r} />);
    const qqSvg = html.slice(html.indexOf('aria-label="Q-Q plot'));
    const circles = qqSvg.slice(0, qqSvg.indexOf('</svg>')).match(/<circle/g) ?? [];
    expect(circles.length).toBeLessThanOrEqual(1000);
  });

  it('the index plot of influential cases', () => {
    const rows = Array.from({ length: N }, (_, i) => i + 1);
    const inf: InfluenceResult = {
      approach: 'approximate',
      rows,
      gcd: Array.from(values, (v) => v / 1000),
      md: Array.from(values),
      chisq: rows.map(() => 0.1),
      cfi: rows.map(() => 0),
      rmsea: rows.map(() => 0),
      tli: rows.map(() => 0),
      warnings: [],
      engine: { package: 'semfindr', version: '0.2.1' } as InfluenceResult['engine'],
    };
    const html = renderToStaticMarkup(
      <influenceAnalysis.View result={inf} options={{ approach: 'approximate' }} current />,
    );
    expect(html).toContain('Index plot of Generalized Cook’s distance');
  });
});
