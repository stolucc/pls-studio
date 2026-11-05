// Examples that open a card: cards about a model (CB-SEM and PLS-SEM checks, prediction, segmentation, simulation), charts and the RI-CLPM. Each follows an R package's help page or a textbook, with
// the numbers it prints checked in cards/model.webr.test.ts.
//
// A sample of 150 drawn from Muthén & Muthén's (2002) CFA population is shipped as a CSV file (public/examples/montecarlo,
// generated with lavaan::simulateData and the paper's Monte Carlo seed 53487). Mulder & Hamaker's (2021) simulated
// RI-CLPM data are not shipped (their repository states no licence): the example downloads them from the tutorial's
// repository at a pinned commit when it opens (remote/source.ts, RICLPM_DATA).

import { c, CB, f, fan, items } from '../define';
import type { PackageExample } from '../packages';
import type { Settings } from '../../model/project';
import { RICLPM_DATA } from '../remote/source';

const HS = [f('visual', items('x', 3)), f('textual', items('x', 3, 4)), f('speed', items('x', 3, 7))];
const HS_LINKS = [{ label: '?HolzingerSwineford1939', url: 'https://rdrr.io/cran/lavaan/man/HolzingerSwineford1939.html' }];

/** seminr's estimate_pls() defaults (path weighting, mean replacement, 300 iterations, 1e-07), as the seminr examples in packages.ts. */
const SEMINR = (more: Partial<Settings> = {}): Partial<Settings> => ({ method: 'pls', plsPackage: 'seminr', consistent: false, scheme: 'path', missing: 'mean', ...more });

/** Hair et al. (2021): the extended corporate reputation model (as seminr-corprep in packages.ts). */
const CORP_REP = {
  data: { package: 'seminr' as const, name: 'corp_rep_data', na: [-99] },
  constructs: [c('QUAL', items('qual_', 8)), c('PERF', items('perf_', 5)), c('CSOR', items('csor_', 5)), c('ATTR', items('attr_', 3)),
    c('COMP', items('comp_', 3), 'A'), c('LIKE', items('like_', 3), 'A'), c('CUSA', ['cusa'], 'A'), c('CUSL', items('cusl_', 3), 'A')],
  paths: [...fan(['QUAL', 'PERF', 'CSOR', 'ATTR'], ['COMP', 'LIKE']), ...fan(['COMP', 'LIKE'], ['CUSA', 'CUSL']), ['CUSA', 'CUSL']] as [string, string][],
};
const HAIR = [{ label: '?corp_rep_data', url: 'https://rdrr.io/cran/seminr/man/corp_rep_data.html' }, { label: 'Hair et al. (2021), PLS-SEM using R (open access)', url: 'https://doi.org/10.1007/978-3-030-80519-7' }];

/** seminr's mobi ECSI constructs, all Mode A composites (demo "seminr-alternative-models"). */
const MOBI = [c('Image', items('IMAG', 5), 'A'), c('Expectation', items('CUEX', 3), 'A'), c('Quality', items('PERQ', 7), 'A'), c('Value', items('PERV', 2), 'A'),
  c('Satisfaction', items('CUSA', 3), 'A'), c('Complaints', ['CUSCO'], 'A'), c('Loyalty', items('CUSL', 3), 'A')];
const ANTECEDENTS = ['Image', 'Expectation', 'Quality'], MEDIATORS = ['Satisfaction', 'Value'], OUTCOMES = ['Loyalty', 'Complaints'];
/** The demo's mediated_sm and overriding_effects_sm (both keep every construct, so the comparison card can use them). */
export const MOBI_MEDIATED: [string, string][] = [...fan(ANTECEDENTS, MEDIATORS), ...fan(MEDIATORS, OUTCOMES)];
export const MOBI_OVERRIDING: [string, string][] = [...fan(ANTECEDENTS, MEDIATORS), ...fan([...ANTECEDENTS, ...MEDIATORS], OUTCOMES)];

const SIMDATA = {
  data: { package: 'plspm' as const, name: 'simdata' },
  constructs: [f('Price', items('mv', 5)), f('Quality', items('mv', 5, 6)), f('Satisfaction', items('mv', 3, 11))],
  paths: [['Price', 'Satisfaction'], ['Quality', 'Satisfaction']] as [string, string][],
};

/** Muthén & Muthén (2002), the CFA model: two factors of five indicators, loadings .8, residual variances .36, factor correlation .25. */
export const MUTHEN_POPULATION = {
  constructs: [
    { name: 'f1', type: 'factor', indicators: items('y', 5), loadings: [0.8, 0.8, 0.8, 0.8, 0.8] },
    { name: 'f2', type: 'factor', indicators: items('y', 5, 6), loadings: [0.8, 0.8, 0.8, 0.8, 0.8] },
  ],
  paths: [],
  exoCor: [{ a: 'f1', b: 'f2', value: 0.25 }], skew: 0, kurtosis: 0,
};

export const CARD_MODEL: PackageExample[] = [
  {
    id: 'datasets-faithful-chart', package: 'datasets', title: 'Histogram: eruptions of Old Faithful', source: 'datasets, ?faithful (Härdle 1991; Azzalini & Bowman 1990)',
    links: [{ label: '?faithful', url: 'https://rdrr.io/r/datasets/faithful.html' }],
    description: 'Duration in minutes of 272 eruptions of the Old Faithful geyser in Yellowstone, the help page’s data: a histogram of the eruption times shows the two kinds of eruption, short ones around two minutes and long ones around four and a half (mean 3.49, SD 1.14). Change the card to a scatterplot of eruptions and waiting time, the help page’s second plot. Opens its card on the Analyses tab.',
    data: { package: 'datasets', name: 'faithful' }, constructs: [], paths: [],
    panel: { kind: 'chart', x: 'eruptions', y: '', group: '', bins: 0, fit: true }, settings: CB('ML'), tags: ['Distributions'],
  },
  {
    id: 'datasets-faithful-scatter', package: 'datasets', title: 'Scatterplot: eruption time against waiting time at Old Faithful', source: 'datasets, ?faithful (Härdle 1991; Azzalini & Bowman 1990)',
    links: [{ label: '?faithful', url: 'https://rdrr.io/r/datasets/faithful.html' }],
    description: 'The help page’s second plot: the duration of each of the 272 eruptions against the waiting time before it, with the least-squares line (plot(eruptions ~ waiting, data = faithful) with a fitted line). Longer waits are followed by longer eruptions: eruptions = −1.874 + 0.0756 × waiting, r = 0.90, and the two clusters of short and long eruptions show again. Opens its card on the Analyses tab.',
    data: { package: 'datasets', name: 'faithful' }, constructs: [], paths: [],
    panel: { kind: 'chart', options: { kind: 'scatter', x: 'waiting', y: 'eruptions', group: '', bins: 0, fit: true } }, settings: CB('ML'), tags: ['Regression'],
  },
  {
    id: 'lavaan-hs-bollenstine', package: 'lavaan', title: 'Bollen–Stine bootstrap: Holzinger & Swineford', source: 'lavaan, ?bootstrapLavaan (type = "bollen.stine")',
    links: [{ label: '?bootstrapLavaan', url: 'https://rdrr.io/cran/lavaan/man/bootstrapLavaan.html' }, ...HS_LINKS, { label: 'Bollen & Stine (1992)', url: 'https://doi.org/10.1177/0049124192021002004' }],
    description: 'The help page’s example: the three-factor CFA of the 301 children’s mental ability tests (χ² = 85.306, df = 24), and a bootstrap of the χ² test that does not assume multivariate normality (Bollen & Stine 1992): the data are transformed so that the model fits exactly, resampled and refitted. The help page draws 10 samples “in this example; in practice you may wish to use a much higher number”: here 1,000, with seed 1234. No bootstrap χ² reaches the observed one, so exact fit is rejected (p < .001), as the normal-theory test says. Opens its card on the Analyses tab beside the diagram.',
    data: { package: 'lavaan', name: 'HolzingerSwineford1939' }, constructs: HS, paths: [],
    panel: { kind: 'bollenstine' }, settings: { ...CB('ML'), bootSamples: 1000, seed: 1234 },
  },
  {
    id: 'lavaan-hs-wald', package: 'lavaan', title: 'Comparing loadings: critical ratios for differences', source: 'lavaan, ?lavTestWald (Holzinger & Swineford)',
    links: [{ label: '?lavTestWald', url: 'https://rdrr.io/cran/lavaan/man/lavTestWald.html' }, ...HS_LINKS],
    description: 'The model of lavTestWald’s help page: the three-factor CFA with the second loadings labelled b1 (x2), b2 (x5) and b3 (x8). The card tests every pair of free loadings for a difference, z = (a − b) / SE(a − b), AMOS’s critical ratios for differences; each z² is the Wald test of the pair held equal, so z(x5, x8)² is lavTestWald(fit, "b2 == b3"). Opens its card on the Analyses tab beside the diagram.',
    data: { package: 'lavaan', name: 'HolzingerSwineford1939' },
    constructs: [f('visual', items('x', 3), { x2: 'b1' }), f('textual', items('x', 3, 4), { x5: 'b2' }), f('speed', items('x', 3, 7), { x8: 'b3' })], paths: [],
    panel: { kind: 'cbcompare', kinds: ['loadings'] }, settings: CB('ML'),
  },
  {
    id: 'lavaan-hs-scoreweights', package: 'lavaan', title: 'Factor score weights: Holzinger & Swineford', source: 'lavaan, ?lavPredict (Holzinger & Swineford)',
    links: [{ label: '?lavPredict', url: 'https://rdrr.io/cran/lavaan/man/lavPredict.html' }, ...HS_LINKS],
    description: 'The model of lavPredict’s help page, the three-factor CFA: the weights by which the regression method (Thurstone; AMOS’s factor score weights) turns the nine tests into scores of visual, textual and speed. Applied to the centred tests they give exactly the scores of lavPredict(fit). Switch to Bartlett weights on the card. Opens its card on the Analyses tab beside the diagram.',
    data: { package: 'lavaan', name: 'HolzingerSwineford1939' }, constructs: HS, paths: [],
    panel: { kind: 'scoreweights', method: 'regression' }, settings: CB('ML'),
  },
  {
    id: 'seminr-corprep-predict', package: 'seminr', title: 'PLSpredict: corporate reputation', source: 'seminr, ?predict_pls; Hair et al. (2021), chapter 6',
    links: [{ label: '?predict_pls', url: 'https://rdrr.io/cran/seminr/man/predict_pls.html' }, { label: 'cSEM, ?predict', url: 'https://rdrr.io/cran/cSEM/man/predict.html' }, ...HAIR],
    description: 'The extended corporate reputation model of Hair et al. (2021), and its out-of-sample predictive power as in chapter 6: 10-fold cross-validation repeated 10 times, each indicator of competence, likeability, satisfaction and loyalty predicted by PLS and by a linear-regression benchmark (LM). The card predicts with cSEM from the exogenous constructs (seminr’s predict_EA); seminr’s predict_pls gives the same PLS errors within the noise of the random folds (its linear benchmark uses other predictors). Opens its card on the Analyses tab beside the diagram.',
    ...CORP_REP, panel: { kind: 'plspredict', folds: 10, repetitions: 10 }, settings: SEMINR({ seed: 123 }),
  },
  {
    id: 'seminr-mobi-compare', package: 'seminr', title: 'Model comparison: mediated or overriding effects?', source: 'seminr, demo("seminr-alternative-models") (mobi)',
    links: [{ label: 'demo seminr-alternative-models', url: 'https://github.com/sem-in-r/seminr/blob/master/demo/seminr-alternative-models.R' }, { label: '?mobi', url: 'https://rdrr.io/cran/seminr/man/mobi.html' }, { label: 'cSEM, ?testCVPAT', url: 'https://rdrr.io/cran/cSEM/man/testCVPAT.html' }],
    description: 'Two of the demo’s structural models on the same ECSI measurement: in the diagram, image, expectation and quality also act on loyalty and complaints directly (overriding effects); the saved alternative has them act only through satisfaction and value (mediated). The card compares them by information criteria per endogenous construct (the AIC and BIC seminr’s summary prints as it_criteria) and by CVPAT (Liengaard et al. 2021). Opens its card on the Analyses tab beside the diagram.',
    data: { package: 'seminr', name: 'mobi' }, constructs: MOBI, paths: MOBI_OVERRIDING,
    panel: { kind: 'compare', alternative: { paths: MOBI_MEDIATED, savedAt: 0 } }, settings: SEMINR({ seed: 123 }),
  },
  {
    id: 'seminr-corprep-cta', package: 'seminr', title: 'Confirmatory tetrad analysis: corporate reputation', source: 'seminr, corp_rep_data; Gudergan et al. (2008), CTA-PLS',
    links: [{ label: 'Gudergan et al. (2008)', url: 'https://doi.org/10.1016/j.jbusres.2008.03.012' }, ...HAIR],
    description: 'Are the formative drivers of the corporate reputation model (Hair et al. 2021) reflective after all? CTA-PLS tests the vanishing tetrads a common factor implies for the blocks with four or more indicators: quality (8 items), performance and corporate social responsibility (5 each). Bias-corrected bootstrap intervals (1,000 samples, seed 123), Bonferroni-adjusted within each block. No R package implements CTA-PLS; the tetrads are checked against a computation by hand. Opens its card on the Analyses tab beside the diagram.',
    ...CORP_REP, panel: { kind: 'cta' }, settings: SEMINR({ bootSamples: 1000, seed: 123 }),
  },
  {
    id: 'seminr-corprep-minsample', package: 'seminr', title: 'Minimum sample size: the inverse square root method', source: 'Kock & Hadaya (2018); seminr, corp_rep_data (Hair et al. 2021)',
    links: [{ label: 'Kock & Hadaya (2018)', url: 'https://doi.org/10.1111/isj.12131' }, ...HAIR],
    description: 'How many observations does the corporate reputation model need for its paths to be detected? Kock & Hadaya’s (2018) inverse square root method: n_min > (2.486 / |β|)² for a one-tailed test at 5% with 80% power, applied to every path of the estimated model (N = 344). Nine of the thirteen paths need fewer than the 344 observations there are; four would need more: competence → loyalty (β = 0.006), corporate social responsibility → competence (0.059), attractiveness → competence (0.086) and performance → likeability (0.117). Press Calculate, then Run on the card.',
    ...CORP_REP, panel: { kind: 'minsample', alpha: 0.05, power: 0.8, tails: 'one', source: 'model', beta: 0.2 }, settings: SEMINR({ seed: 123 }),
  },
  {
    id: 'plspm-pos', package: 'plspm', title: 'PLS-POS: the hidden segments of simdata', source: 'plspm simdata; PLS-POS (Becker, Rai, Ringle & Völckner 2013)',
    links: [{ label: '?simdata', url: 'https://rdrr.io/cran/plspm/man/simdata.html' }, { label: 'Becker et al. (2013)', url: 'https://doi.org/10.25300/MISQ/2013/37.3.01' }],
    description: 'The simulated customers of plspm (N = 400) once more: one half’s satisfaction follows price, the other’s quality. Prediction-oriented segmentation moves customers between two segments as long as the explained variance of satisfaction grows. No package implements PLS-POS: the app’s implementation (local models with cSEM) is checked by how well it recovers the segments the data were simulated with (the group column). Opens its card on the Analyses tab beside the diagram.',
    ...SIMDATA, panel: { kind: 'pos', segments: 2, nrep: 3 }, settings: { method: 'pls', plsPackage: 'cSEM', consistent: false, scheme: 'path', missing: 'casewise', seed: 1 },
  },
  {
    id: 'muthen-mc-cfa', package: 'lavaan', title: 'Monte Carlo: sample size for a factor correlation (Muthén & Muthén 2002)', source: 'Muthén & Muthén (2002), How to use a Monte Carlo study to decide on sample size and determine power: the CFA model',
    links: [{ label: 'Muthén & Muthén (2002)', url: 'https://doi.org/10.1207/S15328007SEM0904_8' }, { label: 'lavaan, ?simulateData', url: 'https://rdrr.io/cran/lavaan/man/simulateData.html' }],
    description: 'The paper’s CFA model: two factors of five indicators each, loadings .8, residual variances .36 and a correlation of .25 between the factors. With normal data and no missing values the paper finds that 150 observations give power .81 to detect the correlation. The card simulates the same population: 1,000 samples of 150, each fitted by ML (lavaan), with the bias, coverage and power of the correlation. The diagram is fitted to one sample of 150 from that population (lavaan::simulateData, the paper’s seed 53487). Opens its card on the Analyses tab beside the diagram.',
    data: { package: 'lavaan', name: 'Muthén & Muthén (2002), a sample of 150', file: 'examples/montecarlo/muthen2002.csv' },
    constructs: [f('f1', items('y', 5)), f('f2', items('y', 5, 6))], paths: [], correlations: [['f1', 'f2', 'construct']],
    panel: { kind: 'mc', population: MUTHEN_POPULATION, estimators: [{ id: 'CB-ML', method: 'cb', estimator: 'ML' }], sampleSizes: [150], replications: 1000, seed: 53487, alpha: 0.05, bootSamples: 0, mcDraws: 1000 },
    settings: CB('ML'),
  },
  {
    id: 'mulder-riclpm', package: 'lavaan', title: 'Random-intercept cross-lagged panel model (Mulder & Hamaker 2021)', source: 'Mulder & Hamaker (2021), Three extensions of the RI-CLPM: the basic RI-CLPM in lavaan',
    links: [{ label: 'The RI-CLPM & extensions: lavaan', url: 'https://jeroendmulder.github.io/RI-CLPM/lavaan.html' }, { label: 'Mulder & Hamaker (2021)', url: 'https://doi.org/10.1080/10705511.2020.1784738' }, { label: 'Hamaker, Kuiper & Grasman (2015)', url: 'https://doi.org/10.1037/a0038889' }],
    description: 'The tutorial’s simulated data (N = 1,189) on two variables at five waves, and its basic RI-CLPM: random intercepts separate stable differences between persons from fluctuations within them, which carry the autoregressive and cross-lagged effects (χ² = 25.81, df = 21; FIML, the tutorial’s missing = "ML", whose observed-information standard errors it reproduces). Within persons, x predicts later y (0.12 to 0.19), y hardly predicts later x. The card also fits the traditional cross-lagged panel model for comparison. Opens its card on the Analyses tab.',
    data: { package: 'lavaan', name: 'RICLPM (Mulder & Hamaker 2021)', remote: RICLPM_DATA }, constructs: [], paths: [],
    panel: { kind: 'riclpm', x: items('x', 5), y: items('y', 5), equal: false }, settings: { ...CB('ML'), missing: 'fiml' },
  },
];
