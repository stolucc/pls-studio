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

// Labels from R carry the model's syntactic names; ps_back_names puts the
// user's names back in one pass, whole names only, so a short name never
// renames part of a longer one and a name put back is not renamed again.
it('puts the user names back into labels, whole names only', async () => {
  const back = await withR(['jsonlite'], { common: commonR }, (webR) => callJson(webR, `ps_json(list(
    words = I(ps_back_names(c("x", "x2", "max", "x:x2", "B ON x"), c(x = "Age (x)", x2 = "Income", Age = "WRONG"))),
    missing = I(ps_back_names(c("x", NA), c(x = "X"))),
    prefix = I(ps_back_names(c("x_hi", "Grosse_cm", "distance"), c(x = "X", Grosse = "Gr\\u00f6\\u00dfe", Grosse_cm = "Gr\\u00f6\\u00dfe (cm)"), prefix = TRUE))))`, null)) as { words: string[]; prefix: string[]; missing: (string | null)[] };
  expect(back.words).toEqual(['Age (x)', 'Income', 'max', 'Age (x):Income', 'B ON Age (x)']);
  expect(back.prefix).toEqual(['X_hi', 'Größe (cm)', 'distance']);
  expect(back.missing).toEqual(['X', null]);
}, 300_000);

// Exact lookups: ps_back keeps a name with no match (keep = TRUE) or makes it
// NA (keep = FALSE, as back[x]); ps_back_term maps each piece of "a:b";
// ps_back_map is the model's construct + indicator map.
it('maps model names back exactly, keeping or dropping unmatched ones', async () => {
  const r = await withR(['jsonlite'], { common: commonR }, (webR) => callJson(webR, `local({
    back <- c(x = "Age", x2 = "Income")
    b <- list(lname = c(Q = "Quality", S = "Satisfaction"), n = list(cname = c("Q", "S"), all_inds = c("q 1", "s 1"), iv = c("q 1" = "q_1", "s 1" = "s_1")))
    m <- ps_back_map(b)
    ps_json(list(keep = I(ps_back(c("x", "max", "x2"), back)), drop = I(ps_back(c("x", "max"), back, FALSE)),
      empty = I(ps_back("x", character(0))), none = I(ps_back(character(0), back)),
      term = ps_back_term("x:z:x2", back), single = ps_back_term("x2", back),
      map = as.list(m), mapOne = as.list(ps_back_map(b, "S"))))
  })`, null)) as Record<string, unknown>;
  expect(r.keep).toEqual(['Age', 'max', 'Income']);
  expect(r.drop).toEqual(['Age', null]);
  expect(r.empty).toEqual(['x']);
  expect(r.none).toEqual([]);
  expect(r.term).toBe('Age × z × Income');
  expect(r.single).toBe('Income');
  expect(r.map).toEqual({ Quality: 'Q', Satisfaction: 'S', q_1: 'q 1', s_1: 's 1' });
  expect(r.mapOne).toEqual({ Satisfaction: 'S', q_1: 'q 1', s_1: 's 1' });
}, 300_000);

// A bridge call that leaves options(warn = 2) set does not change the next call: its warnings stay warnings.
it('restores the warn option after every call', async () => {
  const leaky = `
ps_zz_leaky <- function(req_json, export = FALSE) { options(warn = 2); ps_json(list(value = 1)) }
ps_zz_warns <- function(req_json, export = FALSE) { warning("only a warning"); ps_json(list(value = 2, warn = getOption("warn"))) }`;
  type Out = { value: number; warn: number; warnings: string[] };
  const [before, r] = await withR(['jsonlite'], { common: commonR, leaky }, async (webR) => {
    const first = await callJson(webR, 'ps_call("ps_zz_warns", req)', {}) as Out;
    await callJson(webR, 'ps_call("ps_zz_leaky", req)', {});
    return [first, await callJson(webR, 'ps_call("ps_zz_warns", req)', {}) as Out];
  });
  expect(r.value).toBe(2);
  expect(r.warn).toBe(before.warn);
  expect(r.warn).toBeLessThan(2);
  expect(r.warnings).toEqual(['only a warning']);
}, 300_000);

// Under options(warn = 2) a warning is an error where it is raised, as in plain R (SEMsens's sa.aco relies on it to
// drop fits that warn) — also in webR, whose own evaluation muffles warnings before R could convert them.
it('turns warnings into errors under warn = 2, in webR as in R', async () => {
  const strict = `
ps_zz_strict <- function(req_json, export = FALSE) {
  env <- ps_run(c("old <- options(warn = 2)", "r <- try(warning('negative variance'), silent = TRUE)", "options(old)"), list())
  ps_json(list(failed = inherits(env$r, "try-error"), message = if (inherits(env$r, "try-error")) trimws(as.character(env$r)) else ""))
}`;
  const r = await withR(['jsonlite'], { common: commonR, strict }, (webR) => callJson(webR, 'ps_call("ps_zz_strict", req)', {})) as { failed: boolean; message: string };
  expect(r.failed).toBe(true);
  expect(r.message).toContain('(converted from warning) negative variance');
}, 300_000);
