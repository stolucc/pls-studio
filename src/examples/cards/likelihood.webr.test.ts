// The examples of cards/likelihood.ts, each run through its card's own run() on the example's data (with its computed
// columns), and compared with the R help page it follows, run in the same R. Run with WEBR_TESTS=1.

import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Dataset } from '../../engine/types';
import { computeColumn } from '../../data/compute';
import { categoriesOf } from '../../io';
import { DEFAULT_SETTINGS, type DataInfo } from '../../model/project';
import { analysisType } from '../../analyses/registry';
import type { AnalysisCtx } from '../../analyses/types';
import { rCall, type RPackage } from '../../rengine/bridge';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { callJson, withR } from '../../rengine/runtime';
import commonR from '../../rengine/R/common.R?raw';
import { exampleSettings, PACKAGE_EXAMPLES, panelPreset } from '../packages';
import { against, example as exampleCheck, near } from '../../validation/record';
import type { BmvregResult, CustomMlResult } from '../../rengine/customml';
import type { TwoLevelEfaResult } from '../../rengine/twolevelefa';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

async function open(id: string, method: string, packages: string[]) {
  const ex = PACKAGE_EXAMPLES.find((e) => e.id === id)!;
  exampleCheck(id, { title: ex.title, method, packages, definition: ex });
  const raw = await rCall<{ names: string[]; cols: (number | null)[][]; levels?: Record<string, string[]> }>('ps_dataset', { package: ex.data.package, name: ex.data.name, na: ex.data.na ?? [] }, ex.data.package as RPackage);
  let data: Dataset = { names: raw.names, cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))), ...categoriesOf(raw.levels) };
  let info: DataInfo = { fileName: 'x', rows: data.cols[0].length, missingCells: 0, excluded: [] };
  for (const k of ex.computed ?? []) ({ data, info } = computeColumn(data, info, k.name, k.expr));
  const ctx: AnalysisCtx = { data, info: null, settings: exampleSettings(DEFAULT_SETTINGS, ex.settings), pls: null, projectName: ex.title };
  const t = analysisType(ex.panel!.kind)!;
  const options = t.parseOptions({ ...t.defaults(ctx), ...panelPreset(ex.panel!) })!;
  expect(t.blocked(options as never, ctx), `${id}: the card is ready to run`).toBeNull();
  return { ex, ctx, t, options, run: <R>() => t.run(options as never, ctx, () => {}) as Promise<R> };
}
const sameR = <T>(packages: string[], code: string) => withR(['jsonlite', ...packages], { common: commonR }, (webR) => callJson(webR, code, null)) as Promise<T>;

it('stats-customml-cars: the regression written as a normal likelihood gives lm’s coefficients, and its ML variance and standard errors', async () => {
  const { run } = await open('stats-customml-cars', 'Custom likelihood', ['stats']);
  against({ label: 'R, ?cars: lm(log(dist) ~ log(speed)) and logLik() in the same R', level: 'native', url: 'https://rdrr.io/r/datasets/cars.html' });
  const r = await run<CustomMlResult>();
  expect(r.converged).toBe(true);
  const ref = await sameR<{ coef: number[]; se: number[]; sigma2: number; logLik: number; n: number }>([],
    'fm <- lm(log(dist) ~ log(speed), data = cars); s <- summary(fm); n <- nrow(cars); ps_json(list(coef = unname(coef(fm)), se = unname(s$coefficients[, 2]), sigma2 = s$sigma^2, logLik = as.numeric(logLik(fm)), n = n))');
  const par = (n: string) => r.parameters.find((p) => p.name === n)!;
  near('b0 (intercept)', par('b0').est, ref.coef[0], 1e-5);
  near('b1 (log speed)', par('b1').est, ref.coef[1], 1e-5);
  near('s2: the ML variance RSS/n', par('s2').est, ref.sigma2 * (ref.n - 2) / ref.n, 1e-5);
  near('log-likelihood', r.fit.logLik, ref.logLik, 1e-6);
  const k = Math.sqrt((ref.n - 2) / ref.n);
  near('SE of b0 (lm’s × √((n − 2)/n))', par('b0').se, ref.se[0] * k, 1e-4);
  near('SE of b1', par('b1').se, ref.se[1] * k, 1e-4);
  near('sigma (defined: sqrt(s2))', r.defined[0].est!, Math.sqrt(par('s2').est), 1e-8);
  expect(r.parts[0].est, 'the mean varies with speed: no single value').toBeNull();
}, 600_000);

it('the custom likelihood card refuses expressions outside its grammar, in the card and in R', async () => {
  const { t, ctx, options } = await open('stats-customml-cars', 'Custom likelihood', ['stats']);
  const o = options as CustomMlResult & Record<string, unknown>;
  expect(t.blocked({ ...o, means: ['system("ls")'] } as never, ctx)).toMatch(/not allowed|Unexpected/);
  expect(t.blocked({ ...o, means: ['b0 + zz'] } as never, ctx)).toMatch(/zz is neither a parameter nor a data column/);
  expect(t.blocked({ ...o, parameters: [{ name: 'if', start: 0 }] } as never, ctx)).toMatch(/reserved/);
  const { customMlR } = await import('../../rengine/customml');
  await expect(customMlR(ctx.data!, { ...(o as never as Parameters<typeof customMlR>[1]), means: ['b0 + get("x")'] })).rejects.toThrow(/Invalid expression|expression/);
  await expect(customMlR(ctx.data!, { ...(o as never as Parameters<typeof customMlR>[1]), means: ['b0 + Sys.time(1)'] })).rejects.toThrow(/Invalid expression|expression/);
}, 600_000);

it('stats-bmvreg-mtcars: the posterior medians are lm’s coefficients and the inverse-gamma medians of the residual variances (Box & Tiao)', async () => {
  const { run } = await open('stats-bmvreg-mtcars', 'Bayesian multivariate regression', ['stats']);
  against({ label: 'R: lm(cbind(mpg, qsec) ~ wt + hp, mtcars) and the inverse-gamma median (Box & Tiao 1973, ch. 8) in the same R', level: 'native' });
  const r = await run<BmvregResult>();
  expect(r.df).toBe(26);
  const ref = await sameR<{ coef: number[]; med: number[]; mean: number[] }>([],
    'fm <- lm(cbind(mpg, qsec) ~ wt + hp, mtcars); S <- crossprod(residuals(fm)); nu <- 32 - 3 - 2 - 1; ps_json(list(coef = c(coef(fm)), med = diag(S) / (2 * qgamma(0.5, (nu - 2 + 1) / 2)), mean = diag(S) / (nu - 2 - 1)))');
  const names = ['mpg ON (Intercept)', 'mpg ON wt', 'mpg ON hp', 'qsec ON (Intercept)', 'qsec ON wt', 'qsec ON hp'];
  names.forEach((n, i) => near(`${n}: posterior median = least squares`, r.parameters.find((q) => q.name === n)!.median, ref.coef[i], 1e-8));
  ['mpg', 'qsec'].forEach((y, j) => {
    const q = r.parameters.find((x) => x.name === `Residual variance ${y}`)!;
    near(`residual variance of ${y}: inverse-gamma median`, q.median, ref.med[j], 1e-8);
    // (the posterior mean S/(ν − p − 1) from 50,000 draws: within Monte Carlo error)
    near(`residual variance of ${y}: posterior mean (draws)`, q.mean, ref.mean[j], 4 * q.sd / Math.sqrt(50000));
  });
}, 600_000);

it('lavaan-efa2l-twolevel: one factor per level is the tutorial’s two-level measurement model: the same log-likelihood, standardised loadings and standard errors', async () => {
  const { run } = await open('lavaan-efa2l-twolevel', 'Two-level EFA', ['lavaan', 'GPArotation']);
  against({ label: 'lavaan tutorial (multilevel SEM): its measurement model fitted by lavaan and standardizedSolution() in the same R', level: 'native', url: 'https://lavaan.ugent.be/tutorial/multilevel.html' });
  const r = await run<TwoLevelEfaResult>();
  expect(r.solutions.map((s) => `${s.within}/${s.between}`)).toEqual(['1/1', '1/U']);
  const ref = await sameR<{ logl: number; est: number[]; se: number[]; lev: number[] }>(['lavaan'],
    `fit <- lavaan::sem('level: 1\n fw =~ y1 + y2 + y3\n level: 2\n fb =~ y1 + y2 + y3', data = lavaan::Demo.twolevel, cluster = "cluster", information = "observed"); s <- lavaan::standardizedSolution(fit); s <- s[s$op == "=~", ]; ps_json(list(logl = lavaan::fitMeasures(fit, "logl")[[1]], est = s$est.std, se = s$se, lev = ifelse(s$lhs == "fw", 1, 2)))`);
  const s = r.solutions[0];
  near('log-likelihood', s.fit.logl, ref.logl, 1e-4);
  [s.withinLevel!, s.betweenLevel!].forEach((l, k) => l.loadings.forEach((x, i) => {
    const j = ref.lev.indexOf(k + 1) + i;
    near(`${k ? 'between' : 'within'}: y${i + 1} (standardised)`, x.est[0], ref.est[j], 1e-4);
    near(`${k ? 'between' : 'within'}: SE of y${i + 1}`, x.se[0], ref.se[j], 1e-4);
  }));
  expect(r.solutions[1].betweenLevel).toBeNull();
}, 600_000);
