// Figure style: colours, line widths, font and what to show. Applies to the
// diagram on screen and to exported figures (PDF, PNG, SVG); saved with the
// project. Fonts are the PDF standard families so exported PDFs need no
// embedded fonts.

export type FigureFont = 'helvetica' | 'times' | 'courier';
export type PFormat = 'stars' | 'p' | 'none';
/** amos: .85 without the leading zero, numbers beside the lines, numbered error terms (e1, d1), a bare R² above the variable, plain variable names. */
/** smartpls: bare R² inside the construct, a line without a head for a single item; CB-SEM: purple error terms ending in a diamond, dashed correlations, plain indicator boxes (figureForMethod). */
export type FigureNotation = 'standard' | 'amos' | 'smartpls';

export interface FigureStyle {
  font: FigureFont;
  fontSize: number;
  /** Draw common factors as circles and composites as hexagons of the same height, their names outside. */
  circleConstructs: boolean;
  constructFill: string;
  constructStroke: string;
  constructStrokeWidth: number;
  indicatorFill: string;
  /** Fill shapes with a left-to-right gradient, from their fill colour to gradientEnd. */
  gradientFill: boolean;
  gradientEnd: string;
  indicatorStroke: string;
  indicatorArrow: string;
  indicatorArrowWidth: number;
  pathColor: string;
  pathWidth: number;
  /** Paths thicker for larger |β|. */
  pathWidthByEffect: boolean;
  correlationColor: string;
  moderationColor: string;
  labelSignificant: string;
  labelNonSignificant: string;
  /** Rounded white boxes behind estimates. */
  labelBoxes: boolean;
  showEstimates: boolean;
  showR2: boolean;
  pFormat: PFormat;
  decimals: number;
  notation: FigureNotation;
}

export const DEFAULT_FIGURE_STYLE: FigureStyle = {
  font: 'helvetica', fontSize: 11, circleConstructs: false,
  constructFill: '#eef0ff', constructStroke: '#6366f1', constructStrokeWidth: 1.5,
  indicatorFill: '#ffffff', indicatorStroke: '#c4cad6', indicatorArrow: '#9aa3b5', indicatorArrowWidth: 1.2,
  gradientFill: false, gradientEnd: '#ecd5f4',
  pathColor: '#3b4252', pathWidth: 1.6, pathWidthByEffect: true,
  correlationColor: '#0e7490', moderationColor: '#8b5cf6',
  labelSignificant: '#08603c', labelNonSignificant: '#8a94a6', labelBoxes: true,
  showEstimates: true, showR2: true, pFormat: 'p', decimals: 3, notation: 'standard',
};

/** Every line black, every box white; the rest as the default. */
const CLASSIC_FIGURE_STYLE: FigureStyle = {
  ...DEFAULT_FIGURE_STYLE,
  constructFill: '#ffffff', constructStroke: '#000000', constructStrokeWidth: 1,
  indicatorFill: '#ffffff', indicatorStroke: '#000000', indicatorArrow: '#000000', indicatorArrowWidth: 1,
  pathColor: '#000000', pathWidth: 1.2, pathWidthByEffect: false,
  correlationColor: '#000000', moderationColor: '#000000',
  labelSignificant: '#000000', labelNonSignificant: '#000000', labelBoxes: false,
};

/** Error terms in the SmartPLS style (CB-SEM). */
export const SMARTPLS_ERROR = '#855dc2';
const SMARTPLS_INDICATOR = '#ffff00';

export const FIGURE_PRESETS: Record<string, { label: string; style: FigureStyle }> = {
  default: { label: 'Default', style: DEFAULT_FIGURE_STYLE },
  classic: { label: 'Classic (black lines, white boxes)', style: CLASSIC_FIGURE_STYLE },
  amos: {
    label: 'Amos',
    // Colours and line weights measured from the path diagrams in the IBM SPSS Amos 26 User's Guide (Example 5).
    style: {
      ...CLASSIC_FIGURE_STYLE, constructFill: '#e2ebec', indicatorFill: '#e2ebec', gradientFill: true,
      constructStrokeWidth: 1.5, indicatorArrowWidth: 1.5, pathWidth: 1.5, pFormat: 'none', decimals: 2, notation: 'amos',
    },
  },
  smartpls: {
    label: 'SmartPLS',
    // Colours and proportions measured from the model images in the SmartPLS 4 documentation; adapts to CB-SEM (figureForMethod).
    style: {
      ...DEFAULT_FIGURE_STYLE, circleConstructs: true,
      constructFill: '#1094ff', constructStroke: '#71beff', constructStrokeWidth: 1,
      indicatorFill: SMARTPLS_INDICATOR, indicatorStroke: SMARTPLS_INDICATOR, indicatorArrow: '#000000', indicatorArrowWidth: 1,
      pathColor: '#000000', pathWidth: 2, pathWidthByEffect: false,
      correlationColor: '#499620', moderationColor: '#996600',
      labelSignificant: '#000000', labelNonSignificant: '#000000', labelBoxes: false, pFormat: 'none', notation: 'smartpls',
    },
  },
  publication: {
    label: 'Publication (black & white)',
    style: {
      ...DEFAULT_FIGURE_STYLE, font: 'times', fontSize: 11,
      constructFill: '#ffffff', constructStroke: '#000000', constructStrokeWidth: 1,
      indicatorFill: '#ffffff', indicatorStroke: '#000000', indicatorArrow: '#000000', indicatorArrowWidth: 0.8,
      pathColor: '#000000', pathWidth: 1, pathWidthByEffect: false,
      correlationColor: '#000000', moderationColor: '#000000',
      labelSignificant: '#000000', labelNonSignificant: '#000000', labelBoxes: false, pFormat: 'stars', decimals: 2,
    },
  },
  greyscale: {
    label: 'Greyscale',
    style: {
      ...DEFAULT_FIGURE_STYLE,
      constructFill: '#f2f2f2', constructStroke: '#404040', indicatorStroke: '#9e9e9e', indicatorArrow: '#7a7a7a',
      pathColor: '#262626', correlationColor: '#595959', moderationColor: '#595959',
      labelSignificant: '#000000', labelNonSignificant: '#8c8c8c',
    },
  },
};

export const FONT_FAMILY: Record<FigureFont, string> = {
  helvetica: 'Helvetica, Arial, sans-serif',
  times: '"Times New Roman", Times, serif',
  courier: '"Courier New", Courier, monospace',
};

const COLOR_KEYS = ['constructFill', 'constructStroke', 'indicatorFill', 'gradientEnd', 'indicatorStroke', 'indicatorArrow', 'pathColor',
  'correlationColor', 'moderationColor', 'labelSignificant', 'labelNonSignificant'] as const;

/** Validate an untrusted style (project file); unknown or invalid values fall back to the default. */
export function parseFigureStyle(raw: unknown): FigureStyle {
  const d = DEFAULT_FIGURE_STYLE;
  if (typeof raw !== 'object' || raw === null) return d;
  const r = raw as Record<string, unknown>;
  const color = (v: unknown, dflt: string) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : dflt);
  const num = (v: unknown, lo: number, hi: number, dflt: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt);
  const bool = (v: unknown, dflt: boolean) => (typeof v === 'boolean' ? v : dflt);
  const out: FigureStyle = {
    ...d,
    font: r.font === 'times' || r.font === 'courier' ? r.font : 'helvetica',
    fontSize: num(r.fontSize, 6, 24, d.fontSize),
    constructStrokeWidth: num(r.constructStrokeWidth, 0.25, 6, d.constructStrokeWidth),
    indicatorArrowWidth: num(r.indicatorArrowWidth, 0.25, 6, d.indicatorArrowWidth),
    pathWidth: num(r.pathWidth, 0.25, 8, d.pathWidth),
    pathWidthByEffect: bool(r.pathWidthByEffect, d.pathWidthByEffect),
    gradientFill: bool(r.gradientFill, d.gradientFill),
    circleConstructs: bool(r.circleConstructs, d.circleConstructs),
    labelBoxes: bool(r.labelBoxes, d.labelBoxes),
    showEstimates: bool(r.showEstimates, d.showEstimates),
    showR2: bool(r.showR2, d.showR2),
    pFormat: r.pFormat === 'stars' || r.pFormat === 'none' ? r.pFormat : 'p',
    decimals: Math.round(num(r.decimals, 1, 4, d.decimals)),
    notation: r.notation === 'amos' || r.notation === 'smartpls' ? r.notation : 'standard',
  };
  for (const k of COLOR_KEYS) out[k] = color(r[k], d[k]);
  return out;
}

/** Path stroke width for a coefficient (or the base width when no estimate is shown). */
export function pathStrokeWidth(style: FigureStyle, beta: number | null): number {
  if (beta === null || !style.pathWidthByEffect) return style.pathWidth;
  return style.pathWidth * (0.75 + Math.min(1, Math.abs(beta)) * 2);
}

/** The preset this style is, if any (a style changed by hand is none). */
export function matchPreset(style: FigureStyle): string | null {
  const same = (a: FigureStyle) => (Object.keys(a) as (keyof FigureStyle)[]).every((k) => a[k] === style[k]);
  return Object.keys(FIGURE_PRESETS).find((k) => same(FIGURE_PRESETS[k].style)) ?? null;
}

/** One colour of line on white or gradient boxes: text and on-screen accents then follow the lines instead of the app's colours. */
export function isPlainFigure(style: FigureStyle): boolean {
  if (style.notation === 'smartpls') return true;
  return (style.gradientFill || (style.constructFill === '#ffffff' && style.indicatorFill === '#ffffff'))
    && [style.constructStroke, style.indicatorStroke, style.indicatorArrow, style.correlationColor, style.moderationColor].every((c) => c === style.pathColor);
}

/** The style as this kind of model draws it: SmartPLS's CB-SEM models have white, outlined indicators (unless the fill was changed by hand). */
export function figureForMethod(style: FigureStyle, method?: string): FigureStyle {
  if (style.notation !== 'smartpls' || method !== 'cbsem') return style;
  return {
    ...style,
    indicatorFill: style.indicatorFill === SMARTPLS_INDICATOR ? '#ffffff' : style.indicatorFill,
    indicatorStroke: style.indicatorStroke === SMARTPLS_INDICATOR ? '#c6c800' : style.indicatorStroke,
  };
}

/** An estimate as a number, in the style's decimals and notation. */
export function formatEstimate(style: FigureStyle, v: number): string {
  const s = v.toFixed(style.decimals);
  return style.notation === 'amos' ? s.replace(/^(-?)0\./, '$1.') : s;
}

/** The significance beside an estimate on screen (null: none shown). */
export function significanceText(style: FigureStyle, p: number): string | null {
  if (style.pFormat === 'none') return null;
  if (style.pFormat === 'stars') return p < 0.001 ? '***' : p < 0.01 ? '**' : p < 0.05 ? '*' : null;
  return p < 0.001 ? 'p<.001' : `p=${p.toFixed(3).slice(1)}`;
}

/** An estimate with its significance, as the style asks. */
export function estimateText(style: FigureStyle, v: number, p: number | null): string {
  const s = formatEstimate(style, v);
  if (p === null || style.pFormat === 'none') return s;
  if (style.pFormat === 'stars') return s + (p < 0.001 ? '***' : p < 0.01 ? '**' : p < 0.05 ? '*' : '');
  return `${s} (p${p < 0.001 ? ' < .001' : ` = ${p.toFixed(3).slice(1)}`})`;
}

/** Ids of the fill gradients, on screen and in exported figures. */
export const GRADIENT_CONSTRUCT = 'figure-fill-construct', GRADIENT_INDICATOR = 'figure-fill-indicator';

/** CSS custom properties that apply the style to the on-screen diagram. */
export function figureCssVars(style: FigureStyle): Record<string, string> {
  const gradient: Record<string, string> = style.gradientFill ? {
    '--construct-fill': `url(#${GRADIENT_CONSTRUCT})`, '--indicator-fill': `url(#${GRADIENT_INDICATOR})`,
    '--construct-fill-from': style.constructFill, '--indicator-fill-from': style.indicatorFill, '--fill-to': style.gradientEnd,
  } : {};
  return {
    '--construct-fill': style.constructFill, '--construct-stroke': style.constructStroke, '--construct-stroke-width': `${style.constructStrokeWidth}`,
    '--indicator-fill': style.indicatorFill, '--indicator-stroke': style.indicatorStroke, '--indicator-arrow': style.indicatorArrow,
    '--indicator-arrow-width': `${style.indicatorArrowWidth}`, '--path': style.pathColor, '--cor': style.correlationColor,
    '--mod': style.moderationColor, '--label-sig': style.labelSignificant, '--label-ns': style.labelNonSignificant,
    '--figure-font': FONT_FAMILY[style.font],
    ...gradient,
  };
}
