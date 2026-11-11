import { describe, expect, it } from 'vitest';
import { DEFAULT_EFA } from '../model/efa';
import { DEFAULT_SETTINGS } from '../model/project';
import { efaAnalysis as t } from './efa';
import { cardStatus } from './store';
import type { AnalysisCard, AnalysisCtx } from './types';

const col = (...v: number[]) => Float64Array.from(v);
const data = {
  names: ['a', 'b', 'c', 'd', 'e'],
  cols: [col(1, 2, 3, 4), col(2, 3, 4, 4), col(1, 1, 2, 3), col(4, 3, 2, 1), col(0, 0, 0, 1)],
};
const ctx = (over: Partial<AnalysisCtx> = {}): AnalysisCtx => ({
  data,
  info: null,
  settings: DEFAULT_SETTINGS,
  pls: null,
  projectName: 'p',
  ...over,
});
const d = { ...DEFAULT_EFA, vars: ['a', 'b', 'c', 'd'], criterion: 'fixed' as const, nfactors: 1 };

describe('factor analysis / PCA card', () => {
  it('starts from a design kept in the settings of an older project', () => {
    expect(t.defaults(ctx())).toEqual(DEFAULT_EFA);
    expect(
      t.defaults(
        ctx({
          settings: {
            ...DEFAULT_SETTINGS,
            efa: { ...DEFAULT_EFA, vars: ['a', 'b', 'c'], method: 'ml' },
          },
        }),
      ).method,
    ).toBe('ml');
  });

  it('offers factor analysis and PCA in the Add menu, titled by the analysis', () => {
    const [fa, pca] = t.entries!;
    expect(pca.options(DEFAULT_EFA)).toMatchObject({ method: 'pca' });
    expect(fa.options({ ...DEFAULT_EFA, method: 'pca' }).method).toBe('minres');
    expect(t.cardTitle!(pca.options(DEFAULT_EFA))).toBe('Principal component analysis');
    expect(t.cardTitle!(d)).toBe('Exploratory factor analysis');
  });

  it('says why it cannot run', () => {
    expect(t.blocked(d, ctx())).toBeNull();
    expect(t.blocked({ ...d, vars: ['a', 'b', 'gone'] }, ctx())).toBe(
      'Choose at least three variables.',
    );
    expect(t.blocked({ ...d, nfactors: 4 }, ctx())).toContain('fewer factors than variables');
    expect(t.blocked({ ...d, criterion: 'parallel', parallel: 0 }, ctx())).toBe(
      'Parallel analysis needs samples.',
    );
    expect(t.blocked(d, ctx({ data: null }))).toContain('needs raw data');
    // Bifactor rotations: lavaan's, with a general and at least one specific factor.
    expect(t.blocked({ ...d, rotation: 'bigeomin' }, ctx())).toContain(
      'need the lavaan extraction',
    );
    expect(
      t.blocked({ ...d, method: 'lavaan', rotation: 'bigeomin', nfactors: 2 }, ctx()),
    ).toContain('compare fit from 2');
    expect(
      t.blocked({ ...d, method: 'lavaan', rotation: 'bigeomin', nfactors: 2, from: 2 }, ctx()),
    ).toBeNull();
    // The congruence comparison: a psych solution against another psych solution.
    const compare = { method: 'ml' as const, rotation: 'varimax' as const };
    expect(t.blocked({ ...d, compare }, ctx())).toBeNull();
    expect(t.blocked({ ...d, method: 'lavaan', compare }, ctx())).toContain(
      'congruence comparison needs a psych extraction',
    );
    // Schmid–Leiman: an oblique psych factor solution with three or more factors.
    const five = { ...d, vars: ['a', 'b', 'c', 'd', 'e'], schmid: true as const };
    expect(t.blocked({ ...five, nfactors: 3 }, ctx())).toBeNull();
    expect(t.blocked({ ...five, nfactors: 2 }, ctx())).toContain('at least three factors');
    expect(t.blocked({ ...five, nfactors: 3, rotation: 'varimax' }, ctx())).toContain(
      'oblique rotation',
    );
    expect(t.blocked({ ...five, criterion: 'parallel', parallel: 10 }, ctx())).toBeNull();
  });

  it('changing the display threshold does not make the result stale', () => {
    const card: AnalysisCard = {
      id: 'card-1',
      kind: 'analysis',
      type: 'efa',
      options: d,
      run: { at: 1, fingerprint: t.fingerprint(d, ctx())!, options: JSON.stringify(d) },
    };
    expect(cardStatus(card, ctx(), false, true).state).toBe('current');
    expect(
      cardStatus({ ...card, options: { ...d, threshold: 0.5 } }, ctx(), false, true).state,
    ).toBe('current');
    expect(
      cardStatus({ ...card, options: { ...d, rotation: 'varimax' } }, ctx(), false, true).state,
    ).toBe('stale');
    expect(
      cardStatus(
        card,
        ctx({ data: { ...data, cols: [...data.cols.slice(0, 4), col(9, 9, 9, 9)] } }),
        false,
        true,
      ).state,
    ).toBe('current');
    expect(
      cardStatus(card, ctx({ settings: { ...DEFAULT_SETTINGS, seed: 99 } }), false, true).state,
    ).toBe('stale');
  });
});
