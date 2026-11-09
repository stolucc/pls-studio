import { useEffect, useMemo, useState } from 'react';
import { exportFigure, type FigureFormat } from '../figure/export';
import { renderFigureSvg, type FigureInput } from '../figure/render';
import { FIGURE_PRESETS, matchPreset, type FigureStyle } from '../figure/style';
import { safeFileName } from '../format';
import { useStore } from '../store';
import { IconDownload, IconX } from './icons';

const COLORS: [keyof FigureStyle, string][] = [
  ['constructFill', 'Construct fill'], ['constructStroke', 'Construct outline'], ['indicatorFill', 'Indicator fill'], ['gradientEnd', 'Gradient end'], ['copulaFill', 'Copula fill'], ['copulaStroke', 'Copula outline'], ['copulaArrow', 'Copula arrows'],
  ['indicatorStroke', 'Indicator outline'], ['indicatorArrow', 'Indicator arrows'], ['pathColor', 'Paths'],
  ['correlationColor', 'Correlations'], ['moderationColor', 'Moderation'], ['labelSignificant', 'Significant estimates'],
  ['labelNonSignificant', 'Non-significant estimates'],
];
const WIDTHS: [keyof FigureStyle, string, number, number][] = [
  ['pathWidth', 'Path width', 0.25, 8], ['indicatorArrowWidth', 'Indicator arrow width', 0.25, 6], ['constructStrokeWidth', 'Construct outline width', 0.25, 6],
];

/** Figure style editor with live preview and export (PDF, PNG, SVG). */
export function FigurePanel({ input, onClose }: { input: () => FigureInput; onClose: () => void }) {
  const style = useStore((s) => s.settings.figure);
  const setSettings = useStore((s) => s.setSettings);
  const project = useStore((s) => s.projectName);
  const toast = useStore((s) => s.toast);
  const [scale, setScale] = useState(3);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<FigureStyle>) => setSettings({ figure: { ...style, ...patch } });

  const figure = useMemo(() => renderFigureSvg(input(), style), [input, style]);
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    const url = URL.createObjectURL(new Blob([figure.svg], { type: 'image/svg+xml' }));
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [figure.svg]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const doExport = async (format: FigureFormat) => {
    setBusy(true);
    try {
      await exportFigure(format, figure.svg, figure.width, figure.height, `${safeFileName(project)}-diagram`, scale);
    } catch (e) {
      toast('error', `Export failed: ${(e as Error).message}`);
    } finally { setBusy(false); }
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal figure-panel" role="dialog" aria-modal="true" aria-labelledby="figure-title" onMouseDown={(e) => e.stopPropagation()}>
        <div className="share-head">
          <h3 id="figure-title">Figure</h3>
          <button className="btn icon ghost" onClick={onClose} aria-label="Close"><IconX /></button>
        </div>
        <div className="figure-body">
          <div className="figure-preview">{preview && <img src={preview} alt="Preview of the exported diagram" />}</div>
          <div className="figure-controls">
            <label className="field">Style
              <select className="select" value={matchPreset(style) ?? ''} onChange={(e) => e.target.value && setSettings({ figure: FIGURE_PRESETS[e.target.value].style })}>
                <option value="">Custom</option>
                {Object.entries(FIGURE_PRESETS).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
              </select>
            </label>
            {matchPreset(style) === 'amos' && <p className="hint">Resembles diagrams drawn by that program. PLS Studio is not affiliated with it (see About &amp; licences).</p>}
            {matchPreset(style) === 'semplot' && <p className="hint">In the manner of the R package semPlot (Epskamp): arrows green or red by sign, stronger and wider with the estimate; residuals as loops. Standardise for its scale. The layout stays yours; semPlot would arrange a tree.</p>}
            {matchPreset(style) === 'pls' && <p className="hint">Follows the model: PLS and CB-SEM models are drawn differently.</p>}
            <div className="row2">
              <label className="field">Font
                <select className="select" value={style.font} onChange={(e) => set({ font: e.target.value as FigureStyle['font'] })}>
                  <option value="helvetica">Helvetica (sans-serif)</option><option value="times">Times (serif)</option><option value="courier">Courier (monospace)</option>
                </select>
              </label>
              <label className="field">Font size
                <input className="input num" type="number" min={6} max={24} step={0.5} value={style.fontSize} onChange={(e) => set({ fontSize: Math.min(24, Math.max(6, Number(e.target.value) || 11)) })} />
              </label>
            </div>
            <div className="figure-colors">
              {COLORS.map(([k, label]) => (
                <label key={k} className="color-field">
                  <input type="color" value={style[k] as string} onChange={(e) => set({ [k]: e.target.value } as Partial<FigureStyle>)} aria-label={label} />{label}
                </label>
              ))}
            </div>
            <div className="row2">
              {WIDTHS.map(([k, label, lo, hi]) => (
                <label key={k} className="field">{label}
                  <input className="input num" type="number" min={lo} max={hi} step={0.25} value={style[k] as number} onChange={(e) => set({ [k]: Math.min(hi, Math.max(lo, Number(e.target.value) || lo)) } as Partial<FigureStyle>)} />
                </label>
              ))}
              <label className="field">Decimals
                <input className="input num" type="number" min={1} max={4} step={1} value={style.decimals} onChange={(e) => set({ decimals: Math.min(4, Math.max(1, Math.round(Number(e.target.value) || 3))) })} />
              </label>
            </div>
            <label className="field">Significance
              <select className="select" value={style.pFormat} onChange={(e) => set({ pFormat: e.target.value as FigureStyle['pFormat'] })}>
                <option value="p">p-values: 0.447 (p &lt; .001)</option><option value="stars">Stars: 0.447***</option><option value="none">None</option>
              </select>
            </label>
            {([['circleConstructs', 'Circles for factors, names outside'], ['gradientFill', 'Gradient fill (left to right)'], ['pathWidthByEffect', 'Thicker paths for larger effects'], ['labelBoxes', 'Outline around estimates'], ['showEstimates', 'Show estimates'], ['showR2', 'Show R²']] as [keyof FigureStyle, string][]).map(([k, label]) => (
              <label key={k} className="check"><input type="checkbox" checked={style[k] as boolean} onChange={(e) => set({ [k]: e.target.checked } as Partial<FigureStyle>)} /> {label}</label>
            ))}
            <label className="check"><input type="checkbox" checked={style.notation === 'amos'} onChange={(e) => set({ notation: e.target.checked ? 'amos' : 'standard' })} /> Amos notation: .85 beside the lines, e1, R² above the variable</label>
            <p className="hint">The style also applies to the diagram on screen and is saved with the project. Error terms and the standardised / unstandardised choice follow the canvas toolbar. PDF uses the built-in PDF fonts, so error terms read e / d instead of ε / ζ.</p>
            <div className="figure-export">
              <button className="btn primary" disabled={busy} onClick={() => void doExport('pdf')}><IconDownload size={13} /> PDF (vector)</button>
              <button className="btn" disabled={busy} onClick={() => void doExport('png')}><IconDownload size={13} /> PNG</button>
              <select className="select" value={scale} onChange={(e) => setScale(Number(e.target.value))} aria-label="PNG resolution" style={{ width: 'auto' }}>
                <option value={2}>2×</option><option value={3}>3× (~300 dpi)</option><option value={4}>4×</option>
              </select>
              <button className="btn" disabled={busy} onClick={() => void doExport('svg')}><IconDownload size={13} /> SVG</button>
            </div>
            <div className="hint">{figure.width} × {figure.height} pt</div>
          </div>
        </div>
      </div>
    </div>
  );
}
