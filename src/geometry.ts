// Layout geometry for a construct node: an ellipse plus its indicator boxes on
// one side. Coordinates are relative to the ellipse centre; `nodeBox` gives
// the bounding box so the React Flow node can be positioned around it.

import type { ConstructType } from './engine/types';
import type { Construct } from './model/project';

export interface Box { x: number; y: number; w: number; h: number }
export interface IndicatorGeom extends Box {
  name: string;
  /** Point on the box edge facing the construct. */
  ax: number; ay: number;
  /** Point on the ellipse boundary facing the box. */
  ex: number; ey: number;
}
export interface ConstructGeom {
  rx: number;
  ry: number;
  indicators: IndicatorGeom[];
  /** Bounding box relative to the ellipse centre. */
  bounds: Box;
}

const CHAR = 7.4;
const BOX_H = 26;
const GAP = 8;
const DIST = 64;

export const textWidth = (s: string, px = CHAR) => s.length * px;

/** Point on an axis-aligned ellipse boundary in direction (dx, dy). */
export function ellipsePoint(rx: number, ry: number, dx: number, dy: number): [number, number] {
  const t = 1 / Math.sqrt((dx / rx) ** 2 + (dy / ry) ** 2 || 1);
  return [dx * t, dy * t];
}

/** Horizontal hexagon used for composites (as in Henseler's ADANCO diagrams). */
export function hexagonVertices(rx: number, ry: number): [number, number][] {
  const s = rx - ry * 0.75;
  return [[-rx, 0], [-s, -ry], [s, -ry], [rx, 0], [s, ry], [-s, ry]];
}

/** Point on the hexagon boundary in direction (dx, dy). */
export function hexagonPoint(rx: number, ry: number, dx: number, dy: number): [number, number] {
  const v = hexagonVertices(rx, ry);
  let best = Infinity;
  for (let i = 0; i < v.length; i++) {
    const [ax, ay] = v[i], [bx, by] = v[(i + 1) % v.length];
    // Solve t·d = a + u·(b − a) for t ≥ 0, u ∈ [0, 1].
    const ex = bx - ax, ey = by - ay;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = (ax * ey - ay * ex) / den;
    const u = (ax * dy - ay * dx) / den;
    if (t >= 0 && u >= -1e-9 && u <= 1 + 1e-9) best = Math.min(best, t);
  }
  return Number.isFinite(best) ? [dx * best, dy * best] : ellipsePoint(rx, ry, dx, dy);
}

/** Ellipse: common factor; hexagon: composite; rectangle: observed covariate. */
export type ShapeKind = ConstructType | 'observed';

export const shapeOf = (c: { type?: ConstructType; covariate?: boolean }): ShapeKind => (c.covariate ? 'observed' : c.type ?? 'factor');

export function shapePoint(kind: ShapeKind, rx: number, ry: number, dx: number, dy: number): [number, number] {
  if (kind === 'composite') return hexagonPoint(rx, ry, dx, dy);
  if (kind === 'observed') {
    const t = Math.min(Math.abs(dx) > 1e-12 ? rx / Math.abs(dx) : Infinity, Math.abs(dy) > 1e-12 ? ry / Math.abs(dy) : Infinity);
    return Number.isFinite(t) ? [dx * t, dy * t] : [rx, 0];
  }
  return ellipsePoint(rx, ry, dx, dy);
}

export function constructGeometry(c: Pick<Construct, 'name' | 'indicators' | 'side'> & { type?: ConstructType; covariate?: boolean }): ConstructGeom {
  const type = shapeOf(c);
  const observed = type === 'observed';
  const rx = observed ? Math.max(40, textWidth(c.name, 7.5) / 2 + 16) : Math.max(58, textWidth(c.name, 8) / 2 + (type === 'composite' ? 34 : 24));
  const ry = observed ? 18 : 36;
  // An observed covariate is its own indicator: no indicator boxes.
  const shown = observed ? [] : c.indicators;
  const widths = shown.map((n) => Math.max(48, textWidth(n, 7) + 18));
  const k = shown.length;
  const vertical = c.side === 'left' || c.side === 'right';
  const indicators: IndicatorGeom[] = [];

  if (vertical) {
    const colW = Math.max(0, ...widths);
    const total = k * BOX_H + (k - 1) * GAP;
    shown.forEach((name, i) => {
      const cy = -total / 2 + BOX_H / 2 + i * (BOX_H + GAP);
      const w = widths[i];
      const left = c.side === 'left';
      const edge = left ? -rx - DIST : rx + DIST;
      const x = left ? edge - colW + (colW - w) : edge;
      const ax = left ? x + w : x;
      const [ex, ey] = shapePoint(type, rx, ry, ax, cy);
      indicators.push({ name, x, y: cy - BOX_H / 2, w, h: BOX_H, ax, ay: cy, ex, ey });
    });
  } else {
    const total = widths.reduce((s, w) => s + w, 0) + (k - 1) * GAP;
    let cursor = -total / 2;
    shown.forEach((name, i) => {
      const w = widths[i];
      const cx = cursor + w / 2;
      cursor += w + GAP;
      const top = c.side === 'top';
      const y = top ? -ry - DIST - BOX_H * 0.6 - BOX_H : ry + DIST + BOX_H * 0.6;
      const ay = top ? y + BOX_H : y;
      const [ex, ey] = shapePoint(type, rx, ry, cx, ay);
      indicators.push({ name, x: cx - w / 2, y, w, h: BOX_H, ax: cx, ay, ex, ey });
    });
  }

  const PAD = 6;
  let minX = -rx - PAD, maxX = rx + PAD, minY = -ry - 22, maxY = ry + PAD;
  for (const b of indicators) {
    minX = Math.min(minX, b.x - PAD); maxX = Math.max(maxX, b.x + b.w + PAD);
    minY = Math.min(minY, b.y - PAD); maxY = Math.max(maxY, b.y + b.h + PAD);
  }
  return { rx, ry, indicators, bounds: { x: minX, y: minY, w: maxX - minX, h: maxY - minY } };
}


type Placed = Pick<Construct, 'name' | 'indicators' | 'side' | 'x' | 'y'> & { type?: ConstructType; covariate?: boolean };

/** Endpoints of a structural path, clipped to both construct shapes. */
/** How far the two arrows of a reciprocal pair (A → B and B → A) sit from the centre line, each to its own right. */
export const RECIPROCAL_OFFSET = 14;

/**
 * The straight arrow from construct s to construct t, boundary to boundary.
 * `offset` shifts it sideways (to the arrow's right): the two arrows of a
 * reciprocal pair (a non-recursive model) each get it, so they do not overlap.
 */
export function pathSegment(s: Placed, t: Placed, offset = 0): { x1: number; y1: number; x2: number; y2: number } | null {
  const gs = constructGeometry(s), gt = constructGeometry(t);
  const dx = t.x - s.x, dy = t.y - s.y;
  if (dx === 0 && dy === 0) return null;
  const [sx, sy] = shapePoint(shapeOf(s), gs.rx, gs.ry, dx, dy);
  const [tx, ty] = shapePoint(shapeOf(t), gt.rx, gt.ry, -dx, -dy);
  const l = Math.hypot(dx, dy);
  const ox = (offset * -dy) / l, oy = (offset * dx) / l;
  return { x1: s.x + sx + ox, y1: s.y + sy + oy, x2: t.x + tx + ox, y2: t.y + ty + oy };
}

/** The sideways offset of the arrow from → to: RECIPROCAL_OFFSET when a path runs the other way too, else 0. */
export function pathOffset(paths: { from: string; to: string }[], from: string, to: string): number {
  return paths.some((p) => p.from === to && p.to === from) ? RECIPROCAL_OFFSET : 0;
}

/** Distance from point (px, py) to the segment. */
export function distanceToSegment(px: number, py: number, seg: { x1: number; y1: number; x2: number; y2: number }): number {
  const vx = seg.x2 - seg.x1, vy = seg.y2 - seg.y1;
  const len2 = vx * vx + vy * vy;
  const u = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - seg.x1) * vx + (py - seg.y1) * vy) / len2));
  return Math.hypot(px - (seg.x1 + u * vx), py - (seg.y1 + u * vy));
}

/** Moderator arrow: from the moderator's boundary to the midpoint of the moderated path. */
/** Half-size of the constant's triangle (ConstantNode). */
export const CONSTANT_R = 20;

/** The arrow from the constant (centre k) to construct t's boundary. */
export function meanSegment(k: { x: number; y: number }, t: Placed): { x1: number; y1: number; x2: number; y2: number } | null {
  const g = constructGeometry(t);
  const dx = t.x - k.x, dy = t.y - k.y;
  const l = Math.hypot(dx, dy);
  if (l === 0) return null;
  const [bx, by] = shapePoint(shapeOf(t), g.rx, g.ry, -dx, -dy);
  return { x1: k.x + (dx / l) * CONSTANT_R * 0.8, y1: k.y + (dy / l) * CONSTANT_R * 0.8, x2: t.x + bx, y2: t.y + by };
}

/** The implied arrow from the constant (centre k) to an indicator box of construct t (box boundary). */
export function interceptSegment(k: { x: number; y: number }, t: Placed, box: Pick<IndicatorGeom, 'x' | 'y' | 'w' | 'h'>): { x1: number; y1: number; x2: number; y2: number } | null {
  const cx = t.x + box.x + box.w / 2, cy = t.y + box.y + box.h / 2;
  const dx = cx - k.x, dy = cy - k.y;
  const l = Math.hypot(dx, dy);
  if (l === 0) return null;
  const s = Math.min(dx === 0 ? Infinity : box.w / 2 / Math.abs(dx), dy === 0 ? Infinity : box.h / 2 / Math.abs(dy));
  return { x1: k.x + (dx / l) * CONSTANT_R * 0.8, y1: k.y + (dy / l) * CONSTANT_R * 0.8, x2: cx - dx * s, y2: cy - dy * s };
}

export function moderatorSegment(m: Placed, path: { x1: number; y1: number; x2: number; y2: number }) {
  const mx = (path.x1 + path.x2) / 2, my = (path.y1 + path.y2) / 2;
  const g = constructGeometry(m);
  const [bx, by] = shapePoint(shapeOf(m), g.rx, g.ry, mx - m.x, my - m.y);
  return { x1: m.x + bx, y1: m.y + by, x2: mx, y2: my };
}

/** How far a quadratic effect's loop rises beside the path it modifies. */
export const QUAD_RISE = 56;

/** A quadratic effect drawn as Henseler (2021) does: X's own arrow onto its path X → Y. */
export interface QuadraticLoop {
  /** SVG path (cubic Bézier) from X's boundary to the path midpoint. */
  d: string;
  x1: number; y1: number; x2: number; y2: number;
  /** Apex of the loop (where the estimate goes) and the outward normal there. */
  lx: number; ly: number; nx: number; ny: number;
}

const SIDE_VEC: Record<string, [number, number]> = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] };

/**
 * A quadratic effect is X moderating its own effect (the slope of X depends on
 * X): an arrow leaves X, loops out beside the path and lands on the midpoint
 * of X → Y, as a moderator's arrow does. The loop goes above the path (left of
 * a vertical one), or to the other side when X's indicators are there.
 */
export function quadraticLoop(c: Placed, path: { x1: number; y1: number; x2: number; y2: number }): QuadraticLoop {
  const mx = (path.x1 + path.x2) / 2, my = (path.y1 + path.y2) / 2;
  const dx = path.x2 - path.x1, dy = path.y2 - path.y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  let nx = -uy, ny = ux;
  if (ny > 1e-9 || (Math.abs(ny) <= 1e-9 && nx > 0)) { nx = -nx; ny = -ny; }
  const [sx0, sy0] = SIDE_VEC[c.side ?? 'bottom'] ?? SIDE_VEC.bottom;
  if (nx * sx0 + ny * sy0 > 0.5) { nx = -nx; ny = -ny; }
  // Leave X just beside where the path leaves it (clear of the label above X), on that side.
  const ox = ux + 0.6 * nx, oy = uy + 0.6 * ny, lean = Math.hypot(ox, oy);
  const g = constructGeometry(c);
  const [bx, by] = shapePoint(shapeOf(c), g.rx, g.ry, ox / lean, oy / lean);
  const x1 = c.x + bx, y1 = c.y + by;
  const h = QUAD_RISE;
  const c1x = x1 + nx * h, c1y = y1 + ny * h, c2x = mx + nx * h, c2y = my + ny * h;
  const r = (v: number) => Number(v.toFixed(2));
  return {
    d: `M ${r(x1)} ${r(y1)} C ${r(c1x)} ${r(c1y)} ${r(c2x)} ${r(c2y)} ${r(mx)} ${r(my)}`,
    x1, y1, x2: mx, y2: my,
    lx: (x1 + 3 * c1x + 3 * c2x + mx) / 8, ly: (y1 + 3 * c1y + 3 * c2y + my) / 8, nx, ny,
  };
}

// ---------- CB-SEM error terms and correlations ----------

export const ERR_R = 12;
const ERR_GAP = 14;

export interface ErrorTerm {
  /** Circle centre (flow coordinates). */
  cx: number; cy: number;
  /** Where its arrow lands (indicator box edge or construct boundary). */
  ax: number; ay: number;
  /** Outward unit direction, away from the construct. */
  nx: number; ny: number;
}

/** Measurement-error circle of an indicator, beyond its box on the far side from the construct. */
export function errorTerm(c: Placed, ind: IndicatorGeom): ErrorTerm {
  const midX = c.x + ind.x + ind.w / 2, midY = c.y + ind.y + ind.h / 2;
  switch (c.side) {
    case 'left': return { cx: c.x + ind.x - ERR_GAP - ERR_R, cy: midY, ax: c.x + ind.x, ay: midY, nx: -1, ny: 0 };
    case 'right': return { cx: c.x + ind.x + ind.w + ERR_GAP + ERR_R, cy: midY, ax: c.x + ind.x + ind.w, ay: midY, nx: 1, ny: 0 };
    case 'top': return { cx: midX, cy: c.y + ind.y - ERR_GAP - ERR_R, ax: midX, ay: c.y + ind.y, nx: 0, ny: -1 };
    default: return { cx: midX, cy: c.y + ind.y + ind.h + ERR_GAP + ERR_R, ax: midX, ay: c.y + ind.y + ind.h, nx: 0, ny: 1 };
  }
}

/** Disturbance (ζ) circle of an endogenous construct: upper right, or lower right when its indicators sit on top. */
export function disturbanceTerm(c: Placed): ErrorTerm {
  const g = constructGeometry(c);
  const len = Math.hypot(0.6, 1);
  const nx = 0.6 / len, ny = (c.side === 'top' ? 1 : -1) / len;
  const [bx, by] = shapePoint(shapeOf(c), g.rx, g.ry, nx, ny);
  const d = ERR_GAP + ERR_R;
  return { cx: c.x + bx + nx * d, cy: c.y + by + ny * d, ax: c.x + bx, ay: c.y + by, nx, ny };
}

/** Filled triangle with its tip at (x, y), pointing along (dx, dy). */
export function arrowHead(x: number, y: number, dx: number, dy: number, len = 9, half = 4): string {
  const l = Math.hypot(dx, dy) || 1;
  const ux = dx / l, uy = dy / l;
  const bx = x - ux * len, by = y - uy * len;
  return `M ${x} ${y} L ${bx - uy * half} ${by + ux * half} L ${bx + uy * half} ${by - ux * half} Z`;
}

/** One end of a correlation: a construct shape, an error circle, or a fixed point (box edge). */
export type Anchor =
  | { kind: 'construct'; c: Placed }
  | { kind: 'circle'; x: number; y: number; r: number }
  | { kind: 'point'; x: number; y: number };

const centreOf = (a: Anchor) => (a.kind === 'construct' ? { x: a.c.x, y: a.c.y } : { x: a.x, y: a.y });

function clipAnchor(a: Anchor, dx: number, dy: number): [number, number] {
  if (a.kind === 'point') return [a.x, a.y];
  if (a.kind === 'circle') {
    const l = Math.hypot(dx, dy) || 1;
    return [a.x + (dx / l) * a.r, a.y + (dy / l) * a.r];
  }
  const g = constructGeometry(a.c);
  const [bx, by] = shapePoint(shapeOf(a.c), g.rx, g.ry, dx, dy);
  return [a.c.x + bx, a.c.y + by];
}

/**
 * Curved double-headed arrow between two anchors (quadratic Bézier), bowing
 * along `normal` when given, otherwise away from `away` (e.g. the model centre).
 */
export function correlationCurve(a: Anchor, b: Anchor, opts: { normal?: [number, number]; away?: { x: number; y: number } } = {}) {
  const p = centreOf(a), q = centreOf(b);
  const dx = q.x - p.x, dy = q.y - p.y;
  const dist = Math.hypot(dx, dy) || 1;
  const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
  let [nx, ny] = opts.normal ?? [-dy / dist, dx / dist];
  if (!opts.normal && opts.away && nx * (mx - opts.away.x) + ny * (my - opts.away.y) < 0) { nx = -nx; ny = -ny; }
  // Longer arrows bow further, so nested arrows (and their labels) fan out.
  const bow = Math.min(240, Math.max(64, 0.45 * dist));
  const kx = mx + nx * bow, ky = my + ny * bow;
  const [x1, y1] = clipAnchor(a, kx - p.x, ky - p.y);
  const [x2, y2] = clipAnchor(b, kx - q.x, ky - q.y);
  return {
    d: `M ${x1} ${y1} Q ${kx} ${ky} ${x2} ${y2}`,
    x1, y1, x2, y2,
    /** Arrowheads at both ends (the curve's tangent there points from the control point to the end). */
    heads: [arrowHead(x1, y1, x1 - kx, y1 - ky), arrowHead(x2, y2, x2 - kx, y2 - ky)],
    /** Bow direction: labels sit on this side of the midpoint. */
    nx, ny,
    /** Curve midpoint (t = ½), for the label. */
    lx: 0.25 * x1 + 0.5 * kx + 0.25 * x2,
    ly: 0.25 * y1 + 0.5 * ky + 0.25 * y2,
  };
}
