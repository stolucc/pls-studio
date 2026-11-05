// Mplus User's Guide, chapter 3 (see common.ts).

import { CB, fan, v } from '../define';
import type { PackageExample } from '../packages';
import { MPLUS_SRC, MPLUS_TAG, mplusData, mplusLinks, regression } from './common';

export const MPLUS_CH3: PackageExample[] = [
  {
    id: 'mplus-ex3.1', package: 'stats', title: 'Linear regression (Mplus ex. 3.1)', source: MPLUS_SRC('3.1'), links: mplusLinks('3.1'),
    description: 'Mplus’s first example: a linear regression of y1 on x1 and x3 (generated data, N = 500). R’s lm gives the coefficients and the log-likelihood Mplus prints (−694.334). Mplus estimates by maximum likelihood, R by least squares: the residual variance (Mplus 0.941) and the standard errors (Mplus 0.043, 0.042, 0.044) are divided by N there and by N − 3 here, so the card’s are about 0.3% larger (residual standard deviation 0.973, standard errors up to 0.001 larger). Opens its card on the Analyses tab.',
    data: mplusData('3.1', 'stats'), constructs: [], paths: [], tags: [MPLUS_TAG],
    panel: regression('gaussian', 'identity', 'y1', ['x1', 'x3']), settings: CB('ML'),
  },
  {
    id: 'mplus-ex3.2', package: 'stats', title: 'Censored (tobit) regression (Mplus ex. 3.2)', source: MPLUS_SRC('3.2'), links: mplusLinks('3.2'),
    description: 'y1, censored from below at its lowest value (0; 376 of 1000 cases), regressed on x1 and x3 (Mplus: CENSORED ARE y1 (b), ESTIMATOR = MLR): a normal model for the latent outcome, fitted by survival’s survreg. Reproduces the Mplus output: log-likelihood −1142.885, 4 free parameters, AIC 2293.771, BIC 2313.402, the coefficients, the residual variance (1.148, from survreg’s log scale) and, with HC0 (the maximum-likelihood sandwich, Mplus’s MLR), every standard error. Opens its card on the Analyses tab.',
    data: mplusData('3.2', 'stats'), constructs: [], paths: [], tags: [MPLUS_TAG, 'Censored outcome'],
    panel: { ...regression('censored', 'logit', 'y1', ['x1', 'x3']), se: 'HC0' }, settings: CB('ML'),
  },
  {
    id: 'mplus-ex3.3', package: 'stats', title: 'Censored-inflated regression (Mplus ex. 3.3)', source: MPLUS_SRC('3.3'), links: mplusLinks('3.3'),
    description: 'y1 censored from below at 0 with more zeros than a censored-normal model allows (Mplus: CENSORED ARE y1 (bi)): a tobit regression on x1 and x3 and an inflation part, a logistic regression on x1 and x3 for the probability of an extra zero (y1#1 ON x1 x3). The card fits it by maximum likelihood written out in R (optim; no R package offers this model). Reproduces the Mplus output: log-likelihood −501.525, 7 free parameters, AIC 1017.051, BIC 1046.553, both parts’ coefficients, the residual variance (1.156) and, with HC0 (Mplus’s default MLR), every standard error. Opens its card on the Analyses tab.',
    data: mplusData('3.3', 'stats'), constructs: [], paths: [], tags: [MPLUS_TAG, 'Censored outcome'],
    panel: { ...regression('censored', 'logit', 'y1', ['x1', 'x3']), inflated: true, se: 'HC0' }, settings: CB('ML'),
  },
  {
    id: 'mplus-ex3.4', package: 'lavaan', title: 'Probit regression, WLSMV (Mplus ex. 3.4)', source: MPLUS_SRC('3.4'), links: mplusLinks('3.4'),
    description: 'A binary u1 (CATEGORICAL) regressed on x1 and x3 with Mplus’s default estimator for categorical outcomes, WLSMV: a probit regression of the latent response u1* (variance 1 given the covariates). lavaan’s WLSMV with u1 declared ordered reproduces the Mplus output: the slopes 1.023 and 2.474, the threshold 0.984, and their standard errors (0.121, 0.224, 0.119; lavaan’s for x3 is 0.2250, Mplus’s 0.224), with 0 degrees of freedom. A maximum-likelihood probit (glm) gives the same estimates but larger standard errors (0.127, 0.228, 0.126).',
    data: mplusData('3.4'), tags: [MPLUS_TAG, 'Path analysis'],
    syntax: 'u1 ~ x1 + x3', constructs: [], paths: [], ordered: ['u1'], settings: CB('WLSMV'),
  },
  {
    id: 'mplus-ex3.5', package: 'stats', title: 'Logistic regression (Mplus ex. 3.5)', source: MPLUS_SRC('3.5'), links: mplusLinks('3.5'),
    description: 'A binary u1 regressed on x1 and x3 by maximum likelihood (Mplus: ESTIMATOR = ML, log-likelihood −202.620). R’s glm with a logit link gives the same coefficients and log-likelihood. Opens its card on the Analyses tab.',
    data: mplusData('3.5', 'stats'), constructs: [], paths: [], tags: [MPLUS_TAG, 'Logistic regression'],
    panel: regression('binomial', 'logit', 'u1', ['x1', 'x3']), settings: CB('ML'),
  },
  {
    id: 'mplus-ex3.6', package: 'nnet', title: 'Multinomial logistic regression (Mplus ex. 3.6)', source: MPLUS_SRC('3.6'), links: mplusLinks('3.6'),
    description: 'An unordered u1 with three categories (0, 1, 2; Mplus: NOMINAL IS u1) regressed on x1 and x3, the last category the reference, as in Mplus (u1#1 is category 0 against 2, u1#2 category 1 against 2). nnet’s multinom reproduces the Mplus output: log-likelihood −433.426, 6 free parameters, AIC 878.853, BIC 904.140, every coefficient and, with HC0 (the sandwich of the scores, Mplus’s default MLR), every standard error. Opens its card on the Analyses tab.',
    data: mplusData('3.6', 'nnet'), constructs: [], paths: [], tags: [MPLUS_TAG, 'Multinomial outcome'],
    panel: { ...regression('multinomial', 'logit', 'u1', ['x1', 'x3']), reference: 'last', se: 'HC0' }, settings: CB('ML'),
  },
  {
    id: 'mplus-ex3.7', package: 'stats', title: 'Poisson regression (Mplus ex. 3.7)', source: MPLUS_SRC('3.7'), links: mplusLinks('3.7'),
    description: 'A count u1 regressed on x1 and x3 by Poisson regression. R’s glm with a log link gives the coefficients and the log-likelihood Mplus prints (−966.884). Mplus’s default estimator for counts is MLR, whose standard errors are White’s sandwich without a small-sample correction (HC0), so the card is set to HC0 and reproduces them: 0.027, 0.026 and 0.030 for x1, x3 and the intercept (HC3, the card’s small-sample choice, gives 0.028, 0.026 and 0.030). Opens its card on the Analyses tab.',
    data: mplusData('3.7', 'stats'), constructs: [], paths: [], tags: [MPLUS_TAG, 'Count data'],
    panel: { ...regression('poisson', 'log', 'u1', ['x1', 'x3']), se: 'HC0' }, settings: CB('ML'),
  },
  {
    id: 'mplus-ex3.8part1', package: 'stats', title: 'Zero-inflated Poisson regression (Mplus ex. 3.8)', source: MPLUS_SRC('3.8'), links: mplusLinks('3.8part1'),
    description: 'A count u1 regressed on x1 and x3 with extra zeros (Mplus: COUNT IS u1 (i)): a Poisson regression and an inflation part, a logistic regression on x1 and x3 for the probability of a structural zero (u1#1 ON x1 x3). The card fits it by maximum likelihood written out in R (optim). Reproduces the first part of Mplus’s example 3.8: log-likelihood −758.855, 6 free parameters, AIC 1529.710, BIC 1554.998, both parts’ coefficients and, with HC0 (Mplus’s default MLR), every standard error. Opens its card on the Analyses tab.',
    data: mplusData('3.8part1', 'stats'), constructs: [], paths: [], tags: [MPLUS_TAG, 'Count data'],
    panel: { ...regression('poisson', 'log', 'u1', ['x1', 'x3']), inflated: true, se: 'HC0' }, settings: CB('ML'),
  },
  {
    id: 'mplus-ex3.8part2', package: 'MASS', title: 'Negative binomial regression (Mplus ex. 3.8)', source: MPLUS_SRC('3.8'), links: mplusLinks('3.8part2'),
    description: 'The second part of Mplus’s example 3.8: an over-dispersed count u1 regressed on x1 and x3 (Mplus: COUNT IS u1 (nb)). MASS’s glm.nb reproduces the log-likelihood (−1087.414), AIC 2182.829, BIC 2199.687 and the coefficients. Mplus reports the dispersion α = 1/θ: 2.388 (θ = 0.419 on the card). With HC0 the card computes the sandwich over the coefficients and θ together, Mplus’s MLR: standard errors 0.074 for each coefficient and 0.200 for α (by the delta method from θ’s); glm.nb’s model-based ones are 0.075, 0.075 and 0.076. Opens its card on the Analyses tab.',
    data: mplusData('3.8part2', 'MASS'), constructs: [], paths: [], tags: [MPLUS_TAG, 'Count data'],
    panel: { ...regression('negbin', 'log', 'u1', ['x1', 'x3']), se: 'HC0' }, settings: CB('ML'),
  },
  {
    id: 'mplus-ex3.11', package: 'lavaan', title: 'Path analysis with observed variables (Mplus ex. 3.11)', source: MPLUS_SRC('3.11'), links: mplusLinks('3.11'),
    description: 'Three covariates x1–x3 explain y1 and y2, which with x2 explain y3: Mplus’s path analysis of observed variables, conditional on the covariates (no residual covariance between y1 and y2). As in Mplus, the intercepts are estimated (the constant on the canvas) and the standard errors come from the observed information. Reproduces the Mplus output: log-likelihood −2364.002, 15 free parameters, χ² = 0.757 on 3 df, and every estimate and standard error.',
    data: mplusData('3.11'), tags: [MPLUS_TAG, 'Path analysis'],
    constructs: [v('x1', true), v('x2', true), v('x3', true), v('y1'), v('y2'), v('y3')],
    paths: [...fan(['x1', 'x2', 'x3'], ['y1', 'y2']), ['y1', 'y3'], ['y2', 'y3'], ['x2', 'y3']], constant: true, information: 'observed', settings: CB('ML'),
  },
];
