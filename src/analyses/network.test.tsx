import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type ModelState } from '../model/project';
import { egaAnalysis as ega, networkAnalysis as net } from './network';
import type { AnalysisCtx } from './types';

const col = (...v: number[]) => Float64Array.from(v);
const K = (id: string, inds: string[]) => ({ id, name: id, type: 'factor' as const, mode: 'A' as const, indicators: inds, x: 0, y: 0, side: 'left' as const });
const model: ModelState = { constructs: [K('F', ['a', 'b', 'c'])], paths: [], moderations: [] };
const data = { names: ['a', 'b', 'c', 'd'], cols: [col(1, 2, 3), col(2, 3, 1), col(3, 1, 2), col(1, 1, 2)] };
const ctx = (over: Partial<AnalysisCtx> = {}): AnalysisCtx => ({ data, info: null, settings: DEFAULT_SETTINGS, pls: null, projectName: 'p', model, ...over });

describe('network cards', () => {
  it('start with the model’s indicators and validate options from files', () => {
    expect(net.defaults(ctx()).vars).toEqual(['a', 'b', 'c']);
    expect(net.parseOptions({ vars: ['a', 'a'], estimator: 'magic', corMethod: 'kendall', missing: 'x', gamma: 3, stability: -1 }))
      .toEqual({ vars: ['a'], estimator: 'EBICglasso', corMethod: 'cor_auto', missing: 'pairwise', gamma: 1, stability: 0 });
    expect(ega.parseOptions({ model: 'BGGM', algorithm: 'leiden' })).toMatchObject({ model: 'glasso', algorithm: 'leiden', corr: 'auto' });
  });

  it('say why they cannot run', () => {
    expect(net.blocked({ ...net.defaults(ctx()), vars: ['a', 'b'] }, ctx())).toBe('Choose at least three variables.');
    expect(ega.blocked({ ...ega.defaults(ctx()), vars: ['a', 'b', 'z'] }, ctx())).toBe('Not in the data: z.');
    expect(net.blocked(net.defaults(ctx()), ctx({ data: null }))).toContain('needs raw data');
  });

  it('are stale when their columns change, or the seed when bootstrapping', () => {
    const o = net.defaults(ctx());
    expect(net.fingerprint(o, ctx({ data: { ...data, cols: [...data.cols.slice(0, 3), col(9, 9, 9)] } }))).toBe(net.fingerprint(o, ctx()));
    expect(net.fingerprint(o, ctx({ settings: { ...DEFAULT_SETTINGS, seed: 9 } }))).toBe(net.fingerprint(o, ctx()));
    expect(net.fingerprint({ ...o, stability: 100 }, ctx({ settings: { ...DEFAULT_SETTINGS, seed: 9 } }))).not.toBe(net.fingerprint({ ...o, stability: 100 }, ctx()));
  });
});

describe('network view labels', () => {
  it('call the edges correlations when the estimator is plain correlations', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { networkAnalysis } = await import('./network');
    const r = { names: ['a', 'b', 'c'], weights: [[0, 0.3, 0], [0.3, 0, 0.2], [0, 0.2, 0]], layout: [[0, 0], [1, 0], [0, 1]], n: 50, nComplete: 50,
      centrality: { strength: [0.3, 0.5, 0.2], expectedInfluence: [0.3, 0.5, 0.2], closeness: [1, 1, 1], betweenness: [0, 1, 0] }, cs: null, samples: 0, warnings: [], engine: { package: 'bootnet', version: '1' } };
    const o = { ...networkAnalysis.defaults({ data: null, info: null, settings: {} as never, pls: null, projectName: 'p' }), vars: ['a', 'b', 'c'] };
    expect(renderToStaticMarkup(<networkAnalysis.View result={r} options={{ ...o, estimator: 'cor' }} current />)).toContain('Edge weights (correlations)');
    expect(renderToStaticMarkup(<networkAnalysis.View result={r} options={{ ...o, estimator: 'EBICglasso' }} current />)).toContain('regularised (EBICglasso)');
  });
});
