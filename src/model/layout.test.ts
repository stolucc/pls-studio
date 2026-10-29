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
  it('moves a mediator off a path that skips its layer (Bollen: ind60 → dem65 past dem60)', () => {
    const m: ModelState = {
      constructs: [C('ind60'), C('dem60'), C('dem65')],
      paths: [{ id: '1', from: 'ind60', to: 'dem60' }, { id: '2', from: 'ind60', to: 'dem65' }, { id: '3', from: 'dem60', to: 'dem65' }],
      moderations: [],
    };
    const out = Object.fromEntries(autoLayout(m).map((c) => [c.id, c]));
    const yLine = out.ind60.y + ((out.dem65.y - out.ind60.y) * (out.dem60.x - out.ind60.x)) / (out.dem65.x - out.ind60.x);
    expect(Math.abs(out.dem60.y - yLine)).toBeGreaterThanOrEqual(140);
    expect(out.dem60.side).toBe('top');
  });

  it('keeps the gap between constructs of a column when one is moved', () => {
    const m: ModelState = {
      constructs: [C('X'), C('M1'), C('M2'), C('Y')],
      paths: [{ id: '1', from: 'X', to: 'M1' }, { id: '2', from: 'X', to: 'M2' }, { id: '3', from: 'M1', to: 'Y' }, { id: '4', from: 'M2', to: 'Y' }, { id: '5', from: 'X', to: 'Y' }],
      moderations: [],
    };
    const out = Object.fromEntries(autoLayout(m).map((c) => [c.id, c]));
    expect(Math.abs(out.M1.y - out.M2.y)).toBeGreaterThanOrEqual(250);
    const yLine = out.X.y + ((out.Y.y - out.X.y) * (out.M1.x - out.X.x)) / (out.Y.x - out.X.x);
    for (const k of ['M1', 'M2']) expect(Math.abs(out[k].y - yLine)).toBeGreaterThanOrEqual(110);
  });
});
