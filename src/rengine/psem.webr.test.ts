// The Piecewise SEM card (R/psem.R) against piecewiseSEM called directly (scripts/validation/psem.R) on its own data:
// the help page's keeley model; a Poisson outcome with a variable in no path and a correlated error; shipley's path
// model with a random intercept per site (lmer, glmer); and a binomial glm with both standardisations. Every
// d-separation test, Fisher's C, AIC / AICc, coefficient, standardised coefficient and R², unrounded, and the values
// piecewiseSEM's summary() and coefs() print (rounded) reproduced by rounding.
// Tolerances: relative 1e-6 for the linear and generalised linear models (closed forms or IRLS to convergence);
// 1e-5 for the mixed models (lme4's optimiser; WebAssembly's floating point moves optimiser results by ~1e-6).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Dataset } from '../engine/types';
import { near, same } from '../validation/record';
import { rCall } from './bridge';
import { psemR, psemScriptR, type PsemInput, type PsemResult, type PsemStructure } from './psem';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const ref = JSON.parse(
  readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'psem', 'reference.json'), 'utf8'),
);

interface RefCase {
  claims: { claim: string; df: number; stat: number; p: number }[];
  fisherC: number;
  fisherRounded: { 'Fisher.C': number; df: number; 'P.Value': number };
  aic: number;
  aicc: number;
  aicRounded: { AIC: number; AICc: number; K: number; n: number };
  coefs: {
    response: string;
    predictor: string;
    est: number;
    se: number | null;
    df: number;
    stat: number;
    p: number;
    std: number | null;
    stdRounded: number | null;
  }[];
  r2: Record<string, number | string>[];
}

async function dataset(name: string): Promise<Dataset> {
  const raw = await rCall<{ names: string[]; cols: (number | null)[][] }>(
    'ps_dataset',
    { package: 'piecewiseSEM', name, na: [] },
    'piecewiseSEM',
  );
  return {
    names: raw.names,
    cols: raw.cols.map((col) => Float64Array.from(col, (v) => (typeof v === 'number' ? v : NaN))),
  };
}

const relative = (tol: number) => (q: string, got: number | null, want: number | null) => {
  if (want === null) {
    expect(got, q).toBeNull();
    return;
  }
  near(q, got ?? NaN, want, tol * Math.max(1, Math.abs(want)));
};
const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;

/** A looser relative tolerance for the equations of some responses (and the sums over all equations). */
interface Looser {
  responses: string[];
  tol: number;
}

/**
 * Every number of a result against a reference case. With `looser`, the numbers of its responses' equations (their
 * tests of directed separation, coefficients and R²) and the sums over all equations (Fisher's C, AIC) are compared
 * within its tolerance, and the values summary(), fisherC() and coefs() print within the tolerance of the unrounded
 * value and half a printed unit instead of exactly.
 */
function compare(label: string, r: PsemResult, t: RefCase, tol: number, looser?: Looser) {
  const tolOf = (response?: string) =>
    looser && (response === undefined || looser.responses.includes(response)) ? looser.tol : tol;
  const rel = (response?: string) => relative(tolOf(response));
  // (as printed, rounded to `d` decimals)
  const printed = (q: string, got: number, want: number, d: number, response?: string) =>
    looser
      ? near(q, round(got, d), want, tolOf(response) * Math.max(1, Math.abs(want)) + 10 ** -d / 2)
      : same(q, round(got, d), want);
  same(`${label}: claims`, r.claims.length, t.claims.length);
  r.claims.forEach((k, i) => {
    const text = `${k.y} ~ ${[k.x, ...k.given].join(' + ')}`;
    same(`${label}: claim ${i + 1}`, text, t.claims[i].claim);
    rel(k.y)(`${label}: ${text}: df`, k.df, t.claims[i].df);
    rel(k.y)(`${label}: ${text}: statistic`, k.stat, t.claims[i].stat);
    rel(k.y)(`${label}: ${text}: p`, k.p, t.claims[i].p);
  });
  rel()(`${label}: Fisher's C`, r.fisherC, t.fisherC);
  printed(`${label}: Fisher's C as fisherC() prints it`, r.fisherC, t.fisherRounded['Fisher.C'], 3);
  same(`${label}: df`, r.df, t.fisherRounded.df);
  printed(`${label}: p as fisherC() prints it`, r.p!, t.fisherRounded['P.Value'], 3);
  rel()(`${label}: AIC`, r.aic, t.aic);
  rel()(`${label}: AICc`, r.aicc, t.aicc);
  printed(`${label}: AIC as summary() prints it`, r.aic, t.aicRounded.AIC, 3);
  same(`${label}: K`, r.k, t.aicRounded.K);
  same(`${label}: n`, r.n, t.aicRounded.n);
  same(`${label}: coefficients`, r.coefs.length, t.coefs.length);
  r.coefs.forEach((k, i) => {
    const x = t.coefs[i];
    const what = `${label}: ${k.correlation ? '~~' : ''}${k.response} ← ${k.predictor}`;
    expect(`${k.correlation ? '~~' : ''}${k.response}`).toBe(x.response);
    const c = rel(k.response);
    c(`${what}: estimate`, k.est, x.est);
    c(`${what}: SE`, k.se, x.se);
    c(`${what}: df`, k.df, x.df);
    c(`${what}: statistic`, k.stat, x.stat);
    c(`${what}: p`, k.p, x.p);
    c(`${what}: standardised`, k.std, x.std);
    if (x.stdRounded !== null)
      printed(`${what}: standardised as coefs() prints it`, k.std!, x.stdRounded, 4, k.response);
  });
  r.r2.forEach((x, i) => {
    const y = t.r2[i];
    const c = rel(x.response);
    same(`${label}: R² response ${i + 1}`, x.response, y.Response);
    if (typeof y['R.squared'] === 'number') c(`${label}: R² ${x.response}`, x.r2, y['R.squared']);
    if (typeof y.Marginal === 'number')
      c(`${label}: marginal R² ${x.response}`, x.marginal, y.Marginal);
    if (typeof y.Conditional === 'number')
      c(`${label}: conditional R² ${x.response}`, x.conditional, y.Conditional);
  });
}

const KEELEY: PsemStructure = {
  equations: [
    { y: 'rich', x: ['cover'] },
    { y: 'cover', x: ['firesev'] },
    { y: 'firesev', x: ['age'] },
  ],
  isolated: [],
  correlations: [],
};
const POISSON: PsemStructure = {
  equations: [
    { y: 'firesev', x: ['age'] },
    { y: 'cover', x: ['firesev'] },
    { y: 'rich', x: ['cover', 'distance'] },
  ],
  isolated: ['hetero'],
  correlations: [['cover', 'hetero']],
};
const SHIPLEY: PsemStructure = {
  equations: [
    { y: 'DD', x: ['lat'] },
    { y: 'Date', x: ['DD'] },
    { y: 'Growth', x: ['Date'] },
    { y: 'Live', x: ['Growth'] },
  ],
  isolated: [],
  correlations: [],
};
const normal: PsemInput = { families: {}, standardize: 'latent.linear' };

describe('piecewise SEM (piecewiseSEM)', () => {
  it('the help page’s keeley model equals piecewiseSEM', async () => {
    const r = await psemR(await dataset('keeley'), KEELEY, normal);
    compare('keeley', r, ref.keeley, 1e-6);
    expect(r.warnings).toEqual([]);
    const script = await psemScriptR(await dataset('keeley'), KEELEY, normal);
    expect(script).toContain('lm(rich ~ cover, data = data)');
    expect(script).toContain(
      'dsep <- quiet(dSep(model, conditioning = TRUE, .progressBar = FALSE))',
    );
  }, 600_000);

  it('a Poisson outcome, a variable in no path and a correlated error equal piecewiseSEM', async () => {
    // (a correlated error: hetero is no outcome, so the canvas's psemStructure would drop it; the request keeps it)
    const r = await psemR(await dataset('keeley'), POISSON, {
      families: { rich: 'poisson' },
      standardize: 'latent.linear',
    });
    compare('poisson', r, ref.poisson, 1e-6);
    expect(r.coefs.filter((k) => k.correlation).map((k) => [k.response, k.predictor])).toEqual([
      ['cover', 'hetero'],
    ]);
  }, 600_000);

  it('random intercepts per site (lmer, glmer binomial) equal piecewiseSEM', async () => {
    const r = await psemR(await dataset('shipley'), SHIPLEY, {
      families: { Live: 'binomial' },
      group: 'site',
      standardize: 'latent.linear',
    });
    // Live is fitted by glmer, whose optimum and standard errors differ between lme4 versions: desktop R's reference
    // is lme4 2.1.0, webR's library has lme4 2.0-6 (the newest built for webR). The z statistic of Live ← Growth is
    // 7.90865 in desktop R and 7.93202 in webR (3e-3 relative), the claim Live ~ lat + Growth's 0.857069 and 0.858047
    // (1e-3); desktop R with lme4 2.0-6 gives 7.93156 and 0.858075, within 6e-5 of webR (glmer's standard errors come
    // from a finite-difference Hessian). The lmer equations agree to 1e-10. Until webR's lme4 is 2.1.0, Live's numbers
    // and the sums over the equations are compared in webR within 5e-3 relative.
    compare(
      'shipley',
      r,
      ref.shipley,
      1e-5,
      process.env.PS_NATIVE_R ? undefined : { responses: ['Live'], tol: 5e-3 },
    );
    expect(r.engine.lme4).toBeTruthy();
  }, 600_000);

  it('a binomial glm, latent-theoretic and observation-empirical standardisation, equals piecewiseSEM', async () => {
    const d = await dataset('shipley');
    compare(
      'binomial LT',
      await psemR(d, SHIPLEY, { families: { Live: 'binomial' }, standardize: 'latent.linear' }),
      ref.binomialLT,
      1e-6,
    );
    compare(
      'binomial OE',
      await psemR(d, SHIPLEY, { families: { Live: 'binomial' }, standardize: 'Menard.OE' }),
      ref.binomialOE,
      1e-6,
    );
  }, 600_000);

  it('refuses a grouping column that is a model variable', async () => {
    await expect(
      psemR(await dataset('keeley'), KEELEY, { ...normal, group: 'age' }),
    ).rejects.toThrow(/not a variable of the model/);
  }, 600_000);
});
