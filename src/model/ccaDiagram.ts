// Layout of the confirmatory composite analysis diagram (Henseler 2021, ch. 4;
// Schuberth, Henseler & Dijkstra 2018): every construct a composite (hexagon)
// formed by its indicators, weights on the arrows, and the saturated structural
// model drawn as it is estimated: every pair of composites correlated
// (double-headed arcs), no directed paths. Vertical: composites stacked top to
// bottom, indicators on their left, the correlation arcs on the right.

import { constructGeometry, type ConstructGeom } from '../geometry';

export interface CcaDiagramInput {
  /** Composites in drawing order (top to bottom). */
  composites: { name: string; indicators: string[] }[];
  /** Value on each indicator arrow (weight or loading), by composite and indicator. */
  value: (composite: string, indicator: string) => { est: number; significant: boolean } | null;
  /** Correlation of two composites. */
  correlation: (a: string, b: string) => number | null;
}

export interface CcaDiagram {
  width: number;
  height: number;
  composites: {
    name: string;
    cx: number;
    cy: number;
    geom: ConstructGeom;
    values: ({ est: number; significant: boolean } | null)[];
  }[];
  /** Double-headed arcs right of the composites; (lx, ly) is the apex, where the label goes. */
  arcs: { a: string; b: string; d: string; lx: number; ly: number; value: number | null }[];
}

const GAP = 22,
  MARGIN = 16,
  RISE = 46,
  STEP = 42,
  LABEL = 22;

/** Positions for the diagram; arcs between farther composites bulge farther so labels do not collide. */
export function layoutCcaDiagram(input: CcaDiagramInput): CcaDiagram {
  const geoms = input.composites.map((c) =>
    constructGeometry(
      { name: c.name, indicators: c.indicators, side: 'left', type: 'composite' },
      false,
    ),
  );
  const n = geoms.length;
  // Hexagons share one vertical axis, as far right as the widest indicator column needs.
  const axis = MARGIN + Math.max(0, ...geoms.map((g) => -g.bounds.x));
  const right = axis + Math.max(0, ...geoms.map((g) => g.rx));
  let cursor = MARGIN;
  const placed = geoms.map((g, i) => {
    // The bounds leave room above for a mode label, which this diagram does not draw.
    const top = g.bounds.y + 16;
    const cy = cursor - top;
    cursor += g.bounds.y + g.bounds.h - top + GAP;
    const name = input.composites[i].name;
    return {
      name,
      cx: axis,
      cy,
      geom: g,
      values: input.composites[i].indicators.map((ind) => input.value(name, ind)),
    };
  });
  const arcs: CcaDiagram['arcs'] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = placed[i],
        b = placed[j],
        span = j - i;
      // A cubic Bézier with both control points h beyond its ends reaches ¾ h.
      const h = RISE + STEP * (span - 1);
      // Leave from the hexagons' right flanks, fanned out so neighbouring arcs do not share an end.
      const off = Math.min(a.geom.ry * 0.55, 9 * span);
      const y1 = a.cy + off,
        y2 = b.cy - off;
      // The flank runs from (rx, 0) to (rx − ¾ry, ±ry): see hexagonVertices.
      const x1 = a.cx + a.geom.rx - 0.75 * off,
        x2 = b.cx + b.geom.rx - 0.75 * off;
      const x0 = Math.max(x1, x2);
      arcs.push({
        a: a.name,
        b: b.name,
        d: `M ${x1} ${y1} C ${x0 + h} ${y1} ${x0 + h} ${y2} ${x2} ${y2}`,
        lx: x0 + 0.75 * h,
        ly: (y1 + y2) / 2,
        value: input.correlation(a.name, b.name),
      });
    }
  }
  const reach = arcs.length ? Math.max(...arcs.map((a) => a.lx)) + LABEL : right;
  return {
    width: Math.max(reach + MARGIN, 200),
    height: Math.max(cursor - GAP + MARGIN, 100),
    composites: placed,
    arcs,
  };
}
