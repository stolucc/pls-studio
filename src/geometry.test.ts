import { describe, expect, it } from 'vitest';
import {
  constructGeometry, correlationCurve, disturbanceTerm, distanceToSegment, ellipsePoint, ERR_R, errorTerm, hexagonPoint, hexagonVertices, moderatorSegment, QUAD_OFFSET, quadraticSegment, pathSegment,
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

  it('puts a quadratic badge beside the path midpoint, above it or left of a vertical path', () => {
    const q = quadraticSegment({ x1: 0, y1: 0, x2: 200, y2: 0 });
    expect([q.x2, q.y2]).toEqual([100, 0]);
    expect(q.bx).toBeCloseTo(100, 9);
    expect(q.by).toBeCloseTo(-QUAD_OFFSET, 9);
    expect(q.y1).toBeCloseTo(-QUAD_OFFSET + 11, 9);
    // Either direction of the path gives the same side.
    expect(quadraticSegment({ x1: 200, y1: 0, x2: 0, y2: 0 }).by).toBeCloseTo(-QUAD_OFFSET, 9);
    const v = quadraticSegment({ x1: 0, y1: 0, x2: 0, y2: 100 });
    expect(v.bx).toBeCloseTo(-QUAD_OFFSET, 9);
    expect(quadraticSegment({ x1: 0, y1: 100, x2: 0, y2: 0 }).bx).toBeCloseTo(-QUAD_OFFSET, 9);
    // Diagonal: the badge is QUAD_OFFSET from the midpoint, perpendicular to the path.
    const d = quadraticSegment({ x1: 0, y1: 0, x2: 100, y2: 100 });
    expect(Math.hypot(d.bx - 50, d.by - 50)).toBeCloseTo(QUAD_OFFSET, 9);
    expect((d.bx - 50) * 100 + (d.by - 50) * 100).toBeCloseTo(0, 9);
    expect(d.by).toBeLessThan(50);
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
