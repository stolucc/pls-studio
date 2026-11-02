// The Bayesian tests (R/bayes.R) in webR against Bayes factors computed from
// their definitions by numerical integration in base R, without BayesFactor
// (scripts/validation/bayes.R), and BayesFactor's documented value for the
// sleep data. Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Dataset } from '../engine/types';
import { PACKAGE_EXAMPLES } from '../examples/packages';
import { withR } from './runtime';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';
import { banovaR, bbinomialR, bcontingencyR, bcorrelationR, bregressionR, brmanovaR, bttestR, type BTTestInput } from './tests';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

type Frame = { names: string[]; cols: number[][]; categories: Record<string, string[]> };
const ref = JSON.parse(readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'bayes', 'reference.json'), 'utf8')) as Record<string, any>;
/** Native BayesFactor in desktop R, same version and seeds (scripts/validation/bayes_native.R). */
const native = JSON.parse(readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'bayes', 'native.json'), 'utf8')) as Record<string, any>;
const data = (f: Frame): Dataset => ({ names: f.names, cols: f.cols.map((c) => Float64Array.from(c)), ...(Object.keys(f.categories ?? {}).length ? { categories: f.categories } : {}) });
/** Bayes factors to a relative 1e-5 (BayesFactor's quadrature against base R's). */
const bf = (a: number | null, b: number, what: string) => expect(Math.abs((a ?? NaN) / b - 1), `${what}: ${a} vs ${b}`).toBeLessThan(1e-5);
const B: Omit<BTTestInput, 'type' | 'vars'> = { pairs: [], group: '', testValue: 0, alternative: 'two.sided', priorWidth: Math.SQRT1_2, seed: 1234, iterations: 20000, confidence: 0.95 };

describe('Bayesian t-tests (JZS)', () => {
  it('paired: BayesFactor’s documented sleep example, and the posterior of delta', async () => {
    const r = await bttestR(data(ref.sleep), { ...B, type: 'paired', vars: [], pairs: [['drug1', 'drug2']] });
    bf(r.rows[0].bf10, ref.paired.bf10, 'BF10'); bf(r.rows[0].bf10, ref.paired.documented, 'documented');
    // (posterior by MCMC: within its Monte Carlo error)
    const [lo, med, hi] = ref.paired.delta as number[];
    expect(Math.abs(r.rows[0].delta.median - med)).toBeLessThan(0.03);
    expect(Math.abs(r.rows[0].delta.low - lo)).toBeLessThan(0.05); expect(Math.abs(r.rows[0].delta.high - hi)).toBeLessThan(0.05);
  }, 600_000);
  it('independent samples, two-sided and one-sided', async () => {
    for (const [alternative, want] of [['two.sided', ref.independent.bf10], ['greater', ref.independent.greater], ['less', ref.independent.less]] as const) {
      const r = await bttestR(data(ref.toothgrowth), { ...B, type: 'independent', vars: ['len'], group: 'supp', alternative });
      bf(r.rows[0].bf10, want, `BF10 ${alternative}`);
      expect(r.groups).toEqual(['OJ', 'VC']);
    }
  }, 600_000);
  it('one sample against a test value, with another prior width', async () => {
    const r = await bttestR(data(ref.toothgrowth), { ...B, type: 'one', vars: ['len'], testValue: 18, priorWidth: 1 });
    bf(r.rows[0].bf10, ref.one.bf10, 'BF10');
    const g = await bttestR(data(ref.toothgrowth), { ...B, type: 'one', vars: ['len'], testValue: 18, priorWidth: 1, alternative: 'greater' });
    bf(g.rows[0].bf10, ref.one.greater, 'BF+0');
  }, 600_000);
});

describe('Bayesian correlation and binomial test', () => {
  it('Pearson correlations: stretched beta prior, width 1 and 1/3, one-sided', async () => {
    const r = await bcorrelationR(data(ref.mtcars), { vars: ['mpg', 'wt', 'qsec'], alternative: 'two.sided', priorWidth: 1, seed: 1, iterations: 5000, confidence: 0.95 });
    const g = await bcorrelationR(data(ref.mtcars), { vars: ['mpg', 'wt', 'qsec'], alternative: 'greater', priorWidth: 1, seed: 1, iterations: 5000, confidence: 0.95 });
    const w = await bcorrelationR(data(ref.mtcars), { vars: ['mpg', 'wt', 'qsec'], alternative: 'two.sided', priorWidth: 1 / 3, seed: 1, iterations: 5000, confidence: 0.95 });
    (ref.correlation as { a: string; b: string; r: number; bf10: number; greater: number; width3: number }[]).forEach((x, i) => {
      expect([r.pairs[i].a, r.pairs[i].b]).toEqual([x.a, x.b]);
      expect(r.pairs[i].r).toBeCloseTo(x.r, 10);
      bf(r.pairs[i].bf10, x.bf10, `${x.a}-${x.b} BF10`); bf(w.pairs[i].bf10, x.width3, `${x.a}-${x.b} width 1/3`);
      // One-sided: BayesFactor computes BF+0 from the posterior mass of rho > 0 by its own numerical integration and reports no
      // error for it; against the exact integral it agrees to 0.013% at worst here (mpg-wt, where the data point the other way).
      expect(Math.abs(g.pairs[i].bf10 / x.greater - 1), `${x.a}-${x.b} BF+0: ${g.pairs[i].bf10} vs ${x.greater}`).toBeLessThan(1e-3);
    });
  }, 600_000);
  it('binomial: beta prior, two-sided and one-sided', async () => {
    const r = await bbinomialR(data(ref.mtcars), { variable: 'am', testValue: 0.5, alternative: 'two.sided', priorA: 1, priorB: 1, confidence: 0.95 });
    expect(r.counts).toEqual(ref.binomial.counts);
    (ref.binomial.bf as number[]).forEach((x, i) => { bf(r.rows[i].bf10, x, 'BF10'); expect(r.rows[i].median).toBeCloseTo(ref.binomial.median[i], 10); });
    const l = await bbinomialR(data(ref.mtcars), { variable: 'am', testValue: 0.3, alternative: 'less', priorA: 2, priorB: 3, confidence: 0.95 });
    (ref.binomial.bfLess as number[]).forEach((x, i) => bf(l.rows[i].bf10, x, 'BF-0'));
  }, 600_000);
});

it('the BayesFactor example reproduces the help page’s call (?correlationBF) and the exact integral', async () => {
  const ex = PACKAGE_EXAMPLES.find((e) => e.id === 'bayesfactor-iris')!;
  expect(ex.panel?.kind).toBe('bcorrelation');
  const { kind: _k, ...o } = ex.panel as { kind: 'bcorrelation' } & Omit<Parameters<typeof bcorrelationR>[1], 'seed' | 'confidence'>;
  const r = await bcorrelationR(data(ref.iris), { ...o, seed: 1234, confidence: 0.95 });
  // The help page's call, verbatim, in the same R.
  const doc = Number(await withR(['jsonlite', 'BayesFactor'], {}, async (webR) => webR.evalRString('suppressMessages(library(BayesFactor)); format(exp(extractBF(correlationBF(y = iris$Sepal.Length, x = iris$Sepal.Width), logbf = TRUE)$bf), digits = 15)')));
  bf(r.pairs[0].bf10, doc, 'help page');
  bf(r.pairs[0].bf10, ref.irisCorrelation.bf10, 'exact integral');
  expect(r.pairs[0].r).toBeCloseTo(ref.irisCorrelation.r, 10);
}, 600_000);

describe('against native BayesFactor (desktop R, same version and seeds)', () => {
  it('t-tests and correlations', async () => {
    bf((await bttestR(data(ref.sleep), { ...B, type: 'paired', vars: [], pairs: [['drug1', 'drug2']] })).rows[0].bf10, native.ttest.paired, 'paired');
    bf((await bttestR(data(ref.toothgrowth), { ...B, type: 'independent', vars: ['len'], group: 'supp' })).rows[0].bf10, native.ttest.independent, 'independent');
    bf((await bttestR(data(ref.toothgrowth), { ...B, type: 'independent', vars: ['len'], group: 'supp', alternative: 'greater' })).rows[0].bf10, native.ttest.independentGreater, 'independent, greater');
    bf((await bttestR(data(ref.toothgrowth), { ...B, type: 'one', vars: ['len'], testValue: 18, priorWidth: 1 })).rows[0].bf10, native.ttest.one, 'one sample');
    const c = await bcorrelationR(data(ref.mtcars), { vars: ['mpg', 'wt'], alternative: 'two.sided', priorWidth: 1, seed: 1, iterations: 5000, confidence: 0.95 });
    bf(c.pairs[0].bf10, native.correlation.mpgWt, 'correlation');
    const g = await bcorrelationR(data(ref.mtcars), { vars: ['mpg', 'wt'], alternative: 'greater', priorWidth: 1, seed: 1, iterations: 5000, confidence: 0.95 });
    bf(g.pairs[0].bf10, native.correlation.mpgWtGreater, 'correlation, greater');
  }, 600_000);
  it('ANOVA: every model, the same as native with the same seed; posterior and inclusion consistent', async () => {
    const r = await banovaR(data(native.toothgrowth), { dependent: 'len', factors: ['supp', 'dose'], covariates: [], interactions: true, priorFixed: 0.5, priorCovariates: Math.SQRT2 / 4, seed: 1234, iterations: 10000 });
    expect(r.models.map((m) => m.model)).toEqual(['Null model', 'supp', 'dose', 'supp + dose', 'supp + dose + supp × dose']);
    (native.anova.bf10 as number[]).forEach((x, i) => bf(r.models[i + 1].bf10, x, native.anova.models[i]));
    // The one-factor model equals the independent t-test (r = 0.5 here is r = sqrt(2)/2 there).
    bf(r.models[1].bf10, ref.independent.bf10, 'supp alone = t-test (exact integral)');
    expect(r.models.reduce((a, m) => a + m.posterior, 0)).toBeCloseTo(1, 12);
    const full = r.models[4], inter = r.effects.find((e) => e.effect === 'supp × dose')!;
    // The interaction is in one model of five: its inclusion BF equals that model's BF_M.
    expect(inter.priorInclusion).toBeCloseTo(0.2, 12); expect(inter.bfInclusion / full.bfM).toBeCloseTo(1, 10);
  }, 600_000);
  it('ANCOVA: a factor and a covariate', async () => {
    const r = await banovaR(data(native.mtcars), { dependent: 'mpg', factors: ['am'], covariates: ['wt'], interactions: true, priorFixed: 0.5, priorCovariates: Math.SQRT2 / 4, seed: 1234, iterations: 10000 });
    expect(r.models.slice(1).map((m) => m.model)).toEqual(['am', 'wt', 'am + wt']);
    (native.ancova.bf10 as number[]).forEach((x, i) => bf(r.models[i + 1].bf10, x, native.ancova.models[i]));
  }, 600_000);
  it('contingency tables: every sampling scheme, two prior concentrations', async () => {
    for (const sampling of ['jointMulti', 'poisson', 'indepRows', 'indepCols', 'hypergeom'] as const) {
      const r = await bcontingencyR(data(native.mtcars), { rows: 'am', columns: 'vs', counts: '', sampling, priorConcentration: 1 });
      bf(r.bf10, native.contingency[sampling], sampling);
    }
    bf((await bcontingencyR(data(native.mtcars), { rows: 'am', columns: 'vs', counts: '', sampling: 'jointMulti', priorConcentration: 2 })).bf10, native.contingency.concentration2, 'concentration 2');
  }, 600_000);
});

describe('repeated measures, regression, robustness and sequential analyses', () => {
  it('repeated-measures ANOVA: subjects random, against the subjects-only model (native, same seed; within the sampling error)', async () => {
    const r = await brmanovaR(data(native.co2), { levels: ['c95', 'c175', 'c250', 'c350'], factorName: 'conc', between: 'type', priorFixed: 0.5, priorRandom: 1, seed: 1234, iterations: 10000 });
    expect(r.models.map((m) => m.model)).toEqual(['Null model (subjects)', 'conc', 'type', 'conc + type', 'conc + type + conc × type']);
    (native.rmanova.bf10 as number[]).forEach((x, i) => {
      const m = r.models[i + 1];
      // (Monte Carlo: the same seed in the same version, but compared within three times the reported proportional error)
      expect(Math.abs(m.bf10 / x - 1), `${m.model}: ${m.bf10} vs ${x} (error ${m.error})`).toBeLessThan(Math.max(1e-5, 3 * m.error));
    });
    expect(r.effects.map((e) => e.effect)).toEqual(['conc', 'type', 'conc × type']);
  }, 600_000);
  it('linear regression: every subset against native BayesFactor and the Zellner–Siow integral; model priors and inclusion', async () => {
    const u = await bregressionR(data(native.mtcarsFull), { outcome: 'mpg', predictors: ['wt', 'hp', 'qsec'], priorWidth: Math.SQRT2 / 4, modelPrior: 'uniform', seed: 1234, iterations: 5000, confidence: 0.95 });
    (native.regression.bf10 as number[]).forEach((x, i) => { bf(u.models[i + 1].bf10, x, native.regression.models[i]); bf(u.models[i + 1].bf10, ref.regression[i].bf10, `${ref.regression[i].model} (integral)`); });
    expect(u.models.every((m) => Math.abs(m.prior - 1 / 8) < 1e-12)).toBe(true);
    const b = await bregressionR(data(native.mtcarsFull), { outcome: 'mpg', predictors: ['wt', 'hp', 'qsec'], priorWidth: Math.SQRT2 / 4, modelPrior: 'betabinomial', seed: 1234, iterations: 5000, confidence: 0.95 });
    // beta-binomial(1, 1): each size (0 to 3 predictors) has prior 1/4, shared by the models of that size
    expect(b.models.map((m) => m.prior)).toEqual([1 / 4, 1 / 12, 1 / 12, 1 / 12, 1 / 12, 1 / 12, 1 / 12, 1 / 4].map((x) => expect.closeTo(x, 12)));
    expect(b.models.reduce((a, m) => a + m.posterior, 0)).toBeCloseTo(1, 12);
    expect(b.effects.map((e) => e.effect)).toEqual(['wt', 'hp', 'qsec']);
    expect(b.best).toBe('wt + hp');
    expect(b.coefficients.map((c) => c.term)).toEqual(['wt', 'hp']);
    expect(b.coefficients[0].low).toBeLessThan(b.coefficients[0].mean); expect(b.coefficients[0].high).toBeGreaterThan(b.coefficients[0].mean);
  }, 600_000);
  it('robustness and sequential curves: points equal BayesFactor at those widths and sample sizes, and end at the full result', async () => {
    const t = (await bttestR(data(ref.sleep), { ...B, type: 'paired', vars: [], pairs: [['drug1', 'drug2']], robustness: true, sequential: true })).rows[0];
    bf(t.robustness!.bf10[t.robustness!.widths.findIndex((w) => Math.abs(w - 0.2) < 1e-12)], native.curves.pairedR02, 'r = 0.2');
    bf(t.sequential!.bf10[t.sequential!.n.indexOf(5)], native.curves.pairedFirst5, 'first 5 pairs');
    bf(t.sequential!.bf10.at(-1)!, t.bf10, 'sequential ends at the full Bayes factor');
    // (the chosen width is on the grid; R writes it with 15 significant digits)
    expect(t.robustness!.widths.some((w) => Math.abs(w - Math.SQRT1_2) < 1e-12)).toBe(true);
    const c = (await bcorrelationR(data(ref.mtcars), { vars: ['mpg', 'wt'], alternative: 'two.sided', priorWidth: 1, seed: 1, iterations: 5000, confidence: 0.95, robustness: true, sequential: true })).pairs[0];
    bf(c.robustness!.bf10[c.robustness!.widths.findIndex((w) => Math.abs(w - 0.5) < 1e-12)], native.curves.corK05, 'kappa = 0.5');
    bf(c.sequential!.bf10[c.sequential!.n.indexOf(10)], native.curves.corFirst10, 'first 10');
    bf(c.sequential!.bf10.at(-1)!, c.bf10, 'sequential ends at the full Bayes factor');
    // A start without variance (the first two differences equal): no Bayes factor there, a gap in the plot, not 0.
    const flat: Dataset = { names: ['a', 'b'], cols: [Float64Array.from([3, 4, 5, 2, 6, 4, 7, 5]), Float64Array.from([2, 3, 3, 3, 4, 4, 4, 5])] };
    const s0 = (await bttestR(flat, { ...B, type: 'paired', vars: [], pairs: [['a', 'b']], sequential: true })).rows[0].sequential!;
    expect(s0.n[0]).toBe(2); expect(s0.bf10[0]).toBeNull();
    expect(s0.bf10.slice(1).every((v) => v !== null && v > 0)).toBe(true);
  }, 600_000);
});
