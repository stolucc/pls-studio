import { describe, expect, it } from 'vitest';
import type { ModelState } from '../model/project';
import { menuFor, type MenuTarget } from './canvasMenu';

const C = (id: string, indicators: string[], type: 'factor' | 'composite' = 'factor') =>
  ({ id, name: id.toUpperCase(), type, mode: 'A' as const, indicators, x: 0, y: 0, side: 'left' as const });
const model: ModelState = {
  constructs: [C('a', ['a1', 'a2']), C('b', ['b1', 'b2'], 'composite'), C('m', ['m1'])],
  paths: [{ id: 'p1', from: 'a', to: 'b' }],
  moderations: [{ id: 'mo1', moderator: 'm', path: 'p1' }],
  correlations: [{ id: 'k1', kind: 'indicator', a: 'a1', b: 'a2' }],
};
const actions = (t: MenuTarget, method: 'pls' | 'cbsem' = 'cbsem', readOnly = false) =>
  menuFor(t, model, { method, readOnly })?.items.map((i) => i.action) ?? null;

describe('canvas context menus', () => {
  it('offers delete on every kind of element', () => {
    expect(actions({ kind: 'construct', id: 'a' })).toContain('delete-construct');
    expect(actions({ kind: 'indicator', construct: 'a', name: 'a1' })).toContain('remove-indicator');
    expect(actions({ kind: 'path', id: 'p1' })).toEqual(['fix-value', 'set-label', 'add-quadratic', 'reverse-path', 'delete-path']);
    expect(actions({ kind: 'moderation', id: 'mo1' })).toEqual(['delete-moderation']);
    expect(actions({ kind: 'correlation', id: 'k1' })).toEqual(['fix-value', 'set-label', 'delete-correlation']);
  });

  it('titles the menu with what was clicked', () => {
    expect(menuFor({ kind: 'path', id: 'p1' }, model, { method: 'pls', readOnly: false })?.title).toBe('A → B');
    expect(menuFor({ kind: 'correlation', id: 'k1' }, model, { method: 'cbsem', readOnly: false })?.title).toBe('a1 ↔ a2');
    expect(menuFor({ kind: 'indicator', construct: 'a', name: 'a1' }, model, { method: 'pls', readOnly: false })?.items.at(-1)?.label).toBe('Remove from A');
  });

  it('offers correlations only in CB-SEM, through the disturbance for endogenous constructs', () => {
    expect(actions({ kind: 'construct', id: 'a' }, 'pls')).not.toContain('correlate');
    expect(menuFor({ kind: 'construct', id: 'b' }, model, { method: 'cbsem', readOnly: false })?.items.find((i) => i.action === 'correlate')?.label).toMatch(/disturbance/);
    expect(menuFor({ kind: 'construct', id: 'a' }, model, { method: 'cbsem', readOnly: false })?.items.find((i) => i.action === 'correlate')?.label).toBe('Correlate with…');
    expect(actions({ kind: 'indicator', construct: 'a', name: 'a1' }, 'pls')).toEqual(['remove-indicator']);
  });

  it('toggles between factor and composite in PLS and CB-SEM (lavaan composites)', () => {
    for (const m of ['pls', 'cbsem'] as const) {
      expect(actions({ kind: 'construct', id: 'a' }, m)).toContain('make-composite');
      expect(actions({ kind: 'construct', id: 'b' }, m)).toContain('make-factor');
    }
  });

  it('offers a quadratic effect once per path, labelled with the predictor', () => {
    expect(menuFor({ kind: 'path', id: 'p1' }, model, { method: 'pls', readOnly: false })?.items[0].label).toBe('Add quadratic effect (A²)');
    const withQ: ModelState = { ...model, moderations: [...model.moderations, { id: 'q1', moderator: 'a', path: 'p1' }] };
    expect(menuFor({ kind: 'path', id: 'p1' }, withQ, { method: 'pls', readOnly: false })?.items.map((i) => i.action)).toEqual(['toggle-copula', 'reverse-path', 'delete-path']);
    const m = menuFor({ kind: 'moderation', id: 'q1' }, withQ, { method: 'pls', readOnly: false })!;
    expect(m.title).toBe('Quadratic effect A² → B');
    expect(m.items).toEqual([{ action: 'delete-moderation', label: 'Remove quadratic effect', danger: true }]);
  });

  it('gives viewers no editing actions', () => {
    expect(actions({ kind: 'construct', id: 'a' }, 'cbsem', true)).toEqual(['edit']);
    expect(actions({ kind: 'path', id: 'p1' }, 'cbsem', true)).toBeNull();
    expect(actions({ kind: 'correlation', id: 'k1' }, 'cbsem', true)).toBeNull();
    expect(actions({ kind: 'pane', x: 0, y: 0 }, 'cbsem', true)).toEqual(['figure']);
  });

  it('offers adding on an empty canvas and nothing for elements that no longer exist', () => {
    expect(menuFor({ kind: 'pane', x: 0, y: 0 }, { constructs: [], paths: [], moderations: [] }, { method: 'pls', readOnly: false })?.items.map((i) => i.action)).toEqual(['add-construct']);
    expect(actions({ kind: 'path', id: 'gone' })).toBeNull();
  });
});

describe('stacked models: freeing a coefficient across groups', () => {
  const stacked: ModelState = { ...model, multigroup: { column: '', invariance: 'configural', structural: ['regressions'], free: [] } };
  it('offers to free a path coefficient only when the coefficients are held equal across groups, in CB-SEM', () => {
    expect(actions({ kind: 'path', id: 'p1' })).not.toContain('toggle-free-path');
    const items = menuFor({ kind: 'path', id: 'p1' }, stacked, { method: 'cbsem', readOnly: false })!.items;
    expect(items[0]).toEqual({ action: 'toggle-free-path', label: 'Free coefficient across groups (differs between groups)' });
    expect(menuFor({ kind: 'path', id: 'p1' }, stacked, { method: 'pls', readOnly: false })!.items.map((i) => i.action)).not.toContain('toggle-free-path');
    expect(menuFor({ kind: 'path', id: 'p1' }, { ...stacked, multigroup: { ...stacked.multigroup!, structural: [] } }, { method: 'cbsem', readOnly: false })!.items.map((i) => i.action)).not.toContain('toggle-free-path');
    const freed = { ...stacked, multigroup: { ...stacked.multigroup!, free: [{ kind: 'regression' as const, from: 'a', to: 'b' }] } };
    expect(menuFor({ kind: 'path', id: 'p1' }, freed, { method: 'cbsem', readOnly: false })!.items[0].label).toBe('Hold coefficient equal across groups');
  });
});

describe('held and labelled variances, intercepts and thresholds', () => {
  const cb = (m: ModelState, t: MenuTarget) => menuFor(t, m, { method: 'cbsem', readOnly: false })?.items ?? [];
  const has = (m: ModelState, t: MenuTarget, action: string) => cb(m, t).some((i) => i.action === action);
  const base: ModelState = {
    constructs: [C('f', ['y1', 'y2', 'y3']), C('g', ['u1', 'u2', 'u3']), C('x', ['x'])],
    paths: [{ id: 'p', from: 'f', to: 'g' }], moderations: [],
  };

  it('offer a construct’s variance (its disturbance’s when explained), in CB-SEM only', () => {
    expect(cb(base, { kind: 'construct', id: 'f' }).find((i) => i.action === 'held-variance')?.label).toBe('Variance…');
    expect(cb(base, { kind: 'construct', id: 'g' }).find((i) => i.action === 'held-variance')?.label).toBe('Disturbance variance…');
    expect(has(base, { kind: 'disturbance', id: 'g' }, 'held-variance')).toBe(true);
    expect(menuFor({ kind: 'construct', id: 'f' }, base, { method: 'pls', readOnly: false })?.items.some((i) => i.action === 'held-variance')).toBe(false);
    expect(menuFor({ kind: 'construct', id: 'f' }, base, { method: 'cbsem', readOnly: true })?.items.some((i) => i.action === 'held-variance')).toBe(false);
    // (not for a factor scaled by its variance: that variance is already held at 1)
    expect(has({ ...base, constructs: base.constructs.map((c) => (c.id === 'f' ? { ...c, scaling: 'variance' as const } : c)) }, { kind: 'construct', id: 'f' }, 'held-variance')).toBe(false);
  });

  it('show the current state in the item', () => {
    const m: ModelState = { ...base, parameters: [{ id: 'v1', kind: 'variance', target: 'f', fixed: 1 }, { id: 'v2', kind: 'variance', target: 'y2', indicator: true, label: 've' }, { id: 'v3', kind: 'variance', target: 'g', byGroup: [1, null] }] };
    expect(cb(m, { kind: 'construct', id: 'f' }).find((i) => i.action === 'held-variance')?.label).toBe('Variance (held at 1)…');
    expect(cb(m, { kind: 'indicator', construct: 'f', name: 'y2' }).find((i) => i.action === 'held-variance')?.label).toBe('Error variance (label ve)…');
    expect(cb(m, { kind: 'construct', id: 'g' }).find((i) => i.action === 'held-variance')?.label).toBe('Disturbance variance (per group: 1, NA)…');
  });

  it('offer an indicator’s error variance, intercept (with a mean structure) or thresholds (ordinal)', () => {
    const y1 = { kind: 'indicator', construct: 'f', name: 'y1' } as const, u1 = { kind: 'indicator', construct: 'g', name: 'u1' } as const;
    expect(has(base, y1, 'held-variance')).toBe(true);
    expect(has(base, y1, 'held-intercept')).toBe(false);
    expect(has({ ...base, constant: { x: 0, y: 0 } }, y1, 'held-intercept')).toBe(true);
    const ord: ModelState = { ...base, ordered: ['u1', 'u2', 'u3'] };
    expect(has(ord, u1, 'held-threshold')).toBe(true);
    // (an ordinal indicator's residual variance is a parameter only under the theta parameterisation)
    expect(has(ord, u1, 'held-variance')).toBe(false);
    expect(has({ ...ord, parameterization: 'theta' }, u1, 'held-variance')).toBe(true);
    // (not for an observed variable standing for itself)
    expect(has(base, { kind: 'indicator', construct: 'x', name: 'x' }, 'held-variance')).toBe(false);
  });

  it('offer values per group on a covariance when there are groups', () => {
    const m: ModelState = { ...base, correlations: [{ id: 'k', kind: 'indicator', a: 'y1', b: 'y2' }] };
    expect(has(m, { kind: 'correlation', id: 'k' }, 'group-values')).toBe(false);
    const g: ModelState = { ...m, multigroup: { column: 'g', invariance: 'configural', free: [] } };
    expect(has(g, { kind: 'correlation', id: 'k' }, 'group-values')).toBe(true);
    const per: ModelState = { ...g, correlations: [{ id: 'k', kind: 'indicator', a: 'y1', b: 'y2', byGroup: [0.5, 'c'] }] };
    expect(cb(per, { kind: 'correlation', id: 'k' }).find((i) => i.action === 'group-values')?.label).toBe('Values per group (0.5, c)…');
    expect(has(per, { kind: 'correlation', id: 'k' }, 'set-label')).toBe(false);
  });
});

describe('making parcels from the menu', () => {
  const K = (id: string, n: number, more: object = {}) => ({ id, name: id, type: 'factor' as const, mode: 'A' as const, indicators: Array.from({ length: n }, (_, i) => `${id}${i + 1}`), x: 0, y: 0, side: 'left' as const, ...more });
  const has = (c: object, method: 'cbsem' | 'pls') => menuFor({ kind: 'construct', id: (c as { id: string }).id }, { constructs: [c as never], paths: [], moderations: [] }, { method, readOnly: false })!.items.some((i) => i.action === 'make-parcels');
  it('is offered for a CB-SEM common factor of four or more items only', () => {
    expect(has(K('A', 4), 'cbsem')).toBe(true);
    expect(has(K('A', 3), 'cbsem')).toBe(false);
    expect(has(K('A', 6), 'pls')).toBe(false);
    expect(has(K('A', 6, { type: 'composite' }), 'cbsem')).toBe(false);
  });
});
