import { describe, expect, it } from 'vitest';
import { pathOffset, pathSegment } from '../geometry';
import type { Construct, ModelState } from '../model/project';
import { buildFigureInput } from './build';

const C = (name: string, indicators: string[], x: number, extra: Partial<Construct> = {}): Construct => ({ id: name, name, type: 'factor', mode: 'A', indicators, x, y: 0, side: 'left', ...extra });
const model: ModelState = {
  constructs: [C('A', ['a1', 'a2', 'a3'], 0), C('B', ['b1', 'b2', 'b3'], 500, { scaling: 'variance', fixedLoadings: { b2: 0.7 } }), C('M', ['m1', 'm2'], 250, { y: 300 } as Partial<Construct>)],
  paths: [{ id: 'ab', from: 'A', to: 'B' }, { id: 'ba', from: 'B', to: 'A' }],
  moderations: [{ id: 'mo', path: 'ab', moderator: 'M' }],
};

describe('the figure of a model', () => {
  it('marks the held loadings of CB-SEM without estimates: the marker, unless variance-scaled, and fixed values', () => {
    const f = buildFigureInput(model, 'cbsem', {}, { showErrors: true });
    const [a, b] = f.constructs;
    expect(a.indicators).toEqual([{ value: 1, p: null, fixed: true }, null, null]);
    expect(b.indicators).toEqual([null, { value: 0.7, p: null, fixed: true }, null]);
    expect(buildFigureInput(model, 'pls', {}, { showErrors: false }).constructs[0].indicators).toEqual([null, null, null]);
  });
  it('shows estimates, keeping held ones marked fixed', () => {
    const f = buildFigureInput(model, 'cbsem', { indicator: (n) => (n === 'a1' ? 0.81 : 0.5), path: (from, to) => ({ beta: from === 'A' && to === 'B' ? 0.4 : null, p: 0.01 }) }, { showErrors: true });
    expect(f.constructs[0].indicators[0]).toEqual({ value: 0.81, p: null, fixed: true });
    expect(f.constructs[0].indicators[1]).toEqual({ value: 0.5, p: null, fixed: false });
    expect(f.paths.find((p) => p.key === 'ab')!.label).toEqual({ value: 0.4, p: 0.01, fixed: false });
    expect(f.paths.find((p) => p.key === 'ba')!.label).toBeNull();
  });
  it('draws a reciprocal pair on separate sides, the moderator onto its own arrow', () => {
    const f = buildFigureInput(model, 'pls', {}, { showErrors: false });
    const [A, B] = model.constructs;
    const ab = f.paths.find((p) => p.key === 'ab')!, ba = f.paths.find((p) => p.key === 'ba')!;
    expect(ab).toMatchObject(pathSegment(A, B, pathOffset(model.paths, 'A', 'B'))!);
    expect(ab.y1).not.toBeCloseTo(ba.y2, 3);
    expect(ab.moderated).toBe(true);
    expect(f.moderations).toHaveLength(1);
    expect(f.moderations[0].label).toBeNull();
  });
  it('gives reliabilities beside error terms only for standardised estimates', () => {
    const v = { error: () => 0.36 };
    expect(buildFigureInput(model, 'cbsem', v, { showErrors: true }).errors[0].r2).toBeCloseTo(0.64, 12);
    expect(buildFigureInput(model, 'cbsem', v, { showErrors: true, unstd: true }).errors[0].r2).toBeNull();
    expect(buildFigureInput(model, 'pls', v, { showErrors: false }).errors).toEqual([]);
  });
});
