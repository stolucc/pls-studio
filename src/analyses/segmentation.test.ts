import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type ModelState } from '../model/project';
import { fimixAnalysis, moveCategory, pathmoxAnalysis, rebusAnalysis, segmentationCard } from './segmentation';
import type { AnalysisCtx } from './types';

it('reorders categories of an ordered segmentation variable', () => {
  expect(moveCategory([1, 2, 3], 2, -1)).toEqual([1, 3, 2]);
  expect(moveCategory([1, 2, 3], 0, 1)).toEqual([2, 1, 3]);
  expect(moveCategory([1, 2, 3], 0, -1)).toEqual([1, 2, 3]);
  expect(moveCategory([1, 2, 3], 2, 1)).toEqual([1, 2, 3]);
});

const col = (...v: number[]) => Float64Array.from(v);
const K = (id: string, inds: string[], composite = false) => ({ id, name: id, type: composite ? 'composite' as const : 'factor' as const, mode: composite ? 'B' as const : 'A' as const, indicators: inds, x: 0, y: 0, side: 'left' as const });
const model: ModelState = { constructs: [K('A', ['a1', 'a2']), K('B', ['b1', 'b2'])], paths: [{ id: 'p', from: 'A', to: 'B' }], moderations: [] };
const data = { names: ['a1', 'a2', 'b1', 'b2', 'region', 'id'], cols: [col(1, 2, 3, 4), col(2, 3, 4, 5), col(1, 3, 2, 4), col(2, 2, 3, 3), col(1, 2, 1, 2), col(1, 2, 3, 4)] };
const ctx = (over: Partial<AnalysisCtx> = {}): AnalysisCtx => ({ data, info: null, settings: { ...DEFAULT_SETTINGS, method: 'pls' }, pls: null, projectName: 'p', model, ...over });

describe('segmentation cards', () => {
  it('REBUS needs reflective constructs and no interactions', () => {
    expect(rebusAnalysis.blocked({ from: 2, to: 3 }, ctx())).toBeNull();
    expect(rebusAnalysis.blocked({ from: 2, to: 3 }, ctx({ model: { ...model, constructs: [K('A', ['a1', 'a2'], true), K('B', ['b1', 'b2'])] } }))).toContain('reflective constructs');
    expect(rebusAnalysis.blocked({ from: 4, to: 3 }, ctx())).toContain('must not exceed');
    expect(fimixAnalysis.blocked({ to: 3, nrep: 5, intercepts: true }, ctx({ settings: { ...DEFAULT_SETTINGS, method: 'cbsem' } }))).toContain('PLS-SEM');
  });

  it('PATHMOX segments by columns outside the model with few values, validated from files', () => {
    const seg = { column: 'region', labels: ['north', 'south'], ordered: false };
    expect(pathmoxAnalysis.blocked({ segments: [], alpha: 0.05, depth: 2, size: 0.1 }, ctx())).toContain('at least one');
    expect(pathmoxAnalysis.blocked({ segments: [seg], alpha: 0.05, depth: 2, size: 0.1 }, ctx())).toBeNull();
    expect(pathmoxAnalysis.blocked({ segments: [{ ...seg, column: 'a1' }], alpha: 0.05, depth: 2, size: 0.1 }, ctx())).toContain('no longer usable');
    const parsed = pathmoxAnalysis.parseOptions({ segments: [{ column: 'region', labels: ['n', 's'], ordered: true, order: [2, 2] }, { labels: [] }], alpha: 9 })!;
    expect(parsed.segments).toEqual([{ column: 'region', labels: ['n', 's'], ordered: false }]);
    expect(parsed.alpha).toBe(0.2);
    expect(pathmoxAnalysis.fingerprint({ segments: [seg], alpha: 0.05, depth: 2, size: 0.1 }, ctx({ data: { ...data, cols: [...data.cols.slice(0, 4), col(2, 2, 1, 1), data.cols[5]] } })))
      .not.toBe(pathmoxAnalysis.fingerprint({ segments: [seg], alpha: 0.05, depth: 2, size: 0.1 }, ctx()));
  });

  it('examples open the right card', () => {
    expect(segmentationCard({ from: 2, to: 3 }, [])).toEqual(['rebus', { from: 2, to: 3 }]);
    expect(segmentationCard({ method: 'fimix' }, [])).toEqual(['fimix', {}]);
    expect(segmentationCard({ method: 'pathmox' }, [{ column: 'x', labels: [], ordered: false }])).toEqual(['pathmox', { segments: [{ column: 'x', labels: [], ordered: false }] }]);
  });
});
