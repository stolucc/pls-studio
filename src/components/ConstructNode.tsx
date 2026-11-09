import { Handle, Position, useConnection, type Node, type NodeProps } from '@xyflow/react';
import { memo, useState, type DragEvent } from 'react';
import { besideLine, BOX_RX, constructsAreCircles, hexagonVertices, type ConstructGeom } from '../geometry';
import type { Construct, Method } from '../model/project';
import { formatEstimate } from '../figure/style';
import { useStore, type Tool } from '../store';
import { readDraggedVars, VARS_MIME } from './dnd';

/** fixed: the marker loading, fixed to 1 for identification (CB-SEM). */
// Stable fallback: a selector returning a fresh [] would re-render forever.
const NO_ORDERED: string[] = [];


/**
 * PLS-SEM: the weighting mode shown, gently, above every construct with
 * indicators; `unusual` (a common factor in Mode B, a composite in Mode A)
 * is drawn a touch stronger. Other methods: none.
 */
export function modeLabel(method: string, c: Pick<Construct, 'type' | 'mode' | 'indicators'> & { categorical?: Construct['categorical'] }): { text: string; title: string; unusual: boolean } | null {
  if (method !== 'pls' || c.indicators.length === 0) return null;
  if (c.categorical && c.indicators.length === 1) return { text: 'Categorical', title: 'Categorical: k − 1 dummy variables forming a composite (Mode B)', unusual: false };
  return {
    text: c.mode === 'unit' ? 'Sum scores' : `Mode ${c.mode}`,
    // Mode A / B are PLS weighting algorithms, not measurement models (Henseler 2021): either can
    // estimate a composite; a common factor is estimated consistently with PLSc.
    title: c.mode === 'A' ? 'Mode A: PLS weights from correlations (an estimation choice, not a measurement model)'
      : c.mode === 'B' ? 'Mode B: PLS weights from a multiple regression (an estimation choice, not a measurement model)'
        : 'Sum scores: equal weights on the standardised indicators (an estimation choice, not a measurement model)',
    unusual: c.type === 'composite' ? c.mode === 'A' : c.mode === 'B',
  };
}
export interface IndicatorLabel { text: string; level: 'ok' | 'mid' | 'low'; fixed?: boolean }

export type ConstructNodeData = {
  construct: Construct;
  geom: ConstructGeom;
  r2: number | null;
  labels: (IndicatorLabel | null)[] | null;
  hasError: boolean;
  tool: Tool;
  method: Method;
  /** Correlation tool: this construct (true) or one of its indicators (name) is the first end. */
  picked?: boolean | string;
};
export type ConstructFlowNode = Node<ConstructNodeData, 'construct'>;

function ConstructNodeImpl({ data, selected }: NodeProps<ConstructFlowNode>) {
  const { construct: c, geom, r2, labels, hasError, tool, method, picked } = data;
  const { rx, ry, bounds } = geom;
  const cx = -bounds.x, cy = -bounds.y;
  const connecting = useConnection((s) => s.inProgress);
  const figure = useStore((st) => st.settings.figure);
  const amos = figure.notation === 'amos';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(c.name);
  const [dropping, setDropping] = useState(false);
  const updateConstruct = useStore((s) => s.updateConstruct);
  const assignIndicators = useStore((s) => s.assignIndicators);
  const known = useStore((s) => s.data?.names);

  const commitName = () => {
    const name = draft.trim().slice(0, 100);
    if (name && name !== c.name) updateConstruct(c.id, { name });
    setEditing(false);
  };

  const onDragOver = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes(VARS_MIME)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    setDropping(true);
  };
  const onDrop = (e: DragEvent) => {
    setDropping(false);
    const names = readDraggedVars(e, known ?? []);
    if (!names) return;
    e.preventDefault();
    e.stopPropagation();
    assignIndicators(c.id, names);
  };

  const cover = { left: cx - rx, top: cy - ry, width: rx * 2, height: ry * 2 };
  // Factors emit arrows to their indicators; composites are formed by them.
  const ordinal = new Set(useStore((st) => (st.settings.method === 'cbsem' ? st.model.ordered : undefined)) ?? NO_ORDERED);
  const esem = useStore((st) => st.settings.method === 'cbsem' && !!st.model.esem?.blocks.some((b) => b.constructs.includes(c.id)));
  const composite = c.type === 'composite';
  // Conditional process analysis: variables are observed (a single item, or the mean of several items)
  // unless modelled as latent; draw them as rectangles, as in PROCESS diagrams.
  const observedInCpa = useStore((st) => st.settings.method === 'process') && !(c.latent && c.indicators.length > 1);
  const mode = modeLabel(method, c);
  const onDouble = () => { setDraft(c.name); setEditing(true); };
  const higher = (c.components?.length ?? 0) > 0;
  // With circles, names are outside the shape: below, or above when the indicators hang below.
  const circle = constructsAreCircles() && !c.covariate;
  // (above a name that sits above the circle)
  const modeY = circle && c.side === 'bottom' ? -ry - 20 : -ry - 8;
  const nameY = circle ? (c.side === 'bottom' ? -ry - 6 : ry + 17) : c.covariate ? 4 : (r2 !== null && !amos) || (c.indicators.length === 0 && !higher) ? -5 : 4;

  return (
    <div
      className={`cnode${selected || picked === true ? ' selected' : ''}${hasError ? ' error' : ''}${dropping ? ' drop' : ''}${tool === 'correlate' ? ' picking' : ''}`}
      style={{ width: bounds.w, height: bounds.h }}
      onDragOver={onDragOver}
      onDragLeave={() => setDropping(false)}
      onDrop={onDrop}
    >
      <svg width={bounds.w} height={bounds.h}>
        <g transform={`translate(${cx} ${cy})`}>
          {!(observedInCpa && c.indicators.length === 1) && geom.indicators.map((ind, i) => {
            const label = labels?.[i];
            // Amos notation: the number beside the arrow, not on it.
            const off = amos ? besideLine(ind.ex, ind.ey, ind.ax, ind.ay, 9, 5) : { dx: 0, dy: 0 };
            const mx = (ind.ex + ind.ax) / 2 + off.dx, my = (ind.ey + ind.ay) / 2 + off.dy;
            return (
              <g key={ind.name} data-ind={ind.name} className={picked === ind.name ? 'picked' : undefined}>
                <line
                  className="iline"
                  x1={composite ? ind.ax : ind.ex} y1={composite ? ind.ay : ind.ey}
                  x2={composite ? ind.ex : ind.ax} y2={composite ? ind.ey : ind.ay}
                  markerEnd={figure.notation === 'smartpls' && c.indicators.length === 1 ? undefined : 'url(#arrow-ind)'}
                />
                <rect className="ibox" x={ind.x} y={ind.y} width={ind.w} height={ind.h} rx={BOX_RX} />
                <text className="itext" x={ind.x + ind.w / 2} y={ind.y + ind.h / 2 + 4} textAnchor="middle">{ind.name}</text>
                {ordinal.has(ind.name) && (
                  <text className="iord" x={ind.x + ind.w - 3} y={ind.y + 8} textAnchor="end">
                    ord<title>Ordinal (ordered categorical): thresholds and polychoric correlations, WLSMV</title>
                  </text>
                )}
                {label && (
                  <g className={label.fixed ? 'fixed' : undefined}>
                    {label.fixed && <title>Fixed loading: held at its value, not estimated (the first indicator’s 1 sets the factor’s scale). Right-click to change it. A standardised value is shown when it differs.</title>}
                    <rect className="ilabel-bg" x={mx - 19} y={my - 8} width={38} height={15} rx={7.5} />
                    <text className={`ilabel ${label.level}`} x={mx} y={my + 3.5} textAnchor="middle">{label.text}</text>
                  </g>
                )}
              </g>
            );
          })}
          {c.covariate || observedInCpa
            ? <rect className="ellipse observed" x={-rx} y={-ry} width={rx * 2} height={ry * 2} rx={BOX_RX} onDoubleClick={onDouble} />
            : composite
              ? <polygon className="ellipse" points={hexagonVertices(rx, ry).map((v) => v.join(',')).join(' ')} onDoubleClick={onDouble} />
              : <ellipse className="ellipse" cx={0} cy={0} rx={rx} ry={ry} onDoubleClick={onDouble} />}
          {mode && <text className={`cmode${mode.unusual ? ' unusual' : ''}`} x={0} y={modeY} textAnchor="middle">{mode.text}<title>{mode.title}</title></text>}
          {esem && <text className="cmode" x={0} y={modeY} textAnchor="middle">ESEM<title>Exploratory SEM block: this factor loads on all the block’s indicators (rotated); only its main loadings are drawn.</title></text>}
          {!editing && (
            <text className="cname" x={0} y={nameY} textAnchor="middle" pointerEvents="none">{c.name}</text>
          )}
          {r2 !== null && (
            (amos
              ? <text className="cmeta" x={rx * 0.5} y={-ry - 3} textAnchor="middle" pointerEvents="none">{formatEstimate(figure, r2)}<title>R² (squared multiple correlation)</title></text>
              : <text className="cmeta" x={0} y={circle ? 4 : 13} textAnchor="middle" pointerEvents="none">{figure.notation === 'smartpls' ? '' : 'R² '}{formatEstimate(figure, r2)}{figure.notation === 'smartpls' && <title>R²</title>}</text>)
          )}
          {r2 === null && c.indicators.length === 0 && !higher && (
            <text className="cmeta" x={0} y={circle ? 4 : 13} textAnchor="middle" pointerEvents="none" style={circle ? undefined : { fill: 'var(--text-3)' }}>drop variables</text>
          )}
        </g>
      </svg>

      {editing && (
        <input
          className="rename nodrag"
          autoFocus
          value={draft}
          maxLength={100}
          style={{ left: cx - rx + 8, top: cy + nameY - 17, width: rx * 2 - 16 }}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitName();
            if (e.key === 'Escape') setEditing(false);
            e.stopPropagation();
          }}
        />
      )}

      <Handle
        type="target" id="t" position={Position.Left} className="handle-cover" isConnectableStart={false}
        style={{ ...cover, pointerEvents: connecting ? 'all' : 'none' }}
      />
      <Handle
        type="source" id="sc" position={Position.Right} className="handle-cover"
        style={{ ...cover, pointerEvents: tool === 'connect' && !connecting ? 'all' : 'none', cursor: 'crosshair' }}
      />
      <Handle
        type="source" id="s" position={Position.Right} className="handle-dot" title="Drag to draw a path"
        style={{ left: cx + rx, top: cy, right: 'auto', transform: 'translate(-50%, -50%)', display: tool === 'connect' ? 'none' : undefined }}
      />
    </div>
  );
}

export const ConstructNode = memo(ConstructNodeImpl);
