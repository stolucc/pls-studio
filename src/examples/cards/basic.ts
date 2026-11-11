// Examples that open a card: basic statistics: t-tests, ANOVA, MANOVA, correlation, contingency tables, frequency tests, reliability. Each follows an R package's help page or a textbook, with
// the numbers it prints checked in cards/basic.webr.test.ts.
//
// Data written inline on a help page (sleep in wide form, RoundingTimes, the plastic film, Agresti's tables, Mendel's
// cross, Shrout & Fleiss's ratings, Hollander & Wolfe's tuna, Cohen's agreement table, Krippendorff's coders, Agresti's approval table) are shipped as CSV files in public/examples/tests, coded as the help page codes them.

import { CB } from '../define';
import type { PackageExample } from '../packages';

const RD = (page: string) => ({ label: `?${page}`, url: `https://rdrr.io/r/stats/${page}.html` });
const DATA = (name: string) => ({
  label: `?${name}`,
  url: `https://rdrr.io/r/datasets/${name}.html`,
});
const PSYCH = (page: string) => ({
  label: `psych, ?${page}`,
  url: `https://rdrr.io/cran/psych/man/${page}.html`,
});
const BAYESREL = (page: string) => ({
  label: `Bayesrel, ?${page}`,
  url: `https://rdrr.io/cran/Bayesrel/man/${page}.html`,
});
const IRR = (page: string) => ({
  label: `irr, ?${page}`,
  url: `https://rdrr.io/cran/irr/man/${page}.html`,
});
const OK_CELLS = ['pre', 'post', 'fup'].flatMap((p) => [1, 2, 3, 4, 5].map((h) => `${p}.${h}`));
/** Cohen's (1968) table of proportions (?cohen.kappa), one row per cell. */
const COHEN = {
  package: 'psych' as const,
  name: 'Cohen’s table (?cohen.kappa)',
  file: 'examples/tests/cohen.csv',
};
const COHEN_LINKS = [
  PSYCH('cohen.kappa'),
  { label: 'Cohen (1968), Psychological Bulletin 70(4)', url: 'https://doi.org/10.1037/h0026256' },
];

export const CARD_BASIC: PackageExample[] = [
  {
    id: 'stats-ttest-mtcars',
    package: 'datasets',
    title: 'Independent-samples t-test: fuel use by transmission',
    source: 'stats, ?t.test (mtcars)',
    links: [RD('t.test'), DATA('mtcars')],
    description:
      'Miles per gallon of 32 cars of 1973–74 (Motor Trend), automatic (am = 0, 19 cars) against manual (am = 1, 13 cars): the help page’s t.test(mpg ~ am, data = mtcars). The card runs Welch’s test, R’s default, as the help page does (t = −3.767, df = 18.33, p = 0.0014), with Student’s pooled-variance test beside it (t = −4.106, df = 30). Opens its card on the Analyses tab.',
    shows:
      'Manual cars use less fuel: the card’s Welch row gives t = −3.767 on 18.33 df, p = 0.0014, and Student’s pooled test beside it (t = −4.106, df = 30) agrees. The descriptives put the means at 17.1 mpg for automatic and 24.4 for manual transmissions.',
    data: { package: 'datasets', name: 'mtcars' },
    constructs: [],
    paths: [],
    panel: {
      kind: 'ttest',
      type: 'independent',
      vars: ['mpg'],
      group: 'am',
      student: true,
      welch: true,
      rank: false,
      alternative: 'two.sided',
    },
    settings: CB('ML'),
  },
  {
    id: 'stats-ttest-sleep-paired',
    package: 'stats',
    title: 'Paired-samples t-test: Student’s sleep data',
    source: 'stats, ?t.test (sleep in wide form)',
    links: [RD('t.test'), DATA('sleep')],
    description:
      'Student’s (1908) data: the extra hours of sleep of ten patients on each of two soporific drugs. The help page reshapes sleep to one row per patient (extra.1, extra.2) and runs t.test(extra.1, extra.2, paired = TRUE); the card does the same: t = −4.062, df = 9, p = 0.0028, mean difference −1.58. Opens its card on the Analyses tab.',
    shows:
      'The paired test on the ten patients: t = −4.062 on 9 df, p = 0.0028, a mean difference of −1.58 hours with a 95% interval of [−2.46, −0.70], so the second drug gives more sleep. The one-sample example pools the same 20 values and ignores the pairing.',
    data: {
      package: 'stats',
      name: 'sleep in wide form (?t.test)',
      file: 'examples/tests/sleep2.csv',
    },
    constructs: [],
    paths: [],
    panel: {
      kind: 'ttest',
      type: 'paired',
      pairs: [['extra.1', 'extra.2']],
      student: true,
      rank: false,
      alternative: 'two.sided',
    },
    settings: CB('ML'),
  },
  {
    id: 'stats-ttest-sleep-one',
    package: 'datasets',
    title: 'One-sample t-test: Student’s sleep data',
    source: 'stats, ?t.test (sleep)',
    links: [RD('t.test'), DATA('sleep')],
    description:
      'The 20 values of extra sleep in datasets::sleep against zero, the help page’s t.test(extra ~ 1, data = sleep): t = 3.413, df = 19, p = 0.0029, mean 1.54. Opens its card on the Analyses tab.',
    shows:
      'All 20 values against zero: t = 3.413 on 19 df, p = 0.0029, mean extra sleep 1.54 hours, 95% interval [0.60, 2.48]. Read it as a test that the drugs add sleep on average, with the two drugs pooled; the paired example separates them.',
    data: { package: 'datasets', name: 'sleep' },
    constructs: [],
    paths: [],
    panel: {
      kind: 'ttest',
      type: 'one',
      vars: ['extra'],
      testValue: 0,
      student: true,
      rank: false,
      alternative: 'two.sided',
    },
    settings: CB('ML'),
  },
  {
    id: 'stats-anova-plantgrowth',
    package: 'datasets',
    title: 'One-way ANOVA: plant growth',
    source: 'datasets, ?PlantGrowth (Dobson 1983, table 7.4)',
    links: [DATA('PlantGrowth'), RD('anova')],
    description:
      'Dried weight of 30 plants under a control and two treatments, ten each. The help page’s anova(lm(weight ~ group, data = PlantGrowth)): F(2, 27) = 4.846, p = 0.0159. With one factor the card adds Welch’s ANOVA, Kruskal–Wallis and Tukey’s comparisons. Opens its card on the Analyses tab.',
    shows:
      'The ANOVA table gives F(2, 27) = 4.846, p = 0.0159: the three groups differ in dried weight. Below it, the Welch ANOVA and Kruskal–Wallis rows test the same question without equal variances or normality, and Tukey’s comparisons show which pair of groups accounts for the difference.',
    data: { package: 'datasets', name: 'PlantGrowth' },
    constructs: [],
    paths: [],
    panel: {
      kind: 'anova',
      dependent: 'weight',
      factors: ['group'],
      covariates: [],
      ssType: 'III',
      interactions: true,
    },
    settings: CB('ML'),
  },
  {
    id: 'stats-anova-warpbreaks',
    package: 'datasets',
    title: 'Two-way ANOVA: breaks in yarn',
    source: 'datasets, ?warpbreaks',
    links: [DATA('warpbreaks'), RD('anova')],
    description:
      'The number of warp breaks per loom for two wools and three tensions, nine looms per cell. The help page fits lm(breaks ~ wool * tension) and prints anova(fm1), sequential (type I) sums of squares, which the card is set to: wool F(1, 48) = 3.765, tension F(2, 48) = 8.498, wool × tension F(2, 48) = 4.189. (The design is balanced, so type III gives the same table.) Opens its card on the Analyses tab.',
    shows:
      'Sequential (type I) sums of squares as anova() prints them: tension F(2, 48) = 8.498, p = 0.0007, and wool × tension F(2, 48) = 4.189, p = 0.021, while wool alone stays above 0.05 (F(1, 48) = 3.765, p = 0.058). The interaction is the finding: the effect of tension depends on the wool.',
    data: { package: 'datasets', name: 'warpbreaks' },
    constructs: [],
    paths: [],
    panel: {
      kind: 'anova',
      dependent: 'breaks',
      factors: ['wool', 'tension'],
      covariates: [],
      ssType: 'I',
      interactions: true,
    },
    settings: CB('ML'),
  },
  {
    id: 'stats-rmanova-rounding',
    package: 'stats',
    title: 'Repeated measures: three ways of rounding first base',
    source: 'stats, ?friedman.test (Hollander & Wolfe 1973, p. 140ff.)',
    links: [RD('friedman.test')],
    description:
      'Hollander & Wolfe’s RoundingTimes: for each of 22 players, the time to run from home towards second base rounding first base three ways (round out, narrow angle, wide angle), one column per method. The help page runs friedman.test(RoundingTimes): χ² = 11.143, df = 2, p = 0.0038, which the card reports beside the univariate repeated-measures ANOVA (F(2, 42) = 6.288), Mauchly’s test and the Greenhouse–Geisser and Huynh–Feldt corrections. Opens its card on the Analyses tab.',
    shows:
      'Friedman’s test gives χ² = 11.143 on 2 df, p = 0.0038, and the univariate repeated-measures ANOVA agrees (F(2, 42) = 6.288, p = 0.0041): the three ways of rounding first base differ in time. Mauchly’s test and the Greenhouse–Geisser and Huynh–Feldt corrections are on the same card for the parametric version.',
    data: {
      package: 'stats',
      name: 'RoundingTimes (?friedman.test)',
      file: 'examples/tests/roundingtimes.csv',
    },
    constructs: [],
    paths: [],
    panel: {
      kind: 'rmanova',
      levels: ['round.out', 'narrow.angle', 'wide.angle'],
      factorName: 'method',
      between: '',
    },
    settings: CB('ML'),
  },
  {
    id: 'cardata-rmanova-obrienkaiser',
    package: 'carData',
    title: 'Repeated measures, two within-subject factors: O’Brien & Kaiser’s phases and hours',
    source: 'car, ?Anova (carData::OBrienKaiser)',
    links: [
      { label: 'car, ?Anova', url: 'https://rdrr.io/cran/car/man/Anova.html' },
      {
        label: 'carData, ?OBrienKaiser',
        url: 'https://rdrr.io/cran/carData/man/OBrienKaiser.html',
      },
    ],
    description:
      'O’Brien & Kaiser’s (1985) imaginary study: 16 subjects in a control group and two treatments (A, B), each measured at five hours in each of three phases (pretest, posttest, follow-up), one column per phase and hour (pre.1 … fup.5). As the help page’s idata and idesign = ~ phase * hour, the card defines two within-subject factors and assigns a column to each of the 15 cells, with the help page’s between factors, treatment crossed with gender (the first between factor and a further one). With several between factors the card runs car::Anova on the multivariate linear model, type II tests with sum-to-zero contrasts (the help page’s own contrasts give the same tests): treatment F(2, 10) = 4.63, phase F(2, 20) = 20.87, treatment × phase F(4, 20) = 4.90, hour F(4, 40) = 17.01; Mauchly’s test for hour W = 0.066, p = 0.0076, Greenhouse–Geisser ε = 0.460, every test and correction of summary(Anova(mod.ok, idata, idesign = ~ phase * hour), multivariate = FALSE). Post hoc, every pair of each factor’s levels on the subjects’ means over the other factor’s levels (Holm within the factor). Opens its card on the Analyses tab.',
    shows:
      'car::Anova’s univariate table term by term: treatment F(2, 10) = 4.63 (p = 0.038), phase F(2, 20) = 20.87, treatment × phase F(4, 20) = 4.90 (p = 0.0064), hour F(4, 40) = 17.01; nothing involving gender is significant. Mauchly’s test rejects sphericity for hour (W = 0.066, p = 0.0076), so read hour’s Greenhouse–Geisser column (ε = 0.460).',
    data: { package: 'carData', name: 'OBrienKaiser' },
    constructs: [],
    paths: [],
    panel: {
      kind: 'rmanova',
      levels: [],
      factorName: 'phase',
      between: 'treatment',
      moreBetween: ['gender'],
      factors: [
        { name: 'phase', levels: ['pretest', 'posttest', 'followup'] },
        { name: 'hour', levels: ['1', '2', '3', '4', '5'] },
      ],
      cells: OK_CELLS,
    },
    settings: CB('ML'),
  },
  {
    id: 'stats-manova-plastic',
    package: 'stats',
    title: 'MANOVA: producing plastic film',
    source: 'stats, ?summary.manova (Krzanowski 1998, p. 381)',
    links: [RD('summary.manova'), RD('manova')],
    description:
      'Tear resistance, gloss and opacity of 20 plastic films, produced at a low or high rate of extrusion with a low or high amount of an additive (five films per cell). The help page’s manova(cbind(tear, gloss, opacity) ~ rate * additive): Pillai’s trace 0.618 for rate (F(3, 14) = 7.554, p = 0.003), 0.477 for the additive (p = 0.025) and 0.223 for the interaction (p = 0.30); Wilks’ λ 0.382, 0.523 and 0.777. The card shows all four multivariate tests. Opens its card on the Analyses tab.',
    shows:
      'Pillai’s trace 0.618 for rate, F(3, 14) = 7.554, p = 0.003, and 0.477 for the additive (p = 0.025): both change the films’ three properties taken together; the interaction (0.223, p = 0.30) does not. Pillai, Wilks, Hotelling–Lawley and Roy give the same F here, since each term has a single degree of freedom.',
    data: {
      package: 'stats',
      name: 'plastic film (?summary.manova)',
      file: 'examples/tests/plastic.csv',
    },
    constructs: [],
    paths: [],
    labels: { rate: ['Low', 'High'], additive: ['Low', 'High'] },
    panel: {
      kind: 'manova',
      dependents: ['tear', 'gloss', 'opacity'],
      factors: ['rate', 'additive'],
      interactions: true,
    },
    settings: CB('ML'),
  },
  {
    id: 'stats-correlation-judges',
    package: 'datasets',
    title: 'Correlation: lawyers’ ratings of judges',
    source: 'stats, ?cor.test (USJudgeRatings)',
    links: [RD('cor.test'), DATA('USJudgeRatings')],
    description:
      'Lawyers’ ratings of 43 state judges in the US Superior Court: the number of contacts of the lawyer with the judge (CONT) and the judge’s integrity (INTG). The help page’s cor.test(~ CONT + INTG, data = USJudgeRatings): r = −0.133, t = −0.861 on 41 df, p = 0.39, 95% interval [−0.417, 0.174]. Opens its card on the Analyses tab.',
    shows:
      'A correlation that is not there: r = −0.133 between contacts and integrity, t = −0.861 on 41 df, p = 0.39, with a 95% interval [−0.417, 0.174] that straddles zero. Read the interval as the result: with 43 judges, anything from a moderate negative to a small positive correlation is consistent with the data.',
    data: { package: 'datasets', name: 'USJudgeRatings' },
    constructs: [],
    paths: [],
    panel: {
      kind: 'correlation',
      vars: ['CONT', 'INTG'],
      method: 'pearson',
      alternative: 'two.sided',
      deletion: 'pairwise',
    },
    settings: CB('ML'),
  },
  {
    id: 'stats-correlation-tuna',
    package: 'stats',
    title: 'Kendall’s τ with an exact p-value: the lightness of canned tuna',
    source: 'stats, ?cor.test (Hollander & Wolfe 1973, p. 187f.)',
    links: [RD('cor.test')],
    description:
      'Hollander & Wolfe’s assessment of tuna quality: the Hunter L measure of lightness against the averages of consumer panel scores in nine lots of canned tuna. The alternative of interest is a positive association: the help page’s cor.test(x, y, method = "kendall", alternative = "greater") gives T = 26, τ = 0.444 and the exact p = 0.05972 (the large-sample approximation, exact = FALSE, gives 0.04765). The card is set to exact p-values. Opens its card on the Analyses tab.',
    shows:
      'Kendall’s τ = 0.444 (T = 26) for nine lots, with the exact one-sided p = 0.0597, just above 0.05; the large-sample approximation would give 0.0477 and the opposite verdict. Small samples with a rank test are where exact p-values matter, which is what the card’s exact setting is for.',
    data: { package: 'stats', name: 'tuna lightness (?cor.test)', file: 'examples/tests/tuna.csv' },
    constructs: [],
    paths: [],
    panel: {
      kind: 'correlation',
      vars: ['hunter', 'panel'],
      method: 'kendall',
      alternative: 'greater',
      deletion: 'pairwise',
      exact: true,
    },
    settings: CB('ML'),
  },
  {
    id: 'stats-contingency-party',
    package: 'stats',
    title: 'χ² test of independence: gender and party identification',
    source: 'stats, ?chisq.test (Agresti 2007, p. 39)',
    links: [RD('chisq.test')],
    description:
      'Agresti’s 2 × 3 table of 2757 people by gender and party identification (Democrat, Independent, Republican), one row per cell with its count. The help page’s chisq.test(M): X² = 30.07, df = 2, p = 2.95 × 10⁻⁷. The card also gives the expected counts, the likelihood-ratio test and Cramér’s V. Opens its card on the Analyses tab.',
    shows:
      'X² = 30.07 on 2 df, p = 2.95 × 10⁻⁷: gender and party identification are not independent among Agresti’s 2757 people. The expected counts beside the observed ones show where the association lies, and Cramér’s V puts its size in perspective: highly significant with n this large, yet weak.',
    data: {
      package: 'stats',
      name: 'party identification (?chisq.test)',
      file: 'examples/tests/party.csv',
    },
    constructs: [],
    paths: [],
    labels: { gender: ['F', 'M'], party: ['Democrat', 'Independent', 'Republican'] },
    panel: { kind: 'contingency', rows: 'gender', columns: 'party', counts: 'count' },
    settings: CB('ML'),
  },
  {
    id: 'stats-mcnemar-performance',
    package: 'stats',
    title: 'McNemar’s test: approval of the president, a month apart',
    source: 'stats, ?mcnemar.test (Agresti 1990, p. 350)',
    links: [RD('mcnemar.test')],
    description:
      'Agresti’s (1990) table on the help page: 1600 people asked twice, a month apart, whether they approve of the ' +
      'president’s performance, one row per cell with its count. The help page’s mcnemar.test(Performance) gives ' +
      'χ² = 16.82 on 1 df, p = 4.1e-5 (with the continuity correction, R’s default). With “Paired measurements” ' +
      'the card adds that test, the uncorrected one and the exact test of the discordant pairs. Opens its card on ' +
      'the Analyses tab.',
    shows:
      'Approval fell: 150 people moved from approve to disapprove and only 86 the other way. McNemar’s χ² = 16.82 ' +
      '(continuity-corrected, the help page’s value), p = 0.00004; the uncorrected χ² (17.36) and the exact test ' +
      '(p = 0.00004) agree. The χ² test of independence on the same card answers a different question: whether the ' +
      'two answers are related, which they obviously are.',
    data: {
      package: 'stats',
      name: 'presidential approval (?mcnemar.test)',
      file: 'examples/tests/performance.csv',
    },
    constructs: [],
    paths: [],
    labels: {
      first: ['Approve', 'Disapprove'],
      second: ['Approve', 'Disapprove'],
    },
    panel: {
      kind: 'contingency',
      rows: 'first',
      columns: 'second',
      counts: 'count',
      paired: true,
    },
    settings: CB('ML'),
  },
  {
    id: 'stats-contingency-job',
    package: 'stats',
    title: 'Fisher’s exact test: income and job satisfaction',
    source: 'stats, ?fisher.test (Agresti 2002, p. 57)',
    links: [RD('fisher.test')],
    description:
      'Agresti’s 4 × 4 table of 96 people by income and job satisfaction, one row per cell with its count. Several expected counts are below 5, so the χ² approximation is doubtful (R warns) and the exact test is the one to read: the help page’s fisher.test(Job) gives p = 0.7827. Opens its card on the Analyses tab.',
    shows:
      'Fisher’s exact test gives p = 0.7827: no association between income and job satisfaction in these 96 people. The χ² test on the same card warns that its approximation may be incorrect (several expected counts are below 5); the warning is the reason to read the exact test, not a fault.',
    data: {
      package: 'stats',
      name: 'job satisfaction (?fisher.test)',
      file: 'examples/tests/job.csv',
    },
    constructs: [],
    paths: [],
    labels: {
      income: ['< 15k', '15-25k', '25-40k', '> 40k'],
      satisfaction: ['VeryD', 'LittleD', 'ModerateS', 'VeryS'],
    },
    panel: { kind: 'contingency', rows: 'income', columns: 'satisfaction', counts: 'count' },
    settings: CB('ML'),
    expectedMessages: [
      {
        pattern: 'approximation may be incorrect',
        level: 'warning',
        why: 'Several expected counts are below 5, so chisq.test warns about its approximation; the help page reads Fisher’s exact test instead, which is the one to read here.',
      },
    ],
  },
  {
    id: 'stats-binomial-mendel',
    package: 'stats',
    title: 'Binomial test: giant and dwarf plants',
    source: 'stats, ?binom.test (Conover 1971, p. 97f.)',
    links: [RD('binom.test')],
    description:
      'Under simple Mendelian inheritance a cross gives 3/4 giant and 1/4 dwarf plants; one cross gave 682 giant and 243 dwarf (one row per plant). The help page’s binom.test(c(682, 243), p = 3/4): 73.7% giant, p = 0.38, 95% interval [0.708, 0.765], in agreement with the null hypothesis. The card tests each category against 0.75, so read the giant row. Opens its card on the Analyses tab.',
    shows:
      'A test that does not reject: 682 of 925 plants are giant, 73.7%, against the Mendelian 75%, p = 0.38, with a 95% interval [0.708, 0.765] that contains 0.75. Read the giant row; the dwarf row tests the same count the other way round against 0.75 as well, which is not the hypothesis.',
    data: {
      package: 'stats',
      name: 'Mendel’s cross (?binom.test)',
      file: 'examples/tests/mendel.csv',
    },
    constructs: [],
    paths: [],
    labels: { plant: ['giant', 'dwarf'] },
    panel: {
      kind: 'freqtest',
      type: 'binomial',
      variable: 'plant',
      testValue: 0.75,
      alternative: 'two.sided',
    },
    settings: CB('ML'),
  },
  {
    id: 'stats-multinomial',
    package: 'stats',
    title: 'Multinomial goodness of fit: counts against given proportions',
    source: 'stats, ?chisq.test (testing population probabilities)',
    links: [RD('chisq.test')],
    description:
      'The help page’s 186 observations in five categories (89, 37, 30, 28, 2) against the proportions 40 : 20 : 20 : 15 : 5, chisq.test(x, p = p, rescale.p = TRUE): X² = 9.990, df = 4, p = 0.041. Opens its card on the Analyses tab.',
    shows:
      'X² = 9.990 on 4 df, p = 0.041: the five counts depart from the 40 : 20 : 20 : 15 : 5 proportions, just below the 0.05 line. The expected counts beside the observed ones show where: the first category has more than its share and the last, with 2 observations, far fewer.',
    data: {
      package: 'stats',
      name: 'five categories (?chisq.test)',
      file: 'examples/tests/multinomial.csv',
    },
    constructs: [],
    paths: [],
    panel: {
      kind: 'freqtest',
      type: 'multinomial',
      variable: 'category',
      proportions: [40, 20, 20, 15, 5],
      alternative: 'two.sided',
    },
    settings: CB('ML'),
  },
  {
    id: 'psych-alpha-neuroticism',
    package: 'psych',
    title: 'Scale reliability: the neuroticism items of the bfi',
    source: 'psych, ?bfi, ?alpha, ?omega',
    links: [PSYCH('bfi'), PSYCH('alpha'), PSYCH('omega')],
    description:
      'The five neuroticism items N1–N5 of the 25 personality items in psych’s bfi (2800 people, SAPA project), all keyed in the same direction (?bfi’s bfi.keys). The help page scores them with scoreItems, which prints α = 0.81 (from pairwise correlations); the card runs alpha() on the 2694 complete cases (α = 0.813, standardised 0.814), with ω total of one factor (0.818) and the greatest lower bound (0.848). Opens its card on the Analyses tab.',
    shows:
      'α = 0.813 (standardised 0.814) for the five neuroticism items on 2694 complete cases, close to ?bfi’s 0.81 from pairwise correlations; ω total 0.818 and the greatest lower bound 0.848 sit above it. In the item table no item would raise α if dropped: every “α if dropped” is below 0.813.',
    data: { package: 'psych', name: 'bfi' },
    constructs: [],
    paths: [],
    panel: { kind: 'reliability', type: 'scale', vars: ['N1', 'N2', 'N3', 'N4', 'N5'] },
    settings: CB('ML'),
  },
  {
    id: 'irr-fleiss-diagnoses',
    package: 'irr',
    title: 'Fleiss’ kappa: six psychiatrists’ diagnoses',
    source: 'irr, ?kappam.fleiss, ?diagnoses (Fleiss 1971)',
    links: [
      IRR('kappam.fleiss'),
      IRR('diagnoses'),
      {
        label: 'Fleiss (1971), Psychological Bulletin 76(5)',
        url: 'https://doi.org/10.1037/h0031619',
      },
    ],
    description:
      'Fleiss’s (1971) data, shipped with irr as diagnoses: 30 patients, each diagnosed by six psychiatrists into ' +
      'five categories (depression, personality disorder, schizophrenia, neurosis, other). The help page’s ' +
      'kappam.fleiss(diagnoses) gives κ = 0.430 (z = 17.65), kappam.fleiss(diagnoses, exact = TRUE) Conger’s exact ' +
      'κ = 0.442, and detail = TRUE the kappa of each category. Opens its card on the Analyses tab.',
    shows:
      'Fleiss’ κ = 0.430 for the six psychiatrists: moderate agreement, well above chance (z = 17.65). Conger’s exact ' +
      'κ is a little higher, 0.442. By category, the psychiatrists agree best on “other” (0.566) and schizophrenia ' +
      '(0.520) and least on depression and personality disorder (0.245 each).',
    data: { package: 'irr', name: 'diagnoses' },
    constructs: [],
    paths: [],
    panel: {
      kind: 'reliability',
      type: 'fleiss',
      vars: ['rater1', 'rater2', 'rater3', 'rater4', 'rater5', 'rater6'],
    },
    settings: CB('ML'),
  },
  {
    id: 'irr-kripp-alpha',
    package: 'irr',
    title: 'Krippendorff’s alpha: four coders with missing values',
    source: 'irr, ?kripp.alpha (Krippendorff 2011)',
    links: [
      IRR('kripp.alpha'),
      {
        label: 'Krippendorff (2011), Computing Krippendorff’s alpha-reliability',
        url: 'https://repository.upenn.edu/asc_papers/43/',
      },
    ],
    description:
      'Krippendorff’s example on the help page (the matrix nmm): four coders assign 12 units to five values, with ' +
      'some units left uncoded by some coders. One row per unit here, one column per coder. The help page’s ' +
      'kripp.alpha(nmm, "ordinal") gives α = 0.815 (nominal 0.743, interval 0.849, ratio 0.797, the values ' +
      'Krippendorff reports). The card adds a bootstrap interval over the units (1000 samples, seed 1). ' +
      'Opens its card on the Analyses tab.',
    shows:
      'Ordinal α = 0.815 over 40 pairable values: above .800, Krippendorff’s bar for reliable data, but with 12 units ' +
      'the bootstrap interval runs from 0.48 to 1 and 45% of the bootstrap alphas fall below .800 (16% below .667). ' +
      'Switch the level of measurement to see 0.743 (nominal), 0.849 (interval) and 0.797 (ratio).',
    data: {
      package: 'irr',
      name: 'Krippendorff’s coders (?kripp.alpha)',
      file: 'examples/tests/krippendorff.csv',
    },
    constructs: [],
    paths: [],
    panel: {
      kind: 'reliability',
      type: 'kripp',
      vars: ['coder1', 'coder2', 'coder3', 'coder4'],
      krippLevel: 'ordinal',
    },
    settings: { ...CB('ML'), seed: 1 },
  },
  {
    id: 'irr-kendall-anxiety',
    package: 'irr',
    title: 'Kendall’s W: three raters’ anxiety ratings',
    source: 'irr, ?kendall, ?anxiety',
    links: [IRR('kendall'), IRR('anxiety')],
    description:
      'irr’s anxiety: 20 subjects whose anxiety three raters scored from 1 to 6. The help page’s ' +
      'kendall(anxiety, TRUE) gives the tie-corrected Wt = 0.54, χ²(19) = 30.8, p = 0.0429; the card shows W without ' +
      'the correction too (0.502, p = 0.072). Opens its card on the Analyses tab.',
    shows:
      'With the correction for ties (the ratings use six values for 20 subjects, so ties are many) Wt = 0.540, ' +
      'χ²(19) = 30.8, p = 0.043: the raters order the subjects somewhat alike. Without the correction W = 0.502 and ' +
      'p = 0.072, which is why the corrected value is the one to report here.',
    data: { package: 'irr', name: 'anxiety' },
    constructs: [],
    paths: [],
    panel: { kind: 'reliability', type: 'kendallw', vars: ['rater1', 'rater2', 'rater3'] },
    settings: CB('ML'),
  },
  {
    id: 'irrcac-gwet-raw4raters',
    package: 'irrCAC',
    title: 'Gwet’s AC1: four raters with missing ratings',
    source: 'irrCAC, ?gwet.ac1.raw, ?cac.raw4raters (Gwet 2014)',
    links: [
      { label: 'irrCAC, ?gwet.ac1.raw', url: 'https://rdrr.io/cran/irrCAC/man/gwet.ac1.raw.html' },
      {
        label: 'irrCAC, ?cac.raw4raters',
        url: 'https://rdrr.io/cran/irrCAC/man/cac.raw4raters.html',
      },
      {
        label: 'Gwet (2008), British Journal of Mathematical and Statistical Psychology 61',
        url: 'https://doi.org/10.1348/000711006X126600',
      },
    ],
    description:
      'irrCAC’s cac.raw4raters, from Gwet’s Handbook of Inter-Rater Reliability (2014, p. 120): four raters put 12 ' +
      'subjects into five categories, and none of them rated every subject. The help page’s ' +
      'gwet.ac1.raw(cac.raw4raters)$est gives AC1 = 0.77544 (SE 0.14295, interval 0.461 to 1); with ' +
      'weights = "quadratic" AC2 = 0.914. Opens its card on the Analyses tab.',
    shows:
      'AC1 = 0.775 with a standard error of 0.143 from 41 ratings: the raters agree on 82% of their pairs of ' +
      'ratings, against 19% expected by chance. Choose quadratic weights to treat the categories as ordered: ' +
      'AC2 = 0.914, as the help page shows.',
    data: { package: 'irrCAC', name: 'cac.raw4raters' },
    constructs: [],
    paths: [],
    panel: {
      kind: 'reliability',
      type: 'gwet',
      vars: ['Rater1', 'Rater2', 'Rater3', 'Rater4'],
    },
    settings: CB('ML'),
  },
  {
    id: 'bayesrel-asrm',
    package: 'Bayesrel',
    title: 'Bayesian scale reliability: the Altman Self-Rating Mania scale',
    source: 'Bayesrel, ?strel, ?asrm (Nicolai & Moshagen 2018)',
    links: [
      BAYESREL('strel'),
      BAYESREL('asrm'),
      {
        label: 'Pfadt et al. (2022), Multivariate Behavioral Research 57(4)',
        url: 'https://doi.org/10.1080/00273171.2021.1891855',
      },
    ],
    description:
      'The five items of the Altman Self-Rating Mania scale answered by 78 people (Bayesrel’s asrm, from Nicolai & ' +
      'Moshagen 2018). The help page runs strel(asrm, …) for the Bayesian reliability coefficients; the card does the same with ' +
      'Bayesrel’s defaults (3 chains of 1000 iterations, burn-in 50), seed 1, beside psych’s point estimates: posterior means ' +
      'α = 0.786 [0.714, 0.857], λ2 = 0.795 [0.723, 0.857] and ω = 0.774 [0.696, 0.852] (95% credible intervals). ' +
      'Opens its card on the Analyses tab.',
    shows:
      'Posterior means α = 0.786, λ2 = 0.795 and ω = 0.774 with 95% credible intervals about ±0.07 wide: with 78 people the ' +
      'reliability is known only to within about .15. λ2 sits a little above α, as it must (λ2 ≥ α).',
    data: { package: 'Bayesrel', name: 'asrm' },
    constructs: [],
    paths: [],
    panel: {
      kind: 'reliability',
      type: 'scale',
      vars: ['asrm_1', 'asrm_2', 'asrm_3', 'asrm_4', 'asrm_5'],
      bayes: true,
    },
    settings: { ...CB('ML'), seed: 1 },
  },
  {
    id: 'psych-kappa-cohen',
    package: 'psych',
    title: 'Cohen’s kappa of an agreement table: Cohen’s weighted κ',
    source: 'psych, ?cohen.kappa (Cohen 1968)',
    links: COHEN_LINKS,
    description:
      'Cohen’s (1968) example: the proportions of 200 subjects that two raters placed in three categories, one row per cell of the table. With Cohen’s disagreement weights (0, 1, 3 / 1, 0, 6 / 3, 6, 0) the help page’s cohen.kappa(cohen, cohen.weights, n.obs = 200) gives κ = 0.492 and weighted κ = 0.348, the values Cohen reports. (The card takes the disagreement weights as the agreement weights 1 − w/6: the same weighted κ, with psych’s standard error for agreement weights; psych’s own interval for disagreement weights runs past 1.) Opens its card on the Analyses tab.',
    shows:
      'κ = 0.492 and weighted κ = 0.348, the values Cohen reports: weighting the disagreements by severity lowers the agreement here. The intervals (κ [0.39, 0.59], weighted κ [0.20, 0.50]) are psych’s for 200 subjects, with the weights entered as agreement weights so the weighted interval stays inside [0, 1].',
    data: COHEN,
    constructs: [],
    paths: [],
    panel: {
      kind: 'reliability',
      type: 'kappa',
      vars: [],
      kappaTable: { rows: 'rater1', columns: 'rater2', counts: 'proportion', nObs: 200 },
      kappaWeights: 'custom',
      weightMatrix: [
        [0, 1, 3],
        [1, 0, 6],
        [3, 6, 0],
      ],
    },
    settings: CB('ML'),
  },
  {
    id: 'psych-kappa-cohen-nonsymmetric',
    package: 'psych',
    title: 'Cohen’s kappa of an agreement table: non-symmetric weights',
    source: 'psych, ?cohen.kappa (Cohen 1968)',
    links: COHEN_LINKS,
    description:
      'The same table of 200 subjects with the help page’s non-symmetric weights (0, 1, 4 / 1, 0, 6 / 2, 2, 0: a disagreement costs more one way than the other), cohen.kappa(cohen, wc): weighted κ = 0.353, as Cohen reports, and κ = 0.492. The help page leaves out n.obs, so psych takes the proportions as one subject; the card gives the 200 subjects, which changes only the intervals. Opens its card on the Analyses tab.',
    shows:
      'Weighted κ = 0.353 with the non-symmetric weights, against 0.348 with Cohen’s symmetric ones; the unweighted κ = 0.492 does not change, since the weights only enter the weighted statistic. The interval [0.19, 0.52] uses the 200 subjects, which the help page’s call leaves out.',
    data: COHEN,
    constructs: [],
    paths: [],
    panel: {
      kind: 'reliability',
      type: 'kappa',
      vars: [],
      kappaTable: { rows: 'rater1', columns: 'rater2', counts: 'proportion', nObs: 200 },
      kappaWeights: 'custom',
      weightMatrix: [
        [0, 1, 4],
        [1, 0, 6],
        [2, 2, 0],
      ],
    },
    settings: CB('ML'),
  },
  {
    id: 'psych-icc-shroutfleiss',
    package: 'psych',
    title: 'Intraclass correlations: four judges rate six targets',
    source: 'psych, ?ICC (Shrout & Fleiss 1979)',
    links: [
      PSYCH('ICC'),
      {
        label: 'Shrout & Fleiss (1979), Psychological Bulletin 86(2)',
        url: 'https://doi.org/10.1037/0033-2909.86.2.420',
      },
    ],
    description:
      'Shrout & Fleiss’s example: four judges (J1–J4) rate six targets, one row per target. The help page’s ICC(sf, lmer = FALSE) gives the six intraclass correlations, as Shrout & Fleiss’s table 4 does: ICC(1,1) = 0.17, ICC(2,1) = 0.29, ICC(3,1) = 0.71, ICC(1,4) = 0.44, ICC(2,4) = 0.62, ICC(3,4) = 0.91. Opens its card on the Analyses tab.',
    shows:
      'The six intraclass correlations of Shrout & Fleiss’s table 4 in one table: a single rating ICC(1,1) = 0.17, ICC(2,1) = 0.29, ICC(3,1) = 0.71; the mean of four judges ICC(1,4) = 0.44, ICC(2,4) = 0.62, ICC(3,4) = 0.91. The spread shows how much the definition matters: whether judges are random or fixed, and whether one rating or the mean of four is the unit.',
    data: {
      package: 'psych',
      name: 'sf (?ICC, Shrout & Fleiss 1979)',
      file: 'examples/tests/shroutfleiss.csv',
    },
    constructs: [],
    paths: [],
    panel: { kind: 'reliability', type: 'icc', vars: ['J1', 'J2', 'J3', 'J4'] },
    settings: CB('ML'),
  },
];
