// The Bayesian card examples (cards/bayes.ts) in webR, each through its card (the card's options, defaults and
// run(), i.e. its rengine R call), against the Bayes factors their source prints: the BayesFactor help pages and
// manual, and for the binomial test the closed form. Every value is also compared with the same call run natively
// (BayesFactor 0.9.12-4.8, scripts/validation/bayes_cards.R; values copied below).
//
// Tolerances (on the ratio to the reference): quadrature and closed-form Bayes factors (t-tests, regression,
// contingency table, binomial, one-effect ANOVA models) agree with the native values to 1e-6 (1e-4 where BayesFactor's
// own quadrature error is 1e-4), and with the printed ones to half a unit of the last printed digit. Monte Carlo ones
// (ANOVA models with two or more effects, repeated measures) differ from the printed ones by sampling: within four
// combined standard errors as BayesFactor reports them (its ±error is the estimate's proportional standard error) plus
// the printed rounding; with the native run under the same seed they agree to 1e-6 (SAME_DRAWS).

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analysisType } from '../../analyses/registry';
import type { AnalysisCtx } from '../../analyses/types';
import type { Dataset } from '../../engine/types';
import { categoriesOf } from '../../io';
import { type DataInfo, DEFAULT_SETTINGS } from '../../model/project';
import { rCall, type RPackage } from '../../rengine/bridge';
import { setWarningSink } from '../../rengine/notices';
import type { BAnovaResult, BayesModel, BBinomialResult, BContingencyResult, BRegressionResult, BRmAnovaResult, BTTestResult } from '../../rengine/tests';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { against, cleanRun, example, near, same } from '../../validation/record';
import { PACKAGE_EXAMPLES, panelPreset, type PackageExample } from '../packages';
import { CARD_BAYES } from './bayes';
import { exampleTestData } from '../testData';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);
let raised: string[] = [];
beforeAll(() => setWarningSink((lines) => { raised.push(...lines); }));
afterAll(() => setWarningSink(null));

const MANUAL = 'https://cran.r-project.org/web/packages/BayesFactor/vignettes/manual.html';
const NATIVE = { label: 'BayesFactor 0.9.12-4.8 run natively, scripts/validation/bayes_cards.R', script: 'scripts/validation/bayes_cards.R', level: 'native' as const };

async function load(ex: PackageExample): Promise<Dataset> {
  let data: Dataset;
  const fromFile = exampleTestData(ex);
  if (fromFile) data = fromFile;
  else {
    const raw = await rCall<{ names: string[]; cols: (number | null)[][]; levels?: Record<string, string[]> }>('ps_dataset', { package: ex.data.package, name: ex.data.name, na: [] }, ex.data.package as RPackage);
    data = { names: raw.names, cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))), ...categoriesOf(raw.levels) };
  }
  // (the example loader's recodes: computed columns, then category labels)
  if (ex.computed?.length) {
    const { computeColumn } = await import('../../data/compute');
    let info: DataInfo = { fileName: 'x', rows: data.cols[0].length, missingCells: 0, excluded: [] };
    for (const k of ex.computed) ({ data, info } = computeColumn(data, info, k.name, k.expr));
  }
  return ex.labels ? { ...data, categories: { ...(data.categories ?? {}), ...ex.labels } } : data;
}

/** Open the example as the app does: its card with the example's options over the card's defaults, then run it. */
async function run<R>(id: string, packages: string[]): Promise<R> {
  const ex = CARD_BAYES.find((e) => e.id === id)!;
  expect(PACKAGE_EXAMPLES).toContain(ex);
  example(ex.id, { title: ex.title, method: 'Bayesian', packages, definition: ex });
  const data = await load(ex);
  const ctx: AnalysisCtx = { data, info: null, settings: { ...DEFAULT_SETTINGS, ...ex.settings }, pls: null, projectName: 'p' };
  const kind = ex.panel!.kind, preset = panelPreset(ex.panel!);
  const t = analysisType(kind)!;
  const o = t.parseOptions({ ...t.defaults(ctx), ...preset })!;
  expect(t.blocked(o, ctx), id).toBeNull();
  raised = [];
  const r = await t.run(o, ctx, () => {}) as R & { warnings?: string[] };
  const warned = [...raised, ...(r.warnings ?? [])];
  cleanRun(warned.length);
  expect(warned, `${id} warned`).toEqual([]);
  return r;
}

/** The model whose terms are exactly these (in any order). */
const model = (models: BayesModel[], terms: string[]) => {
  const m = models.find((x) => x.terms.length === terms.length && terms.every((t) => x.terms.includes(t)));
  expect(m, terms.join(' + ')).toBeTruthy();
  return m!;
};
/** A Bayes factor printed to `digits` significant digits: the ratio to it within half a unit of the last digit (relative) plus `extra`. */
const printed = (what: string, got: number, shown: number, digits: number, extra = 0) => {
  const half = 0.5 * 10 ** (Math.floor(Math.log10(Math.abs(shown))) - digits + 1) / Math.abs(shown);
  near(`${what} / printed`, got / shown, 1, half + extra);
};
/** Four combined proportional standard errors (BayesFactor's ±error) of two Monte Carlo estimates. */
const mc = (...errors: number[]) => 4 * Math.sqrt(errors.reduce((s, e) => s + e * e, 0));
const TIGHT = 1e-6;
/**
 * Monte Carlo Bayes factors against the native run with the same seed: webR draws the same random numbers as desktop R
 * and the card's generalTestBF samples as anovaBF / lmBF do, so the estimates agree beyond the Monte Carlo error.
 */
const SAME_DRAWS = 1e-6;

describe('Bayesian t-tests', () => {
  it('paired: ?ttestBF on the sleep data', async () => {
    const r = await run<BTTestResult>('bayesfactor-sleep-paired', ['BayesFactor']);
    against({ label: '?ttestBF, the paired test (printed in the BayesFactor manual: 17.3 ±0%)', url: `${MANUAL}#onesample`, level: 'native' });
    printed('BF₁₀', r.rows[0].bf10, 17.3, 3);
    against(NATIVE);
    near('BF₁₀ / native', r.rows[0].bf10 / 17.2588802678, 1, TIGHT);
  }, 600_000);

  it('one sample, one-sided: the manual’s difference scores', async () => {
    const r = await run<BTTestResult>('bayesfactor-sleep-onesided', ['BayesFactor']);
    same('alternative', r.alternative, 'less');
    against({ label: 'BayesFactor manual, one-sample tests: ttestBF(x = diffScores, nullInterval = c(-Inf, 0)) (printed: 34.4 ±0%)', url: `${MANUAL}#onesample`, level: 'native' });
    printed('BF₋₀', r.rows[0].bf10, 34.4, 3);
    against(NATIVE);
    near('BF₋₀ / native', r.rows[0].bf10 / 34.4169360047, 1, TIGHT);
  }, 600_000);

  it('independent samples: the manual’s chickwts, horsebean against linseed', async () => {
    const r = await run<BTTestResult>('bayesfactor-chickwts', ['BayesFactor']);
    expect(r.groups).toEqual(['horsebean', 'linseed']);
    against({ label: 'BayesFactor manual, two-sample test: ttestBF(formula = weight ~ feed, data = chickwts) (printed: 5.98 ±0%)', url: `${MANUAL}#twosample`, level: 'native' });
    printed('BF₁₀', r.rows[0].bf10, 5.98, 3);
    against(NATIVE);
    near('BF₁₀ / native', r.rows[0].bf10 / 5.97574134853, 1, TIGHT);
  }, 600_000);
});

describe('Bayesian ANOVA and ANCOVA', () => {
  it('two-way ANOVA: the manual’s ToothGrowth, anovaBF(len ~ supp*dose)', async () => {
    const r = await run<BAnovaResult>('bayesfactor-toothgrowth', ['BayesFactor']);
    same('n', r.n, 60);
    against({ label: 'BayesFactor manual, fixed-effects ANOVA (printed: supp 1.2 ±0.01%, dose 4.98e+12 ±0%, supp + dose 2.92e+14 ±1.58%, full 7.44e+14 ±1.01%)', url: `${MANUAL}#fixed`, level: 'native' });
    const supp = model(r.models, ['supp']), dose = model(r.models, ['dose']), both = model(r.models, ['supp', 'dose']), full = model(r.models, ['supp', 'dose', 'supp × dose']);
    printed('BF₁₀ supp', supp.bf10, 1.2, 3, mc(supp.error, 1e-4));  // (R prints 1.20 as 1.2)
    printed('BF₁₀ dose', dose.bf10, 4.98e12, 3, mc(dose.error, 1e-4));
    printed('BF₁₀ supp + dose', both.bf10, 2.92e14, 3, mc(both.error, 0.0158));
    printed('BF₁₀ supp + dose + supp × dose', full.bf10, 7.44e14, 3, mc(full.error, 0.0101));
    against(NATIVE);
    // (single-effect models are one-dimensional integrals: exact to BayesFactor's quadrature)
    near('BF₁₀ supp / native', supp.bf10 / 1.19875678224, 1, 1e-4);
    near('BF₁₀ dose / native', dose.bf10 / 4983636409073, 1, 1e-4);
    near('BF₁₀ supp + dose / native', both.bf10 / 278406608470316, 1, SAME_DRAWS);
    near('BF₁₀ supp + dose + supp × dose / native', full.bf10 / 775160413903126, 1, SAME_DRAWS);
  }, 600_000);

  it('ANCOVA: the manual’s ToothGrowth with log2(dose)', async () => {
    const r = await run<BAnovaResult>('bayesfactor-toothgrowth-ancova', ['BayesFactor']);
    against({ label: 'BayesFactor manual, regression and ANOVA: lmBF with log2(dose) (printed: supp + dose + supp:dose 1.58e+15 ±1.08%, supp + dose 1.49e+15 ±1.33%, dose 2.77e+13 ±0.01%, supp 1.2 ±0.01%)', url: `${MANUAL}#fixed`, level: 'native' });
    same('covariate interactions', String(r.covariateInteractions), 'true');
    const supp = model(r.models, ['supp']), dose = model(r.models, ['log2dose']), both = model(r.models, ['supp', 'log2dose']), full = model(r.models, ['supp', 'log2dose', 'supp × log2dose']);
    printed('BF₁₀ supp + log2 dose + supp × log2 dose', full.bf10, 1.58e15, 3, mc(full.error, 0.0108));
    printed('BF₁₀ supp', supp.bf10, 1.2, 3, mc(supp.error, 1e-4));  // (R prints 1.20 as 1.2)
    printed('BF₁₀ log2 dose', dose.bf10, 2.77e13, 3, mc(dose.error, 1e-4));
    printed('BF₁₀ supp + log2 dose', both.bf10, 1.49e15, 3, mc(both.error, 0.0133));
    against(NATIVE);
    near('BF₁₀ supp / native', supp.bf10 / 1.19875678224, 1, 1e-4);
    near('BF₁₀ log2 dose / native', dose.bf10 / 27695932403874, 1, 1e-4);
    near('BF₁₀ supp + log2 dose / native', both.bf10 / 1476106405934313, 1, SAME_DRAWS);
    // (the interaction model: the card's generalTestBF(len ~ supp * dose, whichModels = "withmain") natively, seed 1234)
    near('BF₁₀ supp + log2 dose + supp × log2 dose / native', full.bf10 / 1582743384935332, 1, SAME_DRAWS);
  }, 600_000);
});

describe('Bayesian repeated-measures ANOVA', () => {
  it('?anovaBF: the sleep data, the drug within patients', async () => {
    const r = await run<BRmAnovaResult>('bayesfactor-sleep-rm', ['BayesFactor']);
    same('subjects', r.n, 10);
    const drug = model(r.models, ['drug']);
    against({ label: '?anovaBF: anovaBF(extra ~ group + ID, data = sleep, whichRandom = "ID") “gives a Bayes factor of about 11.6”', url: 'https://rdrr.io/cran/BayesFactor/man/anovaBF.html', level: 'native' });
    printed('BF₁₀ drug (against the patients-only model)', drug.bf10, 11.6, 3, mc(drug.error, 0.01));
    against(NATIVE);
    near('BF₁₀ drug / native anovaBF', drug.bf10 / 11.5404449506, 1, SAME_DRAWS);
  }, 600_000);

  it('the manual’s puzzles: shape × color within participants, anovaBF(RT ~ shape*color + ID, whichRandom = "ID")', async () => {
    const r = await run<BRmAnovaResult>('bayesfactor-puzzles-rm', ['BayesFactor']);
    same('participants', r.n, 12);
    same('factors', r.factors!.map((f) => f.name).join(' × '), 'shape × color');
    const shape = model(r.models, ['shape']), color = model(r.models, ['color']), both = model(r.models, ['shape', 'color']), full = model(r.models, ['shape', 'color', 'shape × color']);
    against({ label: 'BayesFactor manual, mixed models: anovaBF(RT ~ shape*color + ID, data = puzzles, whichRandom = "ID") (printed: shape 2.81 ±0.91%, color 2.81 ±0.83%, shape + color 11.9 ±3%, full 4.23 ±2.2%)', url: `${MANUAL}#mixed`, level: 'native' });
    printed('BF₁₀ shape', shape.bf10, 2.81, 3, mc(shape.error, 0.0091));
    printed('BF₁₀ color', color.bf10, 2.81, 3, mc(color.error, 0.0083));
    printed('BF₁₀ shape + color', both.bf10, 11.9, 3, mc(both.error, 0.03));
    printed('BF₁₀ shape + color + shape × color', full.bf10, 4.23, 3, mc(full.error, 0.022));
    against(NATIVE);
    const native: [typeof shape, number, string][] = [[shape, 2.81367459053, 'shape'], [color, 2.8437553641, 'color'], [both, 11.5046192046, 'shape + color'], [full, 4.25922853244, 'shape + color + shape × color']];
    for (const [m, v, what] of native) near(`BF₁₀ ${what} / native anovaBF`, m.bf10 / v, 1, SAME_DRAWS);
  }, 600_000);
});

describe('Bayesian linear regression', () => {
  it('?regressionBF: attitude, all 63 models', async () => {
    const r = await run<BRegressionResult>('bayesfactor-attitude', ['BayesFactor']);
    same('models (with the null model)', r.models.length, 64);
    same('best model', r.best, 'complaints');
    // head(regressionBF(rating ~ ., data = attitude)), as the manual prints it, and the full model
    const top: [string[], number, number, number][] = [
      [['complaints'], 417939, 6, 417938.631039], [['complaints', 'learning'], 207272, 6, 207271.902002], [['complaints', 'learning', 'advance'], 88042, 5, 88041.5365043],
      [['complaints', 'raises'], 77499, 5, 77498.9887212], [['complaints', 'privileges'], 75015, 5, 75015.2279115], [['complaints', 'advance'], 72760, 5, 72759.7639808],
    ];
    against({ label: '?regressionBF: head(output) (printed in the BayesFactor manual, linear regression)', url: `${MANUAL}#regression`, level: 'native' });
    for (const [terms, shown, digits] of top) printed(`BF₁₀ ${terms.join(' + ')}`, model(r.models, terms).bf10, shown, digits, 1e-4);
    against(NATIVE);
    for (const [terms, , , native] of top) near(`BF₁₀ ${terms.join(' + ')} / native`, model(r.models, terms).bf10 / native, 1, TIGHT);
    near('BF₁₀ full model / native', model(r.models, ['complaints', 'privileges', 'learning', 'raises', 'critical', 'advance']).bf10 / 2211.91227542, 1, TIGHT);
  }, 600_000);
});

describe('Bayesian contingency table', () => {
  it('?contingencyTableBF: raceDolls, columns fixed', async () => {
    const r = await run<BContingencyResult>('bayesfactor-racedolls', ['BayesFactor']);
    expect(r.counts).toEqual([[50, 48], [21, 41]]);
    expect([r.rowLevels, r.colLevels]).toEqual([['Same-race doll', 'Different-race doll'], ['White child', 'Black child']]);
    against({ label: '?contingencyTableBF (printed in the BayesFactor manual, contingency tables: 1.81 ±0%)', url: `${MANUAL}#ctables`, level: 'native' });
    printed('BF₁₀', r.bf10, 1.81, 3);
    against(NATIVE);
    near('BF₁₀ / native', r.bf10 / 1.81485573815, 1, TIGHT);
  }, 600_000);
});

describe('Bayesian binomial test', () => {
  it('?binom.test’s Conover (1971) counts against 3/4, beta(1, 1) prior', async () => {
    const r = await run<BBinomialResult>('stats-peas-binomial', ['stats']);
    expect(r.levels).toEqual(['giant', 'dwarf']);
    against({ label: '?binom.test: 682 giant and 243 dwarf plants (Conover 1971)', url: 'https://rdrr.io/r/stats/binom.test.html', level: 'native' });
    same('giant', r.counts[0], 682);
    same('dwarf', r.counts[1], 243);
    against({ ...NATIVE, label: 'the beta-binomial Bayes factor by numerical integration in desktop R, scripts/validation/bayes_cards.R' });
    near('BF₁₀ giant / integral', r.rows[0].bf10 / 0.0537313505615, 1, TIGHT);
    near('log10 BF₁₀ dwarf (against 0.75 as well)', Math.log10(r.rows[1].bf10), 208.186458579, 1e-6);
  }, 600_000);

  it('the manual’s peas with proportionBF’s logistic prior: 1 / proportionBF(682, 925, p = 3/4)', async () => {
    const r = await run<BBinomialResult>('bayesfactor-peas-proportion', ['BayesFactor']);
    same('prior', r.prior!, 'logistic');
    against({ label: 'BayesFactor manual, tests of single proportions (printed: Null, p=0.75 : 7.27 ±0.01%)', url: `${MANUAL}#proptest`, level: 'native' });
    printed('BF₀₁ giant', 1 / r.rows[0].bf10, 7.27, 3, 1e-4);
    against(NATIVE);
    near('BF₁₀ giant / native', r.rows[0].bf10 / 0.137508462182, 1, TIGHT);
    // (the posterior median of the proportion, sampled: near the observed 0.737)
    near('posterior median', r.rows[0].median, 682 / 925, 0.005);
  }, 600_000);

  it('?proportionBF: 15 successes in 25 trials against 0.5', async () => {
    const r = await run<BBinomialResult>('bayesfactor-proportion', ['BayesFactor']);
    expect(r.levels).toEqual(['success', 'failure']);
    same('successes', r.counts[0], 15);
    against(NATIVE);
    near('BF₁₀ / native proportionBF(y = 15, N = 25, p = .5)', r.rows[0].bf10 / 0.65987245363, 1, TIGHT);
    // (failures against 0.5 as well: the same Bayes factor by symmetry)
    near('BF₁₀ failures / native', r.rows[1].bf10 / 0.65987245363, 1, TIGHT);
  }, 600_000);
});
