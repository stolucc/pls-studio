// The power analysis card (semPower): options from files, what it needs, the bridge input it builds from the
// options and the canvas model, and its views (numbers from scripts/validation/sempower.R).

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CbResult } from '../engine/cbsem';
import { DEFAULT_SETTINGS, type ModelState } from '../model/project';
import type { PowerResult } from '../rengine/power';
import { powerAnalysis as t, powerInput, powerParams, type PowerOptions } from './power';
import type { AnalysisCtx } from './types';

const F = (name: string, indicators: string[]) => ({
  id: name,
  name,
  type: 'factor' as const,
  mode: 'A' as const,
  indicators,
  x: 0,
  y: 0,
  side: 'left' as const,
});
const model: ModelState = {
  constructs: [F('A', ['a1', 'a2', 'a3']), F('B', ['b1', 'b2', 'b3'])],
  paths: [],
  moderations: [],
  correlations: [{ id: 'k', kind: 'construct', a: 'A', b: 'B' }],
};
const names = ['a1', 'a2', 'a3', 'b1', 'b2', 'b3'];
const data = {
  names,
  cols: names.map((_, k) =>
    Float64Array.from({ length: 50 }, (_, i) => Math.sin(i * (k + 1.3)) + (i % (k + 2))),
  ),
};
const est = (lhs: string, op: '=~' | '~~', rhs: string, se: number | null, label?: string) => ({
  kind: 'loading',
  lhs,
  op,
  rhs,
  est: 0.5,
  se,
  z: null,
  p: null,
  std: 0.5,
  ...(label ? { label } : {}),
});
const cb = {
  n: 50,
  fit: { df: 8 },
  estimates: [
    est('A', '=~', 'a1', null),
    est('A', '=~', 'a2', 0.1),
    est('A', '~~', 'B', 0.05),
    est('B', '=~', 'b2', 0.1, 'l1'),
    { ...est('a1', '~~', 'a1', 0.1), op: '~1' },
  ],
} as unknown as CbResult;
const ctx = (over: Partial<AnalysisCtx> = {}): AnalysisCtx => ({
  data,
  info: null,
  settings: { ...DEFAULT_SETTINGS, method: 'cbsem' },
  pls: null,
  cb,
  projectName: 'p',
  model,
  ...over,
});
const o = (p: Partial<PowerOptions> = {}): PowerOptions => ({
  ...t.defaults(ctx({ cb: null })),
  ...p,
});
const engine = { package: 'semPower', version: '2.2.0' } as PowerResult['engine'];

describe('power analysis card', () => {
  it('starts with the model’s df when the model has results; options from a file are bounded', () => {
    expect(t.defaults(ctx()).dfSource).toBe('model');
    expect(t.defaults(ctx({ cb: null })).dfSource).toBe('manual');
    const p = t.parseOptions({
      analysis: 'parameter',
      measure: 'GFI',
      effect: 5,
      alpha: 0.9,
      power: '0.9',
      n: 1.5,
      param: { lhs: 'A', op: '~~', rhs: 'B' },
      df: '12',
    })!;
    expect(p).toMatchObject({
      analysis: 'parameter',
      measure: 'GFI',
      effect: 0.9999,
      alpha: 0.5,
      power: 0.9,
      n: 2,
      df: 12,
      param: { lhs: 'A', op: '~~', rhs: 'B' },
    });
    expect(
      t.parseOptions({ param: { lhs: 'A', op: 'system(', rhs: 'B' }, analysis: 'nope' }),
    ).toMatchObject({ param: null, analysis: 'apriori' });
    expect(t.parseOptions(null)).toBeNull();
  });

  it('lists free, unlabelled loadings, regressions and covariances as testable parameters', () => {
    expect(powerParams(ctx())).toEqual([
      { lhs: 'A', op: '=~', rhs: 'a2' },
      { lhs: 'A', op: '~~', rhs: 'B' },
    ]);
    expect(powerParams(ctx({ cb: null }))).toEqual([]);
  });

  it('builds the bridge input: the model’s df and observed variables, or the entered ones', () => {
    expect(powerInput(o({ dfSource: 'model', analysis: 'apriori', power: 0.9 }), ctx())).toEqual({
      analysis: 'apriori',
      alpha: 0.05,
      measure: 'RMSEA',
      effect: 0.05,
      df: 8,
      power: 0.9,
    });
    expect(
      powerInput(
        o({ dfSource: 'model', measure: 'AGFI', effect: 0.9, analysis: 'posthoc', n: 300 }),
        ctx(),
      ),
    ).toEqual({
      analysis: 'posthoc',
      alpha: 0.05,
      measure: 'AGFI',
      effect: 0.9,
      df: 8,
      p: 6,
      n: 300,
    });
    expect(
      powerInput(o({ analysis: 'compromise', df: 200, abratio: 2, n: 250 }), ctx()),
    ).toMatchObject({ analysis: 'compromise', df: 200, n: 250, abratio: 2 });
    expect(() => powerInput(o({ dfSource: 'model' }), ctx({ cb: null }))).toThrow(
      /degrees of freedom/,
    );
    expect(
      powerInput(
        o({
          analysis: 'parameter',
          param: { lhs: 'A', op: '~~', rhs: 'B' },
          value: 0.1,
          paramType: 'posthoc',
          n: 80,
        }),
        ctx(),
      ),
    ).toEqual({
      analysis: 'parameter',
      alpha: 0.05,
      type: 'posthoc',
      param: { lhs: 'A', op: '~~', rhs: 'B', value: 0.1 },
      n: 80,
    });
    expect(
      powerInput(
        o({ analysis: 'equivalence', equivSource: 'manual', chisq: 85.3, edf: 24, en: 301 }),
        ctx(),
      ),
    ).toEqual({
      analysis: 'equivalence',
      alpha: 0.05,
      source: 'manual',
      chisq: 85.3,
      df: 24,
      n: 301,
    });
  });

  it('fits the model only when the analysis reads it, and says what it needs', () => {
    expect(
      t.fitsModel instanceof Function &&
        t.fitsModel(o({ analysis: 'apriori', dfSource: 'manual' })),
    ).toBe(false);
    expect(t.fitsModel instanceof Function && t.fitsModel(o({ analysis: 'parameter' }))).toBe(true);
    expect(
      t.fitsModel instanceof Function &&
        t.fitsModel(o({ analysis: 'equivalence', equivSource: 'model' })),
    ).toBe(true);
    expect(
      t.blocked(
        o({ analysis: 'apriori', dfSource: 'manual' }),
        ctx({ data: null, model: undefined }),
      ),
    ).toBeNull();
    expect(t.blocked(o({ analysis: 'parameter' }), ctx())).toMatch(/Choose the parameter/);
    expect(
      t.blocked(
        o({ analysis: 'parameter', param: { lhs: 'A', op: '~~', rhs: 'B' } }),
        ctx({ settings: { ...DEFAULT_SETTINGS, method: 'pls' } }),
      ),
    ).toMatch(/CB-SEM/);
    expect(t.fingerprint(o({ dfSource: 'manual' }), ctx())).toBe(
      t.fingerprint(o({ dfSource: 'manual' }), ctx({ data: null })),
    );
    expect(t.fingerprint(o({ dfSource: 'model' }), ctx())).not.toBe(
      t.fingerprint(o({ dfSource: 'model' }), ctx({ cb: { ...cb, fit: { ...cb.fit, df: 9 } } })),
    );
  });

  it('shows the N needed with its power curve, the parameter’s power, and the equivalence test against adjusted cutoffs', () => {
    const curve = { n: [10, 100, 154, 300], power: [0.1, 0.7, 0.951, 0.999] };
    const a: PowerResult = {
      analysis: 'apriori',
      type: 'apriori',
      alpha: 0.05,
      beta: 0.049,
      power: 0.951,
      n: 154,
      df: 200,
      ncp: 76.5,
      chiCrit: 233.99,
      fmin: 0.5,
      rmsea: 0.05,
      mc: 0.7788,
      curve,
      warnings: [],
      engine,
    };
    const h = renderToStaticMarkup(
      <t.View result={a} options={o({ df: 200, power: 0.95 })} current />,
    );
    expect(h).toContain('N needed: 154');
    expect(h).toContain('aria-label="Power curve"');
    const p: PowerResult = {
      analysis: 'parameter',
      type: 'apriori',
      alpha: 0.05,
      power: 0.805,
      n: 59,
      df: 1,
      ncp: 7.94,
      fmin: 0.13697,
      estimate: 0.408,
      sampleN: 301,
      param: { lhs: 'visual', op: '~~', rhs: 'textual', value: 0 },
      curve,
      warnings: [],
      engine,
    };
    expect(
      renderToStaticMarkup(<t.View result={p} options={o({ analysis: 'parameter' })} current />),
    ).toContain('N needed to detect visual ~~ textual: 59');
    const e: PowerResult = {
      analysis: 'equivalence',
      chisq: 85.31,
      df: 24,
      n: 301,
      rmsea: 0.092,
      rmseaT: 0.1137,
      ncpT: 81,
      cutoffs: [0.048, 0.075, 0.103, 0.122],
      verdict: 'mediocre',
      warnings: [],
      engine,
    };
    const eh = renderToStaticMarkup(
      <t.View result={e} options={o({ analysis: 'equivalence' })} current />,
    );
    expect(eh).toContain('RMSEA equivalence test: mediocre fit');
    expect(eh).toContain('0.103 – 0.122');
  });
});
