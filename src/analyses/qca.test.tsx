// The fuzzy-set QCA card: options from files (strict, old-safe), what blocks a run, the fingerprint, the starting
// calibration, the request, and the view. (Its results: src/examples/cards/qca.webr.test.ts.)

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../model/project';
import { caseLabels, qcaFormula, qcaRequest, type QcaResult } from '../rengine/qca';
import {
  calibrationProblem,
  defaultCalibration,
  qcaAnalysis as t,
  qcaSpec,
  quantile7,
  type QcaOptions,
} from './qca';
import type { AnalysisCtx } from './types';

const data = {
  names: ['dev', 'urb', 'surv', 'gdp', 'country'],
  cols: [
    Float64Array.from([0.1, 0.9, 0.5, 1]),
    Float64Array.from([0, 1, 1, 0]),
    Float64Array.from([0.2, 0.8, 0.6, 0.9]),
    Float64Array.from([300, 900, 650, 1200]),
    Float64Array.from([1, 2, 3, 4]),
  ],
  categories: { country: ['A', 'B', 'C', 'D'] },
};
const ctx = (over: Partial<AnalysisCtx> = {}): AnalysisCtx => ({
  data,
  info: null,
  settings: DEFAULT_SETTINGS,
  pls: null,
  projectName: 'p',
  ...over,
});
const o: QcaOptions = { ...t.defaults(ctx()), outcome: 'surv', conditions: ['dev', 'urb'] };

describe('fsQCA card', () => {
  it('validates options from files, keeping old ones and filling what is missing', () => {
    expect(t.parseOptions(null)).toBeNull();
    expect(t.parseOptions({ outcome: 'surv', conditions: ['dev', 'dev', 3] })).toEqual({
      ...t.defaults(ctx()),
      outcome: 'surv',
      conditions: ['dev'],
    });
    expect(
      t.parseOptions({
        source: 'evil',
        outcome: 4,
        conditions: 'x',
        negate: 'yes',
        nCut: 0,
        inclCut: 7,
        priCut: -1,
        sortBy: 'cases',
        plot: 'all',
        labels: 9,
        calibration: {
          gdp: { method: 'direct', e: 300, c: 650, i: 1200 },
          dev: { method: 'none' },
          bad: { method: 'direct', e: 'a' },
          worse: 3,
        },
        dirExp: { dev: '1', urb: 'maybe', x: '-' },
      }),
    ).toEqual({
      source: 'data',
      outcome: '',
      conditions: [],
      negate: false,
      nCut: 1,
      inclCut: 1,
      priCut: 0,
      sortBy: 'OUT, incl',
      plot: 'parsimonious',
      labels: '',
      calibration: { gdp: { method: 'direct', e: 300, c: 650, i: 1200 }, dev: { method: 'none' } },
      dirExp: { dev: '1', x: '-' },
    });
    expect(
      t.parseOptions({
        source: 'scores',
        outcome: 'a',
        conditions: ['b'],
        negate: true,
        nCut: 2.4,
        inclCut: 0.75,
        priCut: 0.5,
        sortBy: 'incl, n',
        plot: 'complex',
      }),
    ).toMatchObject({
      source: 'scores',
      negate: true,
      nCut: 2,
      inclCut: 0.75,
      priCut: 0.5,
      sortBy: 'incl, n',
      plot: 'complex',
    });
  });

  it('says why it cannot run', () => {
    expect(t.blocked(o, ctx())).toBeNull();
    expect(t.blocked({ ...o, outcome: '' }, ctx())).toBe('Choose the outcome.');
    expect(t.blocked({ ...o, conditions: [] }, ctx())).toBe('Choose at least one condition.');
    expect(t.blocked({ ...o, conditions: ['q'] }, ctx())).toBe('Not in the data: q.');
    expect(t.blocked({ ...o, conditions: ['dev', 'surv'] }, ctx())).toBe(
      'The outcome cannot also be a condition.',
    );
    expect(
      t.blocked({ ...o, conditions: Array.from({ length: 13 }, (_, i) => `c${i}`) }, ctx()),
    ).toMatch(/At most 12 conditions/);
    expect(t.blocked(o, ctx({ data: null }))).toContain('needs raw data');
    expect(
      t.blocked(
        o,
        ctx({
          data: {
            names: ['x', 'y'],
            cols: [],
            moments: {
              S: [
                [1, 0],
                [0, 1],
              ],
              n: 10,
            },
          },
        }),
      ),
    ).toContain('needs raw data');
    expect(t.blocked({ ...o, source: 'scores' }, ctx())).toContain(
      'Calculate a PLS-SEM model first',
    );
    // (a column outside 0–1 must be calibrated; anchors must be ordered)
    expect(t.blocked({ ...o, conditions: ['gdp'] }, ctx())).toBe(
      'gdp is not calibrated (values outside 0–1): choose the direct method and set its anchors.',
    );
    expect(
      t.blocked(
        {
          ...o,
          conditions: ['gdp'],
          calibration: { gdp: { method: 'direct', e: 300, c: 650, i: 1200 } },
        },
        ctx(),
      ),
    ).toBeNull();
    expect(
      t.blocked(
        {
          ...o,
          conditions: ['gdp'],
          calibration: { gdp: { method: 'direct', e: 1200, c: 650, i: 300 } },
        },
        ctx(),
      ),
    ).toBeNull();
    expect(
      t.blocked(
        {
          ...o,
          conditions: ['gdp'],
          calibration: { gdp: { method: 'direct', e: 300, c: 1200, i: 650 } },
        },
        ctx(),
      ),
    ).toMatch(/anchors of gdp must be in order/);
    expect(t.blocked({ ...o, labels: 'gdp' }, ctx())).toMatch(/gdp is not a text column/);
    expect(t.blocked({ ...o, labels: 'country' }, ctx())).toBeNull();
  });

  it('starts a column as it is when within 0–1, else at its 5th, 50th and 95th percentiles (R type 7)', () => {
    expect(quantile7([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile7([300, 650, 900, 1200], 0.05)).toBeCloseTo(352.5, 10);
    expect(defaultCalibration(data, 'dev')).toEqual({ method: 'none' });
    expect(defaultCalibration(data, 'gdp')).toEqual({
      method: 'direct',
      e: 352.5,
      c: 775,
      i: 1155,
    });
    expect(calibrationProblem(data, 'nope', undefined)).toBe('nope has no values.');
    expect(calibrationProblem(data, 'gdp', { method: 'direct', e: NaN, c: 1, i: 2 })).toBe(
      'Set the three anchors of gdp.',
    );
  });

  it('fingerprints the columns it uses and the analysis options, not the plot', () => {
    const f = t.fingerprint(o, ctx());
    expect(f).toBeTruthy();
    expect(t.fingerprint({ ...o, plot: 'complex' }, ctx())).toBe(f);
    expect(
      t.fingerprint(
        o,
        ctx({
          data: {
            ...data,
            cols: [
              data.cols[0],
              data.cols[1],
              data.cols[2],
              Float64Array.from([1, 1, 1, 1]),
              data.cols[4],
            ],
          },
        }),
      ),
    ).toBe(f);
    expect(
      t.fingerprint(
        o,
        ctx({
          data: { ...data, cols: [Float64Array.from([0.2, 0.9, 0.5, 1]), ...data.cols.slice(1)] },
        }),
      ),
    ).not.toBe(f);
    expect(t.fingerprint({ ...o, inclCut: 0.9 }, ctx())).not.toBe(f);
    expect(t.fingerprint({ ...o, negate: true }, ctx())).not.toBe(f);
    expect(t.fingerprint({ ...o, dirExp: { dev: '1' } }, ctx())).not.toBe(f);
    expect(
      t.fingerprint(
        { ...o, calibration: { dev: { method: 'direct', e: 0, c: 0.5, i: 1 } } },
        ctx(),
      ),
    ).not.toBe(f);
    expect(t.fingerprint({ ...o, source: 'scores' }, ctx())).toBeNull();
    expect(t.display).toEqual(['plot']);
  });

  it('builds the request from the options: expectations in condition order, labels from a text column', () => {
    const s = qcaSpec({
      ...o,
      dirExp: { urb: '0', other: '1' },
      labels: 'country',
      calibration: { dev: { method: 'none' }, zzz: { method: 'none' } },
    });
    expect(s).toEqual({
      outcome: 'surv',
      conditions: ['dev', 'urb'],
      negate: false,
      calibration: { surv: { method: 'none' }, dev: { method: 'none' }, urb: { method: 'none' } },
      nCut: 1,
      inclCut: 0.8,
      priCut: 0,
      sortBy: 'OUT, incl',
      dirExp: ['-', '0'],
      labels: 'country',
    });
    const req = qcaRequest(data, s);
    expect(req.data.names).toEqual(['dev', 'urb', 'surv']);
    expect(req.labels).toEqual(['A', 'B', 'C', 'D']);
    expect(req.dirExp).toEqual(['-', '0']);
    expect(caseLabels(data, 'gdp')).toBeNull();
    expect(qcaSpec({ ...o, source: 'scores', labels: 'country' }).labels).toBeUndefined();
    expect(() => qcaRequest({ names: ['a'], cols: [], moments: { S: [[1]], n: 5 } }, s)).toThrow(
      /covariance matrix/,
    );
  });

  it('renders the tables, the formulas as QCA prints them, and the model-ambiguity note', () => {
    const model = (label: string, terms: string[], inclS: number, covS: number) => ({
      label,
      terms: terms.map((term) => ({
        term,
        inclS: 0.9,
        PRI: 0.8,
        covS: 0.4,
        covU: 0.1,
        cases: '1,2',
      })),
      inclS,
      PRI: 0.8,
      covS,
      membership: [0.2, 0.8, 0.5, 0.9],
    });
    const r: QcaResult = {
      outcome: 'surv',
      negated: true,
      conditions: ['dev', 'urb'],
      n: 4,
      labels: ['A', 'B', 'C', 'D'],
      calibration: [
        {
          variable: 'dev',
          method: 'direct',
          e: 1,
          c: 2,
          i: 3,
          min: 0.05,
          max: 0.95,
          above: 2,
          crisp: false,
        },
        { variable: 'surv', method: 'none', min: 0, max: 1, above: 2, crisp: true },
      ],
      necessity: [
        { condition: 'dev', inclN: 0.95, RoN: 0.6, covN: 0.7 },
        { condition: '~dev', inclN: 0.3, RoN: 0.9, covN: 0.4 },
      ],
      truthTable: {
        rows: [
          { id: '4', values: [1, 1], out: '1', n: 2, incl: 0.91, pri: 0.85, cases: 'B,D' },
          { id: '1', values: [0, 0], out: '?', n: 0, incl: null, pri: null, cases: '' },
        ],
        remainders: 2,
        nCut: 1,
        inclCut: 0.8,
        priCut: 0,
        sortBy: 'OUT, incl',
        counts: { out1: 1, out0: 1, contradictions: 0 },
      },
      expectations: ['1', '-'],
      solutions: {
        complex: {
          kind: 'complex',
          models: [model('M1', ['dev*urb'], 0.91, 0.5)],
          essential: ['dev*urb'],
          counterfactuals: 0,
        },
        parsimonious: {
          kind: 'parsimonious',
          models: [model('M1', ['dev'], 0.9, 0.7), model('M2', ['urb'], 0.9, 0.7)],
          essential: [],
          counterfactuals: 2,
        },
        intermediate: {
          kind: 'intermediate',
          models: [model('C1P1 M1', ['dev*urb'], 0.91, 0.5)],
          essential: [],
          counterfactuals: 1,
        },
      },
      outcomeValues: [0.1, 0.9, 0.4, 0.8],
      warnings: [],
      engine: { package: 'QCA', version: '3.25' },
    };
    expect(qcaFormula(r.solutions.parsimonious!.models[0], 'surv', true)).toBe('dev -> ~surv');
    const html = renderToStaticMarkup(
      <t.View result={r} options={{ ...o, plot: 'parsimonious' }} current />,
    );
    expect(html).toContain('Conservative (complex) solution: dev*urb -&gt; ~surv');
    expect(html).toContain('Parsimonious solution (M1): dev -&gt; ~surv');
    expect(html).toContain('Model ambiguity: QCA reports 2 models');
    expect(html).toContain('Essential prime implicants: dev*urb');
    expect(html).toContain('Analysis of necessity for ~surv');
    expect(html).toContain('Truth table for ~surv');
    expect(html).toContain('2 remainders');
    expect(html).toContain('Direct (logistic)');
    expect(html).toContain('Crisp set as given');
    expect(html).toContain('dev: present, urb: –; 1 easy counterfactuals');
    expect(html).toContain('Intermediate solution: dev*urb -&gt; ~surv');
    expect((html.match(/<svg class="mc-chart"/g) ?? []).length).toBe(2);
    // (a minimisation QCA refused: said so; no expectations: the intermediate solution is not reported, and the hint says so)
    const failed = renderToStaticMarkup(
      <t.View
        result={{ ...r, solutions: { ...r.solutions, intermediate: null } }}
        options={o}
        current
      />,
    );
    expect(failed).toContain('Intermediate solution: QCA could not minimise');
    const none = renderToStaticMarkup(
      <t.View
        result={{
          ...r,
          expectations: ['-', '-'],
          solutions: { ...r.solutions, intermediate: null },
        }}
        options={o}
        current
      />,
    );
    expect(none).toContain('give a directional expectation');
    expect(t.summary({ ...o, negate: true, priCut: 0.5 })).toBe(
      'dev, urb → ~surv · incl ≥ 0.8, n ≥ 1, PRI ≥ 0.5',
    );
    expect(t.summary(t.defaults(ctx()))).toBe('not set up yet');
  });
});
