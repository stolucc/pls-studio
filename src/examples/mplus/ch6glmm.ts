// Mplus User's Guide, chapter 6: growth models for counts (examples 6.6 and 6.7), fitted as generalized linear
// mixed models on the GLMM card with Mplus's integration rule (its option; GLMMadaptive without it; see common.ts). Mplus's
// growth factors are the random effects: i the intercept, s the slope of time.

import { CB, items } from '../define';
import type { PackageExample } from '../packages';
import { MPLUS_SRC, MPLUS_TAG, mplusData, mplusLinks } from './common';

const WIDE = {
  layout: 'wide' as const,
  outcome: '',
  cluster: '',
  occasions: items('u1', 4),
  times: [0, 1, 2, 3],
  predictors: [],
  categorical: [],
};

export const MPLUS_CH6GLMM: PackageExample[] = [
  {
    id: 'mplus-ex6.6',
    package: 'GLMMadaptive',
    title: 'Linear growth model for a count outcome, Poisson (Mplus ex. 6.6)',
    source: MPLUS_SRC('6.6'),
    links: mplusLinks('6.6'),
    description:
      'A linear growth model for a Poisson count u11–u14 at four occasions (time scores 0–3; Mplus: COUNT = u11-u14; i s | u11@0 u12@1 u13@2 u14@3; MLR, 15 integration points). The growth factors i and s are the random intercept and the random slope of time of a Poisson mixed model, which the GLMM card fits on the wide data with Mplus’s integration rule (the card’s option: 15 rectangular points per dimension over ±5 standard deviations, adaptive to each person’s posterior means and standard deviations of the standardised random effects, as Mplus; robust standard errors as MLR). Reproduces the Mplus output: log-likelihood −3446.328 (Mplus −3446.329), 5 free parameters, AIC 6902.657 (6902.658), BIC 6923.730 (6923.732), the means of i and s (0.204 and 0.039), their variances 0.372 and 0.094 (Mplus 0.373 and 0.094) and covariance 0.022, all within 0.001, and every standard error within 0.0005. Mplus’s log-likelihood is its rule’s approximation: the exact maximum, which GLMMadaptive’s adaptive Gauss–Hermite quadrature reaches (the card without the option), is −3446.345, with estimates within 0.0015 of these. Opens its card on the Analyses tab.',
    shows:
      'With Mplus’s integration rule the GLMM card matches Mplus to three decimals: log-likelihood −3446.328 (Mplus −3446.329), 5 free parameters, means of i and s 0.204 and 0.039, variances 0.372 and 0.094. The slope mean 0.039 (SE 0.025) is a small, uncertain growth in the log rate. Without the option the exact maximum is −3446.345.',
    data: mplusData('6.6', 'GLMMadaptive'),
    tags: [MPLUS_TAG],
    constructs: [],
    paths: [],
    panel: {
      kind: 'glmm',
      ...WIDE,
      slopes: ['time'],
      family: 'poisson',
      ziPredictors: [],
      ziRandom: false,
      quadrature: 15,
      robust: true,
      integration: 'mplus',
    },
    settings: CB('ML'),
  },
  {
    id: 'mplus-ex6.7',
    package: 'GLMMadaptive',
    title: 'Linear growth model for a count outcome, zero-inflated Poisson (Mplus ex. 6.7)',
    source: MPLUS_SRC('6.7'),
    links: mplusLinks('6.7'),
    description:
      'A linear growth model for a zero-inflated Poisson count u11–u14 (Mplus: COUNT = u11-u14 (i); i s | u11@0 … u14@3; ii si | u11#1@0 … u14#1@3; s@0 si@0; INTEGRATION = 7; MLR): a zero-inflated Poisson mixed model with a random intercept in the count part (i) and in the zero part (ii, correlated with i), fixed slopes of time in both parts (s, si) and the zero part’s intercept equal over time (Mplus’s u#1 intercepts). The GLMM card fits it with Mplus’s integration rule (the card’s option) and Mplus’s 7 points per dimension: rectangular, adaptive, over ±3.5 standard deviations (Mplus’s range for 7 points; it is ±5 for 15), which reproduces the Mplus output: log-likelihood −2778.140, 7 free parameters, AIC 5570.280, BIC 5599.782 (Mplus 5599.783), every estimate within 0.001 except the variance of the zero part’s random intercept ii, 1.186 against 1.189 (SE 0.535; the likelihood is flat in it and Mplus stops at its convergence criterion), and every standard error within 0.0005. Seven points are too few for this likelihood: its exact maximum (GLMMadaptive’s adaptive Gauss–Hermite quadrature with 15 points, the card without the option) is −2778.078, where ii’s variance is 1.226 and its covariance with i −0.196. Opens its card on the Analyses tab.',
    shows:
      'With 7-point integration as Mplus: log-likelihood −2778.140, 7 free parameters, all within 0.001 except ii’s variance, 1.186 against 1.189 (SE 0.535), where the likelihood is flat. The zero part’s slope si −0.484 (SE 0.093) says structural zeros become rarer over time. The exact maximum, without the option, is −2778.078: seven points are too few.',
    data: mplusData('6.7', 'GLMMadaptive'),
    tags: [MPLUS_TAG],
    constructs: [],
    paths: [],
    panel: {
      kind: 'glmm',
      ...WIDE,
      slopes: [],
      family: 'zip',
      ziPredictors: ['time'],
      ziRandom: true,
      quadrature: 7,
      robust: true,
      integration: 'mplus',
    },
    settings: CB('ML'),
  },
];
