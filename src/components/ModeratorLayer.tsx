import { ViewportPortal } from '@xyflow/react';
import type { MouseEvent } from 'react';
import { moderatorSegment, pathSegment } from '../geometry';
import { useStore } from '../store';

export interface ModerationLabel { beta: number | null; p: number | null }

// Stable fallback: a selector returning a fresh [] would re-render forever.
const NONE: string[] = [];

/**
 * Moderating effects drawn as dashed arrows from the moderator onto the
 * midpoint of the moderated path. Rendered in flow coordinates.
 */
export function ModeratorLayer({ labelFor }: { labelFor: (moderationId: string) => ModerationLabel | null }) {
  const model = useStore((s) => s.model);
  const selected = useStore((s) => s.selection.moderations ?? NONE);
  const setSelection = useStore((s) => s.setSelection);
  const byId = new Map(model.constructs.map((c) => [c.id, c]));

  const items = model.moderations.flatMap((mo) => {
    const path = model.paths.find((p) => p.id === mo.path);
    const m = byId.get(mo.moderator);
    if (!path || !m) return [];
    const s = byId.get(path.from), t = byId.get(path.to);
    if (!s || !t) return [];
    const seg = pathSegment(s, t);
    if (!seg) return [];
    return [{ mo, seg: moderatorSegment(m, seg), on: selected.includes(mo.id) }];
  });
  if (items.length === 0) return null;

  const select = (e: MouseEvent, id: string) => {
    e.stopPropagation();
    setSelection({ nodes: [], edges: [], moderations: [id] });
  };

  return (
    <ViewportPortal>
      <svg className="mod-layer" width={1} height={1}>
        {items.map(({ mo, seg, on }) => (
          <g key={mo.id} className={`mod${on ? ' on' : ''}`}>
            <line className="mod-hit" x1={seg.x1} y1={seg.y1} x2={seg.x2} y2={seg.y2} onClick={(e) => select(e, mo.id)} />
            <line className="mod-line" x1={seg.x1} y1={seg.y1} x2={seg.x2} y2={seg.y2} markerEnd={on ? 'url(#arrow-mod-sel)' : 'url(#arrow-mod)'} />
            <circle className="mod-dot" cx={seg.x2} cy={seg.y2} r={3.5} />
          </g>
        ))}
      </svg>
      {items.map(({ mo, seg }) => {
        const l = labelFor(mo.id);
        if (!l || l.beta === null) return null;
        const cls = l.p === null ? '' : l.p < 0.05 ? ' sig' : ' ns';
        return (
          <div key={mo.id} className={`elabel mod-label${cls}`} onClick={(e) => select(e, mo.id)}
            style={{ transform: `translate(-50%, -50%) translate(${(seg.x1 + seg.x2) / 2}px, ${(seg.y1 + seg.y2) / 2}px)` }}>
            {l.beta.toFixed(3)}
            {l.p !== null && <span className="p">{l.p < 0.001 ? 'p<.001' : `p=${l.p.toFixed(3).slice(1)}`}</span>}
          </div>
        );
      })}
    </ViewportPortal>
  );
}
