// Examples that open a card: basic statistics: t-tests, ANOVA, MANOVA, correlation, contingency tables, frequency tests, reliability. Each follows an R package's help page or a textbook, with
// the numbers it prints checked in cards/basic.webr.test.ts.
//
// Data written inline on a help page (sleep in wide form, RoundingTimes, the plastic film, Agresti's tables, Mendel's
// cross, Shrout & Fleiss's ratings, Hollander & Wolfe's tuna, Cohen's agreement table) are shipped as CSV files in public/examples/tests, coded as the help page codes them.

import { CB } from '../define';
import type { PackageExample } from '../packages';

const RD = (page: string) => ({ label: `?${page}`, url: `https://rdrr.io/r/stats/${page}.html` });
const DATA = (name: string) => ({ label: `?${name}`, url: `https://rdrr.io/r/datasets/${name}.html` });
const PSYCH = (page: string) => ({ label: `psych, ?${page}`, url: `https://rdrr.io/cran/psych/man/${page}.html` });
const OK_CELLS = ['pre', 'post', 'fup'].flatMap((p) => [1, 2, 3, 4, 5].map((h) => `${p}.${h}`));
/** Cohen's (1968) table of proportions (?cohen.kappa), one row per cell. */
const COHEN = { package: 'psych' as const, name: 'Cohen’s table (?cohen.kappa)', file: 'examples/tests/cohen.csv' };
const COHEN_LINKS = [PSYCH('cohen.kappa'), { label: 'Cohen (1968), Psychological Bulletin 70(4)', url: 'https://doi.org/10.1037/h0026256' }];

export const CARD_BASIC: PackageExample[] = [
  {
    id: 'stats-ttest-mtcars', package: 'datasets', title: 'Independent-samples t-test: fuel use by transmission', source: 'stats, ?t.test (mtcars)',
    links: [RD('t.test'), DATA('mtcars')],
    description: 'Miles per gallon of 32 cars of 1973–74 (Motor Trend), automatic (am = 0, 19 cars) against manual (am = 1, 13 cars): the help page’s t.test(mpg ~ am, data = mtcars). The card runs Welch’s test, R’s default, as the help page does (t = −3.767, df = 18.33, p = 0.0014), with Student’s pooled-variance test beside it (t = −4.106, df = 30). Opens its card on the Analyses tab.',
    data: { package: 'datasets', name: 'mtcars' }, constructs: [], paths: [],
    panel: { kind: 'ttest', type: 'independent', vars: ['mpg'], group: 'am', student: true, welch: true, rank: false, alternative: 'two.sided' }, settings: CB('ML'),
  },
  {
    id: 'stats-ttest-sleep-paired', package: 'stats', title: 'Paired-samples t-test: Student’s sleep data', source: 'stats, ?t.test (sleep in wide form)',
    links: [RD('t.test'), DATA('sleep')],
    description: 'Student’s (1908) data: the extra hours of sleep of ten patients on each of two soporific drugs. The help page reshapes sleep to one row per patient (extra.1, extra.2) and runs t.test(extra.1, extra.2, paired = TRUE); the card does the same: t = −4.062, df = 9, p = 0.0028, mean difference −1.58. Opens its card on the Analyses tab.',
    data: { package: 'stats', name: 'sleep in wide form (?t.test)', file: 'examples/tests/sleep2.csv' }, constructs: [], paths: [],
    panel: { kind: 'ttest', type: 'paired', pairs: [['extra.1', 'extra.2']], student: true, rank: false, alternative: 'two.sided' }, settings: CB('ML'),
  },
  {
    id: 'stats-ttest-sleep-one', package: 'datasets', title: 'One-sample t-test: Student’s sleep data', source: 'stats, ?t.test (sleep)',
    links: [RD('t.test'), DATA('sleep')],
    description: 'The 20 values of extra sleep in datasets::sleep against zero, the help page’s t.test(extra ~ 1, data = sleep): t = 3.413, df = 19, p = 0.0029, mean 1.54. Opens its card on the Analyses tab.',
    data: { package: 'datasets', name: 'sleep' }, constructs: [], paths: [],
    panel: { kind: 'ttest', type: 'one', vars: ['extra'], testValue: 0, student: true, rank: false, alternative: 'two.sided' }, settings: CB('ML'),
  },
  {
    id: 'stats-anova-plantgrowth', package: 'datasets', title: 'One-way ANOVA: plant growth', source: 'datasets, ?PlantGrowth (Dobson 1983, table 7.4)',
    links: [DATA('PlantGrowth'), RD('anova')],
    description: 'Dried weight of 30 plants under a control and two treatments, ten each. The help page’s anova(lm(weight ~ group, data = PlantGrowth)): F(2, 27) = 4.846, p = 0.0159. With one factor the card adds Welch’s ANOVA, Kruskal–Wallis and Tukey’s comparisons. Opens its card on the Analyses tab.',
    data: { package: 'datasets', name: 'PlantGrowth' }, constructs: [], paths: [],
    panel: { kind: 'anova', dependent: 'weight', factors: ['group'], covariates: [], ssType: 'III', interactions: true }, settings: CB('ML'),
  },
  {
    id: 'stats-anova-warpbreaks', package: 'datasets', title: 'Two-way ANOVA: breaks in yarn', source: 'datasets, ?warpbreaks',
    links: [DATA('warpbreaks'), RD('anova')],
    description: 'The number of warp breaks per loom for two wools and three tensions, nine looms per cell. The help page fits lm(breaks ~ wool * tension) and prints anova(fm1), sequential (type I) sums of squares, which the card is set to: wool F(1, 48) = 3.765, tension F(2, 48) = 8.498, wool × tension F(2, 48) = 4.189. (The design is balanced, so type III gives the same table.) Opens its card on the Analyses tab.',
    data: { package: 'datasets', name: 'warpbreaks' }, constructs: [], paths: [],
    panel: { kind: 'anova', dependent: 'breaks', factors: ['wool', 'tension'], covariates: [], ssType: 'I', interactions: true }, settings: CB('ML'),
  },
  {
    id: 'stats-rmanova-rounding', package: 'stats', title: 'Repeated measures: three ways of rounding first base', source: 'stats, ?friedman.test (Hollander & Wolfe 1973, p. 140ff.)',
    links: [RD('friedman.test')],
    description: 'Hollander & Wolfe’s RoundingTimes: for each of 22 players, the time to run from home towards second base rounding first base three ways (round out, narrow angle, wide angle), one column per method. The help page runs friedman.test(RoundingTimes): χ² = 11.143, df = 2, p = 0.0038, which the card reports beside the univariate repeated-measures ANOVA (F(2, 42) = 6.288), Mauchly’s test and the Greenhouse–Geisser and Huynh–Feldt corrections. Opens its card on the Analyses tab.',
    data: { package: 'stats', name: 'RoundingTimes (?friedman.test)', file: 'examples/tests/roundingtimes.csv' }, constructs: [], paths: [],
    panel: { kind: 'rmanova', levels: ['round.out', 'narrow.angle', 'wide.angle'], factorName: 'method', between: '' }, settings: CB('ML'),
  },
  {
    id: 'cardata-rmanova-obrienkaiser', package: 'carData', title: 'Repeated measures, two within-subject factors: O’Brien & Kaiser’s phases and hours', source: 'car, ?Anova (carData::OBrienKaiser)',
    links: [{ label: 'car, ?Anova', url: 'https://rdrr.io/cran/car/man/Anova.html' }, { label: 'carData, ?OBrienKaiser', url: 'https://rdrr.io/cran/carData/man/OBrienKaiser.html' }],
    description: 'O’Brien & Kaiser’s (1985) imaginary study: 16 subjects in a control group and two treatments (A, B), each measured at five hours in each of three phases (pretest, posttest, follow-up), one column per phase and hour (pre.1 … fup.5). As the help page’s idata and idesign = ~ phase * hour, the card defines two within-subject factors and assigns a column to each of the 15 cells, with treatment as the between factor (the help page also crosses gender). Type II tests, which car::Anova gives: phase F(2, 26) = 23.63, treatment × phase F(4, 26) = 5.43, hour F(4, 52) = 18.98; Mauchly’s test for hour W = 0.099, p = 0.0019, Greenhouse–Geisser ε = 0.489. Opens its card on the Analyses tab.',
    data: { package: 'carData', name: 'OBrienKaiser' }, constructs: [], paths: [],
    panel: { kind: 'rmanova', levels: [], factorName: 'phase', between: 'treatment', factors: [{ name: 'phase', levels: ['pretest', 'posttest', 'followup'] }, { name: 'hour', levels: ['1', '2', '3', '4', '5'] }], cells: OK_CELLS }, settings: CB('ML'),
  },
  {
    id: 'stats-manova-plastic', package: 'stats', title: 'MANOVA: producing plastic film', source: 'stats, ?summary.manova (Krzanowski 1998, p. 381)',
    links: [RD('summary.manova'), RD('manova')],
    description: 'Tear resistance, gloss and opacity of 20 plastic films, produced at a low or high rate of extrusion with a low or high amount of an additive (five films per cell). The help page’s manova(cbind(tear, gloss, opacity) ~ rate * additive): Pillai’s trace 0.618 for rate (F(3, 14) = 7.554, p = 0.003), 0.477 for the additive (p = 0.025) and 0.223 for the interaction (p = 0.30); Wilks’ λ 0.382, 0.523 and 0.777. The card shows all four multivariate tests. Opens its card on the Analyses tab.',
    data: { package: 'stats', name: 'plastic film (?summary.manova)', file: 'examples/tests/plastic.csv' }, constructs: [], paths: [], labels: { rate: ['Low', 'High'], additive: ['Low', 'High'] },
    panel: { kind: 'manova', dependents: ['tear', 'gloss', 'opacity'], factors: ['rate', 'additive'], interactions: true }, settings: CB('ML'),
  },
  {
    id: 'stats-correlation-judges', package: 'datasets', title: 'Correlation: lawyers’ ratings of judges', source: 'stats, ?cor.test (USJudgeRatings)',
    links: [RD('cor.test'), DATA('USJudgeRatings')],
    description: 'Lawyers’ ratings of 43 state judges in the US Superior Court: the number of contacts of the lawyer with the judge (CONT) and the judge’s integrity (INTG). The help page’s cor.test(~ CONT + INTG, data = USJudgeRatings): r = −0.133, t = −0.861 on 41 df, p = 0.39, 95% interval [−0.417, 0.174]. Opens its card on the Analyses tab.',
    data: { package: 'datasets', name: 'USJudgeRatings' }, constructs: [], paths: [],
    panel: { kind: 'correlation', vars: ['CONT', 'INTG'], method: 'pearson', alternative: 'two.sided', deletion: 'pairwise' }, settings: CB('ML'),
  },
  {
    id: 'stats-correlation-tuna', package: 'stats', title: 'Kendall’s τ with an exact p-value: the lightness of canned tuna', source: 'stats, ?cor.test (Hollander & Wolfe 1973, p. 187f.)',
    links: [RD('cor.test')],
    description: 'Hollander & Wolfe’s assessment of tuna quality: the Hunter L measure of lightness against the averages of consumer panel scores in nine lots of canned tuna. The alternative of interest is a positive association: the help page’s cor.test(x, y, method = "kendall", alternative = "greater") gives T = 26, τ = 0.444 and the exact p = 0.05972 (the large-sample approximation, exact = FALSE, gives 0.04765). The card is set to exact p-values. Opens its card on the Analyses tab.',
    data: { package: 'stats', name: 'tuna lightness (?cor.test)', file: 'examples/tests/tuna.csv' }, constructs: [], paths: [],
    panel: { kind: 'correlation', vars: ['hunter', 'panel'], method: 'kendall', alternative: 'greater', deletion: 'pairwise', exact: true }, settings: CB('ML'),
  },
  {
    id: 'stats-contingency-party', package: 'stats', title: 'χ² test of independence: gender and party identification', source: 'stats, ?chisq.test (Agresti 2007, p. 39)',
    links: [RD('chisq.test')],
    description: 'Agresti’s 2 × 3 table of 2757 people by gender and party identification (Democrat, Independent, Republican), one row per cell with its count. The help page’s chisq.test(M): X² = 30.07, df = 2, p = 2.95 × 10⁻⁷. The card also gives the expected counts, the likelihood-ratio test and Cramér’s V. Opens its card on the Analyses tab.',
    data: { package: 'stats', name: 'party identification (?chisq.test)', file: 'examples/tests/party.csv' }, constructs: [], paths: [],
    labels: { gender: ['F', 'M'], party: ['Democrat', 'Independent', 'Republican'] },
    panel: { kind: 'contingency', rows: 'gender', columns: 'party', counts: 'count' }, settings: CB('ML'),
  },
  {
    id: 'stats-contingency-job', package: 'stats', title: 'Fisher’s exact test: income and job satisfaction', source: 'stats, ?fisher.test (Agresti 2002, p. 57)',
    links: [RD('fisher.test')],
    description: 'Agresti’s 4 × 4 table of 96 people by income and job satisfaction, one row per cell with its count. Several expected counts are below 5, so the χ² approximation is doubtful (R warns) and the exact test is the one to read: the help page’s fisher.test(Job) gives p = 0.7827. Opens its card on the Analyses tab.',
    data: { package: 'stats', name: 'job satisfaction (?fisher.test)', file: 'examples/tests/job.csv' }, constructs: [], paths: [],
    labels: { income: ['< 15k', '15-25k', '25-40k', '> 40k'], satisfaction: ['VeryD', 'LittleD', 'ModerateS', 'VeryS'] },
    panel: { kind: 'contingency', rows: 'income', columns: 'satisfaction', counts: 'count' }, settings: CB('ML'),
  },
  {
    id: 'stats-binomial-mendel', package: 'stats', title: 'Binomial test: giant and dwarf plants', source: 'stats, ?binom.test (Conover 1971, p. 97f.)',
    links: [RD('binom.test')],
    description: 'Under simple Mendelian inheritance a cross gives 3/4 giant and 1/4 dwarf plants; one cross gave 682 giant and 243 dwarf (one row per plant). The help page’s binom.test(c(682, 243), p = 3/4): 73.7% giant, p = 0.38, 95% interval [0.708, 0.765], in agreement with the null hypothesis. The card tests each category against 0.75, so read the giant row. Opens its card on the Analyses tab.',
    data: { package: 'stats', name: 'Mendel’s cross (?binom.test)', file: 'examples/tests/mendel.csv' }, constructs: [], paths: [], labels: { plant: ['giant', 'dwarf'] },
    panel: { kind: 'freqtest', type: 'binomial', variable: 'plant', testValue: 0.75, alternative: 'two.sided' }, settings: CB('ML'),
  },
  {
    id: 'stats-multinomial', package: 'stats', title: 'Multinomial goodness of fit: counts against given proportions', source: 'stats, ?chisq.test (testing population probabilities)',
    links: [RD('chisq.test')],
    description: 'The help page’s 186 observations in five categories (89, 37, 30, 28, 2) against the proportions 40 : 20 : 20 : 15 : 5, chisq.test(x, p = p, rescale.p = TRUE): X² = 9.990, df = 4, p = 0.041. Opens its card on the Analyses tab.',
    data: { package: 'stats', name: 'five categories (?chisq.test)', file: 'examples/tests/multinomial.csv' }, constructs: [], paths: [],
    panel: { kind: 'freqtest', type: 'multinomial', variable: 'category', proportions: [40, 20, 20, 15, 5], alternative: 'two.sided' }, settings: CB('ML'),
  },
  {
    id: 'psych-alpha-neuroticism', package: 'psych', title: 'Scale reliability: the neuroticism items of the bfi', source: 'psych, ?bfi, ?alpha, ?omega',
    links: [PSYCH('bfi'), PSYCH('alpha'), PSYCH('omega')],
    description: 'The five neuroticism items N1–N5 of the 25 personality items in psych’s bfi (2800 people, SAPA project), all keyed in the same direction (?bfi’s bfi.keys). The help page scores them with scoreItems, which prints α = 0.81 (from pairwise correlations); the card runs alpha() on the 2694 complete cases (α = 0.813, standardised 0.814), with ω total of one factor (0.818) and the greatest lower bound (0.848). Opens its card on the Analyses tab.',
    data: { package: 'psych', name: 'bfi' }, constructs: [], paths: [],
    panel: { kind: 'reliability', type: 'scale', vars: ['N1', 'N2', 'N3', 'N4', 'N5'] }, settings: CB('ML'),
  },
  {
    id: 'psych-kappa-cohen', package: 'psych', title: 'Cohen’s kappa of an agreement table: Cohen’s weighted κ', source: 'psych, ?cohen.kappa (Cohen 1968)',
    links: COHEN_LINKS,
    description: 'Cohen’s (1968) example: the proportions of 200 subjects that two raters placed in three categories, one row per cell of the table. With Cohen’s disagreement weights (0, 1, 3 / 1, 0, 6 / 3, 6, 0) the help page’s cohen.kappa(cohen, cohen.weights, n.obs = 200) gives κ = 0.492 and weighted κ = 0.348, the values Cohen reports. (The card takes the disagreement weights as the agreement weights 1 − w/6: the same weighted κ, with psych’s standard error for agreement weights; psych’s own interval for disagreement weights runs past 1.) Opens its card on the Analyses tab.',
    data: COHEN, constructs: [], paths: [],
    panel: { kind: 'reliability', type: 'kappa', vars: [], kappaTable: { rows: 'rater1', columns: 'rater2', counts: 'proportion', nObs: 200 }, kappaWeights: 'custom', weightMatrix: [[0, 1, 3], [1, 0, 6], [3, 6, 0]] }, settings: CB('ML'),
  },
  {
    id: 'psych-kappa-cohen-nonsymmetric', package: 'psych', title: 'Cohen’s kappa of an agreement table: non-symmetric weights', source: 'psych, ?cohen.kappa (Cohen 1968)',
    links: COHEN_LINKS,
    description: 'The same table of 200 subjects with the help page’s non-symmetric weights (0, 1, 4 / 1, 0, 6 / 2, 2, 0: a disagreement costs more one way than the other), cohen.kappa(cohen, wc): weighted κ = 0.353, as Cohen reports, and κ = 0.492. The help page leaves out n.obs, so psych takes the proportions as one subject; the card gives the 200 subjects, which changes only the intervals. Opens its card on the Analyses tab.',
    data: COHEN, constructs: [], paths: [],
    panel: { kind: 'reliability', type: 'kappa', vars: [], kappaTable: { rows: 'rater1', columns: 'rater2', counts: 'proportion', nObs: 200 }, kappaWeights: 'custom', weightMatrix: [[0, 1, 4], [1, 0, 6], [2, 2, 0]] }, settings: CB('ML'),
  },
  {
    id: 'psych-icc-shroutfleiss', package: 'psych', title: 'Intraclass correlations: four judges rate six targets', source: 'psych, ?ICC (Shrout & Fleiss 1979)',
    links: [PSYCH('ICC'), { label: 'Shrout & Fleiss (1979), Psychological Bulletin 86(2)', url: 'https://doi.org/10.1037/0033-2909.86.2.420' }],
    description: 'Shrout & Fleiss’s example: four judges (J1–J4) rate six targets, one row per target. The help page’s ICC(sf, lmer = FALSE) gives the six intraclass correlations, as Shrout & Fleiss’s table 4 does: ICC(1,1) = 0.17, ICC(2,1) = 0.29, ICC(3,1) = 0.71, ICC(1,4) = 0.44, ICC(2,4) = 0.62, ICC(3,4) = 0.91. Opens its card on the Analyses tab.',
    data: { package: 'psych', name: 'sf (?ICC, Shrout & Fleiss 1979)', file: 'examples/tests/shroutfleiss.csv' }, constructs: [], paths: [],
    panel: { kind: 'reliability', type: 'icc', vars: ['J1', 'J2', 'J3', 'J4'] }, settings: CB('ML'),
  },
];
