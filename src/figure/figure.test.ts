import { describe, expect, it } from 'vitest';
import { BOX_RX, constructGeometry, pathSegment, quadraticLoop } from '../geometry';
import type { Construct } from '../model/project';
import { R2_ABOVE_BOX_SIZE, renderFigureSvg, type FigureInput } from './render';
import {
  DEFAULT_FIGURE_STYLE,
  estimateText,
  FIGURE_PRESETS,
  figureForMethod,
  formatEstimate,
  isPlainFigure,
  matchPreset,
  semplotEdge,
  parseFigureStyle,
  pathStrokeWidth,
  significanceText,
} from './style';

const C = (
  id: string,
  name: string,
  x: number,
  type: 'factor' | 'composite' = 'factor',
): Construct => ({
  id,
  name,
  type,
  mode: type === 'factor' ? 'A' : 'B',
  indicators: [`${id}1`, `${id}2`],
  x,
  y: 0,
  side: 'left',
});

function input(): FigureInput {
  const a = C('a', 'Trust & <Risk>', 0),
    b = C('b', 'Loyalty', 400, 'composite');
  return {
    constructs: [
      {
        c: a,
        geom: constructGeometry(a),
        r2: null,
        indicators: [
          { value: 1, p: null, fixed: true },
          { value: 0.812, p: null },
        ],
      },
      { c: b, geom: constructGeometry(b), r2: 0.4321, indicators: [{ value: 0.6, p: null }, null] },
    ],
    paths: [{ ...pathSegment(a, b)!, label: { value: -0.2468, p: 0.0004 }, moderated: false }],
    moderations: [],
    higherOrder: [],
    errors: [],
    correlations: [],
  };
}

describe('figure style', () => {
  it('formats estimates as asked', () => {
    expect(estimateText(DEFAULT_FIGURE_STYLE, 0.4468, 0.0002)).toBe('0.447 (p < .001)');
    expect(
      estimateText({ ...DEFAULT_FIGURE_STYLE, pFormat: 'stars', decimals: 2 }, 0.4468, 0.02),
    ).toBe('0.45*');
    expect(estimateText({ ...DEFAULT_FIGURE_STYLE, pFormat: 'none' }, 0.4468, 0.02)).toBe('0.447');
  });
  it('validates untrusted styles', () => {
    const s = parseFigureStyle({
      font: 'comic',
      pathWidth: 99,
      constructFill: 'red',
      labelBoxes: 'yes',
      constructStroke: '#ABCDEF',
    });
    expect(s.font).toBe('helvetica');
    expect(s.pathWidth).toBe(8);
    expect(s.constructFill).toBe(DEFAULT_FIGURE_STYLE.constructFill);
    expect(s.labelBoxes).toBe(DEFAULT_FIGURE_STYLE.labelBoxes);
    expect(s.constructStroke).toBe('#abcdef');
    expect(parseFigureStyle(FIGURE_PRESETS.publication.style)).toEqual(
      FIGURE_PRESETS.publication.style,
    );
  });
  it('scales path width with the effect only when asked', () => {
    expect(pathStrokeWidth({ ...DEFAULT_FIGURE_STYLE, pathWidthByEffect: false }, 0.9)).toBe(
      DEFAULT_FIGURE_STYLE.pathWidth,
    );
    expect(pathStrokeWidth(DEFAULT_FIGURE_STYLE, 0.9)).toBeGreaterThan(
      pathStrokeWidth(DEFAULT_FIGURE_STYLE, 0.1),
    );
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
    expect(svg).toContain('<polygon'); // composite hexagon
    expect(svg).toContain('Trust &amp; &lt;Risk&gt;'); // escaped
    expect(svg).toContain('R² = 0.43'); // publication: 2 decimals
    expect(svg).toContain('>-0.25***<'); // stars
    expect(svg).toContain('stroke-dasharray="2 2"'); // fixed marker loading
    expect(svg).toContain('>1<');
    expect(svg).toContain(`font-family='"Times New Roman", Times, serif'`);
    expect(svg).not.toContain('#6366f1'); // default colours replaced
  });
  it('draws observed variables (conditional process analysis) as rectangles', () => {
    const f = input();
    f.constructs = f.constructs.map((x) => ({ ...x, observed: true }));
    const { svg } = renderFigureSvg(f, DEFAULT_FIGURE_STYLE);
    expect(svg).not.toContain('<ellipse');
    expect(svg).not.toContain('<polygon');
  });
  it('draws indicator and observed-variable boxes almost square, not rounded', () => {
    const f = input(),
      style = { ...DEFAULT_FIGURE_STYLE, indicatorFill: '#123456' };
    const radii = [
      ...renderFigureSvg(f, style).svg.matchAll(/<rect [^>]*rx="([\d.]+)" fill="#123456"/g),
    ].map((m) => m[1]);
    expect(radii).toHaveLength(4); // two indicators on each construct
    expect(new Set(radii)).toEqual(new Set([String(BOX_RX)]));
    f.constructs = f.constructs.map((x) => ({ ...x, observed: true }));
    expect(renderFigureSvg(f, style).svg).toMatch(
      new RegExp(`<rect [^>]*height="[\\d.]+" rx="${BOX_RX}"`),
    );
    expect(BOX_RX).toBeLessThanOrEqual(1);
  });
  it('hides estimates but keeps the fixed marker when asked', () => {
    const { svg } = renderFigureSvg(input(), {
      ...DEFAULT_FIGURE_STYLE,
      showEstimates: false,
      showR2: false,
    });
    expect(svg).not.toContain('0.812');
    expect(svg).not.toContain('R²');
    expect(svg).toContain('>1<');
  });

  it('draws a quadratic effect as a dashed loop from X onto its path, tagged X², estimate at the apex', () => {
    const f = input();
    const a = f.constructs[0].c;
    const q = quadraticLoop(a, f.paths[0]);
    f.paths[0].moderated = true;
    f.moderations = [
      {
        x1: q.x1,
        y1: q.y1,
        x2: q.x2,
        y2: q.y2,
        label: { value: 0.1234, p: 0.03 },
        loop: { ...q, tag: 'Trust & <Risk>²' },
      },
    ];
    const { svg } = renderFigureSvg(f, { ...DEFAULT_FIGURE_STYLE, pFormat: 'stars' });
    expect(svg).toContain(`<path d="${q.d}" fill="none"`);
    expect(svg).toMatch(
      /<path d="M [^"]+ C [^"]+" fill="none" stroke="[^"]+" stroke-width="[\d.]+" stroke-dasharray="6 4"\/>/,
    );
    expect(svg).toContain('font-style="italic" font-weight="bold" text-anchor="middle"');
    expect(svg).toContain('>Trust &amp; &lt;Risk&gt;²</text>');
    // The estimate sits on the loop's apex.
    const m = /<text x="([\d.-]+)" y="([\d.-]+)"[^>]*>0\.123\*<\/text>/.exec(svg)!;
    expect(Number(m[1])).toBeCloseTo(q.lx, 0);
    expect(Math.abs(Number(m[2]) - q.ly)).toBeLessThan(6);
  });
});

describe('built-in styles', () => {
  const colours = (svg: string) =>
    new Set([...svg.matchAll(/(?:fill|stroke)="(#[0-9a-f]{6})"/g)].map((m) => m[1]));
  const allBits = (): FigureInput => {
    const f = input();
    f.constructs[0].indicators = [
      { value: 1, p: null, fixed: true },
      { value: 0.812, p: 0.2 },
    ];
    f.errors = [
      { kind: 'indicator', value: null, term: { cx: -200, cy: 0, nx: 1, ny: 0, ax: -170, ay: 0 } },
      {
        kind: 'indicator',
        value: null,
        term: { cx: -200, cy: 40, nx: 1, ny: 0, ax: -170, ay: 40 },
      },
    ] as FigureInput['errors'];
    return f;
  };

  it('keeps the current style as the default, and offers Classic and Amos', () => {
    expect(FIGURE_PRESETS.default.style).toBe(DEFAULT_FIGURE_STYLE);
    expect(DEFAULT_FIGURE_STYLE.constructStroke).toBe('#6366f1');
    expect(DEFAULT_FIGURE_STYLE.notation).toBe('standard');
    for (const k of ['classic', 'amos'])
      expect(parseFigureStyle(FIGURE_PRESETS[k].style)).toEqual(FIGURE_PRESETS[k].style);
    expect(parseFigureStyle({}).notation).toBe('standard'); // older project files
  });
  it('Classic draws only black on white', () => {
    expect(colours(renderFigureSvg(allBits(), FIGURE_PRESETS.classic.style).svg)).toEqual(
      new Set(['#000000', '#ffffff']),
    );
    expect(renderFigureSvg(allBits(), FIGURE_PRESETS.classic.style).svg).not.toContain(
      'linearGradient',
    );
    expect(isPlainFigure(FIGURE_PRESETS.classic.style)).toBe(true);
    expect(isPlainFigure(FIGURE_PRESETS.amos.style)).toBe(true);
    expect(isPlainFigure(DEFAULT_FIGURE_STYLE)).toBe(false);
    expect(isPlainFigure(FIGURE_PRESETS.greyscale.style)).toBe(false);
  });
  it('Classic draws every path the same width', () => {
    expect(pathStrokeWidth(FIGURE_PRESETS.classic.style, 0.9)).toBe(
      pathStrokeWidth(FIGURE_PRESETS.classic.style, 0.1),
    );
  });
  it('Amos fills every shape with its left-to-right gradient, with black lines and text', () => {
    const { svg } = renderFigureSvg(allBits(), FIGURE_PRESETS.amos.style);
    expect(svg).toContain(
      '<linearGradient id="figure-fill-construct"><stop offset="0" stop-color="#e2ebec"/><stop offset="1" stop-color="#ecd5f4"/></linearGradient>',
    );
    expect(svg).toMatch(
      /<ellipse [^>]*fill="url\(#figure-fill-construct\)" stroke="#000000" stroke-width="1.5"/,
    );
    expect(svg).toMatch(
      /<rect [^>]*fill="url\(#figure-fill-indicator\)" stroke="#000000" stroke-width="1.5"/,
    );
    expect(svg).toMatch(/<circle [^>]*fill="url\(#figure-fill-indicator\)"/);
    expect(colours(svg)).toEqual(new Set(['#000000', '#ffffff'])); // the stops apart
    expect(
      [...svg.matchAll(/<text [^>]*fill="(#[0-9a-f]{6})"/g)].every((m) => m[1] === '#000000'),
    ).toBe(true);
  });
  it('Amos notation slides a correlation label off an indicator box, and fits R² in the gap between stacked boxes', () => {
    const f = input(),
      b = f.constructs[0].geom.indicators[0],
      a = f.constructs[0].c;
    const box = { x: a.x + b.x, y: a.y + b.y, w: b.w, h: b.h };
    const mid = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
    f.correlations = [
      {
        d: 'M 0 0',
        heads: [],
        lx: mid.x,
        ly: mid.y,
        nx: 0,
        ny: 0,
        points: [
          [mid.x, mid.y - 300],
          [mid.x, mid.y + 300],
          [mid.x, mid.y],
        ],
        label: { value: 0.41, p: null },
      },
    ];
    const m = /<text x="[\d.-]+" y="([\d.-]+)"[^>]*>\.41<\/text>/.exec(
      renderFigureSvg(f, FIGURE_PRESETS.amos.style).svg,
    )!;
    expect(Number(m[1]) > box.y + box.h || Number(m[1]) < box.y).toBe(true);
    f.correlations = [];
    f.errors = [
      {
        kind: 'indicator',
        value: 0.36,
        r2: 0.64,
        name: b.name,
        term: { cx: -200, cy: 0, nx: -1, ny: 0, ax: -170, ay: 0 },
      },
    ];
    const r = /<text x="[\d.-]+" y="([\d.-]+)" font-size="([\d.]+)"[^>]*>\.64<\/text>/.exec(
      renderFigureSvg(f, FIGURE_PRESETS.amos.style).svg,
    )!;
    expect(Number(r[2])).toBe(R2_ABOVE_BOX_SIZE);
    expect(Number(r[1])).toBe(box.y - 1.5);
  });
  it('a gradient colour from a project file is validated', () => {
    expect(parseFigureStyle({ gradientEnd: '"/><script>' }).gradientEnd).toBe(
      DEFAULT_FIGURE_STYLE.gradientEnd,
    );
    expect(parseFigureStyle({ gradientFill: 'yes' }).gradientFill).toBe(false);
  });
  it('Amos notation writes numbers beside the lines, without a mask', () => {
    const f = input();
    const { svg } = renderFigureSvg(f, FIGURE_PRESETS.amos.style);
    expect(svg).not.toMatch(/<rect [^>]*rx="[\d.]+" fill="#ffffff"/);
    const m = /<text x="([\d.-]+)" y="([\d.-]+)"[^>]*>-\.25<\/text>/.exec(svg)!;
    const p = f.paths[0];
    expect(Number(m[2])).toBeLessThan((p.y1 + p.y2) / 2); // above its line
  });
  it('Amos notation states an error term’s fixed 1 until there are estimates, then the indicator’s reliability above its box', () => {
    const style = FIGURE_PRESETS.amos.style;
    const term = (cy: number) => ({ cx: -200, cy, nx: -1, ny: 0, ax: -170, ay: cy });
    const f = input();
    f.errors = [{ kind: 'indicator', value: null, name: 'a1', term: term(0) }];
    const before = renderFigureSvg(
      {
        ...f,
        constructs: f.constructs.map((c) => ({ ...c, indicators: c.indicators.map(() => null) })),
      },
      style,
    ).svg;
    expect([...before.matchAll(/>1<\/text>/g)]).toHaveLength(1);
    f.errors = [{ kind: 'indicator', value: 0.36, r2: 0.64, name: 'a1', term: term(0) }];
    const std = renderFigureSvg(f, style).svg;
    expect(std).toContain('>.64<');
    expect(std).not.toContain('>.36<');
    expect(std).toContain('>e1<');
    f.errors = [{ kind: 'indicator', value: 0.36, r2: null, name: 'a1', term: term(0) }];
    const un = renderFigureSvg(f, style).svg;
    expect(un).toContain('>.36<'); // unstandardised: the variance, beside the circle
    expect(un).not.toContain('>.64<');
  });
  it('Amos notation: no leading zero, no significance, numbered error terms, bare R² above the variable', () => {
    const style = FIGURE_PRESETS.amos.style;
    const { svg } = renderFigureSvg(allBits(), style);
    expect(formatEstimate(style, 0.812)).toBe('.81');
    expect(formatEstimate(style, -0.25)).toBe('-.25');
    expect(formatEstimate(style, 1.5)).toBe('1.50');
    expect(significanceText(style, 0.001)).toBeNull();
    expect(svg).toContain('>.81<');
    expect(svg).toContain('>-.25<');
    expect(svg).toContain('>e1<');
    expect(svg).toContain('>e2<');
    expect(svg).toContain('>.43<');
    expect(svg).not.toContain('R²');
    expect(svg).not.toContain('font-weight="bold" text-anchor="middle" fill="#000000">Loyalty');
    expect(svg).not.toContain('stroke-dasharray="2 2"'); // a held 1 has no marker around it
  });
  it('the default style writes numbers as before', () => {
    expect(formatEstimate(DEFAULT_FIGURE_STYLE, 0.812)).toBe('0.812');
    expect(significanceText(DEFAULT_FIGURE_STYLE, 0.0004)).toBe('p<.001');
    expect(significanceText(DEFAULT_FIGURE_STYLE, 0.0123)).toBe('p=.012');
    expect(significanceText({ ...DEFAULT_FIGURE_STYLE, pFormat: 'stars' }, 0.0123)).toBe('*');
    expect(significanceText({ ...DEFAULT_FIGURE_STYLE, pFormat: 'stars' }, 0.2)).toBeNull();
  });
  it('names the preset a style is, and no preset once it is changed', () => {
    for (const k of Object.keys(FIGURE_PRESETS))
      expect(matchPreset(parseFigureStyle(FIGURE_PRESETS[k].style))).toBe(k);
    expect(matchPreset({ ...FIGURE_PRESETS.classic.style, decimals: 4 })).toBeNull();
  });
});

describe('PLS style', () => {
  const style = FIGURE_PRESETS.pls.style;
  const circled = (): FigureInput => {
    const f = input();
    f.constructs = f.constructs.map((k) => ({
      ...k,
      geom: constructGeometry({ ...k.c, circle: true }),
    }));
    f.errors = [
      {
        kind: 'indicator',
        value: 0.293,
        name: 'a1',
        term: { cx: -200, cy: 0, nx: -1, ny: 0, ax: -170, ay: 0 },
      },
    ];
    f.correlations = [
      { d: 'M 0 0', heads: [], lx: 0, ly: 0, nx: 0, ny: 0, points: [[0, 0]], label: null },
    ];
    return f;
  };

  it('is a valid preset named PLS, and leaves the other styles alone', () => {
    expect(FIGURE_PRESETS.pls.label).toBe('PLS');
    expect(style.notation).toBe('pls');
    expect(parseFigureStyle({ notation: 'pls' }).notation).toBe('pls');
    expect(parseFigureStyle(style)).toEqual(style);
    expect(matchPreset(style)).toBe('pls');
    expect(parseFigureStyle({}).circleConstructs).toBe(false);
    expect(figureForMethod(DEFAULT_FIGURE_STYLE, 'cbsem')).toBe(DEFAULT_FIGURE_STYLE);
  });
  it('draws a factor as a circle and a composite as a hexagon, names outside and a bare R² in white', () => {
    const f = circled();
    const { svg } = renderFigureSvg({ ...f, errors: [], method: 'pls' }, style);
    expect(f.constructs[0].geom.rx).toBe(f.constructs[0].geom.ry); // the factor
    expect([...svg.matchAll(/<ellipse /g)]).toHaveLength(1);
    expect(svg).toMatch(/<polygon points="[^"]+" fill="#1094ff" stroke="#71beff"/); // the composite
    expect(svg).toContain('font-weight="bold" text-anchor="middle" fill="#ffffff">0.432<');
    expect(svg).not.toContain('R²');
    const name = /<text x="[\d.-]+" y="([\d.-]+)"[^>]*>Loyalty</.exec(svg)!;
    expect(Number(name[1])).toBeGreaterThan(f.constructs[1].geom.ry);
  });
  it('a PLS model: solid yellow indicators, bold structural estimates, regular loadings', () => {
    const { svg } = renderFigureSvg({ ...circled(), method: 'pls' }, style);
    expect(svg).toMatch(/<rect [^>]*fill="#ffff00" stroke="#ffff00"/);
    expect(svg).toMatch(/<ellipse [^>]*fill="#1094ff" stroke="#71beff"/);
    expect(svg).toMatch(/font-weight="bold" fill="#000000">-0\.247</);
    expect(svg).toMatch(/text-anchor="middle" fill="#000000">0\.812</);
  });
  it('a CB-SEM model: white outlined indicators, purple error terms ending in a diamond, dashed correlations, regular estimates', () => {
    const { svg } = renderFigureSvg({ ...circled(), method: 'cbsem' }, style);
    expect(svg).toMatch(/<rect [^>]*fill="#ffffff" stroke="#c6c800"/);
    expect(svg).not.toContain('fill="#ffff00"');
    expect(svg).toMatch(/<circle [^>]*fill="#855dc2"\/>/);
    expect(svg).toMatch(/<polygon points="[^"]+" fill="#855dc2"\/>/);
    expect(svg).toMatch(/<line [^>]*stroke="#855dc2"[^>]*\/>\n<polygon/); // no arrowhead
    expect(svg).toMatch(/fill="#ffffff"[^>]*>0\.293</);
    expect(svg).toMatch(/stroke="#499620"[^>]*stroke-dasharray="4 3"/);
    expect(svg).not.toMatch(/font-weight="bold" fill="#000000">-0\.247/);
  });
  it('slides a correlation label off an indicator box, as it would hide the name', () => {
    const f = input(),
      b = f.constructs[0].geom.indicators[0],
      a = f.constructs[0].c;
    const box = { x: a.x + b.x, y: a.y + b.y, w: b.w, h: b.h },
      mid = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
    f.correlations = [
      {
        d: 'M 0 0',
        heads: [],
        lx: mid.x,
        ly: mid.y,
        nx: 0,
        ny: 0,
        points: [
          [mid.x, mid.y - 300],
          [mid.x, mid.y + 300],
          [mid.x, mid.y],
        ],
        label: { value: 0.41, p: null },
      },
    ];
    const m = /<text x="[\d.-]+" y="([\d.-]+)"[^>]*>0\.410<\/text>/.exec(
      renderFigureSvg(f, style).svg,
    )!;
    expect(Number(m[1]) > box.y + box.h || Number(m[1]) < box.y).toBe(true);
  });
  it('keeps an indicator fill changed by hand in a CB-SEM model', () => {
    expect(figureForMethod({ ...style, indicatorFill: '#123456' }, 'cbsem').indicatorFill).toBe(
      '#123456',
    );
    expect(figureForMethod(style, 'pls')).toBe(style);
  });
  it('a single item has a line without an arrowhead', () => {
    const f = circled();
    const a = { ...f.constructs[0].c, indicators: ['a1'] };
    f.constructs[0] = { ...f.constructs[0], c: a, geom: constructGeometry(a), indicators: [null] };
    f.errors = [];
    f.correlations = [];
    f.paths = [];
    const b = { ...f.constructs[1].c, indicators: [] };
    f.constructs[1] = { ...f.constructs[1], c: b, geom: constructGeometry(b), indicators: [] };
    const { svg } = renderFigureSvg(f, style);
    expect(svg).toContain('<line ');
    expect(svg).not.toMatch(/<line [^>]*\/>\n<path/);
  });
});

describe('semPlot style', () => {
  const style = FIGURE_PRESETS.semplot.style;
  const f = (): FigureInput => {
    const r = input();
    r.errors = [
      {
        kind: 'indicator',
        value: 0.4,
        name: 'a1',
        term: { cx: -200, cy: 0, nx: -1, ny: 0, ax: -170, ay: 0 },
      },
    ];
    return r;
  };
  it('is a valid preset', () => {
    expect(parseFigureStyle(style)).toEqual(style);
    expect(matchPreset(style)).toBe('semplot');
    expect(style.circleConstructs).toBe(true);
    expect(style.showR2).toBe(false);
  });
  it('colours arrows exactly as qgraph does', () => {
    // Colours from semPaths(what = "std")'s graph attributes on a one-factor model; its weights are given to two decimals here, so within rounding.
    const rgb = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
    const near = (w: number, ref: string) =>
      rgb(semplotEdge(w).color).forEach((v, i) =>
        expect(Math.abs(v - rgb(ref)[i])).toBeLessThanOrEqual(2),
      );
    near(1, '#009900');
    near(0.92, '#14a114');
    near(0.51, '#7dcb7d');
    near(-0.91, '#c51616');
    near(-0.25, '#efbebe');
    near(0.15, '#d8efd8');
    expect(semplotEdge(null).color).toBe('#6d6d6d');
    expect(semplotEdge(1.3).color).toBe('#009900');
  });
  it('sizes them with the estimate, as qgraph’s 1 + 6.58·|w|', () => {
    expect(semplotEdge(1).width / semplotEdge(0.15).width).toBeCloseTo(7.59 / 2, 1);
    expect(semplotEdge(-0.5).width).toBe(semplotEdge(0.5).width);
  });
  it('draws a residual as a double-headed loop with its value, no circle', () => {
    const { svg } = renderFigureSvg(f(), style);
    expect(svg).not.toMatch(/<circle /);
    expect(svg).toMatch(
      /<path d="M [^"]+ C [^"]+" fill="none" stroke="#6[0-9a-f]{5}"|<path d="M [^"]+ C [^"]+" fill="none"/,
    );
    expect(svg).toContain('>0.40<');
  });
  it('keeps names inside, dashes fixed loadings and colours loadings by sign', () => {
    const { svg } = renderFigureSvg(f(), style);
    const name = /<text x="[\d.-]+" y="([\d.-]+)"[^>]*>Loyalty</.exec(svg)!;
    expect(Math.abs(Number(name[1]))).toBeLessThan(20);
    expect(svg).toContain('stroke-dasharray="5 4"');
    expect(svg).toContain(`stroke="${semplotEdge(0.812).color}"`);
    expect(svg).toContain(`stroke="${semplotEdge(-0.2468).color}"`);
    expect(svg).not.toContain('R²');
  });
  it('colours a general factor’s arrows to shared boxes too', () => {
    const r = f();
    r.higherOrder = [
      { key: 'shared:g:a1', x1: 0, y1: 0, x2: 100, y2: 0, label: { value: -0.5, p: null } },
    ];
    expect(renderFigureSvg(r, style).svg).toContain(`stroke="${semplotEdge(-0.5).color}"`);
  });
  it('is grey before there are estimates', () => {
    const r = f();
    r.errors = [];
    r.paths = r.paths.map((p) => ({ ...p, label: null }));
    r.constructs = r.constructs.map((k) => ({ ...k, indicators: k.indicators.map(() => null) }));
    expect(renderFigureSvg(r, style).svg).toContain('stroke="#6d6d6d"');
  });
});

describe('implied main effects in the figure', () => {
  it('draws a moderator’s implied main effect dashed, drawn paths solid', () => {
    const base = input();
    const line = (svg: string) => svg.match(/<line [^>]*\/>/g) ?? [];
    const solid = renderFigureSvg(base, DEFAULT_FIGURE_STYLE).svg;
    expect(line(solid).some((l) => l.includes('stroke-dasharray'))).toBe(false);
    const dashed = renderFigureSvg(
      { ...base, paths: [{ ...base.paths[0], implied: true }] },
      DEFAULT_FIGURE_STYLE,
    ).svg;
    expect(line(dashed).some((l) => l.includes('stroke-dasharray="5 4"'))).toBe(true);
  });
  it('draws the constant’s implied intercepts dashed and thinner than its mean arrows, with their labels', () => {
    const base = input();
    const svg = renderFigureSvg(
      {
        ...base,
        constant: { x: -200, y: 0 },
        means: [{ x1: -180, y1: 0, x2: -60, y2: 0, label: { value: 0.5, p: 0.01 } }],
        intercepts: [
          { x1: -180, y1: 10, x2: -40, y2: 80, label: { value: 4.936, p: 0 } },
          { x1: -180, y1: -10, x2: -40, y2: -80, label: null },
        ],
      },
      DEFAULT_FIGURE_STYLE,
    ).svg;
    const lines = svg.match(/<line [^>]*\/>/g) ?? [];
    const dashed = lines.filter((l) => l.includes('stroke-dasharray="5 4"'));
    expect(dashed).toHaveLength(2);
    const width = (l: string) => Number(l.match(/stroke-width="([\d.]+)"/)![1]);
    const mean = lines.find((l) => l.includes('x2="-60"'))!;
    expect(width(dashed[0])).toBeLessThan(width(mean));
    expect(svg).toContain('4.936');
    expect(svg).toContain('0.500');
  });
});

describe('the constant in figures', () => {
  it('draws the triangle, its "1", its arrows and their labels', () => {
    const f = input();
    const svg = renderFigureSvg(
      {
        ...f,
        constant: { x: -150, y: 0 },
        means: [
          { x1: -134, y1: 0, x2: -60, y2: 0, label: { value: 4.936, p: 0.001, fixed: false } },
        ],
      },
      { ...DEFAULT_FIGURE_STYLE, showEstimates: true },
    ).svg;
    expect(svg).toMatch(/<path d="M -150 -20 L -131 14 L -169 14 Z"/);
    expect(svg).toContain('>1</text>');
    expect(svg).toContain('4.936');
    expect(renderFigureSvg(f, DEFAULT_FIGURE_STYLE).svg).not.toMatch(/<path d="M -150 -20/);
  });
});
