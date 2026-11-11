import { describe, expect, it } from 'vitest';
import { canvasLabelSize, placeFigureLabels, placeLabels, type Box, type LabelSeg } from './labels';
import type { FigureInput } from './render';

const box = (c: { x: number; y: number }, w: number, h: number): Box => ({
  x: c.x - w / 2,
  y: c.y - h / 2,
  w,
  h,
});
const overlaps = (a: Box, b: Box) =>
  Math.min(a.x + a.w, b.x + b.w) > Math.max(a.x, b.x) &&
  Math.min(a.y + a.h, b.y + b.h) > Math.max(a.y, b.y);

describe('estimate labels never overlap', () => {
  it('a fan of arrows from two factors to the same five waves (a latent curve): every label clear of the others and of the nodes', () => {
    // Intercept at (260, -120) and Slope at (780, -120) above five waves at y = 300, as the Bollen & Curran example draws them.
    const waves = [0, 260, 520, 780, 1040];
    const items: LabelSeg[] = [];
    for (const [name, x] of [
      ['I', 260],
      ['S', 780],
    ] as const)
      for (const wx of waves)
        items.push({ key: `${name}:${wx}`, x1: x, y1: -120, x2: wx, y2: 300, w: 60, h: 20 });
    const nodes: Box[] = [
      ...waves.map((x) => ({ x: x - 50, y: 270, w: 100, h: 60 })),
      { x: 210, y: -150, w: 100, h: 60 },
      { x: 730, y: -150, w: 100, h: 60 },
    ];
    const placed = placeLabels(items, nodes);
    expect(placed.size).toBe(10);
    const boxes = items.map((it) => box(placed.get(it.key)!, it.w, it.h));
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++)
        expect(overlaps(boxes[i], boxes[j]), `${items[i].key} vs ${items[j].key}`).toBe(false);
    for (const b of boxes) for (const n of nodes) expect(overlaps(b, n)).toBe(false);
    // Deterministic, and the first label keeps its preferred midpoint.
    expect(placeLabels(items, nodes).get('I:0')).toEqual(placed.get('I:0'));
    expect(placed.get('I:0')).toEqual({ x: 130, y: 90 });
  });
  it('a label alone sits at its preferred point; two labels on the same segment are separated', () => {
    const one = placeLabels([
      { key: 'a', x1: 0, y1: 0, x2: 100, y2: 0, w: 40, h: 20, prefer: 0.3 },
    ]);
    expect(one.get('a')).toEqual({ x: 30, y: 0 });
    const two = placeLabels([
      { key: 'a', x1: 0, y1: 0, x2: 200, y2: 0, w: 40, h: 20 },
      { key: 'b', x1: 0, y1: 0, x2: 200, y2: 0, w: 40, h: 20 },
    ]);
    expect(overlaps(box(two.get('a')!, 40, 20), box(two.get('b')!, 40, 20))).toBe(false);
  });
  it('when nothing is free, the least overlapping spot is taken rather than none', () => {
    const items = Array.from({ length: 12 }, (_, i) => ({
      key: `k${i}`,
      x1: 0,
      y1: 0,
      x2: 30,
      y2: 0,
      w: 200,
      h: 200,
    }));
    const placed = placeLabels(items);
    expect(placed.size).toBe(12);
    for (const it of items) expect(Number.isFinite(placed.get(it.key)!.x)).toBe(true);
  });
  it('places a figure’s labels by key, treating constructs, correlation arcs and loops as obstacles', () => {
    const c = (id: string, x: number, y: number) => ({
      c: {
        id,
        name: id,
        type: 'factor' as const,
        mode: 'A' as const,
        indicators: [],
        x,
        y,
        side: 'left' as const,
      },
      geom: { rx: 50, ry: 30, indicators: [], bounds: { x: -50, y: -30, w: 100, h: 60 } },
      r2: null,
      indicators: [],
    });
    const f: FigureInput = {
      constructs: [c('A', 0, 0), c('B', 400, 0)],
      paths: [
        {
          key: 'p1',
          x1: 50,
          y1: 0,
          x2: 350,
          y2: 0,
          label: { value: 0.5, p: 0.01 },
          moderated: false,
        },
        {
          key: 'p2',
          x1: 50,
          y1: 0,
          x2: 350,
          y2: 0,
          label: { value: -0.25, p: 0.3 },
          moderated: false,
        },
      ],
      moderations: [],
      higherOrder: [
        { key: 'ho', x1: 50, y1: 0, x2: 350, y2: 0, label: { value: 1, p: null, fixed: true } },
      ],
      errors: [],
      correlations: [
        {
          d: '',
          heads: [],
          lx: 200,
          ly: 0,
          nx: 0,
          ny: -1,
          points: [],
          label: { value: 0.1, p: null },
        },
      ],
    } as unknown as FigureInput;
    const placed = placeFigureLabels(f, canvasLabelSize);
    expect([...placed.keys()].sort()).toEqual(['ho', 'p1', 'p2']);
    const sizes = {
      p1: canvasLabelSize({ value: 0.5, p: 0.01 }),
      p2: canvasLabelSize({ value: -0.25, p: 0.3 }),
      ho: canvasLabelSize({ value: 1, p: null, fixed: true }),
    };
    const boxes = (['p1', 'p2', 'ho'] as const).map((k) =>
      box(placed.get(k)!, sizes[k].w, sizes[k].h),
    );
    for (let i = 0; i < 3; i++)
      for (let j = i + 1; j < 3; j++) expect(overlaps(boxes[i], boxes[j])).toBe(false);
    const arc = box(
      { x: 200, y: -canvasLabelSize({ value: 0.1, p: null }).h / 2 },
      canvasLabelSize({ value: 0.1, p: null }).w,
      canvasLabelSize({ value: 0.1, p: null }).h,
    );
    for (const b of boxes) expect(overlaps(b, arc)).toBe(false);
    expect(canvasLabelSize({ value: 1, p: null, fixed: true }).w).toBeLessThan(
      canvasLabelSize({ value: 0.123, p: 0.04 }).w,
    );
  });
});
