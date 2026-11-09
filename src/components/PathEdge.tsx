import { BaseEdge, EdgeLabelRenderer, type Edge, type EdgeProps } from '@xyflow/react';
import { memo, useMemo } from 'react';
import { besideLine, pathOffset, pathSegment } from '../geometry';
import { useStore } from '../store';
import { formatEstimate, pathStrokeWidth, significanceText } from '../figure/style';
import { fixedText } from '../diagramLabels';

export type PathEdgeData = {
  beta: number | null; p: number | null; moderated?: boolean; /** CB-SEM: coefficient held at this value. */ fixed?: number; /** CB-SEM: parameter label. */ label?: string;
  /** A moderator's main effect implied by the moderation (estimated, not drawn): dashed, not editable. */ implied?: boolean;
  /** Where the label goes (placed so that labels do not overlap); otherwise the midpoint. */ labelAt?: { x: number; y: number };
};
export type PathFlowEdge = Edge<PathEdgeData, 'path'>;

function PathEdgeImpl({ id, source, target, data, selected }: EdgeProps<PathFlowEdge>) {
  const s = useStore((st) => st.model.constructs.find((c) => c.id === source));
  const t = useStore((st) => st.model.constructs.find((c) => c.id === target));
  // A reciprocal pair (non-recursive model): each arrow shifted to its own side.
  const offset = useStore((st) => pathOffset(st.model.paths, source, target));
  const geo = useMemo(() => {
    if (!s || !t) return null;
    const seg = pathSegment(s, t, offset);
    if (!seg) return null;
    // Moderator arrows land on the midpoint, so move this path's label aside.
    const f = data?.moderated ? 0.3 : 0.5;
    return { path: `M ${seg.x1} ${seg.y1} L ${seg.x2} ${seg.y2}`, seg, mx: data?.labelAt?.x ?? seg.x1 + f * (seg.x2 - seg.x1), my: data?.labelAt?.y ?? seg.y1 + f * (seg.y2 - seg.y1) };
  }, [s, t, offset, data?.moderated, data?.labelAt]);
  const figure = useStore((st) => st.settings.figure);
  if (!geo) return null;

  const fixed = data?.fixed;
  // A fixed coefficient is labelled with its value until there are results.
  const beta = data?.beta ?? fixed ?? null;
  const p = data?.p ?? null;
  const label = data?.label;
  const width = pathStrokeWidth(figure, beta) * 1.4;
  const cls = p === null ? '' : p < 0.05 ? ' sig' : ' ns';
  // Amos notation: the number beside the line, not on it.
  const off = figure.notation === 'amos' ? besideLine(geo.seg.x1, geo.seg.y1, geo.seg.x2, geo.seg.y2, 14, 8) : { dx: 0, dy: 0 };

  return (
    <>
      <BaseEdge
        id={id}
        path={geo.path}
        className={`pedge${data?.implied ? ' implied' : ''}`}
        style={{ strokeWidth: width }}
        markerEnd={selected ? 'url(#arrow-path-sel)' : 'url(#arrow-path)'}
        interactionWidth={18}
      />
      {beta === null && label && (
        <EdgeLabelRenderer>
          <div className="elabel plabel" style={{ transform: `translate(-50%, -50%) translate(${geo.mx}px, ${geo.my}px)` }} title="Parameter label">{label}</div>
        </EdgeLabelRenderer>
      )}
      {beta !== null && (
        <EdgeLabelRenderer>
          <div className={`elabel${cls}${fixed !== undefined ? ' fixed' : ''}${data?.implied ? ' implied' : ''}${figure.notation === 'amos' ? ' beside' : ''}`} style={{ transform: `translate(-50%, -50%) translate(${geo.mx + off.dx}px, ${geo.my + off.dy}px)` }}
            title={fixed !== undefined ? `Fixed at ${fixedText(fixed)}: not estimated` : data?.implied ? 'Main effect implied by the moderation (estimated with the model; draw the arrow to edit it)' : undefined}>
            {label && <span className="plabel-name">{label} </span>}
            {fixed !== undefined && data?.beta == null ? fixedText(fixed) : formatEstimate(figure, beta)}
            {p !== null && significanceText(figure, p) && <span className="p">{significanceText(figure, p)}</span>}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const PathEdge = memo(PathEdgeImpl);
