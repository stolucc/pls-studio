// Mplus User's Guide, chapter 4: exploratory factor analysis (see common.ts). TYPE = EFA examples open
// the EFA card with the lavaan extraction (lavaan's efa(): Mplus's standardised rotated loadings with
// standard errors, and the fit of every number of factors); ESEM examples are CB-SEM models.

import { CB, f, items } from '../define';
import type { PackageExample } from '../packages';
import { MPLUS_SRC, MPLUS_TAG, mplusData, mplusLinks } from './common';

export const MPLUS_CH4: PackageExample[] = [
  {
    id: 'mplus-ex4.1part1', package: 'lavaan', title: 'Exploratory factor analysis, 1 to 4 factors (Mplus ex. 4.1)', source: MPLUS_SRC('4.1'), links: mplusLinks('4.1part1'),
    description: 'Mplus’s first EFA example: twelve continuous indicators y1–y12 (N = 500) by maximum likelihood with 1 to 4 factors (Mplus: TYPE = EFA 1 4), geomin rotated. The EFA card with the lavaan extraction (lavaan’s efa()) fits each number of factors and shows the four-factor solution: standardised rotated loadings, factor correlations and residual variances with their standard errors, observed information as Mplus, and geomin’s ε = 0.01, Mplus’s value for four factors (it uses 0.0001 with one or two factors and 0.001 with three; set ε with the number of factors to see those solutions). Reproduces the Mplus output: the eigenvalues, the fit of each number of factors (χ² = 1055.754, 672.258, 341.268 and 25.799 on 54, 43, 33 and 24 df; log-likelihood −7869.377 with four factors, AIC, BIC, RMSEA, CFI, TLI, SRMR) and, for every number of factors, each rotated loading, factor correlation and residual variance with its standard error. Suitability (KMO, Bartlett) and the number-of-factors criteria come from psych. Opens its card on the Analyses tab.',
    data: mplusData('4.1part1'), tags: [MPLUS_TAG], constructs: [], paths: [],
    panel: { kind: 'efa', vars: items('y', 12), method: 'lavaan', criterion: 'fixed', nfactors: 4, from: 1, rotation: 'geominQ', epsilon: 0.01, information: 'observed', parallel: 0, correlation: 'pearson', missing: 'pairwise' }, settings: CB('ML'),
  },
  {
    id: 'mplus-ex4.1part2', package: 'lavaan', title: 'Four-factor EFA as exploratory SEM (Mplus ex. 4.1, part 2)', source: MPLUS_SRC('4.1'), links: mplusLinks('4.1part2'),
    description: 'The four-factor EFA of example 4.1 as exploratory SEM: f1–f4 load on all of y1–y12 (Mplus: f1-f4 BY y1-y12 (*1)) in one ESEM block, geomin rotated with ε = 0.01 (Mplus’s value for four factors), unstandardised and with the factor variances fixed at 1, so that the factors can enter a larger model. Intercepts and observed-information standard errors as Mplus. Reproduces the Mplus output: log-likelihood −7869.377, 66 free parameters, χ² = 25.799 on 24 df, and every estimate and standard error.',
    data: mplusData('4.1part2'), tags: [MPLUS_TAG, 'ESEM'],
    constructs: [f('f1', items('y', 3)), f('f2', items('y', 3, 4)), f('f3', items('y', 3, 7)), f('f4', items('y', 3, 10))], paths: [],
    esem: { blocks: [['f1', 'f2', 'f3', 'f4']], rotation: 'geomin', epsilon: 0.01 }, constant: true, information: 'observed', settings: CB('ML'),
  },
  {
    id: 'mplus-ex4.2', package: 'lavaan', title: 'Exploratory factor analysis of binary items, WLSMV (Mplus ex. 4.2)', source: MPLUS_SRC('4.2'), links: mplusLinks('4.2'),
    description: 'Twelve binary items u1–u12 (N = 500) declared categorical, 1 to 4 factors (Mplus: TYPE = EFA 1 4) by WLSMV from their tetrachoric correlations, geomin rotated (ε = 0.01 with four factors). The EFA card with polychoric correlations and the lavaan extraction estimates by WLSMV and shows the four-factor solution. Every rotated loading, factor correlation and residual variance is within 0.0011 of Mplus’s. The standard errors are slightly larger than Mplus’s: by up to 0.0065 for the loadings (u5 on its factor 0.078 against 0.072) and 0.008 for the residual variances; lavaan’s scaled and shifted χ² is within 0.3% of Mplus’s (729.259 against 730.699 with one factor, 22.749 against 22.796 with four, on the same df), and RMSEA, CFI and TLI agree. Mplus counts the free parameters without the 12 thresholds (42 with four factors; lavaan 54) and computes SRMR for categorical items differently (0.026 against 0.024). Opens its card on the Analyses tab.',
    data: mplusData('4.2'), tags: [MPLUS_TAG], constructs: [], paths: [],
    panel: { kind: 'efa', vars: items('u', 12), method: 'lavaan', criterion: 'fixed', nfactors: 4, from: 1, rotation: 'geominQ', epsilon: 0.01, parallel: 0, correlation: 'polychoric', missing: 'pairwise' }, settings: CB('ML'),
  },
  {
    id: 'mplus-ex4.7', package: 'lavaan', title: 'Bifactor exploratory factor analysis, bi-geomin (Mplus ex. 4.7)', source: MPLUS_SRC('4.7'), links: mplusLinks('4.7'),
    description: 'A bifactor EFA of y1–y10 (N = 5000) with 2 and 3 factors (Mplus: TYPE = EFA 2 3; ROTATION = BI-GEOMIN): a general factor loading on every item and specific factors, the general factor uncorrelated with the specific ones. The EFA card with the lavaan extraction and the bi-geomin rotation (ε = 0.001, Mplus’s value for three factors) shows the three-factor solution and the fit of both. Reproduces Mplus’s fit (χ² = 90.091 on 26 df and 24.364 on 18 df; log-likelihood −100433.997 with three factors, AIC, BIC, RMSEA, CFI, TLI), every rotated loading and factor correlation within 0.001, and the residual variances with their standard errors. The standard errors of the rotated loadings and of the factor correlation differ from Mplus’s, which does not document how it computes them under bi-geomin: lavaan’s are mostly smaller (the loading of y4 on the general factor 0.149 against 0.302, the factor correlation 0.088 against 0.182). Mplus’s EFA prints SRMR 0.014 and 0.007, while its ESEM of the same model and data (example 5.29) prints 0.006, as lavaan (0.012 and 0.006). Opens its card on the Analyses tab.',
    data: mplusData('4.7'), tags: [MPLUS_TAG, 'Bifactor'], constructs: [], paths: [],
    panel: { kind: 'efa', vars: items('y', 10), method: 'lavaan', criterion: 'fixed', nfactors: 3, from: 2, rotation: 'bigeomin', epsilon: 0.001, information: 'observed', parallel: 0, correlation: 'pearson', missing: 'pairwise' }, settings: CB('ML'),
  },
];
