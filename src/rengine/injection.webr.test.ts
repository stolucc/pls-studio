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
import { R_PACKAGES, rScript, type RPackage } from './bridge';
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
