// The examples of cards/model.ts, each run through its card (the card's own run(), so through the same rengine
// call the app makes) on the example's data, settings and diagram, and compared with its source:
//   - lavaan's help pages (bootstrapLavaan, lavTestWald, lavPredict) run in the same R, and the tutorial's χ²;
//   - nonnest2's help pages (vuongtest, icci) run natively in desktop R (scripts/validation/cbdiag.R);
//   - seminr run in the same R (it_criteria of the alternative-models demo) or natively in desktop R
//     (predict_pls, path coefficients: seminr 2.6.0, R 4.6, values below with the script that printed them);
//   - Kock & Hadaya's (2018) formula and its printed z (2.486);
//   - Muthén & Muthén (2002): power .81 at N = 150 (printed, p. 607);
//   - the RI-CLPM tutorial of Mulder & Hamaker (2021) run natively in desktop lavaan 0.7-3 (the page prints no output);
//   - CTA-PLS and PLS-POS have no R package: the tetrads are computed by hand in the same R, and POS recovers
//     simdata's simulated segments.
// Random procedures run with the example's seed; tolerances are stated per check. Run with WEBR_TESTS=1.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { CompareModelsResult } from '../../rengine/cbDiag';
import { webrOnlyIt } from '../../rengine/webrSlow'; // (the references are seminr 2.5.0's, the browser's version; desktop seminr 2.6.0 changed its benchmark)
import { slowIt } from '../../rengine/webrSlow';
import type { Dataset, PlsResult } from '../../engine/types';
import { designParameters, summariseMc, type McDesign, type McPart } from '../../engine/montecarlo';
import { buildPopulation } from '../../engine/population';
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
import {
  exampleModel,
  exampleSettings,
  PACKAGE_EXAMPLES,
  panelPreset,
  type PackageExample,
} from '../packages';
import { against, example as exampleCheck, near, same } from '../../validation/record';
import { exampleTestData } from '../testData';
import type { RegsemRaw } from '../../rengine/search';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const exampleOf = (id: string) => PACKAGE_EXAMPLES.find((e) => e.id === id)!;

async function load(ex: PackageExample): Promise<Dataset> {
  const fromFile = exampleTestData(ex);
  if (fromFile) return fromFile;
  const raw = await rCall<{
    names: string[];
    cols: (number | null)[][];
    levels?: Record<string, string[]>;
  }>(
    'ps_dataset',
    { package: ex.data.package, name: ex.data.name, na: ex.data.na ?? [] },
    ex.data.package as RPackage,
  );
  return {
    names: raw.names,
    cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))),
    ...categoriesOf(raw.levels),
  };
}

/** The example as the app opens it: its data, settings and diagram, and its card with the example's options. */
async function open(
  id: string,
  method: string,
  packages: string[],
  pls?: (ctx: AnalysisCtx) => Promise<PlsResult>,
) {
  const ex = exampleOf(id);
  exampleCheck(id, { title: ex.title, method, packages, definition: ex });
  const data = await load(ex);
  const ctx: AnalysisCtx = {
    data,
    info: null,
    settings: exampleSettings(DEFAULT_SETTINGS, ex.settings),
    pls: null,
    projectName: ex.title,
    model: exampleModel(ex),
  };
  if (pls) ctx.pls = await pls(ctx);
  const kind = ex.panel!.kind,
    preset = panelPreset(ex.panel!);
  const t = analysisType(kind)!;
  const options = t.parseOptions({ ...t.defaults(ctx), ...preset })!;
  expect(t.blocked?.(options as never, ctx) ?? null, `${id}: the card is ready to run`).toBeNull();
  return {
    ex,
    data,
    ctx,
    t,
    options,
    run: <R>() => t.run(options as never, ctx, () => {}) as Promise<R>,
  };
}

const sameR = <T>(packages: string[], code: string) =>
  withR(['jsonlite', ...packages], { common: commonR }, (webR) =>
    callJson(webR, code, null),
  ) as Promise<T>;
const HS_MODEL = `HS.model <- ' visual  =~ x1 + x2 + x3
  textual =~ x4 + x5 + x6
  speed   =~ x7 + x8 + x9 '`;

it('datasets-faithful-chart: a histogram of the 272 eruption times', async () => {
  const { run, t, options } = await open('datasets-faithful-chart', 'Charts', ['datasets']);
  expect(t.id).toBe('chart');
  const r = await run<{
    kind: string;
    n: number;
    mean: number;
    sd: number;
    bins: { count: number }[];
  }>();
  against({ label: 'R’s faithful, mean() and sd() in desktop R 4.6', level: 'native' });
  same('chart', r.kind, 'histogram');
  same('n', r.n, 272);
  near('mean of eruptions', r.mean, 3.487783, 1e-6);
  near('SD of eruptions', r.sd, 1.141371, 1e-6);
  same(
    'eruptions in the bins',
    r.bins.reduce((a, b) => a + b.count, 0),
    272,
  );
  expect(options).toMatchObject({ kind: 'histogram', x: 'eruptions' });
}, 300_000);

it('datasets-faithful-scatter: eruptions against waiting time with the least-squares line', async () => {
  const { run, t, options } = await open('datasets-faithful-scatter', 'Charts', ['datasets']);
  expect(t.id).toBe('chart');
  // (the chart type is the card's own option "kind": given as the panel's options)
  expect(options).toMatchObject({ kind: 'scatter', x: 'waiting', y: 'eruptions', fit: true });
  const r = await run<{
    kind: string;
    n: number;
    fit: { slope: number; intercept: number; r: number } | null;
  }>();
  against({
    label: 'R’s faithful, lm(eruptions ~ waiting) and cor() in desktop R 4.6',
    level: 'native',
  });
  same('chart', r.kind, 'scatter');
  same('n', r.n, 272);
  near('slope', r.fit!.slope, 0.07562794795, 1e-8);
  near('intercept', r.fit!.intercept, -1.87401598641, 1e-8);
  near('r', r.fit!.r, 0.9008111683, 1e-8);
}, 300_000);

// (slow: minutes in webR; run with WEBR_SLOW, as npm run validate:evidence does)
slowIt(
  'lavaan-hs-bollenstine: the bootstrap of ?bootstrapLavaan, with the example’s 1,000 samples and seed',
  async () => {
    const { run } = await open('lavaan-hs-bollenstine', 'CB-SEM', ['lavaan']);
    const r = await run<{
      chisq: number;
      df: number;
      p: number;
      mlChisq: number;
      samples: number;
      boot: number[];
    }>();
    against({
      label: 'lavaan tutorial: CFA (printed)',
      level: 'published',
      url: 'https://lavaan.ugent.be/tutorial/cfa.html',
    });
    near('χ² (ML)', r.mlChisq, 85.306, 0.001);
    same('df', r.df, 24);
    // The help page's code, verbatim but for R = 1000 and the seed, in the same R.
    const ref = await sameR<{ orig: number; boot: number[] }>(
      ['lavaan'],
      `suppressPackageStartupMessages(library(lavaan))
    data(HolzingerSwineford1939, package = "lavaan")
    ${HS_MODEL}
    fit <- cfa(HS.model, data = HolzingerSwineford1939, se = "none")
    T.orig <- fitMeasures(fit, "chisq")
    set.seed(1234)
    T.boot <- bootstrapLavaan(fit, R = 1000, type = "bollen.stine", FUN = fitMeasures, fit.measures = "chisq")
    ps_json(list(orig = unname(T.orig), boot = I(as.numeric(T.boot))))`,
    );
    against({
      label:
        'lavaan, ?bootstrapLavaan: the help page’s code in the same R (R = 1000, set.seed(1234))',
      level: 'same-r',
      url: 'https://rdrr.io/cran/lavaan/man/bootstrapLavaan.html',
    });
    same('bootstrap samples', r.boot.length, ref.boot.length);
    const pRef = ref.boot.filter((x) => x >= ref.orig).length / ref.boot.length;
    near('Bollen–Stine p', r.p, pRef, 1e-9);
    same('Bollen–Stine p (no bootstrap χ² reaches the observed one, as the example says)', r.p, 0);
    const sorted = (v: number[]) => [...v].sort((a, b) => a - b);
    near('median bootstrap χ²', sorted(r.boot)[500], sorted(ref.boot)[500], 1e-6);
    near('largest bootstrap χ²', sorted(r.boot)[999], sorted(ref.boot)[999], 1e-6);
  },
  1_800_000,
);

it('lavaan-hs-wald: each critical ratio squared is lavTestWald’s test of the two loadings held equal', async () => {
  const { run } = await open('lavaan-hs-wald', 'CB-SEM', ['lavaan']);
  const r = await run<{ params: { label: string; est: number }[]; z: (number | null)[][] }>();
  same('free loadings compared', r.params.length, 6);
  const ref = await sameR<{ chisq: number; w23: number; w12: number; w13: number }>(
    ['lavaan'],
    `suppressPackageStartupMessages(library(lavaan))
    data(HolzingerSwineford1939, package = "lavaan")
    HS.model <- '
        visual  =~ x1 + b1*x2 + x3
        textual =~ x4 + b2*x5 + x6
        speed   =~ x7 + b3*x8 + x9
    '
    fit <- cfa(HS.model, data = HolzingerSwineford1939)
    ps_json(list(chisq = unname(fitMeasures(fit, "chisq")), w23 = lavTestWald(fit, constraints = "b2 == b3")$stat,
      w12 = lavTestWald(fit, constraints = "b1 == b2")$stat, w13 = lavTestWald(fit, constraints = "b1 == b3")$stat))`,
  );
  against({
    label: 'lavaan, ?lavTestWald: its model and lavTestWald() in the same R',
    level: 'same-r',
    url: 'https://rdrr.io/cran/lavaan/man/lavTestWald.html',
  });
  near('χ²', ref.chisq, 85.306, 0.001);
  const at = (label: string) => {
    const i = r.params.findIndex((p) => p.label === label);
    expect(i, label).toBeGreaterThanOrEqual(0);
    return i;
  };
  const z = (a: string, b: string) => {
    const i = at(a),
      j = at(b);
    return (r.z[i][j] ?? r.z[j][i])!;
  };
  near('z(x5, x8)² = Wald b2 == b3', z('textual → x5', 'speed → x8') ** 2, ref.w23, 1e-6);
  near('z(x2, x5)² = Wald b1 == b2', z('visual → x2', 'textual → x5') ** 2, ref.w12, 1e-6);
  near('z(x2, x8)² = Wald b1 == b3', z('visual → x2', 'speed → x8') ** 2, ref.w13, 1e-6);
}, 900_000);

it('lslx-hs-sfa: the help page’s semi-confirmatory factor analysis, as lslx runs it natively', async () => {
  const { run } = await open('lslx-hs-sfa', 'CB-SEM', ['lslx']);
  const r = await run<RegsemRaw>();
  // (scripts/validation/lslx.R: ?lslx's code in desktop lslx 0.6.11, converged tightly as the card does)
  const ref = JSON.parse(
    readFileSync(
      join(__dirname, '..', '..', 'engine', '__fixtures__', 'search', 'lslx.json'),
      'utf8',
    ),
  );
  against({
    label:
      'lslx, ?lslx (Semi-Confirmatory Factor Analysis): its code run natively, scripts/validation/lslx.R',
    level: 'native',
    url: 'https://rdrr.io/cran/lslx/man/lslx.html',
  });
  near('selected λ', r.selected.lambda, 0.14, 1e-10);
  same('selected δ', r.selected.delta ?? NaN, 1.5);
  near('χ²', r.test.chisq!, ref.test.chisq, 1e-5);
  same('df', r.test.df!, ref.test.df);
  near('RMSEA', r.fitIndex.rmsea!, ref.fitIndex.rmsea, 1e-6);
  near('CFI', r.fitIndex.cfi!, ref.fitIndex.cfi, 1e-6);
  const x9 = r.estimates.find((e) => e.label === 'visual → x9')!;
  near(
    'x9 on visual (penalised)',
    x9.est!,
    ref.coefficients.find((c: { name: string }) => c.name === 'x9<-visual/g').est,
    1e-6,
  );
  same(
    'non-zero cross-loadings',
    r.estimates.filter((e) => e.type === 'pen' && Math.abs(e.est ?? 0) > 1e-8).length,
    4,
  );
}, 900_000);

// nonnest2 is not in the browser's R until the lead locks it: the reference is nonnest2 0.5-9 in desktop R,
// scripts/validation/cbdiag.R (vuongtest(fit1, fit2) and icci(fit1, fit2) of the help pages, fit1 with a mean structure as ?icci).
it('nonnest2-hs-vuong: Vuong’s tests and the AIC / BIC difference intervals of ?vuongtest and ?icci', async () => {
  const { run } = await open('nonnest2-hs-vuong', 'CB-SEM', ['lavaan', 'nonnest2']);
  const r = await run<CompareModelsResult>();
  const ref = JSON.parse(
    readFileSync(
      join(__dirname, '..', '..', 'engine', '__fixtures__', 'cbdiag', 'reference.json'),
      'utf8',
    ),
  ).compare.documented;
  against({
    label:
      'nonnest2, ?vuongtest and ?icci: their lavaan example run natively (scripts/validation/cbdiag.R)',
    level: 'native',
    url: 'https://rdrr.io/cran/nonnest2/man/vuongtest.html',
  });
  same('treated as non-nested', String(r.vuong.nested), 'false');
  near('ω² (variance test)', r.vuong.omega!, ref.vuong.omega, 1e-8);
  near('p (variance test)', r.vuong.pOmega!, ref.vuong.pOmega, 1e-8);
  near('LR test z', r.vuong.stat!, ref.vuong.stat, 1e-6);
  near('p (model 2 better)', r.vuong.pB!, ref.vuong.pB, 1e-10);
  near('AIC difference, lower', r.icci.aicLow!, ref.icci.aicLow, 1e-4);
  near('AIC difference, upper', r.icci.aicHigh!, ref.icci.aicHigh, 1e-4);
  near('BIC difference, lower', r.icci.bicLow!, ref.icci.bicLow, 1e-4);
  near('BIC difference, upper', r.icci.bicHigh!, ref.icci.bicHigh, 1e-4);
  near('AIC (one group), as ?icci prints', r.icci.aic1!, 7535.49, 0.001);
  near('BIC (two groups), as ?icci prints', r.icci.bic2!, 7706.822, 0.001);
}, 900_000);

it('lavaan-hs-scoreweights: the weights applied to the centred tests give lavPredict’s scores', async () => {
  const { run, data } = await open('lavaan-hs-scoreweights', 'CB-SEM', ['lavaan']);
  const r = await run<{
    method: string;
    factors: string[];
    variables: string[];
    weights: number[][];
  }>();
  same('method', r.method, 'regression');
  const ref = await sameR<{ scores: number[][]; names: string[] }>(
    ['lavaan'],
    `suppressPackageStartupMessages(library(lavaan))
    data(HolzingerSwineford1939, package = "lavaan")
    ${HS_MODEL}
    fit <- cfa(HS.model, data = HolzingerSwineford1939)
    fs <- lavPredict(fit)
    ps_json(list(names = I(colnames(fs)), scores = lapply(seq_len(ncol(fs)), function(k) I(unname(fs[, k])))))`,
  );
  against({
    label: 'lavaan, ?lavPredict: lavPredict(fit) in the same R',
    level: 'same-r',
    url: 'https://rdrr.io/cran/lavaan/man/lavPredict.html',
  });
  const col = (n: string) => Array.from(data.cols[data.names.indexOf(n)]);
  const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
  for (const [k, factor] of r.factors.entries()) {
    const ref_k = ref.scores[ref.names.indexOf(factor)];
    const centred = r.variables.map((v) => {
      const x = col(v);
      const m = mean(x);
      return x.map((y) => y - m);
    });
    const mine = ref_k.map((_, i) => r.weights[k].reduce((s, w, j) => s + w * centred[j][i], 0));
    near(
      `largest |score − lavPredict| of ${factor}`,
      Math.max(...mine.map((s, i) => Math.abs(s - ref_k[i]))),
      0,
      1e-6,
    );
  }
}, 900_000);

webrOnlyIt(
  'seminr-corprep-predict: PLSpredict as seminr’s predict_pls (predict_EA, seed 123): every PLS and LM error of its summary',
  async () => {
    const { run } = await open('seminr-corprep-predict', 'PLS-SEM', ['seminr']);
    const r = await run<{
      folds: number;
      repetitions: number;
      predictEngine?: string;
      indicators: {
        indicator: string;
        rmsePls: number;
        rmseLm: number;
        maePls: number;
        maeLm: number;
        q2: number;
      }[];
    }>();
    same('folds', r.folds, 10);
    same('repetitions', r.repetitions, 10);
    expect(r.predictEngine).toBe('seminr');
    // seminr 2.5.0 (webR's version) in desktop R 4.6.2: set.seed(123); summary(predict_pls(model, technique = predict_EA, noFolds = 10,
    // reps = 10)), the model of seminr-corprep (mean_replacement, missing_value = "-99"): PLS RMSE, MAE, LM RMSE, MAE. (seminr 2.6.0
    // changed the LM benchmark: comp_1 LM RMSE 1.067, as the description states.)
    const SEMINR_EA: Record<string, [number, number, number, number]> = {
      comp_1: [1.04589478, 0.80022668, 1.08067928, 0.82242669],
      comp_2: [1.09903258, 0.88179135, 1.10662327, 0.87438965],
      comp_3: [1.137117, 0.89758329, 1.14194884, 0.87177759],
      like_1: [1.13006096, 0.85739296, 1.15071002, 0.87833415],
      like_2: [1.48569928, 1.14971342, 1.55932197, 1.19345388],
      like_3: [1.51117598, 1.173593, 1.58031245, 1.23688521],
      cusa: [1.02138417, 0.7892447, 1.020902, 0.79937557],
      cusl_1: [1.30653811, 0.99350917, 1.31230995, 0.96828109],
      cusl_2: [1.52735431, 1.17764423, 1.55408102, 1.17686003],
      cusl_3: [1.53260191, 1.15599644, 1.5761964, 1.1913734],
    };
    against({
      label:
        'seminr 2.5.0, summary(predict_pls(technique = predict_EA, noFolds = 10, reps = 10)) after set.seed(123), run in desktop R 4.6.2',
      level: 'native',
      url: 'https://rdrr.io/cran/seminr/man/predict_pls.html',
    });
    same('predicted indicators', r.indicators.length, 10);
    for (const [ind, [rmse, mae, rmseLm, maeLm]] of Object.entries(SEMINR_EA)) {
      const row = r.indicators.find((x) => x.indicator === ind)!;
      near(`RMSE (PLS) of ${ind}`, row.rmsePls, rmse, 1e-7);
      near(`MAE (PLS) of ${ind}`, row.maePls, mae, 1e-7);
      near(`RMSE (LM) of ${ind}`, row.rmseLm, rmseLm, 1e-7);
      near(`MAE (LM) of ${ind}`, row.maeLm, maeLm, 1e-7);
      expect(row.q2, `Q²predict of ${ind}`).toBeGreaterThan(0);
    }
  },
  1_800_000,
);

it('seminr-mobi-compare: AIC and BIC per endogenous construct as seminr’s it_criteria, for both models', async () => {
  const { run } = await open('seminr-mobi-compare', 'PLS-SEM', ['cSEM', 'seminr']);
  const r = await run<{
    criteria: { criterion: string; byConstruct: Record<string, number> }[];
    criteriaAlt: { criterion: string; byConstruct: Record<string, number> }[];
    cvpat: { p: number; loss: number; lossAlt: number };
  }>();
  const ref = await sameR<Record<'med' | 'ovr', Record<string, Record<string, number>>>>(
    ['seminr'],
    `suppressPackageStartupMessages(library(seminr))
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
    ps_json(list(med = ic(mediated_sm), ovr = ic(overriding_effects_sm)))`,
  );
  against({
    label: 'seminr, demo("seminr-alternative-models"): summary()$it_criteria in the same R',
    level: 'same-r',
    url: 'https://github.com/sem-in-r/seminr/blob/master/demo/seminr-alternative-models.R',
  });
  for (const [mine, theirs, which] of [
    [r.criteria, ref.ovr, 'overriding'],
    [r.criteriaAlt, ref.med, 'mediated'],
  ] as const) {
    for (const k of ['AIC', 'BIC']) {
      const row = mine.find((x) => x.criterion === k)!;
      expect(row, `${k} in the card`).toBeTruthy();
      for (const c of ['Satisfaction', 'Value', 'Loyalty', 'Complaints'])
        near(`${k} of ${c} (${which})`, row.byConstruct[c], theirs[k][c], 0.01);
    }
  }
  expect(r.cvpat.p).toBeGreaterThanOrEqual(0);
  expect(r.cvpat.p).toBeLessThanOrEqual(1);
}, 1_800_000);

it('seminr-corprep-cta: the tetrads and their bootstrap SEs as computed by hand', async () => {
  const { run } = await open('seminr-corprep-cta', 'PLS-SEM', ['stats']);
  const r = await run<{
    samples: number;
    blocks: { construct: string; tetrads: { tetrad: string; est: number; se: number }[] }[];
  }>();
  same('bootstrap samples', r.samples, 1000);
  const count = Object.fromEntries(r.blocks.map((b) => [b.construct, b.tetrads.length]));
  // (the formula's counts of tetrads: structure, not an estimate, so this source grades nothing: published evidence
  // needs an estimated quantity, types.ts isEstimateComparison; the tetrads themselves are compared below)
  against({
    label: 'Bollen & Ting (1993): p(p − 3)/2 non-redundant tetrads per block',
    level: 'runs',
  });
  same('tetrads of QUAL (8 indicators)', count.QUAL, 20);
  same('tetrads of PERF (5 indicators)', count.PERF, 5);
  same('tetrads of CSOR (5 indicators)', count.CSOR, 5);
  const tetrads = r.blocks.flatMap((b) => b.tetrads.map((t) => t.tetrad.split(', ')));
  const ref = await sameR<{ est: number[]; se: number[] }>(
    [],
    `data(corp_rep_data, package = "seminr")
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
    ps_json(list(est = I(est), se = I(se)))`,
  );
  against({
    label:
      'the tetrads and their bootstrap SEs computed by hand in the same R (mean replacement, set.seed(123), 1,000 resamples)',
    level: 'same-r',
  });
  const mine = r.blocks.flatMap((b) => b.tetrads);
  mine.forEach((t, i) => {
    near(`tetrad ${t.tetrad}`, t.est, ref.est[i], 1e-9);
    near(`SE of tetrad ${t.tetrad}`, t.se, ref.se[i], 1e-9);
  });
}, 1_800_000);

it('seminr-corprep-minsample: Kock & Hadaya’s minimum sample size for every path of the estimated model', async () => {
  const { run } = await open('seminr-corprep-minsample', 'PLS-SEM', ['seminr'], (ctx) =>
    estimatePlsR(ctx.data!, toSpec(ctx.model!), plsOptions(ctx.settings), 'seminr'),
  );
  const r = await run<{
    z: number;
    betaMin: number;
    nMin: number;
    n: number;
    paths: { from: string; to: string; beta: number; nMin: number }[];
  }>();
  against({
    label: 'Kock & Hadaya (2018): z(0.95) + z(0.80) = 2.486, n_min > (z / |β_min|)²',
    level: 'published',
    url: 'https://doi.org/10.1111/isj.12131',
  });
  near('z(1 − α) + z(power)', r.z, 2.486, 5e-4);
  for (const p of r.paths)
    same(`n_min of ${p.from} → ${p.to}`, p.nMin, Math.ceil((r.z / Math.abs(p.beta)) ** 2));
  // seminr 2.6.0 in desktop R: estimate_pls() of the extended model, round(m$path_coef, 4) (Hair et al. 2021, chapter 6).
  const SEMINR_PATHS: [string, string, number][] = [
    ['QUAL', 'COMP', 0.4297],
    ['PERF', 'COMP', 0.2955],
    ['CSOR', 'COMP', 0.0589],
    ['ATTR', 'COMP', 0.0861],
    ['QUAL', 'LIKE', 0.38],
    ['PERF', 'LIKE', 0.117],
    ['CSOR', 'LIKE', 0.1784],
    ['ATTR', 'LIKE', 0.1671],
    ['COMP', 'CUSA', 0.1455],
    ['LIKE', 'CUSA', 0.4357],
    ['COMP', 'CUSL', 0.0057],
    ['LIKE', 'CUSL', 0.344],
    ['CUSA', 'CUSL', 0.505],
  ];
  against({
    label:
      'seminr 2.6.0, estimate_pls() of the extended corporate reputation model, run in desktop R',
    level: 'native',
  });
  same('n', r.n, 344);
  for (const [from, to, beta] of SEMINR_PATHS)
    near(
      `β ${from} → ${to}`,
      r.paths.find((p) => p.from === from && p.to === to)!.beta,
      beta,
      1e-4,
    );
  near('smallest |β|', r.betaMin, 0.0057, 1e-4);
  same(
    'paths needing more than the 344 observations (as the example says)',
    r.paths
      .filter((p) => p.nMin > 344)
      .map((p) => `${p.from} → ${p.to}`)
      .sort()
      .join(', '),
    'ATTR → COMP, COMP → CUSL, CSOR → COMP, PERF → LIKE',
  );
}, 900_000);

it('plspm-pos: PLS-POS recovers the two simulated segments of simdata', async () => {
  const { run, data } = await open('plspm-pos', 'PLS-SEM', ['cSEM']);
  const r = await run<{
    k: number;
    n: number;
    objective: number;
    globalObjective: number;
    assignment: number[];
    segments: { paths: { from: string; est: number }[] }[];
  }>();
  const group = data.cols[data.names.indexOf('group')];
  const agree = r.assignment.filter((a, i) => a === group[i]).length / r.n;
  against({
    label:
      'plspm, ?simdata: the simulated segment of each customer (group), recovered with seed 1 (at least 85% agreement)',
    level: 'recovery',
    url: 'https://rdrr.io/cran/plspm/man/simdata.html',
  });
  same('segments', r.k, 2);
  same('n', r.n, 400);
  expect(Math.max(agree, 1 - agree), 'agreement with the simulated segments').toBeGreaterThan(0.85);
  expect(r.objective).toBeGreaterThan(r.globalObjective);
  const price = r.segments.map((g) => g.paths.find((p) => p.from === 'Price')!.est);
  expect(Math.max(...price), 'one segment price-driven').toBeGreaterThan(0.6);
}, 1_800_000);

// (slow: minutes in webR; run with WEBR_SLOW, as npm run validate:evidence does)
slowIt(
  'muthen-mc-cfa: power .81 for the factor correlation at N = 150',
  async () => {
    const { options } = await open('muthen-mc-cfa', 'Simulation', ['lavaan']);
    // The card's run() spreads chunks over the app's R sessions (runner.simulate); here the same chunks, one after another.
    const design = options as McDesign;
    const parts: McPart[] = [];
    for (let s = 0; s < design.replications; s += 100)
      parts.push(await runMcChunkR(design, 150, s, Math.min(design.replications, s + 100)));
    const rows = summariseMc(design, parts);
    // (the correlation of the two factors, as the paper tests it)
    const cor = rows.find((x) => x.param.kind === 'covariance')!;
    same('replications', cor.reps, 1000);
    same('failed replications', cor.failed, 0);
    against({
      label:
        'Muthén & Muthén (2002), p. 607: N = 150 gives power .81 for the factor correlation (10,000 replications; here 1,000: Monte Carlo SE 0.012, within 0.04)',
      level: 'published',
      url: 'https://doi.org/10.1207/S15328007SEM0904_8',
    });
    near('power of f1 ↔ f2', cor.rejection!, 0.81, 0.04);
    near('mean estimate of f1 ↔ f2 (population .25)', cor.mean, 0.25, 0.01);
    near('coverage of the 95% interval', cor.coverage!, 0.95, 0.02);
  },
  1_800_000,
);

/** A Monte Carlo card's design run in R, all its replications, without the bootstrap unless `boot`. */
async function mcCardRun(id: string, boot = false) {
  const { options } = await open(id, 'Simulation', ['cSEM', 'lavaan']);
  const card = options as McDesign;
  const design: McDesign = boot ? card : { ...card, bootSamples: 0 };
  // (all chunks at once: the native R pool runs them on its workers, in order of the request)
  const chunks = design.sampleSizes.flatMap((n) =>
    Array.from({ length: Math.ceil(design.replications / 100) }, (_, c) => ({ n, s: 100 * c })),
  );
  const parts: McPart[] = await Promise.all(
    chunks.map(({ n, s }) => runMcChunkR(design, n, s, Math.min(design.replications, s + 100))),
  );
  const rows = summariseMc(design, parts);
  const row = (estimator: string, key: string, n: number) =>
    rows.find((x) => x.estimator === estimator && x.n === n && x.param.key === key)!;
  // Unimodal: more estimates within ±.05 of their mean than between .10 and .15 from it (a bimodal
  // distribution, as at a null path in Rönkkö & Evermann's model, has its dip at the mean).
  const unimodal = (estimator: string, key: string, n: number) => {
    const ei = design.estimators.findIndex((e) => e.id === estimator);
    const pi = designParameters(design, buildPopulation(design.population)).findIndex(
      (p) => p.key === key,
    );
    const est = parts
      .filter((p) => p.n === n)
      .flatMap((p) => Array.from(p.est[ei][pi]))
      .filter(Number.isFinite);
    const mean = est.reduce((t, v) => t + v, 0) / est.length;
    const share = (lo: number, hi: number) =>
      est.filter((v) => Math.abs(v - mean) >= lo && Math.abs(v - mean) < hi).length / est.length;
    return share(0, 0.05) > share(0.1, 0.15);
  };
  return { card, parts, rows, row, unimodal };
}

/** A Rönkkö & Evermann card's design run in R without the bootstrap (point estimates), all 500 replications. */
async function ronkkoEvermannRun(id: string) {
  const run = await mcCardRun(id);
  same('sample size', run.card.sampleSizes[0], 100);
  same('replications', run.card.replications, 500);
  const path = (estimator: string, n = 100) => run.row(estimator, 'path:A:B', n);
  const reliability = (estimator: string, n = 100) => run.row(estimator, 'reliability:A', n);
  return { ...run, path, reliability };
}

slowIt(
  'ronkko-evermann-null: the PLS estimate of a null path is bimodal; sum scores and ML SEM are not',
  async () => {
    const { parts, path, reliability } = await ronkkoEvermannRun('ronkko-evermann-null');
    const [modeA, modeB] = ['PLS mode A, centroid', 'PLS mode B, centroid'];
    // (cSEM's PLS does not converge in a few samples of a null path: 9 (mode A) and 14 (mode B) of
    // 500 in desktop cSEM 0.7.1)
    for (const e of [modeA, modeB])
      expect(path(e).failed, `${e}: replications without convergence`).toBeLessThan(25);
    for (const e of ['Sum scores', 'CB-ML']) same(`${e} failed`, path(e).failed, 0);
    // (the PLS estimators come first, in the card's order; A → B comes after the fit tests CB-SEM adds)
    const card = exampleOf('ronkko-evermann-null').panel as unknown as McDesign;
    const at = designParameters(card, buildPopulation(card.population)).findIndex(
      (p) => p.key === 'path:A:B',
    );
    const share = (estimator: number, lo: number, hi: number) => {
      const est = parts.flatMap((p) => Array.from(p.est[estimator][at])).filter(Number.isFinite);
      return est.filter((x) => Math.abs(x) >= lo && Math.abs(x) < hi).length / est.length;
    };
    against({
      label:
        'Rönkkö & Evermann (2013), Figures 2 and 3: at β = 0 and N = 100 the estimates of PLS mode A and mode B (centroid weighting) are bimodal (fewer within ±.05 of 0 than between ±.10 and ±.15), mode B the more spread; regression on sum scores and ML SEM center on 0; the composites of mode A are less reliable than sum scores, those of mode B less still',
      level: 'published',
      url: 'https://doi.org/10.1177/1094428112474693',
    });
    for (const [k, e] of [modeA, modeB].entries())
      expect(share(k, 0, 0.05), `${e}: fewer estimates near 0 than at ±.1 to ±.15`).toBeLessThan(
        share(k, 0.1, 0.15),
      );
    near('sum scores: mean estimate', path('Sum scores').mean, 0, 0.02);
    near('ML SEM: mean estimate', path('CB-ML').mean, 0, 0.03);
    expect(path(modeA).sd, 'PLS mode A: larger SD than sum scores').toBeGreaterThan(
      1.5 * path('Sum scores').sd,
    );
    expect(path(modeB).sd, 'PLS mode B: larger SD than mode A').toBeGreaterThan(path(modeA).sd);
    expect(reliability(modeA).mean, 'PLS mode A: less reliable than sum scores').toBeLessThan(
      reliability('Sum scores').mean,
    );
    expect(reliability(modeB).mean, 'PLS mode B: less reliable than mode A').toBeLessThan(
      reliability(modeA).mean,
    );
  },
  1_800_000,
);

slowIt(
  'ronkko-evermann-beta: sum scores underestimate β = .3, PLS less so, ML SEM not at all',
  async () => {
    const { path, reliability } = await ronkkoEvermannRun('ronkko-evermann-beta');
    const [modeA, modeB] = ['PLS mode A, centroid', 'PLS mode B, centroid'];
    against({
      label:
        'Rönkkö & Evermann (2013), Figures 2 and 3: with loadings .6/.7/.8 and N = 100, sum scores are attenuated (composite reliability about .75: β ≈ .3 · .75 = .22); PLS weights capitalise on chance and raise the estimate above the sum scores’ (mode A below the true value, mode B about at it, with the larger SD) although their composites are less reliable; ML SEM is unbiased with a larger SD than PLS mode A',
      level: 'published',
      url: 'https://doi.org/10.1177/1094428112474693',
    });
    near('sum scores: mean estimate', path('Sum scores').mean, 0.22, 0.02);
    expect(path(modeA).mean, 'PLS mode A: above sum scores').toBeGreaterThan(
      path('Sum scores').mean,
    );
    expect(path(modeA).mean, 'PLS mode A: below the true .3').toBeLessThan(0.3);
    expect(path(modeB).mean, 'PLS mode B: above mode A').toBeGreaterThan(path(modeA).mean);
    expect(path(modeB).sd, 'PLS mode B: larger SD than mode A').toBeGreaterThan(path(modeA).sd);
    near('ML SEM: mean estimate', path('CB-ML').mean, 0.3, 0.03);
    expect(path('CB-ML').sd, 'ML SEM: larger SD than PLS mode A').toBeGreaterThan(path(modeA).sd);
    expect(reliability(modeA).mean, 'PLS mode A: less reliable than sum scores').toBeLessThan(
      reliability('Sum scores').mean,
    );
    expect(reliability(modeB).mean, 'PLS mode B: less reliable than mode A').toBeLessThan(
      reliability(modeA).mean,
    );
  },
  1_800_000,
);

it('mulder-riclpm: the tutorial’s basic RI-CLPM', async () => {
  const { run } = await open('mulder-riclpm', 'Longitudinal', ['lavaan']);
  const r = await run<{
    n: number;
    fit: { chisq?: number; df?: number };
    estimates: { lhs: string; op: string; rhs: string; est: number; se: number | null }[];
  }>();
  // Desktop lavaan 0.7-3 (R 4.6): the tutorial's RICLPM syntax, lavaan(RICLPM, data = dat, missing = 'ML', meanstructure = T, int.ov.free = T).
  against({
    label:
      'Mulder & Hamaker (2021), the RI-CLPM tutorial’s lavaan code run in desktop lavaan 0.7-3',
    level: 'native',
    url: 'https://jeroendmulder.github.io/RI-CLPM/lavaan.html',
  });
  same('n', r.n, 1189);
  near('χ²', r.fit.chisq!, 25.806, 0.001);
  same('df', r.fit.df!, 21);
  const REF: [string, string, string, number, number][] = [
    ['wx2', '~', 'wx1', 0.232, 0.028],
    ['wx2', '~', 'wy1', 0.009, 0.026],
    ['wy2', '~', 'wx1', 0.174, 0.045],
    ['wy2', '~', 'wy1', 0.004, 0.046],
    ['wx3', '~', 'wx2', 0.241, 0.037],
    ['wx3', '~', 'wy2', 0.026, 0.024],
    ['wy3', '~', 'wx2', 0.156, 0.054],
    ['wy3', '~', 'wy2', 0.262, 0.039],
    ['wx4', '~', 'wx3', 0.279, 0.038],
    ['wx4', '~', 'wy3', 0.01, 0.023],
    ['wy4', '~', 'wx3', 0.185, 0.055],
    ['wy4', '~', 'wy3', 0.296, 0.035],
    ['wx5', '~', 'wx4', 0.29, 0.035],
    ['wx5', '~', 'wy4', -0.004, 0.022],
    ['wy5', '~', 'wx4', 0.124, 0.048],
    ['wy5', '~', 'wy4', 0.392, 0.031],
    ['RIx', '~~', 'RIx', 0.009, 0.001],
    ['RIy', '~~', 'RIy', 0.032, 0.003],
    ['RIx', '~~', 'RIy', 0.01, 0.001],
  ];
  for (const [lhs, op, rhs, est, se] of REF) {
    const e = r.estimates.find((x) => x.lhs === lhs && x.op === op && x.rhs === rhs);
    expect(e, `${lhs} ${op} ${rhs}`).toBeTruthy();
    near(`${lhs} ${op} ${rhs}`, e!.est, est, 0.0006);
    near(`SE of ${lhs} ${op} ${rhs}`, e!.se!, se, 0.0006);
  }
}, 900_000);

const [MODE_A, MODE_B] = ['PLS mode A, centroid', 'PLS mode B, centroid'];
const HENSELER = {
  level: 'published' as const,
  url: 'https://doi.org/10.1177/1094428114526928',
};

slowIt(
  'henseler-beta5: at β = .5 PLS mode A composites are at least as reliable as sum scores; estimates unimodal',
  async () => {
    const { path, reliability, unimodal } = await ronkkoEvermannRun('henseler-beta5');
    against({
      ...HENSELER,
      label:
        'Henseler et al. (2014), Table 2 condition c and Figure 5c: at β = .5 and N = 100 the average reliability of PLS mode A composites (.867, squared .752) reaches that of sum scores (.862, squared .743), mode B lower; the estimates of the path are unimodal',
    });
    expect(reliability(MODE_A).mean, 'PLS mode A: more reliable than sum scores').toBeGreaterThan(
      reliability('Sum scores').mean,
    );
    near('PLS mode A reliability (paper .867² = .752)', reliability(MODE_A).mean, 0.752, 0.01);
    expect(reliability(MODE_B).mean, 'PLS mode B: less reliable').toBeLessThan(
      reliability(MODE_A).mean,
    );
    for (const e of [MODE_A, MODE_B, 'Sum scores'])
      expect(unimodal(e, 'path:A:B', 100), `${e}: unimodal`).toBe(true);
    near('sum scores: mean estimate (.745 · .5)', path('Sum scores').mean, 0.37, 0.02);
    near('ML SEM: mean estimate', path('CB-ML').mean, 0.5, 0.03);
  },
  1_800_000,
);

slowIt(
  'henseler-n500: PLS mode A falls behind sum scores at N = 100 and overtakes them at N = 500',
  async () => {
    const { path, reliability, unimodal } = await ronkkoEvermannRun('henseler-n500');
    against({
      ...HENSELER,
      label:
        'Henseler et al. (2014), Table 2 conditions b and d and Figure 5d: at β = .3 the reliability of PLS mode A composites is below that of sum scores at N = 100 (.843 against .862, squared .711 and .743) and above it at N = 500 (.868, squared .753); at N = 500 the path estimates are unimodal and far less spread',
    });
    expect(reliability(MODE_A, 100).mean).toBeLessThan(reliability('Sum scores', 100).mean);
    expect(reliability(MODE_A, 500).mean).toBeGreaterThan(reliability('Sum scores', 500).mean);
    near(
      'PLS mode A reliability at N = 500 (paper .753)',
      reliability(MODE_A, 500).mean,
      0.753,
      0.01,
    );
    expect(reliability(MODE_B, 500).mean).toBeGreaterThan(reliability(MODE_B, 100).mean + 0.1);
    for (const e of [MODE_A, MODE_B, 'Sum scores', 'CB-ML']) {
      expect(unimodal(e, 'path:A:B', 500), `${e}: unimodal at N = 500`).toBe(true);
      expect(path(e, 500).sd, `${e}: SD at N = 500 under half that at 100`).toBeLessThan(
        path(e, 100).sd / 2,
      );
    }
  },
  1_800_000,
);

slowIt(
  'henseler-loadings: with loadings .5/.7/.9 PLS mode A composites beat sum scores at N = 100',
  async () => {
    const { reliability } = await ronkkoEvermannRun('henseler-loadings');
    against({
      ...HENSELER,
      label:
        'Henseler et al. (2014), Table 2 condition e: with loadings .5, .7 and .9, β = .3 and N = 100 PLS mode A composites are more reliable on average than sum scores (.871 against .867, squared .759 and .752)',
    });
    near('sum scores: reliability (population .752)', reliability('Sum scores').mean, 0.752, 0.002);
    expect(reliability(MODE_A).mean, 'PLS mode A: more reliable than sum scores').toBeGreaterThan(
      reliability('Sum scores').mean,
    );
    expect(reliability(MODE_B).mean).toBeLessThan(reliability(MODE_A).mean);
  },
  1_800_000,
);

slowIt(
  'henseler-four: in the four-construct model PLS mode A is as reliable as sum scores; estimates unimodal',
  async () => {
    const { path, reliability, unimodal } = await ronkkoEvermannRun('henseler-four');
    against({
      ...HENSELER,
      label:
        'Henseler et al. (2014), Table 2 condition f and Figure 5f: in the model C → A → B ← D (all paths .3, N = 100) PLS mode A composites are about as reliable as sum scores (.858 against .862, squared .736 and .743) and the estimates of A → B are unimodal',
    });
    near(
      'PLS mode A against sum scores',
      reliability(MODE_A).mean,
      reliability('Sum scores').mean,
      0.015,
    );
    for (const e of [MODE_A, MODE_B, 'Sum scores'])
      expect(unimodal(e, 'path:A:B', 100), `${e}: unimodal`).toBe(true);
    for (const e of [MODE_A, 'Sum scores']) expect(path(e).mean).toBeLessThan(0.3);
    near('ML SEM: mean estimate', path('CB-ML').mean, 0.3, 0.03);
  },
  1_800_000,
);

const GOODHUE = { level: 'published' as const, url: 'https://doi.org/10.2307/41703490' };

slowIt(
  'goodhue-nonnormal: Fleishman per indicator reproduces Tables A4 and A5; Vale–Maurelli keeps the estimates',
  async () => {
    const { card, row } = await mcCardRun('goodhue-nonnormal');
    same('the paper’s generator', card.population.nonnormal ?? '', 'fleishman');
    const path = (e: string, k: number, n: number) => row(e, `path:Ksi${k}:Eta1`, n);
    against({
      ...GOODHUE,
      label:
        'Goodhue, Lewis & Thompson (2012), Appendix Tables A4 and A5, extreme skew: mean estimates of the .48 path .330 / .334 (regression) and .407 / .428 (LISREL) at N = 40 / 90; power for the .314 path at N = 90 .53 (regression) and .50 (LISREL)',
    });
    for (const n of [40, 90]) {
      near(`regression, large path at N = ${n}`, path('Sum scores', 1, n).mean, 0.332, 0.03);
      near(`ML SEM, large path at N = ${n}`, path('CB-ML', 1, n).mean, 0.417, 0.04);
    }
    near('regression power, medium path, N = 90', path('Sum scores', 2, 90).rejection!, 0.53, 0.07);
    near('ML SEM power, medium path, N = 90', path('CB-ML', 2, 90).rejection!, 0.5, 0.07);
    // Vale–Maurelli: the same skewness without shrinking the correlations
    const vm = await runMcChunkR(
      { ...card, bootSamples: 0, population: { ...card.population, nonnormal: undefined } },
      90,
      0,
      200,
    );
    const kept = summariseMc({ ...card, bootSamples: 0, sampleSizes: [90] }, [vm]).find(
      (x) => x.estimator === 'Sum scores' && x.param.key === 'path:Ksi1:Eta1',
    )!;
    near('regression, large path, Vale–Maurelli (normal data .391)', kept.mean, 0.4, 0.03);
  },
  3_600_000,
);

slowIt(
  'goodhue-sample-size: regression and ML SEM against Tables A1 and A2 at N = 20 to 200; PLS estimates like regression',
  async () => {
    const { row } = await mcCardRun('goodhue-sample-size');
    const path = (e: string, k: number, n: number) => row(e, `path:Ksi${k}:Eta1`, n);
    against({
      ...GOODHUE,
      label:
        'Goodhue, Lewis & Thompson (2012), Appendix Tables A1 and A2: mean estimates of the .48 path about .39 (regression), .40 (PLS) and .48 (LISREL) at every N; power for the .314 path .40 / .76 / .97 (regression) and .37 / .79 / .98 (LISREL) at N = 40 / 90 / 200; the null path rejected about 5% of the time',
    });
    for (const n of [40, 90, 150, 200]) {
      near(`regression, large path at N = ${n}`, path('Sum scores', 1, n).mean, 0.39, 0.03);
      near(`PLS, large path at N = ${n}`, path('PLS', 1, n).mean, 0.4, 0.03);
      near(`ML SEM, large path at N = ${n}`, path('CB-ML', 1, n).mean, 0.48, 0.03);
    }
    // (the paper's indicators are rounded to whole numbers, a little less reliable than the card's)
    near('regression power, medium path, N = 40', path('Sum scores', 2, 40).rejection!, 0.4, 0.07);
    near('regression power, medium path, N = 90', path('Sum scores', 2, 90).rejection!, 0.76, 0.07);
    near(
      'regression power, medium path, N = 200',
      path('Sum scores', 2, 200).rejection!,
      0.97,
      0.03,
    );
    near('ML SEM power, medium path, N = 90', path('CB-ML', 2, 90).rejection!, 0.79, 0.07);
    near('ML SEM power, medium path, N = 200', path('CB-ML', 2, 200).rejection!, 0.98, 0.03);
    for (const n of [90, 150, 200])
      for (const e of ['Sum scores', 'CB-ML'])
        expect(path(e, 4, n).rejection!, `${e}: Type I at N = ${n}`).toBeLessThan(0.09);
    // ML SEM fails or is improper far more often at small N
    expect(path('CB-ML', 1, 20).failed + path('CB-ML', 1, 20).improper).toBeGreaterThan(
      5 * (path('CB-ML', 1, 200).failed + path('CB-ML', 1, 200).improper),
    );
    // the SDs about triple from N = 200 to 20 (Figure 3c)
    for (const e of ['Sum scores', 'PLS'])
      expect(path(e, 1, 20).sd / path(e, 1, 200).sd).toBeGreaterThan(2.5);
  },
  3_600_000,
);

const HENSELER_2015 = {
  level: 'published' as const,
  url: 'https://doi.org/10.1007/s11747-014-0403-8',
};

slowIt(
  'henseler2015-split and -high: Fornell–Larcker and cross-loadings miss one factor split in two, HTMT finds it (Table 3)',
  async () => {
    const NS = [100, 250, 500, 1000];
    const PLS = 'PLS mode A, centroid';
    const split = await mcCardRun('henseler2015-split', true);
    against({
      ...HENSELER_2015,
      label:
        'Henseler, Ringle & Sarstedt (2015), Table 3, loadings .7, φ = 1 at N = 100 / 250 / 500 / 1,000: Fornell–Larcker 6.9 / 0.3 / 0 / 0% (either construct), cross-loadings 0%, HTMT.85 99.1 / 100%, HTMT.90 95.9 / 99.9 / 100 / 100%, HTMT inference 96.0 / 95.7 / 94.9 / 95.5%',
    });
    const fail = (run: typeof split, key: string, n: number) =>
      run.row(PLS, `validity:${key}`, n).rejection!;
    near(
      'split: Fornell–Larcker, N = 100 (6.9% either construct)',
      fail(split, 'fl:A', 100),
      0.05,
      0.03,
    );
    for (const n of NS) {
      expect(fail(split, 'xl:A', n), `split: cross-loadings at N = ${n}`).toBe(0);
      near(`split: HTMT inference at N = ${n}`, fail(split, 'htmtci:A:B', n), 0.955, 0.025);
      expect(fail(split, 'htmt:A:B', n), `split: HTMT.85 at N = ${n}`).toBeGreaterThan(0.98);
    }
    near('split: HTMT.90 at N = 100 (95.9%)', fail(split, 'htmt90:A:B', 100), 0.959, 0.025);
    expect(fail(split, 'fl:A', 1000)).toBe(0);
    near(
      'split: the composites correlate at their reliability',
      split.row(PLS, 'cov:A:B', 250).mean,
      0.742,
      0.01,
    );

    const high = await mcCardRun('henseler2015-high', true);
    against({
      ...HENSELER_2015,
      label:
        'Henseler, Ringle & Sarstedt (2015), Table 3, loadings .9, φ = 1 at N = 100 / 250 / 500 / 1,000: Fornell–Larcker 42.1 / 27.3 / 15.4 / 4.8% (either construct), cross-loadings 0%, HTMT.85 and HTMT.90 100%, HTMT inference 96.3 / 96.0 / 95.5 / 96.0%',
    });
    // (per construct; the paper flags the pair when either fails, a little more often)
    const fl = NS.map((n) => fail(high, 'fl:A', n));
    near('high: Fornell–Larcker, N = 100 (42.1% either construct)', fl[0], 0.3, 0.07);
    near('high: Fornell–Larcker, N = 1,000 (4.8% either construct)', fl[3], 0.03, 0.025);
    for (let k = 1; k < NS.length; k++)
      expect(fl[k], 'fewer flags as N grows').toBeLessThan(fl[k - 1]);
    for (const n of NS) {
      expect(fail(high, 'htmt90:A:B', n)).toBe(1);
      near(`high: HTMT inference at N = ${n}`, fail(high, 'htmtci:A:B', n), 0.958, 0.025);
    }
  },
  3_600_000,
);

slowIt(
  'henseler2015-unequal and -close: unequal loadings push HTMT above 1; at φ = .9 the three HTMT checks disagree',
  async () => {
    const PLS = 'PLS mode A, centroid';
    const unequal = await mcCardRun('henseler2015-unequal', true);
    against({
      ...HENSELER_2015,
      label:
        'Henseler, Ringle & Sarstedt (2015), Table 3, loadings .5 / .7 / .9, φ = 1 at N = 100 / 250 / 500 / 1,000: Fornell–Larcker 64.6 / 59.5 / 53.9 / 42.1% (either construct), cross-loadings 0%, HTMT inference 98.2 / 99.4 / 99.8 / 100%',
    });
    const fail = (run: typeof unequal, key: string, n: number) =>
      run.row(PLS, `validity:${key}`, n).rejection!;
    near(
      'unequal: Fornell–Larcker, N = 100 (64.6% either construct)',
      fail(unequal, 'fl:A', 100),
      0.5,
      0.08,
    );
    near(
      'unequal: Fornell–Larcker, N = 1,000 (42.1% either construct)',
      fail(unequal, 'fl:A', 1000),
      0.32,
      0.08,
    );
    near(
      'unequal: HTMT inference, N = 100 (98.2%)',
      fail(unequal, 'htmtci:A:B', 100),
      0.982,
      0.015,
    );
    expect(fail(unequal, 'htmtci:A:B', 1000)).toBeGreaterThan(0.99);
    expect(fail(unequal, 'xl:A', 250)).toBe(0);
    // population HTMT without tau-equivalence: (mean λ)² / mean λiλj = .49 / .4767
    near(
      'unequal: HTMT',
      unequal.row(PLS, 'validity:htmt:A:B', 1000).mean,
      0.49 / ((0.35 + 0.45 + 0.63) / 3),
      0.01,
    );

    const close = await mcCardRun('henseler2015-close', true);
    against({
      ...HENSELER_2015,
      label:
        'Henseler, Ringle & Sarstedt (2015), Figure 5, loadings .7 read at φ = .9: Fornell–Larcker and cross-loadings never flag, HTMT.85 flags most samples, HTMT.90 about half, HTMT inference fewer as N grows',
    });
    near('close: HTMT', close.row(PLS, 'validity:htmt:A:B', 1000).mean, 0.9, 0.01);
    for (const n of [100, 1000]) {
      near(`close: HTMT.90 at N = ${n}, about half`, fail(close, 'htmt90:A:B', n), 0.5, 0.06);
      expect(fail(close, 'fl:A', n)).toBe(0);
    }
    expect(fail(close, 'htmt:A:B', 1000)).toBeGreaterThan(0.95);
    expect(fail(close, 'htmtci:A:B', 100)).toBeGreaterThan(0.4);
    expect(fail(close, 'htmtci:A:B', 1000)).toBeLessThan(0.02);
  },
  3_600_000,
);

const RONKKO_CHO = { level: 'published' as const, url: 'https://doi.org/10.1177/1094428120968614' };

slowIt(
  "ronkko-cho cards: the factor correlation's interval and χ²(1) keep their level at φ = 1; HTMT is biased by unequal loadings (Tables 6, 8, 9)",
  async () => {
    const ML = 'CB-ML';
    const NS = [50, 100, 250, 1000];
    const one = await mcCardRun('ronkko-cho-one', true);
    against({
      ...RONKKO_CHO,
      label:
        'Rönkkö & Cho (2022), Table 8, loadings .8, φ = 1 at N = 50 / 100 / 250 / 1,000: CI_CFA(1) .992 / .990 / .983 / .983, χ²(1) .967 / .973 / .974 / .979, AVE/SV_CFA 1.000',
    });
    const fail = (run: typeof one, key: string, n: number) =>
      run.row(ML, `validity:${key}`, n).rejection!;
    for (const n of NS) {
      near(`φ = 1: CI_CFA(1) at N = ${n}`, fail(one, 'cicfa:F1:F2', n), 0.98, 0.025);
      near(`φ = 1: χ²(1) at N = ${n}`, fail(one, 'chi1:F1:F2', n), 0.95, 0.04);
      expect(fail(one, 'fl:F1', n)).toBe(1);
      near(`φ = 1: correlation at N = ${n}`, one.row(ML, 'cov:F1:F2', n).mean, 1, 0.01);
    }

    const nine = await mcCardRun('ronkko-cho-nine', true);
    against({
      ...RONKKO_CHO,
      label:
        'Rönkkö & Cho (2022), Tables 8 and 9, φ = .9 at N = 50 / 100 / 250 / 1,000: CI_CFA(1) .293 / .106 / .005 / .000 and χ²(1) .199 / .081 / .004 / .000 (averaged over 3, 6 and 9 items), CI_CFA(.90) .982 / .987 / .985 / .980, AVE/SV_CFA .968 / .993 / 1.000 / 1.000',
    });
    const ci1 = NS.map((n) => fail(nine, 'cicfa:F1:F2', n));
    for (let k = 1; k < NS.length; k++)
      expect(ci1[k], 'CI_CFA(1): fewer flags as N grows').toBeLessThan(ci1[k - 1]);
    expect(ci1[2]).toBeLessThan(0.03);
    expect(ci1[3]).toBe(0);
    expect(fail(nine, 'chi1:F1:F2', 250)).toBeLessThan(0.03);
    for (const n of NS) {
      near(`φ = .9: CI_CFA(.90) at N = ${n}`, fail(nine, 'cicfa90:F1:F2', n), 0.983, 0.02);
      near(`φ = .9: HTMT (.90) at N = ${n}`, fail(nine, 'htmt90:F1:F2', n), 0.53, 0.06);
    }
    near('φ = .9: AVE/SV_CFA at N = 100', fail(nine, 'fl:F1', 100), 0.97, 0.03);

    const unequal = await mcCardRun('ronkko-cho-unequal', true);
    against({
      ...RONKKO_CHO,
      label:
        'Rönkkö & Cho (2022), Tables 6 and 8, loadings .9 / .6 / .3, φ = .9: r_DPR (HTMT) .989 and r_CFA .901 at N = 250; CI_CFA(1) .388 / .241 / .124 / .001 at N = 50 / 100 / 250 / 1,000',
    });
    near(
      'unequal: HTMT at N = 250 (.989)',
      unequal.row(ML, 'validity:htmt:F1:F2', 250).mean,
      0.989,
      0.015,
    );
    near(
      'unequal: CFA correlation at N = 250 (.901)',
      unequal.row(ML, 'cov:F1:F2', 250).mean,
      0.901,
      0.01,
    );
    expect(fail(unequal, 'htmt90:F1:F2', 1000)).toBeGreaterThan(0.95);
    expect(fail(unequal, 'cicfa:F1:F2', 1000)).toBeLessThan(0.02);
  },
  3_600_000,
);

const FRANKE_SARSTEDT = {
  level: 'published' as const,
  url: 'https://doi.org/10.1108/IntR-12-2017-0515',
};

slowIt(
  'franke-sarstedt cards: PHI tests at the cutoffs and the heuristics against Tables I and II',
  async () => {
    const ML = 'CB-ML';
    // (the paper's share indicating discriminant validity is 1 − the card's failing share)
    const dv = (run: Awaited<ReturnType<typeof mcCardRun>>, key: string, n: number) =>
      1 - run.row(ML, `validity:${key}`, n).rejection!;
    const cutoff = await mcCardRun('franke-sarstedt-cutoff', true);
    against({
      ...FRANKE_SARSTEDT,
      label:
        'Franke & Sarstedt (2019), Tables I and II, loadings .71, φ = .85, three items, N = 100 / 500: PHI.85 .04 / .04, PHI.90 .13 / .45, PHI1 .73 / 1; HTMT.85 (heuristic) .46 / .47, HTMT.90 .74 / .94; FL1 .06 / 0',
    });
    for (const n of [100, 500])
      near(`PHI.85 at N = ${n} (.04)`, dv(cutoff, 'cicfa85:X:Y', n), 0.04, 0.025);
    near('PHI.90 at N = 100 (.13)', dv(cutoff, 'cicfa90:X:Y', 100), 0.13, 0.05);
    near('PHI.90 at N = 500 (.45)', dv(cutoff, 'cicfa90:X:Y', 500), 0.45, 0.06);
    near('PHI1 at N = 100 (.73)', dv(cutoff, 'cicfa:X:Y', 100), 0.73, 0.05);
    near('HTMT.85 heuristic at N = 100 (.46)', dv(cutoff, 'htmt:X:Y', 100), 0.46, 0.05);
    near('HTMT.90 heuristic at N = 500 (.94)', dv(cutoff, 'htmt90:X:Y', 500), 0.94, 0.03);
    expect(dv(cutoff, 'fl:X', 500)).toBe(0);

    const unequal = await mcCardRun('franke-sarstedt-unequal', true);
    against({
      ...FRANKE_SARSTEDT,
      label:
        'Franke & Sarstedt (2019), Tables I and II, loadings .85 / .71, φ = .9, three items, N = 100 / 500: PHI1 .67 / 1, PHI.90 .03 / .05; FL1 (heuristic) .17 / .03, FL2 0 / 0; HTMT.90 .48 / .49',
    });
    near('PHI1 at N = 100 (.67)', dv(unequal, 'cicfa:X:Y', 100), 0.67, 0.05);
    for (const n of [100, 500])
      near(`PHI.90 at N = ${n}`, dv(unequal, 'cicfa90:X:Y', n), 0.04, 0.025);
    near('FL for X at N = 100 (.17)', dv(unequal, 'fl:X', 100), 0.17, 0.05);
    expect(dv(unequal, 'fl:Y', 500)).toBe(0);
    near('HTMT.90 heuristic at N = 500 (.49)', dv(unequal, 'htmt90:X:Y', 500), 0.49, 0.05);
  },
  3_600_000,
);

slowIt(
  'ronkko-cho-nine-items: nine items per factor make the tests against 1 precise; Fornell–Larcker still flags',
  async () => {
    const run = await mcCardRun('ronkko-cho-nine-items', true);
    against({
      ...RONKKO_CHO,
      label:
        'Rönkkö & Cho (2022), Table 8, φ = .9, loadings .8: CI_CFA(1) .293 / .106 and χ²(1) .199 / .081 at N = 50 / 100, averaged over 3, 6 and 9 items (nine items: the most precise); AVE/SV_CFA .968 / .993',
    });
    const fail = (key: string, n: number) => run.row('CB-ML', `validity:${key}`, n).rejection!;
    expect(fail('cicfa:F1:F2', 50)).toBeLessThan(0.06);
    expect(fail('chi1:F1:F2', 50)).toBeLessThan(0.03);
    for (const n of [100, 250, 1000]) expect(fail('cicfa:F1:F2', n)).toBe(0);
    for (const n of [50, 1000]) {
      near(`CI_CFA(.90) at N = ${n}`, fail('cicfa90:F1:F2', n), 0.985, 0.02);
      expect(fail('fl:F1', n), `Fornell–Larcker at N = ${n}`).toBeGreaterThan(0.98);
    }
    near('correlation at N = 50', run.row('CB-ML', 'cov:F1:F2', 50).mean, 0.9, 0.01);
  },
  3_600_000,
);
