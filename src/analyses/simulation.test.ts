import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type ModelState } from '../model/project';
import { defaultDesign, populationFromModel } from '../model/simulation';
import { withLegacySimulation } from './persist';
import { mcAnalysis as t } from './simulation';
import type { AnalysisCtx } from './types';

const K = (id: string, inds: string[]) => ({ id, name: id, type: 'factor' as const, mode: 'A' as const, indicators: inds, x: 0, y: 0, side: 'left' as const });
const model: ModelState = { constructs: [K('A', ['a1', 'a2', 'a3']), K('B', ['b1', 'b2', 'b3'])], paths: [{ id: 'p', from: 'A', to: 'B' }], moderations: [] };
const ctx = (over: Partial<AnalysisCtx> = {}): AnalysisCtx => ({ data: null, info: null, settings: DEFAULT_SETTINGS, pls: null, projectName: 'p', model, ...over });

describe('Monte Carlo card', () => {
  it('starts from a population built on the model, and needs no data', () => {
    const d = t.defaults(ctx());
    expect(d).toEqual(defaultDesign(populationFromModel(model, null, null)));
    expect(t.blocked(d, ctx())).toBeNull();
    expect(t.fingerprint(d, ctx())).toBeTruthy();
  });

  it('says why it cannot run', () => {
    const empty = t.defaults(ctx({ model: { constructs: [], paths: [], moderations: [] } }));
    expect(t.blocked(empty, ctx())).toContain('Build a model first');
    expect(t.blocked({ ...t.defaults(ctx()), estimators: [] }, ctx())).toBe('Choose at least one estimator.');
    expect(t.blocked(t.defaults(ctx()), ctx({ settings: { ...DEFAULT_SETTINGS, method: 'process' } }))).toContain('PLS-SEM and CB-SEM');
  });

  it('is stale only when the design or the engine changes, not the data', () => {
    const d = t.defaults(ctx());
    expect(t.fingerprint(d, ctx({ data: { names: ['x'], cols: [Float64Array.from([1])] } }))).toBe(t.fingerprint(d, ctx()));
    expect(t.fingerprint(d, ctx({ settings: { ...DEFAULT_SETTINGS, engine: 'builtin' } }))).not.toBe(t.fingerprint(d, ctx()));
  });

  it('takes over the simulation design of an older project once', () => {
    const d = t.defaults(ctx());
    const cards = withLegacySimulation([], d);
    expect(cards).toEqual([{ id: 'card-legacy-simulation', kind: 'analysis', type: 'mc', options: d }]);
    expect(withLegacySimulation(cards, d)).toBe(cards);
    expect(withLegacySimulation([], null)).toEqual([]);
    expect(t.parseOptions(JSON.parse(JSON.stringify(d)))).toEqual(d);
  });
});
