// @vitest-environment happy-dom
// The influential-cases card's result: the table, an index plot (ChartFrame), excluding one case, and the cases'
// contributions to Mardia's multivariate kurtosis (absent in results saved before it).

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { figureOf } from './figureOf';
import type { InfluenceResult } from '../rengine/screen';
import { influenceAnalysis } from './screen';

const gg = vi.hoisted(() => ({
  file: vi.fn(async (_spec: unknown) => new Blob(['%PDF-'])),
  script: vi.fn(async () => ''),
}));
vi.mock('../figure/ggplot', () => ({ ggplotFile: gg.file, ggplotScript: gg.script }));

const n = 12,
  rows = Array.from({ length: n }, (_, i) => i + 1);
const base: InfluenceResult = {
  approach: 'exact',
  rows,
  gcd: rows.map((r) => (r === 7 ? 5 : r / 100)),
  md: rows.map((r) => r),
  chisq: rows.map(() => 0.1),
  cfi: rows.map(() => -0.01),
  rmsea: rows.map(() => 0.002),
  tli: rows.map(() => 0),
  warnings: [],
  engine: { package: 'semfindr', version: '0.2.1' } as InfluenceResult['engine'],
};

describe('influential cases view', () => {
  it('draws the index plot with the far-out case in red and offers to exclude one case', async () => {
    const h = renderToStaticMarkup(
      <influenceAnalysis.View result={base} options={{ approach: 'exact' }} current />,
    );
    expect(h).toContain('Most influential cases');
    expect(h).toContain('Index plot of Generalized Cook’s distance');
    expect(h).toContain('Row 7: 5');
    expect(h).toContain('#e34948');
    // (the key and the plot panel, inside the chart's SVG so an exported figure keeps them)
    const from = h.indexOf('aria-label="Index plot');
    const svg = h.slice(from, h.indexOf('</svg>', from));
    expect(svg).toContain('aria-label="Legend"');
    for (const label of ['Case', 'Far-out case', 'Q3 + 3 IQR'])
      expect(svg).toContain(`>${label}</text>`);
    expect(svg).toContain('class="plot-panel"');
    expect(h).toContain('Exclude row');
    expect(h).toContain('Exclude the 1 far-out case');
    // (no kurtosis contributions in a result saved before them: neither the table nor the plot's choice)
    expect(h).not.toContain('Contributions to multivariate kurtosis');
    expect(h).not.toContain('Contribution to Mardia’s kurtosis');
    // (ggplot2 draws the same: stems and dots of the cases and the far-out case, and the fence)
    const spec = await figureOf(
      <influenceAnalysis.View result={base} options={{ approach: 'exact' }} current />,
      'Index plot',
      gg.file,
    );
    expect(spec.title).toBe('Index plot of Generalized Cook’s distance');
    expect(spec.x.title).toBe('Row');
    expect(spec.layers.map((l) => `${l.geom}:${l.series ?? ''}`)).toEqual([
      'segment:',
      'point:Case',
      'segment:',
      'point:Far-out case',
      'hline:Q3 + 3 IQR',
    ]);
    expect(spec.layers[3]).toMatchObject({ x: [7], y: [5], color: '#e34948' });
    expect(spec.layers[4].linetype).toBe('dashed');
  });
  it('lists the cases contributing most to Mardia’s b₂,ₚ', () => {
    const contribution = rows.map((r) => (r === 3 ? 20 : 1));
    const b2p = contribution.reduce((a, b) => a + b, 0);
    const h = renderToStaticMarkup(
      <influenceAnalysis.View
        result={{ ...base, kurtosis: { rows, contribution, b2p, p: 2 } }}
        options={{ approach: 'exact' }}
        current
      />,
    );
    expect(h).toContain(
      `Contributions to multivariate kurtosis (Mardia’s b₂,ₚ = ${b2p.toFixed(3)})`,
    );
    expect(h).toContain('Contribution to Mardia’s kurtosis');
    // Row 3: 20 / 31 of b₂,ₚ, 30 times a case's expected 8 / 12.
    expect(h).toMatch(/64\.5%/);
    expect(h).toContain('30.0');
  });
});
