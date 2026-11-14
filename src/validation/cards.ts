// The correctness evidence of every analysis: each card on the Analyses tab (ANALYSIS_TYPES), each statistically
// distinct mode of a card (`card:mode`: a family, link, estimator or engine), the Model tab's analyses (`model:…`) and
// the built-in TypeScript engine (`builtin:…`). validation/cards.test.ts keeps it complete (every registered card and
// every mode in the cards' own option lists) and its references real; the Validation page lists it ("Analyses").
//
// Evidence is named, not typed in: examples graded against a reference (record.ts against()), validated test files
// (features.ts: their checks in public/validation.json), or plain unit tests against a reference.

/** `key::text`: the checks of a FEATURES test file whose test names contain `text`. */
export type FeatureRef = string;

export interface CardEvidence {
  /** Modes and Model-tab / built-in entries: what they are (a card's own title comes from the registry). */
  title?: string;
  /** Example ids graded against a published or native reference. */
  examples?: string[];
  /** Validated test files (FEATURES keys), optionally narrowed to tests: `rengine/tests::Bland`. */
  features?: FeatureRef[];
  /** Plain unit tests against a reference that are not in the validation record (path from the repository root). */
  unit?: { file: string; reference: string }[];
  /** Computes no statistics: why. */
  none?: string;
  /** A gap: no correctness test yet, and the reference planned for one. */
  todo?: string;
  /** What the evidence covers, or leaves out. */
  note?: string;
}

/** `modes`: a card whose evidence is that of its modes. */
export type EvidenceClass = 'examples' | 'features' | 'unit' | 'modes' | 'none' | 'todo';

const ex = (...examples: string[]): CardEvidence => ({ examples });
const ft = (...features: FeatureRef[]): CardEvidence => ({ features });

export const CARD_EVIDENCE: Record<string, CardEvidence> = {
  // ---- Cards with no statistics of their own.
  run: { none: 'Runs the Model tab’s estimation (its evidence is under model:…) and logs it.' },
  snapshot: { none: 'A frozen copy of a model run’s results.' },
  methodstext: { none: 'Writes the methods section from the settings: text, no statistics.' },
  checklist: { none: 'A reviewer checklist of what the report contains: text, no statistics.' },

  // ---- Analyses tab.
  methodcompare: {
    examples: ['compare-pls-cb'],
    note: 'PLS column against seminr, CB column against lavaan’s standardised solution (scripts/validation/method_compare.R).',
  },
  parcelallocation: {
    features: ['engine/parcels'],
    note: 'Fit against plain lavaan on the parcels, the spread over allocations against semTools::parcelAllocation (scripts/validation/parcels.R).',
  },
  screen: ft('rengine/screen::distributions', 'analyses/cards'),
  explore: {
    examples: ['nortest-toothgrowth'],
    features: ['rengine/explore', 'analyses/charts::density and Q-Q'],
    note: 'Descriptives against psych::describe(type = 2), quantile(type = 7 and 6), shapiro.test, nortest and table() (scripts/validation/explore.R); the density and Q-Q plots against bw.nrd0, the exact Gaussian kernel estimate, qqnorm and qqline (scripts/validation/charts.R).',
  },
  missingdata: { examples: ['mplus-ex11.2', 'misty-airquality-mcar'] },
  chart: {},
  'chart:histogram': {
    title: 'Histogram (bins and counts)',
    examples: ['datasets-faithful-chart'],
  },
  'chart:scatter': {
    title: 'Scatterplot with the least-squares line',
    examples: ['datasets-faithful-scatter'],
  },
  'chart:box': {
    title: 'Box plot (quartiles, whiskers, outliers)',
    features: ['analyses/charts::box'],
    note: 'Against R’s quantile(type = 7) and boxplot.stats (scripts/validation/charts.R).',
  },
  'chart:bar': {
    title: 'Bar chart (counts per category)',
    features: ['analyses/charts::bar'],
    note: 'Against R’s table() (scripts/validation/charts.R).',
  },
  influence: {
    features: ['rengine/screen::case influence'],
    note: 'Exact (refits) and approximate (influence_stat) case influence against semfindr.',
  },
  ttest: {},
  'ttest:independent': {
    title: 'Independent samples (Student, Welch, Mann–Whitney)',
    examples: ['stats-ttest-mtcars', 'effectsize-mtcars', 'toster-sleep'],
    features: ['rengine/tests::independent samples', 'rengine/effects::independent samples'],
    note: 'Effect sizes against effectsize, equivalence tests against TOSTER’s t_TOST (scripts/validation/effects.R).',
  },
  'ttest:paired': {
    title: 'Paired samples (and Wilcoxon signed rank)',
    examples: ['stats-ttest-sleep-paired'],
    features: ['rengine/tests::paired samples', 'rengine/effects::paired samples'],
  },
  'ttest:one': {
    title: 'One sample against a test value',
    examples: ['stats-ttest-sleep-one'],
    features: ['rengine/tests::one sample', 'rengine/effects::one sample'],
  },
  'ttest:trimmed': {
    title: 'Trimmed means: Yuen’s tests, the one-sample trimmed-mean t-test (WRS2)',
    features: ['rengine/robust::robust and resampling t-tests'],
    note: 'Against WRS2::yuen and yuend; the one-sample test against Wilcox’s trimci formula with WRS2::winvar (scripts/validation/robust.R).',
  },
  'ttest:bootstrap': {
    title: 'Bootstrap intervals of the mean (difference), percentile and BCa (boot)',
    features: ['rengine/robust::robust and resampling t-tests'],
  },
  'ttest:permutation': {
    title: 'Permutation tests: two-sample and sign-flip (coin)',
    examples: ['coin-diffusion'],
    features: ['rengine/robust::robust and resampling t-tests'],
    note: 'Against coin with the same seed, and its Monte Carlo p-values against coin’s exact ones.',
  },
  anova: {
    examples: ['stats-anova-plantgrowth', 'stats-anova-warpbreaks', 'effectsize-mtcars-anova'],
    features: [
      'rengine/tests::two-way',
      'rengine/tests::one-way',
      'rengine/tests::ANCOVA',
      'rengine/effects::ANOVA',
      'rengine/nonparametric::Dunn',
    ],
    note: 'Dunn’s test after Kruskal–Wallis against dunn.test (scripts/validation/nonparametric.R).',
  },
  'anova:trimmed': {
    title: 'Robust one- and two-way ANOVA on trimmed means (WRS2 t1way, t2way)',
    examples: ['wrs2-viagra'],
    features: ['rengine/robust::robust and permutation ANOVA'],
  },
  'anova:permutation': {
    title: 'k-sample permutation test (coin::oneway_test)',
    features: ['rengine/robust::permutation'],
  },
  'anova:emmeans': {
    title: 'Estimated marginal means, post hoc tests, simple effects and contrasts (emmeans)',
    examples: ['emmeans-warpbreaks'],
    features: ['rengine/emm::marginal means after ANOVA'],
    note: 'Against emmeans on lm fits and emmeans::joint_tests (scripts/validation/emm.R).',
  },
  'anova:gameshowell': {
    title: 'Games–Howell comparisons',
    features: ['rengine/emm::Games–Howell'],
    note: 'Own formula against rstatix::games_howell_test (scripts/validation/emm.R).',
  },
  rmanova: {
    examples: ['stats-rmanova-rounding', 'cardata-rmanova-obrienkaiser'],
    features: ['rengine/tests::repeated measures', 'rengine/nonparametric::Conover'],
    note: 'Conover’s test after Friedman against PMCMRplus::frdAllPairsConoverTest (scripts/validation/nonparametric.R).',
  },
  'rmanova:emmeans': {
    title: 'Estimated marginal means of repeated measures (emmeans, multivariate model)',
    features: ['rengine/emm::marginal means after repeated measures'],
    note: 'Against afex::aov_car with emmeans, afex’s default multivariate model (scripts/validation/emm.R).',
  },
  manova: { examples: ['stats-manova-plastic'], features: ['rengine/tests::MANOVA'] },
  correlation: {},
  'correlation:bootstrap': {
    title: 'Bootstrap intervals of correlations, percentile and BCa (boot)',
    features: ['rengine/robust::bootstrap interval and permutation test of every pair'],
  },
  'correlation:permutation': {
    title: 'Permutation tests of Pearson and Spearman correlations (coin)',
    features: ['rengine/robust::bootstrap interval and permutation test of every pair'],
  },
  'correlation:pearson': {
    title: 'Pearson correlations',
    examples: ['stats-correlation-judges'],
    features: ['rengine/tests::correlations, every pair', 'rengine/effects::pearson'],
  },
  'correlation:spearman': {
    title: 'Spearman rank correlations',
    features: ['rengine/tests::correlations, every pair', 'rengine/effects::spearman'],
  },
  'correlation:kendall': {
    title: 'Kendall’s tau',
    examples: ['stats-correlation-tuna'],
    features: ['rengine/tests::correlations, every pair', 'rengine/effects::kendall'],
  },
  'correlation:polychoric': {
    title: 'Polychoric correlations',
    features: ['rengine/correlationPolychoric'],
  },
  contingency: {
    examples: ['stats-contingency-party', 'stats-contingency-job', 'stats-mcnemar-performance'],
    features: [
      'rengine/tests::contingency tables',
      'rengine/effects::Cramér',
      'rengine/nonparametric::McNemar',
      'rengine/nonparametric::Bowker',
    ],
  },
  freqtest: {},
  'freqtest:binomial': {
    title: 'Binomial test',
    examples: ['stats-binomial-mendel'],
    features: ['rengine/tests::binomial and multinomial'],
  },
  'freqtest:multinomial': {
    title: 'Multinomial goodness of fit',
    examples: ['stats-multinomial'],
    features: ['rengine/tests::binomial and multinomial'],
  },
  'freqtest:cochran': {
    title: 'Cochran’s Q with pairwise McNemar tests',
    features: ['rengine/nonparametric::Cochran'],
    note: 'Q against DescTools::CochranQTest; the pairs against mcnemar.test and binom.test (scripts/validation/nonparametric.R).',
  },
  reliability: {},
  'reliability:scale': {
    title: 'Scale reliability (alpha, omega, glb)',
    examples: ['psych-alpha-neuroticism'],
    features: ['rengine/tests::scale reliability', 'rengine/agreement::scale reliability'],
    note: 'The standard errors of measurement: rengine/agreement (scripts/validation/agreement.R).',
  },
  'reliability:icc': {
    title: 'Intraclass correlations',
    examples: ['psych-icc-shroutfleiss'],
    features: ['rengine/tests::intraclass', 'rengine/agreement::intraclass'],
  },
  'reliability:kappa': {
    title: 'Cohen’s kappa',
    examples: ['psych-kappa-cohen', 'psych-kappa-cohen-nonsymmetric'],
    features: ['rengine/tests::intraclass'],
  },
  'reliability:scale:bayes': {
    title: 'Bayesian scale reliability: α, λ2, ω, glb with credible intervals (Bayesrel)',
    examples: ['bayesrel-asrm'],
    features: ['rengine/tests::Bayesian with the glb'],
    note: 'Bayesrel::strel with the same seed (scripts/validation/bayesrel.R).',
  },
  'reliability:fleiss': {
    title: 'Fleiss’ kappa and Conger’s exact kappa (irr)',
    examples: ['irr-fleiss-diagnoses'],
    features: ['rengine/agreement::Fleiss'],
  },
  'reliability:kripp': {
    title: 'Krippendorff’s alpha with a bootstrap interval (irr)',
    examples: ['irr-kripp-alpha'],
    features: ['rengine/agreement::Krippendorff'],
    note: 'The bootstrap over the units against a loop written in desktop R with the same seed.',
  },
  'reliability:gwet': {
    title: 'Gwet’s AC1 / AC2 (irrCAC)',
    examples: ['irrcac-gwet-raw4raters'],
    features: ['rengine/agreement::Gwet'],
  },
  'reliability:kendallw': {
    title: 'Kendall’s W, with the correction for ties (irr)',
    examples: ['irr-kendall-anxiety'],
    features: ['rengine/agreement::Kendall'],
  },
  'reliability:blandaltman': {
    title: 'Bland–Altman limits of agreement',
    features: ['rengine/tests::Bland'],
  },
  bttest: {},
  'bttest:independent': {
    title: 'Bayesian independent-samples t-test',
    examples: ['bayesfactor-chickwts'],
    features: ['rengine/bayes::independent samples'],
  },
  'bttest:paired': {
    title: 'Bayesian paired-samples t-test',
    examples: ['bayesfactor-sleep-paired'],
    features: ['rengine/bayes::paired'],
  },
  'bttest:one': {
    title: 'Bayesian one-sample t-test',
    examples: ['bayesfactor-sleep-onesided'],
    features: ['rengine/bayes::one sample'],
  },
  banova: {
    examples: ['bayesfactor-toothgrowth', 'bayesfactor-toothgrowth-ancova'],
    features: ['rengine/bayes::ANOVA', 'rengine/bayes::ANCOVA'],
  },
  brmanova: {
    examples: ['bayesfactor-sleep-rm', 'bayesfactor-puzzles-rm'],
    features: ['rengine/bayes::repeated-measures'],
  },
  bregression: {
    examples: ['bayesfactor-attitude'],
    features: ['rengine/bayes::linear regression'],
  },
  bcorrelation: ft('rengine/bayes::Pearson correlations', 'rengine/bayes::correlationBF'),
  bcontingency: {
    examples: ['bayesfactor-racedolls'],
    features: ['rengine/bayes::contingency tables'],
  },
  bbinomial: {
    examples: ['stats-peas-binomial', 'bayesfactor-peas-proportion', 'bayesfactor-proportion'],
    features: ['rengine/bayes::binomial'],
  },
  regression: {
    features: ['rengine/regression::HC0'],
    note: 'Robust (HC0, HC3) and cluster standard errors against sandwich; each family below.',
  },
  'regression:bootstrap': {
    title: 'Bootstrap intervals of linear regression coefficients (boot, cases resampled)',
    features: ['rengine/robust::bootstrap intervals of the coefficients'],
  },
  'regression:gaussian': {
    title: 'Linear (OLS)',
    examples: [
      'datasets-attitude',
      'datasets-swiss',
      'cardata-duncan',
      'cardata-prestige',
      'mplus-ex3.1',
      'mplus-ex3.9',
      'mplus-ex6.23',
      'mplus-ex6.24',
    ],
    features: ['rengine/regression::Durbin', 'rengine/regression::hierarchical'],
    note: 'mplus-ex3.9: random slope (TYPE = RANDOM). Durbin–Watson: lmtest::dwtest (scripts/validation/durbin_watson.R). Hierarchical blocks (R² change, F change), standardised β, part and partial correlations, tolerance and case diagnostics: lm, ppcor, car::vif and influence.measures on ?swiss (scripts/validation/regression_extras.R).',
  },
  'regression:binomial': {
    title: 'Logistic (logit link)',
    examples: ['datasets-infert', 'mass-birthwt', 'mplus-ex3.5', 'mplus-ex6.19'],
  },
  'regression:binomial:probit': { title: 'Binomial, probit link', examples: ['mass-menarche'] },
  'regression:binomial:cloglog': {
    title: 'Binomial, complementary log-log link',
    features: ['rengine/regression::cloglog'],
    note: 'glm(binomial("cloglog")) on ?menarche (scripts/validation/regression_links.R).',
  },
  'regression:poisson': {
    title: 'Poisson',
    examples: ['stats-dobson', 'faraway-gala', 'mplus-ex3.7', 'mplus-ex3.8part1', 'mplus-ex7.25'],
    note: 'mplus-ex3.8part1, ex7.25: the zero-inflated Poisson as Mplus writes it.',
  },
  'regression:negbin': { title: 'Negative binomial', examples: ['mass-quine', 'mplus-ex3.8part2'] },
  'regression:gamma': { title: 'Gamma', examples: ['stats-clotting'] },
  'regression:ordinal': { title: 'Ordinal (proportional odds, logit)', examples: ['mass-housing'] },
  'regression:ordinal:probit': {
    title: 'Ordinal, probit link',
    features: ['rengine/regression::ordinal'],
    note: 'MASS::polr(method = "probit") on ?housing (scripts/validation/regression_links.R).',
  },
  'regression:ordinal:cloglog': {
    title: 'Ordinal, complementary log-log link',
    features: ['rengine/regression::ordinal'],
    note: 'MASS::polr(method = "cloglog") on ?housing (scripts/validation/regression_links.R).',
  },
  'regression:multinomial': {
    title: 'Multinomial logistic',
    examples: ['nnet-birthwt', 'mplus-ex3.6'],
  },
  'regression:censored': {
    title: 'Censored (tobit), also censored-inflated',
    examples: ['mplus-ex3.2', 'mplus-ex3.3', 'mplus-ex3.15'],
    features: ['rengine/regression::from above'],
  },
  'regression:survival': {
    title: 'Survival: Cox, piecewise exponential',
    examples: ['mplus-ex6.20', 'mplus-ex6.21', 'mplus-ex7.30'],
  },
  'regression:zeroinfl': {
    title: 'Zero-inflated Poisson / negative binomial (pscl)',
    examples: ['pscl-zinb'],
    features: ['rengine/regression::pscl'],
  },
  'regression:hurdle': {
    title: 'Hurdle Poisson / negative binomial (pscl)',
    examples: ['pscl-hurdle'],
    features: ['rengine/regression::pscl'],
  },
  pcor: {
    examples: ['ppcor-help'],
    note: 'Partial and semi-partial correlations against ppcor in desktop R (scripts/validation/regression_extras.R).',
  },
  'pcor:pearson': { title: 'Pearson partial correlations', features: ['rengine/pcor::pearson'] },
  'pcor:spearman': { title: 'Spearman partial correlations', features: ['rengine/pcor::spearman'] },
  'pcor:kendall': { title: 'Kendall partial correlations', features: ['rengine/pcor::kendall'] },
  pwr: {
    examples: ['pwr-cohen'],
    note: 'A priori N, achieved power and sensitivity against pwr in desktop R (scripts/validation/pwr.R).',
  },
  'pwr:t1': {
    title: 't-test, one sample (pwr.t.test)',
    features: ['rengine/pwr::t1_'],
  },
  'pwr:t2': {
    title: 't-test, two independent samples (pwr.t.test)',
    features: ['rengine/pwr::t2_'],
  },
  'pwr:paired': {
    title: 't-test, paired (pwr.t.test)',
    features: ['rengine/pwr::paired_'],
  },
  'pwr:anova': {
    title: 'One-way ANOVA (pwr.anova.test)',
    features: ['rengine/pwr::anova_'],
  },
  'pwr:p1': {
    title: 'One proportion (pwr.p.test)',
    features: ['rengine/pwr::p1_'],
  },
  'pwr:p2': {
    title: 'Two proportions (pwr.2p.test)',
    features: ['rengine/pwr::p2_'],
  },
  'pwr:r': {
    title: 'Correlation (pwr.r.test)',
    features: ['rengine/pwr::r_'],
  },
  'pwr:chisq': {
    title: 'Chi-square test (pwr.chisq.test)',
    features: ['rengine/pwr::chisq_'],
  },
  'pwr:f2': {
    title: 'Multiple regression, f² (pwr.f2.test)',
    features: ['rengine/pwr::f2_'],
  },
  km: {
    examples: ['survival-aml'],
    features: ['rengine/km'],
    note: 'Curves, intervals (log, log-log, plain), medians, risk tables, log-rank and Peto tests against survfit and survdiff in desktop R (scripts/validation/survival_km.R).',
  },
  customml: {},
  'customml:normal': {
    title: 'Normal likelihood',
    examples: ['stats-customml-cars', 'mplus-ex5.23'],
  },
  'customml:nominal': {
    title: 'Nominal (multinomial logit) likelihood',
    examples: ['mplus-ex3.10', 'mplus-ex7.28'],
  },
  'customml:probit': { title: 'Probit likelihood', examples: ['mplus-ex7.28'] },
  bmvreg: ex('stats-bmvreg-mtcars', 'mplus-ex6.25'),
  did: {},
  'did:twfe': {
    title: 'Two-way fixed effects, event study (fixest)',
    features: ['rengine/did::two-way fixed effects'],
  },
  'did:staggered': {
    title: 'Staggered adoption (Callaway & Sant’Anna, did)',
    examples: ['did-mpdta'],
    features: ['rengine/did::staggered adoption'],
  },
  medsens: ex('mediation-jobs-medsens'),
  efa: {},
  'efa:minres': { title: 'Minimum residual factoring (psych)', features: ['rengine/efa::minres'] },
  'efa:ml': {
    title: 'Maximum likelihood factoring (psych)',
    features: ['rengine/efa::ML + varimax'],
  },
  'efa:pa': {
    title: 'Principal axis factoring (psych)',
    features: ['rengine/efa::principal axis'],
    note: 'psych::fa(fm = "pa") on bfi (scripts/validation/efa_pa.R).',
  },
  'efa:lavaan': {
    title: 'EFA by lavaan (ML, WLSMV; Mplus-style)',
    examples: ['mplus-ex4.1part1', 'mplus-ex4.2', 'mplus-ex4.7'],
  },
  'efa:pca': { title: 'Principal components (psych)', features: ['rengine/efa::Harman.5'] },
  'efa:congruence': {
    title: 'Tucker’s congruence with a second solution (psych::factor.congruence)',
    features: ['rengine/efa::Tucker congruence'],
    note: 'bfi, minres + oblimin against ML + varimax (scripts/validation/efa_congruence.R).',
  },
  'efa:schmid': {
    title: 'Second-order factor by the Schmid–Leiman transformation, ω hierarchical (psych::omega)',
    features: ['rengine/efa::Schmid–Leiman'],
    note: 'bfi, 5 factors, minres + oblimin, against omega() on the raw data (scripts/validation/efa_schmid.R).',
  },
  efa2l: ex('mplus-ex4.5', 'lavaan-efa2l-twolevel'),
  cmb: {},
  'cmb:harman': { title: 'Harman’s single-factor test', examples: ['seminr-corprep-cmb'] },
  'cmb:vif': { title: 'Full-collinearity VIFs (Kock)', examples: ['seminr-corprep-cmb'] },
  cvi: ex('polit-cvi'),
  scoretest: {
    examples: ['strucchange-gratitude-agegroup'],
    note: 'The published example (Wang, Merkle & Zeileis) and strucchange along a continuous covariate (examples/cards/scoretest).',
  },
  alignment: ex('sirt-inv4gr-alignment'),
  mnlfa: ex('mnlfa-mnlfa01-dif'),
  lsem: ex('sirt-lsem01-age'),
  dmacs: ex('lavaan-hs-dmacs'),
  guidedinvariance: {},
  'guidedinvariance:continuous': {
    title: 'Continuous items (ML, MLR)',
    features: ['rengine/guidedInvariance::continuous items'],
    note: 'Fit, scaled difference tests, score tests, latent means and dMACS against plain lavaan group.equal / group.partial on Holzinger & Swineford by school (scripts/validation/guided_invariance.R).',
  },
  'guidedinvariance:delta': {
    title: 'Ordinal items, delta parameterization (WLSMV)',
    features: ['rengine/guidedInvariance::ordinal items'],
    note: 'semTools’ own ?measEq.syntax example (datCat), Wu & Estabrook identification: fit, lavTestLRT (satorra.2000), score tests, modification indices and latent means.',
  },
  'guidedinvariance:theta': {
    title: 'Ordinal items, theta parameterization with strict invariance (WLSMV)',
    features: ['rengine/guidedInvariance::ordinal items'],
  },
  'guidedinvariance:binary': {
    title: 'Binary items (scale held at 1 in the scalar model)',
    features: ['rengine/guidedInvariance::binary items'],
    note: 'The scalar model against lavaan’s own categorical group.equal (thresholds, loadings and intercepts equal; scale factors 1).',
  },
  mimicdif: ft('rengine/invariance::DIF by MIMIC'),
  irt: {},
  'irt:rasch': { title: 'Rasch', examples: ['ltm-lsat'], features: ['rengine/items::matches ltm'] },
  'irt:twopl': {
    title: '2PL',
    examples: ['mplus-ex5.5part2'],
    features: ['rengine/items::matches ltm'],
  },
  'irt:grm': { title: 'Graded response', features: ['rengine/items::matches ltm'] },
  'irt:gpcm': { title: 'Generalised partial credit', examples: ['mplus-ex5.5'] },
  'irt:threepl': { title: '3PL', examples: ['mirt-lsat7-3pl', 'mplus-ex5.5part3'] },
  'irt:fourpl': { title: '4PL', examples: ['mplus-ex5.5part4'] },
  'irt:mixture': { title: 'Mixture IRT', examples: ['mplus-ex7.27'] },
  lca: {},
  'lca:lca': {
    title: 'Latent classes, categorical items (poLCA)',
    examples: [
      'polca-carcinoma',
      'polca-values',
      'mplus-ex7.3',
      'mplus-ex7.4',
      'mplus-ex7.5',
      'mplus-ex7.6',
    ],
    features: ['rengine/items::poLCA'],
  },
  'lca:lpa': {
    title: 'Latent profiles, continuous items',
    examples: ['mplus-ex7.9', 'mplus-ex7.10', 'mplus-ex7.22'],
  },
  'lca:lcga': { title: 'Latent class growth', examples: ['mplus-ex8.9', 'mplus-ex8.10'] },
  'lca:mlca': {
    title: 'Multilevel latent classes (glca)',
    examples: ['glca-nyts18-mlca', 'mplus-ex10.7'],
  },
  meta: ex('metafor-bcg'),
  'meta:measure:GEN': {
    title: 'Effect sizes given with their variances',
    features: ['rengine/meta::three-level model'],
  },
  'meta:measure:GEN:sei': {
    title: 'Effect sizes given with their standard errors',
    features: ['rengine/meta::standard errors, odds ratios'],
  },
  'meta:measure:SMD': {
    title: 'Standardised mean differences (Hedges’ g)',
    features: ['rengine/meta::standardised and raw mean differences'],
  },
  'meta:measure:MD': {
    title: 'Raw mean differences',
    features: ['rengine/meta::standardised and raw mean differences'],
  },
  'meta:measure:OR': {
    title: 'Log odds ratios',
    features: ['rengine/meta::standard errors, odds ratios'],
  },
  'meta:measure:RR': {
    title: 'Log risk ratios',
    features: ['rengine/meta::random-effects model of dat.bcg'],
  },
  'meta:measure:RD': {
    title: 'Risk differences',
    features: ['rengine/meta::standard errors, odds ratios'],
  },
  'meta:measure:ZCOR': {
    title: 'Correlations (Fisher’s z, back-transformed to r)',
    features: ['rengine/meta::Fisher’s z'],
  },
  'meta:measure:PLO': {
    title: 'Proportions (logit, back-transformed)',
    features: ['rengine/meta::proportions, logit and raw'],
  },
  'meta:measure:PR': {
    title: 'Proportions (raw)',
    features: ['rengine/meta::proportions, logit and raw'],
  },
  'meta:method:FE': {
    title: 'Equal-effects (fixed-effect) model',
    features: ['rengine/meta::every tau² estimator'],
  },
  'meta:method:REML': {
    title: 'Random effects, REML',
    features: ['rengine/meta::random-effects model of dat.bcg'],
  },
  'meta:method:ML': {
    title: 'Random effects, ML',
    features: ['rengine/meta::every tau² estimator'],
  },
  'meta:method:DL': {
    title: 'Random effects, DerSimonian–Laird',
    features: ['rengine/meta::every tau² estimator'],
  },
  'meta:method:PM': {
    title: 'Random effects, Paule–Mandel',
    features: ['rengine/meta::every tau² estimator'],
  },
  'meta:method:HE': {
    title: 'Random effects, Hedges',
    features: ['rengine/meta::every tau² estimator'],
  },
  'meta:method:SJ': {
    title: 'Random effects, Sidik–Jonkman',
    features: ['rengine/meta::every tau² estimator'],
  },
  'meta:method:EB': {
    title: 'Random effects, empirical Bayes',
    features: ['rengine/meta::every tau² estimator'],
  },
  'meta:method:HS': {
    title: 'Random effects, Hunter–Schmidt',
    features: ['rengine/meta::every tau² estimator'],
  },
  'meta:knha': {
    title: 'Knapp–Hartung adjustment',
    features: ['rengine/meta::with and without Knapp–Hartung'],
  },
  'meta:moderators': {
    title: 'Meta-regression on continuous moderators',
    features: ['rengine/meta::meta-regression on ablat and year'],
  },
  'meta:categorical': {
    title: 'Categorical moderators (factor dummies)',
    features: ['rengine/meta::categorical moderator'],
  },
  'meta:threelevel': {
    title: 'Three-level model (rma.mv)',
    features: ['rengine/meta::three-level model'],
  },
  'meta:bias': {
    title: 'Publication bias: Egger, rank correlation, trim-and-fill, PET-PEESE',
    features: ['rengine/meta::random-effects model of dat.bcg'],
  },
  'meta:influence': {
    title: 'Influence diagnostics and leave-one-out',
    features: ['rengine/meta::random-effects model of dat.bcg'],
  },
  roc: ex('proc-asah'),
  'roc:ci:delong': {
    title: 'AUC with DeLong’s interval',
    features: ['rengine/roc::ROC curve of s100b'],
  },
  'roc:ci:bootstrap': {
    title: 'AUC with a bootstrap interval',
    features: ['rengine/roc::bootstrap interval'],
  },
  'roc:source:logistic': {
    title: 'Predictor: fitted probabilities of a logistic regression',
    features: ['rengine/roc::logistic regression'],
  },
  'roc:direction': {
    title: 'Low predictor values marking cases (direction)',
    features: ['rengine/roc::low values mark cases'],
  },
  'roc:positive': {
    title: 'The outcome value marking cases chosen',
    features: ['rengine/roc::levels reversed'],
  },
  'roc:cutpoint:youden': {
    title: 'Best cut-point by Youden’s J',
    features: ['rengine/roc::Youden cut-point'],
  },
  'roc:cutpoint:closest.topleft': {
    title: 'Best cut-point closest to the top-left corner',
    features: ['rengine/roc::closest to the top-left'],
  },
  'roc:compare:paired': {
    title: 'DeLong’s paired test of two predictors',
    features: ['rengine/roc::paired test'],
  },
  'roc:compare:groups': {
    title: 'DeLong’s unpaired test between two groups',
    features: ['rengine/roc::unpaired test'],
  },
  'roc:pauc': { title: 'Partial AUC', features: ['rengine/roc::partial AUCs'] },
  'roc:pauc:correct': {
    title: 'Partial AUC with McClish’s correction and bootstrap interval',
    features: ['rengine/roc::McClish-corrected'],
  },
  psem: {},
  'psem:gaussian': { title: 'Normal outcomes (lm)', features: ['rengine/psem::keeley model'] },
  'psem:binomial': {
    title: 'Binary outcomes (glm, logit)',
    features: ['rengine/psem::binomial glm'],
  },
  'psem:poisson': {
    title: 'Count outcomes (glm, Poisson)',
    features: ['rengine/psem::Poisson outcome'],
  },
  'psem:mixed': {
    title: 'Random intercepts (lmer, glmer)',
    features: ['rengine/psem::random intercepts'],
  },
  'psem:standardize:Menard.OE': {
    title: 'Observation-empirical standardisation',
    features: ['rengine/psem::observation-empirical'],
  },
  'lca:aux:ml': {
    title:
      'Three-step auxiliary variables: BCH distal means, ML three-step covariates (Vermunt 2010)',
    features: ['rengine/lcaAux::ML three-step'],
    note: 'Against StepMix (Python) on poLCA’s election data: D, the BCH class means, the logit; sandwich SEs against numerical derivatives (scripts/validation/lca_aux.py).',
  },
  'lca:aux:bch': {
    title: 'Three-step auxiliary variables: BCH-weighted covariates',
    features: ['rengine/lcaAux::BCH-weighted'],
  },
  mixture: {
    examples: [
      'mplus-ex7.1',
      'mplus-ex7.2',
      'mplus-ex7.11',
      'mplus-ex7.12',
      'mplus-ex7.13',
      'mplus-ex7.14',
      'mplus-ex7.15',
      'mplus-ex7.17',
      'mplus-ex7.20',
      'mplus-ex7.21',
      'mplus-ex7.24',
      'mplus-ex7.26',
    ],
  },
  quadml: {},
  'quadml:syntax': {
    title: 'Integration ML from Mplus-style syntax',
    examples: [
      'ltm-quadml-lsat',
      'mplus-ex3.17',
      'mplus-ex5.4',
      'mplus-ex5.7',
      'mplus-ex6.2',
      'mplus-ex6.3',
      'mplus-ex6.16',
      'mplus-ex6.22',
      'mplus-ex11.3',
    ],
  },
  'quadml:model': {
    title: 'Count indicators on the diagram, by integration',
    features: ['rengine/quadmlCount'],
  },
  network: {},
  'network:estimator:EBICglasso': {
    title: 'EBICglasso (regularised partial correlations)',
    features: ['rengine/network::EBICglasso'],
  },
  'network:estimator:pcor': {
    title: 'Unregularised partial correlations',
    features: ['rengine/network::partial correlations'],
    note: 'bootnet::estimateNetwork(default = "pcor") (scripts/validation/network_modes.R).',
  },
  'network:estimator:cor': {
    title: 'Correlation network',
    features: ['rengine/network::correlation network'],
    note: 'bootnet::estimateNetwork(default = "cor") (scripts/validation/network_modes.R).',
  },
  'network:cor:cor_auto': {
    title: 'cor_auto correlations (polychoric where ordinal)',
    features: ['rengine/network::EBICglasso'],
  },
  'network:cor:cor': { title: 'Pearson correlations', features: ['rengine/network::EBICglasso'] },
  'network:cor:spearman': {
    title: 'Spearman correlations',
    features: ['rengine/network::Spearman'],
    note: 'bootnet with corMethod = "spearman" (scripts/validation/network_modes.R).',
  },
  ega: {},
  'ega:glasso': {
    title: 'EGA with EBICglasso',
    features: ['rengine/network::?EGA', 'rengine/network::bootEGA'],
  },
  'ega:TMFG': {
    title: 'EGA with TMFG',
    features: ['rengine/network::TMFG'],
    note: 'EGAnet::EGA(model = "TMFG") (scripts/validation/network_modes.R).',
  },
  bollenstine: { examples: ['lavaan-hs-bollenstine'], features: ['rengine/cbExtras::Bollen'] },
  cbcompare: { examples: ['lavaan-hs-wald'], features: ['rengine/cbExtras::pairwise z'] },
  scoreweights: {
    examples: ['lavaan-hs-scoreweights'],
    features: ['rengine/cbExtras::factor score weights', 'rengine/scores'],
  },
  localfit: ft('rengine/cbDiag::residual correlations', 'rengine/cbDiag::Browne'),
  cbdiscriminant: ft('rengine/cbDiag::the HS factors', 'rengine/cbDiag::Political Democracy'),
  cbmodels: {
    examples: ['nonnest2-hs-vuong'],
    features: ['rengine/cbDiag::nonnest2', 'rengine/cbDiag::a nested pair'],
  },
  epcequiv: ft('rengine/cbDiag::epcEquivFit', 'rengine/cbDiag::other SESOIs'),
  specsearch: ft('rengine/search::every combination'),
  equivalent: ft('rengine/search::six hand-written', 'rengine/search::triangle'),
  hypotheses: {
    examples: ['restriktor-poldem-gorica', 'bain-sesame-latent'],
    features: ['rengine/hypotheses'],
    note: 'Both methods together in one run: rengine/hypotheses (bain with fraction 2 and the GORICA against the unconstrained hypothesis).',
  },
  'hypotheses:gorica': {
    title: 'GORICA (restriktor::goric)',
    examples: ['restriktor-poldem-gorica'],
    features: ['rengine/hypotheses::GORICA'],
  },
  'hypotheses:bain': {
    title: 'Bayes factors (bain)',
    examples: ['bain-sesame-latent'],
    features: ['rengine/hypotheses::bain'],
  },
  apim: {
    examples: ['lavaan-apim-commitment'],
    features: ['rengine/apim'],
    note: 'No published APIM numbers with open data were found: the references are dySEM’s scriptAPIM syntax and hand-written lavaan syntax, fitted natively.',
  },
  'apim:distinguishable': {
    title: 'Distinguishable dyads',
    examples: ['lavaan-apim-commitment'],
    features: ['rengine/apim::distinguishable'],
  },
  'apim:indistinguishable': {
    title: 'Indistinguishable dyads',
    features: ['rengine/apim::indistinguishable'],
  },
  lmwald: ft('rengine/search::LM forward', 'rengine/search::Wald backward'),
  regsem: { examples: ['lslx-hs-sfa'], features: ['rengine/search::lslx'] },
  dynamicfit: {},
  'dynamicfit:cfaOne': { title: 'cfaOne', examples: ['dynamic-hs-cfaone'] },
  'dynamicfit:cfaHB': { title: 'cfaHB', examples: ['dynamic-hs-cfahb'] },
  'dynamicfit:catOne': { title: 'catOne', examples: ['dynamic-example-catone'] },
  'dynamicfit:catHB': { title: 'catHB', examples: ['dynamic-example-cathb'] },
  'dynamicfit:likertOne': { title: 'likertOne', examples: ['dynamic-example-likertone'] },
  'dynamicfit:likertHB': { title: 'likertHB', examples: ['dynamic-example-likerthb'] },
  'dynamicfit:nnorOne': { title: 'nnorOne', examples: ['dynamic-example-nnorone'] },
  'dynamicfit:nnorHB': { title: 'nnorHB', examples: ['dynamic-example-nnorhb'] },
  'dynamicfit:hier1HB': {
    title: 'hier1HB',
    todo: 'dynamic::hier1HB on a second-order model with data, in desktop R with the package’s seeds. Its help page has only a manual-entry example (standardised loadings, no data), which the card does not take; on Holzinger & Swineford’s second-order model the simulated fits give lavaan non-convergence warnings, so it needs an example whose simulations run cleanly.',
  },
  'dynamicfit:hier2': {
    title: 'hier2',
    todo: 'dynamic::hier2 on a second-order model with at least four first-order factors and data, in desktop R with the package’s seeds. Its help page has only a manual-entry example (no data); hier2 refuses three first-order factors (their covariances are saturated).',
  },
  'dynamicfit:exactFit': { title: 'exactFit', examples: ['dynamic-hs-exactfit'] },
  'dynamicfit:equivTest': { title: 'equivTest', examples: ['dynamic-hs-equivtest'] },
  'dynamicfit:DDDFI': { title: 'DDDFI', examples: ['dynamic-holzinger-dddfi'] },
  semsens: ex('semsens-sa-aco'),
  sempower: ft('rengine/power'),
  metasem: {},
  'metasem:REM': { title: 'Random-effects TSSEM', features: ['rengine/metasem::random effects'] },
  'metasem:FEM': { title: 'Fixed-effects TSSEM', features: ['rengine/metasem::fixed effects'] },
  semtree: ft('rengine/semtree::grows', 'rengine/semtree::forest'),
  bsem: {},
  'bsem:blavaan': {
    title: 'MCMC (blavaan, Stan; desktop R)',
    examples: ['mplus-ex3.18', 'mplus-ex5.31', 'mplus-ex5.32', 'mplus-ex5.33', 'mplus-ex11.7'],
    note: 'The card’s run recorded in desktop R (bsem.native.test.ts) against the Mplus output, within Monte Carlo error.',
  },
  'bsem:inlavaan': { title: 'INLA approximation (INLAvaan)', features: ['rengine/inlavaan'] },
  plspredict: { examples: ['seminr-corprep-predict'], features: ['rengine/plsx::PLSpredict'] },
  blindfold: ft('rengine/plsx::blindfolding'),
  compare: { examples: ['seminr-mobi-compare'], features: ['rengine/plsx::model comparison'] },
  mga: {
    examples: ['csem-gender'],
    features: ['rengine/plsx::MICOM'],
    note: 'Permutation p-values are random and not compared; their deterministic parts are.',
  },
  plsmultilevel: {
    features: ['rengine/plssem'],
    note: 'plssem is desktop-only: recorded by a desktop-R evidence run.',
  },
  cta: { examples: ['seminr-corprep-cta'], features: ['rengine/cta'] },
  cca: ft('rengine/plsx::confirmatory composite'),
  nonlinear: {
    features: ['engine/nonlinear'],
    note: 'Nonlinear paths against lm() on seminr’s scores (scripts/validation/nonlinear_paths.R); Kock’s causality indices by hand.',
  },
  minsample: ex('seminr-corprep-minsample'),
  rebus: { features: ['rengine/segment::REBUS'] },
  pathmox: ft('rengine/pathmox'),
  fimix: ft('rengine/fimix'),
  pos: {
    examples: ['plspm-pos'],
    features: ['rengine/pos'],
    note: 'No reference package exists: recovery of simulated segments.',
  },
  mc: { examples: ['muthen-mc-cfa'], features: ['rengine/mc'] },
  rsa: { examples: ['rsa-motcon'], features: ['rengine/rsa'] },
  match: {},
  'match:matchit': {
    title: 'Matching (MatchIt)',
    examples: ['matchit-lalonde'],
    features: ['rengine/match::matching'],
    note: 'Nearest-neighbour and full matching compared; the other MatchIt methods share the same code path.',
  },
  'match:weighting': { title: 'Weighting (WeightIt)', examples: ['weightit-lalonde'] },
  nca: { examples: ['nca-example'], features: ['rengine/nca'] },
  qca: ex(
    'qca-lf-lipset',
    'qca-lc-lipset-crisp',
    'qca-lc-lipset-negated',
    'qca-cvf-protest',
    'qca-cvr-calibrate',
  ),
  endo: {},
  'endo:iv': {
    title: 'Instrumental variables (ivreg)',
    examples: ['ivreg-kmenta'],
    features: ['rengine/endo::instrumental variables'],
  },
  'endo:copula': { title: 'Gaussian copula', features: ['rengine/endo::Gaussian copula'] },
  'endo:het': {
    title: 'Heteroskedasticity-based instruments (Lewbel)',
    features: ['rengine/endo::heteroskedasticity'],
  },
  'endo:hm': { title: 'Higher-moment instruments', features: ['rengine/endo::higher-moment'] },
  'endo:liv': {
    title: 'Latent instrumental variables',
    features: ['rengine/endo::latent instrumental'],
  },
  'endo:heckman': {
    title: 'Heckman selection',
    examples: ['sampleselection-mroz'],
    features: ['rengine/endo::Heckman'],
  },
  lmm: {
    examples: [
      'lme4-sleepstudy',
      'mplus-ex9.2a',
      'mplus-ex9.2b',
      'mplus-ex9.5',
      'mplus-ex9.14',
      'mplus-ex9.16',
    ],
    features: ['rengine/mixed::random intercepts', 'rengine/mixed::within / between'],
  },
  'lmm:emmeans': {
    title: 'Categorical predictors and their estimated marginal means (emmeans on lmer)',
    features: ['rengine/emm::marginal means after a multilevel regression'],
    note: 'Kenward–Roger, Satterthwaite and asymptotic df against emmeans on lmerTest::lmer (scripts/validation/emm.R).',
  },
  glmm: {},
  'glmm:poisson': { title: 'Poisson', examples: ['mplus-ex6.6'] },
  'glmm:negbin': {
    title: 'Negative binomial',
    features: ['rengine/glmm::negative binomial'],
    note: 'GLMMadaptive::mixed_model(family = negative.binomial()) on its help page’s simulated data (scripts/validation/glmm.R).',
  },
  'glmm:zip': { title: 'Zero-inflated Poisson', examples: ['mplus-ex6.7'] },
  'glmm:zinb': {
    title: 'Zero-inflated negative binomial',
    features: ['rengine/glmm::zero-inflated negative binomial'],
    note: 'GLMMadaptive::mixed_model(family = zi.negative.binomial()) on its vignette’s simulated data (scripts/validation/glmm.R).',
  },
  'glmm:binomial': { title: 'Binomial', examples: ['glmmadaptive-cbpp'] },
  growth: {
    examples: [
      'lavaan-growth',
      'lavaan-growth-conditional',
      'mplus-ex6.1',
      'mplus-ex6.8',
      'mplus-ex6.9',
      'mplus-ex6.10',
    ],
    features: ['rengine/longitudinal::growth matches lavaan', 'rengine/longitudinal::time-varying'],
  },
  longinvariance: ft('rengine/invariance::longitudinal invariance'),
  riclpm: { examples: ['mulder-riclpm'], features: ['rengine/longitudinal::equal lagged effects'] },
  lcs: {
    examples: ['lavaan-demogrowth-lcs'],
    note: 'lcsm’s help examples and the home-screen example as lcsm fits them (examples/cards/lcs).',
  },
  gmm: { examples: ['mplus-ex8.1', 'mplus-ex8.2'], features: ['rengine/mixed::native lcmm'] },
  dsem: {
    examples: ['mplus-ex6.26', 'mplus-ex9.19part1', 'mplus-ex9.24', 'mplus-ex9.30', 'mplus-ex9.33'],
    note: 'The card’s Stan run recorded in desktop R (dsem.native.test.ts) against the Mplus output, within Monte Carlo error.',
  },

  // ---- The Model tab (R engine): estimation.
  'model:pls': {
    title: 'PLS-SEM (cSEM, seminr)',
    examples: ['seminr-corprep'],
    features: [
      'rengine/published',
      'rengine/pls::reproduces the reference',
      'rengine/pls::sum-score',
    ],
  },
  'model:plsc': {
    title: 'Consistent PLS (PLSc)',
    features: ['rengine/pls::reproduces the reference', 'rengine/plsx::nonlinear PLSc'],
  },
  'model:plsApproach:PLS-PM': {
    title: 'PLS path modelling (the default approach)',
    features: ['rengine/pls::reproduces the reference'],
  },
  'model:plsApproach:GSCA': { title: 'GSCA', features: ['rengine/plsx::GSCA'] },
  'model:plsApproach:PCA': { title: 'Principal components', features: ['rengine/plsx::GSCA'] },
  'model:plsApproach:unit': {
    title: 'Unit weights (sum scores)',
    features: ['rengine/plsx::GSCA', 'rengine/pls::sum-score'],
  },
  'model:hocApproach:two_stage': {
    title: 'Higher-order constructs: two-stage',
    examples: ['csem-2ndorder'],
  },
  'model:hocApproach:embedded': {
    title: 'Higher-order constructs: embedded two-stage',
    examples: ['csem-2ndorder-embedded'],
  },
  'model:hocApproach:repeated': {
    title: 'Higher-order constructs: repeated indicators',
    examples: ['csem-2ndorder-repeated', 'seminr-hoc'],
    features: ['rengine/hoc::repeated indicators'],
  },
  'model:pls:ordinal': { title: 'Ordinal PLS (OrdPLS, OrdPLSc)', features: ['rengine/ordinalPls'] },
  'model:pls:categorical': {
    title: 'Categorical exogenous variables (dummy composites)',
    features: ['rengine/pls::Mode B composite of dummies'],
  },
  'model:pls:quadratic': {
    title: 'Quadratic effects',
    features: ['rengine/quadratic'],
    note: 'Recovery of a known curvature, and the R engine against the built-in.',
  },
  'model:pls:interaction': {
    title: 'PLS interaction terms (two-stage, orthogonal, product indicator)',
    examples: ['seminr-interaction-methods'],
    features: ['engine/interactionMethods'],
  },
  'model:pls:fittest': {
    title: 'PLS model fit test (cSEM testOMF)',
    features: ['rengine/analyses::fit test'],
  },
  'model:bootInterval:percentile': {
    title: 'Bootstrap, percentile intervals',
    features: ['rengine/bca::boot_summary', 'rengine/analyses::bootstrap agrees'],
  },
  'model:bootInterval:bca': { title: 'Bootstrap, BCa intervals', features: ['rengine/bca'] },
  'model:bootInterval:studentized': {
    title: 'Bootstrap, studentized intervals',
    features: ['engine/studentized'],
    note: 'The bootstrap-t interval by hand on known draws, and its inner bootstrap.',
  },
  'model:ipma': {
    title: 'Importance–performance map (cSEM)',
    features: ['rengine/analyses::reproduces the reference'],
  },
  'model:miiv': {
    title: 'MIIV-2SLS (MIIVsem)',
    examples: ['bollen-union', 'bollen-reisenzein'],
    features: ['rengine/analyses::reproduces the reference'],
  },
  'model:cbsem:estimator:ML': {
    title: 'CB-SEM, ML (lavaan)',
    examples: ['lavaan-hs', 'lavaan-poldem', 'mplus-ex5.1', 'kline-roth'],
    features: ['rengine/lavaan'],
  },
  'model:cbsem:estimator:MLM': {
    title: 'CB-SEM, MLM (Satorra–Bentler)',
    features: ['rengine/lavaan'],
  },
  'model:cbsem:estimator:MLMV': { title: 'CB-SEM, MLMV', features: ['rengine/lavaan'] },
  'model:cbsem:estimator:MLR': { title: 'CB-SEM, MLR', features: ['rengine/lavaan'] },
  'model:cbsem:estimator:GLS': { title: 'CB-SEM, GLS', features: ['rengine/lavaan'] },
  'model:cbsem:estimator:ULS': { title: 'CB-SEM, ULS', features: ['rengine/lavaan'] },
  'model:cbsem:estimator:WLS': { title: 'CB-SEM, WLS (ADF)', features: ['rengine/adf'] },
  'model:cbsem:estimator:WLSMV': {
    title: 'CB-SEM, WLSMV (ordinal indicators)',
    features: ['rengine/categorical', 'rengine/ordinalFit'],
  },
  'model:cbsem:estimator:2SLS': {
    title: 'CB-SEM, MIIV-2SLS',
    features: ['rengine/analyses::reproduces the reference'],
  },
  'model:cbsem:estimator:RML': { title: 'CB-SEM, robust ML (rsem)', features: ['rengine/rsem'] },
  'model:missing:mean': {
    title: 'Missing values: mean replacement (PLS)',
    features: ['rengine/pls::reproduces the reference'],
    note: 'corp_rep with its −99 codes (pls_seminr_corp_rep).',
  },
  'model:missing:casewise': {
    title: 'Missing values: listwise deletion',
    features: ['rengine/lavaan'],
  },
  'model:missing:fiml': { title: 'Missing values: FIML', features: ['rengine/categorical'] },
  'model:missing:mi': {
    title: 'Missing values: multiple imputation',
    examples: ['mice-nhanes', 'lavaanmi-hs'],
    features: ['rengine/mi'],
  },
  'model:missing:pairwise': {
    title: 'Missing values: pairwise deletion',
    features: ['rengine/missingTwoStage::pairwise'],
  },
  'model:missing:twostage': {
    title: 'Missing values: two-stage',
    features: ['rengine/missingTwoStage::twostage'],
  },
  'model:missing:robusttwostage': {
    title: 'Missing values: robust two-stage',
    features: ['rengine/missingTwoStage::robusttwostage'],
  },
  'model:interaction:product': {
    title: 'Latent interactions: product indicators',
    features: ['engine/validation::cbmod_'],
  },
  'model:interaction:lms': {
    title: 'Latent interactions: LMS (modsem)',
    examples: ['modsem-oneint'],
    features: ['rengine/modsem', 'rengine/modsemBoot'],
  },
  'model:interaction:qml': {
    title: 'Latent interactions: QML (modsem)',
    features: ['rengine/modsem'],
  },
  'model:cbsem:multigroup': {
    title: 'Multiple groups and invariance',
    examples: ['lavaan-hs-groups'],
    features: ['rengine/multigroup', 'rengine/groupBoot'],
  },
  'model:cbsem:twolevel': {
    title: 'Two-level SEM',
    examples: ['lavaan-twolevel'],
    features: ['rengine/twolevel'],
  },
  'model:cbsem:esem': {
    title: 'ESEM and bifactor rotations',
    examples: ['lavaan-hs-esem'],
    features: ['rengine/esem', 'examples/bifactor'],
  },
  'model:cbsem:complex': {
    title: 'Cluster-robust standard errors (COMPLEX)',
    features: ['rengine/complex'],
  },
  'model:cbsem:weights': { title: 'Sampling weights', features: ['rengine/weights'] },
  'model:cbsem:means': {
    title: 'Mean structures',
    examples: ['lavaan-hs-means'],
    features: ['rengine/means'],
  },
  'model:cbsem:constraints': {
    title: 'Equality constraints, defined parameters',
    features: ['rengine/constraints'],
  },
  'model:cbsem:inequality': { title: 'Inequality constraints', features: ['rengine/inequality'] },
  'model:cbsem:fixedValues': {
    title: 'Parameters fixed at values',
    features: ['rengine/fixedValues'],
  },
  'model:cbsem:zeroCovariance': {
    title: 'Covariances fixed at zero',
    features: ['rengine/zeroCovariance'],
  },
  'model:cbsem:composites': { title: 'Composites in CB-SEM', features: ['rengine/cbComposite'] },
  'model:cbsem:tech4': { title: 'Implied latent moments (TECH4)', features: ['rengine/tech4'] },
  'model:cbsem:reliability': {
    title: 'Reliability (omega, alpha)',
    features: ['rengine/reliability', 'rengine/reliabilitySingle'],
  },
  'model:cbsem:scores': {
    title: 'Factor scores and plausible values',
    features: ['rengine/scores'],
  },
  'model:process': {
    title: 'Conditional process analysis (PROCESS models)',
    examples: ['manymome-med', 'manymome-modmed', 'manymome-serial'],
    features: ['rengine/cpa', 'rengine/cpaCategorical', 'rengine/cpaGlm', 'rengine/cpaSam'],
  },

  // ---- The built-in TypeScript engine (Settings → engine: built-in).
  'builtin:pls': {
    title: 'Built-in PLS-SEM',
    features: ['engine/validation::pls_', 'engine/pls', 'rengine/published'],
  },
  'builtin:plsc': { title: 'Built-in PLSc', features: ['engine/validation::plsc_', 'engine/plsc'] },
  'builtin:cbsem': {
    title: 'Built-in CB-SEM (ML, MLM, MLMV, MLR, GLS, ULS)',
    features: [
      'engine/validation::cb_lavaan',
      'engine/validation::cov_lavaan',
      'engine/validation::emse_',
      'engine/cbsem',
      'engine/fixedValues',
      'engine/zeroCovariance',
    ],
  },
  'builtin:miiv': {
    title: 'Built-in MIIV-2SLS',
    features: ['engine/validation::miiv_', 'engine/miivVariance'],
  },
  'builtin:ipma': { title: 'Built-in IPMA', features: ['engine/validation::ipma_'] },
  'builtin:mcci': {
    title: 'Built-in Monte Carlo CIs of indirect effects',
    features: ['engine/validation::mcci_'],
  },
  'builtin:jn': {
    title: 'Built-in Johnson–Neyman (conditional effects)',
    features: ['engine/validation::cbmod_'],
    note: 'Conditional effects and SEs against lavaan’s defined parameters (cbmod cases).',
  },
  'builtin:bootstrap': {
    title: 'Built-in bootstrap (percentile)',
    features: ['rengine/bca::boot_summary', 'rengine/analyses::bootstrap agrees'],
  },
  'builtin:fit': {
    title: 'Built-in PLS fit test',
    features: ['engine/fit::testOMF'],
    note: 'Observed discrepancies exactly, bootstrap quantiles within Monte Carlo error of cSEM::testOMF (scripts/validation/fit_test.R).',
  },
  'builtin:copula': { title: 'Gaussian copula terms', features: ['engine/copula'] },
  'builtin:wpls': {
    title: 'Weighted PLS',
    features: ['engine/wpls'],
    note: 'Integer weights equal the repeated-rows unweighted estimates; a weighted correlation by hand.',
  },
  'builtin:interaction': {
    title: 'PLS interaction methods',
    features: ['engine/interactionMethods'],
  },
  'builtin:plscNonlinear': {
    title: 'Nonlinear PLSc (interactions, quadratic terms)',
    features: ['engine/plscNonlinear'],
  },
  'builtin:quadratic': {
    title: 'Quadratic effects',
    features: ['engine/quadratic', 'rengine/quadratic'],
  },
  'builtin:categorical': {
    title: 'Categorical exogenous variables (dummy composites)',
    features: ['rengine/pls::Mode B composite of dummies'],
    note: 'The same test runs the built-in engine on corp_rep’s service type against cSEM (scripts/validation/categorical_pls.R).',
  },
  'builtin:montecarlo': {
    title: 'Monte Carlo simulation',
    features: ['rengine/mc'],
    note: 'R and built-in simulations agree within Monte Carlo error.',
  },
  'builtin:nonnormal': { title: 'Non-normal data (Vale–Maurelli)', features: ['engine/nonnormal'] },
  'builtin:stats': { title: 'Distributions (t, χ²)', features: ['engine/stats'] },
};

/** The class of an entry's evidence: the strongest kind it names. */
export function evidenceClass(e: CardEvidence): EvidenceClass {
  if (e.none) return 'none';
  if (e.todo) return 'todo';
  if (e.examples?.length) return 'examples';
  if (e.features?.length) return 'features';
  return e.unit?.length ? 'unit' : 'modes';
}

/** A feature reference's file key and test filter. */
export const splitFeature = (ref: FeatureRef): { file: string; test?: string } => {
  const i = ref.indexOf('::');
  return i < 0 ? { file: ref } : { file: ref.slice(0, i), test: ref.slice(i + 2) };
};

/** Whether a feature check (id `file::test name`) is one an entry names. */
export function featureMatches(ref: FeatureRef, checkId: string): boolean {
  const { file, test } = splitFeature(ref);
  return (
    checkId.startsWith(`${file}::`) && (!test || checkId.slice(file.length + 2).includes(test))
  );
}

/** Whether an entry names an example check (by id) or a feature check (by one of its feature references). */
export const entryNames = (e: CardEvidence, subject: 'example' | 'feature', id: string): boolean =>
  subject === 'example'
    ? !!e.examples?.includes(id)
    : !!e.features?.some((f) => featureMatches(f, id));

/** The manifest entries a feature check or an example check is evidence for. */
export function cardsOfCheck(subject: 'example' | 'feature', id: string): string[] {
  return Object.keys(CARD_EVIDENCE).filter((k) => entryNames(CARD_EVIDENCE[k], subject, id));
}
