// The ROC card without R: options from files, why it cannot run, staleness, the request it sends, and what the view
// shows.

import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../model/project';
import { rocColumns, rocRequest, type RocResult } from '../rengine/roc';
import { rocAnalysis as roc, rocInput, type RocOptions } from './roc';
import type { AnalysisCtx } from './types';

const col = (...v: number[]) => Float64Array.from(v);
const data = {
  names: ['outcome', 's100b', 'wfns', 'gender', 'age', 'three'],
  cols: [
    col(1, 2, 1, 2),
    col(0.1, 0.5, 0.2, 0.4),
    col(1, 5, 2, 4),
    col(1, 1, 2, 2),
    col(30, 40, 50, 60),
    col(1, 2, 3, 1),
  ],
  categories: { outcome: ['Good', 'Poor'] },
};
const ctx: AnalysisCtx = {
  data,
  info: null,
  settings: DEFAULT_SETTINGS,
  pls: null,
  projectName: 'p',
};
const base: RocOptions = { ...roc.defaults(ctx), response: 'outcome', predictor: 's100b' };

describe('the ROC card', () => {
  it('validates saved options strictly', () => {
    expect(
      roc.parseOptions({
        response: 'outcome',
        positive: '2',
        direction: 'up',
        bootN: 5,
        paucFrom: -1,
        paucTo: '0.9',
        compare: 'paired',
        predictors: ['a', 1],
      }),
    ).toEqual({
      ...roc.defaults(ctx),
      response: 'outcome',
      bootN: 100,
      paucFrom: 0,
      paucTo: 0.9,
      compare: 'paired',
      predictors: ['a'],
    });
    expect(roc.parseOptions({ positive: 2, ciMethod: 'bootstrap' })).toMatchObject({
      positive: 2,
      ciMethod: 'bootstrap',
    });
    expect(roc.parseOptions(7)).toBeNull();
  });

  it('says why it cannot run', () => {
    expect(roc.blocked(roc.defaults(ctx), ctx)).toBe('Choose the outcome.');
    expect(roc.blocked(base, ctx)).toBeNull();
    expect(roc.blocked({ ...base, predictor: 'outcome' }, ctx)).toBe(
      'The predictor cannot be the outcome.',
    );
    expect(roc.blocked({ ...base, response: 'three' }, ctx)).toBe(
      'The outcome three must have exactly two values.',
    );
    expect(roc.blocked({ ...base, positive: 3 }, ctx)).toBe('3 is not a value of outcome.');
    expect(roc.blocked({ ...base, compare: 'paired' }, ctx)).toBe('Choose the second predictor.');
    expect(roc.blocked({ ...base, compare: 'groups', group: 's100b' }, ctx)).toContain(
      'another column',
    );
    expect(roc.blocked({ ...base, pauc: true, paucFrom: 0.9, paucTo: 0.8 }, ctx)).toContain(
      'low to high',
    );
    expect(roc.blocked({ ...base, source: 'logistic' }, ctx)).toContain('predictors');
    expect(roc.blocked({ ...base, predictor: 'nope' }, ctx)).toBe('Not in the data: nope.');
  });

  it('is stale when the predictor, the interval or the seed change', () => {
    const fp = roc.fingerprint(base, ctx);
    expect(roc.fingerprint({ ...base, predictor: 'wfns' }, ctx)).not.toBe(fp);
    expect(roc.fingerprint({ ...base, ciMethod: 'bootstrap' }, ctx)).not.toBe(fp);
    const seeded = { ...ctx, settings: { ...DEFAULT_SETTINGS, seed: 99 } };
    expect(roc.fingerprint(base, seeded)).not.toBe(fp);
    expect(roc.summary({ ...base, compare: 'paired', predictor2: 'wfns', pauc: true })).toBe(
      's100b for outcome · DeLong · vs wfns · partial AUC',
    );
  });

  it('sends only the columns of the chosen predictor and comparison', () => {
    const logistic = rocInput(
      {
        ...base,
        source: 'logistic',
        predictors: ['age', 's100b'],
        compare: 'groups',
        group: 'gender',
      },
      ctx,
    );
    expect(rocColumns(logistic)).toEqual(['outcome', 'age', 's100b', 'gender']);
    const req = rocRequest(data, logistic);
    expect(req.predictor).toBe('');
    expect(req.predictor2).toBe('');
    expect(req.data.names).toEqual(['outcome', 's100b', 'gender', 'age']);
    expect(req).not.toHaveProperty('pauc');
    expect(req).not.toHaveProperty('positive');
    const pauc = rocRequest(data, rocInput({ ...base, pauc: true, positive: 1 }, ctx));
    expect(pauc.pauc).toEqual({ focus: 'specificity', from: 0.8, to: 1, correct: false });
    expect(pauc.positive).toBe(1);
  });

  it('shows the AUC, the curve, the cut-point and the comparison', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server');
    const points = { fpr: [0, 0.2, 1], tpr: [0, 0.6, 1] };
    const r: RocResult & { input: ReturnType<typeof rocInput> } = {
      n: 113,
      cases: 41,
      controls: 72,
      levels: [1, 2],
      direction: '<',
      auc: 0.7314,
      aucSe: 0.0517,
      aucCi: { low: 0.6301, high: 0.8326 },
      ciMethod: 'delong',
      curve: points,
      best: [
        {
          threshold: 0.205,
          sensitivity: 0.634,
          specificity: 0.806,
          ppv: 0.65,
          npv: 0.795,
          accuracy: 0.743,
          youden: 0.44,
        },
      ],
      cutpoint: 'youden',
      partial: { value: 0.0806, ciLow: null, ciHigh: null },
      comparison: {
        type: 'paired',
        statistic: -2.209,
        df: null,
        p: 0.0272,
        aucs: [0.7314, 0.8237],
        ciLow: -0.174,
        ciHigh: -0.0104,
        groups: null,
        curves: [points],
      },
      warnings: [],
      engine: { package: 'pROC', version: '1.19.1' },
      input: rocInput({ ...base, compare: 'paired', predictor2: 'wfns', pauc: true }, ctx),
    };
    const html = renderToStaticMarkup(<roc.View result={r} options={base} current />);
    expect(html).toContain('ROC curve');
    expect(html).toContain('0.731');
    expect(html).toContain('Best cut-point (Youden’s J)');
    expect(html).toContain('AUC wfns');
    expect(html).toContain('Z = -2.209');
    expect(html).toContain('Partial AUC over specificity 0.8 to 1');
  });
});
