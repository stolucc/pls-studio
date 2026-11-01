import { ViewportPortal } from '@xyflow/react';
import type { MouseEvent } from 'react';
import {
  constructGeometry, correlationCurve, disturbanceTerm, ERR_R, errorTerm,
  type Anchor, type ErrorTerm,
} from '../geometry';
import { endogenousIds, impliedCorrelations, type Construct, type Correlation, type CorrelationEnd as CorrelationPick, type ModelState } from '../model/project';
import { useStore } from '../store';
import type { MenuTarget } from './canvasMenu';

export interface CorrelationLabel { value: number | null; p: number | null }
/** What the user clicked while drawing a correlation. */
export type { CorrelationEnd as CorrelationPick } from '../model/project';

// Stable fallback: a selector returning a fresh [] would re-render forever.
const NONE: string[] = [];

interface IndicatorPlace { owner: Construct; term: ErrorTerm }

/**
 * Error-term circle of every indicator that has a measurement error: multi-indicator
 * factors, and single indicators with a known reliability (composite indicators have none).
 */
function indicatorPlaces(model: ModelState): Map<string, IndicatorPlace> {
  const out = new Map<string, IndicatorPlace>();
  for (const c of model.constructs) {
    if (c.covariate || c.type === 'composite' || (c.indicators.length < 2 && c.reliability === undefined && !c.freeError)) continue;
    for (const ind of constructGeometry(c).indicators) out.set(ind.name, { owner: c, term: errorTerm(c, ind) });
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
  const correlated = new Set(active ? drawn.filter((k) => k.kind === 'construct').flatMap((k) => [k.a, k.b]) : []);
  const disturbances = active
    ? model.constructs.filter((c) => endo.has(c.id) && (errors || correlated.has(c.id))).map((c) => ({ c, term: disturbanceTerm(c) }))
    : [];
  const centre = model.constructs.length
    ? { x: model.constructs.reduce((s, c) => s + c.x, 0) / model.constructs.length, y: model.constructs.reduce((s, c) => s + c.y, 0) / model.constructs.length }
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
    return errors ? { kind: 'circle', x: pl.term.cx, y: pl.term.cy, r: ERR_R } : { kind: 'point', x: pl.term.ax, y: pl.term.ay };
  };
  const curves = corrs.flatMap((k) => {
    const a = anchorOf(k, k.a), b = anchorOf(k, k.b);
    if (!a || !b) return [];
    const pa = k.kind === 'indicator' ? places.get(k.a) : undefined, pb = k.kind === 'indicator' ? places.get(k.b) : undefined;
    // Indicators of one construct: bow outwards, away from the construct.
    const normal = pa && pb && pa.owner.id === pb.owner.id ? [pa.term.nx, pa.term.ny] as [number, number] : undefined;
    return [{ k, curve: correlationCurve(a, b, { normal, away: centre }), auto: k.id.startsWith('auto:') }];
  });
  return { places: errors ? places : new Map<string, IndicatorPlace>(), disturbances, curves, errors };
}

const fmtP = (p: number) => (p < 0.001 ? 'p<.001' : `p=${p.toFixed(3).slice(1)}`);

/**
 * CB-SEM error terms (ε on indicators, ζ on endogenous constructs) and
 * double-headed arrows for free covariances. Rendered in flow coordinates.
 */
export function CovarianceLayer({ active, showErrors, picked, onPick, labelFor, errorFor, onMenu }: {
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
  const model = useStore((s) => s.model);
  const selected = useStore((s) => s.selection.correlations ?? NONE);
  const setSelection = useStore((s) => s.setSelection);
  const { places, disturbances, curves: raw, errors } = covarianceLayout(model, active, showErrors);
  if (raw.length === 0 && !errors && disturbances.length === 0) return null;
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
  const isPicked = (kind: Correlation['kind'], id: string) => picked?.kind === kind && picked.id === id;

  // With results, the circle shows the standardised error variance (1 − R²) instead of its symbol,
  // which keeps the space around it free for correlation arcs.
  const errContent = (t: ErrorTerm, symbol: string, v: number | null) => (v === null
    ? <text className="err-text" x={t.cx} y={t.cy + 4} textAnchor="middle">{symbol}</text>
    : <text className="err-value" x={t.cx} y={t.cy + 3} textAnchor="middle">{v.toFixed(2).replace(/^0\./, '.').replace(/^-0\./, '-.')}</text>);

  return (
    <ViewportPortal>
      <svg className={`cov-layer${onPick ? ' picking' : ''}`} width={1} height={1}>
        {errors && [...places.entries()].map(([name, { owner, term: t }]) => (
          <g key={`e:${name}`} className={`err${isPicked('indicator', name) ? ' picked' : ''}`} onClick={(e) => pick(e, { kind: 'indicator', id: name })}
            data-cor-kind="indicator" data-cor-id={name}
            onContextMenu={(e) => onMenu(e, { kind: 'indicator', construct: owner.id, name })}>
            <line className="err-line" x1={t.cx - t.nx * ERR_R} y1={t.cy - t.ny * ERR_R} x2={t.ax} y2={t.ay} markerEnd="url(#arrow-ind)" />
            <circle className="err-circle" cx={t.cx} cy={t.cy} r={ERR_R}><title>Measurement error ε of {name}{errorFor('indicator', name) !== null ? ` (standardised variance ${errorFor('indicator', name)!.toFixed(3)})` : ''}</title></circle>
            {errContent(t, 'ε', errorFor('indicator', name))}
          </g>
        ))}
        {disturbances.map(({ c, term: t }) => (
          <g key={`z:${c.id}`} className={`err${picked?.via === 'disturbance' && picked.id === c.id ? ' picked' : ''}`} onClick={(e) => pick(e, { kind: 'construct', id: c.id, via: 'disturbance' })}
            data-cor-kind="construct" data-cor-id={c.id} data-cor-via="disturbance"
            onContextMenu={(e) => onMenu(e, { kind: 'disturbance', id: c.id })}>
            <line className="err-line" x1={t.cx - t.nx * ERR_R} y1={t.cy - t.ny * ERR_R} x2={t.ax} y2={t.ay} markerEnd="url(#arrow-ind)" />
            <circle className="err-circle" cx={t.cx} cy={t.cy} r={ERR_R}><title>Disturbance ζ of {c.name}{errorFor('construct', c.name) !== null ? ` (standardised variance ${errorFor('construct', c.name)!.toFixed(3)})` : ''}</title></circle>
            {errContent(t, 'ζ', errorFor('construct', c.name))}
          </g>
        ))}
        {curves.map(({ k, curve, on, auto }) => (
          <g key={k.id} className={`cor${on ? ' on' : ''}${active ? '' : ' inactive'}${auto ? ' auto' : ''}`}>
            {auto
              // Implied, not a choice: covariates (fixed.x) and factors of one ESEM block (rotation).
              ? <path className="cor-hit" d={curve.d} onContextMenu={(e) => onMenu(e, { kind: 'implied', a: k.a, b: k.b })}>
                <title>Implied: observed covariates keep their sample covariance (fixed.x); factors of one ESEM block are correlated by the rotation.</title>
              </path>
              : <path className="cor-hit" d={curve.d} onClick={(e) => select(e, k.id)} onContextMenu={(e) => { select(e, k.id); onMenu(e, { kind: 'correlation', id: k.id }); }} />}
            <path className="cor-line" d={curve.d} />
            {curve.heads.map((h, i) => <path key={i} className="cor-head" d={h} />)}
          </g>
        ))}
      </svg>
      {curves.map(({ k, curve }) => {
        const l = active ? labelFor(k) : null;
        if (!l || l.value === null) return null;
        const cls = l.p === null ? '' : l.p < 0.05 ? ' sig' : ' ns';
        return (
          <div key={k.id} className={`elabel cor-label${cls}`} onClick={(e) => { if (!k.id.startsWith('auto:')) select(e, k.id); }}
            onContextMenu={(e) => { if (!k.id.startsWith('auto:')) { select(e, k.id); onMenu(e, { kind: 'correlation', id: k.id }); } else onMenu(e, { kind: 'implied', a: k.a, b: k.b }); }}
            // Hang the label off the outer side of the arc so it never covers the error circles.
            style={{ transform: `translate(${curve.lx}px, ${curve.ly}px) translate(${-50 + 50 * curve.nx}%, ${-50 + 50 * curve.ny}%)` }}>
            {l.value.toFixed(3)}
            {l.p !== null && <span className="p">{fmtP(l.p)}</span>}
          </div>
        );
      })}
    </ViewportPortal>
  );
}
