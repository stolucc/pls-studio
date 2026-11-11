// End-to-end: the lavaan reference cases re-estimated by lavaan running in
// webR (the self-hosted runtime and package repository in public/webr), through
// the same request/response code the app uses. Run with npm run test:webr.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { webrOnlyIt } from './webrSlow';
import type { CbEstimator } from '../engine/cbsem';
import { cases, checkCbResult, loadData, toSpec } from '../engine/validationHarness';
import { cbScriptLavaan, estimateCbLavaan } from './lavaan';
import { useR } from './runtime';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const lavaanCases = cases.filter((c) => c.kind === 'cb' && c.source === 'lavaan');

describe.each(lavaanCases)('lavaan in webR: $name', (c) => {
  it('reproduces the reference values', async () => {
    const res = await estimateCbLavaan(
      loadData(c),
      toSpec(c),
      'casewise',
      c.options.estimator as CbEstimator,
    );
    // The references come from lavaan 0.6-16. lavaan 0.7 changed the ULS defaults: sandwich
    // standard errors (se = "robust.sem.nt") and Browne's residual-based test instead of the
    // old ULS statistic. The R engine follows the package's defaults, so for ULS only the
    // parameter estimates are compared.
    checkCbResult(c, res, { estimatesOnly: c.options.estimator === 'ULS' });
  }, 300_000);
});

it('exports the script it runs, with the data embedded', async () => {
  const c = cases.find((k) => k.name === 'cov_lavaan_bollen_ml')!;
  const script = await cbScriptLavaan(loadData(c), toSpec(c), 'casewise', 'ML');
  expect(script).toContain('fit <- sem(model, data = data, estimator = "ML", auto.cov.y = FALSE)');
  expect(script).toContain('y1 ~~ y5');
  expect(script).toContain("data <- read.csv(text = '");
}, 300_000);

webrOnlyIt('reports the package versions it ran', () => {
  expect(useR.getState().versions.lavaan).toMatch(/^\d/);
});
