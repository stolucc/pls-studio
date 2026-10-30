// ps_run (R/common.R) collects R's warnings for the Messages panel, except
// R's note that a package was built under a newer R (common in desktop R,
// through the helper), which says nothing about the results.
// Run with npm run test:webr.

import { afterAll, beforeAll, expect, it } from 'vitest';
import commonR from './R/common.R?raw';
import { callJson, withR } from './runtime';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

it('keeps real warnings and drops the built-under-R note', async () => {
  const w = await withR(['jsonlite'], { common: commonR }, (webR) => callJson(webR, `ps_json(I(ps_run(c(
    "warning('package \\u2018seminr\\u2019 was built under R version 4.3.3')",
    "warning('lavaan WARNING:\\n  some estimated variances are negative')"), list())$.warnings))`, null));
  expect(w).toEqual(['lavaan WARNING: some estimated variances are negative']);
}, 300_000);

// Nothing is swallowed: every bridge call runs through ps_call, which keeps the
// warnings raised outside ps_run (post-processing), and ps_try reports optional
// computations that failed; ps_json adds both to the result's warnings.
const probe = `
ps_zz_probe <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  env <- ps_run("warning('inside the analysis')", list())
  if (isTRUE(req$noisy)) {
    warning("after the analysis")
    x <- ps_try(stop("boom"), "The statistic X", otherwise = 0)
    y <- ps_try({ warning("approximate"); 2 }, "The statistic Y")
    stopifnot(x == 0, y == 2)
  }
  ps_json(list(value = 1, warnings = env$.warnings))
}`;

it('reports warnings outside ps_run and failed optional computations, per call', async () => {
  const run = (noisy: boolean) => withR(['jsonlite'], { common: commonR, probe }, (webR) => callJson(webR, 'ps_call("ps_zz_probe", req)', { noisy })) as Promise<{ value: number; warnings: string[] }>;
  const r = await run(true);
  expect(r.value).toBe(1);
  expect(r.warnings).toEqual(['inside the analysis', 'after the analysis', 'The statistic X could not be computed: boom', 'The statistic Y: approximate']);
  // The notes belong to one call: the next starts clean.
  expect([(await run(false)).warnings].flat()).toEqual(['inside the analysis']);
  // Only bridge entry points can be called.
  await expect(withR(['jsonlite'], { common: commonR, probe }, (webR) => callJson(webR, 'ps_call("ps_json", req)', {}))).rejects.toThrow(/Invalid bridge function/);
  await expect(withR(['jsonlite'], { common: commonR, probe }, (webR) => callJson(webR, 'ps_call("system", req)', {}))).rejects.toThrow(/Invalid bridge function/);
}, 300_000);
