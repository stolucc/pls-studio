// The latent class card's three-step analysis of auxiliary variables (R/items.R) against an independent implementation:
// StepMix 3.0.0 (Python; scripts/validation/lca_aux.py) on poLCA's election data (lca_aux.R): the 3-class model of the
// six Gore items, the classification-error matrix, the distal outcomes' BCH class means, and the covariates'
// multinomial logit by ML three-step (Vermunt 2010) and with BCH weights. StepMix has no analytic standard errors: the
// reference's sandwich standard errors come from numerical derivatives (complex step and central differences) of each
// case's contribution to the step-3 objective, not from the closed forms R uses.
// Tolerances: the classes come from poLCA's EM (10 random starts) and StepMix's, each converged to about 1e-10, and the
// logit from an optimiser; relative 1e-6 (estimates agree to about 1e-8 in desktop R; WebAssembly's floating point
// adds about 1e-6 relative in an optimiser's results).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseCsv } from '../engine/dataset';
import { near, same } from '../validation/record';
import { lcaR, lcaScriptR, type LcaAuxMethod } from './items';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const DIR = join(__dirname, '..', 'engine', '__fixtures__', 'lcaaux');
const data = parseCsv(readFileSync(join(DIR, 'election.csv'), 'utf8')).dataset;
const ref = JSON.parse(readFileSync(join(DIR, 'reference.json'), 'utf8'));
const ITEMS = ['MORALG', 'CARESG', 'KNOWG', 'LEADG', 'DISHONG', 'INTELG'];
const rel = (q: string, got: number, want: number, tol = 1e-6) =>
  near(q, got, want, tol * Math.max(1, Math.abs(want)));
const run = (method: LcaAuxMethod) =>
  lcaR(data, ITEMS, [2, 3], 10, 20261111, {
    aux: { distal: ['EDUC', 'AGE'], covariates: ['PARTY', 'GENDER'], method, classes: 3 },
  });

describe('three-step analysis of auxiliary variables (StepMix)', () => {
  it('ML three-step: classification errors, BCH distal means and the covariates’ logit equal StepMix’s', async () => {
    const r = await run('ml');
    const a = r.aux!;
    rel('log-likelihood (3 classes)', r.models[1].llik, ref.llik);
    r.models[1].shares.forEach((s, i) => rel(`share of class ${i + 1}`, s, ref.shares[i]));
    same('cases', a.n, ref.n);
    a.counts.forEach((n, i) => same(`assigned to class ${i + 1}`, n, ref.counts[i]));
    a.D.forEach((row, i) => row.forEach((v, j) => rel(`D[${i + 1}, ${j + 1}]`, v, ref.D[i][j])));
    a.distal!.forEach((d, j) => {
      const t = ref.distal[j];
      expect(d.name).toBe(t.name);
      d.means.forEach((m, i) => {
        rel(`${d.name}: mean of class ${i + 1}`, m, t.means[i]);
        rel(`${d.name}: SE of class ${i + 1}`, d.se[i], t.se[i]);
        rel(`${d.name}: SD of class ${i + 1}`, d.sd[i], t.sd[i]);
      });
      rel(`${d.name}: Wald χ²`, d.chisq, t.chisq);
      d.pairs.forEach((p, k) =>
        rel(`${d.name}: Wald χ² class ${p.a} = ${p.b}`, p.chisq, t.pairs[k][2]),
      );
    });
    const cv = a.covariates!;
    expect(cv.terms).toEqual(['Intercept', 'PARTY', 'GENDER']);
    same('reference class', cv.reference, 3);
    rel('step-3 log-likelihood', cv.logLik, ref.ml.logLik);
    cv.coefs.forEach((k, c) =>
      k.est.forEach((b, j) => {
        rel(`ML: class ${k.class} ${cv.terms[j]}`, b, ref.ml.est[c][j]);
        rel(`ML: SE class ${k.class} ${cv.terms[j]}`, k.se[j], ref.ml.se[c][j]);
      }),
    );
    cv.wald.forEach((w, j) => rel(`ML: Wald χ² ${cv.terms[j]}`, w.chisq, ref.ml.wald[j]));
  }, 600_000);

  it('BCH-weighted logit of the covariates equals StepMix’s', async () => {
    const cv = (await run('bch')).aux!.covariates!;
    rel('BCH: weighted log-likelihood', cv.logLik, ref.bch.logLik);
    cv.coefs.forEach((k, c) =>
      k.est.forEach((b, j) => {
        rel(`BCH: class ${k.class} ${cv.terms[j]}`, b, ref.bch.est[c][j]);
        rel(`BCH: SE class ${k.class} ${cv.terms[j]}`, k.se[j], ref.bch.se[c][j]);
      }),
    );
    cv.wald.forEach((w, j) => rel(`BCH: Wald χ² ${cv.terms[j]}`, w.chisq, ref.bch.wald[j]));
  }, 600_000);

  it('chooses the lowest-BIC model, a reference class, and exports the script', async () => {
    const r = await lcaR(data, ITEMS, [1, 2, 3], 10, 20261111, {
      aux: { distal: [], covariates: ['PARTY'], method: 'ml', reference: 1 },
    });
    const best = r.models.filter((m) => m.k >= 2).reduce((a, b) => (b.bic < a.bic ? b : a));
    same('classes chosen (lowest BIC of 2 or more)', r.aux!.k, best.k);
    same('reference class', r.aux!.covariates!.reference, 1);
    expect(r.aux!.covariates!.coefs.map((k) => k.class)).toEqual([2, 3].slice(0, best.k - 1));
    expect(r.aux!.distal).toBeUndefined();
    const script = await lcaScriptR(data, ITEMS, [2, 3], 10, 20261111, {
      aux: { distal: ['EDUC'], covariates: ['PARTY'], method: 'bch', classes: 3 },
    });
    expect(script).toContain('aux_errors <- function(post)');
    expect(script).toContain(
      'covariates <- aux_logit(X, e$s[ok], e$D, e$w[ok, , drop = FALSE], ref, "bch")',
    );
    expect(script).toContain(
      'distal <- lapply(c("EDUC"), function(v) aux_distal(as.numeric(aux[[v]]), e$w))',
    );
  }, 600_000);

  it('latent profiles and growth classes give their posterior probabilities to step 3', async () => {
    // (the same step 3 on another model's posteriors: EDUC and AGE as profile indicators, PARTY its covariate)
    const r = await lcaR(data, ['EDUC', 'AGE'], [2], 10, 1, {
      model: 'lpa',
      structure: 'VVI',
      aux: { distal: ['GENDER'], covariates: ['PARTY'], method: 'bch' },
    });
    same('classes', r.aux!.k, 2);
    same('cases', r.aux!.n, r.n);
    r.aux!.D.forEach((row) =>
      near(
        'row of D sums to 1',
        row.reduce((s, v) => s + v, 0),
        1,
        1e-12,
      ),
    );
    const g = await lcaR(data, ITEMS.slice(0, 4), [2], 5, 1, {
      model: 'lcga',
      aux: { distal: ['AGE'], covariates: [], method: 'ml' },
    });
    expect(g.aux!.distal![0].means).toHaveLength(2);
  }, 600_000);

  it('refuses auxiliary variables that are items', async () => {
    await expect(
      lcaR(data, ITEMS, [2], 2, 1, { aux: { distal: ['MORALG'], covariates: [], method: 'ml' } }),
    ).rejects.toThrow(/not items/);
  }, 600_000);
});
