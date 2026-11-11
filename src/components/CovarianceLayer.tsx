import { ViewportPortal } from '@xyflow/react';
import type { MouseEvent } from 'react';
import {
  besideLine,
  clearPointOnCurve,
  selfLoop,
  constructGeometry,
  correlationCurve,
  disturbanceTerm,
  ERR_R,
  errorTerm,
  shapeOf,
  shapePoint,
  type Anchor,
  type ErrorTerm,
} from '../geometry';
import {
  endogenousIds,
  impliedCorrelations,
  indicatorsDrawnElsewhere,
  type Construct,
  type Correlation,
  type CorrelationEnd as CorrelationPick,
  type IndicatorPath,
  type ModelState,
} from '../model/project';
import { formatEstimate, semplotEdge } from '../figure/style';
import { noLeadingZero } from '../format';
import { heldLoading } from '../diagramLabels';
import { selectPlacedModel, useStore } from '../store';
import type { MenuTarget } from './canvasMenu';
import { EstimateText } from './EstimateLabel';

export interface CorrelationLabel {
  value: number | null;
  p: number | null;
}
/** What the user clicked while drawing a correlation. */
export type { CorrelationEnd as CorrelationPick } from '../model/project';

// Stable fallback: a selector returning a fresh [] would re-render forever.
const NONE: string[] = [];

interface IndicatorPlace {
  owner: Construct;
  term: ErrorTerm;
}

/**
 * Error-term circle of every indicator that has a measurement error: multi-indicator
 * factors, and single indicators with a known reliability (composite indicators have none).
 */
function indicatorPlaces(model: ModelState): Map<string, IndicatorPlace> {
  const out = new Map<string, IndicatorPlace>();
  for (const c of model.constructs) {
    if (
      c.covariate ||
      c.type === 'composite' ||
      (c.indicators.length < 2 && c.reliability === undefined && !c.freeError)
    )
      continue;
    for (const ind of constructGeometry(c).indicators)
      out.set(ind.name, { owner: c, term: errorTerm(c, ind) });
  }
  return out;
}

/**
 * Geometry of the error terms (ε, ζ) and correlation arcs, shared by the
 * on-screen layer and figure export.
 */
export function covarianceLayout(model: ModelState, active: boolean, showErrors: boolean) {
  // A covariance fixed at zero is not drawn: in path diagrams, no arrow means zero (RAM convention).
  const drawn = (model.correlations ?? []).filter((k) => !k.zero);
  // CB-SEM also estimates covariances nobody drew (exogenous constructs, covariates): show those too.
  const implied = active ? impliedCorrelations(model) : [];
  const corrs = [...drawn, ...implied];
  const errors = active && showErrors;
  const places = indicatorPlaces(model);
  const byId = new Map(model.constructs.map((c) => [c.id, c]));
  const endo = endogenousIds(model);
  // Disturbances that carry a correlation are drawn even with error terms hidden: the arrow links ζs, not constructs.
  const correlated = new Set(
    active ? drawn.filter((k) => k.kind === 'construct').flatMap((k) => [k.a, k.b]) : [],
  );
  const disturbances = active
    ? model.constructs
        .filter((c) => endo.has(c.id) && (errors || correlated.has(c.id)))
        .map((c) => ({ c, term: disturbanceTerm(c) }))
    : [];
  const centre = model.constructs.length
    ? {
        x: model.constructs.reduce((s, c) => s + c.x, 0) / model.constructs.length,
        y: model.constructs.reduce((s, c) => s + c.y, 0) / model.constructs.length,
      }
    : { x: 0, y: 0 };
  const anchorOf = (k: Correlation, end: string): Anchor | null => {
    if (k.kind === 'construct') {
      const c = byId.get(end);
      if (!c) return null;
      // Endogenous constructs correlate through their disturbances when those are drawn.
      const z = active && endo.has(c.id) ? disturbanceTerm(c) : null;
      return z ? { kind: 'circle', x: z.cx, y: z.cy, r: ERR_R } : { kind: 'construct', c };
    }
    const pl = places.get(end);
    if (!pl) return null;
    return errors
      ? { kind: 'circle', x: pl.term.cx, y: pl.term.cy, r: ERR_R }
      : { kind: 'point', x: pl.term.ax, y: pl.term.ay };
  };
  const curves = corrs.flatMap((k) => {
    const a = anchorOf(k, k.a);
    const b = anchorOf(k, k.b);
    if (!a || !b) return [];
    const pa = k.kind === 'indicator' ? places.get(k.a) : undefined;
    const pb = k.kind === 'indicator' ? places.get(k.b) : undefined;
    // Indicators of one construct: bow outwards, away from the construct.
    const normal =
      pa && pb && pa.owner.id === pb.owner.id
        ? ([pa.term.nx, pa.term.ny] as [number, number])
        : undefined;
    return [
      {
        k,
        curve: correlationCurve(a, b, { normal, away: centre }),
        auto: k.id.startsWith('auto:'),
      },
    ];
  });
  // Direct effects on indicators: a straight arrow from the construct's border to the indicator's box.
  const boxes = new Map<string, { x: number; y: number; w: number; h: number }>();
  for (const c of model.constructs)
    for (const g of constructGeometry(c).indicators)
      if (!boxes.has(g.name)) boxes.set(g.name, { x: c.x + g.x, y: c.y + g.y, w: g.w, h: g.h });
  const direct = (active ? (model.indicatorPaths ?? []) : []).flatMap((p) => {
    const c = byId.get(p.from);
    const b = boxes.get(p.to);
    if (!c || !b) return [];
    const bx = b.x + b.w / 2;
    const by = b.y + b.h / 2;
    const dx = bx - c.x;
    const dy = by - c.y;
    const len = Math.hypot(dx, dy) || 1;
    const g = constructGeometry(c);
    const [sx, sy] = shapePoint(shapeOf(c), g.rx, g.ry, dx / len, dy / len);
    // (the end on the box's border, along the line)
    const t = Math.min(
      Math.abs(dx) > 1e-9 ? b.w / 2 / Math.abs(dx) : Infinity,
      Math.abs(dy) > 1e-9 ? b.h / 2 / Math.abs(dy) : Infinity,
    );
    return [{ p, x1: c.x + sx, y1: c.y + sy, x2: bx - dx * t, y2: by - dy * t }];
  });
  // An indicator of several factors has one box: the other factors reach it by an arrow, like a direct effect.
  const arrowTo = (c: Construct, b: { x: number; y: number; w: number; h: number }) => {
    const bx = b.x + b.w / 2;
    const by = b.y + b.h / 2;
    const dx = bx - c.x;
    const dy = by - c.y;
    const len = Math.hypot(dx, dy) || 1;
    const g = constructGeometry(c);
    const [sx, sy] = shapePoint(shapeOf(c), g.rx, g.ry, dx / len, dy / len);
    const t = Math.min(
      Math.abs(dx) > 1e-9 ? b.w / 2 / Math.abs(dx) : Infinity,
      Math.abs(dy) > 1e-9 ? b.h / 2 / Math.abs(dy) : Infinity,
    );
    return { x1: c.x + sx, y1: c.y + sy, x2: bx - dx * t, y2: by - dy * t };
  };
  const sharedLoadings = model.constructs.flatMap((c) => {
    const hidden = indicatorsDrawnElsewhere(model).get(c.name);
    return hidden
      ? c.indicators
          .filter((i) => hidden.has(i) && boxes.has(i))
          .map((indicator) => ({
            construct: c.id,
            indicator,
            ...arrowTo(c, boxes.get(indicator)!),
          }))
      : [];
  });
  return {
    places: errors ? places : new Map<string, IndicatorPlace>(),
    disturbances,
    curves,
    errors,
    direct,
    sharedLoadings,
  };
}

/** " (fixed at 0.5)" or " (a1)" after a direct effect's tooltip; nothing for a free, unlabelled one. */
function directEffectSuffix(p: IndicatorPath): string {
  if (p.fixed !== undefined) return ` (fixed at ${p.fixed})`;
  if (p.label) return ` (${p.label})`;
  return '';
}

const indicatorBox = (owner: Construct, name: string) => {
  const b = constructGeometry(owner).indicators.find((x) => x.name === name);
  return b && { x: owner.x + b.x, y: owner.y + b.y, w: b.w };
};

/**
 * CB-SEM error terms (ε on indicators, ζ on endogenous constructs) and
 * double-headed arrows for free covariances. Rendered in flow coordinates.
 */
export function CovarianceLayer({
  active,
  showErrors,
  picked,
  onPick,
  labelFor,
  errorFor,
  unstd,
  onMenu,
  loadingFor,
}: {
  /** The loading of an indicator on this factor, by indicator and construct name. */
  loadingFor: (indicator: string, construct: string) => number | null;
  /** The estimates shown are unstandardised. */
  unstd: boolean;
  /** CB-SEM: correlations are estimated (drawn faded otherwise). */
  active: boolean;
  showErrors: boolean;
  picked: CorrelationPick | null;
  /** Set while the correlation tool is active: clicking an error circle picks its indicator. */
  onPick: ((p: CorrelationPick) => void) | null;
  labelFor: (k: Correlation) => CorrelationLabel | null;
  /** Standardised error / disturbance variance to print beside a circle. */
  errorFor: (kind: Correlation['kind'], name: string) => number | null;
  /** Right-click: open the canvas context menu. */
  onMenu: (e: MouseEvent, t: MenuTarget) => void;
}) {
  const model = useStore(selectPlacedModel);
  const figure = useStore((s) => s.settings.figure);
  const amos = figure.notation === 'amos';
  const corStyle = (k: Correlation) => {
    if (figure.notation !== 'semplot') return undefined;
    const e = semplotEdge(labelFor(k)?.value ?? null);
    return { stroke: e.color, strokeWidth: e.width };
  };
  const allBoxes =
    figure.notation !== 'standard'
      ? model.constructs.flatMap((c) =>
          constructGeometry(c).indicators.map((b) => ({
            x: c.x + b.x,
            y: c.y + b.y,
            w: b.w,
            h: b.h,
          })),
        )
      : [];
  const selected = useStore((s) => s.selection.correlations ?? NONE);
  const setSelection = useStore((s) => s.setSelection);
  const {
    places,
    disturbances,
    curves: raw,
    errors,
    direct,
    sharedLoadings,
  } = covarianceLayout(model, active, showErrors);
  if (raw.length === 0 && !errors && disturbances.length === 0 && direct.length === 0) return null;
  const curves = raw.map((r) => ({ ...r, on: selected.includes(r.k.id) }));

  const select = (e: MouseEvent, id: string) => {
    e.stopPropagation();
    setSelection({ nodes: [], edges: [], moderations: [], correlations: [id] });
  };
  const pick = (e: MouseEvent, p: CorrelationPick) => {
    if (!onPick) return;
    e.stopPropagation();
    onPick(p);
  };
  const isPicked = (kind: Correlation['kind'], id: string) =>
    picked?.kind === kind && picked.id === id;

  // With results, the circle shows the standardised error variance (1 − R²) instead of its symbol,
  // which keeps the space around it free for correlation arcs.
  // Amos notation keeps the term's name in the circle. Beside it: its fixed weight on the arrow until there are estimates,
  // then its variance (unstandardised) or the indicator's reliability above the box (standardised).
  const amosNote = (t: ErrorTerm, v: number | null, box?: { x: number; y: number; w: number }) => {
    if (v === null) {
      const x1 = t.cx - t.nx * ERR_R;
      const y1 = t.cy - t.ny * ERR_R;
      const off = besideLine(x1, y1, t.ax, t.ay, 3, 5);
      return (
        <text
          className="err-value"
          x={(x1 + t.ax) / 2 + off.dx}
          y={(y1 + t.ay) / 2 + off.dy + 3}
          textAnchor="middle"
        >
          1
        </text>
      );
    }
    if (unstd)
      return figure.showEstimates ? (
        <text className="err-value" x={t.cx} y={t.cy - ERR_R - 3} textAnchor="middle">
          {formatEstimate(figure, v)}
        </text>
      ) : null;
    return box && figure.showR2 && figure.showEstimates ? (
      <text
        className="err-value err-r2"
        x={box.x + box.w * 0.65}
        y={box.y - 1.5}
        textAnchor="middle"
      >
        {formatEstimate(figure, 1 - v)}
        <title>R² (squared multiple correlation)</title>
      </text>
    ) : null;
  };
  // semPlot: a double-headed loop on the shape instead of a circle (kept, unseen, as the target for drawing correlations).
  const loop = (t: ErrorTerm, v: number | null, title: string) => {
    const l = selfLoop(t);
    const edge = semplotEdge(v);
    return (
      <>
        <path
          className="err-loop"
          d={l.d}
          style={{ stroke: edge.color, strokeWidth: edge.width }}
          markerStart="url(#arrow-sp)"
          markerEnd="url(#arrow-sp)"
        />
        <circle className="err-hit" cx={t.cx} cy={t.cy} r={ERR_R}>
          <title>{title}</title>
        </circle>
        {v !== null && figure.showEstimates && (
          <text
            className="err-value"
            x={l.lx}
            y={l.ly + 3}
            textAnchor="middle"
            style={{ fill: edge.color }}
          >
            {formatEstimate(figure, v)}
          </text>
        )}
      </>
    );
  };
  const errContent = (
    t: ErrorTerm,
    symbol: string,
    v: number | null,
    box?: { x: number; y: number; w: number },
  ) => {
    // Amos: the error's name in the circle, its value beside it.
    if (amos)
      return (
        <>
          <text className="err-text" x={t.cx} y={t.cy + 4} textAnchor="middle">
            {symbol}
          </text>
          {amosNote(t, v, box)}
        </>
      );
    // Otherwise the value in the circle, or the name until there is one.
    if (v === null)
      return (
        <text className="err-text" x={t.cx} y={t.cy + 4} textAnchor="middle">
          {symbol}
        </text>
      );
    return (
      <text className="err-value" x={t.cx} y={t.cy + 3} textAnchor="middle">
        {figure.notation === 'pls' ? formatEstimate(figure, v) : noLeadingZero(v.toFixed(2))}
      </text>
    );
  };

  return (
    <ViewportPortal>
      <svg className={`cov-layer${onPick ? ' picking' : ''}`} width={1} height={1}>
        {errors &&
          [...places.entries()].map(([name, { owner, term: t }], i) => (
            <g
              key={`e:${name}`}
              className={`err${isPicked('indicator', name) ? ' picked' : ''}`}
              onClick={(e) => pick(e, { kind: 'indicator', id: name })}
              data-cor-kind="indicator"
              data-cor-id={name}
              onContextMenu={(e) => onMenu(e, { kind: 'indicator', construct: owner.id, name })}
            >
              {figure.notation === 'semplot' ? (
                loop(t, errorFor('indicator', name), `Measurement error of ${name}`)
              ) : (
                <>
                  <line
                    className="err-line"
                    x1={t.cx - t.nx * ERR_R}
                    y1={t.cy - t.ny * ERR_R}
                    x2={t.ax}
                    y2={t.ay}
                    markerEnd="url(#arrow-ind)"
                  />
                  <circle className="err-circle" cx={t.cx} cy={t.cy} r={ERR_R}>
                    <title>
                      Measurement error ε of {name}
                      {errorFor('indicator', name) !== null
                        ? ` (standardised variance ${errorFor('indicator', name)!.toFixed(3)})`
                        : ''}
                    </title>
                  </circle>
                  {errContent(
                    t,
                    amos ? `e${i + 1}` : 'ε',
                    errorFor('indicator', name),
                    indicatorBox(owner, name),
                  )}
                </>
              )}
            </g>
          ))}
        {disturbances.map(({ c, term: t }, i) => (
          <g
            key={`z:${c.id}`}
            className={`err${picked?.via === 'disturbance' && picked.id === c.id ? ' picked' : ''}`}
            onClick={(e) => pick(e, { kind: 'construct', id: c.id, via: 'disturbance' })}
            data-cor-kind="construct"
            data-cor-id={c.id}
            data-cor-via="disturbance"
            onContextMenu={(e) => onMenu(e, { kind: 'disturbance', id: c.id })}
          >
            {figure.notation === 'semplot' ? (
              loop(t, errorFor('construct', c.name), `Disturbance of ${c.name}`)
            ) : (
              <>
                <line
                  className="err-line"
                  x1={t.cx - t.nx * ERR_R}
                  y1={t.cy - t.ny * ERR_R}
                  x2={t.ax}
                  y2={t.ay}
                  markerEnd="url(#arrow-ind)"
                />
                <circle className="err-circle" cx={t.cx} cy={t.cy} r={ERR_R}>
                  <title>
                    Disturbance ζ of {c.name}
                    {errorFor('construct', c.name) !== null
                      ? ` (standardised variance ${errorFor('construct', c.name)!.toFixed(3)})`
                      : ''}
                  </title>
                </circle>
                {errContent(t, amos ? `d${i + 1}` : 'ζ', errorFor('construct', c.name))}
              </>
            )}
          </g>
        ))}
        {sharedLoadings.map((d) => (
          <line
            key={`sl:${d.construct}:${d.indicator}`}
            className="iline shared-loading"
            x1={d.x1}
            y1={d.y1}
            x2={d.x2}
            y2={d.y2}
            markerEnd={figure.notation === 'semplot' ? 'url(#arrow-sp)' : 'url(#arrow-ind)'}
            style={
              figure.notation === 'semplot'
                ? (() => {
                    const n = model.constructs.find((k) => k.id === d.construct)?.name ?? '';
                    const e = semplotEdge(loadingFor(d.indicator, n));
                    return { stroke: e.color, strokeWidth: e.width };
                  })()
                : undefined
            }
          />
        ))}
        {direct.map(({ p, x1, y1, x2, y2 }) => (
          <g key={`ip:${p.id}`} className="direct-effect">
            <line
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="var(--path)"
              strokeWidth={1.4}
              markerEnd="url(#arrow-path)"
            >
              <title>
                Direct effect on the indicator {p.to}
                {directEffectSuffix(p)}
              </title>
            </line>
          </g>
        ))}
        {curves.map(({ k, curve, on, auto }) => (
          <g
            key={k.id}
            className={`cor${on ? ' on' : ''}${active ? '' : ' inactive'}${auto ? ' auto' : ''}${active && k.optional ? ' optional' : ''}`}
          >
            {auto ? (
              // Implied, not a choice: covariates (fixed.x) and factors of one ESEM block (rotation).
              <path
                className="cor-hit"
                d={curve.d}
                onContextMenu={(e) => onMenu(e, { kind: 'implied', a: k.a, b: k.b })}
              >
                <title>
                  Implied: observed covariates keep their sample covariance (fixed.x); factors of
                  one ESEM block are correlated by the rotation.
                </title>
              </path>
            ) : (
              <path
                className="cor-hit"
                d={curve.d}
                onClick={(e) => select(e, k.id)}
                onContextMenu={(e) => {
                  select(e, k.id);
                  onMenu(e, { kind: 'correlation', id: k.id });
                }}
              />
            )}
            <path className="cor-line" d={curve.d} style={corStyle(k)} />
            {curve.heads.map((h, i) => (
              <path
                key={i}
                className="cor-head"
                d={h}
                style={
                  figure.notation === 'semplot'
                    ? { fill: semplotEdge(labelFor(k)?.value ?? null).color }
                    : undefined
                }
              />
            ))}
          </g>
        ))}
      </svg>
      {sharedLoadings.map((d) => {
        const c = model.constructs.find((k) => k.id === d.construct)!;
        // (the same held value as the figure: diagramLabels.ts heldLoading)
        const v =
          loadingFor(d.indicator, c.name) ??
          heldLoading(c, active ? 'cbsem' : 'pls', d.indicator) ??
          null;
        return v === null ? null : (
          <div
            key={`sll:${d.construct}:${d.indicator}`}
            className="elabel shared-label"
            title={`${c.name} → ${d.indicator}`}
            style={{
              transform: `translate(-50%, -50%) translate(${d.x1 + (d.x2 - d.x1) * 0.6}px, ${d.y1 + (d.y2 - d.y1) * 0.6}px)`,
              ...(figure.notation === 'semplot' ? { color: semplotEdge(v).color } : {}),
            }}
          >
            {formatEstimate(figure, v)}
          </div>
        );
      })}
      {curves.map(({ k, curve }) => {
        const l = active ? labelFor(k) : null;
        if (!l || l.value === null) return null;
        let cls = '';
        if (l.p !== null) cls = l.p < 0.05 ? ' sig' : ' ns';
        const at =
          figure.notation !== 'standard'
            ? clearPointOnCurve(
                [curve.x1, curve.y1],
                [curve.x2, curve.y2],
                [curve.lx, curve.ly],
                [curve.nx, curve.ny],
                30,
                18,
                allBoxes,
              )
            : { x: curve.lx, y: curve.ly };
        return (
          <div
            key={k.id}
            className={`elabel cor-label${cls}`}
            onClick={(e) => {
              if (!k.id.startsWith('auto:')) select(e, k.id);
            }}
            onContextMenu={(e) => {
              if (!k.id.startsWith('auto:')) {
                select(e, k.id);
                onMenu(e, { kind: 'correlation', id: k.id });
              } else onMenu(e, { kind: 'implied', a: k.a, b: k.b });
            }}
            // Hang the label off the outer side of the arc so it never covers the error circles.
            style={{
              transform: `translate(${at.x}px, ${at.y}px) translate(${-50 + 50 * curve.nx}%, ${-50 + 50 * curve.ny}%)`,
            }}
          >
            <EstimateText figure={figure} value={l.value} p={l.p} />
          </div>
        );
      })}
    </ViewportPortal>
  );
}
