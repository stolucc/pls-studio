// The examples of cards/items.ts, each run through its card (the card's own run(), so through the same rengine call
// the app makes) on the example's data, and compared with its help page's model fitted directly by the package in
// the same R (mirt, glca, lme4). Run with WEBR_TESTS=1.

import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Dataset } from '../../engine/types';
import { categoriesOf } from '../../io';
import { DEFAULT_SETTINGS } from '../../model/project';
import { analysisType } from '../../analyses/registry';
import type { AnalysisCtx } from '../../analyses/types';
import type { GlmmResult } from '../../rengine/glmm';
import type { IrtResult, LcaResult } from '../../rengine/items';
import { rCall, type RPackage } from '../../rengine/bridge';
import { callJson, withR } from '../../rengine/runtime';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import commonR from '../../rengine/R/common.R?raw';
import { exampleSettings, PACKAGE_EXAMPLES, panelPreset } from '../packages';
import { against, example as exampleCheck, near, same } from '../../validation/record';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

async function open(id: string, method: string, packages: string[]) {
  const ex = PACKAGE_EXAMPLES.find((e) => e.id === id)!;
  exampleCheck(id, { title: ex.title, method, packages, definition: ex });
  const raw = await rCall<{
    names: string[];
    cols: (number | null)[][];
    levels?: Record<string, string[]>;
  }>(
    'ps_dataset',
    { package: ex.data.package, name: ex.data.name, na: [] },
    ex.data.package as RPackage,
  );
  const data: Dataset = {
    names: raw.names,
    cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))),
    ...categoriesOf(raw.levels),
  };
  const ctx: AnalysisCtx = {
    data,
    info: null,
    settings: exampleSettings(DEFAULT_SETTINGS, ex.settings),
    pls: null,
    projectName: ex.title,
  };
  const t = analysisType(ex.panel!.kind)!;
  const options = t.parseOptions({ ...t.defaults(ctx), ...panelPreset(ex.panel!) })!;
  expect(t.blocked(options as never, ctx), `${id}: the card is ready to run`).toBeNull();
  return { ctx, options, run: <R>() => t.run(options as never, ctx, () => {}) as Promise<R> };
}
const sameR = <T>(packages: string[], code: string) =>
  withR(['jsonlite', ...packages], { common: commonR }, (webR) =>
    callJson(webR, code, null),
  ) as Promise<T>;

it('mirt-lsat7-3pl: the 3PL card with a prior on item 5 reproduces ?mirt’s mod1.3PL.norm', async () => {
  const { run } = await open('mirt-lsat7-3pl', 'Item response theory', ['mirt']);
  const r = await run<IrtResult>();
  const ref = await sameR<{ ll: number; lp: number; cf: number[][] }>(
    ['mirt'],
    `local({ suppressPackageStartupMessages(library(mirt))
    data <- expand.table(LSAT7)
    model <- 'F = 1-5
             PRIOR = (5, g, norm, -1.5, 3)'
    m <- mirt(data, model, itemtype = c('2PL', '2PL', '2PL', '2PL', '3PL'), verbose = FALSE, TOL = 1e-6, technical = list(NCYCLES = 5000))
    cf <- coef(m, IRTpars = FALSE, simplify = TRUE)$items
    ps_json(list(ll = as.numeric(logLik(m)), lp = extract.mirt(m, "logPrior"), cf = unname(lapply(seq_len(nrow(cf)), function(i) unname(cf[i, 1:3])))))
  })`,
  );
  // (with the card's convergence criterion, TOL = 1e-6 within 5000 cycles: at mirt's default 1e-4 the flat likelihood stops item 5's threshold 0.008 away)
  against({
    label: 'mirt’s ?mirt example (mod1.3PL.norm, TOL = 1e-6), run in the same R',
    level: 'native',
  });
  same('respondents', r.n, 1000);
  near('log-likelihood', r.logLik, ref.ll, 0.01);
  near('log prior', r.logPrior!, ref.lp, 0.01);
  ref.cf.forEach(([a, d], i) => {
    const it = `Item.${i + 1}`,
      k = r.coefficients!.filter((x) => x.item === it);
    near(`${it} loading`, k.find((x) => x.parameter === 'loading')!.est, a, 0.005);
    near(`${it} threshold`, k.find((x) => x.parameter === 'threshold 1')!.est, -d, 0.005);
  });
  near(
    'Item.5 guessing',
    r.params.find((p) => p.item === 'Item.5')!.values.Gussng,
    ref.cf[4][2],
    0.005,
  );
  expect(r.params.find((p) => p.item === 'Item.1')!.values.Gussng).toBeUndefined();
}, 900_000);

it('glca-nyts18-mlca: the multilevel LCA card reproduces glca’s help-page model', async () => {
  const { run } = await open('glca-nyts18-mlca', 'Items', ['glca']);
  const r = await run<LcaResult>();
  const ref = await sameR<{ ll: number; npar: number; delta: number[] }>(
    ['glca'],
    `local({ suppressPackageStartupMessages(library(glca))
    d <- nyts18; for (v in names(d)) d[[v]] <- as.integer(d[[v]])
    f <- glca(item(ECIGT, ECIGAR, ESLT, EELCIGT, EHOOKAH) ~ 1, group = SCH_ID, data = d, nclass = 3, ncluster = 2, n.init = 10, seed = ${DEFAULT_SETTINGS.seed}, verbose = FALSE)
    ps_json(list(ll = f$gof$loglik, npar = f$model$npar, delta = sort(as.numeric(f$param$delta), decreasing = TRUE)))
  })`,
  );
  against({
    label: 'glca’s ?glca example 2 (Model 4 of ?nyts18), run in the same R',
    level: 'native',
  });
  const m = r.models[0];
  same('students', r.n, 1734);
  same('schools', r.clusters!, 45);
  same('free parameters', m.npar, ref.npar);
  near('log-likelihood', m.llik, ref.ll, 1e-6);
  ref.delta.forEach((v, i) =>
    near(`share of school class ${i + 1}`, m.clusters!.shares[i], v, 1e-6),
  );
}, 900_000);

it('glmmadaptive-cbpp: the GLMM card (25 points) reproduces glmer(..., nAGQ = 25) of ?glmer', async () => {
  const { run } = await open('glmmadaptive-cbpp', 'Generalized linear mixed model', [
    'GLMMadaptive',
  ]);
  const r = await run<GlmmResult>();
  const ref = await sameR<{ ll: number; b: number[]; v: number }>(
    ['lme4'],
    `local({ suppressPackageStartupMessages(library(lme4))
    g <- glmer(cbind(incidence, size - incidence) ~ period + (1 | herd), cbpp, binomial, nAGQ = 25)
    ps_json(list(ll = as.numeric(logLik(g)), b = unname(fixef(g)), v = unname(VarCorr(g)$herd[1])))
  })`,
  );
  against({
    label: 'lme4’s ?glmer example (gm1 with nAGQ = 25), run in the same R',
    level: 'native',
  });
  same('herds', r.clusters, 15);
  // (lme4 2.0-6, webR's build, reports −50.005 for this fit with nAGQ > 1; desktop lme4 2.1.0 reports −91.98337,
  //  GLMMadaptive's value, next to the Laplace fit's −92.026 in both versions)
  against({
    label: 'lme4 2.1.0 in desktop R 4.6: logLik(glmer(…, nAGQ = 25)) = −91.98337',
    level: 'native',
  });
  near('log-likelihood', r.logLik, -91.98337, 1e-4);
  r.fixed.forEach((f, i) => near(f.term, f.est, ref.b[i], 0.001));
  near('herd variance', r.random[0].est, ref.v, 0.001);
}, 900_000);
