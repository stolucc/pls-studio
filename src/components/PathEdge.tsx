import { BaseEdge, EdgeLabelRenderer, type Edge, type EdgeProps } from '@xyflow/react';
import { memo, useMemo } from 'react';
import { pathSegment } from '../geometry';
import { useStore } from '../store';
import { pathStrokeWidth } from '../figure/style';

export type PathEdgeData = { beta: number | null; p: number | null; moderated?: boolean };
export type PathFlowEdge = Edge<PathEdgeData, 'path'>;

function PathEdgeImpl({ id, source, target, data, selected }: EdgeProps<PathFlowEdge>) {
  const s = useStore((st) => st.model.constructs.find((c) => c.id === source));
  const t = useStore((st) => st.model.constructs.find((c) => c.id === target));
  const geo = useMemo(() => {
    if (!s || !t) return null;
    const seg = pathSegment(s, t);
    if (!seg) return null;
    // Moderator arrows land on the midpoint, so move this path's label aside.
    const f = data?.moderated ? 0.3 : 0.5;
    return { path: `M ${seg.x1} ${seg.y1} L ${seg.x2} ${seg.y2}`, mx: seg.x1 + f * (seg.x2 - seg.x1), my: seg.y1 + f * (seg.y2 - seg.y1) };
  }, [s, t, data?.moderated]);
  const figure = useStore((st) => st.settings.figure);
  if (!geo) return null;

  const beta = data?.beta ?? null;
  const p = data?.p ?? null;
  const width = pathStrokeWidth(figure, beta) * 1.4;
  const cls = p === null ? '' : p < 0.05 ? ' sig' : ' ns';

  return (
    <>
      <BaseEdge
        id={id}
        path={geo.path}
        className="pedge"
        style={{ strokeWidth: width }}
        markerEnd={selected ? 'url(#arrow-path-sel)' : 'url(#arrow-path)'}
        interactionWidth={18}
      />
      {beta !== null && (
        <EdgeLabelRenderer>
          <div className={`elabel${cls}`} style={{ transform: `translate(-50%, -50%) translate(${geo.mx}px, ${geo.my}px)` }}>
            {beta.toFixed(3)}
            {p !== null && <span className="p">{p < 0.001 ? 'p<.001' : `p=${p.toFixed(3).slice(1)}`}</span>}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const PathEdge = memo(PathEdgeImpl);
