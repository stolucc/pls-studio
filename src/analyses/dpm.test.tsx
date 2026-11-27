// The dynamic panel card (dpm.tsx): its options, what blocks it and its tables. The model itself:
// examples/cards/dpm.webr.test.ts against the dpm package.

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../model/project';
import type { DpmResult } from '../rengine/dpm';
import { dpmAnalysis as dpm, dpmInput } from './dpm';
import type { AnalysisCtx } from './types';

const col = (...v: number[]) => Float64Array.from(v);
const names = ['y1', 'y2', 'y3', 'x1', 'x2', 'x3', 'z'];
const ctx: AnalysisCtx = {
  data: { names, cols: names.map(() => col(1, 2, 3)) },
  info: null,
  settings: { ...DEFAULT_SETTINGS, estimator: 'MLR', missing: 'fiml' },
  pls: null,
  projectName: 'p',
};
const o = {
  y: ['y1', 'y2', 'y3'],
  x: [{ waves: ['x1', 'x2', 'x3'], predetermined: true }],
  constant: ['z'],
  equalErrors: true,
};

describe('dynamic panel card', () => {
  it('keeps its options, takes the estimator from the settings and says what is missing', () => {
    expect(dpm.parseOptions(o)).toEqual(o);
    expect(dpm.parseOptions({ ...o, x: [{ waves: ['x1'] }, 'junk'] })!.x).toEqual([
      { waves: ['x1'], predetermined: false },
    ]);
    expect(dpmInput(o, ctx)).toMatchObject({ estimator: 'MLR', missing: 'fiml' });
    expect(dpm.blocked!(o, ctx)).toBeNull();
    expect(dpm.blocked!({ ...o, y: ['y1', 'y2'] }, ctx)).toMatch(/three or more waves/);
    expect(dpm.blocked!({ ...o, x: [{ waves: ['x1'], predetermined: false }] }, ctx)).toMatch(
      /same waves/,
    );
    expect(dpm.blocked!({ ...o, constant: ['y1'] }, ctx)).toMatch(/used twice/);
    expect(dpm.fingerprint(o, ctx)).not.toBe(
      dpm.fingerprint({ ...o, x: [{ ...o.x[0], predetermined: false }] }, ctx),
    );
    expect(dpm.summary!(o)).toBe('3 waves · 1 time-varying predictor · equal errors');
  });

  it('shows the effects and the variances', () => {
    const r: DpmResult = {
      n: 100,
      waves: 3,
      fit: { chisq: 10, df: 5, cfi: 0.99, rmsea: 0.03 },
      coefficients: [
        { name: 'y (previous wave)', est: 0.2, se: 0.05, z: 4, p: 0.0001 },
        { name: 'x (previous wave)', est: -1.2, se: 0.5, z: -2.4, p: 0.016 },
      ],
      alphaVariance: { est: 4.4, se: 0.5 },
      errorVariance: { name: 'error variance', est: 20, se: 1, z: 20, p: 0 },
      warnings: [],
      engine: { package: 'lavaan', version: '0.7-3' },
    };
    const html = renderToStaticMarkup(<dpm.View result={r} options={o} current />);
    expect(html).toContain('Effects (equal over waves)');
    expect(html).toContain('x (previous wave)');
    expect(html).toContain('Fixed effect (alpha)');
    expect(html).toContain('Error variance (every wave)');
  });
});
