// The canvas's fixed parts: the SVG markers its arrows use, the line drawn while connecting, the tool dock, and
// the card of an empty canvas.

import { useReactFlow, type ConnectionLineComponentProps } from '@xyflow/react';
import type { Dataset } from '../../engine/types';
import { GRADIENT_CONSTRUCT, GRADIENT_INDICATOR, PLS_STYLE_ERROR } from '../../figure/style';
import { importModelSyntax } from '../../io';
import { impliedIntercepts, type Method } from '../../model/project';
import { useStore, type Tool } from '../../store';
import { IconArrow, IconCorrelate, IconDownload, IconEllipse, IconErrorTerm, IconLayout, IconPointer, IconSparkle, IconTriangle, IconUpload, IconNote } from '../icons';

/** The line drawn while connecting. */
export function ConnectionLine({ fromX, fromY, toX, toY }: ConnectionLineComponentProps) {
  return <path d={`M ${fromX} ${fromY} L ${toX} ${toY}`} stroke="var(--accent)" strokeWidth={1.8} strokeDasharray="5 4" fill="none" markerEnd="url(#arrow-path-sel)" />;
}

/** The SVG gradients and arrowheads the diagram uses. */
export function Markers() {
  return (
    <svg width={0} height={0} style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        <linearGradient id={GRADIENT_CONSTRUCT}><stop offset={0} style={{ stopColor: 'var(--construct-fill-from)' }} /><stop offset={1} style={{ stopColor: 'var(--fill-to)' }} /></linearGradient>
        <linearGradient id={GRADIENT_INDICATOR}><stop offset={0} style={{ stopColor: 'var(--indicator-fill-from)' }} /><stop offset={1} style={{ stopColor: 'var(--fill-to)' }} /></linearGradient>
        <marker id="arrow-sp" viewBox="0 0 10 10" refX={9} refY={5} markerWidth={5} markerHeight={5} orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="context-stroke" />
        </marker>
        <marker id="arrow-gc" viewBox="0 0 10 10" refX={9.5} refY={5} markerWidth={8} markerHeight={8} orient="auto">
          <path d="M1,1 L9.5,5 L1,9" fill="none" stroke="var(--gc-arrow, #b45309)" strokeWidth={1.4} />
        </marker>
        <marker id="err-diamond" viewBox="0 0 10 10" refX={5} refY={5} markerWidth={8} markerHeight={8} markerUnits="userSpaceOnUse" orient="auto">
          <path d="M5,0 L10,5 L5,10 L0,5 z" fill={PLS_STYLE_ERROR} />
        </marker>
        <marker id="arrow-ind" viewBox="0 0 10 10" refX={9.5} refY={5} markerWidth={7} markerHeight={7} orient="auto-start-reverse">
          <path d="M0,1 L10,5 L0,9 z" fill="var(--indicator-arrow, #9aa3b5)" />
        </marker>
        <marker id="arrow-path" viewBox="0 0 10 10" refX={9} refY={5} markerWidth={5} markerHeight={5} orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="var(--path)" />
        </marker>
        <marker id="arrow-path-sel" viewBox="0 0 10 10" refX={9} refY={5} markerWidth={5} markerHeight={5} orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="var(--accent)" />
        </marker>
        <marker id="arrow-mod" viewBox="0 0 10 10" refX={10} refY={5} markerWidth={6} markerHeight={6} orient="auto-start-reverse">
          <path d="M0,1 L10,5 L0,9 z" fill="var(--mod, #8b5cf6)" />
        </marker>
        <marker id="arrow-mod-sel" viewBox="0 0 10 10" refX={10} refY={5} markerWidth={6} markerHeight={6} orient="auto-start-reverse">
          <path d="M0,1 L10,5 L0,9 z" fill="var(--accent)" />
        </marker>
      </defs>
    </svg>
  );
}

const TOOLS: { id: Tool; label: string; key: string; icon: typeof IconPointer }[] = [
  { id: 'select', label: 'Select', key: 'V', icon: IconPointer },
  { id: 'construct', label: 'Construct', key: 'C', icon: IconEllipse },
  { id: 'connect', label: 'Path', key: 'P', icon: IconArrow },
  { id: 'correlate', label: 'Correlation', key: 'R', icon: IconCorrelate },
];

/** The canvas toolbar: tools, arrange, constant, comment, figure, and the diagram's display switches. */
export function ToolDock({ empty, implied, onFigure }: { empty: boolean; implied: unknown[]; onFigure: () => void }) {
  const st = useStore.getState;
  const rf = useReactFlow();
  const model = useStore((s) => s.model);
  const tool = useStore((s) => s.tool);
  const method = useStore((s) => s.settings.method);
  const readOnly = useStore((s) => s.cloud?.role === 'viewer');
  const showErrors = useStore((s) => s.showErrorTerms);
  const showImplied = useStore((s) => s.showImpliedEffects);
  const showIntercepts = useStore((s) => s.showIntercepts);
  const unstd = useStore((s) => s.estimateScale) === 'unstd';
  const tools = method === 'cbsem' ? TOOLS : TOOLS.filter((t) => t.id !== 'correlate');
  return (
    <div className="tool-dock" role="toolbar" aria-label="Canvas tools">
      {tools.map((t) => (
        <button key={t.id} className={`btn ghost${tool === t.id ? ' on' : ''}`} onClick={() => st().setTool(t.id)} title={`${t.label} (${t.key})`}>
          <t.icon /> {t.label} <span className="kbd">{t.key}</span>
        </button>
      ))}
      <div className="sep" />
      <button className="btn ghost" onClick={() => st().layout()} disabled={empty} title="Arrange constructs automatically">
        <IconLayout /> Arrange
      </button>
      {method === 'cbsem' && !readOnly && !model.constant && (
        <button className="btn sm ghost" onClick={() => st().addConstant()} title="Add the constant (a triangle, 1): lavaan’s mean structure. Its arrows are latent means and intercepts.">
          <IconTriangle /> Constant
        </button>
      )}
      <button className="btn sm ghost" onClick={() => { const v = rf.getViewport(); st().addNote((80 - v.x) / v.zoom, (120 - v.y) / v.zoom); }} title="Add a comment to the diagram. It is saved with the project and exported with the figure">
          <IconNote /> Comment
        </button>
      <button className="btn ghost" onClick={() => onFigure()} disabled={empty} title="Figure style and export (PDF, PNG, SVG)">
        <IconDownload /> Figure
      </button>
      {method === 'cbsem' && (
        <div className="segmented dock-seg" role="radiogroup" aria-label="Estimates on the diagram">
          <button role="radio" aria-checked={!unstd} className={!unstd ? 'on' : ''} onClick={() => st().setEstimateScale('std')} title="Standardised estimates (std.all)">Std</button>
          <button role="radio" aria-checked={unstd} className={unstd ? 'on' : ''} onClick={() => st().setEstimateScale('unstd')} title="Unstandardised estimates (marker loadings are 1)">Unstd</button>
        </div>
      )}
      {!!model.constant && impliedIntercepts(model).length > 0 && (
        <button className={`btn ghost${showIntercepts ? ' on' : ''}`} onClick={() => st().setShowIntercepts(!showIntercepts)} aria-pressed={showIntercepts}
          title={showIntercepts ? 'Hide the intercepts the mean structure implies (they are estimated either way)' : 'Show the intercepts the mean structure implies, as dashed arrows from the constant (they are estimated either way)'}>
          Intercepts
        </button>
      )}
      {implied.length > 0 && (
        <button className={`btn ghost${showImplied ? ' on' : ''}`} onClick={() => st().setShowImpliedEffects(!showImplied)} aria-pressed={showImplied}
          title={showImplied ? 'Hide what the model implies (dashed: the moderators’ main effects; they are estimated either way)' : 'Show what the model implies as dashed arrows (the moderators’ main effects; they are estimated either way)'}>
          Implied
        </button>
      )}
      {method === 'cbsem' && (
        <button className={`btn ghost${showErrors ? ' on' : ''}`} onClick={() => st().setShowErrorTerms(!showErrors)} aria-pressed={showErrors}
          title={showErrors ? 'Hide error terms (ε) and disturbances (ζ)' : 'Show error terms (ε) and disturbances (ζ)'}>
          <IconErrorTerm /> Errors
        </button>
      )}
    </div>
  );
}

/** The card on an empty canvas: how to start, for conditional process analysis or a model of one's own. */
export function CanvasEmpty({ method, data, readOnly, onImport, onTemplates }: { method: Method; data: Dataset | null; readOnly: boolean; onImport: () => void; onTemplates: () => void }) {
  return (
    <div className="canvas-empty">
      <div className="card">
        <IconSparkle size={22} style={{ color: 'var(--accent)' }} />
        <h2>Start your model</h2>
        {method === 'process' ? (
          <>
            <p>Pick one of Hayes’s PROCESS models (mediation, moderation, moderated mediation) and drag your variables onto its slots, or draw your own model: one X, one Y, mediators between them, and moderators pointing at paths.</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn primary" onClick={() => onTemplates()} disabled={readOnly}><IconSparkle size={14} /> Choose a PROCESS model</button>
              {!data && <button className="btn" onClick={onImport}><IconUpload /> Import data</button>}
            </div>
          </>
        ) : data ? (
          <>
          <p>Draw the model here and estimate it by PLS-SEM, CB-SEM or conditional process analysis (CPA): choose in the top bar. Further analyses (factor analysis, growth curves, regression, matching, …) are on the Analyses tab.</p>
          <ol className="steps">
            <li>Drag variables from the left panel onto the canvas to create a construct.</li>
            <li>Drop more variables on a construct to add indicators.</li>
            <li>Drag from a construct's right-hand dot to another construct to add a path.</li>
            <li>Press <b>Calculate</b>.</li>
          </ol>
          </>
        ) : (
          <>
            <p>Draw your model now and import the data when you have it, or import first: one column per variable, CSV, SPSS, Stata or Excel, or a labelled covariance matrix. Then estimate by PLS-SEM, CB-SEM or conditional process analysis (CPA).</p>
            <ol className="steps">
              <li>Choose <b>Construct</b> in the toolbar and click the canvas; double-click to name it.</li>
              <li>In its panel, type the names of its indicators (the data’s column names).</li>
              <li>Drag from a construct’s right-hand dot to another construct to add a path.</li>
            </ol>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn primary" onClick={onImport}><IconUpload /> Import data</button>
              <button className="btn" onClick={() => void importModelSyntax()} disabled={readOnly} title="lavaan or Mplus MODEL syntax: factors, regressions, covariances">Paste model syntax</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
