// Text style of the result charts (Johnson–Neyman, simple slopes, IPMA,
// simulation): one font, size and colour for all charts of a project, and
// per-chart axis titles. Fonts are the PDF standard families, so vector
// exports keep them without embedding.

export type ChartFont = 'sans' | 'serif' | 'mono';

export interface ChartStyle {
  font: ChartFont;
  /** Font size in px (axis titles one px larger). */
  size: number;
  /** Text colour, #rrggbb. */
  color: string;
  /** Axis titles chosen by the user, by chart id; absent or empty = the chart's default. */
  labels: Record<string, { x?: string; y?: string }>;
}

export const DEFAULT_CHART_STYLE: ChartStyle = { font: 'sans', size: 11, color: '#4b5563', labels: {} };

export const CHART_FONTS: Record<ChartFont, { label: string; family: string }> = {
  sans: { label: 'Sans serif (Helvetica)', family: 'Helvetica, Arial, sans-serif' },
  serif: { label: 'Serif (Times)', family: 'Times, "Times New Roman", serif' },
  mono: { label: 'Monospace (Courier)', family: 'Courier, "Courier New", monospace' },
};

export const CHART_SIZE: [number, number] = [7, 24];
const LABEL_MAX = 120;

/** Validate an untrusted chart style (project files). */
export function parseChartStyle(raw: unknown): ChartStyle {
  const r = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const font = r.font === 'serif' || r.font === 'mono' ? r.font : 'sans';
  const size = typeof r.size === 'number' && Number.isFinite(r.size) ? Math.min(CHART_SIZE[1], Math.max(CHART_SIZE[0], Math.round(r.size))) : DEFAULT_CHART_STYLE.size;
  const color = typeof r.color === 'string' && /^#[0-9a-f]{6}$/i.test(r.color) ? r.color : DEFAULT_CHART_STYLE.color;
  const labels: ChartStyle['labels'] = {};
  const raw2 = typeof r.labels === 'object' && r.labels !== null && !Array.isArray(r.labels) ? r.labels as Record<string, unknown> : {};
  for (const [id, v] of Object.entries(raw2).slice(0, 500)) {
    if (typeof v !== 'object' || v === null || id.length > 300) continue;
    const o = v as Record<string, unknown>;
    const pick = (s: unknown) => (typeof s === 'string' && s.trim() ? s.slice(0, LABEL_MAX) : undefined);
    const x = pick(o.x), y = pick(o.y);
    if (x || y) labels[id] = { ...(x ? { x } : {}), ...(y ? { y } : {}) };
  }
  return { font, size, color, labels };
}

/** CSS variables for a chart container. */
export const chartVars = (s: ChartStyle) => ({ '--chart-font': CHART_FONTS[s.font].family, '--chart-size': `${s.size}px`, '--chart-color': s.color });
