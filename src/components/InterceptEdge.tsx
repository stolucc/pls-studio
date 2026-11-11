// An intercept the constant implies: a dashed arrow from the triangle to an
// indicator box (estimated with the mean structure, not drawn by the user),
// labelled with the estimate once the model is calculated.

import { BaseEdge, EdgeLabelRenderer, type Edge, type EdgeProps } from '@xyflow/react';
import { memo, useMemo } from 'react';
import { constructGeometry, interceptSegment } from '../geometry';
import { selectPlacedModel, useStore } from '../store';
import { EstimateText } from './EstimateLabel';

export type InterceptEdgeData = {
  indicator: string;
  value: number | null;
  p: number | null;
  labelAt?: { x: number; y: number };
};
export type InterceptFlowEdge = Edge<InterceptEdgeData, 'intercept'>;

function InterceptEdgeImpl({ id, target, data }: EdgeProps<InterceptFlowEdge>) {
  const k = useStore((st) => st.model.constant);
  const t = useStore((st) => selectPlacedModel(st).constructs.find((c) => c.id === target));
  const geo = useMemo(() => {
    if (!k || !t || !data) return null;
    const box = constructGeometry(t).indicators.find((b) => b.name === data.indicator);
    const seg = box && interceptSegment(k, t, box);
    return seg
      ? {
          path: `M ${seg.x1} ${seg.y1} L ${seg.x2} ${seg.y2}`,
          mx: data.labelAt?.x ?? (seg.x1 + seg.x2) / 2,
          my: data.labelAt?.y ?? (seg.y1 + seg.y2) / 2,
        }
      : null;
  }, [k, t, data]);
  const figure = useStore((st) => st.settings.figure);
  if (!geo) return null;
  const value = data?.value ?? null;
  const p = data?.p ?? null;
  const cls = p === null ? '' : p < 0.05 ? ' sig' : ' ns';
  return (
    <>
      <BaseEdge
        id={id}
        path={geo.path}
        className="pedge mean implied intercept"
        markerEnd="url(#arrow-path)"
        interactionWidth={0}
      />
      {value !== null && (
        <EdgeLabelRenderer>
          <div
            className={`elabel implied${cls}`}
            style={{ transform: `translate(-50%, -50%) translate(${geo.mx}px, ${geo.my}px)` }}
            title={`Intercept of ${data!.indicator} (estimated with the mean structure)`}
          >
            <EstimateText figure={figure} value={value} p={p} />
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const InterceptEdge = memo(InterceptEdgeImpl);
