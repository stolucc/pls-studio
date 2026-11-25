// Bollen's causal indicators (Figure 3.10 in Henseler, 2021; Bollen & Bauldry, 2011): observed causes of a
// factor, drawn as boxes with a path into it; the factor keeps its disturbance ζ and reflective indicators.
import { describe, expect, it } from 'vitest';
import { menuFor } from '../components/canvasMenu';
import {
  addCausalIndicator,
  DEFAULT_SETTINGS,
  renameCovariate,
  type Construct,
  type ModelState,
} from './project';
import { validateModel } from './validate';

const K = (id: string, indicators: string[], extra: Partial<Construct> = {}): Construct => ({
  id,
  name: id,
  type: 'factor',
  mode: 'A',
  indicators,
  x: 500,
  y: 100,
  side: 'right',
  ...extra,
});
// η with three reflective indicators on its right (Figure 3.10).
const model: ModelState = {
  constructs: [K('Eta', ['y1', 'y2', 'y3'])],
  paths: [],
  moderations: [],
};
const cb = { ...DEFAULT_SETTINGS, method: 'cbsem' as const };

describe('adding causal indicators', () => {
  it('adds an observed box with a path into the factor, on the side away from its indicators', () => {
    let m = addCausalIndicator(model, 'Eta');
    m = addCausalIndicator(m, 'Eta');
    m = addCausalIndicator(m, 'Eta');
    const causes = m.constructs.filter((c) => c.covariate);
    expect(causes.map((c) => c.name)).toEqual(['eta_x1', 'eta_x2', 'eta_x3']);
    expect(causes.every((c) => c.indicators.length === 1 && c.indicators[0] === c.name)).toBe(true);
    expect(m.paths.map((p) => [p.from, p.to])).toEqual(causes.map((c) => [c.id, 'Eta']));
    // (indicators on the right: the causes on the left, stacked 0, +110, −110)
    expect(causes.map((c) => [c.x, c.y])).toEqual([
      [200, 100],
      [200, 210],
      [200, -10],
    ]);
  });

  it('is a fitting CB-SEM model: no errors (a MIMIC model)', () => {
    const m = addCausalIndicator(addCausalIndicator(model, 'Eta'), 'Eta');
    expect(
      validateModel(m, null, cb)
        .filter((i) => i.level === 'error' && i.constructId !== undefined)
        .map((i) => i.message),
    ).toEqual([]);
  });

  it('says what is missing when the factor has causal indicators only', () => {
    const bare = addCausalIndicator({ ...model, constructs: [K('Eta', [])] }, 'Eta');
    const errors = validateModel(bare, null, cb).filter((i) => i.level === 'error');
    expect(errors.map((e) => e.message).join(' ')).toMatch(
      /"Eta" has causal indicators only\. Bollen and Davis \(2009\)/,
    );
  });

  it('does not add one to a composite, a covariate or a higher-order construct', () => {
    for (const extra of [
      { type: 'composite' as const },
      { covariate: true },
      { components: ['x'] },
    ]) {
      const m = { ...model, constructs: [K('Eta', ['y1'], extra)] };
      expect(addCausalIndicator(m, 'Eta')).toBe(m);
    }
  });

  it('renames a cause: its data column and its name with it', () => {
    const m = addCausalIndicator(model, 'Eta');
    const id = m.constructs.find((c) => c.covariate)!.id;
    const r = renameCovariate(m, id, 'income');
    const c = r.constructs.find((k) => k.id === id)!;
    expect([c.name, c.indicators]).toEqual(['income', ['income']]);
    // A name of its own stays.
    const named = {
      ...m,
      constructs: m.constructs.map((k) => (k.id === id ? { ...k, name: 'Income' } : k)),
    };
    const r2 = renameCovariate(named, id, 'inc_log').constructs.find((k) => k.id === id)!;
    expect([r2.name, r2.indicators]).toEqual(['Income', ['inc_log']]);
  });
});

describe('the menus', () => {
  const acts = (m: ModelState, id: string, method: 'pls' | 'cbsem', readOnly = false) =>
    menuFor({ kind: 'construct', id }, m, { method, readOnly })?.items.map((i) => i.action) ?? [];

  it('offer Add causal indicator on a CB-SEM factor only', () => {
    expect(acts(model, 'Eta', 'cbsem')).toContain('add-causal-indicator');
    expect(acts(model, 'Eta', 'pls')).not.toContain('add-causal-indicator');
    expect(acts(model, 'Eta', 'cbsem', true)).not.toContain('add-causal-indicator');
  });

  it('let a cause be renamed from its box', () => {
    const m = addCausalIndicator(model, 'Eta');
    const id = m.constructs.find((c) => c.covariate)!.id;
    expect(acts(m, id, 'cbsem')).toContain('rename-indicator');
    expect(acts(m, id, 'cbsem')).not.toContain('add-causal-indicator');
  });
});
