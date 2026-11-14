// Request values must never become R code (requests can come from shared
// project files, and the desktop helper runs the code in the user's own R).
// The full check replays the recorded bridge calls with injection payloads
// in every field (scripts/security/replay-injection.R; `make security` in
// helper/). These are the fields it found unprotected, now refused: numbers
// written with format(), modes and types, and names that are not variables.
// Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { R_PACKAGES, rCall, rScript, type RPackage } from './bridge';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const corpus = readFileSync(
  join(__dirname, '..', '..', 'scripts', 'security', 'corpus.jsonl'),
  'utf8',
)
  .trim()
  .split('\n')
  .map((l) => JSON.parse(l) as { call: string; req: string });
/** The corpus's first recorded request of `fn`. */
const base = (fn: string): Record<string, any> =>
  JSON.parse(corpus.find((c) => c.call === `${fn}(req)`)!.req);
const PAYLOAD = 'a"\'`); PWNED_CANARY(); #\nPWNED_CANARY() ;("\'`';
const NUMBER = '1); PWNED_CANARY(); (1';

/** The exported script for the request, or the error R gave. */
const script = (fn: string, req: unknown, pkg: RPackage) =>
  rScript(fn, req, pkg).then(
    (s) => ({ s, e: '' }),
    (e: Error) => ({ s: '', e: e.message }),
  );
const refused = async (fn: string, req: unknown, pkg: RPackage, message: RegExp) => {
  const r = await script(fn, req, pkg);
  expect(r.s, `${fn}: ${r.s.slice(0, 200)}`).not.toContain('PWNED_CANARY()');
  expect(r.e).toMatch(message);
};

describe('request values never become R code', () => {
  it('the corpus requests produce scripts (sanity)', async () => {
    const r = await script('ps_pls', base('ps_pls'), 'cSEM');
    expect(r.e).toBe('');
    expect(r.s).toContain('csem(');
    expect(Object.keys(R_PACKAGES)).toContain('cSEM');
  }, 600_000);

  it('numbers written into the code', async () => {
    const pls = base('ps_pls');
    await refused(
      'ps_pls',
      { ...pls, options: { ...pls.options, tolerance: NUMBER } },
      'cSEM',
      /Invalid tolerance/,
    );
    const boot = base('ps_pls_boot');
    await refused(
      'ps_pls_boot',
      { ...boot, boot: { ...boot.boot, confidence: NUMBER } },
      'cSEM',
      /Invalid confidence level/,
    );
    const mc = base('ps_mc');
    await refused('ps_mc', { ...mc, alpha: NUMBER }, 'simulation', /Invalid significance level/);
    await refused(
      'ps_mc',
      {
        ...mc,
        params: mc.params.map((p: object, i: number) => (i === 0 ? { ...p, value: NUMBER } : p)),
      },
      'simulation',
      /Invalid fixed value/,
    );
    const ipma = base('ps_ipma');
    await refused(
      'ps_ipma',
      { ...ipma, ipma: { ...ipma.ipma, rescale: true, min: NUMBER } },
      'cSEM',
      /Invalid scale minimum/,
    );
    const cpa = base('ps_cpa');
    await refused('ps_cpa', { ...cpa, confidence: NUMBER }, 'manymome', /Invalid confidence level/);
  }, 900_000);

  it('measurement modes and construct types', async () => {
    const cmp = base('ps_pls_compare');
    const bad = {
      ...cmp.alternative,
      constructs: cmp.alternative.constructs.map((c: object, i: number) =>
        i === 0 ? { ...c, mode: PAYLOAD } : c,
      ),
    };
    await refused(
      'ps_pls_compare',
      { ...cmp, alternative: bad },
      'cSEM',
      /Invalid measurement mode/,
    );
  }, 900_000);

  it('validated fields under a longer name ($ matches a unique partial name)', async () => {
    // (the bridges read req$estimator, which returns req$estimatorX when there is no
    //  req$estimator: the check must see the same value, or the payload reaches sem())
    const { estimator: _e, ...cb } = base('ps_cb');
    const bad = { ...cb, estimatorX: `ML", se = {PWNED_CANARY(); "standard"}, test = "standard` };
    await refused('ps_cb', bad, 'lavaan', /Invalid estimator/);
    const { missing: _m, ...cb2 } = base('ps_cb');
    await refused('ps_cb', { ...cb2, missingX: PAYLOAD }, 'lavaan', /Invalid missing-value/);
  }, 900_000);

  it('arithmetic expressions: no function call in any spelling', async () => {
    // ((f)(x) has no name directly before "(", which the old text check looked for)
    const cb = base('ps_cb');
    await refused(
      'ps_cb',
      { ...cb, model: { ...cb.model, defined: [{ name: 'd', expr: '(PWNED_CANARY)(1)' }] } },
      'lavaan',
      /Invalid expression/,
    );
    const loop = { name: 'q', variable: 'm', from: 0, to: 1, by: 0.5 };
    const bsem = {
      ...cb,
      missing: 'casewise',
      engine: 'inlavaan',
      identification: 'marker',
      chains: 1,
      burnin: 100,
      sample: 200,
      seed: 1,
      confidence: 0.95,
      model: {
        ...cb.model,
        paths: cb.model.paths.map((p: Record<string, any>, i: number) =>
          i === 0 ? { ...p, label: 'la2' } : p,
        ),
      },
    };
    await refused(
      'ps_bsem',
      { ...bsem, loop: { ...loop, expr: '(PWNED_CANARY)(la2)' } },
      'INLAvaan',
      /Invalid expression/,
    );
    // The loop's expression sees the draws, the loop variable and arithmetic only.
    const ok = await script(
      'ps_bsem',
      { ...bsem, loop: { ...loop, expr: '(la2 * m)' } },
      'INLAvaan',
    );
    expect(ok.e).toBe('');
    expect(ok.s).toContain('parent = emptyenv()');
    expect(ok.s).toContain('eval(quote((la2 * m)), list2env(');
    expect(ok.s).not.toContain('with(draws');
    const run = await rCall<Record<string, any>>(
      'ps_bsem',
      { ...bsem, loop: { ...loop, expr: '(la2 * m)' } },
      'INLAvaan',
    );
    expect(run.loop.x).toEqual([0, 0.5, 1]);
    expect(run.loop.median[0]).toBe(0);
  }, 900_000);

  it('names that are not variables of the request', async () => {
    const cpa = base('ps_cpa');
    await refused('ps_cpa', { ...cpa, moderators: [PAYLOAD] }, 'manymome', /Unknown variable/);
    const endo = base('ps_endo');
    await refused(
      'ps_endo',
      { ...endo, method: 'het', endogenous: [endo.endogenous[0]], hetRegressors: [PAYLOAD] },
      'ivreg',
      /not in the dataset|Unknown variable/,
    );
  }, 900_000);

  it('the options of censored, inflated, multinomial and survival regressions', async () => {
    const req = {
      kind: 'regression',
      outcome: 't',
      predictors: ['x'],
      categorical: [],
      interactions: [],
      family: 'survival',
      link: 'logit',
      trials: '',
      weights: '',
      se: 'model',
      cluster: '',
      confidence: 0.95,
      status: 'd',
      statusCensored: false,
      cuts: [],
      categories: {},
      data: {
        names: ['t', 'x', 'd'],
        cols: [
          [1, 2, 3, 4],
          [0, 1, 0, 1],
          [1, 0, 1, 1],
        ],
      },
    };
    expect((await script('ps_regression', { ...req, cuts: [1, 2] }, 'regressionSurvival')).e).toBe(
      '',
    );
    await refused(
      'ps_regression',
      { ...req, cuts: [1, NUMBER] },
      'regressionSurvival',
      /Invalid interval cut point/,
    );
    await refused(
      'ps_regression',
      { ...req, status: PAYLOAD },
      'regressionSurvival',
      /not in the dataset/,
    );
    await refused(
      'ps_regression',
      { ...req, family: 'censored', censoring: PAYLOAD },
      'regressionSurvival',
      /Invalid censoring/,
    );
    await refused(
      'ps_regression',
      { ...req, family: 'multinomial', reference: PAYLOAD },
      'regression',
      /Invalid reference level/,
    );
  }, 900_000);
});
