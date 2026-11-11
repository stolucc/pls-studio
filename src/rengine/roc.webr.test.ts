// The ROC card's bridge (R/roc.R) against pROC called directly (scripts/validation/roc.R) on its aSAH data: the ROC
// curve of s100b (every point), the AUC with DeLong's SE and interval and the bootstrap interval (same seed), the best
// cut-points by Youden's J and closest to the top-left corner (with PPV, NPV, accuracy), partial AUCs (uncorrected, and
// McClish-corrected with a bootstrap interval), DeLong's paired test against wfns and the unpaired test between the
// sexes, a predictor whose low values mark cases (ndka), the fitted probabilities of a logistic regression, and the
// outcome's levels reversed.
// Tolerance: relative 1e-6 (the AUC, DeLong's variance and the tests are closed forms; the bootstrap draws the same
// samples from the same seed; the logistic regression is IRLS to convergence).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Dataset } from '../engine/types';
import { near, same } from '../validation/record';
import { rocR, rocScriptR, type RocInput, type RocResult } from './roc';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const ref = JSON.parse(
  readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'roc', 'reference.json'), 'utf8'),
);
const TOL = 1e-6;

const data: Dataset = {
  names: ref.data.names,
  cols: ref.data.cols.map((col: number[]) => Float64Array.from(col)),
};
const rel = (q: string, got: number | null | undefined, want: number) =>
  near(q, got ?? NaN, want, TOL * Math.max(1, Math.abs(want)));

interface RefCurve {
  auc: number;
  se: number;
  ci: number[];
  direction: string;
  specificities: number[];
  sensitivities: number[];
}

function compareCurve(label: string, r: RocResult, t: RefCurve) {
  rel(`${label}: AUC`, r.auc, t.auc);
  rel(`${label}: DeLong SE`, r.aucSe, t.se);
  same(`${label}: direction`, r.direction, t.direction);
  same(`${label}: curve points`, r.curve.fpr.length, t.specificities.length);
  r.curve.fpr.forEach((x, i) => {
    rel(`${label}: point ${i + 1} specificity`, 1 - x, t.specificities[i]);
    rel(`${label}: point ${i + 1} sensitivity`, r.curve.tpr[i], t.sensitivities[i]);
  });
}

const BASE: RocInput = {
  response: 'outcome',
  positive: null,
  source: 'column',
  predictor: 's100b',
  predictors: [],
  direction: 'auto',
  ciMethod: 'delong',
  bootN: 500,
  cutpoint: 'youden',
  compare: 'none',
  predictor2: '',
  group: '',
  pauc: null,
  seed: 1,
  confidence: 0.95,
};

describe('ROC analysis (pROC)', () => {
  it('?roc / ?ci.auc / ?coords: the ROC curve of s100b, DeLong interval and Youden cut-point equal pROC', async () => {
    const r = await rocR(data, BASE);
    compareCurve('s100b', r, ref.s100b);
    rel('DeLong CI lower', r.aucCi.low, ref.s100b.ci[0]);
    rel('DeLong CI upper', r.aucCi.high, ref.s100b.ci[2]);
    same('cases', r.cases, 41);
    same('controls', r.controls, 72);
    const b = r.best[0];
    for (const key of [
      'threshold',
      'sensitivity',
      'specificity',
      'ppv',
      'npv',
      'accuracy',
    ] as const) {
      rel(`Youden cut-point: ${key}`, b[key], ref.youden[key]);
    }
    rel('Youden’s J', b.youden, ref.youden.sensitivity + ref.youden.specificity - 1);
    expect(r.warnings).toEqual([]);
  }, 600_000);

  it('the bootstrap interval and the cut-point closest to the top-left corner equal pROC', async () => {
    const r = await rocR(data, { ...BASE, ciMethod: 'bootstrap', cutpoint: 'closest.topleft' });
    rel('bootstrap CI lower', r.aucCi.low, ref.bootstrap[0]);
    rel('bootstrap CI upper', r.aucCi.high, ref.bootstrap[2]);
    for (const key of ['threshold', 'sensitivity', 'specificity', 'ppv', 'npv'] as const) {
      rel(`top-left cut-point: ${key}`, r.best[0][key], ref.topleft[key]);
    }
  }, 600_000);

  it('?auc: partial AUCs, uncorrected and McClish-corrected with a bootstrap interval, equal pROC', async () => {
    const sp = await rocR(data, {
      ...BASE,
      pauc: { focus: 'specificity', from: 0.8, to: 1, correct: false },
    });
    rel('partial AUC (specificity 0.8–1)', sp.partial?.value, ref.partialSp);
    expect(sp.partial?.ciLow).toBeNull();
    const se = await rocR(data, {
      ...BASE,
      ciMethod: 'bootstrap',
      pauc: { focus: 'sensitivity', from: 0.9, to: 1, correct: true },
    });
    rel('corrected partial AUC (sensitivity 0.9–1)', se.partial?.value, ref.partialSe);
    rel('its bootstrap CI lower', se.partial?.ciLow, ref.partialSeCi[0]);
    rel('its bootstrap CI upper', se.partial?.ciHigh, ref.partialSeCi[2]);
  }, 600_000);

  it('?roc.test: DeLong’s paired test of s100b against wfns equals pROC', async () => {
    const r = await rocR(data, { ...BASE, compare: 'paired', predictor2: 'wfns' });
    const k = r.comparison!;
    rel('Z', k.statistic, ref.paired.statistic);
    rel('p', k.p, ref.paired.p);
    rel('AUC s100b', k.aucs[0], ref.paired.aucs[0]);
    rel('AUC wfns', k.aucs[1], ref.paired.aucs[1]);
    rel('difference CI lower', k.ciLow, ref.paired.ci[0]);
    rel('difference CI upper', k.ciHigh, ref.paired.ci[1]);
    same('second curve drawn', k.curves.length, 1);
  }, 600_000);

  it('DeLong’s unpaired test between two groups equals pROC', async () => {
    const r = await rocR(data, { ...BASE, compare: 'groups', group: 'gender' });
    const k = r.comparison!;
    rel('D', k.statistic, ref.unpaired.statistic);
    rel('df', k.df, ref.unpaired.df);
    rel('p', k.p, ref.unpaired.p);
    rel('AUC male', k.aucs[0], ref.unpaired.aucs[0]);
    rel('AUC female', k.aucs[1], ref.unpaired.aucs[1]);
    expect(k.groups).toEqual([1, 2]);
  }, 600_000);

  it('a predictor whose low values mark cases, and the outcome’s levels reversed, equal pROC', async () => {
    compareCurve(
      'ndka (>)',
      await rocR(data, { ...BASE, predictor: 'ndka', direction: '>' }),
      ref.ndka,
    );
    const reversed = await rocR(data, { ...BASE, positive: 1 });
    compareCurve('cases = Good', reversed, ref.reversed);
    expect(reversed.levels).toEqual([2, 1]);
  }, 600_000);

  it('the fitted probabilities of a logistic regression equal glm and pROC', async () => {
    const r = await rocR(data, {
      ...BASE,
      source: 'logistic',
      predictor: '',
      predictors: ['age', 's100b'],
    });
    compareCurve('logistic', r, ref.logistic.curve);
    r.logistic!.forEach((k, i) => {
      rel(`${k.term}: estimate`, k.est, ref.logistic.coefs[i]);
      rel(`${k.term}: SE`, k.se, ref.logistic.se[i]);
    });
    expect(r.logistic!.map((k) => k.term)).toEqual(['(Intercept)', 'age', 's100b']);
  }, 600_000);

  it('writes the script it runs, and refuses an outcome with more than two values', async () => {
    const script = await rocScriptR(data, { ...BASE, compare: 'paired', predictor2: 'wfns' });
    expect(script).toContain(
      'curve <- roc(data$outcome, data$s100b, levels = lv, direction = "auto", quiet = TRUE)',
    );
    expect(script).toContain('test <- roc.test(curve, curve2, method = "delong", paired = TRUE)');
    await expect(rocR(data, { ...BASE, response: 'wfns' })).rejects.toThrow(/exactly two values/);
  }, 600_000);
});
