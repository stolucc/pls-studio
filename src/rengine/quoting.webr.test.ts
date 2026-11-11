// Names and request fields from CSV headers or imported project files must not
// break out of the R code the bridges generate (exported scripts are run in
// desktop R). Run with npm run test:webr.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import commonR from './R/common.R?raw';
import { callJson, withR } from './runtime';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const HOSTILE = [
  'plain',
  'with "quotes"',
  "it's",
  'ends with \\',
  'x\\"); stop("pwned"); c("',
  "x\\'); stop('pwned'); c('",
  'line\nbreak',
  'tab\tcr\r',
  'unicode é ζ',
];

/** Evaluate R code with `req` bound to the JSON of `req`; the code returns JSON. */
const r = <T>(code: string, req: unknown) =>
  withR(['jsonlite'], { common: commonR }, (webR) => callJson(webR, code, req)) as Promise<T>;

describe('R code generation quotes hostile strings', () => {
  it('ps_q: the generated vector parses back to exactly the input', async () => {
    const out = await r<string[]>(
      'x <- jsonlite::fromJSON(req); ps_json(eval(parse(text = ps_q(x))))',
      HOSTILE,
    );
    expect(out).toEqual(HOSTILE);
  }, 300_000);

  it("ps_sq: text inside '...' parses back to exactly the input", async () => {
    const out = await r<string[]>(
      'x <- jsonlite::fromJSON(req); ps_json(vapply(x, function(s) eval(parse(text = paste0("\'", ps_sq(s), "\'"))), \'\'))',
      HOSTILE,
    );
    expect(out).toEqual(HOSTILE);
  }, 300_000);

  it('ps_comment: a comment line stays one comment line', async () => {
    const out = await r<number[]>(
      'x <- jsonlite::fromJSON(req); ps_json(vapply(x, function(s) length(parse(text = paste0("# ", ps_comment(s), "\\n1"))), 0))',
      HOSTILE,
    );
    expect(out).toEqual(HOSTILE.map(() => 1));
  }, 300_000);

  it('ps_validate: rejects field values that are written into code as they are', async () => {
    const check = (req: unknown) =>
      r<string>(
        'tryCatch({ ps_parse(req); ps_json("ok") }, error = function(e) ps_json(conditionMessage(e)))',
        req,
      );
    expect(
      await check({ estimator: 'MLR', model: { constructs: [{ mode: 'A', type: 'factor' }] } }),
    ).toBe('ok');
    expect(await check({ estimator: 'ML"); stop("x' })).toMatch(/Invalid estimator/);
    expect(await check({ model: { constructs: [{ mode: 'A); stop(1); (' }] } })).toMatch(
      /Invalid construct mode/,
    );
    expect(await check({ spec: { constructs: [{ type: 'other' }] } })).toMatch(
      /Invalid construct type/,
    );
    expect(await check({ options: { scheme: 'path', missing: 'drop' } })).toMatch(
      /Invalid missing-value treatment/,
    );
    expect(await check({ estimators: [{ method: 'cb', estimator: ['ML', 'ULS'] }] })).toMatch(
      /Invalid estimator/,
    );
    // A Monte Carlo request has estimators but no estimator: no partial matching of names.
    expect(
      await check({
        estimators: [
          { id: 'PLS', method: 'pls' },
          { id: 'CB-ML', method: 'cb', estimator: 'ML' },
        ],
      }),
    ).toBe('ok');
  }, 300_000);
});
