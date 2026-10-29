import { describe, expect, it } from 'vitest';
import { constructsFromSolution, crossLoadings, DEFAULT_EFA, factorName, kmoLabel, loadingOrder, parseEfaDesign, toggleVariables } from './efa';

describe('EFA design from a project file', () => {
  it('keeps valid values and replaces invalid ones', () => {
    expect(parseEfaDesign({ vars: ['a', 'b', 3], method: 'ml', nfactors: 4.4, rotation: 'promax', missing: 'listwise', parallel: 50, threshold: 0.4 }))
      .toEqual({ vars: ['a', 'b'], method: 'ml', nfactors: 4, rotation: 'promax', missing: 'listwise', parallel: 50, threshold: 0.4 });
    expect(parseEfaDesign({ method: 'system("x")', rotation: 'evil', nfactors: 1e9, parallel: -5, threshold: 7 }))
      .toEqual({ ...DEFAULT_EFA, nfactors: 100, parallel: 0 });
    expect(parseEfaDesign('nope')).toBeUndefined();
    expect(parseEfaDesign(null)).toBeUndefined();
  });
});

describe('constructs from a solution', () => {
  const r = { variables: ['a1', 'a2', 'b1', 'b2', 'x'], factors: ['MR1', 'MR2'], loadings: [[0.8, 0.1], [-0.7, 0.2], [0.1, 0.6], [0.2, 0.55], [0.2, 0.25]], oblique: true };
  it('assigns each variable to its strongest factor if the loading reaches the threshold', () => {
    expect(constructsFromSolution(r, 0.3)).toEqual({ constructs: [{ name: 'MR1', indicators: ['a1', 'a2'] }, { name: 'MR2', indicators: ['b1', 'b2'] }], correlated: true, left: ['x'] });
    expect(constructsFromSolution({ ...r, oblique: false }, 0.65).constructs).toEqual([{ name: 'MR1', indicators: ['a1', 'a2'] }]);
    expect(constructsFromSolution(r, 0.99)).toEqual({ constructs: [], correlated: true, left: ['a1', 'a2', 'b1', 'b2', 'x'] });
  });
  it('sorts the loadings table by primary factor and size', () => {
    expect(loadingOrder(r.loadings)).toEqual([0, 1, 2, 3, 4]);
    expect(loadingOrder([[0.2, 0.6], [0.9, 0.1], [0.5, 0.0], [0.1, -0.8]])).toEqual([1, 2, 3, 0]);
  });
  it('labels sampling adequacy as Kaiser (1974)', () => {
    expect([0.95, 0.85, 0.75, 0.65, 0.55, 0.45].map(kmoLabel)).toEqual(['marvelous', 'meritorious', 'middling', 'mediocre', 'miserable', 'unacceptable']);
  });
});

describe('names of factors built from a solution', () => {
  it('uses the items’ shared prefix, else the factor label, and keeps names unique', () => {
    expect(factorName(['A1', 'A2', 'A5'], 'MR1', [])).toBe('A');
    expect(factorName(['trust_1', 'trust_2'], 'MR1', [])).toBe('trust');
    expect(factorName(['x1', 'y2'], 'MR3', [])).toBe('MR3');
    expect(factorName(['A1', 'A2'], 'MR1', ['A'])).toBe('A 2');
    expect(factorName(['q1', 'q2'], 'PC1', ['MR1'])).toBe('q');
  });
});

describe('choosing variables', () => {
  const all = ['A1', 'A2', 'A3', 'A4', 'B1'];
  it('toggles one, or a range like shift-click', () => {
    expect(toggleVariables(all, [], 'A2', null, false)).toEqual(['A2']);
    expect(toggleVariables(all, ['A2'], 'A2', 'A2', false)).toEqual([]);
    expect(toggleVariables(all, ['A1'], 'A4', 'A1', true)).toEqual(['A1', 'A2', 'A3', 'A4']);
    // A range takes the clicked variable's new state: here, off.
    expect(toggleVariables(all, ['A1', 'A2', 'A3', 'B1'], 'A1', 'A3', true)).toEqual(['B1']);
    // Without an anchor, a shift-click is a single toggle.
    expect(toggleVariables(all, [], 'A3', null, true)).toEqual(['A3']);
  });
});

describe('cross-loadings', () => {
  it('finds each variable’s primary and secondary loading and flags problems', () => {
    const r = crossLoadings([[0.8, 0.1, 0.05], [0.45, -0.38, 0.1], [0.35, 0.3, 0.0], [0.1, 0.62, -0.5]], 0.3);
    expect(r[0]).toEqual({ variable: 0, primary: 0, primaryLoading: 0.8, secondary: 1, secondaryLoading: 0.1, gap: expect.closeTo(0.7, 10), flags: [] });
    expect(r[1]).toMatchObject({ primary: 0, secondary: 1, secondaryLoading: -0.38, flags: ['cross-loads', 'close'] });
    expect(r[2].flags).toEqual(['cross-loads', 'weak', 'close']);
    expect(r[3]).toMatchObject({ primary: 1, secondary: 2, flags: ['cross-loads', 'close'] });
    expect(crossLoadings([[0.7], [0.2]], 0.3)).toEqual([
      { variable: 0, primary: 0, primaryLoading: 0.7, secondary: null, secondaryLoading: null, gap: null, flags: [] },
      { variable: 1, primary: 0, primaryLoading: 0.2, secondary: null, secondaryLoading: null, gap: null, flags: ['weak'] },
    ]);
  });
});
