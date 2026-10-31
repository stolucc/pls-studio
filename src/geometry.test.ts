import { describe, expect, it } from 'vitest';
import {
  constructGeometry, correlationCurve, disturbanceTerm, distanceToSegment, ellipsePoint, ERR_R, errorTerm, hexagonPoint, hexagonVertices, interceptSegment, moderatorSegment, QUAD_RISE, quadraticLoop, pathSegment,
} from './geometry';

describe('construct shapes', () => {
  it('ellipse boundary points satisfy the ellipse equation', () => {
    const [x, y] = ellipsePoint(60, 36, 3, 2);
    expect((x / 60) ** 2 + (y / 36) ** 2).toBeCloseTo(1, 12);
  });
  it('hexagon boundary hits vertices and edges', () => {
    expect(hexagonPoint(60, 36, 1, 0)).toEqual([60, 0]);
    const [, y] = hexagonPoint(60, 36, 0, -1);
    expect(y).toBeCloseTo(-36, 12);
    const [vx, vy] = hexagonVertices(60, 36)[2];
    const [px, py] = hexagonPoint(60, 36, vx, vy);
    expect(px).toBeCloseTo(vx, 9);
    expect(py).toBeCloseTo(vy, 9);
  });
  it('indicator arrows end on the composite hexagon, not the ellipse', () => {
    const g = constructGeometry({ name: 'Quality', indicators: ['q1', 'q2', 'q3'], side: 'left', type: 'composite' });
    const top = g.indicators[0];
    const [hx, hy] = hexagonPoint(g.rx, g.ry, top.ax, top.ay);
    expect(top.ex).toBeCloseTo(hx, 9);
    expect(top.ey).toBeCloseTo(hy, 9);
  });
});

describe('path and moderator geometry', () => {
  const a = { name: 'A', indicators: [], side: 'left' as const, x: 0, y: 0, type: 'factor' as const };
  const b = { name: 'B', indicators: [], side: 'left' as const, x: 400, y: 0, type: 'composite' as const };
  it('clips paths to both shapes', () => {
    const seg = pathSegment(a, b)!;
    expect(seg.x1).toBeCloseTo(constructGeometry(a).rx, 9);
    expect(seg.x2).toBeCloseTo(400 - constructGeometry(b).rx, 9);
    expect(pathSegment(a, { ...a })).toBeNull();
  });
  it('measures distance to a segment, clamped at the ends', () => {
    const seg = { x1: 0, y1: 0, x2: 10, y2: 0 };
    expect(distanceToSegment(5, 3, seg)).toBe(3);
    expect(distanceToSegment(-4, 3, seg)).toBe(5);
  });
  it('aims moderator arrows at the path midpoint', () => {
    const m = { ...a, name: 'M', x: 200, y: -200 };
    const mod = moderatorSegment(m, pathSegment(a, b)!);
    const seg = pathSegment(a, b)!;
    expect(mod.x2).toBeCloseTo((seg.x1 + seg.x2) / 2, 9);
    expect(mod.y1).toBeCloseTo(-200 + constructGeometry(m).ry, 9);
  });

  it('draws a quadratic effect as X’s own arrow looping onto the middle of X → Y (Henseler 2021)', () => {
    const x = { name: 'X', indicators: ['x1', 'x2'], side: 'left' as const, x: 0, y: 0 };
    const y = { name: 'Y', indicators: ['y1'], side: 'right' as const, x: 400, y: 0 };
    const seg = pathSegment(x, y)!;
    const q = quadraticLoop(x, seg);
    // Lands on the path midpoint, coming straight down onto it (the loop rises above a horizontal path).
    expect([q.x2, q.y2]).toEqual([(seg.x1 + seg.x2) / 2, (seg.y1 + seg.y2) / 2]);
    expect(q.nx).toBeCloseTo(0, 9); expect(q.ny).toBeCloseTo(-1, 9);
    expect(q.d).toMatch(/^M [\d.-]+ [\d.-]+ C .* 200 0$/);
    // Leaves from X's boundary, on the upper side, leaning towards Y.
    const g = constructGeometry(x);
    expect(((q.x1 / g.rx) ** 2 + (q.y1 / g.ry) ** 2)).toBeCloseTo(1, 6);
    expect(q.y1).toBeLessThan(0); expect(q.x1).toBeGreaterThan(0);
    // The apex (estimate) is ¾ of the rise above the path.
    expect(q.ly).toBeCloseTo((q.y1 + seg.y1) / 2 - 0.75 * QUAD_RISE, 6);
    expect(q.lx).toBeGreaterThan(q.x1); expect(q.lx).toBeLessThan(q.x2);
  });

  it('puts the loop on the side away from X’s indicators', () => {
    const top = { name: 'X', indicators: ['x1'], side: 'top' as const, x: 0, y: 0 };
    const y = { name: 'Y', indicators: ['y1'], side: 'right' as const, x: 400, y: 0 };
    const q = quadraticLoop(top, pathSegment(top, y)!);
    expect(q.ny).toBeCloseTo(1, 9);
    expect(q.ly).toBeGreaterThan(0);
    // Vertical path: left of it, unless X's indicators are on the left.
    const up = { name: 'X', indicators: ['x1'], side: 'right' as const, x: 0, y: 0 };
    const below = { name: 'Y', indicators: ['y1'], side: 'right' as const, x: 0, y: 300 };
    expect(quadraticLoop(up, pathSegment(up, below)!).nx).toBeCloseTo(-1, 9);
    expect(quadraticLoop({ ...up, side: 'left' }, pathSegment({ ...up, side: 'left' }, below)!).nx).toBeCloseTo(1, 9);
  });
});

describe('IPMA label placement', () => {
  it('pushes overlapping labels apart and leaves distant ones alone', async () => {
    const { placeLabels } = await import('./components/results/IpmaTab');
    const out = placeLabels([{ name: 'Trust', x: 100, y: 50 }, { name: 'Service Quality', x: 104, y: 52 }, { name: 'Far', x: 400, y: 51 }]);
    const by = Object.fromEntries(out.map((p) => [p.name, p.ly]));
    expect(Math.abs(by['Trust'] - by['Service Quality'])).toBeGreaterThanOrEqual(13);
    expect(by['Far']).toBe(51);
  });
});

describe('error terms and correlation curves', () => {
  const c = { name: 'F', indicators: ['a1', 'a2', 'a3'], side: 'left' as const, x: 0, y: 0, type: 'factor' as const };
  it('puts error circles beyond the indicator boxes, away from the construct', () => {
    const g = constructGeometry(c);
    const t = errorTerm(c, g.indicators[0]);
    expect(t.cx).toBeLessThan(g.indicators[0].x - ERR_R);
    expect(t.ax).toBe(g.indicators[0].x);
    expect([t.nx, t.ny]).toEqual([-1, 0]);
    const top = errorTerm({ ...c, side: 'top' }, constructGeometry({ ...c, side: 'top' }).indicators[1]);
    expect(top.ny).toBe(-1);
  });
  it('places a disturbance on the construct boundary, upper right', () => {
    const z = disturbanceTerm(c);
    const g = constructGeometry(c);
    expect((z.ax / g.rx) ** 2 + (z.ay / g.ry) ** 2).toBeCloseTo(1, 9);
    expect(z.cx).toBeGreaterThan(0);
    expect(z.cy).toBeLessThan(-g.ry + 1);
  });
  it('bows the curve along the given normal and away from the centre otherwise', () => {
    const a = { kind: 'circle' as const, x: 0, y: 0, r: ERR_R }, b = { kind: 'circle' as const, x: 0, y: 100, r: ERR_R };
    const left = correlationCurve(a, b, { normal: [-1, 0] });
    expect(left.lx).toBeLessThan(-10);
    // Endpoints lie on the circles.
    expect(Math.hypot(left.x1, left.y1)).toBeCloseTo(ERR_R, 9);
    const away = correlationCurve(a, b, { away: { x: -500, y: 50 } });
    expect(away.lx).toBeGreaterThan(10);
  });
});

describe('double-headed correlation arrows', () => {
  it('has an arrowhead at each end, tip on the endpoint, pointing into the anchor', () => {
    const a = { kind: 'circle' as const, x: 0, y: 0, r: ERR_R }, b = { kind: 'circle' as const, x: 0, y: 100, r: ERR_R };
    const c = correlationCurve(a, b, { normal: [1, 0] });
    expect(c.heads).toHaveLength(2);
    const pts = (d: string) => d.match(/-?\d+(\.\d+)?(e-?\d+)?/g)!.map(Number);
    const [t1x, t1y, ...base1] = pts(c.heads[0]);
    expect([t1x, t1y]).toEqual([c.x1, c.y1]);
    // The base lies outside the circle (the head points inwards, onto the circle).
    expect(Math.hypot((base1[0] + base1[2]) / 2, (base1[1] + base1[3]) / 2)).toBeGreaterThan(ERR_R);
    const [t2x, t2y] = pts(c.heads[1]);
    expect([t2x, t2y]).toEqual([c.x2, c.y2]);
  });
});

describe('intercept arrows from the constant', () => {
  const t = { name: 'T', indicators: ['t1', 't2'], side: 'left' as const, x: 300, y: 0, type: 'factor' as const };
  it('run from the triangle to the boundary of the indicator box', () => {
    const k = { x: 0, y: 0 };
    const box = constructGeometry(t).indicators[0];
    const seg = interceptSegment(k, t, box)!;
    expect(Math.hypot(seg.x1, seg.y1)).toBeCloseTo(16, 9); // 0.8 × CONSTANT_R, towards the box
    const cx = t.x + box.x + box.w / 2, cy = t.y + box.y + box.h / 2;
    // The end lies on the box's edge: one coordinate at the edge, the other within the box.
    const onEdge = Math.abs(Math.abs(seg.x2 - cx) - box.w / 2) < 1e-9 || Math.abs(Math.abs(seg.y2 - cy) - box.h / 2) < 1e-9;
    expect(onEdge).toBe(true);
    expect(Math.abs(seg.x2 - cx)).toBeLessThanOrEqual(box.w / 2 + 1e-9);
    expect(Math.abs(seg.y2 - cy)).toBeLessThanOrEqual(box.h / 2 + 1e-9);
    // Collinear with the triangle and the box centre.
    expect((seg.x2 - k.x) * (cy - k.y) - (seg.y2 - k.y) * (cx - k.x)).toBeCloseTo(0, 6);
    expect(interceptSegment({ x: cx, y: cy }, t, box)).toBeNull();
  });
  it('is straight down when the box is right below, and straight across when level', () => {
    const box = { x: -20, y: 100, w: 40, h: 26 };
    const down = interceptSegment({ x: 0, y: 0 }, { ...t, x: 0, y: 0 }, box)!;
    expect(down.x2).toBeCloseTo(0, 9); expect(down.y2).toBeCloseTo(100, 9);
    const across = interceptSegment({ x: 0, y: 113 }, { ...t, x: 0, y: 0 }, { x: 100, y: 100, w: 40, h: 26 })!;
    expect(across.y2).toBeCloseTo(113, 9); expect(across.x2).toBeCloseTo(100, 9);
  });
});
