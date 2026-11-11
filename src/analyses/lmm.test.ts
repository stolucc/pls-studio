import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../model/project';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { lmmAnalysis as t, lmmLayout, lmmRequestOptions, LmmView } from './lmm';
import { lmmColumns, lmmRequest, type LmmInput, type LmmResult } from '../rengine/mixed';
import type { AnalysisCtx } from './types';

const col = (...v: number[]) => Float64Array.from(v);
const data = {
  names: ['y', 'g', 'x', 'w'],
  cols: [col(1, 2, 3, 4), col(1, 1, 2, 2), col(0, 1, 0, 1), col(3, 3, 3, 3)],
};
const ctx = (over: Partial<AnalysisCtx> = {}): AnalysisCtx => ({
  data,
  info: null,
  settings: DEFAULT_SETTINGS,
  pls: null,
  projectName: 'p',
  ...over,
});
const o = { ...t.defaults(ctx()), outcome: 'y', cluster: 'g', predictors: ['x'], slopes: ['x'] };

describe('multilevel regression card', () => {
  it('validates options from files: random slopes only for predictors', () => {
    expect(
      t.parseOptions({
        outcome: 'y',
        cluster: 'g',
        predictors: ['x'],
        slopes: ['x', 'w'],
        center: 'group',
        estimation: 'ML',
      }),
    ).toEqual({
      outcome: 'y',
      cluster: 'g',
      predictors: ['x'],
      slopes: ['x'],
      center: 'none',
      estimation: 'ML',
    });
    expect(t.parseOptions(null)).toBeNull();
  });

  it('says why it cannot run', () => {
    expect(t.blocked(o, ctx())).toBeNull();
    expect(t.blocked({ ...o, cluster: '' }, ctx())).toBe(
      'Choose the outcome and the cluster column.',
    );
    expect(t.blocked({ ...o, predictors: ['g'] }, ctx())).toContain('must be different');
    expect(t.blocked({ ...o, predictors: ['q'] }, ctx())).toBe('Not in the data: q.');
    expect(t.blocked(o, ctx({ data: null }))).toContain('needs raw data');
  });

  it('is stale when its columns change, not others', () => {
    const f = t.fingerprint(o, ctx());
    expect(
      t.fingerprint(
        o,
        ctx({ data: { ...data, cols: [...data.cols.slice(0, 3), col(9, 9, 9, 9)] } }),
      ),
    ).toBe(f);
    expect(
      t.fingerprint(
        o,
        ctx({ data: { ...data, cols: [data.cols[0], col(1, 2, 2, 2), ...data.cols.slice(2)] } }),
      ),
    ).not.toBe(f);
  });

  it('keeps older saved options unchanged: no further options appear, and the request is the old one', () => {
    const old = {
      outcome: 'y',
      cluster: 'g',
      predictors: ['x'],
      slopes: ['x'],
      center: 'none',
      estimation: 'REML',
    };
    expect(t.parseOptions(old)).toEqual(old);
    expect(lmmRequestOptions(t.parseOptions(old)!)).toEqual(old);
    expect(Object.keys(lmmRequest(data, t.parseOptions(old)!)).sort()).toEqual([
      'center',
      'cluster',
      'data',
      'estimation',
      'outcome',
      'predictors',
      'slopes',
    ]);
    expect(lmmRequest(data, o).data.names).toEqual(['y', 'g', 'x']);
    // (empty further options are left out of the request too)
    expect(
      lmmRequestOptions({ ...o, interactions: [], levels: [], independent: [], outcomes: [] }),
    ).toEqual(o);
  });

  it('reads the further options from files: wide data, levels, outcomes, interactions, uncorrelated slopes, MLR', () => {
    const wide = t.parseOptions({
      outcome: 'y',
      cluster: '',
      predictors: ['time', 'a', 'x'],
      slopes: ['time', 'a', 'zz'],
      center: 'none',
      estimation: 'ML',
      interactions: [['time', 'x'], ['a'], 'bad'],
      independent: ['a'],
      residuals: 'occasion',
      se: 'robust',
      levels: [{ cluster: 'g', slopes: ['time', 'q'], occasions: true }, 'bad'],
      repeated: {
        measures: ['y1', 'y2'],
        times: [0, 'x', 1],
        time: 'time',
        varying: [{ name: 'a', columns: ['a1', 'a2'] }],
      },
    })!;
    expect(wide).toEqual({
      outcome: 'y',
      cluster: '',
      predictors: ['time', 'a', 'x'],
      slopes: ['time', 'a'],
      center: 'none',
      estimation: 'ML',
      interactions: [['time', 'x']],
      independent: ['a'],
      levels: [{ cluster: 'g', slopes: ['time'], occasions: true }],
      repeated: {
        measures: ['y1', 'y2'],
        times: [0, 1],
        time: 'time',
        varying: [{ name: 'a', columns: ['a1', 'a2'] }],
      },
      residuals: 'occasion',
      se: 'robust',
    });
    expect(lmmLayout(wide)).toBe('wide');
    // (the data columns: the measures and the covariates' columns, not the names the long data create)
    expect(lmmColumns(wide)).toEqual(['y1', 'y2', 'a1', 'a2', 'x', 'g']);
    expect(t.parseOptions({ ...o, residuals: 'sometimes', se: 'sandwich' })).toEqual(o);
    const two = t.parseOptions({
      ...o,
      outcomes: [{ outcome: 'w', predictors: ['x'], slopes: ['x', 'q'] }],
    })!;
    expect(two.outcomes).toEqual([{ outcome: 'w', predictors: ['x'], slopes: ['x'] }]);
    expect(lmmLayout(two)).toBe('stacked');
    expect(lmmColumns(two)).toEqual(['y', 'x', 'w', 'g']);
  });

  it('fills the time scores 0, 1, 2, … when none are given', () => {
    const wide: LmmInput = {
      ...o,
      cluster: '',
      predictors: ['time'],
      slopes: [],
      repeated: { measures: ['y', 'w', 'x'], times: [], time: 'time', varying: [] },
      outcome: 'z',
    };
    expect(lmmRequestOptions(wide).repeated!.times).toEqual([0, 1, 2]);
  });

  it('says why the further options cannot run', () => {
    expect(t.blocked({ ...o, se: 'robust' }, ctx())).toBe(
      'Robust standard errors (Mplus’s MLR) go with ML estimation.',
    );
    expect(t.blocked({ ...o, se: 'robust', estimation: 'ML' }, ctx())).toBeNull();
    expect(t.blocked({ ...o, residuals: 'occasion' }, ctx())).toBe(
      'A residual variance per occasion needs repeated measures in columns.',
    );
    expect(t.blocked({ ...o, levels: [{ cluster: '', slopes: [] }] }, ctx())).toBe(
      'Choose the cluster column of every level.',
    );
    expect(t.blocked({ ...o, levels: [{ cluster: 'g', slopes: [] }] }, ctx())).toBe(
      'Each level needs its own cluster column.',
    );
    expect(t.blocked({ ...o, levels: [{ cluster: 'w', slopes: [] }] }, ctx())).toBeNull();
    expect(
      t.blocked({ ...o, center: 'cluster', levels: [{ cluster: 'w', slopes: [] }] }, ctx()),
    ).toContain('Centring is available');
    expect(t.blocked({ ...o, interactions: [['x', 'q']] }, ctx())).toBe(
      'An interaction term needs two or more of the predictors.',
    );
    const wide: LmmInput = {
      ...o,
      outcome: 'z',
      cluster: '',
      predictors: ['time', 'a'],
      slopes: ['time'],
      repeated: {
        measures: ['y', 'w'],
        times: [0, 1],
        time: 'time',
        varying: [{ name: 'a', columns: ['x', 'g'] }],
      },
    };
    expect(t.blocked(wide, ctx())).toBeNull();
    expect(t.blocked({ ...wide, cluster: 'g' }, ctx())).toContain('each row is a person');
    expect(t.blocked({ ...wide, repeated: { ...wide.repeated!, times: [0] } }, ctx())).toBe(
      'Give one time score per occasion (2).',
    );
    expect(
      t.blocked(
        { ...wide, repeated: { ...wide.repeated!, varying: [{ name: 'a', columns: ['x'] }] } },
        ctx(),
      ),
    ).toBe('The time-varying covariate a needs one column per occasion (2).');
    expect(t.blocked({ ...wide, predictors: [], slopes: [], outcome: 'time' }, ctx())).toBe(
      'The outcome, the time and the time-varying covariates need different names.',
    );
    expect(t.blocked({ ...wide, outcome: 'x' }, ctx())).toBe(
      'The outcome, the time and the time-varying covariates need names that are not columns in the model.',
    );
    expect(t.blocked({ ...wide, outcome: '' }, ctx())).toBe('Name the outcome.');
    expect(t.blocked({ ...wide, levels: [{ cluster: 'q', slopes: [] }] }, ctx())).toBe(
      'Not in the data: q.',
    );
    const two: LmmInput = { ...o, outcomes: [{ outcome: '', predictors: [], slopes: [] }] };
    expect(t.blocked(two, ctx())).toBe('Choose outcome 2.');
    expect(
      t.blocked({ ...two, outcomes: [{ outcome: 'y', predictors: [], slopes: [] }] }, ctx()),
    ).toBe('Each outcome must be a different column.');
    expect(
      t.blocked({ ...two, outcomes: [{ outcome: 'w', predictors: ['x'], slopes: [] }] }, ctx()),
    ).toBeNull();
    expect(
      t.blocked(
        {
          ...two,
          outcomes: [{ outcome: 'w', predictors: ['x'], slopes: [] }],
          levels: [{ cluster: 'w', slopes: [] }],
        },
        ctx(),
      ),
    ).toContain('one cluster level');
    expect(
      t.blocked({ ...wide, outcomes: [{ outcome: 'w', predictors: [], slopes: [] }] }, ctx()),
    ).toBe('Repeated measures in columns and several outcomes are alternatives.');
  });

  it('summarises the levels, outcomes and MLR', () => {
    expect(t.summary!(o)).toBe('x → y | g (random slope) · REML');
    expect(
      t.summary!({
        ...o,
        estimation: 'ML',
        se: 'robust',
        levels: [{ cluster: 'w', slopes: ['x'] }],
      }),
    ).toBe('x → y | g in w (random slopes) · ML, MLR');
    expect(t.summary!({ ...o, outcomes: [{ outcome: 'w', predictors: [], slopes: [] }] })).toBe(
      'x → y, w | g (random slope) · REML',
    );
  });

  it('shows the levels, robust standard errors of the variance components, residual variances per occasion and the free parameters', () => {
    const fixed = {
      term: 'Intercept',
      est: 0.46,
      se: 0.051,
      df: null,
      t: 9,
      p: 0,
      ciLow: 0.36,
      ciHigh: 0.56,
    };
    const r: LmmResult = {
      n: 2000,
      clusters: 500,
      reml: false,
      icc: null,
      fixed: [fixed],
      random: [
        { group: 'Person', a: 'Intercept', b: null, variance: 0.87, sd: 0.93, se: 0.082 },
        { group: 'Person', a: 'Intercept', b: 'a1', variance: 0.025, sd: 0.06, se: 0.032 },
        { group: 'Residual', a: 'y1', b: null, variance: 0.468, sd: 0.68, se: 0.064 },
      ],
      r2: null,
      logLik: -3166.918,
      aic: 6361.835,
      bic: 6420.84,
      singular: false,
      slopeTest: null,
      lines: null,
      warnings: [],
      engine: { package: 'nlme', version: '3.1' },
      levels: [{ name: 'Person', units: 500 }],
      npar: 14,
      cases: 500,
      robust: true,
    };
    const html = renderToStaticMarkup(createElement(LmmView, { r }));
    expect(html).toContain('Units: Person');
    expect(html).toContain('Robust standard errors as Mplus’s MLR');
    expect(html).toContain('Residual (y1)');
    expect(html).toContain('Intercept ↔ a1 (across Person)');
    expect(html).toContain('Std. error');
    expect(html).toContain('0.082');
    expect(html).toContain('Free parameters');
    expect(html).toContain('BIC with the number of cases (500)');
    expect(html).not.toContain('ICC');
    // (an older result: Satterthwaite tests, no standard errors of the variances)
    const old = renderToStaticMarkup(
      createElement(LmmView, {
        r: {
          ...r,
          fixed: [{ ...fixed, df: 17 }],
          random: r.random.map(({ se: _s, ...x }) => x),
          icc: 0.5,
          r2: { marginal: 0.2, conditional: 0.7 },
          robust: undefined,
          levels: undefined,
          npar: undefined,
          cases: undefined,
          engine: { package: 'lme4', version: '2' },
        },
      }),
    );
    expect(old).toContain('Satterthwaite');
    expect(old).toContain('<th>SD / correlation</th></tr>');
    expect(old).toContain('ICC (empty model)');
  });
});
