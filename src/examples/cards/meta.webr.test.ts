// The example of cards/meta.ts, run through the Meta-analysis card's own run() on the example's data (loaded from
// metadat as the app loads it, the trials labelled by their authors), compared with the results metafor prints on the
// ?rma help page (4 decimals, so tolerance 5e-5) for the random-effects model and the meta-regression on latitude and
// year. Run with WEBR_TESTS=1 (PS_NATIVE_R=1 runs the card in desktop R).

import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Dataset } from '../../engine/types';
import { categoriesOf } from '../../io';
import { DEFAULT_SETTINGS } from '../../model/project';
import { analysisType } from '../../analyses/registry';
import type { AnalysisCtx } from '../../analyses/types';
import { rCall } from '../../rengine/bridge';
import type { MetaResult } from '../../rengine/meta';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { examplePanels, exampleSettings, PACKAGE_EXAMPLES, panelPreset } from '../packages';
import { against, example as exampleCheck, near, same } from '../../validation/record';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const PRINTED = 5e-5;

async function load(name: string, labels: Record<string, string[]>): Promise<Dataset> {
  const raw = await rCall<{
    names: string[];
    cols: (number | null)[][];
    levels?: Record<string, string[]>;
  }>('ps_dataset', { package: 'metadat', name, na: [] }, 'metadat');
  const data = {
    names: raw.names,
    cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))),
    ...categoriesOf(raw.levels),
  };
  return { ...data, categories: { ...(data.categories ?? {}), ...labels } };
}

it('metafor-bcg: ?rma’s random-effects model and meta-regression of the BCG trials', async () => {
  const ex = PACKAGE_EXAMPLES.find((e) => e.id === 'metafor-bcg')!;
  exampleCheck(ex.id, {
    title: ex.title,
    method: 'Meta-analysis',
    packages: ['metafor'],
    definition: ex,
  });
  const data = await load(ex.data.name, ex.labels ?? {});
  const ctx: AnalysisCtx = {
    data,
    info: null,
    settings: exampleSettings(DEFAULT_SETTINGS, ex.settings),
    pls: null,
    projectName: ex.title,
  };
  const t = analysisType('meta')!;
  const [pooledPanel, regressionPanel] = examplePanels(ex);
  const optionsOf = (p: typeof pooledPanel) =>
    t.parseOptions({ ...t.defaults(ctx), ...panelPreset(p) });
  const pooledOptions = optionsOf(pooledPanel);
  const regressionOptions = optionsOf(regressionPanel);
  expect(t.blocked(pooledOptions, ctx)).toBeNull();
  expect(t.blocked(regressionOptions, ctx)).toBeNull();

  against({
    label:
      'metafor’s ?rma help page: rma(yi, vi, data = dat) and predict(res, transf = exp), as printed',
    level: 'native',
    url: 'https://rdrr.io/cran/metafor/man/rma.uni.html',
  });
  const r = (await t.run(pooledOptions, ctx, () => {})) as MetaResult;
  same('k', r.k, 13);
  same('first trial’s label', r.studies[0].label, 'Aronson');
  near('pooled log risk ratio', r.pooled!.est, -0.7145, PRINTED);
  near('SE', r.pooled!.se!, 0.1798, PRINTED);
  near('CI lower', r.pooled!.ciLow, -1.0669, PRINTED);
  near('CI upper', r.pooled!.ciHigh, -0.3622, PRINTED);
  near('tau²', r.heterogeneity.tau2!, 0.3132, PRINTED);
  near('SE of tau²', r.heterogeneity.tau2se!, 0.1664, PRINTED);
  near('I² (%)', r.heterogeneity.I2 as number, 92.22, 5e-3);
  near('H²', r.heterogeneity.H2!, 12.86, 5e-3);
  near('Q', r.Q, 152.233, 5e-4);
  same('Q df', r.Qdf, 12);
  near('risk ratio', r.pooledBack!.est, 0.4894, PRINTED);
  near('risk ratio CI lower', r.pooledBack!.ciLow, 0.3441, PRINTED);
  near('risk ratio CI upper', r.pooledBack!.ciHigh, 0.6962, PRINTED);
  near('risk ratio prediction interval lower', r.pooledBack!.piLow, 0.1546, PRINTED);
  near('risk ratio prediction interval upper', r.pooledBack!.piHigh, 1.549, PRINTED);
  expect(r.bias).toBeTruthy();
  expect(r.influence?.length).toBe(13);
  same('unexpected R warnings', r.warnings.length, 0);

  against({
    label: 'metafor’s ?rma help page: rma(yi, vi, mods = ~ ablat + year, data = dat), as printed',
    level: 'native',
    url: 'https://rdrr.io/cran/metafor/man/rma.uni.html',
  });
  const m = (await t.run(regressionOptions, ctx, () => {})) as MetaResult;
  same('terms', m.coefs.map((k) => k.term).join(' '), 'intrcpt ablat year');
  const printed: [number, number, number][] = [
    [-3.5455, 29.0959, 0.903],
    [-0.028, 0.0102, 0.0062],
    [0.0019, 0.0147, 0.8966],
  ];
  printed.forEach(([est, se, p], i) => {
    near(`${m.coefs[i].term}: estimate`, m.coefs[i].est, est, PRINTED);
    near(`${m.coefs[i].term}: SE`, m.coefs[i].se, se, PRINTED);
    near(`${m.coefs[i].term}: p`, m.coefs[i].p, p, PRINTED);
  });
  near('residual tau²', m.heterogeneity.tau2!, 0.1108, PRINTED);
  near('R² (%)', m.heterogeneity.R2!, 64.63, 5e-3);
  near('QE', m.Q, 28.3251, PRINTED);
  near('QM', m.QM!, 12.2043, PRINTED);
  near('QM p', m.QMp!, 0.0022, PRINTED);
}, 600_000);
