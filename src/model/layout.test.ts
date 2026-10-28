import { describe, expect, it } from 'vitest';
import { autoLayout, suggestName } from './layout';
import type { ModelState } from './project';

describe('suggestName', () => {
  it('uses the common prefix of numbered items', () => {
    expect(suggestName(['IMAG1', 'IMAG2', 'IMAG3'], [], 1)).toBe('IMAG');
    expect(suggestName(['sat_1', 'sat_2'], [], 1)).toBe('sat');
  });
  it('falls back and avoids duplicates (case-insensitive)', () => {
    expect(suggestName(['a1', 'b2'], [], 3)).toBe('Construct 3');
    expect(suggestName(['IMAG1'], ['imag'], 1)).toBe('IMAG 2');
    expect(suggestName([], ['Construct 1'], 1)).toBe('Construct 1 2');
  });
});

describe('autoLayout', () => {
  const C = (id: string) => ({ id, name: id, type: 'factor' as const, mode: 'A' as const, indicators: [], x: 0, y: 0, side: 'left' as const });
  it('places constructs in layers by longest incoming path', () => {
    const m: ModelState = {
      constructs: [C('A'), C('B'), C('M'), C('Y')],
      paths: [{ id: '1', from: 'A', to: 'M' }, { id: '2', from: 'M', to: 'Y' }, { id: '3', from: 'A', to: 'Y' }, { id: '4', from: 'B', to: 'Y' }],
      moderations: [],
    };
    const out = Object.fromEntries(autoLayout(m).map((c) => [c.id, c]));
    expect(out.A.x).toBe(0);
    expect(out.B.x).toBe(0);
    expect(out.M.x).toBeGreaterThan(0);
    expect(out.Y.x).toBeGreaterThan(out.M.x);
    expect(out.A.side).toBe('left');
    expect(out.Y.side).toBe('right');
    expect(['top', 'bottom']).toContain(out.M.side);
    expect(out.A.y).not.toBe(out.B.y);
  });
});
