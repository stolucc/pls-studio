import { describe, expect, it } from 'vitest';
import { layoutCcaDiagram } from './ccaDiagram';

const input = (n: number) => ({
  composites: Array.from({ length: n }, (_, i) => ({ name: `C${i}`, indicators: [`c${i}a`, `c${i}b`, `c${i}c`] })),
  value: (_comp: string, ind: string) => ({ est: ind.endsWith('a') ? 0.5 : 0.2, significant: ind.endsWith('a') }),
  correlation: (a: string, b: string) => Number(`0.${a.slice(1)}${b.slice(1)}`),
});

describe('layoutCcaDiagram (Henseler-style composite model)', () => {
  it('correlates every pair of composites once, with its value', () => {
    const d = layoutCcaDiagram(input(4));
    expect(d.arcs).toHaveLength(6);
    expect(d.arcs.map((a) => `${a.a}-${a.b}`)).toEqual(['C0-C1', 'C0-C2', 'C0-C3', 'C1-C2', 'C1-C3', 'C2-C3']);
    expect(d.arcs.find((a) => a.a === 'C1' && a.b === 'C3')!.value).toBe(0.13);
  });

  it('stacks composites top to bottom on one axis without overlap, inside the canvas', () => {
    const d = layoutCcaDiagram(input(4));
    const boxes = d.composites.map((k) => [k.cy + k.geom.bounds.y, k.cy + k.geom.bounds.y + k.geom.bounds.h]);
    for (let i = 1; i < boxes.length; i++) expect(boxes[i][0]).toBeGreaterThan(boxes[i - 1][1] - 16);
    expect(new Set(d.composites.map((k) => k.cx)).size).toBe(1);
    for (const k of d.composites) {
      expect(k.cx + k.geom.bounds.x).toBeGreaterThanOrEqual(0);
      expect(k.cy - k.geom.ry).toBeGreaterThanOrEqual(0);
    }
    expect(boxes.at(-1)![1]).toBeLessThanOrEqual(d.height);
  });

  it('bulges farther arcs farther right (distinct label positions), all inside the canvas', () => {
    const d = layoutCcaDiagram(input(4));
    const lx = (a: string, b: string) => d.arcs.find((x) => x.a === a && x.b === b)!.lx;
    expect(lx('C0', 'C3')).toBeGreaterThan(lx('C0', 'C2'));
    expect(lx('C0', 'C2')).toBeGreaterThan(lx('C0', 'C1'));
    const right = d.composites[0].cx + d.composites[0].geom.rx;
    for (const a of d.arcs) { expect(a.lx).toBeGreaterThan(right); expect(a.lx + 20).toBeLessThanOrEqual(d.width); }
    const at = new Set(d.arcs.map((a) => `${Math.round(a.lx)},${Math.round(a.ly)}`));
    expect(at.size).toBe(d.arcs.length);
  });

  it('puts each indicator value on its arrow, in indicator order; one composite has no arcs', () => {
    const d = layoutCcaDiagram(input(1));
    expect(d.arcs).toHaveLength(0);
    expect(d.composites[0].geom.indicators.map((g) => g.name)).toEqual(['c0a', 'c0b', 'c0c']);
    expect(d.composites[0].values).toEqual([{ est: 0.5, significant: true }, { est: 0.2, significant: false }, { est: 0.2, significant: false }]);
  });
});
