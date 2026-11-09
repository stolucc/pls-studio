// The example of cards/integration.ts, run through the integration card's own run() on the example's data (with its
// computed columns), and compared with the R help page it follows (ltm(LSAT ~ z1)), run in the same R. Run with
// WEBR_TESTS=1.

import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Dataset } from '../../engine/types';
import { computeColumn } from '../../data/compute';
import { categoriesOf } from '../../io';
import { DEFAULT_SETTINGS, type DataInfo } from '../../model/project';
import { analysisType } from '../../analyses/registry';
import type { AnalysisCtx } from '../../analyses/types';
import { rCall, type RPackage } from '../../rengine/bridge';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { callJson, withR } from '../../rengine/runtime';
import commonR from '../../rengine/R/common.R?raw';
import { exampleSettings, PACKAGE_EXAMPLES, panelPreset } from '../packages';
import { against, example as exampleCheck, near, same } from '../../validation/record';
import type { QuadResult } from '../../rengine/quadml';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

async function open(id: string) {
  const ex = PACKAGE_EXAMPLES.find((e) => e.id === id)!;
  exampleCheck(id, { title: ex.title, method: 'Integration ML', packages: ['R'], definition: ex });
  const raw = await rCall<{ names: string[]; cols: (number | null)[][]; levels?: Record<string, string[]> }>('ps_dataset', { package: ex.data.package, name: ex.data.name, na: ex.data.na ?? [] }, ex.data.package as RPackage);
  let data: Dataset = { names: raw.names, cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))), ...categoriesOf(raw.levels) };
  let info: DataInfo = { fileName: 'x', rows: data.cols[0].length, missingCells: 0, excluded: [] };
  for (const k of ex.computed ?? []) ({ data, info } = computeColumn(data, info, k.name, k.expr));
  const ctx: AnalysisCtx = { data, info: null, settings: exampleSettings(DEFAULT_SETTINGS, ex.settings), pls: null, projectName: ex.title };
  const t = analysisType(ex.panel!.kind)!;
  const options = t.parseOptions({ ...t.defaults(ctx), ...panelPreset(ex.panel!) })!;
  expect(t.blocked(options as never, ctx), `${id}: the card is ready to run`).toBeNull();
  return { ex, ctx, t, options, run: () => t.run(options as never, ctx, () => {}) as Promise<QuadResult> };
}
const sameR = <T>(packages: string[], code: string) => withR(['jsonlite', ...packages], { common: commonR }, (webR) => callJson(webR, code, null)) as Promise<T>;

it('ltm-quadml-lsat: the 2PL written in Mplus syntax and integrated as ltm integrates it gives ltm(LSAT ~ z1)', async () => {
  const { run } = await open('ltm-quadml-lsat');
  against({ label: 'R, ?ltm: ltm(LSAT ~ z1) (21 Gauss–Hermite points) in the same R', level: 'native', url: 'https://rdrr.io/cran/ltm/man/ltm.html' });
  const r = await run();
  expect(r.converged).toBe(true);
  const ref = await sameR<{ logLik: number; diff: number[]; disc: number[]; seDiff: number[]; seDisc: number[]; v: number[][] }>(['ltm'],
    'suppressPackageStartupMessages(library(ltm)); fit <- ltm(LSAT ~ z1); cf <- coef(fit); s <- summary(fit)$coefficients; ' +
    'ps_json(list(logLik = as.numeric(fit$log.Lik), diff = unname(cf[, 1]), disc = unname(cf[, 2]), seDiff = unname(s[1:5, 2]), seDisc = unname(s[6:10, 2])))');
  same('free parameters', r.npar, 10);
  near('log-likelihood', r.logLik, ref.logLik, 1e-4);
  for (let i = 1; i <= 5; i++) {
    const a = r.params.find((p) => p.op === '=~' && p.rhs === `i${i}`)!, t = r.params.find((p) => p.op === '|' && p.lhs === `i${i}`)!;
    // (ltm stops its optimizer earlier: its estimates are within 5e-4 of the maximum, its log-likelihood the same to 1e-6)
    near(`Item ${i}: discrimination (loading)`, a.est, ref.disc[i - 1], 1e-3);
    near(`Item ${i}: difficulty (threshold / loading)`, t.est / a.est, ref.diff[i - 1], 3e-3);
    near(`SE of the discrimination of item ${i}`, a.se!, ref.seDisc[i - 1], 1e-3);
  }
  expect(r.warnings).toEqual([]);
}, 600_000);

it('the integration card states what it does not fit', async () => {
  const { t, ctx, options } = await open('ltm-quadml-lsat');
  const o = options as { syntax: string };
  expect(t.blocked({ ...o, syntax: o.syntax.replace('CATEGORICAL = i1-i5;', 'CATEGORICAL = i1-i5;\nTYPE = MIXTURE;') } as never, ctx)).toMatch(/TYPE = MIXTURE/);
  expect(t.blocked({ ...o, syntax: o.syntax.replace('f@1;', 'f@1;\nf WITH i1;') } as never, ctx)).toMatch(/conditionally independent/);
});
