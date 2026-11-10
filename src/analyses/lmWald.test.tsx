// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type ModelState } from '../model/project';
import { lmWaldAnalysis as lw, type LmWaldResult } from './lmWald';
import type { AnalysisCtx } from './types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const K = (id: string, inds: string[]) => ({ id, name: id, type: 'factor' as const, mode: 'A' as const, indicators: inds, x: 0, y: 0, side: 'left' as const });
const model: ModelState = { constructs: [K('A', ['a1', 'a2', 'a3']), K('B', ['b1', 'b2', 'b3'])], paths: [{ id: 'p', from: 'A', to: 'B' }], moderations: [] };
const names = model.constructs.flatMap((k) => k.indicators).concat('g');
const data = { names, cols: names.map((n, k) => Float64Array.from({ length: 30 }, (_, i) => (n === 'g' ? 1 + (i % 2) : Math.sin(i * (k + 1.3)) + (i % (k + 2))))) };
const settings = { ...DEFAULT_SETTINGS, method: 'cbsem' as const, engine: 'r' as const };
const ctx = (over: Partial<AnalysisCtx> = {}): AnalysisCtx => ({ data, info: null, settings, pls: null, projectName: 'p', model, ...over });

describe('the multivariate LM and Wald card', () => {
  it('validates options from files', () => {
    expect(lw.parseOptions({ lmKinds: ['paths', 'bogus', 'loadings'], waldKinds: 'x', alpha: '0.01', maxCandidates: 10_000 })).toEqual({ lmKinds: ['loadings', 'paths'], waldKinds: ['paths', 'covariances'], alpha: 0.01, maxCandidates: 500 });
    expect(lw.parseOptions({ lmKinds: [], waldKinds: [] })).toMatchObject({ lmKinds: [], waldKinds: [], alpha: 0.05, maxCandidates: 60 });
    expect(lw.parseOptions(null)).toBeNull();
  });

  it('says why it cannot run', () => {
    expect(lw.blocked(lw.defaults(ctx()), ctx())).toBeNull();
    expect(lw.blocked({ ...lw.defaults(ctx()), lmKinds: [], waldKinds: [] }, ctx())).toBe('Choose the parameters to test.');
    expect(lw.blocked(lw.defaults(ctx()), ctx({ model: { ...model, multigroup: { column: 'g', invariance: 'configural', free: [] } } }))).toMatch(/one group/);
    expect(lw.fingerprint(lw.defaults(ctx()), ctx())).not.toBe(lw.fingerprint({ ...lw.defaults(ctx()), alpha: 0.01 }, ctx()));
  });

  it('shows both stepwise tables, or says that nothing is to be freed or dropped', () => {
    const step = { label: 'A → a3', kind: 'loading' as const, lavaan: 'A =~ b3', chisq: 12.5, df: 1, p: 0.0004, increment: 12.5, incrementP: 0.0004, univariate: 12.4 };
    const r: LmWaldResult = { lm: { candidates: 9, steps: [{ ...step, epc: 0.3 }] }, wald: { candidates: 4, steps: [] }, chisq: 30, df: 8, alpha: 0.05, warnings: [], engine: { package: 'lavaan', version: '0.7.3' } };
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(<lw.View result={r} options={lw.defaults(ctx())} current />));
    expect(host.textContent).toContain('Multivariate Lagrange multiplier test (forward stepwise)');
    expect(host.textContent).toContain('A → a3');
    expect(host.textContent).toContain('Wald test: every free parameter of the chosen kinds is needed');
    act(() => root.render(<lw.View result={{ ...r, lm: { candidates: 9, steps: [] }, wald: null }} options={lw.defaults(ctx())} current />));
    expect(host.textContent).toContain('LM test: no fixed parameter');
    expect(host.textContent).not.toContain('Wald test');
    act(() => root.unmount());
  });
});
