import { describe, expect, it } from 'vitest';
import { constructGeometry, pathSegment, quadraticSegment } from '../geometry';
import type { Construct } from '../model/project';
import { renderFigureSvg, type FigureInput } from './render';
import { DEFAULT_FIGURE_STYLE, estimateText, FIGURE_PRESETS, parseFigureStyle, pathStrokeWidth } from './style';

const C = (id: string, name: string, x: number, type: 'factor' | 'composite' = 'factor'): Construct =>
  ({ id, name, type, mode: type === 'factor' ? 'A' : 'B', indicators: [`${id}1`, `${id}2`], x, y: 0, side: 'left' });

function input(): FigureInput {
  const a = C('a', 'Trust & <Risk>', 0), b = C('b', 'Loyalty', 400, 'composite');
  return {
    constructs: [
      { c: a, geom: constructGeometry(a), r2: null, indicators: [{ value: 1, p: null, fixed: true }, { value: 0.812, p: null }] },
      { c: b, geom: constructGeometry(b), r2: 0.4321, indicators: [{ value: 0.6, p: null }, null] },
    ],
    paths: [{ ...pathSegment(a, b)!, label: { value: -0.2468, p: 0.0004 }, moderated: false }],
    moderations: [], higherOrder: [], errors: [], correlations: [],
  };
}

describe('figure style', () => {
  it('formats estimates as asked', () => {
    expect(estimateText(DEFAULT_FIGURE_STYLE, 0.4468, 0.0002)).toBe('0.447 (p < .001)');
    expect(estimateText({ ...DEFAULT_FIGURE_STYLE, pFormat: 'stars', decimals: 2 }, 0.4468, 0.02)).toBe('0.45*');
    expect(estimateText({ ...DEFAULT_FIGURE_STYLE, pFormat: 'none' }, 0.4468, 0.02)).toBe('0.447');
  });
  it('validates untrusted styles', () => {
    const s = parseFigureStyle({ font: 'comic', pathWidth: 99, constructFill: 'red', labelBoxes: 'yes', constructStroke: '#ABCDEF' });
    expect(s.font).toBe('helvetica');
    expect(s.pathWidth).toBe(8);
    expect(s.constructFill).toBe(DEFAULT_FIGURE_STYLE.constructFill);
    expect(s.labelBoxes).toBe(DEFAULT_FIGURE_STYLE.labelBoxes);
    expect(s.constructStroke).toBe('#abcdef');
    expect(parseFigureStyle(FIGURE_PRESETS.publication.style)).toEqual(FIGURE_PRESETS.publication.style);
  });
  it('scales path width with the effect only when asked', () => {
    expect(pathStrokeWidth({ ...DEFAULT_FIGURE_STYLE, pathWidthByEffect: false }, 0.9)).toBe(DEFAULT_FIGURE_STYLE.pathWidth);
    expect(pathStrokeWidth(DEFAULT_FIGURE_STYLE, 0.9)).toBeGreaterThan(pathStrokeWidth(DEFAULT_FIGURE_STYLE, 0.1));
  });
});

describe('figure SVG', () => {
  it('draws shapes, indicators, labels and arrows with the style, escaping text', () => {
    const style = FIGURE_PRESETS.publication.style;
    const { svg, width, height } = renderFigureSvg(input(), style);
    expect(width).toBeGreaterThan(400);
    expect(height).toBeGreaterThan(60);
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
    expect(svg).toContain('<ellipse');
    expect(svg).toContain('<polygon');                       // composite hexagon
    expect(svg).toContain('Trust &amp; &lt;Risk&gt;');       // escaped
    expect(svg).toContain('R² = 0.43');                       // publication: 2 decimals
    expect(svg).toContain('>-0.25***<');                      // stars
    expect(svg).toContain('stroke-dasharray="2 2"');          // fixed marker loading
    expect(svg).toContain('>1<');
    expect(svg).toContain(`font-family='"Times New Roman", Times, serif'`);
    expect(svg).not.toContain('#6366f1');                     // default colours replaced
  });
  it('draws observed variables (conditional process analysis) as rectangles', () => {
    const f = input();
    f.constructs = f.constructs.map((x) => ({ ...x, observed: true }));
    const { svg } = renderFigureSvg(f, DEFAULT_FIGURE_STYLE);
    expect(svg).not.toContain('<ellipse');
    expect(svg).not.toContain('<polygon');
  });
  it('hides estimates but keeps the fixed marker when asked', () => {
    const { svg } = renderFigureSvg(input(), { ...DEFAULT_FIGURE_STYLE, showEstimates: false, showR2: false });
    expect(svg).not.toContain('0.812');
    expect(svg).not.toContain('R²');
    expect(svg).toContain('>1<');
  });

  it('draws a quadratic term as a labelled badge beside the path, with its estimate next to it', () => {
    const f = input();
    const seg = f.paths[0];
    const q = quadraticSegment(seg);
    f.paths[0].moderated = true;
    f.moderations = [{ x1: q.x1, y1: q.y1, x2: q.x2, y2: q.y2, label: { value: 0.1234, p: 0.03 }, badge: { x: q.bx, y: q.by, text: 'Trust & <Risk>²', w: 120 } }];
    const { svg } = renderFigureSvg(f, { ...DEFAULT_FIGURE_STYLE, pFormat: 'stars' });
    expect(svg).toContain('>Trust &amp; &lt;Risk&gt;²</text>');
    expect(svg).toMatch(/<rect [^>]*stroke-dasharray="4 3"\/>/);
    expect(svg).toContain('>0.123*</text>');
    // The estimate is placed to the right of the badge, not on the arrow.
    const x = Number(/<text x="([\d.-]+)"[^>]*>0\.123\*<\/text>/.exec(svg)![1]);
    expect(x).toBeGreaterThan(q.bx + 60);
  });
});

describe('implied main effects in the figure', () => {
  it('draws a moderator’s implied main effect dashed, drawn paths solid', () => {
    const base = input();
    const line = (svg: string) => svg.match(/<line [^>]*\/>/g) ?? [];
    const solid = renderFigureSvg(base, DEFAULT_FIGURE_STYLE).svg;
    expect(line(solid).some((l) => l.includes('stroke-dasharray'))).toBe(false);
    const dashed = renderFigureSvg({ ...base, paths: [{ ...base.paths[0], implied: true }] }, DEFAULT_FIGURE_STYLE).svg;
    expect(line(dashed).some((l) => l.includes('stroke-dasharray="5 4"'))).toBe(true);
  });
});
