// The lalonde examples against their vignettes: MatchIt's "Getting started"
// (full matching on a probit score, the outcome model with the covariates by
// g-computation, cluster-robust SEs), its code run verbatim in the same R (the
// text's $2114, SE 646, was written for earlier package versions; the code
// gives $1977, SE 704); WeightIt's introduction (entropy balancing,
// lm_weightit with the covariates, g-computation), whose printed output is
// 1273 (SE 770). Run with npm run test:webr.

import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Dataset } from '../engine/types';
import { categoriesOf } from '../io';
import { matchAnalysis, toInput, type MatchOptions } from '../analyses/match';
import { DEFAULT_SETTINGS } from '../model/project';
import { rCall } from '../rengine/bridge';
import { matchR, matchScriptR } from '../rengine/match';
import { startTestRuntime, stopTestRuntime } from '../rengine/webrTestRuntime';
import { PACKAGE_EXAMPLES } from './packages';
import commonR from '../rengine/R/common.R?raw';
import { callJson, withR } from '../rengine/runtime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

async function run(id: string) {
  const ex = PACKAGE_EXAMPLES.find((e) => e.id === id)!;
  const raw = await rCall<{ names: string[]; cols: (number | null)[][]; levels?: Record<string, string[]> }>('ps_dataset', { package: 'MatchIt', name: 'lalonde', na: [] }, 'MatchIt');
  const data: Dataset = { names: raw.names, cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))), ...categoriesOf(raw.levels) };
  const { kind: _k, ...preset } = ex.panel as Record<string, unknown>;
  const o = matchAnalysis.parseOptions({ ...matchAnalysis.defaults({} as never), ...preset }) as MatchOptions;
  const input = toInput(o, DEFAULT_SETTINGS.seed, 0.95);
  return { data, input, r: await matchR(data, input) };
}

it('matchit-lalonde equals the vignette’s code run verbatim: full matching on a probit score, g-computation', async () => {
  const { data, input, r } = await run('matchit-lalonde');
  expect(input).toMatchObject({ method: 'full', link: 'probit', matchEffect: 'dr', estimand: 'ATT' });
  const vig = await withR(['jsonlite', 'MatchIt', 'optmatch', 'marginaleffects', 'sandwich'], { common: commonR }, (webR) => callJson(webR, `suppressPackageStartupMessages({ library(MatchIt); library(marginaleffects) })
    data("lalonde", package = "MatchIt")
    m.out2 <- matchit(treat ~ age + educ + race + married + nodegree + re74 + re75, data = lalonde, method = "full", distance = "glm", link = "probit")
    m.data <- match_data(m.out2)
    fit <- lm(re78 ~ treat * (age + educ + race + married + nodegree + re74 + re75), data = m.data, weights = weights)
    a <- avg_comparisons(fit, variables = "treat", vcov = ~subclass, newdata = subset(treat == 1))
    ps_json(list(est = a$estimate, se = a$std.error))`, null)) as { est: number; se: number };
  expect(r.effect!.est).toBeCloseTo(vig.est, 8);
  expect(r.effect!.se).toBeCloseTo(vig.se, 8);
  expect(Math.abs(r.effect!.est - 1977)).toBeLessThan(0.5);  // (the value stated on the card)
  expect(r.counts.find((x) => x.row === 'Matched (ESS)')!.control).toBeCloseTo(50.76, 2);  // as the vignette prints
  const s = await matchScriptR(data, input);
  expect(s).toContain('method = "full", distance = "glm", link = "probit", estimand = "ATT"');
  expect(s).toContain('fit <- lm(re78 ~ treat * (age + educ + race + married + nodegree + re74 + re75), data = md, weights = weights)');
}, 900_000);

it('weightit-lalonde reproduces the vignette: 1273 (SE 770) with entropy balancing', async () => {
  const { data, input, r } = await run('weightit-lalonde');
  expect(input).toMatchObject({ method: 'weighting', weightMethod: 'ebal', effectModel: 'dr' });
  expect(Math.abs(r.effect!.est - 1273)).toBeLessThan(0.5);
  expect(Math.abs(r.effect!.se - 770)).toBeLessThan(0.5);
  expect(await matchScriptR(data, input)).toContain('method = "ebal", estimand = "ATT"');
}, 900_000);
