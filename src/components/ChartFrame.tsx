import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { CHART_FONTS, CHART_SIZE, chartVars, type ChartFont, type ChartStyle } from '../figure/chartStyle';
import { exportFigure, type FigureFormat } from '../figure/export';
import { standaloneSvg } from '../figure/standalone';
import { safeFileName } from '../format';
import { useStore } from '../store';
import { IconDownload } from './icons';

export interface AxisLabels { x: string; y: string }

/**
 * A result chart with its tools: text style (font, size, colour, shared by all
 * charts of the project), this chart's axis titles, and export as vector PDF
 * or PNG. `children` draws the SVG with the axis titles it is given.
 */
export function ChartFrame({ id, name, defaults, width, height, children, caption }: {
  /** Stable key for this chart's axis titles. */
  id: string;
  /** File name stem for exports. */
  name: string;
  defaults: AxisLabels;
  width: number;
  height: number;
  children: (labels: AxisLabels) => ReactNode;
  caption?: ReactNode;
}) {
  const style = useStore((s) => s.settings.charts);
  const project = useStore((s) => s.projectName);
  const readOnly = useStore((s) => s.cloud?.role === 'viewer');
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const own = style.labels[id] ?? {};
  const labels = { x: own.x || defaults.x, y: own.y || defaults.y };

  const set = (patch: Partial<ChartStyle>) => useStore.getState().setSettings({ charts: { ...useStore.getState().settings.charts, ...patch } });
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
    exportFigure(format, standaloneSvg(svg, width, height), width, height, `${safeFileName(project)}-${safeFileName(name)}`)
      .catch((e) => useStore.getState().toast('error', `Could not export the chart: ${e instanceof Error ? e.message : String(e)}`));
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    const onDown = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onDown);
    return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('mousedown', onDown); };
  }, [open]);

  return (
    <figure className="chart-frame" ref={box} style={chartVars(style) as CSSProperties}>
      {children(labels)}
      <div className="chart-tools">
        {!readOnly && <button className={`btn sm ghost${open ? ' on' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open} title="Font, size, colour and axis titles">Style</button>}
        <button className="btn sm ghost" onClick={() => save('pdf')} title="Vector PDF of this chart"><IconDownload size={13} /> PDF</button>
        <button className="btn sm ghost" onClick={() => save('png')} title="PNG at 3× resolution"><IconDownload size={13} /> PNG</button>
      </div>
      {open && (
        <div className="chart-style" role="dialog" aria-label="Chart style">
          <label>Font
            <select className="select" value={style.font} onChange={(e) => set({ font: e.target.value as ChartFont })}>
              {(Object.keys(CHART_FONTS) as ChartFont[]).map((f) => <option key={f} value={f}>{CHART_FONTS[f].label}</option>)}
            </select>
          </label>
          <div className="row2">
            <label>Size
              <input className="input num" type="number" min={CHART_SIZE[0]} max={CHART_SIZE[1]} value={style.size}
                onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) set({ size: Math.min(CHART_SIZE[1], Math.max(CHART_SIZE[0], Math.round(v))) }); }} />
            </label>
            <label>Colour
              <input type="color" value={style.color} onChange={(e) => set({ color: e.target.value })} />
            </label>
          </div>
          <label>Horizontal axis title
            <input className="input" value={own.x ?? ''} placeholder={defaults.x} onChange={(e) => setLabel('x', e.target.value)} />
          </label>
          <label>Vertical axis title
            <input className="input" value={own.y ?? ''} placeholder={defaults.y} onChange={(e) => setLabel('y', e.target.value)} />
          </label>
          <div className="hint">Font, size and colour apply to every chart in this project; axis titles to this chart.</div>
          {(own.x || own.y) && <button className="btn sm" onClick={resetLabels}>Default axis titles</button>}
        </div>
      )}
      {caption}
    </figure>
  );
}
