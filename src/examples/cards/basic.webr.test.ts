// The basic-statistics card examples (cards/basic.ts) in webR: each example's data loaded as the app loads it, its card
// set up from the example's options and run as the Run button runs it, and the numbers its source gives compared.
// Reference values (scripts/validation/basic_cards.R): the help pages' examples run in desktop R 4.6.2 (stats), psych 2.6.9 and car 3.1.5, written to the digits
// R prints them (options(digits = 10)), unless a comment says the help page or the publication prints them.
// Run with WEBR_TESTS=1 npx vitest run src/examples/cards/basic.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analysisType } from '../../analyses/registry';
import type { AnalysisCtx } from '../../analyses/types';
import type { Dataset } from '../../engine/types';
import { categoriesOf } from '../../io';
import { DEFAULT_SETTINGS } from '../../model/project';
import { rCall, type RPackage } from '../../rengine/bridge';
import type { AnovaResult, ContingencyResult, CorrelationResult, FreqTestResult, ManovaResult, ReliabilityResult, RmAnovaResult, TTestResult } from '../../rengine/tests';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { against, cleanRun, example, near, same } from '../../validation/record';
import type { EvidenceLevel, EvidenceSource } from '../../validation/types';
import { panelPreset, type PackageExample } from '../packages';
import { CARD_BASIC } from './basic';
import { exampleTestData } from '../testData';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const ex = (id: string) => { const e = CARD_BASIC.find((x) => x.id === id); if (!e) throw new Error(`No example ${id}`); return e; };

/** The example's data as the app opens it: a CSV shipped with the app or the package's dataset, then the category labels. */
async function load(e: PackageExample): Promise<Dataset> {
  let d: Dataset;
  const fromFile = exampleTestData(e);
  if (fromFile) d = fromFile;
  else {
    const raw = await rCall<{ names: string[]; cols: (number | null)[][]; levels?: Record<string, string[]> }>('ps_dataset', { package: e.data.package, name: e.data.name, na: [] }, e.data.package as RPackage);
    d = { names: raw.names, cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))), ...categoriesOf(raw.levels) };
  }
  return e.labels ? { ...d, categories: { ...(d.categories ?? {}), ...e.labels } } : d;
}

/** Warnings an example is expected to raise, and why. */
const EXPECTED_WARNINGS: Record<string, RegExp[]> = {
  // Agresti's job-satisfaction table: expected counts below 5, so chisq.test warns (the help page reads Fisher's test).
  'stats-contingency-job': [/approximation may be incorrect/],
};

/** Start the example's evidence, run its card as the app does (options through parseOptions, blocked() clear), check the run is clean. */
async function runCard<R>(id: string, source: EvidenceSource & { level: EvidenceLevel }): Promise<R> {
  const e = ex(id);
  const kind = e.panel!.kind, preset = panelPreset(e.panel!);
  example(e.id, { title: e.title, method: 'Basic statistics', packages: [e.package === 'psych' ? 'psych' : 'stats'], definition: e });
  const data = await load(e);
  const ctx: AnalysisCtx = { data, info: null, settings: { ...DEFAULT_SETTINGS, ...e.settings }, pls: null, projectName: e.title };
  const t = analysisType(kind)!;
  const options = t.parseOptions({ ...t.defaults(ctx), ...preset })!;
  expect(t.blocked?.(options, ctx) ?? null, `${id}: the card is ready to run`).toBeNull();
  const r = await t.run(options, ctx, () => {}) as R & { warnings: string[] };
  const unexpected = r.warnings.filter((w) => !(EXPECTED_WARNINGS[id] ?? []).some((re) => re.test(w)));
  cleanRun(unexpected.length);
  expect(unexpected, `${id} warned`).toEqual([]);
  against(source);
  return r;
}

const helpRun = (page: string): EvidenceSource & { level: 'native' } => ({ label: `${page}: the help page's example run in desktop R 4.6.2`, level: 'native' });
const helpPrinted = (page: string, url: string): EvidenceSource & { level: 'native' } => ({ label: `${page}: the value the help page prints`, url, level: 'native' });

describe('basic-statistics card examples in webR', () => {
  it('stats-ttest-mtcars: t.test(mpg ~ am, data = mtcars), Welch and Student', async () => {
    const r = await runCard<TTestResult>('stats-ttest-mtcars', helpRun('stats, ?t.test'));
    const row = r.rows[0];
    same('groups', r.groups!.join(', '), '0, 1');
    near('Welch t', row.welch!.stat, -3.7671231, 1e-6); near('Welch df', row.welch!.df as number, 18.332252, 1e-5); near('Welch p', row.welch!.p, 0.001373638, 1e-8);
    near('Welch CI lower', row.welch!.ciLow!, -11.280194355, 1e-6); near('Welch CI upper', row.welch!.ciHigh!, -3.209684187, 1e-6);
    near('Student t', row.student!.stat, -4.106127, 1e-6); same('Student df', row.student!.df as number, 30); near('Student p', row.student!.p, 0.0002850207, 1e-9);
    near('mean, automatic', row.descriptives[0].mean, 17.14736842, 1e-7); near('mean, manual', row.descriptives[1].mean, 24.39230769, 1e-7);
  }, 600_000);

  it('stats-ttest-sleep-paired: t.test(extra.1, extra.2, paired = TRUE) on sleep in wide form', async () => {
    const r = await runCard<TTestResult>('stats-ttest-sleep-paired', helpRun('stats, ?t.test'));
    const s = r.rows[0].student!;
    near('t', s.stat, -4.0621277, 1e-6); same('df', s.df as number, 9); near('p', s.p, 0.00283289, 1e-8);
    near('mean difference', s.estimate!, -1.58, 1e-10); near('CI lower', s.ciLow!, -2.4598857633, 1e-8); near('CI upper', s.ciHigh!, -0.7001142367, 1e-8);
  }, 600_000);

  it('stats-ttest-sleep-one: t.test(extra ~ 1, data = sleep)', async () => {
    const r = await runCard<TTestResult>('stats-ttest-sleep-one', helpRun('stats, ?t.test'));
    const s = r.rows[0].student!;
    near('t', s.stat, 3.412965, 1e-6); same('df', s.df as number, 19); near('p', s.p, 0.00291762, 1e-8);
    near('mean', s.estimate!, 1.54, 1e-10); near('CI lower', s.ciLow!, 0.5955844996, 1e-8); near('CI upper', s.ciHigh!, 2.4844155004, 1e-8);
  }, 600_000);

  it('stats-anova-plantgrowth: anova(lm(weight ~ group, data = PlantGrowth))', async () => {
    const r = await runCard<AnovaResult>('stats-anova-plantgrowth', helpRun('datasets, ?PlantGrowth'));
    const g = r.table.find((x) => x.term === 'group')!;
    near('SS group', g.ss, 3.76634, 1e-5); same('df group', g.df, 2); near('F', g.f, 4.84609, 1e-5); near('p', g.p, 0.01591, 1e-5);
    near('SS residual', r.residual.ss, 10.49209, 1e-5); same('df residual', r.residual.df, 27);
  }, 600_000);

  it('stats-anova-warpbreaks: anova(lm(breaks ~ wool * tension)), sequential sums of squares', async () => {
    const r = await runCard<AnovaResult>('stats-anova-warpbreaks', helpRun('datasets, ?warpbreaks'));
    const row = (t: string) => r.table.find((x) => x.term === t)!;
    near('SS wool', row('wool').ss, 450.6667, 1e-4); near('F wool', row('wool').f, 3.76529, 1e-5); near('p wool', row('wool').p, 0.05821298, 1e-8);
    near('SS tension', row('tension').ss, 2034.2593, 1e-4); near('F tension', row('tension').f, 8.49805, 1e-5); near('p tension', row('tension').p, 0.00069262, 1e-8);
    near('SS wool × tension', row('wool × tension').ss, 1002.7778, 1e-4); near('F wool × tension', row('wool × tension').f, 4.18907, 1e-5); near('p wool × tension', row('wool × tension').p, 0.02104419, 1e-8);
    near('SS residual', r.residual.ss, 5745.1111, 1e-4); same('df residual', r.residual.df, 48);
  }, 600_000);

  it('stats-rmanova-rounding: friedman.test(RoundingTimes) and the repeated-measures ANOVA', async () => {
    const r = await runCard<RmAnovaResult>('stats-rmanova-rounding', helpRun('stats, ?friedman.test'));
    same('players', r.n, 22);
    near('Friedman χ²', r.friedman!.stat, 11.142857, 1e-6); same('Friedman df', r.friedman!.df as number, 2); near('Friedman p', r.friedman!.p, 0.003805041, 1e-9);
    // (aov(y ~ method + Error(subject/method)) on the help page's matrix in long form, desktop R)
    const m = r.within.find((x) => x.term === 'method')!;
    near('SS method', m.ss, 0.09371212, 1e-8); near('F method', m.f!, 6.28831, 1e-5); near('p method', m.p!, 0.0040841, 1e-7);
    near('SS residual (within)', r.within.find((x) => x.term === 'Residuals')!.ss, 0.31295455, 1e-8);
  }, 600_000);

  it('cardata-rmanova-obrienkaiser: two within-subject factors, as car::Anova(idata, idesign = ~ phase * hour)', async () => {
    const r = await runCard<RmAnovaResult>('cardata-rmanova-obrienkaiser', { label: 'car 3.1.5, ?Anova’s OBrienKaiser with treatment as the between factor, type II (scripts/validation/basic_cards.R), desktop R 4.6.2', level: 'native' });
    same('subjects', r.n, 16);
    same('factors', r.factors!.map((f) => `${f.name}: ${f.levels.join(' ')}`).join('; '), 'phase: pretest posttest followup; hour: 1 2 3 4 5');
    // summary(Anova(mod.ok, idata, idesign = ~ phase * hour, type = 2), multivariate = FALSE)$univariate.tests
    const want: [string, number, number, number, number][] = [
      ['phase', 167.5, 2, 23.62567811935, 1.419220297e-06], ['phase × treatment', 77, 4, 5.43037974684, 2.578107893e-03],
      ['hour', 106.291666667, 4, 18.97693087437, 1.128249937e-09], ['hour × treatment', 0.894047619, 8, 0.07981001897, 9.995966171e-01],
      ['phase × hour', 11.083333333, 8, 1.23193273889, 2.879468478e-01], ['phase × hour × treatment', 5.959523810, 16, 0.33120597696, 9.925740614e-01],
    ];
    for (const [term, ss, df, f, p] of want) {
      const x = r.within.find((y) => y.term === term)!;
      near(`SS ${term}`, x.ss, ss, 1e-6); same(`df ${term}`, x.df, df); near(`F ${term}`, x.f!, f, 1e-8); near(`p ${term}`, x.p!, p, 1e-9 * Math.max(1, p * 1e3));
    }
    const res = (stratum: string) => r.within.find((y) => y.term === 'Residuals' && y.stratum === stratum)!.ss;
    near('error SS, phase', res('phase'), 92.16666667, 1e-6); near('error SS, hour', res('hour'), 72.81428571, 1e-6); near('error SS, phase × hour', res('phase × hour'), 116.95714286, 1e-6);
    near('F treatment (between)', r.betweenTable.find((y) => y.term === 'treatment')!.f!, 2.91388277656, 1e-8);
    const sph: [string, number, number, number, number][] = [['phase', 0.851511891409, 0.381192461781, 0.8707099294, 0.9939032162], ['hour', 0.098585103305, 0.001935426095, 0.4886720455, 0.5741267192], ['phase × hour', 0.008373226678, 0.090376141513, 0.5028261605, 0.7562961736]];
    for (const [term, w, p, gg, hf] of sph) {
      const x = r.sphericityTable!.find((y) => y.term === term)!;
      near(`Mauchly W, ${term}`, x.w, w, 1e-9); near(`Mauchly p, ${term}`, x.p, p, 1e-9); near(`GG ε, ${term}`, x.gg, gg, 1e-9); near(`HF ε, ${term}`, x.hf, hf, 1e-9);
    }
    const adj: [string, number, number][] = [['phase', 5.664539999e-06, 1.514766928e-06], ['phase × treatment', 4.301327036e-03, 2.640817026e-03], ['hour', 1.016078446e-05, 2.189836785e-06],
      ['hour × treatment', 9.868346858e-01, 9.927707041e-01], ['phase × hour', 3.086826647e-01, 2.989262420e-01], ['phase × hour × treatment', 9.506765585e-01, 9.816067037e-01]];
    for (const [term, gg, hf] of adj) { const x = r.corrected.find((y) => y.term === term)!; near(`p GG, ${term}`, x.pGG, gg, 1e-9 * Math.max(1, gg * 1e3)); near(`p HF, ${term}`, x.pHF, hf, 1e-9 * Math.max(1, hf * 1e3)); }
  }, 600_000);

  it('stats-manova-plastic: manova(cbind(tear, gloss, opacity) ~ rate * additive)', async () => {
    const r = await runCard<ManovaResult>('stats-manova-plastic', helpRun('stats, ?summary.manova'));
    const test = (name: string) => r.tests.find((t) => t.test === name)!.rows;
    const want: Record<string, number[]> = { Pillai: [0.61814162, 0.47696510, 0.22289424], Wilks: [0.38185838, 0.52303490, 0.77710576], 'Hotelling-Lawley': [1.6187718803, 0.9119183228, 0.2868261364] };
    const terms = ['rate', 'additive', 'rate × additive'];
    for (const [name, values] of Object.entries(want)) terms.forEach((term, i) => near(`${name}, ${term}`, test(name).find((x) => x.term === term)!.value, values[i], 1e-7));
    const F = [7.5542688, 4.2556188, 1.3385220], P = [0.00303404516, 0.02474528100, 0.30178164510];
    terms.forEach((term, i) => { const x = test('Pillai').find((y) => y.term === term)!; near(`approx. F, ${term}`, x.f, F[i], 1e-6); near(`p, ${term}`, x.p, P[i], 1e-9); same(`df, ${term}`, `${x.df1}, ${x.df2}`, '3, 14'); });
  }, 600_000);

  it('stats-correlation-judges: cor.test(~ CONT + INTG, data = USJudgeRatings)', async () => {
    const r = await runCard<CorrelationResult>('stats-correlation-judges', helpRun('stats, ?cor.test'));
    const p = r.pairs[0];
    near('r', p.r, -0.1331908905, 1e-9); near('t', p.stat, -0.86050457, 1e-7); near('p', p.p, 0.3945152, 1e-7); same('n', p.n, 43);
    near('CI lower', p.ciLow!, -0.4168591088, 1e-9); near('CI upper', p.ciHigh!, 0.1741182336, 1e-9);
  }, 600_000);

  it('stats-correlation-tuna: cor.test(x, y, method = "kendall", alternative = "greater"), exact', async () => {
    const r = await runCard<CorrelationResult>('stats-correlation-tuna', helpPrinted('stats, ?cor.test (Hollander & Wolfe)', 'https://rdrr.io/r/stats/cor.test.html'));
    const p = r.pairs[0];
    // (the help page's comments: p = 0.05972 exact, 0.04765 by the large-sample approximation; R prints T = 26, tau = 0.4444444)
    same('exact p-value', String(p.exact), 'true'); same('T', p.stat, 26); near('τ', p.r, 0.4444444, 5e-8); near('p (printed: 0.05972)', p.p, 0.05972, 5e-6);
    against(helpRun('stats, ?cor.test'));
    near('p', p.p, 0.05971946649, 1e-10); same('n', p.n, 9);
  }, 600_000);

  it('stats-contingency-party: chisq.test on Agresti’s gender × party table', async () => {
    const r = await runCard<ContingencyResult>('stats-contingency-party', helpRun('stats, ?chisq.test'));
    same('n', r.n, 2757);
    same('table', JSON.stringify(r.counts), JSON.stringify([[762, 327, 468], [484, 239, 477]]));
    near('X²', r.chisq.stat, 30.070149, 1e-6); same('df', r.chisq.df as number, 2); near('p', r.chisq.p, 2.953589e-07, 1e-12);
  }, 600_000);

  it('stats-contingency-job: fisher.test(Job)', async () => {
    const r = await runCard<ContingencyResult>('stats-contingency-job', helpPrinted('stats, ?fisher.test', 'https://rdrr.io/r/stats/fisher.test.html'));
    same('n', r.n, 96);
    near('Fisher p (the help page: 0.7827)', r.fisher!.p, 0.7827, 5e-5);
    against(helpRun('stats, ?fisher.test'));
    near('Fisher p', r.fisher!.p, 0.7826849, 1e-7);
  }, 600_000);

  it('stats-binomial-mendel: binom.test(c(682, 243), p = 3/4)', async () => {
    const r = await runCard<FreqTestResult>('stats-binomial-mendel', helpRun('stats, ?binom.test'));
    same('counts', r.counts.join(', '), '682, 243');
    const g = r.binomial![0];
    near('proportion giant', g.proportion, 0.7372972973, 1e-9); near('p', g.p, 0.3824916, 1e-7);
    near('CI lower', g.ciLow!, 0.7076682641, 1e-9); near('CI upper', g.ciHigh!, 0.7654065582, 1e-9);
  }, 600_000);

  it('stats-multinomial: chisq.test(x, p = c(40, 20, 20, 15, 5), rescale.p = TRUE)', async () => {
    const r = await runCard<FreqTestResult>('stats-multinomial', helpRun('stats, ?chisq.test'));
    same('counts', r.counts.join(', '), '89, 37, 30, 28, 2');
    near('X²', r.multinomial!.stat, 9.9901434, 1e-6); same('df', r.multinomial!.df as number, 4); near('p', r.multinomial!.p, 0.04059404, 1e-8);
  }, 600_000);

  it('psych-alpha-neuroticism: alpha, omega total and glb of N1–N5', async () => {
    const r = await runCard<ReliabilityResult>('psych-alpha-neuroticism', helpPrinted('psych, ?bfi (scoreItems, pairwise)', 'https://rdrr.io/cran/psych/man/bfi.html'));
    // (?bfi's scoreItems prints α = 0.81 for neuroticism, from pairwise correlations; the card's α is of the complete cases)
    near('standardised α (the help page: 0.81)', r.stdAlpha!, 0.81, 0.005);
    against({ label: 'psych 2.6.9 in desktop R: alpha(), omega(nfactors = 1) and glb.fa() on the complete cases', level: 'native' });
    same('complete cases', r.n, 2694);
    near('α', r.alpha!, 0.8133031432, 1e-8); near('standardised α', r.stdAlpha!, 0.8140720657, 1e-8); near('average r', r.averageR!, 0.466861608, 1e-8);
    near('ω total', r.omegaTotal!, 0.8184506994, 1e-6); near('glb', r.glb!, 0.848100313, 1e-4);
    const drop = [0.7573075145, 0.7626780980, 0.7548653524, 0.7945587221, 0.8116136344];
    r.items!.forEach((it, i) => near(`α if ${it.item} dropped`, it.alphaIfDropped, drop[i], 1e-8));
  }, 600_000);

  it('psych-kappa-cohen: cohen.kappa(cohen, cohen.weights, n.obs = 200) on Cohen’s table', async () => {
    const r = await runCard<ReliabilityResult>('psych-kappa-cohen', helpPrinted('psych, ?cohen.kappa (“cohen reports .492 and .348”)', 'https://rdrr.io/cran/psych/man/cohen.kappa.html'));
    near('κ (printed: .492)', r.kappa!.est, 0.492, 5e-4); near('weighted κ (printed: .348)', r.weighted!.est, 0.348, 5e-4);
    against(helpRun('psych, ?cohen.kappa (psych 2.6.9)'));
    same('subjects', r.n, 200); same('categories', r.categories!, 3);
    near('κ', r.kappa!.est, 0.4915254237, 1e-9); near('κ CI lower', r.kappa!.ciLow, 0.3915637021, 1e-8); near('κ CI upper', r.kappa!.ciHigh, 0.5914871454, 1e-8);
    near('weighted κ', r.weighted!.est, 0.3478260870, 1e-9);
    // (the interval: psych's for the agreement weights 1 - w / 6, cohen.kappa(cohen, 1 - cohen.weights / 6, n.obs = 200))
    near('weighted κ CI lower', r.weighted!.ciLow, 0.1998409364, 1e-8); near('weighted κ CI upper', r.weighted!.ciHigh, 0.4958112375, 1e-8);
  }, 600_000);

  it('psych-kappa-cohen-nonsymmetric: cohen.kappa(cohen, wc), non-symmetric weights', async () => {
    const r = await runCard<ReliabilityResult>('psych-kappa-cohen-nonsymmetric', helpPrinted('psych, ?cohen.kappa (“Cohen reports kw = .353”)', 'https://rdrr.io/cran/psych/man/cohen.kappa.html'));
    near('weighted κ (printed: .353)', r.weighted!.est, 0.353, 5e-4);
    against(helpRun('psych, ?cohen.kappa (psych 2.6.9)'));
    near('weighted κ', r.weighted!.est, 0.3533834586, 1e-9); near('κ', r.kappa!.est, 0.4915254237, 1e-9);
    near('weighted κ CI lower (n.obs = 200)', r.weighted!.ciLow, 0.1910617521, 1e-8); near('weighted κ CI upper (n.obs = 200)', r.weighted!.ciHigh, 0.5157051652, 1e-8);
  }, 600_000);

  it('psych-icc-shroutfleiss: the six intraclass correlations of Shrout & Fleiss', async () => {
    const r = await runCard<ReliabilityResult>('psych-icc-shroutfleiss', { label: 'Shrout & Fleiss (1979), table 4', url: 'https://doi.org/10.1037/0033-2909.86.2.420', level: 'published' });
    const icc = (t: string) => r.icc!.find((x) => x.type === t)!.icc;
    // (Shrout & Fleiss print two decimals)
    const printed: Record<string, number> = { ICC1: 0.17, ICC2: 0.29, ICC3: 0.71, ICC1k: 0.44, ICC2k: 0.62, ICC3k: 0.91 };
    for (const [t, v] of Object.entries(printed)) near(t, icc(t), v, 0.005);
    against(helpRun('psych, ?ICC (psych 2.6.9)'));
    const native: Record<string, number> = { ICC1: 0.1657417684, ICC2: 0.2897637795, ICC3: 0.7148407148, ICC1k: 0.4427971337, ICC2k: 0.6200505476, ICC3k: 0.9093155424 };
    for (const [t, v] of Object.entries(native)) near(t, icc(t), v, 1e-9);
    near('F (ICC3)', r.icc!.find((x) => x.type === 'ICC3')!.f, 11.027247956, 1e-8);
    near('ICC2 CI lower', r.icc!.find((x) => x.type === 'ICC2')!.ciLow, 0.01878651337, 1e-8);
  }, 600_000);
});
