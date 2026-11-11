// Examples that open the Dynamic fit cutoffs card: the help-page examples of the dynamic package (Wolf & McNeish; the
// maintained repository, versioned 1.1.0, whose CRAN release is archived) on the models they use, with their exact
// data, sample sizes and replication counts; the package draws with fixed seeds of its own. Checked against the package
// run natively in cards/dfi.webr.test.ts.

import { CB, f, items } from '../define';
import type { PackageExample } from '../packages';

const HS = [f('F1', items('x', 3)), f('F2', items('x', 3, 4)), f('F3', items('x', 3, 7))];
const DYNAMIC = [
  { label: 'dynamic (GitHub)', url: 'https://github.com/melissagwolf/dynamic' },
  { label: 'dynamicfit.app', url: 'https://dynamicfit.app/' },
];
const HS_LINK = {
  label: '?HolzingerSwineford1939',
  url: 'https://rdrr.io/cran/lavaan/man/HolzingerSwineford1939.html',
};
const MCNEISH_WOLF = {
  label: 'McNeish & Wolf (2023), Psychological Methods',
  url: 'https://doi.org/10.1037/met0000425',
};
const HS_DATA = { package: 'lavaan' as const, name: 'HolzingerSwineford1939' };
const EXAMPLE_DATA = { package: 'dynamic' as const, name: 'Example' };
const CARD =
  'Opens its card on the Analyses tab beside the diagram; the simulations take a while (minutes in the browser), and the Model fit tab shows the cutoffs beside Hu & Bentler’s once the card has run.';

export const CARD_DFI: PackageExample[] = [
  {
    id: 'dynamic-hs-cfahb',
    package: 'dynamic',
    title: 'Dynamic fit cutoffs: the three-factor CFA (cfaHB)',
    source: 'dynamic, ?cfaHB and the vignette (Holzinger & Swineford)',
    links: [
      { label: '?cfaHB', url: 'https://github.com/melissagwolf/dynamic/blob/master/man/cfaHB.Rd' },
      {
        label: 'Vignette: DFI cutoffs for CFA models',
        url: 'https://github.com/melissagwolf/dynamic/blob/master/vignettes/CFA.Rmd',
      },
      MCNEISH_WOLF,
      HS_LINK,
      ...DYNAMIC,
    ],
    description:
      'The help page’s and vignette’s example: the three-factor CFA of the 301 children’s mental ability tests (χ² = 85.306, df = 24, SRMR .065, RMSEA .092, CFI .931), and cfaHB’s cutoffs adapted from Hu & Bentler (1999): 500 replications per level with the package’s fixed seeds, one level per omitted cross-loading (two for three factors, magnitudes .424 and .570). Level 1’s cutoffs (SRMR .041, RMSEA .042, CFI .985) are reached with less than 95% sensitivity because the correct and the misspecified distributions overlap; the model misses Level 2’s (SRMR .060, RMSEA .086, CFI .957) too, so its fit is equivalent to at least two missing cross-loadings, as the vignette reads it. ' +
      CARD,
    shows:
      'Poor fit by this method: SRMR .065, RMSEA .092 and CFI .931 are on the wrong side of Level 2’s cutoffs (.060, .086, .957), the worse of the two misspecifications simulated, so the verdict table reads the model as equivalent to at least two omitted cross-loadings. Level 1’s cutoffs are weak (85–90% sensitivity).',
    data: HS_DATA,
    constructs: HS,
    paths: [],
    panel: {
      kind: 'dynamicfit',
      fn: 'cfaHB',
      reps: 500,
      estimator: '',
      scale: 'normal',
      mad: [0.038, 0.05, 0.06],
    },
    settings: CB('ML'),
  },
  {
    id: 'dynamic-hs-cfaone',
    package: 'dynamic',
    title: 'Dynamic fit cutoffs: a one-factor model of the nine tests (cfaOne)',
    source: 'dynamic, ?cfaOne (Holzinger & Swineford)',
    links: [
      {
        label: '?cfaOne',
        url: 'https://github.com/melissagwolf/dynamic/blob/master/man/cfaOne.Rd',
      },
      MCNEISH_WOLF,
      HS_LINK,
      ...DYNAMIC,
    ],
    description:
      'The help page’s example: all nine tests on one factor (χ² = 312.264, df = 27, SRMR .143, RMSEA .187, CFI .677), and cfaOne’s three levels of omitted residual correlations, scaled to the number of items, 500 replications each with the package’s fixed seeds: Level 1 SRMR .043, RMSEA .041, CFI .977 (87% and 86% sensitivity for RMSEA and CFI); Level 3 SRMR .067, RMSEA .083, CFI .926. The one-factor model clears none of them. ' +
      CARD,
    shows:
      'The one-factor model clears no level: SRMR .143, RMSEA .187 and CFI .677 are far beyond even Level 3’s cutoffs (.067, .083, .926), the most severe misspecification simulated. Level 1 is barely distinguishable from a correct model (RMSEA .041 at both), hence its 86–87% sensitivity.',
    data: HS_DATA,
    constructs: [f('F1', items('x', 9))],
    paths: [],
    panel: {
      kind: 'dynamicfit',
      fn: 'cfaOne',
      reps: 500,
      estimator: '',
      scale: 'normal',
      mad: [0.038, 0.05, 0.06],
    },
    settings: CB('ML'),
  },
  {
    id: 'dynamic-hs-exactfit',
    package: 'dynamic',
    title: 'Dynamic fit cutoffs: the test of exact fit (exactFit)',
    source: 'dynamic, ?exactFit (Holzinger & Swineford)',
    links: [
      {
        label: '?exactFit',
        url: 'https://github.com/melissagwolf/dynamic/blob/master/man/exactFit.Rd',
      },
      HS_LINK,
      ...DYNAMIC,
    ],
    description:
      'The help page’s example on the three-factor CFA: 500 data sets generated from the model exactly as estimated (simstandard, the package’s fixed seed) and refitted, giving the values an exactly fitting model exceeds 1% and 5% of the time: χ² 42.447 and 36.553 (df 24), SRMR .043 and .040, RMSEA .051 and .042, CFI .977 and .985. The model’s χ² of 85.306 is far beyond the 99th percentile. ' +
      CARD,
    shows:
      'The observed χ² of 85.306 is far beyond the 99th percentile an exactly fitting model gives (42.447 on 24 df; 36.553 at the 95th), and SRMR .065, RMSEA .092 and CFI .931 are beyond .043, .051 and .977 likewise. The verdict table reads the model as inconsistent with exact fit.',
    data: HS_DATA,
    constructs: HS,
    paths: [],
    panel: {
      kind: 'dynamicfit',
      fn: 'exactFit',
      reps: 500,
      estimator: '',
      scale: 'normal',
      mad: [0.038, 0.05, 0.06],
    },
    settings: CB('ML'),
  },
  {
    id: 'dynamic-hs-equivtest',
    package: 'dynamic',
    title: 'Equivalence testing: T-size RMSEA and CFI (equivTest)',
    source: 'dynamic, ?equivTest (Holzinger & Swineford); Yuan, Chan, Marcoulides & Bentler (2016)',
    links: [
      {
        label: '?equivTest',
        url: 'https://github.com/melissagwolf/dynamic/blob/master/man/equivTest.Rd',
      },
      {
        label: 'Yuan, Chan, Marcoulides & Bentler (2016)',
        url: 'https://doi.org/10.1080/10705511.2015.1065414',
      },
      HS_LINK,
      ...DYNAMIC,
    ],
    description:
      'The help page’s example, by lavaan object or by hand (n = 301, χ² = 85.306, df = 24, baseline χ² = 918.852, p = 9): the T-size RMSEA of .114 and T-size CFI of .870 the data cannot reject at the 5% level, against the conventional cutoffs adjusted for this df and N (RMSEA: excellent ≤ .048, close to .075, fair to .103, mediocre to .122; CFI: excellent ≥ .965, close from .906, fair from .864, mediocre from .837). Both T-size values fall in the mediocre bin. No simulation: the card runs at once. Opens its card on the Analyses tab beside the diagram.',
    shows:
      'No simulation: T-size RMSEA .114 and T-size CFI .870 are the worst values the data cannot rule out at 5%, and both land in the mediocre bin of the cutoffs adjusted for n = 301 and 24 df (RMSEA .103 to .122, CFI .837 to .864). By lavaan object or by hand, the same two values.',
    data: HS_DATA,
    constructs: HS,
    paths: [],
    panel: {
      kind: 'dynamicfit',
      fn: 'equivTest',
      reps: 500,
      estimator: '',
      scale: 'normal',
      mad: [0.038, 0.05, 0.06],
    },
    settings: CB('ML'),
  },
  {
    id: 'dynamic-holzinger-dddfi',
    package: 'dynamic',
    title: 'Direct discrepancy DFI cutoffs (DDDFI): Holzinger & Swineford',
    source: 'dynamic, ?DDDFI (the package’s Holzinger data)',
    links: [
      { label: '?DDDFI', url: 'https://github.com/melissagwolf/dynamic/blob/master/man/DDDFI.Rd' },
      {
        label: '?Holzinger (dynamic)',
        url: 'https://github.com/melissagwolf/dynamic/blob/master/man/Holzinger.Rd',
      },
      ...DYNAMIC,
    ],
    description:
      'The help page’s example: the three-factor CFA on the package’s copy of the Holzinger & Swineford data (N = 301), and the direct discrepancy DFI cutoffs for arbitrary covariance structure models: misspecifications defined by a mean absolute discrepancy of .038, .05 and .06 between the misspecified population’s correlations and the model’s (recreating “close”, “fair” and “mediocre”), 250 replications each with the package’s fixed seeds, multivariate normal data and ML. The table gives CFI and RMSEA cutoffs per level, and a cutoff for the upper limit of the RMSEA 90% confidence interval. ' +
      CARD,
    shows:
      'Poor fit again: CFI .931 and RMSEA .092 miss even the Mediocre cutoffs (CFI .966, RMSEA .064), and the upper limit of the RMSEA 90% CI, .114, is beyond its .087. Close, Fair and Mediocre are defined by the discrepancy of the misspecified correlations (.038, .05, .06), not by an omitted cross-loading.',
    data: { package: 'dynamic', name: 'Holzinger' },
    constructs: HS,
    paths: [],
    panel: {
      kind: 'dynamicfit',
      fn: 'DDDFI',
      reps: 250,
      estimator: '',
      scale: 'normal',
      mad: [0.038, 0.05, 0.06],
    },
    settings: CB('ML'),
  },
  {
    id: 'dynamic-example-catone',
    package: 'dynamic',
    title: 'Dynamic fit cutoffs for ordinal items: one factor (catOne)',
    source: 'dynamic, ?catOne (its Example data, WLSMV)',
    links: [
      {
        label: '?catOne',
        url: 'https://github.com/melissagwolf/dynamic/blob/master/man/catOne.Rd',
      },
      {
        label: '?Example (dynamic)',
        url: 'https://github.com/melissagwolf/dynamic/blob/master/man/Example.Rd',
      },
      { label: 'McNeish (2023), categorical DFI', url: 'https://doi.org/10.1037/met0000471' },
      ...DYNAMIC,
    ],
    description:
      'The help page’s example: five of the package’s twelve 5-point Likert items (X5 to X9, N = 500) on one factor, declared ordered and fitted by WLSMV, and catOne’s cutoffs: the misspecified populations are simulated as categorical data with the items’ thresholds and fitted by WLSMV, 250 replications per level with the package’s fixed seeds. ' +
      CARD,
    shows:
      'Fit that passes: SRMR .032, RMSEA .048 and CFI .989 (χ² 10.682 on 5 df, p = .058) are on the good side of Level 1’s cutoffs (.040, .072, .979), the mildest misspecification simulated, so the verdict table reads the one-factor model as consistent with a correct one. The cutoffs come from categorical data and WLSMV, not normal data.',
    data: EXAMPLE_DATA,
    constructs: [f('F1', items('X', 5, 5))],
    paths: [],
    ordered: items('X', 5, 5),
    panel: {
      kind: 'dynamicfit',
      fn: 'catOne',
      reps: 250,
      estimator: '',
      scale: 'categorical',
      mad: [0.038, 0.05, 0.06],
    },
    settings: CB('WLSMV'),
  },
  {
    id: 'dynamic-example-cathb',
    package: 'dynamic',
    title: 'Dynamic fit cutoffs for ordinal items: two factors (catHB)',
    source: 'dynamic, ?catHB (its Example data, WLSMV)',
    links: [
      { label: '?catHB', url: 'https://github.com/melissagwolf/dynamic/blob/master/man/catHB.Rd' },
      {
        label: '?Example (dynamic)',
        url: 'https://github.com/melissagwolf/dynamic/blob/master/man/Example.Rd',
      },
      { label: 'McNeish (2023), categorical DFI', url: 'https://doi.org/10.1037/met0000471' },
      ...DYNAMIC,
    ],
    description:
      'The help page’s example: two correlated factors of the package’s Likert items (X1 to X3; X6 to X9; N = 500), declared ordered and fitted by WLSMV, and catHB’s cutoffs for one omitted cross-loading (two factors give one level), simulated as categorical data, 250 replications with the package’s fixed seeds. ' +
      CARD,
    shows:
      'A model that looks fine but fails: SRMR .042, RMSEA .044 and CFI .977 (χ² 25.767 on 13 df) are on the wrong side of the one level’s cutoffs (.039, .036, .984), so the fit is read as poor by this method. The cutoffs are strict because the omitted cross-loading is small (.233) and hard to detect (72–77% sensitivity).',
    data: EXAMPLE_DATA,
    constructs: [f('F1', items('X', 3)), f('F2', items('X', 4, 6))],
    paths: [],
    ordered: [...items('X', 3), ...items('X', 4, 6)],
    panel: {
      kind: 'dynamicfit',
      fn: 'catHB',
      reps: 250,
      estimator: '',
      scale: 'categorical',
      mad: [0.038, 0.05, 0.06],
    },
    settings: CB('WLSMV'),
  },
  {
    id: 'dynamic-example-likertone',
    package: 'dynamic',
    title: 'Dynamic fit cutoffs for Likert items treated as continuous (likertOne)',
    source: 'dynamic, ?likertOne (its Example data)',
    links: [
      {
        label: '?likertOne',
        url: 'https://github.com/melissagwolf/dynamic/blob/master/man/likertOne.Rd',
      },
      {
        label: '?Example (dynamic)',
        url: 'https://github.com/melissagwolf/dynamic/blob/master/man/Example.Rd',
      },
      ...DYNAMIC,
    ],
    description:
      'The help page’s example: the one-factor model of X5 to X9 (N = 500) fitted by ML as if the 5-point items were continuous, and likertOne’s cutoffs, whose simulated items keep the data’s response categories and frequencies (250 replications per level, the package’s fixed seeds) rather than being normal. ' +
      CARD,
    shows:
      'The fit passes easily: SRMR .024, RMSEA .032 and CFI .993 (χ² 7.577 on 5 df, p = .181) clear Level 1’s cutoffs (.036, .065, .962) and even Level 0, the correct model’s own 95th percentile. Compare with catOne on the same five items: treating them as continuous gives different cutoffs, not only a different fit.',
    data: EXAMPLE_DATA,
    constructs: [f('F1', items('X', 5, 5))],
    paths: [],
    panel: {
      kind: 'dynamicfit',
      fn: 'likertOne',
      reps: 250,
      estimator: '',
      scale: 'normal',
      mad: [0.038, 0.05, 0.06],
    },
    settings: CB('ML'),
  },
  {
    id: 'dynamic-example-nnorone',
    package: 'dynamic',
    title: 'Dynamic fit cutoffs for non-normal data: one factor (nnorOne)',
    source: 'dynamic, ?nnorOne (its Example data, MLR)',
    links: [
      {
        label: '?nnorOne',
        url: 'https://github.com/melissagwolf/dynamic/blob/master/man/nnorOne.Rd',
      },
      {
        label: '?Example (dynamic)',
        url: 'https://github.com/melissagwolf/dynamic/blob/master/man/Example.Rd',
      },
      ...DYNAMIC,
    ],
    description:
      'The help page’s example: the one-factor model of X5 to X9 (N = 500) fitted by ML, and nnorOne’s cutoffs for continuous non-normal data: a modified Bollen–Stine bootstrap of the data creates the correctly specified and the misspecified samples (omitted residual correlations), which keep the data’s non-normality, fitted by MLR; 500 replications per level with the package’s fixed seeds. ' +
      CARD,
    shows:
      'The same model and fit as the likertOne example (SRMR .024, RMSEA .032, CFI .993 on 5 df), passing again, with other cutoffs: .036, .062 and .973 at Level 1 against likertOne’s .036, .065 and .962. The bootstrap keeps the data’s own non-normality where likertOne keeps its response categories.',
    data: EXAMPLE_DATA,
    constructs: [f('F1', items('X', 5, 5))],
    paths: [],
    panel: {
      kind: 'dynamicfit',
      fn: 'nnorOne',
      reps: 500,
      estimator: '',
      scale: 'normal',
      mad: [0.038, 0.05, 0.06],
    },
    settings: CB('ML'),
  },
  {
    id: 'dynamic-example-likerthb',
    package: 'dynamic',
    title: 'Dynamic fit cutoffs for Likert items treated as continuous: two factors (likertHB)',
    source: 'dynamic, ?likertHB (its Example data)',
    links: [
      {
        label: '?likertHB',
        url: 'https://github.com/melissagwolf/dynamic/blob/master/man/likertHB.Rd',
      },
      {
        label: '?Example (dynamic)',
        url: 'https://github.com/melissagwolf/dynamic/blob/master/man/Example.Rd',
      },
      ...DYNAMIC,
    ],
    description:
      'The help page’s example: two correlated factors (X2 to X4; X6 to X8; N = 500) fitted by ML with the items as continuous, and likertHB’s cutoffs for one omitted cross-loading, the simulated items keeping the data’s response frequencies (250 replications, the package’s fixed seeds). ' +
      CARD,
    shows:
      'The two-factor model passes: SRMR .026, RMSEA .031 and CFI .992 (χ² 11.886 on 8 df, p = .156) are well inside Level 1’s cutoffs (.045, .078, .959) for one omitted cross-loading of .537. The nnorHB example fits the same model and derives its cutoffs from a bootstrap of the data instead; compare the two tables.',
    data: EXAMPLE_DATA,
    constructs: [f('F1', items('X', 3, 2)), f('F2', items('X', 3, 6))],
    paths: [],
    panel: {
      kind: 'dynamicfit',
      fn: 'likertHB',
      reps: 250,
      estimator: '',
      scale: 'normal',
      mad: [0.038, 0.05, 0.06],
    },
    settings: CB('ML'),
  },
  {
    id: 'dynamic-example-nnorhb',
    package: 'dynamic',
    title: 'Dynamic fit cutoffs for non-normal data: two factors (nnorHB)',
    source: 'dynamic, ?nnorHB (its Example data, MLR)',
    links: [
      {
        label: '?nnorHB',
        url: 'https://github.com/melissagwolf/dynamic/blob/master/man/nnorHB.Rd',
      },
      {
        label: '?Example (dynamic)',
        url: 'https://github.com/melissagwolf/dynamic/blob/master/man/Example.Rd',
      },
      ...DYNAMIC,
    ],
    description:
      'The help page’s example: the two-factor model of X2 to X4 and X6 to X8 (N = 500) fitted by ML, and nnorHB’s cutoffs for continuous non-normal data: a modified Bollen–Stine bootstrap of the data creates the correctly specified and the misspecified samples (one omitted cross-loading), which keep the data’s non-normality, fitted by MLR; 500 replications with the package’s fixed seeds. ' +
      CARD,
    shows:
      'The same model and fit as the likertHB example (SRMR .026, RMSEA .031, CFI .992 on 8 df), passing again, but with other cutoffs: .053, .099 and .953 at Level 1 against likertHB’s .045, .078 and .959. Resampling the data keeps its non-normality and MLR estimates the simulations; the cutoff depends on how the misspecified world is generated.',
    data: EXAMPLE_DATA,
    constructs: [f('F1', items('X', 3, 2)), f('F2', items('X', 3, 6))],
    paths: [],
    panel: {
      kind: 'dynamicfit',
      fn: 'nnorHB',
      reps: 500,
      estimator: '',
      scale: 'normal',
      mad: [0.038, 0.05, 0.06],
    },
    settings: CB('ML'),
  },
];
