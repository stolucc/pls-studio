import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../model/project';
import { irtAnalysis as irt, lcaAnalysis as lca } from './items';
import type { AnalysisCtx } from './types';

const col = (...v: number[]) => Float64Array.from(v);
const data = { names: ['i1', 'i2', 'i3'], cols: [col(0, 1, 1), col(1, 1, 0), col(0, 0, 1)] };
const ctx = (over: Partial<AnalysisCtx> = {}): AnalysisCtx => ({ data, info: null, settings: DEFAULT_SETTINGS, pls: null, projectName: 'p', ...over });

describe('item analysis cards', () => {
  it('validate options from files', () => {
    expect(irt.parseOptions({ items: ['i1', 'i1', 'i2'], model: '3pl' })).toEqual({ items: ['i1', 'i2'], model: 'grm' });
    expect(lca.parseOptions({ items: ['i1'], from: 0, to: 99 })).toEqual({ items: ['i1'], from: 1, to: 10 });
  });

  it('say why they cannot run', () => {
    expect(irt.blocked({ items: ['i1'], model: 'rasch' }, ctx())).toBe('Choose at least two items.');
    expect(irt.blocked({ items: ['i1', 'i2'], model: 'rasch' }, ctx())).toBeNull();
    expect(lca.blocked({ items: ['i1', 'i2'], from: 4, to: 2 }, ctx())).toContain('must not exceed');
    expect(lca.blocked({ items: ['i1', 'x'], from: 1, to: 2 }, ctx())).toBe('Not in the data: x.');
  });

  it('latent classes are stale when the seed changes (random starts); IRT is not', () => {
    const seed = ctx({ settings: { ...DEFAULT_SETTINGS, seed: 7 } });
    const o = { items: ['i1', 'i2'], from: 1, to: 2 };
    expect(lca.fingerprint(o, seed)).not.toBe(lca.fingerprint(o, ctx()));
    expect(irt.fingerprint({ items: ['i1', 'i2'], model: 'rasch' }, seed)).toBe(irt.fingerprint({ items: ['i1', 'i2'], model: 'rasch' }, ctx()));
  });
});
