// Layout of the confirmatory composite analysis diagram (Henseler 2021, ch. 4;
// Schuberth, Henseler & Dijkstra 2018): every construct a composite (hexagon)
// formed by its indicators, weights on the arrows, and the saturated structural
// model drawn as it is estimated: every pair of composites correlated
// (double-headed arcs), no directed paths.

import { constructGeometry, type ConstructGeom } from '../geometry';

export interface CcaDiagramInput {
  /** Composites in drawing order (left to right). */
  composites: { name: string; indicators: string[] }[];
  /** Value on each indicator arrow (weight or loading), by composite and indicator. */
  value: (composite: string, indicator: string) => { est: number; significant: boolean } | null;
  /** Correlation of two composites. */
  correlation: (a: string, b: string) => number | null;
}

export interface CcaDiagram {
  width: number;
  height: number;
  composites: { name: string; cx: number; cy: number; geom: ConstructGeom; values: ({ est: number; significant: boolean } | null)[] }[];
  /** Double-headed arcs above the composites; (lx, ly) is the apex, where the label goes. */
  arcs: { a: string; b: string; d: string; lx: number; ly: number; value: number | null }[];
}

const GAP = 36, MARGIN = 16, RISE = 34, STEP = 30;

/** Positions for the diagram; arcs between farther composites rise higher so labels do not collide. */
export function layoutCcaDiagram(input: CcaDiagramInput): CcaDiagram {
  const geoms = input.composites.map((c) => constructGeometry({ name: c.name, indicators: c.indicators, side: 'bottom', type: 'composite' }));
  const n = geoms.length;
  // A cubic Bézier with both control points RISE + STEP·(span − 1) above its ends peaks at ¾ of that.
  const peak = n > 1 ? 0.75 * (RISE + STEP * (n - 2)) : 0;
  const top = MARGIN + 14 + peak;
  let cursor = MARGIN;
  const placed = geoms.map((g, i) => {
    const cx = cursor - g.bounds.x;
    cursor += g.bounds.w + GAP;
    const name = input.composites[i].name;
    return { name, cx, cy: top + g.ry, geom: g, values: input.composites[i].indicators.map((ind) => input.value(name, ind)) };
  });
  const arcs: CcaDiagram['arcs'] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = placed[i], b = placed[j];
      const y0 = a.cy - a.geom.ry, h = RISE + STEP * (j - i - 1);
      // Start and end a little inside the hexagons' tops so neighbouring arcs fan out.
      const x1 = a.cx + Math.min(a.geom.rx * 0.6, 14 * (j - i)), x2 = b.cx - Math.min(b.geom.rx * 0.6, 14 * (j - i));
      arcs.push({ a: a.name, b: b.name, d: `M ${x1} ${y0} C ${x1} ${y0 - h} ${x2} ${y0 - h} ${x2} ${y0}`, lx: (x1 + x2) / 2, ly: y0 - 0.75 * h, value: input.correlation(a.name, b.name) });
    }
  }
  const bottom = Math.max(top, ...placed.map((p) => p.cy + p.geom.bounds.y + p.geom.bounds.h));
  return { width: Math.max(cursor - GAP + MARGIN, 200), height: bottom + MARGIN, composites: placed, arcs };
}
