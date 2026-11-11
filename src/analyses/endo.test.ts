import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../model/project';
import type { PlsResult } from '../engine/types';
import { endoAnalysis as t, toInput } from './endo';
import type { AnalysisCtx } from './types';

const col = (...v: number[]) => Float64Array.from(v);
const data = {
  names: ['y', 'P', 'X1', 'X2', 'Z'],
  cols: [col(1, 2, 3), col(2, 3, 4), col(0, 1, 0), col(5, 4, 3), col(9, 8, 7)],
};
const ctx = (over: Partial<AnalysisCtx> = {}): AnalysisCtx => ({
  data,
  info: null,
  settings: DEFAULT_SETTINGS,
  pls: null,
  projectName: 'p',
  ...over,
});
const o = { ...t.defaults(ctx()), outcome: 'y', endogenous: ['P'], exogenous: ['X1', 'X2'] };

describe('endogeneity card', () => {
  it('validates options from files', () => {
    const p = t.parseOptions({
      method: 'hm',
      hmTypes: ['gp', 'evil', 'gp'],
      selection: 'x',
      heckmanMethod: 'fast',
      source: 'scores',
    })!;
    expect(p.method).toBe('hm');
    expect(p.hmTypes).toEqual(['gp']);
    expect(p.selection).toEqual({ outcome: '', regressors: [] });
    expect(p.heckmanMethod).toBe('ml');
    expect(p.source).toBe('scores');
    expect(t.parseOptions(5)).toBeNull();
  });

  it('says why it cannot run, per method', () => {
    expect(t.blocked(o, ctx())).toBeNull();
    expect(t.blocked({ ...o, method: 'iv' }, ctx())).toContain('at least as many instruments');
    expect(t.blocked({ ...o, method: 'iv', instruments: ['Z'] }, ctx())).toBeNull();
    expect(
      t.blocked({ ...o, method: 'het', endogenous: ['P', 'X1'], exogenous: ['X2'] }, ctx()),
    ).toBe('This method handles one endogenous regressor.');
    expect(t.blocked({ ...o, method: 'hm', hmTypes: [] }, ctx())).toBe(
      'Choose at least one internal instrument.',
    );
    expect(t.blocked({ ...o, method: 'heckman' }, ctx())).toBe(
      'Choose the selection indicator and its regressors.',
    );
    expect(
      t.blocked(
        { ...o, method: 'heckman', selection: { outcome: 'Z', regressors: ['gone'] } },
        ctx(),
      ),
    ).toBe('Not in the data: gone.');
    expect(t.blocked({ ...o, source: 'scores' }, ctx())).toContain(
      'Calculate a PLS-SEM model first',
    );
  });

  it('runs on PLS construct scores when asked', () => {
    const pls = {
      constructs: ['y', 'P', 'X1', 'X2'],
      scores: data.cols.slice(0, 4),
    } as unknown as PlsResult;
    const s = { ...o, source: 'scores' as const };
    expect(t.blocked(s, ctx({ pls }))).toBeNull();
    expect(t.fingerprint(s, ctx({ pls }))).not.toBe(t.fingerprint(o, ctx({ pls })));
  });

  it('is stale when bootstrap settings change only for the copula', () => {
    const more = ctx({
      settings: { ...DEFAULT_SETTINGS, bootSamples: DEFAULT_SETTINGS.bootSamples + 100 },
    });
    expect(t.fingerprint(o, more)).not.toBe(t.fingerprint(o, ctx()));
    const iv = { ...o, method: 'iv' as const, instruments: ['Z'] };
    expect(t.fingerprint(iv, more)).toBe(t.fingerprint(iv, ctx()));
    expect(
      t.fingerprint(iv, ctx({ data: { ...data, cols: [...data.cols.slice(0, 4), col(1, 1, 1)] } })),
    ).not.toBe(t.fingerprint(iv, ctx()));
  });

  it('sends R what applies to the method', () => {
    expect(toInput({ ...o, method: 'liv' }, ctx()).exogenous).toEqual([]);
    expect(toInput({ ...o, method: 'het', hetRegressors: [] }, ctx()).hetRegressors).toEqual([
      'X1',
      'X2',
    ]);
    expect(toInput(o, ctx()).boot).toEqual({
      samples: DEFAULT_SETTINGS.bootSamples,
      seed: DEFAULT_SETTINGS.seed,
      confidence: DEFAULT_SETTINGS.confidence,
    });
    // The project's subsamples go to R as they are (the Inspector allows up to 100,000).
    expect(
      toInput(o, ctx({ settings: { ...DEFAULT_SETTINGS, bootSamples: 100_000 } })).boot.samples,
    ).toBe(100_000);
    expect(
      toInput(o, ctx({ settings: { ...DEFAULT_SETTINGS, bootSamples: 3 } })).boot.samples,
    ).toBe(10);
    expect('source' in toInput(o, ctx())).toBe(false);
  });
});
