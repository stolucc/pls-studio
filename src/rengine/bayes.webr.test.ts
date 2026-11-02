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
import { bbinomialR, bcorrelationR, bttestR, type BTTestInput } from './tests';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

type Frame = { names: string[]; cols: number[][]; categories: Record<string, string[]> };
const ref = JSON.parse(readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'bayes', 'reference.json'), 'utf8')) as Record<string, any>;
const data = (f: Frame): Dataset => ({ names: f.names, cols: f.cols.map((c) => Float64Array.from(c)), ...(Object.keys(f.categories ?? {}).length ? { categories: f.categories } : {}) });
/** Bayes factors to a relative 1e-5 (BayesFactor's quadrature against base R's). */
const bf = (a: number, b: number, what: string) => expect(Math.abs(a / b - 1), `${what}: ${a} vs ${b}`).toBeLessThan(1e-5);
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
