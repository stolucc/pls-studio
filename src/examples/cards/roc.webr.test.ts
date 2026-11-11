// The example of cards/roc.ts, run through the ROC card's own run() on the example's data (loaded from pROC as the
// app loads it), compared with the results pROC prints on its help pages (?roc, ?ci.auc, ?coords, ?auc, ?roc.test;
// 4 decimals, so tolerance 5e-5). Run with WEBR_TESTS=1 (PS_NATIVE_R=1 runs the card in desktop R).

import { afterAll, beforeAll, expect, it } from 'vitest';
import { categoriesOf } from '../../io';
import { DEFAULT_SETTINGS } from '../../model/project';
import { analysisType } from '../../analyses/registry';
import type { AnalysisCtx } from '../../analyses/types';
import { rCall } from '../../rengine/bridge';
import type { RocResult } from '../../rengine/roc';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { exampleSettings, PACKAGE_EXAMPLES, panelPreset } from '../packages';
import { against, example as exampleCheck, near, same } from '../../validation/record';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const PRINTED = 5e-5;

it('proc-asah: the help pages’ ROC curve of s100b, its cut-point, partial AUC and the test against wfns', async () => {
  const ex = PACKAGE_EXAMPLES.find((e) => e.id === 'proc-asah')!;
  exampleCheck(ex.id, {
    title: ex.title,
    method: 'ROC analysis',
    packages: ['pROC'],
    definition: ex,
  });
  const raw = await rCall<{
    names: string[];
    cols: (number | null)[][];
    levels?: Record<string, string[]>;
  }>('ps_dataset', { package: 'pROC', name: 'aSAH', na: [] }, 'pROC');
  const data = {
    names: raw.names,
    cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))),
    ...categoriesOf(raw.levels),
  };
  const ctx: AnalysisCtx = {
    data,
    info: null,
    settings: exampleSettings(DEFAULT_SETTINGS, ex.settings),
    pls: null,
    projectName: ex.title,
  };
  const t = analysisType('roc')!;
  const options = t.parseOptions({ ...t.defaults(ctx), ...panelPreset(ex.panel!) });
  expect(t.blocked(options, ctx)).toBeNull();
  const r = (await t.run(options, ctx, () => {})) as RocResult;

  against({
    label: 'pROC’s help pages (?roc, ?ci.auc, ?coords, ?auc, ?roc.test) on aSAH, as printed',
    level: 'native',
    url: 'https://rdrr.io/cran/pROC/man/roc.test.html',
  });
  same('cases (Poor)', r.cases, 41);
  same('controls (Good)', r.controls, 72);
  same('direction', r.direction, '<');
  near('AUC', r.auc, 0.7314, PRINTED);
  near('DeLong CI lower', r.aucCi.low, 0.6301, PRINTED);
  near('DeLong CI upper', r.aucCi.high, 0.8326, PRINTED);
  near('best threshold', r.best[0].threshold, 0.205, PRINTED);
  near('specificity at the threshold', r.best[0].specificity, 0.8056, PRINTED);
  near('sensitivity at the threshold', r.best[0].sensitivity, 0.6341, PRINTED);
  near('partial AUC (specificity 1–0.8)', r.partial!.value, 0.08059, 5e-6);
  near('AUC wfns', r.comparison!.aucs[1], 0.8237, PRINTED);
  near('DeLong Z', r.comparison!.statistic, -2.209, 5e-4);
  near('DeLong p', r.comparison!.p, 0.02718, 5e-6);
  same('unexpected R warnings', r.warnings.length, 0);
}, 600_000);
