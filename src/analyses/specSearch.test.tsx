import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parseProject, serializeProject, type ModelState } from '../model/project';
import { menuFor } from '../components/canvasMenu';
import { toggleOptional } from '../components/canvas/menuActions';
import { useStore } from '../store';
import type { SpecModel } from '../rengine/search';
import { applySpecModel, bestByParameters, optionalArrows, optionalBlocked, rankModels, specSearchAnalysis as ss } from './specSearch';
import type { AnalysisCtx } from './types';

const col = (...v: number[]) => Float64Array.from(v);
const K = (id: string, inds: string[]) => ({ id, name: id.toUpperCase(), type: 'factor' as const, mode: 'A' as const, indicators: inds, x: 0, y: 0, side: 'left' as const });
const model: ModelState = {
  constructs: [K('a', ['a1', 'a2', 'a3']), K('b', ['b1', 'b2', 'b3']), K('c', ['c1', 'c2', 'c3'])],
  paths: [{ id: 'p1', from: 'a', to: 'b' }, { id: 'p2', from: 'a', to: 'c', optional: true }, { id: 'p3', from: 'b', to: 'c' }],
  moderations: [],
  correlations: [{ id: 'k1', kind: 'indicator', a: 'a1', b: 'b1', optional: true }],
};
const names = model.constructs.flatMap((k) => k.indicators);
const data = { names, cols: names.map((_, i) => col(i, i + 1, i + 3, i + 2)) };
const settings = { ...DEFAULT_SETTINGS, method: 'cbsem' as const, engine: 'r' as const, estimator: 'ML' as const };
const ctx = (over: Partial<AnalysisCtx> = {}): AnalysisCtx => ({ data, info: null, settings, pls: null, projectName: 'p', model, ...over });
const M = (keep: boolean[], npar: number, bic: number | null, converged = true): SpecModel => ({ keep, converged, npar, chisq: 1, df: 1, p: 0.5, cfi: 1, rmsea: 0, aic: bic === null ? null : bic - 10, bic, warning: null });

describe('optional arrows (specification search)', () => {
  it('are kept in project files, and only as true', () => {
    const back = parseProject(serializeProject(model, settings, null, null)).model;
    expect(back.paths.map((p) => p.optional)).toEqual([undefined, true, undefined]);
    expect(back.correlations?.[0].optional).toBe(true);
    const raw = JSON.parse(serializeProject(model, settings, null, null));
    raw.model.paths[0].optional = 'yes';
    raw.model.correlations[0] = { ...raw.model.correlations[0], kind: 'construct', a: 'a', b: 'b', zero: true, optional: true };
    const odd = parseProject(JSON.stringify(raw)).model;
    expect(odd.paths[0].optional).toBeUndefined();
    expect(odd.correlations?.[0].optional).toBeUndefined();  // (a covariance fixed at zero is not a choice to search)
  });

  it('are toggled from the arrow’s context menu in CB-SEM, for free unlabelled arrows', () => {
    const items = (t: Parameters<typeof menuFor>[0], m: ModelState = model, method: 'cbsem' | 'pls' = 'cbsem') => menuFor(t, m, { method, readOnly: false })?.items ?? [];
    expect(items({ kind: 'path', id: 'p1' }).find((i) => i.action === 'toggle-optional')?.label).toBe('Make optional (specification search)');
    expect(items({ kind: 'path', id: 'p2' }).find((i) => i.action === 'toggle-optional')?.label).toBe('Make required (not optional)');
    expect(items({ kind: 'correlation', id: 'k1' }).find((i) => i.action === 'toggle-optional')?.label).toBe('Make required (not optional)');
    expect(items({ kind: 'path', id: 'p1' }, model, 'pls').some((i) => i.action === 'toggle-optional')).toBe(false);
    const held = { ...model, paths: model.paths.map((p) => (p.id === 'p1' ? { ...p, fixed: 0.5 } : p)) };
    expect(items({ kind: 'path', id: 'p1' }, held).some((i) => i.action === 'toggle-optional')).toBe(false);
  });

  it('the menu action flips the flag on the path or covariance, one undo step', () => {
    useStore.setState({ model, past: [], future: [] });
    toggleOptional({ kind: 'path', id: 'p1' });
    toggleOptional({ kind: 'correlation', id: 'k1' });
    expect(useStore.getState().model.paths.map((p) => p.optional)).toEqual([true, true, undefined]);
    expect(useStore.getState().model.correlations?.[0].optional).toBeUndefined();
    useStore.getState().undo();
    expect(useStore.getState().model.correlations?.[0].optional).toBe(true);
  });

  it('are listed paths first, with the names R needs', () => {
    expect(optionalArrows(model)).toEqual([
      { id: 'p2', kind: 'path', label: 'A → C', ref: { type: 'path', from: 'A', to: 'C' } },
      { id: 'k1', kind: 'correlation', label: 'a1 ↔ b1', ref: { type: 'cov', kind: 'indicator', a: 'a1', b: 'b1' } },
    ]);
  });

  it('the card says why it cannot run: none optional, too many, held, moderated, not a likelihood estimator', () => {
    expect(ss.blocked(ss.defaults(ctx()), ctx())).toBeNull();
    expect(optionalBlocked({ ...model, paths: model.paths.map(({ optional: _o, ...p }) => p), correlations: [] })).toMatch(/Make optional/);
    const many = { ...model, correlations: Array.from({ length: 12 }, (_, i) => ({ id: `k${i}`, kind: 'indicator' as const, a: names[i % 9], b: names[(i + 1 + Math.floor(i / 9)) % 9], optional: true as const })) };
    expect(optionalBlocked(many)).toMatch(/13 optional arrows would mean 8,192 models: mark at most 12 \(4,096 models\)/);
    expect(optionalBlocked({ ...model, paths: model.paths.map((p) => (p.id === 'p2' ? { ...p, label: 'x' } : p)) })).toMatch(/A → C is fixed or labelled/);
    expect(optionalBlocked({ ...model, moderations: [{ id: 'm', moderator: 'b', path: 'p2' }] })).toMatch(/moderated path/);
    expect(ss.blocked(ss.defaults(ctx()), ctx({ settings: { ...settings, estimator: 'WLSMV' } }))).toMatch(/maximum-likelihood estimator/);
  });

  it('the result is stale when the optional arrows change', () => {
    const f = ss.fingerprint(ss.defaults(ctx()), ctx());
    expect(f).toBeTruthy();
    expect(ss.fingerprint(ss.defaults(ctx()), ctx({ model: { ...model, paths: model.paths.map((p) => (p.id === 'p1' ? { ...p, optional: true as const } : p)) } }))).not.toBe(f);
  });

  it('validates options from files; ranking and display do not make it stale', () => {
    expect(ss.parseOptions({ criterion: 'nonsense', shown: 7 })).toEqual({ criterion: 'bic', shown: 25 });
    expect(ss.parseOptions({ criterion: 'aic', shown: 0 })).toEqual({ criterion: 'aic', shown: 0 });
    expect(ss.parseOptions('x')).toBeNull();
    expect(ss.display).toEqual(['criterion', 'shown']);
  });
});

describe('ranking the models', () => {
  const models = [M([true, true], 10, 100), M([false, true], 9, 98), M([true, false], 9, 101), M([false, false], 8, null, false)];
  it('ranks converged models by the criterion, with Δ and weights exp(−Δ/2) normalised (Amos’s BIC_p)', () => {
    const r = rankModels(models, 'bic');
    expect(r.map((x) => x.index)).toEqual([1, 0, 2]);
    expect(r.map((x) => x.delta)).toEqual([0, 2, 3]);
    const w = [1, Math.exp(-1), Math.exp(-1.5)], t = w.reduce((a, b) => a + b);
    r.forEach((x, i) => expect(x.weight).toBeCloseTo(w[i] / t, 12));
    expect(rankModels([], 'aic')).toEqual([]);
  });
  it('keeps the best model per number of parameters', () => {
    expect(bestByParameters(rankModels(models, 'bic')).map((x) => [x.model.npar, x.index])).toEqual([[9, 1], [10, 0]]);
  });
  it('applying a model deletes the optional arrows it leaves out', () => {
    const arrows = optionalArrows(model).map(({ id, kind, label }) => ({ id, kind, label }));
    const m = applySpecModel(model, arrows, [false, true]);
    expect(m.paths.map((p) => p.id)).toEqual(['p1', 'p3']);
    expect(m.correlations?.map((k) => k.id)).toEqual(['k1']);
    expect(applySpecModel(model, arrows, [true, false]).correlations).toEqual([]);
  });
});
