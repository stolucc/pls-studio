// Gaussian copula terms on the canvas: one circle per predictor, a dotted arrow
// to each of its paths that carries a term.

import { ViewportPortal } from '@xyflow/react';
import type { MouseEvent } from 'react';
import type { BootstrapResult, PlsResult } from '../engine/types';
import { copulaName } from '../engine/types';
import { constructGeometry, distanceToSegment, pathOffset, pathSegment } from '../geometry';
import { COPULA_R } from './copulaGeometry';
import type { ModelState } from '../model/project';
import { useStore } from '../store';
import type { MenuTarget } from './canvasMenu';
import { EstimateText } from './EstimateLabel';

/** How far along its path the arrow lands; how long an arrow should at least be. */
const LAND_AT = 0.35, MIN_ARROW = 48;

export interface CopulaTarget { pathId: string; to: string; x1: number; y1: number; x2: number; y2: number }
export interface CopulaGroup { from: string; cx: number; cy: number; targets: CopulaTarget[] }

/**
 * Geometry shared by the canvas and the figure export: predictors by id. Each circle goes to the free spot nearest
 * to where its arrows land: clear of paths, constructs and indicators, and far enough for its arrows to be seen.
 */
export function copulaLayout(model: ModelState): CopulaGroup[] {
  const byId = new Map(model.constructs.map((c) => [c.id, c]));
  const n = model.constructs.length || 1;
  const centre = { x: model.constructs.reduce((s, c) => s + c.x, 0) / n, y: model.constructs.reduce((s, c) => s + c.y, 0) / n };
  const segments = model.paths.flatMap((p) => {
    const s = byId.get(p.from), t = byId.get(p.to);
    const seg = s && t ? pathSegment(s, t, pathOffset(model.paths, p.from, p.to)) : null;
    return seg ? [{ id: p.id, seg }] : [];
  });
  const boxes = model.constructs.map((c) => { const b = constructGeometry(c).bounds; return { x: c.x + b.x, y: c.y + b.y, w: b.w, h: b.h }; });
  const groups = new Map<string, Omit<CopulaTarget, 'x1' | 'y1'>[]>();
  for (const k of model.copulas ?? []) {
    const p = model.paths.find((q) => q.id === k.path);
    const seg = segments.find((x) => x.id === k.path)?.seg;
    if (!p || !seg) continue;
    groups.set(p.from, [...(groups.get(p.from) ?? []), { pathId: k.path, to: p.to, x2: seg.x1 + LAND_AT * (seg.x2 - seg.x1), y2: seg.y1 + LAND_AT * (seg.y2 - seg.y1) }]);
  }
  const placed: { x: number; y: number }[] = [];
  return [...groups.entries()].map(([from, landings]) => {
    const mx = landings.reduce((s, l) => s + l.x2, 0) / landings.length, my = landings.reduce((s, l) => s + l.y2, 0) / landings.length;
    const clear = COPULA_R + 10;
    const score = (x: number, y: number) => {
      const crowded = segments.filter(({ seg }) => distanceToSegment(x, y, seg) < clear).length
        + boxes.filter((b) => x > b.x - clear && x < b.x + b.w + clear && y > b.y - clear && y < b.y + b.h + clear).length
        + placed.filter((q) => Math.hypot(q.x - x, q.y - y) < 2 * clear).length
        + landings.filter((l) => Math.hypot(l.x2 - x, l.y2 - y) < COPULA_R + MIN_ARROW).length;
      const dist = landings.reduce((s, l) => s + Math.hypot(l.x2 - x, l.y2 - y), 0) / landings.length;
      // Fewest obstacles, then nearest; on a tie, away from the model's centre.
      return crowded * 1e6 + dist - 1e-3 * Math.hypot(x - centre.x, y - centre.y);
    };
    let best = { x: mx, y: my, s: Infinity };
    for (let r = 70; r <= 340; r += 30) for (let a = 0; a < 24; a++) {
      const x = mx + r * Math.cos(a * Math.PI / 12), y = my + r * Math.sin(a * Math.PI / 12), s = score(x, y);
      if (s < best.s) best = { x, y, s };
    }
    placed.push(best);
    return {
      from, cx: best.x, cy: best.y,
      targets: landings.map((l) => {
        const len = Math.hypot(l.x2 - best.x, l.y2 - best.y) || 1;
        return { ...l, x1: best.x + (l.x2 - best.x) / len * COPULA_R, y1: best.y + (l.y2 - best.y) / len * COPULA_R };
      }),
    };
  });
}

/** A term's estimate (by construct names), when the results have it. */
export function copulaEstimate(pls: PlsResult | null | undefined, boot: BootstrapResult | null | undefined, from: string, to: string) {
  const k = pls?.copulas?.find((x) => x.from === from && x.to === to);
  if (!pls || !k) return null;
  return { beta: pls.pathCoef[k.construct][pls.constructs.indexOf(to)], p: boot?.stats.find((s) => s.key === `path:${copulaName(from, to)}:${to}`)?.p ?? null };
}

export function CopulaLayer({ pls, boot, onMenu }: { pls: PlsResult | null | undefined; boot: BootstrapResult | null | undefined; onMenu: (e: MouseEvent, t: MenuTarget) => void }) {
  const model = useStore((s) => s.model);
  const figure = useStore((s) => s.settings.figure);
  const groups = copulaLayout(model);
  if (groups.length === 0) return null;
  const nameOf = (id: string) => model.constructs.find((c) => c.id === id)?.name ?? id;
  const menu = (e: MouseEvent, pathId: string) => { e.stopPropagation(); onMenu(e, { kind: 'path', id: pathId }); };
  return (
    <ViewportPortal>
      <svg className="gc-layer" width={1} height={1}>
        {groups.map((g) => (
          <g key={g.from}>
            {g.targets.map((t) => (
              <g key={t.pathId}>
                <line className="gc-hit" x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} onContextMenu={(e) => menu(e, t.pathId)} />
                <line className="gc-line" x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} markerEnd="url(#arrow-gc)" />
                <circle className="gc-dot" cx={t.x2} cy={t.y2} r={3.5} />
              </g>
            ))}
            <circle className="gc-circle" cx={g.cx} cy={g.cy} r={COPULA_R} onContextMenu={(e) => menu(e, g.targets[0].pathId)}>
              <title>Gaussian copula of {nameOf(g.from)}: tests and controls for its endogeneity in the equation of {g.targets.map((t) => nameOf(t.to)).join(', ')}. Right-click to remove.</title>
            </circle>
            <text className="gc-text" x={g.cx} y={g.cy + 4} textAnchor="middle">GC</text>
          </g>
        ))}
      </svg>
      {groups.flatMap((g) => g.targets.map((t) => {
        const l = copulaEstimate(pls, boot, nameOf(g.from), nameOf(t.to));
        if (!l) return null;
        return (
          <div key={t.pathId} className={`elabel gc-label${l.p === null ? '' : l.p < 0.05 ? ' sig' : ' ns'}`} onContextMenu={(e) => menu(e, t.pathId)}
            style={{ transform: `translate(-50%, -50%) translate(${(t.x1 + t.x2) / 2}px, ${(t.y1 + t.y2) / 2}px)` }}>
            <EstimateText figure={figure} value={l.beta} p={l.p} />
          </div>
        );
      }))}
    </ViewportPortal>
  );
}
