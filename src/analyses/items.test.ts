import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../model/project';
import { irtAnalysis as irt, irtFit, lcaAnalysis as lca, lcaSpec } from './items';
import type { AnalysisCtx } from './types';

const col = (...v: number[]) => Float64Array.from(v);
const data = { names: ['i1', 'i2', 'i3'], cols: [col(0, 1, 1), col(1, 1, 0), col(0, 0, 1)] };
const ctx = (over: Partial<AnalysisCtx> = {}): AnalysisCtx => ({
  data,
  info: null,
  settings: DEFAULT_SETTINGS,
  pls: null,
  projectName: 'p',
  ...over,
});

describe('item analysis cards', () => {
  it('validate options from files', () => {
    expect(irt.parseOptions({ items: ['i1', 'i1', 'i2'], model: '3pl' })).toEqual({
      items: ['i1', 'i2'],
      model: 'grm',
    });
    expect(lca.parseOptions({ items: ['i1'], from: 0, to: 99 })).toEqual({
      items: ['i1'],
      from: 1,
      to: 10,
    });
  });

  it('say why they cannot run', () => {
    expect(irt.blocked({ items: ['i1'], model: 'rasch' }, ctx())).toBe(
      'Choose at least two items.',
    );
    expect(irt.blocked({ items: ['i1', 'i2'], model: 'rasch' }, ctx())).toBeNull();
    expect(lca.blocked({ items: ['i1', 'i2'], from: 4, to: 2 }, ctx())).toContain(
      'must not exceed',
    );
    expect(lca.blocked({ items: ['i1', 'x'], from: 1, to: 2 }, ctx())).toBe('Not in the data: x.');
  });

  it('latent classes are stale when the seed changes (random starts); IRT is not', () => {
    const seed = ctx({ settings: { ...DEFAULT_SETTINGS, seed: 7 } });
    const o = { items: ['i1', 'i2'], from: 1, to: 2 };
    expect(lca.fingerprint(o, seed)).not.toBe(lca.fingerprint(o, ctx()));
    expect(irt.fingerprint({ items: ['i1', 'i2'], model: 'rasch' }, seed)).toBe(
      irt.fingerprint({ items: ['i1', 'i2'], model: 'rasch' }, ctx()),
    );
  });

  it('latent profiles and latent class growth: options from files, what R is sent, why they cannot run', () => {
    expect(
      lca.parseOptions({ items: ['i1', 'i2'], from: 2, to: 2, model: 'lpa', structure: 'XXX' }),
    ).toEqual({ items: ['i1', 'i2'], from: 2, to: 2, model: 'lpa', structure: 'EEI' });
    expect(
      lca.parseOptions({ items: ['i1', 'i2'], from: 2, to: 2, model: 'lcga', times: [0, 'a', 2] }),
    ).toEqual({ items: ['i1', 'i2'], from: 2, to: 2, model: 'lcga', times: [0, 2] });
    expect(lca.parseOptions({ items: ['i1'], from: 1, to: 2, model: 'other' })).toEqual({
      items: ['i1'],
      from: 1,
      to: 2,
    });
    expect(lcaSpec({ model: 'lpa' })).toEqual({ model: 'lpa', structure: 'EEI' });
    expect(lcaSpec({ model: 'lcga', times: [] })).toEqual({ model: 'lcga', times: undefined });
    expect(lcaSpec({})).toEqual({});
    expect(lca.blocked({ items: ['i1', 'i2'], from: 1, to: 2, model: 'lcga' }, ctx())).toBe(
      'Choose at least three occasions.',
    );
    expect(
      lca.blocked(
        { items: ['i1', 'i2', 'i3'], from: 1, to: 2, model: 'lcga', times: [0, 1] },
        ctx(),
      ),
    ).toBe('Give one time score per occasion.');
    expect(
      lca.blocked(
        { items: ['i1', 'i2', 'i3'], from: 1, to: 2, model: 'lcga', times: [0, 1, 2] },
        ctx(),
      ),
    ).toBeNull();
    const o = { items: ['i1', 'i2'], from: 1, to: 2 };
    expect(lca.fingerprint({ ...o, model: 'lpa', structure: 'EEI' }, ctx())).not.toBe(
      lca.fingerprint({ ...o, model: 'lpa', structure: 'VVI' }, ctx()),
    );
  });
});

describe('auxiliary variables of latent classes (three-step)', () => {
  const o = { items: ['i1', 'i2'], from: 1, to: 3 };
  it('validates saved options strictly', () => {
    expect(
      lca.parseOptions({
        ...o,
        aux: {
          distal: ['i3', 'i3'],
          covariates: ['i3', 'x'],
          method: 'eval',
          classes: 99,
          reference: 0,
        },
      }),
    ).toEqual({
      ...o,
      aux: { distal: ['i3'], covariates: ['x'], method: 'ml', classes: 10, reference: 1 },
    });
    expect(lca.parseOptions({ ...o, aux: { distal: [], covariates: [] } })).toEqual(o);
    expect(lca.parseOptions({ ...o, aux: 'x' })).toEqual(o);
  });
  it('sends the auxiliary variables to R, except for multilevel classes', () => {
    const aux = { distal: ['i3'], covariates: [], method: 'bch' as const };
    expect(lcaSpec({ aux })).toEqual({ aux });
    expect(lcaSpec({ model: 'lpa', aux })).toEqual({ model: 'lpa', structure: 'EEI', aux });
    expect(lcaSpec({ model: 'mlca', cluster: 'c', aux })).toEqual({
      model: 'mlca',
      cluster: 'c',
      clusterClasses: 2,
    });
    expect(lcaSpec({ aux: { distal: [], covariates: [], method: 'ml' } })).toEqual({});
  });
  it('says why it cannot run, and is stale when the auxiliary variables change', () => {
    expect(
      lca.blocked({ ...o, aux: { distal: ['i1'], covariates: [], method: 'ml' } }, ctx()),
    ).toBe('An auxiliary variable cannot be one of the items.');
    expect(
      lca.blocked(
        { ...o, aux: { distal: ['i3'], covariates: [], method: 'ml', classes: 4 } },
        ctx(),
      ),
    ).toContain('fitted numbers of classes (2–3)');
    expect(
      lca.blocked({ ...o, to: 1, aux: { distal: ['i3'], covariates: [], method: 'ml' } }, ctx()),
    ).toContain('two or more classes');
    expect(
      lca.blocked({ ...o, aux: { distal: ['zz'], covariates: [], method: 'ml' } }, ctx()),
    ).toBe('Not in the data: zz.');
    expect(
      lca.blocked(
        { ...o, aux: { distal: ['i3'], covariates: [], method: 'ml', classes: 3 } },
        ctx(),
      ),
    ).toBeNull();
    const a = { ...o, aux: { distal: [], covariates: ['i3'], method: 'ml' as const } };
    expect(lca.fingerprint(a, ctx())).not.toBe(
      lca.fingerprint({ ...a, aux: { ...a.aux, method: 'bch' } }, ctx()),
    );
    expect(lca.fingerprint(a, ctx())).not.toBe(lca.fingerprint(o, ctx()));
    expect(lca.summary!(a)).toContain('three-step');
  });
});

describe('mirt models and multilevel latent classes', () => {
  it('older saved IRT and LCA options read as before', () => {
    expect(
      irt.parseOptions({ items: ['i1', 'i2'], model: 'twopl', quadrature: 81, robust: true }),
    ).toEqual({ items: ['i1', 'i2'], model: 'twopl', quadrature: 81, robust: true });
    expect(lca.parseOptions({ items: ['i1', 'i2'], from: 2, to: 3 })).toEqual({
      items: ['i1', 'i2'],
      from: 2,
      to: 3,
    });
    // (and their fingerprints do not change)
    expect(irt.fingerprint({ items: ['i1', 'i2'], model: 'twopl' }, ctx())).toBe(
      irt.fingerprint({ items: ['i1', 'i2'], model: 'twopl', robust: true }, ctx()),
    );
  });

  it('read the mirt options: priors, guessing items, frequencies, classes', () => {
    expect(
      irt.parseOptions({
        items: ['i1', 'i2'],
        model: 'threepl',
        priorG: [-1.386, 1],
        priorU: [2, 0],
        guessItems: ['i2', 'i2'],
        freq: 'f',
        classes: 9,
        quadrature: 150,
      }),
    ).toEqual({
      items: ['i1', 'i2'],
      model: 'threepl',
      priorG: [-1.386, 1],
      guessItems: ['i2'],
      freq: 'f',
      classes: 5,
      quadrature: 150,
    });
    expect(irt.parseOptions({ items: ['i1', 'i2'], model: 'fourpl', priorG: ['a', 1] })).toEqual({
      items: ['i1', 'i2'],
      model: 'fourpl',
    });
  });

  it('send R only what the model uses', () => {
    const o = {
      items: ['i1', 'i2'],
      model: 'mixture' as const,
      priorG: [-1, 1] as [number, number],
      robust: true,
      classes: 3,
    };
    expect(irtFit(o, 7)).toEqual({
      quadrature: undefined,
      robust: false,
      priorG: undefined,
      priorU: undefined,
      guessItems: undefined,
      freq: undefined,
      classes: 3,
      nrep: 10,
      seed: 7,
    });
    expect(
      irtFit(
        { items: ['i1', 'i2'], model: 'fourpl', priorG: [-1, 1], priorU: [2, 1], robust: true },
        1,
      ),
    ).toMatchObject({ robust: true, priorG: [-1, 1], priorU: [2, 1] });
    expect(irtFit({ items: ['i1', 'i2'], model: 'grm', robust: true, priorG: [-1, 1] }, 1)).toEqual(
      { quadrature: undefined, robust: false },
    );
  });

  it('say why they cannot run', () => {
    expect(irt.blocked({ items: ['i1', 'i2'], model: 'twopl', quadrature: 150 }, ctx())).toContain(
      'between 5 and 100',
    );
    expect(
      irt.blocked({ items: ['i1', 'i2'], model: 'threepl', quadrature: 150 }, ctx()),
    ).toBeNull();
    expect(irt.blocked({ items: ['i1', 'i2'], model: 'threepl', freq: 'x' }, ctx())).toBe(
      'Not in the data: x.',
    );
    expect(
      irt.blocked({ items: ['i1', 'i2'], model: 'threepl', guessItems: ['i3'] }, ctx()),
    ).toContain('guessing');
    expect(lca.blocked({ items: ['i1', 'i2'], from: 1, to: 2, model: 'mlca' }, ctx())).toBe(
      'Choose the cluster column.',
    );
    expect(
      lca.blocked({ items: ['i1', 'i2'], from: 1, to: 2, model: 'mlca', cluster: 'i2' }, ctx()),
    ).toContain('cannot be one of the items');
    expect(
      lca.blocked({ items: ['i1', 'i2'], from: 1, to: 2, model: 'mlca', cluster: 'i3' }, ctx()),
    ).toBeNull();
  });

  it('the mixture and multilevel classes are stale when the seed or the cluster settings change', () => {
    const seed = ctx({ settings: { ...DEFAULT_SETTINGS, seed: 7 } });
    const m = { items: ['i1', 'i2'], model: 'mixture' as const };
    expect(irt.fingerprint(m, seed)).not.toBe(irt.fingerprint(m, ctx()));
    const o = { items: ['i1', 'i2'], from: 2, to: 2, model: 'mlca' as const, cluster: 'i3' };
    expect(lca.fingerprint(o, ctx())).not.toBe(lca.fingerprint({ ...o, clusterClasses: 3 }, ctx()));
    expect(lca.parseOptions({ ...o, clusterClasses: 40 })).toEqual({ ...o, clusterClasses: 10 });
    expect(lcaSpec({ ...o })).toEqual({ model: 'mlca', cluster: 'i3', clusterClasses: 2 });
  });
});
