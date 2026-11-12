// The robust, bootstrap and permutation alternatives (R/robust.R) of the t-test, ANOVA,
// correlation and regression cards against direct calls to WRS2, boot and coin with the same seed
// (scripts/validation/robust.R). Run natively with
//   WEBR_TESTS=1 PS_NATIVE_R=1 npx vitest run --dir src src/rengine/robust.webr.test.ts

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Dataset } from '../engine/types';
import { near } from '../validation/record';
import { regressionR } from './regression';
import type { BootInterval, ResamplingOptions } from './resampling';
import { anovaR, correlationR, ttestR, type TTestInput } from './tests';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

type Frame = { names: string[]; cols: number[][]; categories: Record<string, string[]> };
const ref = JSON.parse(
  readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'robust', 'reference.json'), 'utf8'),
) as Record<string, any>;
const data = (f: Frame): Dataset => ({
  names: f.names,
  cols: f.cols.map((c) => Float64Array.from(c)),
  ...(Object.keys(f.categories ?? {}).length ? { categories: f.categories } : {}),
});
// The same draws as desktop R (same seed and generator): closed forms and resampled statistics agree to
// WebAssembly's floating-point differences, ~1e-12; 1e-6 relative leaves room.
const close = (what: string, a: number | null | undefined, b: number) =>
  near(what, a ?? NaN, b, 1e-6 * Math.max(1, Math.abs(b)));
function boot(
  what: string,
  got: BootInterval | null | undefined,
  want: BootInterval,
  bcaTolerance?: number,
) {
  close(`${what} estimate`, got?.estimate, want.estimate);
  close(`${what} bootstrap SE`, got?.se, want.se);
  close(`${what} percentile low`, got?.percLow, want.percLow);
  close(`${what} percentile high`, got?.percHigh, want.percHigh);
  const bca = (q: string, a: number | null | undefined, b: number) =>
    bcaTolerance === undefined ? close(q, a, b) : near(q, a ?? NaN, b, bcaTolerance);
  bca(`${what} BCa low`, got?.bcaLow, want.bcaLow);
  bca(`${what} BCa high`, got?.bcaHigh, want.bcaHigh);
}
/** A Monte Carlo p-value against the exact one: within four standard errors of the resampling. */
function monteCarlo(what: string, p: number, exact: number, resamples: number) {
  const se = Math.sqrt((exact * (1 - exact)) / resamples);
  near(`${what} (Monte Carlo against exact)`, p, exact, 4 * se);
}
const ALL: ResamplingOptions = {
  trimmed: true,
  trim: 0.2,
  bootstrap: true,
  permutation: true,
  resamples: ref.resamples,
};
const T: Omit<TTestInput, 'type' | 'vars'> = {
  pairs: [],
  group: '',
  testValue: 0,
  student: true,
  welch: false,
  rank: false,
  alternative: 'two.sided',
  confidence: 0.95,
  resampling: ALL,
  seed: ref.seed,
};

describe('robust and resampling t-tests', () => {
  it('independent samples: Yuen, bootstrap of the mean difference, permutation', async () => {
    const r = await ttestR(data(ref.toothgrowth), {
      ...T,
      type: 'independent',
      vars: ['len'],
      group: 'supp',
    });
    const x = r.rows[0].resampling!;
    const w = ref.independent;
    close('Yuen difference', x.trimmed!.estimate, w.trimmed.estimate);
    close('Yuen t', x.trimmed!.t, w.trimmed.t);
    close('Yuen df', x.trimmed!.df, w.trimmed.df);
    close('Yuen p', x.trimmed!.p, w.trimmed.p);
    close('Yuen CI low', x.trimmed!.ciLow, w.trimmed.ciLow);
    close('Yuen CI high', x.trimmed!.ciHigh, w.trimmed.ciHigh);
    close('Yuen effect size', x.trimmed!.effsize, w.trimmed.effsize);
    boot('mean difference', x.bootstrap, w.bootstrap);
    close('permutation z', x.permutation!.z, w.permutation.z);
    close('permutation p', x.permutation!.p, w.permutation.p);
    expect(r.resampling).toMatchObject({ resamples: ref.resamples, seed: ref.seed });
  }, 600_000);

  it('paired samples: Yuen (yuend), bootstrap, sign-flip permutation', async () => {
    const r = await ttestR(data(ref.sleep), {
      ...T,
      type: 'paired',
      vars: [],
      pairs: [['extra.1', 'extra.2']],
    });
    const x = r.rows[0].resampling!;
    const w = ref.paired;
    close('yuend difference', x.trimmed!.estimate, w.trimmed.estimate);
    close('yuend SE', x.trimmed!.se, w.trimmed.se);
    close('yuend t', x.trimmed!.t, w.trimmed.t);
    close('yuend p', x.trimmed!.p, w.trimmed.p);
    close('yuend CI low', x.trimmed!.ciLow, w.trimmed.ciLow);
    boot('mean difference', x.bootstrap, w.bootstrap);
    close('permutation p', x.permutation!.p, w.permutation.p);
    monteCarlo('permutation p', x.permutation!.p, w.permutation.exact, ref.resamples);
  }, 600_000);

  it('one sample: trimmed-mean t-test, bootstrap of the mean, sign-flip permutation', async () => {
    const r = await ttestR(data(ref.sleep), {
      ...T,
      type: 'one',
      vars: ['extra.1'],
      testValue: 0.5,
    });
    const x = r.rows[0].resampling!;
    const w = ref.one;
    close('trimmed mean', x.trimmed!.estimate, w.trimmed.estimate);
    close('trimmed SE', x.trimmed!.se, w.trimmed.se);
    close('trimmed t', x.trimmed!.t, w.trimmed.t);
    close('trimmed df', x.trimmed!.df, w.trimmed.df);
    close('trimmed p', x.trimmed!.p, w.trimmed.p);
    close('trimmed CI high', x.trimmed!.ciHigh, w.trimmed.ciHigh);
    // BCa's bias correction counts the resampled means strictly below the sample mean (boot 1.3.32, boot.ci). With
    // ten values recorded to 0.1, many resampled means equal the sample mean, 0.75, exactly, and whether each counts
    // as below it is decided by the last bit of mean(): R accumulates in long double, which is 64 bits in desktop R
    // 4.6.2 on Apple silicon and 128 bits in webR 0.6.0 (R 4.6.0, WebAssembly), so desktop R counts 1031 below and
    // webR 1028 on the same 2,000 draws. The endpoints then move by up to one step of the resampled means' grid (0.01).
    boot('mean', x.bootstrap, w.bootstrap, 0.01);
    close('permutation p', x.permutation!.p, w.permutation.p);
    monteCarlo('permutation p', x.permutation!.p, w.permutation.exact, ref.resamples);
  }, 600_000);
});

describe('robust and permutation ANOVA', () => {
  const A = {
    dependent: 'len',
    covariates: [],
    ssType: 'III' as const,
    interactions: true,
    confidence: 0.95,
    seed: ref.seed,
  };
  it('one way: t1way with its effect size, permutation test', async () => {
    const r = await anovaR(data(ref.toothgrowth), {
      ...A,
      factors: ['dose'],
      resampling: { ...ALL, bootstrap: false },
    });
    const x = r.resampling as any;
    const w = ref.anova;
    close('t1way F', x.robust[0].stat, w.t1way.stat);
    close('t1way df2', x.robust[0].df2, w.t1way.df2);
    close('t1way p', x.robust[0].p, w.t1way.p);
    close('t1way effect size', x.robust[0].effsize, w.t1way.effsize);
    close('t1way effect size CI low', x.robust[0].effsizeLow, w.t1way.effsizeLow);
    close('permutation statistic', x.permutation.stat, w.permutation.stat);
    close('permutation p', x.permutation.p, w.permutation.p);
  }, 600_000);

  it('two way: t2way', async () => {
    const r = await anovaR(data(ref.toothgrowth), {
      ...A,
      factors: ['supp', 'dose'],
      resampling: { ...ALL, bootstrap: false, permutation: false },
    });
    const x = (r.resampling as any).robust as { term: string; stat: number; p: number }[];
    expect(x.map((t) => t.term)).toEqual(['supp', 'dose', 'supp × dose']);
    x.forEach((t, i) => {
      close(`t2way Q ${t.term}`, t.stat, ref.anova.t2way.stat[i]);
      close(`t2way p ${t.term}`, t.p, ref.anova.t2way.p[i]);
    });
  }, 600_000);

  it('a permutation p-value near the asymptotic one (PlantGrowth)', async () => {
    const r = await anovaR(data(ref.plantgrowth), {
      ...A,
      dependent: 'weight',
      factors: ['group'],
      resampling: { ...ALL, trimmed: false, bootstrap: false },
    });
    const x = (r.resampling as any).permutation;
    close('permutation p', x.p, ref.plantPermutation.p);
    // (no exact distribution for three groups of ten: the asymptotic p, within the Monte Carlo error)
    monteCarlo('permutation p', x.p, ref.plantPermutation.asymptotic, ref.resamples);
  }, 600_000);
});

describe('bootstrap and permutation correlations and regression', () => {
  for (const method of ['pearson', 'spearman'] as const)
    it(`${method}: bootstrap interval and permutation test of every pair`, async () => {
      const r = await correlationR(data(ref.mtcars), {
        vars: ['mpg', 'wt', 'qsec'],
        method,
        alternative: 'two.sided',
        deletion: 'pairwise',
        confidence: 0.95,
        resampling: { ...ALL, trimmed: false },
        seed: ref.seed,
      });
      const w = ref.correlation[method];
      r.pairs.forEach((p, i) => {
        boot(`${method} ${p.a}–${p.b}`, p.bootstrap, w.bootstrap[i]);
        close(`${method} ${p.a}–${p.b} permutation z`, p.permutation!.z, w.permutation[i].z);
        close(`${method} ${p.a}–${p.b} permutation p`, p.permutation!.p, w.permutation[i].p);
      });
    }, 600_000);

  it('linear regression: bootstrap intervals of the coefficients', async () => {
    const r = await regressionR(data(ref.mtcars2), {
      outcome: 'mpg',
      predictors: ['wt', 'hp'],
      categorical: [],
      interactions: [],
      family: 'gaussian',
      link: 'logit',
      trials: '',
      weights: '',
      se: 'model',
      cluster: '',
      confidence: 0.95,
      resampling: { ...ALL, trimmed: false, permutation: false },
      seed: ref.seed,
    });
    const rows = r.bootstrap!.rows;
    expect(rows.map((b) => b.term)).toEqual(['(Intercept)', 'wt', 'hp']);
    rows.forEach((b, i) => boot(`β ${b.term}`, b, ref.regression[i]));
  }, 600_000);
});
