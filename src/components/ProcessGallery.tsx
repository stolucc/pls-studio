import { useState } from 'react';
import { switchMethod } from '../methodSwitch';
import { slotRoles, templatePositions } from '../process/canvas';
import {
  describe,
  familyOf,
  materialise,
  mediatorRange,
  TEMPLATES,
  type ProcessGraph,
  type Template,
} from '../process/templates';
import { useStore } from '../store';
import { IconX } from './icons';
import { confirmDialog } from './Overlays';
import { useEscape } from './useEscape';

const NODE_W = 34;
const NODE_H = 20;

/** A conceptual diagram of a template (Hayes style): boxes, solid paths, dashed moderation arrows. */
export function TemplateDiagram({
  g,
  pos,
  width = 220,
  height = 120,
}: {
  g: ProcessGraph;
  pos: Map<string, { x: number; y: number }>;
  width?: number;
  height?: number;
}) {
  const pts = [...pos.values()];
  const minX = Math.min(...pts.map((p) => p.x));
  const maxX = Math.max(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y));
  const maxY = Math.max(...pts.map((p) => p.y));
  const pad = 14;
  const k = Math.min(
    (width - 2 * pad - NODE_W) / Math.max(1, maxX - minX),
    (height - 2 * pad - NODE_H) / Math.max(1, maxY - minY),
  );
  const at = (v: string) => {
    const p = pos.get(v)!;
    return { x: pad + NODE_W / 2 + (p.x - minX) * k, y: pad + NODE_H / 2 + (p.y - minY) * k };
  };
  // Ends of a segment trimmed to the boxes' borders.
  const clip = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.min(
      NODE_W / 2 / Math.max(1e-9, Math.abs(dx)),
      NODE_H / 2 / Math.max(1e-9, Math.abs(dy)),
    );
    return { x: a.x + dx * t, y: a.y + dy * t };
  };
  const seg = (from: string, to: string) => {
    const a = at(from);
    const b = at(to);
    return { a: clip(a, b), b: clip(b, a) };
  };
  const mid = (s: { a: { x: number; y: number }; b: { x: number; y: number } }) => ({
    x: (s.a.x + s.b.x) / 2,
    y: (s.a.y + s.b.y) / 2,
  });
  const drawnMods = g.moderations.filter(
    (m) =>
      !g.threeWay.some(
        (t) => t.path[0] === m.path[0] && t.path[1] === m.path[1] && t.by[1] === m.by,
      ),
  );
  const modSeg = (by: string, target: { x: number; y: number }) => ({
    a: clip(at(by), target),
    b: target,
  });
  const vars = [...pos.keys()];
  return (
    <svg
      className="tpl-diagram"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
    >
      <defs>
        <marker
          id="tpl-arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M0,0 L10,5 L0,10 z" />
        </marker>
      </defs>
      {g.paths.map(([f, t]) => {
        const s = seg(f, t);
        return (
          <line
            key={`${f}>${t}`}
            className="tpl-path"
            x1={s.a.x}
            y1={s.a.y}
            x2={s.b.x}
            y2={s.b.y}
            markerEnd="url(#tpl-arrow)"
          />
        );
      })}
      {drawnMods.map((m) => {
        const target = mid(seg(...m.path));
        const s = m.by === m.path[0] ? null : modSeg(m.by, target);
        return (
          s && (
            <line
              key={`${m.path.join('>')}|${m.by}`}
              className="tpl-mod"
              x1={s.a.x}
              y1={s.a.y}
              x2={s.b.x}
              y2={s.b.y}
              markerEnd="url(#tpl-arrow)"
            />
          )
        );
      })}
      {g.threeWay.map((t) => {
        const w = modSeg(t.by[0], mid(seg(...t.path)));
        const s = modSeg(t.by[1], mid(w));
        return (
          <line
            key={`${t.path.join('>')}|${t.by.join('*')}`}
            className="tpl-mod"
            x1={s.a.x}
            y1={s.a.y}
            x2={s.b.x}
            y2={s.b.y}
            markerEnd="url(#tpl-arrow)"
          />
        );
      })}
      {/* Model 74: X moderating its own M → Y paths, drawn from X's box. */}
      {g.moderations
        .filter((m) => m.by === g.x && m.path[0] !== g.x)
        .map((m) => {
          const s = modSeg(m.by, mid(seg(...m.path)));
          return (
            <line
              key={`x|${m.path.join('>')}`}
              className="tpl-mod"
              x1={s.a.x}
              y1={s.a.y}
              x2={s.b.x}
              y2={s.b.y}
              markerEnd="url(#tpl-arrow)"
            />
          );
        })}
      {vars.map((v) => {
        const p = at(v);
        return (
          <g key={v} className="tpl-node">
            <rect x={p.x - NODE_W / 2} y={p.y - NODE_H / 2} width={NODE_W} height={NODE_H} rx={4} />
            <text x={p.x} y={p.y + 4} textAnchor="middle">
              {v}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function Card({ tp, onPick }: { tp: Template; onPick: (tp: Template, k: number) => void }) {
  const [lo, hi] = mediatorRange(tp);
  const [k, setK] = useState(lo);
  const roles = slotRoles(tp, k);
  const g = materialise(tp, roles);
  const pos = templatePositions(tp, roles);
  return (
    <div className="tpl-card">
      <button
        className="tpl-pick"
        onClick={() => onPick(tp, k)}
        title={`Use PROCESS model ${tp.model}`}
      >
        <div className="tpl-num">Model {tp.model}</div>
        <TemplateDiagram g={g} pos={pos} />
        <div className="tpl-desc">{describe(tp)}</div>
      </button>
      {hi > lo && (
        <label className="tpl-k">
          Mediators
          <input
            type="number"
            min={lo}
            max={hi}
            value={k}
            onChange={(e) =>
              setK(Math.min(hi, Math.max(lo, Math.round(Number(e.target.value)) || lo)))
            }
          />
        </label>
      )}
    </div>
  );
}

/** Pick a PROCESS model: its diagram replaces the canvas, with empty slots for the variables. */
export function ProcessGallery({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('');
  useEscape(onClose);
  const pick = async (tp: Template, k: number) => {
    const s = useStore.getState();
    const drawn = s.model.constructs.some((c) => !c.covariate) || s.model.paths.length > 0;
    if (
      drawn &&
      !(await confirmDialog({
        title: `Replace the model by PROCESS model ${tp.model}?`,
        body: 'The current diagram is replaced by the template (covariates are kept). Variables already placed in slots with the same role names stay. Undo restores the current model.',
        confirmLabel: 'Use template',
      }))
    )
      return;
    if (!(await switchMethod('process'))) return;
    useStore.getState().applyTemplate(tp.model, k);
    s.toast(
      'info',
      'Drag a column from the data panel onto each slot (X, M, W, Y…). Drop several items to use a scale’s mean score.',
    );
    onClose();
  };
  const q = query.trim().toLowerCase();
  const shown = TEMPLATES.filter(
    (tp) => !q || String(tp.model) === q || describe(tp).toLowerCase().includes(q),
  );
  const families = [...new Set(shown.map(familyOf))];
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal tpl-gallery"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tpl-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="share-head">
          <h3 id="tpl-title">PROCESS model templates</h3>
          <input
            className="tpl-search"
            placeholder="Model number or words (e.g. 7, serial, Z)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          <button className="btn icon ghost" onClick={onClose} aria-label="Close">
            <IconX />
          </button>
        </div>
        <p className="hint">
          The numbered conditional process models of Hayes (2022),{' '}
          <i>Introduction to Mediation, Moderation, and Conditional Process Analysis</i> (3rd ed.),
          as numbered by PROCESS v4–5. Moderators’ main effects and lower-order terms are implied,
          as in Hayes’s conceptual diagrams. You can also draw any other model: it is analysed as a
          custom model.
        </p>
        {families.map((f) => (
          <section key={f}>
            <h4>{f}</h4>
            <div className="tpl-grid">
              {shown
                .filter((tp) => familyOf(tp) === f)
                .map((tp) => (
                  <Card key={tp.model} tp={tp} onPick={(t, k) => void pick(t, k)} />
                ))}
            </div>
          </section>
        ))}
        {!shown.length && <p className="hint">No model matches.</p>}
      </div>
    </div>
  );
}
