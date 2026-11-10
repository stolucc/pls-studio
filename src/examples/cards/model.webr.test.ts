// The examples of cards/model.ts, each run through its card (the card's own run(), so through the same rengine
// call the app makes) on the example's data, settings and diagram, and compared with its source:
//   - lavaan's help pages (bootstrapLavaan, lavTestWald, lavPredict) run in the same R, and the tutorial's χ²;
//   - seminr run in the same R (it_criteria of the alternative-models demo) or natively in desktop R
//     (predict_pls, path coefficients: seminr 2.6.0, R 4.6, values below with the script that printed them);
//   - Kock & Hadaya's (2018) formula and its printed z (2.486);
//   - Muthén & Muthén (2002): power .81 at N = 150 (printed, p. 607);
//   - the RI-CLPM tutorial of Mulder & Hamaker (2021) run natively in desktop lavaan 0.7-3 (the page prints no output);
//   - CTA-PLS and PLS-POS have no R package: the tetrads are computed by hand in the same R, and POS recovers
//     simdata's simulated segments.
// Random procedures run with the example's seed; tolerances are stated per check. Run with WEBR_TESTS=1.

import { afterAll, beforeAll, expect, it } from 'vitest';
import { webrOnlyIt } from '../../rengine/webrSlow';  // (the references are seminr 2.5.0's, the browser's version; desktop seminr 2.6.0 changed its benchmark)
import { slowIt } from '../../rengine/webrSlow';
import type { Dataset, PlsResult } from '../../engine/types';
import { summariseMc, type McDesign, type McPart } from '../../engine/montecarlo';
import { categoriesOf } from '../../io';
import { DEFAULT_SETTINGS, toSpec } from '../../model/project';
import { analysisType } from '../../analyses/registry';
import type { AnalysisCtx } from '../../analyses/types';
import { plsOptions } from '../../analyses/plsAssessment';
import { rCall, type RPackage } from '../../rengine/bridge';
import { estimatePlsR } from '../../rengine/pls';
import { runMcChunkR } from '../../rengine/mc';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { callJson, withR } from '../../rengine/runtime';
import commonR from '../../rengine/R/common.R?raw';
import { exampleModel, exampleSettings, PACKAGE_EXAMPLES, panelPreset, type PackageExample } from '../packages';
import { against, example as exampleCheck, near, same } from '../../validation/record';
import { exampleTestData } from '../testData';
import type { RegsemRaw } from '../../rengine/search';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const exampleOf = (id: string) => PACKAGE_EXAMPLES.find((e) => e.id === id)!;

async function load(ex: PackageExample): Promise<Dataset> {
  const fromFile = exampleTestData(ex);
  if (fromFile) return fromFile;
  const raw = await rCall<{ names: string[]; cols: (number | null)[][]; levels?: Record<string, string[]> }>('ps_dataset', { package: ex.data.package, name: ex.data.name, na: ex.data.na ?? [] }, ex.data.package as RPackage);
  return { names: raw.names, cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))), ...categoriesOf(raw.levels) };
}

/** The example as the app opens it: its data, settings and diagram, and its card with the example's options. */
async function open(id: string, method: string, packages: string[], pls?: (ctx: AnalysisCtx) => Promise<PlsResult>) {
  const ex = exampleOf(id);
  exampleCheck(id, { title: ex.title, method, packages, definition: ex });
  const data = await load(ex);
  const ctx: AnalysisCtx = { data, info: null, settings: exampleSettings(DEFAULT_SETTINGS, ex.settings), pls: null, projectName: ex.title, model: exampleModel(ex) };
  if (pls) ctx.pls = await pls(ctx);
  const kind = ex.panel!.kind, preset = panelPreset(ex.panel!);
  const t = analysisType(kind)!;
  const options = t.parseOptions({ ...t.defaults(ctx), ...preset })!;
  expect(t.blocked?.(options as never, ctx) ?? null, `${id}: the card is ready to run`).toBeNull();
  return { ex, data, ctx, t, options, run: <R>() => t.run(options as never, ctx, () => {}) as Promise<R> };
}

const sameR = <T>(packages: string[], code: string) => withR(['jsonlite', ...packages], { common: commonR }, (webR) => callJson(webR, code, null)) as Promise<T>;
const HS_MODEL = `HS.model <- ' visual  =~ x1 + x2 + x3
  textual =~ x4 + x5 + x6
  speed   =~ x7 + x8 + x9 '`;

it('datasets-faithful-chart: a histogram of the 272 eruption times', async () => {
  const { run, t, options } = await open('datasets-faithful-chart', 'Charts', ['datasets']);
  expect(t.id).toBe('chart');
  const r = await run<{ kind: string; n: number; mean: number; sd: number; bins: { count: number }[] }>();
  against({ label: 'R’s faithful, mean() and sd() in desktop R 4.6', level: 'native' });
  same('chart', r.kind, 'histogram');
  same('n', r.n, 272);
  near('mean of eruptions', r.mean, 3.487783, 1e-6);
  near('SD of eruptions', r.sd, 1.141371, 1e-6);
  same('eruptions in the bins', r.bins.reduce((a, b) => a + b.count, 0), 272);
  expect(options).toMatchObject({ kind: 'histogram', x: 'eruptions' });
}, 300_000);

it('datasets-faithful-scatter: eruptions against waiting time with the least-squares line', async () => {
  const { run, t, options } = await open('datasets-faithful-scatter', 'Charts', ['datasets']);
  expect(t.id).toBe('chart');
  // (the chart type is the card's own option "kind": given as the panel's options)
  expect(options).toMatchObject({ kind: 'scatter', x: 'waiting', y: 'eruptions', fit: true });
  const r = await run<{ kind: string; n: number; fit: { slope: number; intercept: number; r: number } | null }>();
  against({ label: 'R’s faithful, lm(eruptions ~ waiting) and cor() in desktop R 4.6', level: 'native' });
  same('chart', r.kind, 'scatter');
  same('n', r.n, 272);
  near('slope', r.fit!.slope, 0.07562794795, 1e-8);
  near('intercept', r.fit!.intercept, -1.87401598641, 1e-8);
  near('r', r.fit!.r, 0.9008111683, 1e-8);
}, 300_000);

// (slow: minutes in webR; run with WEBR_SLOW, as npm run validate:evidence does)
slowIt('lavaan-hs-bollenstine: the bootstrap of ?bootstrapLavaan, with the example’s 1,000 samples and seed', async () => {
  const { run } = await open('lavaan-hs-bollenstine', 'CB-SEM', ['lavaan']);
  const r = await run<{ chisq: number; df: number; p: number; mlChisq: number; samples: number; boot: number[] }>();
  against({ label: 'lavaan tutorial: CFA (printed)', level: 'published', url: 'https://lavaan.ugent.be/tutorial/cfa.html' });
  near('χ² (ML)', r.mlChisq, 85.306, 0.001);
  same('df', r.df, 24);
  // The help page's code, verbatim but for R = 1000 and the seed, in the same R.
  const ref = await sameR<{ orig: number; boot: number[] }>(['lavaan'], `suppressPackageStartupMessages(library(lavaan))
    data(HolzingerSwineford1939, package = "lavaan")
    ${HS_MODEL}
    fit <- cfa(HS.model, data = HolzingerSwineford1939, se = "none")
    T.orig <- fitMeasures(fit, "chisq")
    set.seed(1234)
    T.boot <- bootstrapLavaan(fit, R = 1000, type = "bollen.stine", FUN = fitMeasures, fit.measures = "chisq")
    ps_json(list(orig = unname(T.orig), boot = I(as.numeric(T.boot))))`);
  against({ label: 'lavaan, ?bootstrapLavaan: the help page’s code in the same R (R = 1000, set.seed(1234))', level: 'native', url: 'https://rdrr.io/cran/lavaan/man/bootstrapLavaan.html' });
  same('bootstrap samples', r.boot.length, ref.boot.length);
  const pRef = ref.boot.filter((x) => x >= ref.orig).length / ref.boot.length;
  near('Bollen–Stine p', r.p, pRef, 1e-9);
  same('Bollen–Stine p (no bootstrap χ² reaches the observed one, as the example says)', r.p, 0);
  const sorted = (v: number[]) => [...v].sort((a, b) => a - b);
  near('median bootstrap χ²', sorted(r.boot)[500], sorted(ref.boot)[500], 1e-6);
  near('largest bootstrap χ²', sorted(r.boot)[999], sorted(ref.boot)[999], 1e-6);
}, 1_800_000);

it('lavaan-hs-wald: each critical ratio squared is lavTestWald’s test of the two loadings held equal', async () => {
  const { run } = await open('lavaan-hs-wald', 'CB-SEM', ['lavaan']);
  const r = await run<{ params: { label: string; est: number }[]; z: (number | null)[][] }>();
  same('free loadings compared', r.params.length, 6);
  const ref = await sameR<{ chisq: number; w23: number; w12: number; w13: number }>(['lavaan'], `suppressPackageStartupMessages(library(lavaan))
    data(HolzingerSwineford1939, package = "lavaan")
    HS.model <- '
        visual  =~ x1 + b1*x2 + x3
        textual =~ x4 + b2*x5 + x6
        speed   =~ x7 + b3*x8 + x9
    '
    fit <- cfa(HS.model, data = HolzingerSwineford1939)
    ps_json(list(chisq = unname(fitMeasures(fit, "chisq")), w23 = lavTestWald(fit, constraints = "b2 == b3")$stat,
      w12 = lavTestWald(fit, constraints = "b1 == b2")$stat, w13 = lavTestWald(fit, constraints = "b1 == b3")$stat))`);
  against({ label: 'lavaan, ?lavTestWald: its model and lavTestWald() in the same R', level: 'native', url: 'https://rdrr.io/cran/lavaan/man/lavTestWald.html' });
  near('χ²', ref.chisq, 85.306, 0.001);
  const at = (label: string) => { const i = r.params.findIndex((p) => p.label === label); expect(i, label).toBeGreaterThanOrEqual(0); return i; };
  const z = (a: string, b: string) => { const i = at(a), j = at(b); return (r.z[i][j] ?? r.z[j][i])!; };
  near('z(x5, x8)² = Wald b2 == b3', z('textual → x5', 'speed → x8') ** 2, ref.w23, 1e-6);
  near('z(x2, x5)² = Wald b1 == b2', z('visual → x2', 'textual → x5') ** 2, ref.w12, 1e-6);
  near('z(x2, x8)² = Wald b1 == b3', z('visual → x2', 'speed → x8') ** 2, ref.w13, 1e-6);
}, 900_000);

it('lslx-hs-sfa: the help page’s semi-confirmatory factor analysis, as lslx runs it natively', async () => {
  const { run } = await open('lslx-hs-sfa', 'CB-SEM', ['lslx']);
  const r = await run<RegsemRaw>();
  // (scripts/validation/lslx.R: ?lslx's code in desktop lslx 0.6.11, converged tightly as the card does)
  const ref = JSON.parse(readFileSync(join(__dirname, '..', '..', 'engine', '__fixtures__', 'search', 'lslx.json'), 'utf8'));
  against({ label: 'lslx, ?lslx (Semi-Confirmatory Factor Analysis): its code run natively, scripts/validation/lslx.R', level: 'native', url: 'https://rdrr.io/cran/lslx/man/lslx.html' });
  near('selected λ', r.selected.lambda, 0.14, 1e-10);
  same('selected δ', r.selected.delta ?? NaN, 1.5);
  near('χ²', r.test.chisq!, ref.test.chisq, 1e-5);
  same('df', r.test.df!, ref.test.df);
  near('RMSEA', r.fitIndex.rmsea!, ref.fitIndex.rmsea, 1e-6);
  near('CFI', r.fitIndex.cfi!, ref.fitIndex.cfi, 1e-6);
  const x9 = r.estimates.find((e) => e.label === 'visual → x9')!;
  near('x9 on visual (penalised)', x9.est!, ref.coefficients.find((c: { name: string }) => c.name === 'x9<-visual/g').est, 1e-6);
  same('non-zero cross-loadings', r.estimates.filter((e) => e.type === 'pen' && Math.abs(e.est ?? 0) > 1e-8).length, 4);
}, 900_000);

it('lavaan-hs-scoreweights: the weights applied to the centred tests give lavPredict’s scores', async () => {
  const { run, data } = await open('lavaan-hs-scoreweights', 'CB-SEM', ['lavaan']);
  const r = await run<{ method: string; factors: string[]; variables: string[]; weights: number[][] }>();
  same('method', r.method, 'regression');
  const ref = await sameR<{ scores: number[][]; names: string[] }>(['lavaan'], `suppressPackageStartupMessages(library(lavaan))
    data(HolzingerSwineford1939, package = "lavaan")
    ${HS_MODEL}
    fit <- cfa(HS.model, data = HolzingerSwineford1939)
    fs <- lavPredict(fit)
    ps_json(list(names = I(colnames(fs)), scores = lapply(seq_len(ncol(fs)), function(k) I(unname(fs[, k])))))`);
  against({ label: 'lavaan, ?lavPredict: lavPredict(fit) in the same R', level: 'native', url: 'https://rdrr.io/cran/lavaan/man/lavPredict.html' });
  const col = (n: string) => Array.from(data.cols[data.names.indexOf(n)]);
  const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
  for (const [k, factor] of r.factors.entries()) {
    const ref_k = ref.scores[ref.names.indexOf(factor)];
    const centred = r.variables.map((v) => { const x = col(v); const m = mean(x); return x.map((y) => y - m); });
    const mine = ref_k.map((_, i) => r.weights[k].reduce((s, w, j) => s + w * centred[j][i], 0));
    near(`largest |score − lavPredict| of ${factor}`, Math.max(...mine.map((s, i) => Math.abs(s - ref_k[i]))), 0, 1e-6);
  }
}, 900_000);

webrOnlyIt('seminr-corprep-predict: PLSpredict as seminr’s predict_pls (predict_EA, seed 123): every PLS and LM error of its summary', async () => {
  const { run } = await open('seminr-corprep-predict', 'PLS-SEM', ['seminr']);
  const r = await run<{ folds: number; repetitions: number; predictEngine?: string; indicators: { indicator: string; rmsePls: number; rmseLm: number; maePls: number; maeLm: number; q2: number }[] }>();
  same('folds', r.folds, 10);
  same('repetitions', r.repetitions, 10);
  expect(r.predictEngine).toBe('seminr');
  // seminr 2.5.0 (webR's version) in desktop R 4.6.2: set.seed(123); summary(predict_pls(model, technique = predict_EA, noFolds = 10,
  // reps = 10)), the model of seminr-corprep (mean_replacement, missing_value = "-99"): PLS RMSE, MAE, LM RMSE, MAE. (seminr 2.6.0
  // changed the LM benchmark: comp_1 LM RMSE 1.067, as the description states.)
  const SEMINR_EA: Record<string, [number, number, number, number]> = {
    comp_1: [1.04589478, 0.80022668, 1.08067928, 0.82242669], comp_2: [1.09903258, 0.88179135, 1.10662327, 0.87438965], comp_3: [1.13711700, 0.89758329, 1.14194884, 0.87177759],
    like_1: [1.13006096, 0.85739296, 1.15071002, 0.87833415], like_2: [1.48569928, 1.14971342, 1.55932197, 1.19345388], like_3: [1.51117598, 1.17359300, 1.58031245, 1.23688521],
    cusa: [1.02138417, 0.78924470, 1.02090200, 0.79937557], cusl_1: [1.30653811, 0.99350917, 1.31230995, 0.96828109], cusl_2: [1.52735431, 1.17764423, 1.55408102, 1.17686003],
    cusl_3: [1.53260191, 1.15599644, 1.57619640, 1.19137340],
  };
  against({ label: 'seminr 2.5.0, summary(predict_pls(technique = predict_EA, noFolds = 10, reps = 10)) after set.seed(123), run in desktop R 4.6.2', level: 'native', url: 'https://rdrr.io/cran/seminr/man/predict_pls.html' });
  same('predicted indicators', r.indicators.length, 10);
  for (const [ind, [rmse, mae, rmseLm, maeLm]] of Object.entries(SEMINR_EA)) {
    const row = r.indicators.find((x) => x.indicator === ind)!;
    near(`RMSE (PLS) of ${ind}`, row.rmsePls, rmse, 1e-7);
    near(`MAE (PLS) of ${ind}`, row.maePls, mae, 1e-7);
    near(`RMSE (LM) of ${ind}`, row.rmseLm, rmseLm, 1e-7);
    near(`MAE (LM) of ${ind}`, row.maeLm, maeLm, 1e-7);
    expect(row.q2, `Q²predict of ${ind}`).toBeGreaterThan(0);
  }
}, 1_800_000);

it('seminr-mobi-compare: AIC and BIC per endogenous construct as seminr’s it_criteria, for both models', async () => {
  const { run } = await open('seminr-mobi-compare', 'PLS-SEM', ['cSEM', 'seminr']);
  const r = await run<{ criteria: { criterion: string; byConstruct: Record<string, number> }[]; criteriaAlt: { criterion: string; byConstruct: Record<string, number> }[]; cvpat: { p: number; loss: number; lossAlt: number } }>();
  const ref = await sameR<Record<'med' | 'ovr', Record<string, Record<string, number>>>>(['seminr'], `suppressPackageStartupMessages(library(seminr))
    mobi_mm <- constructs(
      composite("Image",        multi_items("IMAG", 1:5)),
      composite("Expectation",  multi_items("CUEX", 1:3)),
      composite("Quality",      multi_items("PERQ", 1:7)),
      composite("Value",        multi_items("PERV", 1:2)),
      composite("Satisfaction", multi_items("CUSA", 1:3)),
      composite("Complaints",   single_item("CUSCO")),
      composite("Loyalty",      multi_items("CUSL", 1:3)))
    antecedents <- c("Image", "Expectation", "Quality"); mediators <- c("Satisfaction", "Value"); outcomes <- c("Loyalty", "Complaints")
    mediated_sm <- relationships(paths(from = antecedents, to = mediators), paths(from = mediators, to = outcomes))
    overriding_effects_sm <- relationships(paths(from = antecedents, to = mediators), paths(from = c(antecedents, mediators), to = outcomes))
    ic <- function(sm) { m <- estimate_pls(data = mobi, measurement_model = mobi_mm, structural_model = sm); s <- summary(m)$it_criteria
      list(AIC = as.list(s["AIC", ]), BIC = as.list(s["BIC", ])) }
    ps_json(list(med = ic(mediated_sm), ovr = ic(overriding_effects_sm)))`);
  against({ label: 'seminr, demo("seminr-alternative-models"): summary()$it_criteria in the same R', level: 'native', url: 'https://github.com/sem-in-r/seminr/blob/master/demo/seminr-alternative-models.R' });
  for (const [mine, theirs, which] of [[r.criteria, ref.ovr, 'overriding'], [r.criteriaAlt, ref.med, 'mediated']] as const) {
    for (const k of ['AIC', 'BIC']) {
      const row = mine.find((x) => x.criterion === k)!;
      expect(row, `${k} in the card`).toBeTruthy();
      for (const c of ['Satisfaction', 'Value', 'Loyalty', 'Complaints']) near(`${k} of ${c} (${which})`, row.byConstruct[c], theirs[k][c], 0.01);
    }
  }
  expect(r.cvpat.p).toBeGreaterThanOrEqual(0);
  expect(r.cvpat.p).toBeLessThanOrEqual(1);
}, 1_800_000);

it('seminr-corprep-cta: the tetrads and their bootstrap SEs as computed by hand', async () => {
  const { run } = await open('seminr-corprep-cta', 'PLS-SEM', ['stats']);
  const r = await run<{ samples: number; blocks: { construct: string; tetrads: { tetrad: string; est: number; se: number }[] }[] }>();
  same('bootstrap samples', r.samples, 1000);
  const count = Object.fromEntries(r.blocks.map((b) => [b.construct, b.tetrads.length]));
  against({ label: 'Bollen & Ting (1993): p(p − 3)/2 non-redundant tetrads per block', level: 'published' });
  same('tetrads of QUAL (8 indicators)', count.QUAL, 20);
  same('tetrads of PERF (5 indicators)', count.PERF, 5);
  same('tetrads of CSOR (5 indicators)', count.CSOR, 5);
  const tetrads = r.blocks.flatMap((b) => b.tetrads.map((t) => t.tetrad.split(', ')));
  const ref = await sameR<{ est: number[]; se: number[] }>([], `data(corp_rep_data, package = "seminr")
    d <- corp_rep_data; d[d == -99] <- NA
    for (v in names(d)) if (is.numeric(d[[v]])) d[[v]][is.na(d[[v]])] <- mean(d[[v]], na.rm = TRUE)
    tet <- list(${tetrads.map((t) => `c(${t.map((x) => `"${x}"`).join(', ')})`).join(', ')})
    # t = s[g,h] s[i,j] - s[g,i] s[h,j], from the covariances of the four indicators
    value <- function(X, t) { S <- cov(X[, t]); S[1, 2] * S[3, 4] - S[1, 3] * S[2, 4] }
    X <- as.matrix(d)
    set.seed(123)
    rows <- replicate(1000, sample.int(nrow(X), replace = TRUE), simplify = FALSE)
    est <- sapply(tet, function(t) value(X, t))
    se <- sapply(tet, function(t) sd(sapply(rows, function(r) value(X[r, ], t))))
    ps_json(list(est = I(est), se = I(se)))`);
  against({ label: 'the tetrads and their bootstrap SEs computed by hand in the same R (mean replacement, set.seed(123), 1,000 resamples)', level: 'native' });
  const mine = r.blocks.flatMap((b) => b.tetrads);
  mine.forEach((t, i) => {
    near(`tetrad ${t.tetrad}`, t.est, ref.est[i], 1e-9);
    near(`SE of tetrad ${t.tetrad}`, t.se, ref.se[i], 1e-9);
  });
}, 1_800_000);

it('seminr-corprep-minsample: Kock & Hadaya’s minimum sample size for every path of the estimated model', async () => {
  const { run } = await open('seminr-corprep-minsample', 'PLS-SEM', ['seminr'],
    (ctx) => estimatePlsR(ctx.data!, toSpec(ctx.model!), plsOptions(ctx.settings), 'seminr'));
  const r = await run<{ z: number; betaMin: number; nMin: number; n: number; paths: { from: string; to: string; beta: number; nMin: number }[] }>();
  against({ label: 'Kock & Hadaya (2018): z(0.95) + z(0.80) = 2.486, n_min > (z / |β_min|)²', level: 'published', url: 'https://doi.org/10.1111/isj.12131' });
  near('z(1 − α) + z(power)', r.z, 2.486, 5e-4);
  for (const p of r.paths) same(`n_min of ${p.from} → ${p.to}`, p.nMin, Math.ceil((r.z / Math.abs(p.beta)) ** 2));
  // seminr 2.6.0 in desktop R: estimate_pls() of the extended model, round(m$path_coef, 4) (Hair et al. 2021, chapter 6).
  const SEMINR_PATHS: [string, string, number][] = [['QUAL', 'COMP', 0.4297], ['PERF', 'COMP', 0.2955], ['CSOR', 'COMP', 0.0589], ['ATTR', 'COMP', 0.0861],
    ['QUAL', 'LIKE', 0.3800], ['PERF', 'LIKE', 0.1170], ['CSOR', 'LIKE', 0.1784], ['ATTR', 'LIKE', 0.1671],
    ['COMP', 'CUSA', 0.1455], ['LIKE', 'CUSA', 0.4357], ['COMP', 'CUSL', 0.0057], ['LIKE', 'CUSL', 0.3440], ['CUSA', 'CUSL', 0.5050]];
  against({ label: 'seminr 2.6.0, estimate_pls() of the extended corporate reputation model, run in desktop R', level: 'native' });
  same('n', r.n, 344);
  for (const [from, to, beta] of SEMINR_PATHS) near(`β ${from} → ${to}`, r.paths.find((p) => p.from === from && p.to === to)!.beta, beta, 1e-4);
  near('smallest |β|', r.betaMin, 0.0057, 1e-4);
  same('paths needing more than the 344 observations (as the example says)', r.paths.filter((p) => p.nMin > 344).map((p) => `${p.from} → ${p.to}`).sort().join(', '), 'ATTR → COMP, COMP → CUSL, CSOR → COMP, PERF → LIKE');
}, 900_000);

it('plspm-pos: PLS-POS recovers the two simulated segments of simdata', async () => {
  const { run, data } = await open('plspm-pos', 'PLS-SEM', ['cSEM']);
  const r = await run<{ k: number; n: number; objective: number; globalObjective: number; assignment: number[]; segments: { paths: { from: string; est: number }[] }[] }>();
  const group = data.cols[data.names.indexOf('group')];
  const agree = r.assignment.filter((a, i) => a === group[i]).length / r.n;
  against({ label: 'plspm, ?simdata: the simulated segment of each customer (group), recovered with seed 1 (at least 85% agreement)', level: 'recovery', url: 'https://rdrr.io/cran/plspm/man/simdata.html' });
  same('segments', r.k, 2);
  same('n', r.n, 400);
  expect(Math.max(agree, 1 - agree), 'agreement with the simulated segments').toBeGreaterThan(0.85);
  expect(r.objective).toBeGreaterThan(r.globalObjective);
  const price = r.segments.map((g) => g.paths.find((p) => p.from === 'Price')!.est);
  expect(Math.max(...price), 'one segment price-driven').toBeGreaterThan(0.6);
}, 1_800_000);

// (slow: minutes in webR; run with WEBR_SLOW, as npm run validate:evidence does)
slowIt('muthen-mc-cfa: power .81 for the factor correlation at N = 150', async () => {
  const { options } = await open('muthen-mc-cfa', 'Simulation', ['lavaan']);
  // The card's run() spreads chunks over the app's R sessions (runner.simulate); here the same chunks, one after another.
  const design = options as McDesign;
  const parts: McPart[] = [];
  for (let s = 0; s < design.replications; s += 100) parts.push(await runMcChunkR(design, 150, s, Math.min(design.replications, s + 100)));
  const rows = summariseMc(design, parts);
  // (the correlation of the two factors, as the paper tests it)
  const cor = rows.find((x) => x.param.kind === 'covariance')!;
  same('replications', cor.reps, 1000);
  same('failed replications', cor.failed, 0);
  against({ label: 'Muthén & Muthén (2002), p. 607: N = 150 gives power .81 for the factor correlation (10,000 replications; here 1,000: Monte Carlo SE 0.012, within 0.04)', level: 'published', url: 'https://doi.org/10.1207/S15328007SEM0904_8' });
  near('power of f1 ↔ f2', cor.rejection!, 0.81, 0.04);
  near('mean estimate of f1 ↔ f2 (population .25)', cor.mean, 0.25, 0.01);
  near('coverage of the 95% interval', cor.coverage!, 0.95, 0.02);
}, 1_800_000);

it('mulder-riclpm: the tutorial’s basic RI-CLPM', async () => {
  const { run } = await open('mulder-riclpm', 'Longitudinal', ['lavaan']);
  const r = await run<{ n: number; fit: { chisq?: number; df?: number }; estimates: { lhs: string; op: string; rhs: string; est: number; se: number | null }[] }>();
  // Desktop lavaan 0.7-3 (R 4.6): the tutorial's RICLPM syntax, lavaan(RICLPM, data = dat, missing = 'ML', meanstructure = T, int.ov.free = T).
  against({ label: 'Mulder & Hamaker (2021), the RI-CLPM tutorial’s lavaan code run in desktop lavaan 0.7-3', level: 'native', url: 'https://jeroendmulder.github.io/RI-CLPM/lavaan.html' });
  same('n', r.n, 1189);
  near('χ²', r.fit.chisq!, 25.806, 0.001);
  same('df', r.fit.df!, 21);
  const REF: [string, string, string, number, number][] = [
    ['wx2', '~', 'wx1', 0.232, 0.028], ['wx2', '~', 'wy1', 0.009, 0.026], ['wy2', '~', 'wx1', 0.174, 0.045], ['wy2', '~', 'wy1', 0.004, 0.046],
    ['wx3', '~', 'wx2', 0.241, 0.037], ['wx3', '~', 'wy2', 0.026, 0.024], ['wy3', '~', 'wx2', 0.156, 0.054], ['wy3', '~', 'wy2', 0.262, 0.039],
    ['wx4', '~', 'wx3', 0.279, 0.038], ['wx4', '~', 'wy3', 0.010, 0.023], ['wy4', '~', 'wx3', 0.185, 0.055], ['wy4', '~', 'wy3', 0.296, 0.035],
    ['wx5', '~', 'wx4', 0.290, 0.035], ['wx5', '~', 'wy4', -0.004, 0.022], ['wy5', '~', 'wx4', 0.124, 0.048], ['wy5', '~', 'wy4', 0.392, 0.031],
    ['RIx', '~~', 'RIx', 0.009, 0.001], ['RIy', '~~', 'RIy', 0.032, 0.003], ['RIx', '~~', 'RIy', 0.010, 0.001],
  ];
  for (const [lhs, op, rhs, est, se] of REF) {
    const e = r.estimates.find((x) => x.lhs === lhs && x.op === op && x.rhs === rhs);
    expect(e, `${lhs} ${op} ${rhs}`).toBeTruthy();
    near(`${lhs} ${op} ${rhs}`, e!.est, est, 0.0006);
    near(`SE of ${lhs} ${op} ${rhs}`, e!.se!, se, 0.0006);
  }
}, 900_000);
