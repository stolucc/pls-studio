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
