// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type ModelState } from '../model/project';
import type { HypResult } from '../rengine/hypotheses';
import { hypothesesAnalysis as hy } from './hypotheses';
import type { AnalysisCtx } from './types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const K = (id: string, inds: string[]) => ({
  id,
  name: id,
  type: 'factor' as const,
  mode: 'A' as const,
  indicators: inds,
  x: 0,
  y: 0,
  side: 'left' as const,
});
const model: ModelState = {
  constructs: [K('A', ['a1', 'a2', 'a3']), K('B', ['b1', 'b2', 'b3']), K('C', ['c1', 'c2', 'c3'])],
  paths: [
    { id: 'p', from: 'A', to: 'C', label: 'pa' },
    { id: 'q', from: 'B', to: 'C', label: 'pb' },
  ],
  moderations: [],
};
const names = model.constructs.flatMap((k) => k.indicators).concat('g');
const data = {
  names,
  cols: names.map((n, k) =>
    Float64Array.from({ length: 30 }, (_, i) =>
      n === 'g' ? 1 + (i % 2) : Math.sin(i * (k + 1.3)) + (i % (k + 2)),
    ),
  ),
};
const settings = { ...DEFAULT_SETTINGS, method: 'cbsem' as const, engine: 'r' as const };
const ctx = (over: Partial<AnalysisCtx> = {}): AnalysisCtx => ({
  data,
  info: null,
  settings,
  pls: null,
  projectName: 'p',
  model,
  ...over,
});

describe('the informative hypotheses card', () => {
  it('starts from the model’s labels and validates options from files', () => {
    expect(hy.defaults(ctx())).toEqual({
      text: 'pa > pb',
      method: 'both',
      comparison: 'complement',
      standardized: false,
      fraction: 1,
    });
    expect(
      hy.defaults(
        ctx({ model: { ...model, paths: model.paths.map((p) => ({ ...p, label: undefined })) } }),
      ).text,
    ).toBe('');
    expect(
      hy.parseOptions({
        text: 'pa > 0',
        method: 'nope',
        comparison: 'none',
        standardized: 'yes',
        fraction: '7',
      }),
    ).toEqual({
      text: 'pa > 0',
      method: 'both',
      comparison: 'none',
      standardized: false,
      fraction: 3,
    });
    expect(hy.parseOptions({ text: 5 })).toMatchObject({ text: '', method: 'both', fraction: 1 });
    expect(hy.parseOptions([])).toBeNull();
  });

  it('says why it cannot run', () => {
    const o = hy.defaults(ctx());
    expect(hy.blocked(o, ctx())).toBeNull();
    expect(hy.blocked({ ...o, text: 'pa > pz' }, ctx())).toMatch(/“pz” is not a parameter label/);
    expect(hy.blocked({ ...o, text: 'abs(pa) > abs(pb)' }, ctx())).toMatch(/bain has no abs/);
    expect(hy.blocked({ ...o, text: 'abs(pa) > abs(pb)', method: 'gorica' }, ctx())).toBeNull();
    expect(hy.blocked({ ...o, text: 'pa > pb\npa > 0' }, ctx())).toMatch(
      /complement is for one hypothesis/,
    );
    expect(hy.blocked({ ...o, text: 'pa > pb\npa > 0', method: 'bain' }, ctx())).toBeNull();
    expect(hy.blocked({ ...o, comparison: 'none' }, ctx())).toMatch(/With one hypothesis/);
    expect(
      hy.blocked(
        o,
        ctx({ model: { ...model, paths: model.paths.map((p) => ({ ...p, label: undefined })) } }),
      ),
    ).toMatch(/Label the parameters/);
    expect(
      hy.blocked(
        o,
        ctx({
          model: { ...model, multigroup: { column: 'g', invariance: 'configural', free: [] } },
        }),
      ),
    ).toMatch(/one group here/);
    expect(hy.blocked(o, ctx({ settings: { ...settings, method: 'pls' } }))).toMatch(/CB-SEM/);
    expect(hy.blocked(o, ctx({ settings: { ...settings, estimator: '2SLS' } }))).toMatch(
      /MIIV-2SLS/,
    );
    expect(hy.fingerprint(o, ctx())).not.toBe(hy.fingerprint({ ...o, text: 'pa > 0' }, ctx()));
    expect(hy.fingerprint(o, ctx())).not.toBe(
      hy.fingerprint(o, ctx({ settings: { ...settings, seed: 7 } })),
    );
    expect(hy.summary(o)).toBe('1 hypothesis, Both');
  });

  it('shows the estimates, the GORICA table with its ratios and bain’s table with its matrix', () => {
    const r: HypResult = {
      hypotheses: ['pa > pb', 'pa = pb'],
      estimates: [
        { label: 'pa', what: 'A → C', est: 0.5, se: 0.1 },
        { label: 'pb', what: 'B → C', est: 0.2, se: 0.1 },
      ],
      standardized: true,
      n: 30,
      gorica: {
        models: ['H1', 'H2', 'unconstrained'],
        loglik: [1, 0.5, 1],
        penalty: [1.5, 1, 2],
        gorica: [1, 1, 2],
        weights: [0.4, 0.4, 0.2],
        ratio: [
          [1, 1, 2],
          [1, 1, 2],
          [0.5, 0.5, 1],
        ],
        comparison: 'unconstrained',
      },
      bain: {
        rows: ['H1', 'H2', 'Hu', 'Hc'],
        fit: [0.9, 2, null, 0.1],
        com: [0.5, 1, null, 0.5],
        bfu: [1.8, 2, null, 0.2],
        bfc: [9, 2, null, null],
        pmpa: [0.47, 0.53, null, null],
        pmpb: [0.38, 0.42, 0.2, null],
        pmpc: [0.4, 0.45, null, 0.15],
        matrix: [
          [1, 0.9],
          [1.11, 1],
        ],
        fraction: 1,
      },
      warnings: [],
      engine: { package: 'restriktor', version: '0.6.50' },
    };
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(<hy.View result={r} options={hy.defaults(ctx())} current />));
    const t = host.textContent!;
    for (const s of [
      'Parameters in the hypotheses (standardised)',
      'A → C',
      'GORICA values and weights',
      'H1: pa > pb',
      'Unconstrained',
      'Ratios of the GORICA weights',
      'Bayes factors and posterior model probabilities (bain)',
      'Hc: complement of all',
      'Bayes factors between the hypotheses',
    ])
      expect(t, s).toContain(s);
    act(() =>
      root.render(
        <hy.View
          result={{ ...r, gorica: null, bain: null }}
          options={hy.defaults(ctx())}
          current
        />,
      ),
    );
    expect(host.textContent).not.toContain('GORICA values');
    act(() => root.unmount());
  });
});
