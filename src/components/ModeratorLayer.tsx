import { ViewportPortal } from '@xyflow/react';
import type { MouseEvent } from 'react';
import { moderatorSegment, pathSegment, quadraticSegment } from '../geometry';
import type { Moderation } from '../model/project';
import { useStore } from '../store';
import type { MenuTarget } from './canvasMenu';

export interface ModerationLabel { beta: number | null; p: number | null }

interface ModItem {
  /** A moderation, or a moderated moderation (its `moderator` acting on the moderation's arrow). */
  mo: Pick<Moderation, 'id' | 'moderator'>;
  seg: { x1: number; y1: number; x2: number; y2: number };
  on: boolean;
  badge: { x: number; y: number; text: string; w: number } | null;
}

/** Approximate width of a quadratic-term badge for its text. */
export const badgeWidth = (text: string) => Math.max(34, text.length * 6.6 + 18);

// Stable fallback: a selector returning a fresh [] would re-render forever.
const NONE: string[] = [];

/**
 * Moderating effects drawn as dashed arrows from the moderator onto the
 * midpoint of the moderated path. Rendered in flow coordinates.
 */
export function ModeratorLayer({ labelFor, onMenu }: {
  labelFor: (moderationId: string) => ModerationLabel | null;
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
    const seg = pathSegment(s, t);
    if (!seg) return [];
    // The predictor moderating its own path: a quadratic term, drawn as an "X²" badge.
    if (m.id === path.from) {
      const q = quadraticSegment(seg);
      const text = `${m.name}²`;
      return [{ mo, seg: q, on: selected.includes(mo.id), badge: { x: q.bx, y: q.by, text, w: badgeWidth(text) } }];
    }
    return [{ mo, seg: moderatorSegment(m, seg), on: selected.includes(mo.id), badge: null }];
  });
  // Moderated moderation (path × W × Z): Z's arrow lands on the middle of W's arrow.
  for (const t of model.threeWay ?? []) {
    const target = items.find((i) => i.mo.id === t.moderation && !i.badge);
    const z = byId.get(t.moderator);
    if (target && z) items.push({ mo: { id: t.id, moderator: t.moderator }, seg: moderatorSegment(z, target.seg), on: selected.includes(t.id), badge: null });
  }
  if (items.length === 0) return null;

  const select = (e: MouseEvent, id: string) => {
    e.stopPropagation();
    setSelection({ nodes: [], edges: [], moderations: [id] });
  };

  return (
    <ViewportPortal>
      <svg className="mod-layer" width={1} height={1}>
        {items.map(({ mo, seg, on, badge }) => (
          <g key={mo.id} className={`mod${on ? ' on' : ''}${badge ? ' quad' : ''}`}>
            <line className="mod-hit" x1={seg.x1} y1={seg.y1} x2={seg.x2} y2={seg.y2} onClick={(e) => select(e, mo.id)}
              onContextMenu={(e) => { select(e, mo.id); onMenu(e, { kind: 'moderation', id: mo.id }); }} />
            <line className="mod-line" x1={seg.x1} y1={seg.y1} x2={seg.x2} y2={seg.y2} markerEnd={on ? 'url(#arrow-mod-sel)' : 'url(#arrow-mod)'} />
            <circle className="mod-dot" cx={seg.x2} cy={seg.y2} r={3.5} />
            {badge && (
              <g className="quad-badge" onClick={(e) => select(e, mo.id)}
                onContextMenu={(e) => { select(e, mo.id); onMenu(e, { kind: 'moderation', id: mo.id }); }}>
                <rect x={badge.x - badge.w / 2} y={badge.y - 11} width={badge.w} height={22} rx={11} />
                <text x={badge.x} y={badge.y + 4} textAnchor="middle">{badge.text}</text>
                <title>Quadratic effect: {badge.text} predicts the outcome of this path</title>
              </g>
            )}
          </g>
        ))}
      </svg>
      {items.map(({ mo, seg, badge }) => {
        const l = labelFor(mo.id);
        if (!l || l.beta === null) return null;
        const cls = l.p === null ? '' : l.p < 0.05 ? ' sig' : ' ns';
        return (
          <div key={mo.id} className={`elabel mod-label${cls}`} onClick={(e) => select(e, mo.id)}
            onContextMenu={(e) => { select(e, mo.id); onMenu(e, { kind: 'moderation', id: mo.id }); }}
            // A quadratic term's estimate sits to the right of its badge.
            style={{ transform: badge
              ? `translate(0, -50%) translate(${badge.x + badge.w / 2 + 6}px, ${badge.y}px)`
              : `translate(-50%, -50%) translate(${(seg.x1 + seg.x2) / 2}px, ${(seg.y1 + seg.y2) / 2}px)` }}>
            {l.beta.toFixed(3)}
            {l.p !== null && <span className="p">{l.p < 0.001 ? 'p<.001' : `p=${l.p.toFixed(3).slice(1)}`}</span>}
          </div>
        );
      })}
    </ViewportPortal>
  );
}
