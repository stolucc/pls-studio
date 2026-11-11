// CB-SEM pairwise deletion and the two-stage approach (Savalei & Bentler 2009)
// through webR against native lavaan (scripts/validation/missing_twostage.R):
// the Holzinger–Swineford CFA with 30 values per item missing.
// Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MissingTreatment, ModelSpec } from '../engine/types';
import { estimateCbLavaan } from './lavaan';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const ref = JSON.parse(
  readFileSync(
    join(__dirname, '..', 'engine', '__fixtures__', 'missing', 'reference.json'),
    'utf8',
  ),
);
const names = Object.keys(ref.data);
const data = {
  names,
  cols: names.map((n) =>
    Float64Array.from(ref.data[n] as (number | null)[], (v) => (v === null ? NaN : v)),
  ),
};
const F = (name: string, inds: string[]) => ({
  name,
  type: 'factor' as const,
  mode: 'A' as const,
  indicators: inds,
});
const spec: ModelSpec = {
  constructs: [
    F('visual', ['x1', 'x2', 'x3']),
    F('textual', ['x4', 'x5', 'x6']),
    F('speed', ['x7', 'x8', 'x9']),
  ],
  paths: [],
  covariances: [
    { a: 'visual', b: 'textual', kind: 'construct' },
    { a: 'visual', b: 'speed', kind: 'construct' },
    { a: 'textual', b: 'speed', kind: 'construct' },
  ] as ModelSpec['covariances'],
};

describe('lavaan missing-data options', () => {
  it.each([
    ['pairwise', 'ML', 'pairwise'],
    ['twostage', 'ML', 'twostage'],
    ['robusttwostage', 'MLR', 'robusttwostage'],
  ] as const)(
    '%s (%s) equals native lavaan',
    async (missing, estimator, key) => {
      const r = await estimateCbLavaan(data, spec, missing as MissingTreatment, estimator);
      const want = ref[key];
      expect(r.fit.chisq).toBeCloseTo(want.chisq, 4);
      expect(r.fit.df).toBe(want.df);
      const loadings = r.estimates.filter((e) => e.op === '=~');
      loadings.forEach((e, i) => {
        expect(e.est, `${e.lhs} =~ ${e.rhs}`).toBeCloseTo(want.loadings[i], 5);
        if (want.se[i] > 0) expect(e.se!, `se ${e.lhs} =~ ${e.rhs}`).toBeCloseTo(want.se[i], 4);
      });
    },
    900_000,
  );

  it('the residual correlations computed for the two-stage approach equal lavResiduals (complete data)', async () => {
    const { callJson, withR } = await import('./runtime');
    const commonR = (await import('./R/common.R?raw')).default;
    const lavaanR = (await import('./R/lavaan.R?raw')).default;
    const r = (await withR(['jsonlite', 'lavaan'], { common: commonR, lavaan: lavaanR }, (webR) =>
      callJson(
        webR,
        `suppressPackageStartupMessages(library(lavaan))
      fit <- cfa("visual =~ x1 + x2 + x3\\ntextual =~ x4 + x5 + x6", data = HolzingerSwineford1939, group = "school")
      a <- ps_cor_residuals(fit); b <- lavResiduals(fit, type = "cor.bollen", summary = FALSE)
      ps_json(max(abs(a[[1]]$cov - b[[1]]$cov), abs(a[[2]]$cov - b[[2]]$cov)))`,
        null,
      ),
    )) as number;
    expect(r).toBeLessThan(1e-12);
  }, 900_000);
});
