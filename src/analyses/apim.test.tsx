// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../model/project';
import type { ApimEstimate, ApimResult } from '../rengine/apim';
import { apimAnalysis as ap, apimInput, type ApimOptions } from './apim';
import type { AnalysisCtx } from './types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const names = ['x1', 'x2', 'y1', 'y2'];
const data = {
  names,
  cols: names.map((_, k) => Float64Array.from({ length: 30 }, (_, i) => Math.sin(i * (k + 1.3)))),
};
const ctx = (over: Partial<AnalysisCtx> = {}): AnalysisCtx => ({
  data,
  info: null,
  settings: DEFAULT_SETTINGS,
  pls: null,
  projectName: 'p',
  ...over,
});
const O: ApimOptions = {
  x1: ['x1'],
  x2: ['x2'],
  y1: ['y1'],
  y2: ['y2'],
  dyads: 'distinguishable',
  bootstrap: false,
};

const est = (label: string, v: number): ApimEstimate => ({
  label,
  est: v,
  se: 0.1,
  z: v / 0.1,
  p: 0.01,
  low: v - 0.2,
  high: v + 0.2,
  std: v / 2,
  bootLow: v - 0.25,
  bootHigh: v + 0.25,
});
const fit = { chisq: 10, df: 6, pvalue: 0.12, cfi: 0.99, rmsea: 0.04, srmr: 0.02 };

describe('the APIM card', () => {
  it('validates options from files', () => {
    expect(
      ap.parseOptions({
        x1: ['a', 'a', 3],
        x2: 'b',
        y1: [],
        y2: ['d'],
        dyads: 'twins',
        bootstrap: 1,
      }),
    ).toEqual({ x1: ['a'], x2: [], y1: [], y2: ['d'], dyads: 'distinguishable', bootstrap: false });
    expect(ap.parseOptions({ dyads: 'indistinguishable', bootstrap: true })).toMatchObject({
      dyads: 'indistinguishable',
      bootstrap: true,
    });
    expect(ap.parseOptions('x')).toBeNull();
  });

  it('says why it cannot run, and takes the estimator, missing values and bootstrap from the Model settings', () => {
    expect(ap.blocked(O, ctx())).toBeNull();
    expect(ap.blocked({ ...O, y2: [] }, ctx())).toMatch(/Choose the columns/);
    expect(ap.blocked({ ...O, y2: ['zz'] }, ctx())).toMatch(/Not in the data: zz/);
    expect(apimInput(O, ctx())).toEqual({
      x1: ['x1'],
      x2: ['x2'],
      y1: ['y1'],
      y2: ['y2'],
      dyads: 'distinguishable',
      estimator: 'ML',
      missing: 'casewise',
    });
    const s = {
      ...DEFAULT_SETTINGS,
      estimator: 'MLR' as const,
      missing: 'fiml' as const,
      bootSamples: 10,
      seed: 7,
      confidence: 0.9,
    };
    expect(apimInput({ ...O, bootstrap: true }, { settings: s })).toMatchObject({
      estimator: 'MLR',
      missing: 'fiml',
      boot: { samples: 50, seed: 7, level: 0.9 },
    });
    expect(ap.fingerprint(O, ctx())).not.toBe(
      ap.fingerprint({ ...O, dyads: 'indistinguishable' }, ctx()),
    );
    expect(ap.summary({ ...O, bootstrap: true })).toBe('distinguishable dyads, bootstrap');
  });

  it('shows the effects, k with its patterns, nonindependence and the test of distinguishability', () => {
    const r: ApimResult = {
      n: 100,
      dyads: 'indistinguishable',
      latent: { x: false, y: true },
      effects: [est('a', 0.5), est('p', 0.4)],
      k: [{ ...est('k', 0.8), bootLow: 0.3, bootHigh: 1.2 }],
      xCor: { est: 0.3, se: 0.1, p: 0.01, std: 0.4 },
      yCor: { est: 0.2, se: 0.1, p: 0.04, std: 0.25 },
      fit,
      distFit: { ...fit, chisq: 0, df: 0 },
      indistFit: fit,
      test: { chisqDiff: 10, dfDiff: 6, p: 0.12 },
      level: 0.95,
      boot: 1000,
      warnings: [],
      engine: { package: 'lavaan', version: '0.7.3' },
    };
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(<ap.View result={r} options={O} current />));
    const t = host.textContent!;
    for (const s of [
      'Actor and partner effects (indistinguishable dyads)',
      'Actor (both members)',
      '95% bootstrap CI',
      'couple (k = 1)',
      'Y1 ↔ Y2 (residuals)',
      'Test of distinguishability',
      'Not significant',
    ])
      expect(t, s).toContain(s);
    expect(t).not.toContain('actor-only (k = 0)');
    act(() => root.unmount());
  });
});
