// Mixed models in webR against native R (scripts/validation/mixed.R, plain
// package calls): lme4 + lmerTest on sleepstudy (?lmer) with Nakagawa R² from
// performance::r2_nakagawa; lcmm growth mixture models on data_hlme (?hlme).
// Native lme4 1.1-37 / lcmm 2.2.1; webR lme4 2.0-6 / lcmm 2.2.2.
// Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseCsv } from '../engine/dataset';
import commonR from './R/common.R?raw';
import { gmmR, gmmScriptR, lmmR, lmmScriptR, type LmmInput } from './mixed';
import { callJson, withR } from './runtime';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const DIR = join(__dirname, '..', 'engine', '__fixtures__', 'mixed');
const ref = JSON.parse(readFileSync(join(DIR, 'reference.json'), 'utf8'));
const sleep = parseCsv(readFileSync(join(DIR, 'sleepstudy.csv'), 'utf8')).dataset;
const hlme = parseCsv(readFileSync(join(DIR, 'data_hlme.csv'), 'utf8')).dataset;

describe('multilevel regression (lme4)', () => {
  const input: LmmInput = { outcome: 'Reaction', predictors: ['Days'], cluster: 'Subject', slopes: ['Days'], center: 'none', estimation: 'REML' };
  it('random intercepts and slopes equal native lme4 / lmerTest / performance', async () => {
    const r = await lmmR(sleep, input);
    expect(r.n).toBe(180);
    expect(r.clusters).toBe(18);
    const names: Record<string, string> = { '(Intercept)': 'Intercept', Days: 'Days' };
    for (const f of ref.lmm.fixed) {
      const mine = r.fixed.find((x) => x.term === names[f.term])!;
      expect(mine.est).toBeCloseTo(f.est, 5);
      expect(mine.se).toBeCloseTo(f.se, 4);
      expect(mine.df).toBeCloseTo(f.df, 2);
      expect(mine.p / f.p).toBeCloseTo(1, 3);
    }
    for (const v of ref.lmm.random) {
      const mine = r.random.find((x) => (v.grp === 'Residual' ? x.group === 'Residual' : x.group === v.grp && x.a === (v.var1 === '(Intercept)' ? 'Intercept' : v.var1) && x.b === (v.var2 == null ? null : v.var2 === '(Intercept)' ? 'Intercept' : v.var2)))!;
      expect(mine, JSON.stringify(v)).toBeTruthy();
      expect(mine.variance).toBeCloseTo(v.vcov, 2);
    }
    expect(r.icc).toBeCloseTo(ref.lmm.icc, 6);
    expect(r.r2.marginal).toBeCloseTo(ref.lmm.r2.marginal, 5);
    expect(r.r2.conditional).toBeCloseTo(ref.lmm.r2.conditional, 5);
    expect(r.logLik).toBeCloseTo(ref.lmm.logLik, 4);
    expect(r.slopeTest!.chisq).toBeCloseTo(ref.lmm.slopeTest.chisq, 3);
    expect(r.slopeTest!.df).toBe(2);
    expect(r.lines!.intercepts).toHaveLength(18);
    const script = await lmmScriptR(sleep, input);
    expect(script).toContain('fit <- lmer(Reaction ~ Days + (1 + Days | Subject), data = data, REML = TRUE)');
  }, 900_000);

  it('within / between: cluster-mean centring with cluster means, as plain lme4 code', async () => {
    // Unbalanced (later days missing for odd subjects), so the cluster means of Days differ.
    const keep = Array.from({ length: sleep.cols[0].length }, (_, i) => i).filter((i) => !(sleep.cols[2][i] % 2 === 1 && sleep.cols[1][i] > 6));
    const unbalanced = { names: sleep.names, cols: sleep.cols.map((c) => Float64Array.from(keep, (i) => c[i])) };
    const r = await lmmR(unbalanced, { ...input, slopes: [], center: 'cluster', estimation: 'ML' });
    const own = await withR(['jsonlite', 'lme4'], { common: commonR }, (webR) => callJson(webR, `
      d <- lme4::sleepstudy; s <- as.integer(as.character(d$Subject)); d <- d[!(s %% 2 == 1 & d$Days > 6), ]
      d$Days_cm <- ave(d$Days, d$Subject); d$Days_w <- d$Days - d$Days_cm
      f <- lme4::lmer(Reaction ~ Days_w + Days_cm + (1 | Subject), d, REML = FALSE)
      ps_json(list(n = nrow(d), fe = unname(lme4::fixef(f)), ll = as.numeric(logLik(f))))`, null)) as { n: number; fe: number[]; ll: number };
    expect(r.n).toBe(own.n);
    expect(r.fixed.map((f) => f.term)).toEqual(['Intercept', 'Days', 'Days (cluster mean)']);
    r.fixed.forEach((f, i) => expect(f.est).toBeCloseTo(own.fe[i], 6));
    expect(r.logLik).toBeCloseTo(own.ll, 6);
  }, 900_000);
});

describe('growth mixture models (lcmm)', () => {
  it('1-3 classes on long data equal native lcmm with gridsearch', async () => {
    const r = await gmmR(hlme, { format: 'long', subject: 'ID', time: 'Time', outcome: 'Y', covariates: ['X1'], shape: 'linear', random: 'slope', classes: [1, 2, 3], nrep: 50, seed: 1 });
    expect(r.n).toBe(100);
    expect(r.models.map((m) => m.k)).toEqual([1, 2, 3]);
    for (const m of r.models) {
      const n = ref.gmm.models[String(m.k)];
      expect(m.logLik, `k = ${m.k}`).toBeCloseTo(n.logLik, 2);
      expect(m.bic).toBeCloseTo(n.bic, 2);
      expect(m.npar).toBe(n.npar);
      expect([...m.shares].sort()).toEqual([...(Array.isArray(n.shares) ? n.shares : [n.shares])].sort());
      expect(m.trajectories).toHaveLength(m.k);
      expect(m.trajectories[0]).toHaveLength(41);
    }
    expect(r.models[1].params.some((p) => p.name === 'X1')).toBe(true);
    expect(r.models[2].params.slice(0, 2).map((p) => p.name)).toEqual(['membership: class 1 vs 3', 'membership: class 2 vs 3']);
    expect(r.models[1].entropy).toBeGreaterThan(0);
  }, 1_800_000);

  it('wide data are reshaped to long', async () => {
    // Four occasions per person: two classes of linear change.
    const n = 120, times = [0, 1, 2, 3];
    const cols = times.map((t) => Float64Array.from({ length: n }, (_, i) => (i < 60 ? 10 + 0.2 * t : 12 - 1.5 * t) + Math.sin(i * 7.3 + t) * 0.8 + Math.cos(i * 1.7) * 0.6));
    const data = { names: ['y0', 'y1', 'y2', 'y3'], cols };
    const r = await gmmR(data, { format: 'wide', measures: ['y0', 'y1', 'y2', 'y3'], times, covariates: [], shape: 'linear', random: 'intercept', classes: [1, 2], nrep: 5, seed: 3 });
    expect(r.observations).toBe(480);
    expect(r.observedTimes).toEqual(times);
    const two = r.models[1];
    expect([...two.shares].sort()).toEqual([0.5, 0.5]);
    expect(two.observed).toHaveLength(2);
    expect(two.bic).toBeLessThan(r.models[0].bic);
    const script = await gmmScriptR(data, { format: 'wide', measures: ['y0', 'y1', 'y2', 'y3'], times, covariates: [], shape: 'linear', random: 'intercept', classes: [1, 2], nrep: 5, seed: 3 });
    expect(script).toContain('Wide to long');
    expect(script).toContain('gridsearch(rep = 5');
  }, 1_800_000);

  it('refuses a person column that does not identify persons', async () => {
    // X2 is 0/1: two "persons" with many rows at the same times would crash lcmm's compiled code.
    const base = { format: 'long' as const, time: 'Time', outcome: 'Y', covariates: [], shape: 'linear' as const, random: 'slope' as const, classes: [1, 2], nrep: 5, seed: 1 };
    await expect(gmmR(hlme, { ...base, subject: 'X2' })).rejects.toThrow(/Only 2 persons/);
    // A column name with quotes stays inside the R string.
    const odd = { ...hlme, names: hlme.names.map((n) => (n === 'X2' ? 'X2"); stop("injected' : n)) };
    await expect(gmmR(odd, { ...base, subject: 'X2"); stop("injected' })).rejects.toThrow(/Only 2 persons/);
    // Two rows of one person at the same time: a warning, not an error.
    const dup = { names: [...hlme.names], cols: hlme.cols.map((c, j) => Float64Array.from([...c, c[0]], (v, i) => (i === c.length && hlme.names[j] === 'Y' ? v + 1 : v))) };
    const w = await gmmR(dup, { ...base, subject: 'ID', classes: [1] });
    expect(w.warnings.some((x) => /two rows at the same time/.test(x))).toBe(true);
    // The session still works afterwards.
    const ok = await gmmR(hlme, { ...base, subject: 'ID', classes: [1] });
    expect(ok.n).toBe(100);
  }, 900_000);

  it('after a crash of compiled code, R is restarted for the next calculation', async () => {
    // lcmm's Fortran code fails in WebAssembly for two "persons" with 160+ rows each (native R copes).
    const crash = withR(['jsonlite', 'lcmm'], { common: commonR }, (webR) => callJson(webR, `
      suppressPackageStartupMessages(library(lcmm)); m <- hlme(Y ~ Time, random = ~ Time, subject = "X2", ng = 1, data = data_hlme); ps_json(m$conv)`, null));
    await expect(crash).rejects.toThrow(/R has been restarted/);
    const ok = await gmmR(hlme, { format: 'long', subject: 'ID', time: 'Time', outcome: 'Y', covariates: [], shape: 'linear', random: 'slope', classes: [1, 2], nrep: 5, seed: 1 });
    expect(ok.models[1].logLik).toBeLessThan(0);
  }, 900_000);
});
