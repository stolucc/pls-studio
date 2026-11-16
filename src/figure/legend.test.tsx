import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { legendHeight, legendLayout, SvgLegend, type LegendItem } from './legend';

const items = (n: number): LegendItem[] =>
  Array.from({ length: n }, (_, k) => ({ label: `Series ${k + 1}`, color: `#00000${k}` }));

describe('the chart legend', () => {
  it('wraps into rows at the width it is given', () => {
    const at = legendLayout(items(6), 200);
    expect(at[0]).toEqual({ x: 0, row: 0 });
    expect(Math.max(...at.map((p) => p.row))).toBeGreaterThan(0);
    for (const p of at) expect(p.x).toBeLessThan(200);
    expect(legendHeight(items(6), 200)).toBeGreaterThan(legendHeight(items(2), 200));
  });

  it('takes no room and draws nothing with fewer than two series', () => {
    expect(legendHeight(items(1), 400)).toBe(0);
    expect(
      renderToStaticMarkup(<svg>{<SvgLegend items={items(1)} x={0} y={0} width={400} />}</svg>),
    ).toBe('<svg></svg>');
  });

  it('draws a swatch with each series’ mark and its label, inside the SVG', () => {
    const out = renderToStaticMarkup(
      <svg>
        <SvgLegend
          items={[
            { label: 'PLS', color: '#2a78d6' },
            { label: 'True model', color: '#eb6834', mark: 'dash' },
            { label: 'Group 1', color: '#1baf7a', mark: 'box' },
            { label: 'Significant', color: '#eda100', mark: 'dot' },
          ]}
          x={10}
          y={5}
          width={500}
        />
      </svg>,
    );
    expect(out).toContain('aria-label="Legend"');
    for (const l of ['PLS', 'True model', 'Group 1', 'Significant'])
      expect(out).toContain(`>${l}</text>`);
    expect(out).toContain('stroke-dasharray="4 3"');
    expect(out).toContain('<rect');
    expect(out).toContain('<circle');
  });
});
