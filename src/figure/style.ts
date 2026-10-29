// Figure style: colours, line widths, font and what to show. Applies to the
// diagram on screen and to exported figures (PDF, PNG, SVG); saved with the
// project. Fonts are the PDF standard families so exported PDFs need no
// embedded fonts.

export type FigureFont = 'helvetica' | 'times' | 'courier';
export type PFormat = 'stars' | 'p' | 'none';

export interface FigureStyle {
  font: FigureFont;
  fontSize: number;
  constructFill: string;
  constructStroke: string;
  constructStrokeWidth: number;
  indicatorFill: string;
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
}

export const DEFAULT_FIGURE_STYLE: FigureStyle = {
  font: 'helvetica', fontSize: 11,
  constructFill: '#eef0ff', constructStroke: '#6366f1', constructStrokeWidth: 1.5,
  indicatorFill: '#ffffff', indicatorStroke: '#c4cad6', indicatorArrow: '#9aa3b5', indicatorArrowWidth: 1.2,
  pathColor: '#3b4252', pathWidth: 1.6, pathWidthByEffect: true,
  correlationColor: '#0e7490', moderationColor: '#8b5cf6',
  labelSignificant: '#08603c', labelNonSignificant: '#8a94a6', labelBoxes: true,
  showEstimates: true, showR2: true, pFormat: 'p', decimals: 3,
};

export const FIGURE_PRESETS: Record<string, { label: string; style: FigureStyle }> = {
  default: { label: 'Default', style: DEFAULT_FIGURE_STYLE },
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

const COLOR_KEYS = ['constructFill', 'constructStroke', 'indicatorFill', 'indicatorStroke', 'indicatorArrow', 'pathColor',
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
    labelBoxes: bool(r.labelBoxes, d.labelBoxes),
    showEstimates: bool(r.showEstimates, d.showEstimates),
    showR2: bool(r.showR2, d.showR2),
    pFormat: r.pFormat === 'stars' || r.pFormat === 'none' ? r.pFormat : 'p',
    decimals: Math.round(num(r.decimals, 1, 4, d.decimals)),
  };
  for (const k of COLOR_KEYS) out[k] = color(r[k], d[k]);
  return out;
}

/** Path stroke width for a coefficient (or the base width when no estimate is shown). */
export function pathStrokeWidth(style: FigureStyle, beta: number | null): number {
  if (beta === null || !style.pathWidthByEffect) return style.pathWidth;
  return style.pathWidth * (0.75 + Math.min(1, Math.abs(beta)) * 2);
}

/** An estimate with its significance, as the style asks. */
export function estimateText(style: FigureStyle, v: number, p: number | null): string {
  const s = v.toFixed(style.decimals);
  if (p === null || style.pFormat === 'none') return s;
  if (style.pFormat === 'stars') return s + (p < 0.001 ? '***' : p < 0.01 ? '**' : p < 0.05 ? '*' : '');
  return `${s} (p${p < 0.001 ? ' < .001' : ` = ${p.toFixed(3).slice(1)}`})`;
}

/** CSS custom properties that apply the style to the on-screen diagram. */
export function figureCssVars(style: FigureStyle): Record<string, string> {
  return {
    '--construct-fill': style.constructFill, '--construct-stroke': style.constructStroke, '--construct-stroke-width': `${style.constructStrokeWidth}`,
    '--indicator-fill': style.indicatorFill, '--indicator-stroke': style.indicatorStroke, '--indicator-arrow': style.indicatorArrow,
    '--indicator-arrow-width': `${style.indicatorArrowWidth}`, '--path': style.pathColor, '--cor': style.correlationColor,
    '--mod': style.moderationColor, '--label-sig': style.labelSignificant, '--label-ns': style.labelNonSignificant,
    '--figure-font': FONT_FAMILY[style.font],
  };
}
