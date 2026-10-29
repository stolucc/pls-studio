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

  it('places composites left to right without overlap, inside the canvas', () => {
    const d = layoutCcaDiagram(input(4));
    const boxes = d.composites.map((k) => [k.cx + k.geom.bounds.x, k.cx + k.geom.bounds.x + k.geom.bounds.w]);
    for (let i = 1; i < boxes.length; i++) expect(boxes[i][0]).toBeGreaterThan(boxes[i - 1][1]);
    expect(boxes[0][0]).toBeGreaterThanOrEqual(0);
    expect(boxes.at(-1)![1]).toBeLessThanOrEqual(d.width);
    for (const k of d.composites) expect(k.cy + k.geom.bounds.y + k.geom.bounds.h).toBeLessThanOrEqual(d.height);
  });

  it('raises farther arcs higher (distinct label heights) and keeps them below the top', () => {
    const d = layoutCcaDiagram(input(4));
    const ly = (a: string, b: string) => d.arcs.find((x) => x.a === a && x.b === b)!.ly;
    expect(ly('C0', 'C3')).toBeLessThan(ly('C0', 'C2'));
    expect(ly('C0', 'C2')).toBeLessThan(ly('C0', 'C1'));
    expect(Math.min(...d.arcs.map((a) => a.ly))).toBeGreaterThan(8);
  });

  it('puts each indicator value on its arrow, in indicator order; one composite has no arcs', () => {
    const d = layoutCcaDiagram(input(1));
    expect(d.arcs).toHaveLength(0);
    expect(d.composites[0].geom.indicators.map((g) => g.name)).toEqual(['c0a', 'c0b', 'c0c']);
    expect(d.composites[0].values).toEqual([{ est: 0.5, significant: true }, { est: 0.2, significant: false }, { est: 0.2, significant: false }]);
  });
});
