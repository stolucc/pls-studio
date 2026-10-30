import { ViewportPortal } from '@xyflow/react';
import { pathSegment } from '../geometry';
import { useStore } from '../store';

/**
 * Arrows between a higher-order construct and its first-order components: from
 * a second-order common factor to its components, or from the components into a
 * second-order composite (PLS, a composite of composites).
 */
export interface HoLabel { value: number; fixed: boolean }

export function HigherOrderLayer({ loadingFor }: { loadingFor: (parent: string, child: string) => HoLabel | null }) {
  const constructs = useStore((s) => s.model.constructs);
  const byId = new Map(constructs.map((c) => [c.id, c]));
  const items = constructs.flatMap((parent) => (parent.components ?? []).flatMap((cid) => {
    const child = byId.get(cid);
    const seg = child && (parent.type === 'composite' ? pathSegment(child, parent) : pathSegment(parent, child));
    return seg ? [{ key: `${parent.id}-${cid}`, seg, label: loadingFor(parent.name, child.name) }] : [];
  }));
  if (items.length === 0) return null;
  return (
    <ViewportPortal>
      <svg className="mod-layer" width={1} height={1}>
        {items.map(({ key, seg }) => (
          <line key={key} className="ho-line" x1={seg.x1} y1={seg.y1} x2={seg.x2} y2={seg.y2} markerEnd="url(#arrow-path)" />
        ))}
      </svg>
      {items.map(({ key, seg, label }) => label === null ? null : (
        <div key={key} className={`elabel ho-label${label.fixed ? ' fixed' : ''}`} style={{ transform: `translate(-50%, -50%) translate(${(seg.x1 + seg.x2) / 2}px, ${(seg.y1 + seg.y2) / 2}px)` }}
          title={label.fixed ? 'Loading fixed to 1: this component sets the scale of the higher-order factor' : undefined}>
          {label.fixed && label.value === 1 ? '1 (fixed)' : label.value.toFixed(3)}
        </div>
      ))}
    </ViewportPortal>
  );
}
