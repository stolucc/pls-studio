// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type ModelState } from '../model/project';
import { useStore } from '../store';
import {
  alternativesOf,
  equivalentAnalysis as eq,
  sameFit,
  type EquivalentResult,
} from './equivalent';
import type { AnalysisCtx } from './types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const V = (id: string, x: number) => ({
  id,
  name: id[0].toUpperCase() + id.slice(1),
  type: 'factor' as const,
  mode: 'A' as const,
  indicators: [id],
  x,
  y: 0,
  side: 'left' as const,
});
const roth: ModelState = {
  constructs: ['exercise', 'hardy', 'fitness', 'stress', 'illness'].map((id, i) => V(id, i * 150)),
  moderations: [],
  paths: [
    ['exercise', 'fitness'],
    ['hardy', 'stress'],
    ['fitness', 'illness'],
    ['stress', 'illness'],
  ].map(([from, to], i) => ({ id: `p${i}`, from, to })),
  correlations: [{ id: 'k', kind: 'construct', a: 'exercise', b: 'hardy' }],
};
const names = roth.constructs.flatMap((k) => k.indicators);
const data = {
  names,
  cols: names.map((_, k) =>
    Float64Array.from({ length: 30 }, (_, i) => Math.sin(i * (k + 1.3)) + (i % (k + 2))),
  ),
};
const settings = {
  ...DEFAULT_SETTINGS,
  method: 'cbsem' as const,
  engine: 'r' as const,
  estimator: 'ML' as const,
};
const ctx = (over: Partial<AnalysisCtx> = {}): AnalysisCtx => ({
  data,
  info: null,
  settings,
  pls: null,
  projectName: 'p',
  model: roth,
  ...over,
});
const F = (chisq: number | null, df: number | null, converged = true) => ({
  converged,
  npar: 10,
  chisq,
  df,
  logl: null,
});

describe('the equivalent-models card', () => {
  it('confirms equivalence by the same χ² and df of converged fits', () => {
    expect(sameFit(F(11.107464382, 5), F(11.107464383, 5))).toBe(true);
    expect(sameFit(F(11.1, 5), F(11.2, 5))).toBe(false);
    expect(sameFit(F(11.1, 5), F(11.1, 6))).toBe(false);
    expect(sameFit(F(11.1, 5), F(11.1, 5, false))).toBe(false);
    expect(sameFit(F(0, 0), F(1e-7, 0))).toBe(true);
    expect(sameFit(null, F(1, 1))).toBe(false);
  });

  it('describes each alternative by its changes, with names', () => {
    const { alternatives, truncated } = alternativesOf(roth, 50);
    expect(truncated).toBe(false);
    expect(alternatives.map((a) => a.changes.join('; ')).sort()).toEqual([
      'Exercise → Fitness replaced by Exercise ↔ Fitness; Exercise ↔ Hardy replaced by Exercise → Hardy',
      'Exercise → Fitness reversed; Exercise ↔ Hardy replaced by Exercise → Hardy',
      'Exercise ↔ Hardy replaced by Exercise → Hardy',
      'Exercise ↔ Hardy replaced by Hardy → Exercise',
      'Hardy → Stress replaced by Hardy ↔ Stress; Exercise ↔ Hardy replaced by Hardy → Exercise',
      'Hardy → Stress reversed; Exercise ↔ Hardy replaced by Hardy → Exercise',
    ]);
    expect(alternativesOf(roth, 2)).toMatchObject({ truncated: true });
    expect(alternativesOf(roth, 2).alternatives).toHaveLength(2);
  });

  it('says why it cannot run and validates its options', () => {
    expect(eq.blocked(eq.defaults(ctx()), ctx())).toBeNull();
    expect(
      eq.blocked(eq.defaults(ctx()), ctx({ model: { ...roth, paths: [], correlations: [] } })),
    ).toMatch(/draw paths or covariances/);
    expect(
      eq.blocked(eq.defaults(ctx()), ctx({ settings: { ...settings, method: 'pls' } })),
    ).toMatch(/CB-SEM/);
    expect(eq.parseOptions({ max: '7' })).toEqual({ max: 7 });
    expect(eq.parseOptions({ max: 999 })).toEqual({ max: 50 });
    expect(eq.parseOptions({})).toEqual({ max: 12 });
    expect(eq.fingerprint({ max: 3 }, ctx())).not.toBe(eq.fingerprint({ max: 4 }, ctx()));
  });

  it('draws the model and each alternative, and applies one to the canvas', () => {
    const { alternatives } = alternativesOf(roth, 50);
    const fit = F(11.107, 5);
    const r: EquivalentResult = {
      model: roth,
      fit,
      alternatives: alternatives.map((a, i) => ({ ...a, fit: i === 0 ? F(12, 5) : fit })),
      truncated: false,
      warnings: [],
      engine: { package: 'lavaan', version: '0.7.3' },
    };
    useStore.setState({ model: roth, past: [], future: [] });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(<eq.View result={r} options={{ max: 12 }} current />));
    expect(host.querySelectorAll('.equivalent-figure img')).toHaveLength(7);
    expect(host.textContent).toContain('(not confirmed)');
    expect(host.textContent).toContain('6 alternatives, 5 confirmed');
    const buttons = [...host.querySelectorAll<HTMLButtonElement>('.equivalent-figure button')];
    expect(buttons).toHaveLength(6);
    act(() => buttons[1].click());
    expect(useStore.getState().model.paths).toEqual(alternatives[1].paths);
    act(() => root.unmount());
  });
});
