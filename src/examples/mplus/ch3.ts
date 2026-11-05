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
    id: 'mplus-ex3.5', package: 'stats', title: 'Logistic regression (Mplus ex. 3.5)', source: MPLUS_SRC('3.5'), links: mplusLinks('3.5'),
    description: 'A binary u1 regressed on x1 and x3 by maximum likelihood (Mplus: ESTIMATOR = ML, log-likelihood −202.620). R’s glm with a logit link gives the same coefficients and log-likelihood. Opens its card on the Analyses tab.',
    data: mplusData('3.5', 'stats'), constructs: [], paths: [], tags: [MPLUS_TAG, 'Logistic regression'],
    panel: regression('binomial', 'logit', 'u1', ['x1', 'x3']), settings: CB('ML'),
  },
  {
    id: 'mplus-ex3.7', package: 'stats', title: 'Poisson regression (Mplus ex. 3.7)', source: MPLUS_SRC('3.7'), links: mplusLinks('3.7'),
    description: 'A count u1 regressed on x1 and x3 by Poisson regression. R’s glm with a log link gives the coefficients and the log-likelihood Mplus prints (−966.884). Mplus’s default estimator for counts is MLR, whose standard errors are White’s sandwich without a small-sample correction (HC0), so the card is set to HC0 and reproduces them: 0.027, 0.026 and 0.030 for x1, x3 and the intercept (HC3, the card’s small-sample choice, gives 0.028, 0.026 and 0.030). Opens its card on the Analyses tab.',
    data: mplusData('3.7', 'stats'), constructs: [], paths: [], tags: [MPLUS_TAG, 'Count data'],
    panel: { ...regression('poisson', 'log', 'u1', ['x1', 'x3']), se: 'HC0' }, settings: CB('ML'),
  },
  {
    id: 'mplus-ex3.11', package: 'lavaan', title: 'Path analysis with observed variables (Mplus ex. 3.11)', source: MPLUS_SRC('3.11'), links: mplusLinks('3.11'),
    description: 'Three covariates x1–x3 explain y1 and y2, which with x2 explain y3: Mplus’s path analysis of observed variables, conditional on the covariates (no residual covariance between y1 and y2). As in Mplus, the intercepts are estimated (the constant on the canvas) and the standard errors come from the observed information. Reproduces the Mplus output: log-likelihood −2364.002, 15 free parameters, χ² = 0.757 on 3 df, and every estimate and standard error.',
    data: mplusData('3.11'), tags: [MPLUS_TAG, 'Path analysis'],
    constructs: [v('x1', true), v('x2', true), v('x3', true), v('y1'), v('y2'), v('y3')],
    paths: [...fan(['x1', 'x2', 'x3'], ['y1', 'y2']), ['y1', 'y3'], ['y2', 'y3'], ['x2', 'y3']], constant: true, information: 'observed', settings: CB('ML'),
  },
];
