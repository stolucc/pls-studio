import { describe, expect, it } from 'vitest';
import type { Construct } from '../../model/project';
import type { Results } from '../../store';
import { diagramEstimates } from './estimates';

const K = (name: string, type: Construct['type'], indicators: string[]): Construct => ({ id: name, name, type, mode: 'A', indicators, x: 0, y: 0, side: 'left' });
const constructs = [K('A', 'factor', ['a1', 'a2']), K('B', 'composite', ['b1', 'b2'])];
// Just what the lookups read of each result.
const pls = {
  constructs: ['A', 'B'], indicators: [{ name: 'a1', construct: 0 }, { name: 'a2', construct: 0 }, { name: 'b1', construct: 1 }, { name: 'b2', construct: 1 }],
  loadings: [0.81, 0.79, 0.5, 0.6], weights: [0.55, 0.52, 0.7, 0.4], rSquared: [0, 0.36], pathCoef: [[0, 0.6], [0, 0]], moderations: [],
};
const results = (r: Partial<Record<keyof Results, unknown>>) => ({ pls: null, cb: null, miiv: null, boot: null, fitTest: null, key: 'k', ...r }) as Results;

describe('the estimates drawn on the diagram', () => {
  it('are none without results, or while results are hidden', () => {
    expect(diagramEstimates(null, true, 'pls', 'ML', constructs, false)).toBeNull();
    expect(diagramEstimates(results({ pls }), false, 'pls', 'ML', constructs, false)).toBeNull();
    // Results of another method draw nothing.
    expect(diagramEstimates(results({ pls }), true, 'cbsem', 'ML', constructs, false)).toBeNull();
  });

  it('PLS: loadings of common factors, weights of composites, paths with their bootstrap p', () => {
    const boot = { stats: [{ key: 'path:A:B', p: 0.012 }] };
    const d = diagramEstimates(results({ pls, boot }), true, 'pls', 'ML', constructs, false)!;
    expect(d.indicator('a1')).toBe(0.81);
    expect(d.indicator('b1')).toBe(0.7);
    expect(d.indicator('zz')).toBeNull();
    expect(d.r2('B')).toBe(0.36);
    expect(d.path('A', 'B')).toEqual({ beta: 0.6, p: 0.012 });
    expect(d.path('A', 'nope')).toEqual({ beta: null, p: null });
    expect(d.reflectiveThresholds('factor')).toBe(true);
  });

  it('conditional process analysis: the coefficient of a predictor, or of a product term, in the outcome\'s equation', () => {
    const process = { equations: [{ outcome: 'Y', r2: 0.2, coefficients: [{ term: ['X'], est: 0.3, p: 0.04 }, { term: ['W', 'X'], est: -0.1, p: 0.5 }] }] };
    const d = diagramEstimates(results({ process }), true, 'process', 'ML', constructs, false)!;
    expect(d.path('X', 'Y')).toEqual({ beta: 0.3, p: 0.04 });
    expect(d.moderation('X', 'W', 'Y')).toEqual({ beta: -0.1, p: 0.5 });
    expect(d.r2('Y')).toBe(0.2);
    expect(d.indicator('a1')).toBeNull();
  });
});
