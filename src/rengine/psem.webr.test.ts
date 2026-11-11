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

/** Every number of a result against a reference case. */
function compare(label: string, r: PsemResult, t: RefCase, tol: number) {
  const rel = relative(tol);
  same(`${label}: claims`, r.claims.length, t.claims.length);
  r.claims.forEach((k, i) => {
    const text = `${k.y} ~ ${[k.x, ...k.given].join(' + ')}`;
    same(`${label}: claim ${i + 1}`, text, t.claims[i].claim);
    rel(`${label}: ${text}: df`, k.df, t.claims[i].df);
    rel(`${label}: ${text}: statistic`, k.stat, t.claims[i].stat);
    rel(`${label}: ${text}: p`, k.p, t.claims[i].p);
  });
  rel(`${label}: Fisher's C`, r.fisherC, t.fisherC);
  same(
    `${label}: Fisher's C as fisherC() prints it`,
    round(r.fisherC, 3),
    t.fisherRounded['Fisher.C'],
  );
  same(`${label}: df`, r.df, t.fisherRounded.df);
  same(`${label}: p as fisherC() prints it`, round(r.p!, 3), t.fisherRounded['P.Value']);
  rel(`${label}: AIC`, r.aic, t.aic);
  rel(`${label}: AICc`, r.aicc, t.aicc);
  same(`${label}: AIC as summary() prints it`, round(r.aic, 3), t.aicRounded.AIC);
  same(`${label}: K`, r.k, t.aicRounded.K);
  same(`${label}: n`, r.n, t.aicRounded.n);
  same(`${label}: coefficients`, r.coefs.length, t.coefs.length);
  r.coefs.forEach((k, i) => {
    const x = t.coefs[i];
    const what = `${label}: ${k.correlation ? '~~' : ''}${k.response} ← ${k.predictor}`;
    expect(`${k.correlation ? '~~' : ''}${k.response}`).toBe(x.response);
    rel(`${what}: estimate`, k.est, x.est);
    rel(`${what}: SE`, k.se, x.se);
    rel(`${what}: df`, k.df, x.df);
    rel(`${what}: statistic`, k.stat, x.stat);
    rel(`${what}: p`, k.p, x.p);
    rel(`${what}: standardised`, k.std, x.std);
    if (x.stdRounded !== null)
      same(`${what}: standardised as coefs() prints it`, round(k.std!, 4), x.stdRounded);
  });
  r.r2.forEach((x, i) => {
    const y = t.r2[i];
    same(`${label}: R² response ${i + 1}`, x.response, y.Response);
    if (typeof y['R.squared'] === 'number') rel(`${label}: R² ${x.response}`, x.r2, y['R.squared']);
    if (typeof y.Marginal === 'number')
      rel(`${label}: marginal R² ${x.response}`, x.marginal, y.Marginal);
    if (typeof y.Conditional === 'number')
      rel(`${label}: conditional R² ${x.response}`, x.conditional, y.Conditional);
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
    compare('shipley', r, ref.shipley, 1e-5);
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
