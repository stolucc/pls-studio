// The Meta-analysis card's bridge (R/meta.R) against metafor called directly (scripts/validation/meta.R) on metadat's
// datasets: dat.bcg (?rma's random-effects model and meta-regression, every tau² estimator, Knapp–Hartung, a
// categorical moderator, effect sizes given with their standard errors, odds ratios and risk differences),
// dat.normand1999 (SMD, MD), dat.molloy2014 (Fisher's z), dat.pritz1997 (proportions) and dat.konstantopoulos2011
// (?rma.mv's three-level model). Coefficients, heterogeneity, Q tests, pooled estimates with prediction intervals,
// back-transformations, publication bias and influence diagnostics.
// Tolerances: relative 1e-6 for closed forms (escalc, FE, DL, HE, HS, SJ, the regression tests); 1e-5 for estimates
// found by iteration (REML, ML, PM, EB, the Q-profile intervals, trim-and-fill, rma.mv), which WebAssembly's floating
// point moves by ~1e-6.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Dataset } from '../engine/types';
import { near, same } from '../validation/record';
import { metaR, metaScriptR, type MetaInput, type MetaResult } from './meta';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const ref = JSON.parse(
  readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'meta', 'reference.json'), 'utf8'),
);

const CLOSED = 1e-6;
const ITERATED = 1e-5;

interface Interval {
  est: number;
  ciLow: number;
  ciHigh: number;
  piLow: number;
  piHigh: number;
}
interface RefModel {
  k: number;
  yi: number[];
  vi: number[];
  weights: number[];
  coefs: { term: string; est: number; se: number; p: number; ciLow: number; ciHigh: number }[];
  Q: number;
  Qp: number;
  logLik: number;
  tau2?: number;
  tau2se?: number;
  I2?: number | number[];
  H2?: number;
  sigma2?: number[];
  ci?: { tau2: number[]; tau: number[]; I2: number[]; H2: number[] };
  pooled?: Interval;
  pooledBack?: Interval;
  QM?: number;
  QMp?: number;
  R2?: number;
}

const dataset = (d: { names: string[]; cols: (number | null)[][] }): Dataset => ({
  names: d.names,
  cols: d.cols.map((col) => Float64Array.from(col, (v) => (typeof v === 'number' ? v : NaN))),
});

const relative = (tol: number) => (q: string, got: number | null | undefined, want: number) =>
  near(q, got ?? NaN, want, tol * Math.max(1, Math.abs(want)));

function compareInterval(label: string, got: Interval | null, want: Interval, tol: number) {
  const rel = relative(tol);
  expect(got, label).not.toBeNull();
  rel(`${label}: estimate`, got!.est, want.est);
  rel(`${label}: CI lower`, got!.ciLow, want.ciLow);
  rel(`${label}: CI upper`, got!.ciHigh, want.ciHigh);
  rel(`${label}: prediction interval lower`, got!.piLow, want.piLow);
  rel(`${label}: prediction interval upper`, got!.piHigh, want.piHigh);
}

/** Every number of a model against metafor's. */
function compare(label: string, r: MetaResult, t: RefModel, tol: number) {
  const rel = relative(tol);
  same(`${label}: k`, r.k, t.k);
  r.studies.forEach((s, i) => {
    relative(CLOSED)(`${label}: study ${i + 1} yi`, s.yi, t.yi[i]);
    relative(CLOSED)(`${label}: study ${i + 1} vi`, s.vi, t.vi[i]);
    rel(`${label}: study ${i + 1} weight`, s.weight, t.weights[i]);
  });
  same(`${label}: coefficients`, r.coefs.length, t.coefs.length);
  r.coefs.forEach((k, i) => {
    const x = t.coefs[i];
    rel(`${label}: ${x.term} estimate`, k.est, x.est);
    rel(`${label}: ${x.term} SE`, k.se, x.se);
    rel(`${label}: ${x.term} p`, k.p, x.p);
    rel(`${label}: ${x.term} CI lower`, k.ciLow, x.ciLow);
    rel(`${label}: ${x.term} CI upper`, k.ciHigh, x.ciHigh);
  });
  rel(`${label}: Q`, r.Q, t.Q);
  rel(`${label}: Q p`, r.Qp, t.Qp);
  rel(`${label}: log-likelihood`, r.fit.logLik, t.logLik);
  const h = r.heterogeneity;
  if (t.tau2 !== undefined) rel(`${label}: tau²`, h.tau2, t.tau2);
  if (t.tau2se !== undefined) rel(`${label}: SE of tau²`, h.tau2se, t.tau2se);
  if (typeof t.I2 === 'number') rel(`${label}: I²`, h.I2 as number, t.I2);
  if (t.H2 !== undefined) rel(`${label}: H²`, h.H2, t.H2);
  if (t.sigma2) t.sigma2.forEach((s, i) => rel(`${label}: sigma² ${i + 1}`, h.sigma2?.[i], s));
  if (Array.isArray(t.I2)) {
    (t.I2 as number[]).forEach((v, i) =>
      rel(`${label}: I² level ${i + 1}`, (h.I2 as number[])[i], v),
    );
  }
  if (t.ci) {
    for (const key of ['tau2', 'tau', 'I2', 'H2'] as const) {
      const b = h.ci?.[key];
      rel(`${label}: ${key} CI lower`, b?.ciLow, t.ci[key][1]);
      rel(`${label}: ${key} CI upper`, b?.ciHigh, t.ci[key][2]);
    }
  }
  if (t.pooled) compareInterval(`${label}: pooled`, r.pooled, t.pooled, tol);
  if (t.pooledBack) compareInterval(`${label}: back-transformed`, r.pooledBack, t.pooledBack, tol);
  if (t.QM !== undefined) {
    rel(`${label}: QM`, r.QM, t.QM);
    rel(`${label}: QM p`, r.QMp, t.QMp!);
  }
  if (t.R2 !== undefined) rel(`${label}: R²`, h.R2, t.R2);
}

const BASE: MetaInput = {
  measure: 'RR',
  columns: { ai: 'tpos', bi: 'tneg', ci: 'cpos', di: 'cneg' },
  varType: 'vi',
  method: 'REML',
  knha: false,
  transf: 'none',
  moderators: [],
  categorical: [],
  cluster: '',
  label: '',
  bias: false,
  influence: false,
  confidence: 0.95,
};
const SMD_COLUMNS = {
  m1i: 'm1i',
  sd1i: 'sd1i',
  n1i: 'n1i',
  m2i: 'm2i',
  sd2i: 'sd2i',
  n2i: 'n2i',
};

describe('meta-analysis (metafor)', () => {
  const bcg = dataset(ref.bcg.data);

  it('?rma: the random-effects model of dat.bcg, with publication bias and influence, equals metafor', async () => {
    const r = await metaR(bcg, { ...BASE, label: 'trial', bias: true, influence: true });
    compare('bcg', r, ref.bcg.re, ITERATED);
    expect(r.studies.map((s) => s.label)).toEqual(ref.bcg.data.cols[0].map(String));
    const b = ref.bcg.re.bias;
    const closed = relative(CLOSED);
    const iterated = relative(ITERATED);
    iterated('Egger z', r.bias!.egger.stat, b.egger.stat);
    iterated('Egger p', r.bias!.egger.p, b.egger.p);
    iterated('Egger limit estimate', r.bias!.egger.est, b.egger.est);
    iterated('rank correlation tau', r.bias!.rank.tau, b.rank.tau);
    iterated('rank correlation p', r.bias!.rank.p, b.rank.p);
    same('trim-and-fill k0', r.bias!.trimfill.k0, b.trimfill.k0);
    same('trim-and-fill side', r.bias!.trimfill.side, b.trimfill.side);
    iterated('trim-and-fill estimate', r.bias!.trimfill.est, b.trimfill.est);
    iterated('trim-and-fill SE', r.bias!.trimfill.se, b.trimfill.se);
    iterated('trim-and-fill CI lower', r.bias!.trimfill.ciLow, b.trimfill.ciLow);
    iterated('trim-and-fill filled study', r.bias!.trimfill.filled[0].yi, b.trimfill.filled);
    for (const key of ['pet', 'peese'] as const) {
      closed(`${key} t`, r.bias![key].stat, b[key].stat);
      closed(`${key} p`, r.bias![key].p, b[key].p);
      closed(`${key} limit estimate`, r.bias![key].est, b[key].est);
      closed(`${key} CI lower`, r.bias![key].ciLow, b[key].ciLow);
      closed(`${key} CI upper`, r.bias![key].ciHigh, b[key].ciHigh);
    }
    const inf = ref.bcg.re.influence;
    r.influence!.forEach((s, i) => {
      iterated(`study ${i + 1} studentised residual`, s.rstudent, inf.rstudent[i]);
      iterated(`study ${i + 1} DFFITS`, s.dffits, inf.dffits[i]);
      iterated(`study ${i + 1} Cook's distance`, s.cook, inf.cook[i]);
      iterated(`study ${i + 1} covariance ratio`, s.covr, inf.covr[i]);
      iterated(`study ${i + 1} tau² without`, s.tau2del, inf.tau2del[i]);
      iterated(`study ${i + 1} hat`, s.hat, inf.hat[i]);
      same(`study ${i + 1} influential`, String(s.influential), String(inf.influential[i]));
    });
    const loo = ref.bcg.re.leaveOneOut;
    r.leaveOneOut!.forEach((s, i) => {
      iterated(`without study ${i + 1}: estimate`, s.est, loo.est[i]);
      iterated(`without study ${i + 1}: SE`, s.se, loo.se[i]);
      iterated(`without study ${i + 1}: tau²`, s.tau2, loo.tau2[i]);
      iterated(`without study ${i + 1}: I²`, s.I2, loo.I2[i]);
    });
    expect(r.warnings).toEqual([]);
  }, 600_000);

  it('every tau² estimator (FE, ML, DL, PM, HE, SJ, EB, HS) equals metafor', async () => {
    for (const method of ['FE', 'ML', 'DL', 'PM', 'HE', 'SJ', 'EB', 'HS'] as const) {
      const r = await metaR(bcg, { ...BASE, method });
      const closedForm = ['FE', 'DL', 'HE', 'HS', 'SJ'].includes(method);
      compare(`bcg ${method}`, r, ref.bcg.methods[method], closedForm ? CLOSED : ITERATED);
    }
  }, 600_000);

  it('?rma: the meta-regression on ablat and year, with and without Knapp–Hartung, equals metafor', async () => {
    const mods = { ...BASE, moderators: ['ablat', 'year'] };
    compare('bcg moderators', await metaR(bcg, mods), ref.bcgMods, ITERATED);
    const knha = await metaR(bcg, { ...mods, knha: true });
    compare('bcg Knapp–Hartung', knha, ref.bcgKnha, ITERATED);
    expect(knha.QMdf).toEqual([2, 10]);
    expect(knha.coefs.map((k) => k.term)).toEqual(['intrcpt', 'ablat', 'year']);
  }, 600_000);

  it('a categorical moderator is dummy-coded as factor() in metafor', async () => {
    const r = await metaR(bcg, { ...BASE, moderators: ['alloc'], categorical: ['alloc'] });
    compare('bcg alloc', r, ref.bcgAlloc, ITERATED);
    expect(r.coefs.map((k) => k.term)).toEqual(['intrcpt', 'factor(alloc)2', 'factor(alloc)3']);
  }, 600_000);

  it('effect sizes given with standard errors, odds ratios and risk differences equal metafor', async () => {
    const yi = ref.bcgGen.yi as number[];
    const se = (ref.bcgGen.vi as number[]).map(Math.sqrt);
    const given: Dataset = {
      names: ['yi', 'se'],
      cols: [Float64Array.from(yi), Float64Array.from(se)],
    };
    const gen = await metaR(given, {
      ...BASE,
      measure: 'GEN',
      varType: 'sei',
      columns: { yi: 'yi', sei: 'se' },
      transf: 'exp',
    });
    compare('bcg GEN (sei)', gen, ref.bcgGen, ITERATED);
    relative(ITERATED)(
      'GEN back-transformed',
      gen.pooledBack?.est,
      Math.exp(ref.bcgGen.pooled.est),
    );
    compare('bcg OR', await metaR(bcg, { ...BASE, measure: 'OR' }), ref.bcgOR, ITERATED);
    compare(
      'bcg RD',
      await metaR(bcg, { ...BASE, measure: 'RD', method: 'DL' }),
      ref.bcgRD,
      CLOSED,
    );
  }, 600_000);

  it('standardised and raw mean differences (dat.normand1999) equal metafor', async () => {
    const d = dataset(ref.normand.data);
    const smd = { ...BASE, measure: 'SMD' as const, columns: SMD_COLUMNS };
    const r = await metaR(d, smd);
    compare('normand SMD', r, ref.normand.smd, ITERATED);
    // (metafor's own advice on this dataset: a Hedges' g above 2 in absolute value)
    expect(r.warnings.some((w) => /unusually large/.test(w))).toBe(true);
    compare('normand SMD FE', await metaR(d, { ...smd, method: 'FE' }), ref.normand.smdFE, CLOSED);
    const md = { ...smd, measure: 'MD' as const, method: 'DL' as const };
    compare('normand MD', await metaR(d, md), ref.normand.md, CLOSED);
  }, 600_000);

  it('correlations as Fisher’s z (dat.molloy2014), back-transformed to r, equal metafor', async () => {
    const d = dataset(ref.molloy.data);
    const z = { ...BASE, measure: 'ZCOR' as const, columns: { ri: 'ri', ni: 'ni' } };
    compare('molloy', await metaR(d, z), ref.molloy.zcor, ITERATED);
    compare('molloy PM', await metaR(d, { ...z, method: 'PM' }), ref.molloy.zcorPM, ITERATED);
  }, 600_000);

  it('proportions, logit and raw (dat.pritz1997), equal metafor', async () => {
    const d = dataset(ref.pritz.data);
    const plo = { ...BASE, measure: 'PLO' as const, columns: { xi: 'xi', ni: 'ni' } };
    compare('pritz PLO', await metaR(d, plo), ref.pritz.plo, ITERATED);
    const pr = { ...plo, measure: 'PR' as const, method: 'FE' as const };
    compare('pritz PR', await metaR(d, pr), ref.pritz.pr, CLOSED);
  }, 600_000);

  it('?rma.mv: the three-level model of dat.konstantopoulos2011 equals metafor', async () => {
    const d = dataset(ref.konstantopoulos.data);
    const three = {
      ...BASE,
      measure: 'GEN' as const,
      columns: { yi: 'yi', vi: 'vi' },
      cluster: 'district',
    };
    const r = await metaR(d, three);
    compare('three-level', r, ref.konstantopoulos.threeLevel, ITERATED);
    same('three-level clusters', r.heterogeneity.clusters ?? 0, 11);
    const year = { ...three, moderators: ['year'], method: 'ML' as const };
    compare('three-level year', await metaR(d, year), ref.konstantopoulos.threeLevelYear, ITERATED);
  }, 600_000);

  it('writes the script it runs, and refuses a three-level model by DL', async () => {
    const script = await metaScriptR(bcg, { ...BASE, bias: true });
    expect(script).toContain(
      'dat <- escalc(measure = "RR", ai = tpos, bi = tneg, ci = cpos, di = cneg, data = data)',
    );
    expect(script).toContain('res <- rma(yi, vi, data = dat, method = "REML", level = 95)');
    expect(script).toContain('filled <- trimfill(res)');
    const d = dataset(ref.konstantopoulos.data);
    await expect(
      metaR(d, {
        ...BASE,
        measure: 'GEN',
        columns: { yi: 'yi', vi: 'vi' },
        cluster: 'district',
        method: 'DL',
      }),
    ).rejects.toThrow(/REML or ML/);
  }, 600_000);
});
