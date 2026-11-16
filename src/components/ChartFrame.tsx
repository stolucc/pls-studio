import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  CHART_FONTS,
  CHART_SIZE,
  CHART_THEMES,
  chartVars,
  type ChartFont,
  type ChartStyle,
  type ChartTheme,
} from '../figure/chartStyle';
import { exportFigure, type FigureFormat } from '../figure/export';
import type { FigureSpec, GgFormat } from '../figure/ggplot';
import { standaloneSvg } from '../figure/standalone';
import { downloadBlob, downloadText, safeFileName } from '../format';
import { useStore } from '../store';
import { IconDownload } from './icons';
import { useEscape } from './useEscape';

export interface AxisLabels {
  x: string;
  y: string;
}

/**
 * A result chart with its tools: text style (font, size, colour, shared by all
 * charts of the project), this chart's axis titles, and export as vector PDF
 * or PNG. `children` draws the SVG with the axis titles it is given. A chart
 * that describes what it draws (`figure`, src/figure/ggplot.ts) can also be
 * drawn by ggplot2 (PDF, SVG, PNG) or exported as the ggplot2 script.
 */
export function ChartFrame({
  id,
  name,
  defaults,
  width,
  height,
  children,
  caption,
  axes = true,
  figure,
}: {
  /** Stable key for this chart's axis titles. */
  id: string;
  /** File name stem for exports. */
  name: string;
  defaults: AxisLabels;
  width: number;
  height: number;
  children: (labels: AxisLabels) => ReactNode;
  caption?: ReactNode;
  /** false: a diagram without axes (no axis-title fields in Style). */
  axes?: boolean;
  /** What the chart draws, for ggplot2 (with the axis titles in use). */
  figure?: (labels: AxisLabels) => FigureSpec;
}) {
  const style = useStore((s) => s.settings.charts);
  const project = useStore((s) => s.projectName);
  const readOnly = useStore((s) => s.cloud?.role === 'viewer');
  const [open, setOpen] = useState(false);
  const [ggOpen, setGgOpen] = useState(false);
  const [ggBusy, setGgBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const own = style.labels[id] ?? {};
  const labels = { x: own.x || defaults.x, y: own.y || defaults.y };

  const set = (patch: Partial<ChartStyle>) =>
    useStore
      .getState()
      .setSettings({ charts: { ...useStore.getState().settings.charts, ...patch } });
  const setLabel = (axis: 'x' | 'y', v: string) => {
    const all = useStore.getState().settings.charts.labels;
    const next = { ...(all[id] ?? {}), [axis]: v.slice(0, 120) };
    set({ labels: { ...all, [id]: next } });
  };
  const resetLabels = () => {
    const { [id]: _drop, ...rest } = useStore.getState().settings.charts.labels;
    set({ labels: rest });
  };
  const save = (format: FigureFormat) => {
    const svg = box.current?.querySelector('svg');
    if (!svg) return;
    exportFigure(
      format,
      standaloneSvg(svg, width, height),
      width,
      height,
      `${safeFileName(project)}-${safeFileName(name)}`,
    ).catch((e) =>
      useStore
        .getState()
        .toast(
          'error',
          `Could not export the chart: ${e instanceof Error ? e.message : String(e)}`,
        ),
    );
  };

  const ggplot = async (format: GgFormat | 'r') => {
    if (!figure) return;
    setGgOpen(false);
    setGgBusy(true);
    const stem = `${safeFileName(project)}-${safeFileName(name)}`;
    try {
      const { ggplotFile, ggplotScript } = await import('../figure/ggplot');
      if (format === 'r') {
        downloadText(`${stem}-ggplot2.R`, await ggplotScript(figure(labels), style));
      } else {
        downloadBlob(`${stem}-ggplot2.${format}`, await ggplotFile(figure(labels), style, format));
      }
    } catch (e) {
      useStore
        .getState()
        .toast(
          'error',
          `Could not draw the chart with ggplot2: ${e instanceof Error ? e.message : String(e)}`,
        );
    } finally {
      setGgBusy(false);
    }
  };

  useEscape(() => setOpen(false), open);
  useEscape(() => setGgOpen(false), ggOpen);
  useEffect(() => {
    if (!open && !ggOpen) return;
    const onDown = (e: MouseEvent) => {
      if (box.current?.contains(e.target as Node)) return;
      setOpen(false);
      setGgOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open, ggOpen]);

  return (
    <figure
      className="chart-frame"
      ref={box}
      style={chartVars(style) as CSSProperties}
      data-chart-theme={style.theme}
    >
      {children(labels)}
      <div className="chart-tools">
        {!readOnly && (
          <button
            className={`btn sm ghost${open ? ' on' : ''}`}
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            title="Theme, font, size, colour and axis titles"
          >
            Style
          </button>
        )}
        <button
          className="btn sm ghost"
          onClick={() => save('pdf')}
          title="Vector PDF of this chart"
        >
          <IconDownload size={13} /> PDF
        </button>
        <button className="btn sm ghost" onClick={() => save('png')} title="PNG at 3× resolution">
          <IconDownload size={13} /> PNG
        </button>
        <button
          className="btn sm ghost"
          onClick={() => save('svg')}
          title="SVG (vector, editable in Illustrator or Inkscape)"
        >
          <IconDownload size={13} /> SVG
        </button>
        {figure && (
          <button
            className={`btn sm ghost${ggOpen ? ' on' : ''}`}
            onClick={() => setGgOpen(!ggOpen)}
            aria-expanded={ggOpen}
            disabled={ggBusy}
            title="This chart drawn by ggplot2 in R, or the R script that draws it"
          >
            {ggBusy ? 'Drawing with ggplot2…' : 'ggplot2'}
          </button>
        )}
      </div>
      {ggOpen && (
        <div className="chart-style chart-ggplot" role="menu" aria-label="Draw with ggplot2">
          <button className="btn sm" role="menuitem" onClick={() => ggplot('pdf')}>
            <IconDownload size={13} /> PDF (vector)
          </button>
          <button
            className="btn sm"
            role="menuitem"
            onClick={() => ggplot('svg')}
            title="Needs desktop R through the helper (svglite)"
          >
            <IconDownload size={13} /> SVG (vector, desktop R)
          </button>
          <button className="btn sm" role="menuitem" onClick={() => ggplot('png')}>
            <IconDownload size={13} /> PNG (300 dpi)
          </button>
          <button className="btn sm" role="menuitem" onClick={() => ggplot('r')}>
            <IconDownload size={13} /> R script
          </button>
          <div className="hint">
            Drawn by ggplot2 with this project’s theme, font and size. The script holds the data and
            draws the same figure in your R.
          </div>
        </div>
      )}
      {open && (
        <div className="chart-style" role="dialog" aria-label="Chart style">
          <label>
            Font
            <select
              className="select"
              value={style.font}
              onChange={(e) => set({ font: e.target.value as ChartFont })}
            >
              {(Object.keys(CHART_FONTS) as ChartFont[]).map((f) => (
                <option key={f} value={f}>
                  {CHART_FONTS[f].label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Theme
            <select
              className="select"
              value={style.theme}
              onChange={(e) => set({ theme: e.target.value as ChartTheme })}
            >
              {(Object.keys(CHART_THEMES) as ChartTheme[]).map((t) => (
                <option key={t} value={t}>
                  {CHART_THEMES[t].label}
                </option>
              ))}
            </select>
          </label>
          <div className="row2">
            <label>
              Size
              <input
                className="input num"
                type="number"
                min={CHART_SIZE[0]}
                max={CHART_SIZE[1]}
                value={style.size}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v))
                    set({ size: Math.min(CHART_SIZE[1], Math.max(CHART_SIZE[0], Math.round(v))) });
                }}
              />
            </label>
            <label>
              Colour
              <input
                type="color"
                value={style.color}
                onChange={(e) => set({ color: e.target.value })}
              />
            </label>
          </div>
          {axes && (
            <>
              <label>
                Horizontal axis title
                <input
                  className="input"
                  value={own.x ?? ''}
                  placeholder={defaults.x}
                  onChange={(e) => setLabel('x', e.target.value)}
                />
              </label>
              <label>
                Vertical axis title
                <input
                  className="input"
                  value={own.y ?? ''}
                  placeholder={defaults.y}
                  onChange={(e) => setLabel('y', e.target.value)}
                />
              </label>
            </>
          )}
          <div className="hint">
            Theme, font, size and colour apply to every chart in this project
            {axes ? '; axis titles to this chart' : ''}.
          </div>
          {(own.x || own.y) && (
            <button className="btn sm" onClick={resetLabels}>
              Default axis titles
            </button>
          )}
        </div>
      )}
      {caption}
    </figure>
  );
}
