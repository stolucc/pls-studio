import { Handle, Position, useConnection, type Node, type NodeProps } from '@xyflow/react';
import { memo, useState, type DragEvent } from 'react';
import { hexagonVertices, type ConstructGeom } from '../geometry';
import type { Construct, Method } from '../model/project';
import { useStore, type Tool } from '../store';
import { readDraggedVars, VARS_MIME } from './dnd';

/** fixed: the marker loading, fixed to 1 for identification (CB-SEM). */
// Stable fallback: a selector returning a fresh [] would re-render forever.
const NO_ORDERED: string[] = [];

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
  const composite = c.type === 'composite';
  const nonDefaultMode = method === 'pls' && (composite ? c.mode === 'A' : c.mode === 'B');
  const onDouble = () => { setDraft(c.name); setEditing(true); };
  const higher = (c.components?.length ?? 0) > 0;
  const nameY = c.covariate ? 4 : r2 !== null || (c.indicators.length === 0 && !higher) ? -5 : 4;

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
          {geom.indicators.map((ind, i) => {
            const label = labels?.[i];
            const mx = (ind.ex + ind.ax) / 2, my = (ind.ey + ind.ay) / 2;
            return (
              <g key={ind.name} data-ind={ind.name} className={picked === ind.name ? 'picked' : undefined}>
                <line
                  className="iline"
                  x1={composite ? ind.ax : ind.ex} y1={composite ? ind.ay : ind.ey}
                  x2={composite ? ind.ex : ind.ax} y2={composite ? ind.ey : ind.ay}
                  markerEnd="url(#arrow-ind)"
                />
                <rect className="ibox" x={ind.x} y={ind.y} width={ind.w} height={ind.h} rx={5} />
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
          {c.covariate
            ? <rect className="ellipse observed" x={-rx} y={-ry} width={rx * 2} height={ry * 2} rx={4} onDoubleClick={onDouble} />
            : composite
              ? <polygon className="ellipse" points={hexagonVertices(rx, ry).map((v) => v.join(',')).join(' ')} onDoubleClick={onDouble} />
              : <ellipse className="ellipse" cx={0} cy={0} rx={rx} ry={ry} onDoubleClick={onDouble} />}
          {nonDefaultMode && <text className="cmode" x={0} y={-ry - 8} textAnchor="middle">MODE {c.mode}</text>}
          {!editing && (
            <text className="cname" x={0} y={nameY} textAnchor="middle" pointerEvents="none">{c.name}</text>
          )}
          {r2 !== null && (
            <text className="cmeta" x={0} y={13} textAnchor="middle" pointerEvents="none">R² {r2.toFixed(3)}</text>
          )}
          {r2 === null && c.indicators.length === 0 && !higher && (
            <text className="cmeta" x={0} y={13} textAnchor="middle" pointerEvents="none" style={{ fill: 'var(--text-3)' }}>drop variables</text>
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
