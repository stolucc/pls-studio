// An arrow from the constant to a construct: its latent mean (or, for an
// observed variable, its intercept). Labelled with the estimate, a fixed value,
// or a parameter label, like a path.

import { BaseEdge, EdgeLabelRenderer, type Edge, type EdgeProps } from '@xyflow/react';
import { memo, useMemo } from 'react';
import { fixedText } from '../diagramLabels';
import { meanSegment } from '../geometry';
import { selectPlacedModel, useStore } from '../store';
import { EstimateText } from './EstimateLabel';

export type MeanEdgeData = { value: number | null; p: number | null; fixed?: number; label?: string; labelAt?: { x: number; y: number } };
export type MeanFlowEdge = Edge<MeanEdgeData, 'mean'>;

function MeanEdgeImpl({ id, target, data, selected }: EdgeProps<MeanFlowEdge>) {
  const k = useStore((st) => st.model.constant);
  const t = useStore((st) => selectPlacedModel(st).constructs.find((c) => c.id === target));
  const geo = useMemo(() => {
    if (!k || !t) return null;
    const seg = meanSegment(k, t);
    return seg ? { path: `M ${seg.x1} ${seg.y1} L ${seg.x2} ${seg.y2}`, mx: data?.labelAt?.x ?? (seg.x1 + seg.x2) / 2, my: data?.labelAt?.y ?? (seg.y1 + seg.y2) / 2 } : null;
  }, [k, t, data?.labelAt]);
  const figure = useStore((st) => st.settings.figure);
  if (!geo) return null;
  const fixed = data?.fixed;
  const value = data?.value ?? fixed ?? null;
  const p = data?.p ?? null;
  const cls = p === null ? '' : p < 0.05 ? ' sig' : ' ns';
  return (
    <>
      <BaseEdge id={id} path={geo.path} className="pedge mean" markerEnd={selected ? 'url(#arrow-path-sel)' : 'url(#arrow-path)'} interactionWidth={18} />
      {value === null && data?.label && (
        <EdgeLabelRenderer>
          <div className="elabel plabel" style={{ transform: `translate(-50%, -50%) translate(${geo.mx}px, ${geo.my}px)` }} title="Parameter label">{data.label}</div>
        </EdgeLabelRenderer>
      )}
      {value !== null && (
        <EdgeLabelRenderer>
          <div className={`elabel${cls}${fixed !== undefined ? ' fixed' : ''}`} style={{ transform: `translate(-50%, -50%) translate(${geo.mx}px, ${geo.my}px)` }}
            title={fixed !== undefined ? `Fixed at ${fixedText(fixed)}: not estimated` : `${t!.name}: ${t!.covariate || t!.indicators.length <= 1 && t!.type !== 'factor' ? 'intercept' : 'latent mean'}`}>
            {data?.label && <span className="plabel-name">{data.label} </span>}
            <EstimateText figure={figure} value={value} p={p} text={fixed !== undefined && data?.value == null ? fixedText(fixed) : undefined} />
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const MeanEdge = memo(MeanEdgeImpl);
