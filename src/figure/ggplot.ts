// A chart drawn by ggplot2 (R/ggplot.R ps_ggplot): the chart describes what it draws as layers of numbers,
// each with its series (the legend entry), colour and line type, and the axes; with the project's chart style
// (theme, font, size) ggplot2 draws the same figure. ggplotFile returns the file (PDF or PNG in either R, SVG
// in desktop R, which has svglite); ggplotScript the self-contained R script that draws it.

import { rCall, rScript } from '../rengine/bridge';
import type { ChartStyle } from './chartStyle';

export type GgGeom =
  | 'line'
  | 'step'
  | 'point'
  | 'rect'
  | 'area'
  | 'ribbon'
  | 'hline'
  | 'vline'
  | 'segment'
  | 'text';

/** One layer: its geom's columns (line: x, y; rect: xmin, xmax, ymin, ymax; ribbon: x, ymin, ymax; …). */
export interface GgLayer {
  geom: GgGeom;
  /** The legend entry ('' or absent: none). */
  series?: string;
  color: string;
  linetype?: 'solid' | 'dashed' | 'dotted';
  /** Points: open circles (filled otherwise). */
  open?: boolean;
  alpha?: number;
  x?: (number | null)[];
  y?: (number | null)[];
  xmin?: number[];
  xmax?: number[];
  ymin?: number[];
  ymax?: number[];
  xend?: number[];
  yend?: number[];
  label?: string[];
}

export interface FigureSpec {
  /** What the chart shows (the script's title). */
  title: string;
  x: { title: string; limits?: [number, number] };
  y: { title: string; limits?: [number, number]; percent?: boolean };
  layers: GgLayer[];
  /** Size in pixels on screen (the figure keeps the aspect ratio, 6 inches wide). */
  width: number;
  height: number;
}

export type GgFormat = 'pdf' | 'svg' | 'png';

/** Numbers rounded to 6 significant digits: the script stays readable, the figure the same. */
const round = (v: number | null) =>
  v === null || !Number.isFinite(v) ? null : Number(v.toPrecision(6));

/** The request ps_ggplot reads. */
export function ggplotRequest(spec: FigureSpec, style: ChartStyle, format: GgFormat) {
  const inches = 6;
  const layers = spec.layers.map((l) => {
    const out: Record<string, unknown> = { ...l };
    for (const k of ['x', 'y', 'xmin', 'xmax', 'ymin', 'ymax', 'xend', 'yend'] as const) {
      const v = l[k];
      if (v) out[k] = v.map(round);
    }
    return out;
  });
  return {
    title: spec.title,
    format,
    theme: style.theme,
    font: style.font,
    size: style.size,
    width: inches,
    height: Number(((inches * spec.height) / spec.width).toFixed(2)),
    legend: 'top',
    x: spec.x,
    y: spec.y,
    layers,
  };
}

const TYPES: Record<GgFormat, string> = {
  pdf: 'application/pdf',
  svg: 'image/svg+xml',
  png: 'image/png',
};

/** The figure as ggplot2 draws it. */
export async function ggplotFile(
  spec: FigureSpec,
  style: ChartStyle,
  format: GgFormat,
): Promise<Blob> {
  const r = await rCall<{ data: string }>(
    'ps_ggplot',
    ggplotRequest(spec, style, format),
    format === 'svg' ? 'svglite' : 'ggplot2',
  );
  const bytes = Uint8Array.from(atob(r.data), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: TYPES[format] });
}

/** The R script that draws the figure with ggplot2. */
export const ggplotScript = (spec: FigureSpec, style: ChartStyle) =>
  rScript('ps_ggplot', ggplotRequest(spec, style, 'pdf'), 'ggplot2');
