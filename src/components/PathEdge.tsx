import { BaseEdge, EdgeLabelRenderer, type Edge, type EdgeProps } from '@xyflow/react';
import { memo, useMemo } from 'react';
import { besideLine, pathCurve, pathOffset, pathSegment } from '../geometry';
import { selectPlacedModel, useStore } from '../store';
import { pathStrokeWidth, semplotEdge } from '../figure/style';
import { fixedText } from '../diagramLabels';
import { EstimateText } from './EstimateLabel';

export type PathEdgeData = {
  beta: number | null;
  p: number | null;
  moderated?: boolean;
  /** CB-SEM: coefficient held at this value. */ fixed?: number;
  /** CB-SEM: parameter label. */ label?: string;
  /** A moderator's main effect implied by the moderation (estimated, not drawn): dashed, not editable. */ implied?: boolean;
  /** How the user chose to draw it. */ line?: 'dashed' | 'dotted';
  curved?: boolean;
  /** CB-SEM specification search: an optional arrow (dash-dot, in the warning colour). */ optional?: boolean;
  /** Where the label goes (placed so that labels do not overlap); otherwise the midpoint. */ labelAt?: {
    x: number;
    y: number;
  };
};
export type PathFlowEdge = Edge<PathEdgeData, 'path'>;

function PathEdgeImpl({ id, source, target, data, selected }: EdgeProps<PathFlowEdge>) {
  const s = useStore((st) => selectPlacedModel(st).constructs.find((c) => c.id === source));
  const t = useStore((st) => selectPlacedModel(st).constructs.find((c) => c.id === target));
  // A reciprocal pair (non-recursive model): each arrow shifted to its own side.
  const offset = useStore((st) => pathOffset(st.model.paths, source, target));
  const geo = useMemo(() => {
    if (!s || !t) return null;
    const seg = pathSegment(s, t, offset);
    if (!seg) return null;
    // Moderator arrows land on the midpoint, so move this path's label aside.
    const f = data?.moderated ? 0.3 : 0.5;
    if (data?.curved) {
      const k = pathCurve(seg);
      return { path: k.d, seg, mx: k.mx, my: k.my };
    }
    return {
      path: `M ${seg.x1} ${seg.y1} L ${seg.x2} ${seg.y2}`,
      seg,
      mx: data?.labelAt?.x ?? seg.x1 + f * (seg.x2 - seg.x1),
      my: data?.labelAt?.y ?? seg.y1 + f * (seg.y2 - seg.y1),
    };
  }, [s, t, offset, data?.moderated, data?.labelAt, data?.curved]);
  const figure = useStore((st) => st.settings.figure);
  if (!geo) return null;

  const fixed = data?.fixed;
  // A fixed coefficient is labelled with its value until there are results.
  const beta = data?.beta ?? fixed ?? null;
  const p = data?.p ?? null;
  const label = data?.label;
  const edge = figure.notation === 'semplot' && !selected ? semplotEdge(beta) : null;
  const width = edge ? edge.width * 1.4 : pathStrokeWidth(figure, beta) * 1.4;
  let cls = '';
  if (p !== null) cls = p < 0.05 ? ' sig' : ' ns';
  let labelTitle: string | undefined;
  if (fixed !== undefined) labelTitle = `Fixed at ${fixedText(fixed)}: not estimated`;
  else if (data?.implied)
    labelTitle =
      'Main effect implied by the moderation (estimated with the model; draw the arrow to edit it)';
  // Amos notation: the number beside the line, not on it.
  const off =
    figure.notation === 'amos'
      ? besideLine(geo.seg.x1, geo.seg.y1, geo.seg.x2, geo.seg.y2, 14, 8)
      : { dx: 0, dy: 0 };

  return (
    <>
      <BaseEdge
        id={id}
        path={geo.path}
        className={`pedge${data?.implied ? ' implied' : ''}${data?.optional ? ' optional' : ''}`}
        style={{
          strokeWidth: width,
          ...(edge ? { stroke: edge.color } : {}),
          ...(data?.line && !data.optional
            ? { strokeDasharray: data.line === 'dotted' ? '1.5 4' : '7 4' }
            : {}),
        }}
        markerEnd={selected ? 'url(#arrow-path-sel)' : edge ? 'url(#arrow-sp)' : 'url(#arrow-path)'}
        interactionWidth={18}
      />
      {beta === null && label && (
        <EdgeLabelRenderer>
          <div
            className="elabel plabel"
            style={{ transform: `translate(-50%, -50%) translate(${geo.mx}px, ${geo.my}px)` }}
            title="Parameter label"
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
      {beta !== null && (
        <EdgeLabelRenderer>
          <div
            className={`elabel${cls}${fixed !== undefined ? ' fixed' : ''}${data?.implied ? ' implied' : ''}${figure.notation === 'amos' ? ' beside' : ''}`}
            style={{
              transform: `translate(-50%, -50%) translate(${geo.mx + off.dx}px, ${geo.my + off.dy}px)`,
              ...(edge ? { color: edge.color } : {}),
            }}
            title={labelTitle}
          >
            {label && <span className="plabel-name">{label} </span>}
            <EstimateText
              figure={figure}
              value={beta}
              p={p}
              text={fixed !== undefined && data?.beta == null ? fixedText(fixed) : undefined}
            />
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const PathEdge = memo(PathEdgeImpl);
