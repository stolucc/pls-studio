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
    expect(menuFor({ kind: 'path', id: 'p1' }, withQ, { method: 'pls', readOnly: false })?.items.map((i) => i.action)).toEqual(['reverse-path', 'delete-path']);
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
