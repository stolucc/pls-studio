import { ViewportPortal } from '@xyflow/react';
import type { MouseEvent } from 'react';
import { moderatorSegment, pathOffset, pathSegment, quadraticLoop, type QuadraticLoop } from '../geometry';
import type { Moderation } from '../model/project';
import { useStore } from '../store';
import type { MenuTarget } from './canvasMenu';

export interface ModerationLabel { beta: number | null; p: number | null }

interface ModItem {
  /** A moderation, or a moderated moderation (its `moderator` acting on the moderation's arrow). */
  mo: Pick<Moderation, 'id' | 'moderator'>;
  seg: { x1: number; y1: number; x2: number; y2: number };
  on: boolean;
  /** A quadratic effect: X's own arrow looping onto its path, tagged X². */
  loop: (QuadraticLoop & { tag: string }) | null;
}

// Stable fallback: a selector returning a fresh [] would re-render forever.
const NONE: string[] = [];

/**
 * Moderating effects drawn as dashed arrows from the moderator onto the
 * midpoint of the moderated path. Rendered in flow coordinates.
 */
export function ModeratorLayer({ labelFor, onMenu, labelAt }: {
  labelFor: (moderationId: string) => ModerationLabel | null;
  /** Where a moderation's label goes (placed so that labels do not overlap); otherwise the arrow's midpoint. */
  labelAt?: (moderationId: string) => { x: number; y: number } | null;
  /** Right-click: open the canvas context menu. */
  onMenu: (e: MouseEvent, t: MenuTarget) => void;
}) {
  const model = useStore((s) => s.model);
  const selected = useStore((s) => s.selection.moderations ?? NONE);
  const setSelection = useStore((s) => s.setSelection);
  const byId = new Map(model.constructs.map((c) => [c.id, c]));

  const items = model.moderations.flatMap((mo): ModItem[] => {
    const path = model.paths.find((p) => p.id === mo.path);
    const m = byId.get(mo.moderator);
    if (!path || !m) return [];
    const s = byId.get(path.from), t = byId.get(path.to);
    if (!s || !t) return [];
    const seg = pathSegment(s, t, pathOffset(model.paths, path.from, path.to));
    if (!seg) return [];
    // The predictor moderating its own path: a quadratic effect (Henseler 2021), X's arrow onto X → Y.
    if (m.id === path.from) {
      const q = quadraticLoop(m, seg);
      return [{ mo, seg: q, on: selected.includes(mo.id), loop: { ...q, tag: `${m.name}²` } }];
    }
    return [{ mo, seg: moderatorSegment(m, seg), on: selected.includes(mo.id), loop: null }];
  });
  // Moderated moderation (path × W × Z): Z's arrow lands on the middle of W's arrow.
  for (const t of model.threeWay ?? []) {
    const target = items.find((i) => i.mo.id === t.moderation && !i.loop);
    const z = byId.get(t.moderator);
    if (target && z) items.push({ mo: { id: t.id, moderator: t.moderator }, seg: moderatorSegment(z, target.seg), on: selected.includes(t.id), loop: null });
  }
  if (items.length === 0) return null;

  const select = (e: MouseEvent, id: string) => {
    e.stopPropagation();
    setSelection({ nodes: [], edges: [], moderations: [id] });
  };

  return (
    <ViewportPortal>
      <svg className="mod-layer" width={1} height={1}>
        {items.map(({ mo, seg, on, loop }) => {
          const menu = (e: MouseEvent) => { select(e, mo.id); onMenu(e, { kind: 'moderation', id: mo.id }); };
          const marker = on ? 'url(#arrow-mod-sel)' : 'url(#arrow-mod)';
          return (
            <g key={mo.id} className={`mod${on ? ' on' : ''}${loop ? ' quad' : ''}`}>
              {loop
                ? <>
                  <path className="mod-hit" d={loop.d} onClick={(e) => select(e, mo.id)} onContextMenu={menu} />
                  <path className="mod-line" d={loop.d} markerEnd={marker} />
                  <text className="quad-tag" x={loop.lx + loop.nx * 18} y={loop.ly + loop.ny * 18 + 4} textAnchor="middle" onClick={(e) => select(e, mo.id)} onContextMenu={menu}>
                    {loop.tag}<title>Quadratic effect: {loop.tag} — the effect of this predictor changes with its own level</title>
                  </text>
                </>
                : <>
                  <line className="mod-hit" x1={seg.x1} y1={seg.y1} x2={seg.x2} y2={seg.y2} onClick={(e) => select(e, mo.id)} onContextMenu={menu} />
                  <line className="mod-line" x1={seg.x1} y1={seg.y1} x2={seg.x2} y2={seg.y2} markerEnd={marker} />
                </>}
              <circle className="mod-dot" cx={seg.x2} cy={seg.y2} r={3.5} />
            </g>
          );
        })}
      </svg>
      {items.map(({ mo, seg, loop }) => {
        const l = labelFor(mo.id);
        if (!l || l.beta === null) return null;
        const cls = l.p === null ? '' : l.p < 0.05 ? ' sig' : ' ns';
        return (
          <div key={mo.id} className={`elabel mod-label${cls}`} onClick={(e) => select(e, mo.id)}
            onContextMenu={(e) => { select(e, mo.id); onMenu(e, { kind: 'moderation', id: mo.id }); }}
            // On the arrow: a quadratic effect's estimate at the top of its loop.
            style={{ transform: `translate(-50%, -50%) translate(${loop ? loop.lx : (labelAt?.(mo.id)?.x ?? (seg.x1 + seg.x2) / 2)}px, ${loop ? loop.ly : (labelAt?.(mo.id)?.y ?? (seg.y1 + seg.y2) / 2)}px)` }}>
            {l.beta.toFixed(3)}
            {l.p !== null && <span className="p">{l.p < 0.001 ? 'p<.001' : `p=${l.p.toFixed(3).slice(1)}`}</span>}
          </div>
        );
      })}
    </ViewportPortal>
  );
}
