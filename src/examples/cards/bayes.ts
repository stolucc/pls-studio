// Examples that open a card: Bayesian basic statistics (BayesFactor). Each follows an R package's help page or a textbook, with
// the numbers it prints checked in cards/bayes.webr.test.ts.

import type { BAnovaOptions, BBinomialOptions, BContingencyOptions, BRegressionOptions, BRmAnovaOptions, BTTestOptions } from '../../analyses/bayes';
import { CB } from '../define';
import type { PackageExample } from '../packages';

const MANUAL = 'https://cran.r-project.org/web/packages/BayesFactor/vignettes/manual.html';
const help = (topic: string) => ({ label: `?${topic}`, url: `https://rdrr.io/cran/BayesFactor/man/${topic}.html` });
const manual = (section: string, anchor: string) => ({ label: `BayesFactor manual: ${section}`, url: `${MANUAL}#${anchor}` });
const SLEEP_LINK = { label: '?sleep', url: 'https://rdrr.io/r/datasets/sleep.html' };
const TOOTH_LINK = { label: '?ToothGrowth', url: 'https://rdrr.io/r/datasets/ToothGrowth.html' };
/**
 * Student’s sleep data is long (extra, group, ID: the ten patients under drug 1, then the same ten under drug 2). The
 * paired designs need one column per drug: drug1 is extra ten rows earlier (rows 11–20), drug2 is extra in those rows
 * (missing where drug1 is, so rows 1–10 drop out and the ten patients remain).
 */
const SLEEP_WIDE = [{ name: 'drug1', expr: 'lag(extra, 10)' }, { name: 'drug2', expr: 'extra + 0 * drug1' }];
const T: Omit<BTTestOptions, 'type'> = { vars: [], pairs: [], group: '', testValue: 0, alternative: 'two.sided', priorWidth: Math.SQRT1_2, iterations: 10000, robustness: false, sequential: false };
const bt = (o: Partial<BTTestOptions> & Pick<BTTestOptions, 'type'>): { kind: 'bttest' } & BTTestOptions => ({ kind: 'bttest', ...T, ...o });
const ba = (o: Pick<BAnovaOptions, 'dependent' | 'factors' | 'covariates'> & Partial<BAnovaOptions>): { kind: 'banova' } & BAnovaOptions =>
  ({ kind: 'banova', interactions: true, priorFixed: 0.5, priorCovariates: Math.SQRT2 / 4, iterations: 10000, ...o });

export const CARD_BAYES: PackageExample[] = [
  {
    id: 'bayesfactor-sleep-paired', package: 'BayesFactor', title: 'Bayesian paired t-test: Student’s sleep data', source: 'BayesFactor, ?ttestBF',
    links: [help('ttestBF'), manual('one-sample tests (and paired)', 'onesample'), SLEEP_LINK],
    description: 'Extra hours of sleep of ten patients under two soporific drugs (Student 1908), the help page’s paired test with the default Cauchy prior r = √2/2: BF₁₀ = 17.3, strong evidence that the drugs differ. The sleep data is long, so drug1 and drug2 are computed columns (drug1 = extra ten rows earlier). Opens its card on the Analyses tab.',
    shows: 'BF₁₀ = 17.3 for the paired test: the data are about 17 times more likely under a difference between the drugs than under none, strong evidence by the usual labels. The frequentist paired t-test example gives p = 0.0028 on the same ten patients; here the prior width r = √2/2 is part of the answer.',
    data: { package: 'datasets', name: 'sleep' }, constructs: [], paths: [], computed: SLEEP_WIDE,
    panel: bt({ type: 'paired', pairs: [['drug1', 'drug2']] }), settings: CB('ML'),
  },
  {
    id: 'bayesfactor-sleep-onesided', package: 'BayesFactor', title: 'Bayesian one-sample t-test, one-sided: sleep difference scores', source: 'BayesFactor manual, one-sample tests',
    links: [manual('one-sample tests (and paired)', 'onesample'), help('ttestBF'), SLEEP_LINK],
    description: 'The manual’s difference scores of the sleep data (drug 1 minus drug 2, a computed column) against zero, with H1 restricted to negative effects (nullInterval = c(-Inf, 0)): BF₋₀ = 34.4, against 17.3 for the two-sided test. Opens its card on the Analyses tab.',
    shows: 'Restricting H1 to a negative difference raises the Bayes factor from 17.3 (two-sided) to BF₋₀ = 34.4: a directional hypothesis the data support is rewarded about twofold. The card’s alternative is set to “less”; the two-sided value is the paired example’s.',
    data: { package: 'datasets', name: 'sleep' }, constructs: [], paths: [], computed: [{ name: 'diff', expr: 'lag(extra, 10) - extra' }],
    panel: bt({ type: 'one', vars: ['diff'], alternative: 'less' }), settings: CB('ML'),
  },
  {
    id: 'bayesfactor-chickwts', package: 'BayesFactor', title: 'Bayesian independent-samples t-test: chick weights on two feeds', source: 'BayesFactor manual, two-sample test',
    links: [manual('two-sample test (independent groups)', 'twosample'), help('ttestBF'), { label: '?chickwts', url: 'https://rdrr.io/r/datasets/chickwts.html' }],
    description: 'Weights of chicks fed horsebean (10) or linseed (12), the manual’s two groups of chickwts: BF₁₀ = 5.98, moderate evidence for a difference. The card compares two groups and cannot leave out the other four feeds, so those 22 chicks are shipped as they are in chickwts. Opens its card on the Analyses tab.',
    shows: 'BF₁₀ = 5.98 for horsebean against linseed: moderate evidence that the two feeds differ in chick weight, the value the BayesFactor manual prints. Only the two groups (22 chicks) are loaded, so the card’s group row names horsebean and linseed and nothing else.',
    data: { package: 'datasets', name: 'chickwts', file: 'examples/bayes/chickwts-horsebean-linseed.csv' }, constructs: [], paths: [],
    panel: bt({ type: 'independent', vars: ['weight'], group: 'feed' }), settings: CB('ML'),
  },
  {
    id: 'bayesfactor-toothgrowth', package: 'BayesFactor', title: 'Bayesian two-way ANOVA: tooth growth by supplement and dose', source: 'BayesFactor manual, fixed-effects ANOVA',
    links: [manual('fixed-effects ANOVA', 'fixed'), help('anovaBF'), TOOTH_LINK],
    description: 'Odontoblast length of 60 guinea pigs by supplement (orange juice or ascorbic acid) and dose (0.5, 1 or 2 mg, as a factor), the manual’s anovaBF(len ~ supp*dose). Against the intercept-only model: supp 1.2, dose 4.98 × 10¹², supp + dose 2.92 × 10¹⁴, with the interaction 7.44 × 10¹⁴, so the interaction is favoured about 2.5 to 1. Monte Carlo estimates (±1–2%) with the project’s seed. Opens its card on the Analyses tab.',
    shows: 'The model table against the intercept-only model: supp 1.2, dose 4.98 × 10¹², supp + dose 2.92 × 10¹⁴, with the interaction 7.44 × 10¹⁴. Dose is decisive, supplement alone barely matters, and the interaction is favoured about 2.5 to 1 over the main effects, a modest preference. The two larger models are Monte Carlo estimates, so their last digits move with the seed.',
    data: { package: 'datasets', name: 'ToothGrowth' }, constructs: [], paths: [],
    panel: ba({ dependent: 'len', factors: ['supp', 'dose'], covariates: [] }), settings: CB('ML'),
  },
  {
    id: 'bayesfactor-toothgrowth-ancova', package: 'BayesFactor', title: 'Bayesian ANCOVA: tooth growth by supplement and log dose', source: 'BayesFactor manual, regression and ANOVA',
    links: [manual('fixed-effects ANOVA', 'fixed'), help('lmBF'), TOOTH_LINK],
    description: 'The manual’s second ToothGrowth analysis: dose as a continuous log₂ dose (a computed column) beside the supplement factor, with lmBF’s default priors (r = 0.5 for the factor, √2/4 for the covariate), and, as the manual, the supp × log₂ dose interaction (the card’s interactions with the covariates: the dose’s slope may differ by supplement). Against the intercept-only model: supp + log dose + supp × log dose 1.58 × 10¹⁵, supp + log dose 1.49 × 10¹⁵, log dose 2.77 × 10¹³, supp 1.2. Opens its card on the Analyses tab.',
    shows: 'With dose as log₂ dose the model table reads supp + log dose + supp × log dose 1.58 × 10¹⁵ against supp + log dose 1.49 × 10¹⁵: the interaction (a dose slope that differs by supplement) is barely preferred. Log dose alone (2.77 × 10¹³) is far stronger than supp alone (1.2), as in the factor version of the previous example.',
    data: { package: 'datasets', name: 'ToothGrowth' }, constructs: [], paths: [], computed: [{ name: 'log2dose', expr: 'log2(dose)' }],
    panel: ba({ dependent: 'len', factors: ['supp'], covariates: ['log2dose'], covariateInteractions: true }), settings: CB('ML'),
  },
  {
    id: 'bayesfactor-sleep-rm', package: 'BayesFactor', title: 'Bayesian repeated-measures ANOVA: Student’s sleep data', source: 'BayesFactor, ?anovaBF',
    links: [help('anovaBF'), manual('mixed models (including repeated measures)', 'mixed'), SLEEP_LINK],
    description: 'The help page’s first example: the two drugs as a within-subject factor and the patients as a random effect, anovaBF(extra ~ group + ID, whichRandom = "ID"). The help page gives a Bayes factor of about 11.6 against the patients-only model (Monte Carlo, ±1%). drug1 and drug2 are computed columns of the long data. Opens its card on the Analyses tab.',
    shows: 'BF₁₀ ≈ 11.6 for the drug against the patients-only model, the help page’s “about 11.6”: strong evidence that the drugs differ, the ANOVA counterpart of the paired t-test’s 17.3 under the ANOVA’s own prior scale. A Monte Carlo estimate (±1%), so the last digit varies with the seed.',
    data: { package: 'datasets', name: 'sleep' }, constructs: [], paths: [], computed: SLEEP_WIDE,
    panel: { kind: 'brmanova', levels: ['drug1', 'drug2'], factorName: 'drug', between: '', priorFixed: 0.5, priorRandom: 1, iterations: 10000 } satisfies { kind: 'brmanova' } & BRmAnovaOptions,
    settings: CB('ML'),
  },
  {
    id: 'bayesfactor-puzzles-rm', package: 'BayesFactor', title: 'Bayesian repeated-measures ANOVA, two within-subject factors: puzzles', source: 'BayesFactor, ?anovaBF; BayesFactor manual, mixed models (?puzzles)',
    links: [manual('mixed models (including repeated measures)', 'mixed'), help('anovaBF'), help('puzzles')],
    description: 'Twelve participants each completed puzzles of every combination of shape (round, square) and color (color, monochromatic), a 2 × 2 within-subject design; RT is the time to complete a puzzle. The package’s long data are shipped wide, one column per cell, and the card defines the two factors and assigns a column to each cell. The manual’s anovaBF(RT ~ shape*color + ID, whichRandom = "ID"), against the participants-only model: shape 2.81, color 2.81, shape + color 11.9, with the interaction 4.23, so the main-effects model is preferred. Monte Carlo estimates (±1–3%) with the project’s seed. Opens its card on the Analyses tab.',
    shows: 'Against the participants-only model: shape 2.81, color 2.81, shape + color 11.9, and the full model with the interaction 4.23. The two main effects together are preferred to the interaction model about 3 to 1, so the shape and color effects add up rather than interact. Monte Carlo estimates (±1–3%).',
    data: { package: 'BayesFactor', name: 'puzzles', file: 'examples/bayes/puzzles.csv' }, constructs: [], paths: [],
    panel: { kind: 'brmanova', levels: [], factorName: 'shape', between: '', priorFixed: 0.5, priorRandom: 1, iterations: 10000,
      factors: [{ name: 'shape', levels: ['round', 'square'] }, { name: 'color', levels: ['color', 'monochromatic'] }], cells: ['round.color', 'round.mono', 'square.color', 'square.mono'] } satisfies { kind: 'brmanova' } & BRmAnovaOptions,
    settings: CB('ML'),
  },
  {
    id: 'bayesfactor-attitude', package: 'BayesFactor', title: 'Bayesian linear regression: all subsets of six predictors', source: 'BayesFactor, ?regressionBF',
    links: [help('regressionBF'), manual('linear regression', 'regression'), { label: '?attitude', url: 'https://rdrr.io/r/datasets/attitude.html' }],
    description: 'Ratings of 30 departments of a large financial organisation (Chatterjee & Price 1977): the overall rating on six aspects of supervision, regressionBF(rating ~ ., data = attitude), all 63 models against the intercept-only model. The best is complaints alone (BF₁₀ = 417,939), then complaints + learning (207,272). Uniform model prior, as in BayesFactor. Opens its card on the Analyses tab.',
    shows: 'All 63 models of the six predictors, ranked: complaints alone is best (BF₁₀ = 417,939 against the intercept-only model), complaints + learning second (207,272), about half as likely. Rating is explained by how complaints are handled; every predictor added to complaints lowers the Bayes factor, the penalty for complexity at work.',
    data: { package: 'datasets', name: 'attitude' }, constructs: [], paths: [],
    panel: { kind: 'bregression', outcome: 'rating', predictors: ['complaints', 'privileges', 'learning', 'raises', 'critical', 'advance'], priorWidth: Math.SQRT2 / 4, modelPrior: 'uniform', iterations: 10000 } satisfies { kind: 'bregression' } & BRegressionOptions,
    settings: CB('ML'),
  },
  {
    id: 'bayesfactor-racedolls', package: 'BayesFactor', title: 'Bayesian contingency table: children’s doll preference', source: 'BayesFactor, ?contingencyTableBF (Hraba & Grant 1970)',
    links: [help('contingencyTableBF'), help('raceDolls'), manual('contingency tables', 'ctables')],
    description: 'Which doll 160 children chose (same race or different race), by the child’s race (Hraba & Grant 1970). The help page takes the columns (the children’s race) as fixed, independent multinomial sampling: BF₁₀ = 1.81, anecdotal evidence against independence. The package’s 2 × 2 matrix is shipped as its four cells with a count column. Opens its card on the Analyses tab.',
    shows: 'BF₁₀ = 1.81 with the children’s race fixed (independent multinomial sampling): only anecdotal evidence that doll choice depends on the child’s race, from a 2 × 2 table of 160 children (cells 50, 48 / 21, 41). The sampling plan is an option on the card and changes the Bayes factor.',
    data: { package: 'BayesFactor', name: 'raceDolls', file: 'examples/bayes/raceDolls.csv' }, constructs: [], paths: [],
    labels: { doll: ['Same-race doll', 'Different-race doll'], child: ['White child', 'Black child'] },
    panel: { kind: 'bcontingency', rows: 'doll', columns: 'child', counts: 'count', sampling: 'indepCols', priorConcentration: 1 } satisfies { kind: 'bcontingency' } & BContingencyOptions,
    settings: CB('ML'),
  },
  {
    id: 'stats-peas-binomial', package: 'stats', title: 'Bayesian binomial test: a 3 : 1 Mendelian ratio', source: 'stats, ?binom.test (Conover 1971); BayesFactor manual, tests of single proportions',
    links: [{ label: '?binom.test', url: 'https://rdrr.io/r/stats/binom.test.html' }, manual('tests of single proportions', 'proptest')],
    description: 'A cross of two genotypes gave 682 giant and 243 dwarf plants; simple Mendelian inheritance predicts 3/4 giant (Conover 1971, the binom.test help page: p = 0.38). With a uniform beta(1, 1) prior the Bayes factor of giant against p = 0.75 is BF₁₀ = 0.054 (BF₀₁ = 18.6): strong evidence for the 3 : 1 ratio. (BayesFactor’s manual tests the same counts with proportionBF, whose logistic prior on the log odds gives 7.27 instead.) The counts are shipped as 925 rows; read the giant row (dwarf is tested against 0.75 too). Opens its card on the Analyses tab.',
    shows: 'A Bayes factor in favour of the null: BF₁₀ = 0.054 for the giant row, i.e. BF₀₁ = 18.6, strong evidence that the proportion is 3/4, where the frequentist test could only fail to reject (p = 0.38). The dwarf row tests 243 of 925 against 0.75 as well and is overwhelmingly against it; that is not the question.',
    data: { package: 'stats', name: 'Conover (1971) peas', file: 'examples/bayes/peas.csv' }, constructs: [], paths: [], labels: { plant: ['giant', 'dwarf'] },
    panel: { kind: 'bbinomial', variable: 'plant', testValue: 0.75, alternative: 'two.sided', priorA: 1, priorB: 1 } satisfies { kind: 'bbinomial' } & BBinomialOptions,
    settings: CB('ML'),
  },
  {
    id: 'bayesfactor-peas-proportion', package: 'BayesFactor', title: 'Bayesian test of a proportion, logistic prior: a 3 : 1 Mendelian ratio', source: 'BayesFactor manual, tests of single proportions (?binom.test, Conover 1971)',
    links: [manual('tests of single proportions', 'proptest'), help('proportionBF'), { label: '?binom.test', url: 'https://rdrr.io/r/stats/binom.test.html' }],
    description: 'The manual’s test of ?binom.test’s cross: 682 giant and 243 dwarf plants against the 3/4 of simple Mendelian inheritance, with proportionBF’s prior: under H1 the log odds are logistic around the log odds of 0.75, scale r = 0.5. The manual prints 1 / proportionBF(682, 682 + 243, p = 3/4) = 7.27, i.e. BF₀₁ = 7.27 in favour of the 3 : 1 ratio (BF₁₀ = 0.138). The card is set to the logistic prior; read the giant row. Opens its card on the Analyses tab.',
    shows: 'The same counts with proportionBF’s logistic prior on the log odds: BF₀₁ = 7.27 (BF₁₀ = 0.138) for the 3 : 1 ratio, against 18.6 under the uniform beta(1, 1) prior of the previous example. The evidence for the null depends on how wide H1 is allowed to be: the prior is part of the hypothesis.',
    data: { package: 'stats', name: 'Conover (1971) peas', file: 'examples/bayes/peas.csv' }, constructs: [], paths: [], labels: { plant: ['giant', 'dwarf'] },
    panel: { kind: 'bbinomial', variable: 'plant', testValue: 0.75, alternative: 'two.sided', priorA: 1, priorB: 1, prior: 'logistic', priorScale: 0.5, iterations: 10000 } satisfies { kind: 'bbinomial' } & BBinomialOptions,
    settings: CB('ML'),
  },
  {
    id: 'bayesfactor-proportion', package: 'BayesFactor', title: 'Bayesian test of a proportion: 15 successes in 25 trials', source: 'BayesFactor, ?proportionBF',
    links: [help('proportionBF'), manual('tests of single proportions', 'proptest')],
    description: 'The help page’s example, proportionBF(y = 15, N = 25, p = .5): 15 successes in 25 trials against a proportion of one half, logistic prior on the log odds with BayesFactor’s default scale r = 0.5. BF₁₀ = 0.660 (BF₀₁ = 1.52): anecdotal evidence for p = 0.5. The trials are shipped as 25 rows (1 = success); read the success row, and the posterior median of the proportion beside it. Opens its card on the Analyses tab.',
    shows: 'BF₁₀ = 0.660 (BF₀₁ = 1.52) for 15 successes in 25 trials against one half: anecdotal evidence for p = 0.5, close to no evidence either way. The posterior median of the proportion sits beside the Bayes factor; the failure row (10 of 25 against 0.5) gives the same Bayes factor by symmetry.',
    data: { package: 'BayesFactor', name: '15 of 25 (?proportionBF)', file: 'examples/bayes/proportion-15-of-25.csv' }, constructs: [], paths: [], labels: { outcome: ['success', 'failure'] },
    panel: { kind: 'bbinomial', variable: 'outcome', testValue: 0.5, alternative: 'two.sided', priorA: 1, priorB: 1, prior: 'logistic', priorScale: 0.5, iterations: 10000 } satisfies { kind: 'bbinomial' } & BBinomialOptions,
    settings: CB('ML'),
  },
];
