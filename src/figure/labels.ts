// Placement of the estimate labels on a diagram so that no two overlap: each
// label belongs to a straight arrow and starts at its preferred point on it;
// when that collides with a label already placed or with a construct, it
// slides along the arrow, then sideways, to the first free spot. The same
// pass serves the canvas and the figure export, so both show the same layout.

import type { FigureInput, FigureLabel } from './render';

/** A label on a straight arrow: the segment, the label's size, and the preferred position along it (0 at the tail). */
export interface LabelSeg {
  key: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  w: number;
  h: number;
  prefer?: number;
}
/** An axis-aligned box, top-left corner. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
export type Placed = { x: number; y: number };

const overlap = (a: Box, b: Box, pad: number) => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) + pad;
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) + pad;
  return w > 0 && h > 0 ? w * h : 0;
};
const centred = (cx: number, cy: number, w: number, h: number): Box => ({
  x: cx - w / 2,
  y: cy - h / 2,
  w,
  h,
});

/**
 * Positions (centres) for the labels. Candidates for each label, in order: its
 * preferred point on the arrow, then points further along it in both
 * directions, each also shifted sideways by one or two label heights. The
 * first candidate clear of every label placed before it and of every obstacle
 * wins; failing that, the first clear of the labels; failing that, the least
 * overlapping one. Deterministic: the order of `items` decides priority.
 */
export function placeLabels(
  items: LabelSeg[],
  obstacles: Box[] = [],
  pad = 2,
): Map<string, Placed> {
  const out = new Map<string, Placed>();
  const placed: Box[] = [];
  for (const it of items) {
    const dx = it.x2 - it.x1;
    const dy = it.y2 - it.y1;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const p = it.prefer ?? 0.5;
    const ts = [
      ...new Set(
        [p, p - 0.1, p + 0.1, p - 0.2, p + 0.2, p - 0.3, p + 0.3, p - 0.38, p + 0.38].map((t) =>
          Math.min(0.9, Math.max(0.1, Math.round(t * 100) / 100)),
        ),
      ),
    ];
    const offs = [0, 1, -1, 2, -2].map((k) => k * (it.h + pad));
    let best: { x: number; y: number; labels: number; obstacles: number } | null = null;
    let chosen: Placed | null = null;
    search: for (const off of offs)
      for (const t of ts) {
        const x = it.x1 + t * dx + nx * off;
        const y = it.y1 + t * dy + ny * off;
        const box = centred(x, y, it.w, it.h);
        const l = placed.reduce((s, b) => s + overlap(box, b, pad), 0);
        const o = obstacles.reduce((s, b) => s + overlap(box, b, pad), 0);
        if (l === 0 && o === 0) {
          chosen = { x, y };
          break search;
        }
        if (!best || l < best.labels || (l === best.labels && o < best.obstacles))
          best = { x, y, labels: l, obstacles: o };
      }
    const at = chosen ?? { x: best!.x, y: best!.y };
    out.set(it.key, at);
    placed.push(centred(at.x, at.y, it.w, it.h));
  }
  return out;
}

/** The label of a figure item, keyed; `size` measures a label as it will be drawn. */
export function placeFigureLabels(
  f: FigureInput,
  size: (l: FigureLabel) => { w: number; h: number },
): Map<string, Placed> {
  const items: LabelSeg[] = [];
  const seg = (
    key: string | undefined,
    s: { x1: number; y1: number; x2: number; y2: number },
    l: FigureLabel | null,
    prefer = 0.5,
  ) => {
    if (!key || !l) return;
    items.push({ key, ...s, ...size(l), prefer });
  };
  for (const p of f.paths) seg(p.key, p, p.label, p.moderated ? 0.3 : 0.5);
  for (const h of f.higherOrder) seg(h.key, h, h.label);
  for (const t of f.means ?? []) seg(t.key, t, t.label);
  for (const t of f.intercepts ?? []) seg(t.key, t, t.label);
  for (const m of f.moderations) if (!m.loop) seg(m.key, m, m.label);
  // Obstacles: the constructs with their indicators, and the labels whose place is fixed (arcs, quadratic loops).
  const obstacles: Box[] = f.constructs.map(({ c, geom }) => ({
    x: c.x + geom.bounds.x,
    y: c.y + geom.bounds.y,
    w: geom.bounds.w,
    h: geom.bounds.h,
  }));
  for (const k of f.correlations)
    if (k.label) {
      const { w, h } = size(k.label);
      obstacles.push(centred(k.lx + (k.nx * w) / 2, k.ly + (k.ny * h) / 2, w, h));
    }
  for (const m of f.moderations)
    if (m.loop && m.label) {
      const { w, h } = size(m.label);
      obstacles.push(centred(m.loop.lx, m.loop.ly, w, h));
    }
  return placeLabels(items, obstacles);
}

/** The size of a label on the canvas (mono 11px, padded pill): the estimate, and its p-value when there is one. */
export function canvasLabelSize(l: FigureLabel): { w: number; h: number } {
  const chars =
    (l.fixed && Math.abs(l.value - 1) < 1e-12 ? 1 : l.value.toFixed(3).length) +
    (l.p !== null ? 7 : 0);
  return { w: chars * 6.7 + 16, h: 20 };
}
