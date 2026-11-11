import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../model/project';
import { glmmRequest } from '../rengine/glmm';
import { glmmAnalysis as glmm, type GlmmOptions } from './glmm';
import type { AnalysisCtx } from './types';

const col = (...v: number[]) => Float64Array.from(v);
const data = {
  names: ['y', 'g', 'x', 'u1', 'u2', 'n'],
  cols: [col(0, 1, 2), col(1, 1, 2), col(0.5, 1, 2), col(0, 1, 3), col(2, 0, 1), col(3, 3, 3)],
};
const ctx: AnalysisCtx = {
  data,
  info: null,
  settings: DEFAULT_SETTINGS,
  pls: null,
  projectName: 'p',
};
const long = (o: Partial<GlmmOptions> = {}): GlmmOptions => ({
  ...glmm.defaults(ctx),
  outcome: 'y',
  cluster: 'g',
  predictors: ['x'],
  ...o,
});

describe('the GLMM card', () => {
  it('reads options from files, keeping only what fits', () => {
    expect(
      glmm.parseOptions({
        outcome: 'y',
        cluster: 'g',
        predictors: ['x'],
        slopes: ['x', 'time', 'z'],
        family: 'gamma',
        quadrature: 99,
        ziRandom: 'yes',
      }),
    ).toEqual({
      layout: 'long',
      outcome: 'y',
      cluster: 'g',
      occasions: [],
      times: [],
      predictors: ['x'],
      categorical: [],
      slopes: ['x'],
      family: 'poisson',
      ziPredictors: [],
      ziRandom: false,
      quadrature: 51,
      robust: false,
    });
    expect(
      glmm.parseOptions({
        layout: 'wide',
        occasions: ['u1', 'u2'],
        times: [0, 'a', 1],
        slopes: ['time'],
        family: 'zip',
        ziPredictors: ['time'],
        ziRandom: true,
        robust: true,
      }),
    ).toMatchObject({
      layout: 'wide',
      occasions: ['u1', 'u2'],
      times: [0, 1],
      slopes: ['time'],
      family: 'zip',
      ziPredictors: ['time'],
      ziRandom: true,
      robust: true,
    });
    expect(glmm.parseOptions('x')).toBeNull();
  });

  it('says why it cannot run', () => {
    expect(glmm.blocked(long({ outcome: '' }), ctx)).toBe(
      'Choose the outcome and the cluster column.',
    );
    expect(glmm.blocked(long({ predictors: ['g'] }), ctx)).toContain('different columns');
    expect(glmm.blocked(long({ categorical: ['x'], slopes: ['x'] }), ctx)).toBe(
      'A random slope needs a numeric predictor.',
    );
    expect(glmm.blocked(long({ predictors: ['zz'] }), ctx)).toBe('Not in the data: zz.');
    expect(glmm.blocked(long(), ctx)).toBeNull();
    const wide = long({ layout: 'wide', occasions: ['u1', 'u2'], predictors: [] });
    expect(glmm.blocked({ ...wide, occasions: ['u1'] }, ctx)).toBe(
      'Choose at least two occasions.',
    );
    expect(glmm.blocked({ ...wide, times: [0, 1, 2] }, ctx)).toBe(
      'Give one time score per occasion.',
    );
    expect(glmm.blocked(wide, ctx)).toBeNull();
  });

  it('sends R the model’s columns and only the options of its family and layout', () => {
    const r = glmmRequest(
      data,
      long({
        family: 'binomial',
        trials: 'n',
        ziPredictors: ['x'],
        ziRandom: true,
        categorical: ['x', 'q'],
      }),
    );
    expect(r).toMatchObject({
      kind: 'glmm',
      layout: 'long',
      outcome: 'y',
      cluster: 'g',
      trials: 'n',
      categorical: ['x'],
      data: { names: ['y', 'g', 'x', 'n'] },
    });
    expect(r).not.toHaveProperty('ziPredictors');
    const w = glmmRequest(
      data,
      long({
        layout: 'wide',
        occasions: ['u1', 'u2'],
        predictors: [],
        family: 'zip',
        ziPredictors: ['time'],
        ziRandom: true,
        trials: 'n',
      }),
    );
    expect(w).toMatchObject({
      layout: 'wide',
      occasions: ['u1', 'u2'],
      times: [0, 1],
      ziPredictors: ['time'],
      ziRandom: true,
      data: { names: ['u1', 'u2'] },
    });
    expect(w).not.toHaveProperty('outcome');
    expect(glmm.fingerprint(long(), ctx)).not.toBe(glmm.fingerprint(long({ predictors: [] }), ctx));
  });
});
