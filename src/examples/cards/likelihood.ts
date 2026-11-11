// Examples of the custom likelihood, Bayesian multivariate regression and two-level EFA cards, each checked against the
// R help page or textbook it follows, in cards/likelihood.webr.test.ts.

import { CB } from '../define';
import type { PackageExample } from '../packages';

export const CARD_LIKELIHOOD: PackageExample[] = [
  {
    id: 'stats-customml-cars',
    package: 'datasets',
    title: 'A regression written as a likelihood: stopping distances',
    source: 'datasets, ?cars (lm(log(dist) ~ log(speed)))',
    links: [
      { label: '?cars', url: 'https://rdrr.io/r/datasets/cars.html' },
      { label: '?lm', url: 'https://rdrr.io/r/stats/lm.html' },
    ],
    description:
      'The stopping distances of 50 cars against their speed (1920s), on the log scale as on R’s ?cars help page: log(dist) = b0 + b1·log(speed) + error. Written for the custom likelihood card: the mean of ldist (the computed column log(dist)) is the expression b0 + b1*log(speed), in which the data column speed varies from car to car, and its variance the parameter s2. Maximum likelihood gives lm’s coefficients (−0.730 and 1.602) and the variance RSS/n (lm’s σ² times (n − 2)/n), and the observed-information standard errors are lm’s times √((n − 2)/n). Opens its card on the Analyses tab.',
    shows:
      'The likelihood recovers lm’s coefficients, −0.730 and 1.602, and lm’s log-likelihood. The differences are the point: the variance is RSS/n rather than lm’s RSS/(n − 2), and the standard errors are lm’s times √((n − 2)/n), slightly smaller, because ML does not correct for the two estimated coefficients. The mean has no single value in the table, since it varies with speed.',
    data: { package: 'datasets', name: 'cars' },
    constructs: [],
    paths: [],
    tags: ['Regression'],
    computed: [{ name: 'ldist', expr: 'log(dist)' }],
    panel: {
      kind: 'customml',
      type: 'normal',
      outcomes: ['ldist'],
      parameters: [
        { name: 'b0', start: 0 },
        { name: 'b1', start: 1 },
        { name: 's2', start: 1 },
      ],
      logits: [],
      means: ['b0 + b1*log(speed)'],
      variances: ['s2'],
      covariances: [],
      defined: [{ name: 'sigma', expr: 'sqrt(s2)' }],
      se: 'model',
    },
    settings: CB('ML'),
  },
  {
    id: 'stats-bmvreg-mtcars',
    package: 'datasets',
    title: 'Bayesian multivariate regression with flat priors: fuel use and quarter-mile time',
    source: 'datasets, ?mtcars; Box & Tiao (1973), ch. 8',
    links: [
      { label: '?mtcars', url: 'https://rdrr.io/r/datasets/mtcars.html' },
      {
        label: '?lm (a matrix response: lm(cbind(…) ~ …))',
        url: 'https://rdrr.io/r/stats/lm.html',
      },
    ],
    description:
      'Fuel use (mpg) and quarter-mile time (qsec) of 32 cars regressed together on weight (wt) and horsepower (hp), by Bayes with flat priors on the coefficients and the residual covariance matrix. Box & Tiao (1973, ch. 8) give the posterior: the coefficients’ marginals are multivariate t around the least-squares estimates of lm(cbind(mpg, qsec) ~ wt + hp), so their posterior medians are lm’s coefficients, and the residual covariance matrix is inverse Wishart with N − k − p − 1 = 26 degrees of freedom around the residual cross-products, so each residual variance’s median is an inverse-gamma quantile. The card draws 50,000 times from that posterior for the SDs, intervals and the residual covariance. Opens its card on the Analyses tab.',
    shows:
      'With flat priors the posterior medians of the six coefficients equal the least-squares estimates of lm(cbind(mpg, qsec) ~ wt + hp), and each residual variance’s median is Box & Tiao’s inverse-gamma quantile on 26 degrees of freedom; the posterior means from 50,000 draws agree within Monte Carlo error. Bayes adds intervals and the residual covariance here, not different estimates.',
    data: { package: 'datasets', name: 'mtcars' },
    constructs: [],
    paths: [],
    panel: {
      kind: 'bmvreg',
      outcomes: ['mpg', 'qsec'],
      predictors: ['wt', 'hp'],
      draws: 50000,
      seed: 1,
    },
    settings: CB('ML'),
  },
  {
    id: 'lavaan-efa2l-twolevel',
    package: 'lavaan',
    title: 'Two-level exploratory factor analysis: one factor within and between clusters',
    source: 'lavaan tutorial: multilevel SEM, ?Demo.twolevel',
    links: [
      {
        label: 'lavaan tutorial: multilevel SEM',
        url: 'https://lavaan.ugent.be/tutorial/multilevel.html',
      },
      { label: '?Demo.twolevel', url: 'https://rdrr.io/cran/lavaan/man/Demo.twolevel.html' },
    ],
    description:
      'lavaan’s simulated two-level data (2500 people in 200 clusters): the items y1–y3, which the tutorial’s model measures by a factor within clusters and one between them (fw =~ y1 + y2 + y3 at level 1, fb =~ y1 + y2 + y3 at level 2), factor-analysed exploratorily on the two-level EFA card with one factor at each level and, for comparison, an unrestricted between level. With one factor per level there is nothing to rotate: the card’s standardised loadings, residual variances, standard errors and log-likelihood are those of the tutorial’s measurement model fitted by lavaan (standardizedSolution). Opens its card on the Analyses tab.',
    shows:
      'Two solutions: one factor within and one between (1/1), and one factor within with an unrestricted between level (1/U). The 1/1 solution is the tutorial’s two-level measurement model: the same log-likelihood, standardised loadings and standard errors as lavaan’s standardizedSolution, since one factor per level leaves nothing to rotate. The 1/U between level has no loadings to show.',
    data: { package: 'lavaan', name: 'Demo.twolevel' },
    constructs: [],
    paths: [],
    panel: {
      kind: 'efa2l',
      items: ['y1', 'y2', 'y3'],
      cluster: 'cluster',
      within: [1],
      between: [1, 'U'],
    },
    settings: CB('ML'),
  },
];
