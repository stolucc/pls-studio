// Bootstrap options through webR: BCa intervals and one-tailed tests.
// PLS (cSEM): our BCa from cSEM's bootstrap and jackknife equals cSEM's own
// infer(.quantity = "CI_bca"); the app's TypeScript summary equals R's
// boot_summary on the same draws. Run with npm run test:webr.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { summarise } from '../engine/bootstrap';
import type { Dataset, ModelSpec } from '../engine/types';
import { bootstrapR } from './analyses';
import { rCall } from './bridge';
import bootR from './R/boot.R?raw';
import commonR from './R/common.R?raw';
import { callJson, withR } from './runtime';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const items = (p: string, k: number) => Array.from({ length: k }, (_, i) => `${p}${i + 1}`);
const fac = (name: string, ind: string[]) => ({ name, type: 'factor' as const, mode: 'A' as const, indicators: ind });
const spec: ModelSpec = {
  constructs: [fac('IMAG', items('imag', 5)), fac('EXPE', items('expe', 5)), fac('SAT', items('sat', 4))],
  paths: [{ from: 'IMAG', to: 'EXPE' }, { from: 'IMAG', to: 'SAT' }, { from: 'EXPE', to: 'SAT' }],
};
const options = { scheme: 'path' as const, consistent: false, tolerance: 1e-7, maxIter: 300, missing: 'casewise' as const };
let data: Dataset;
beforeAll(async () => {
  const raw = await rCall<{ names: string[]; cols: (number | null)[][] }>('ps_dataset', { package: 'cSEM', name: 'satisfaction', na: [] }, 'cSEM');
  data = { names: raw.names, cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))) };
}, 900_000);

describe('bootstrap options', () => {
  it('BCa (cSEM): the formula equals cSEM’s infer(CI_bca); the app uses the full jackknife; one-tailed p is half', async () => {
    const boot = { samples: 200, seed: 7, confidence: 0.95 };
    const bca = await bootstrapR(data, spec, { kind: 'plsBoot', pkg: 'cSEM', options, boot: { ...boot, interval: 'bca' } }, () => '');
    expect(bca.interval).toBe('bca');
    const model = 'EXPE ~ IMAG\\nSAT ~ IMAG + EXPE\\nIMAG =~ imag1 + imag2 + imag3 + imag4 + imag5\\nEXPE =~ expe1 + expe2 + expe3 + expe4 + expe5\\nSAT =~ sat1 + sat2 + sat3 + sat4';
    const own = await withR(['jsonlite', 'cSEM'], { common: commonR, boot: bootR }, (webR) => callJson(webR, `suppressPackageStartupMessages(library(cSEM)); eval(parse(text = PS_BOOT_SUMMARY))
      args <- list(.data = satisfaction, .model = "${model}", .PLS_weight_scheme_inner = "path", .disattenuate = FALSE, .tolerance = 1e-7, .iter_max = 300)
      fit <- do.call(csem, c(args, .resample_method = "bootstrap", .R = 200, .seed = 7))
      P <- fit$Estimates$Estimates_resample$Estimates1$Path_estimates
      # cSEM's infer() takes its jackknife from resamplecSEMResults on the bootstrapped object (as many rows as bootstrap samples).
      o <- fit; class(o) <- setdiff(class(o), "cSEMResults_resampled")
      Jc <- cSEM:::resamplecSEMResults(.object = o, .resample_method = "jackknife")$Estimates$Estimates_resample$Estimates1$Path_estimates$Resampled
      ci <- infer(fit, .quantity = "CI_bca", .alpha = 0.05)$Path_estimates$CI_bca
      # The full jackknife: every observation left out once.
      J <- do.call(csem, c(args, .resample_method = "jackknife"))$Estimates$Estimates_resample$Estimates1$Path_estimates$Resampled
      withC <- boot_summary(P$Resampled, P$Original, 0.95, jack = Jc); full <- boot_summary(P$Resampled, P$Original, 0.95, jack = J)
      ps_json(list(names = colnames(ci), cs = list(lo = unname(ci[1, ]), hi = unname(ci[2, ])), withC = list(lo = withC$ci_low, hi = withC$ci_high),
        full = list(lo = full$ci_low, hi = full$ci_high), jackRows = nrow(J)))`, null)) as { names: string[]; jackRows: number } & Record<'cs' | 'withC' | 'full', { lo: number[]; hi: number[] }>;
    expect(own.jackRows).toBe(250);
    const path = (n: string) => { const [to, from] = n.split(' ~ '); return bca.stats.find((x) => x.key === `path:${from}:${to}`)!; };
    own.names.forEach((n, i) => {
      // Our BCa formula, given cSEM's jackknife, is cSEM's CI_bca exactly.
      expect(own.withC.lo[i], n).toBeCloseTo(own.cs.lo[i], 12);
      expect(own.withC.hi[i], n).toBeCloseTo(own.cs.hi[i], 12);
      // The app: the full jackknife.
      expect(path(n).ciLow, n).toBeCloseTo(own.full.lo[i], 10);
      expect(path(n).ciHigh, n).toBeCloseTo(own.full.hi[i], 10);
    });
    const one = await bootstrapR(data, spec, { kind: 'plsBoot', pkg: 'cSEM', options, boot: { ...boot, tails: 1 } }, () => '');
    const two = await bootstrapR(data, spec, { kind: 'plsBoot', pkg: 'cSEM', options, boot }, () => '');
    expect(one.tails).toBe(1);
    two.stats.forEach((x, i) => expect(one.stats[i].p).toBeCloseTo(x.p / 2, 12));
  }, 900_000);

  it('BCa (lavaan): the jackknife refits each case out; equals boot_summary on lavaan’s own draws', async () => {
    const F = (name: string, inds: string[]) => ({ name, type: 'factor' as const, mode: 'A' as const, indicators: inds });
    const cbSpec: ModelSpec = { constructs: [F('visual', ['x1', 'x2', 'x3']), F('textual', ['x4', 'x5', 'x6'])], paths: [{ from: 'visual', to: 'textual' }] };
    const raw = await rCall<{ names: string[]; cols: (number | null)[][] }>('ps_dataset', { package: 'lavaan', name: 'HolzingerSwineford1939', na: [] }, 'lavaan');
    const hs = { names: raw.names, cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))) };
    const r = await bootstrapR(hs, cbSpec, { kind: 'cbBoot', estimator: 'ML', missing: 'casewise', boot: { samples: 100, seed: 3, confidence: 0.95, interval: 'bca' } }, () => '');
    expect(r.interval).toBe('bca');
    const p = r.stats.find((x) => x.key === 'path:visual:textual')!;
    const ref = await withR(['jsonlite', 'lavaan'], { common: commonR, boot: bootR }, (webR) => callJson(webR, `suppressPackageStartupMessages(library(lavaan)); eval(parse(text = PS_BOOT_SUMMARY))
      d <- HolzingerSwineford1939; m <- "visual =~ x1 + x2 + x3\\ntextual =~ x4 + x5 + x6\\ntextual ~ visual"
      fit <- sem(m, data = d); f <- function(x) { s <- standardizedSolution(x); s$est.std[s$op == "~"] }
      draws <- bootstrapLavaan(fit, R = 100, FUN = f, iseed = 3)
      jack <- vapply(seq_len(nrow(d)), function(i) f(sem(m, data = d[-i, ])), 0)
      s <- boot_summary(cbind(p = draws[, 1]), c(p = f(fit)), 0.95, jack = cbind(p = jack))
      ps_json(list(lo = s$ci_low, hi = s$ci_high, orig = f(fit)))`, null)) as { lo: number; hi: number; orig: number };
    expect(p.original).toBeCloseTo(ref.orig, 10);
    expect(p.ciLow).toBeCloseTo(ref.lo, 10);
    expect(p.ciHigh).toBeCloseTo(ref.hi, 10);
  }, 900_000);

  it('the TypeScript summary equals R’s boot_summary (percentile, one-tailed, BCa)', async () => {
    const r = await withR(['jsonlite'], { common: commonR, boot: bootR }, (webR) => callJson(webR, `eval(parse(text = PS_BOOT_SUMMARY))
      set.seed(3); x <- rgamma(500, 2); draws <- cbind(a = x, b = -x + rnorm(500, 0, 0.3)); jack <- cbind(a = rnorm(80, 1), b = rnorm(80, -1)^2)
      o <- c(a = 1.8, b = -1.7)
      ps_json(list(draws = draws, jack = jack, two = boot_summary(draws, o, 0.95), one = boot_summary(draws, o, 0.9, tails = 1), bca = boot_summary(draws, o, 0.95, jack = jack)))`, null)) as {
      draws: number[][]; jack: number[][]; two: Record<string, number>[]; one: Record<string, number>[]; bca: Record<string, number>[] };
    const col = (m: number[][], j: number) => m.map((row) => row[j]);
    [1.8, -1.7].forEach((o, j) => {
      const check = (got: ReturnType<typeof summarise>, want: Record<string, number>) => {
        for (const [k, rk] of [['mean', 'mean'], ['sd', 'sd'], ['p', 'p'], ['ciLow', 'ci_low'], ['ciHigh', 'ci_high']] as const) expect(got[k], rk).toBeCloseTo(want[rk], 10);
      };
      check(summarise(col(r.draws, j), o, 0.95), r.two[j]);
      check(summarise(col(r.draws, j), o, 0.9, 1), r.one[j]);
      check(summarise(col(r.draws, j), o, 0.95, 2, col(r.jack, j)), r.bca[j]);
    });
  }, 900_000);
});
