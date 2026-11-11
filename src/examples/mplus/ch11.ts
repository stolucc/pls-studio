// Mplus User's Guide, chapter 11 (see common.ts).

import { CB, items } from '../define';
import type { PackageExample } from '../packages';
import { MPLUS_SRC, MPLUS_TAG, mplusData, mplusLinks } from './common';

// Mplus's AUXILIARY = (m) z: Graham's (2003) saturated correlates, z correlated with every outcome's residual.
const AUXILIARY = `i =~ 1*y1 + 1*y2 + 1*y3 + 1*y4
s =~ 0*y1 + 1*y2 + 2*y3 + 3*y4
# the missing-data correlate z (Mplus: AUXILIARY = (m) z)
z ~~ y1 + y2 + y3 + y4
z ~ 1`;
const PATTERN_MIXTURE = `i =~ 1*y0 + 1*y1 + 1*y2 + 1*y3 + 1*y4 + 1*y5
s =~ 0*y0 + 1*y1 + 2*y2 + 3*y3 + 4*y4 + 5*y5
# the growth factors by dropout pattern; the slope shifts equal for dropout at times 1 and 2
i ~ d1 + d2 + d3 + d4 + d5
s ~ b12*d1 + b12*d2 + d3 + d4 + d5`;
/** Mplus's DATA MISSING: TYPE = DDROPOUT: d_t is 1 for the occasion t at which a person drops out (y_t and every later occasion missing, y_t−1 observed). */
const dropout = (t: number) => ({
  name: `d${t}`,
  expr: [
    `(1 - isna(y${t - 1}))`,
    ...Array.from({ length: 6 - t }, (_, k) => `isna(y${t + k})`),
  ].join(' * '),
});

// ex11.5's TYPE = BASIC on imputed data: the unrestricted model (means, variances and covariances), whose pooled
// estimates are the averages over the imputed data sets that Mplus prints.
const BASIC_115 = ['x1', 'x2', 'y1', 'y2', 'y3', 'y4', 'z1', 'z2', 'z3', 'z4', 'z5'];
const SATURATED_115 = [
  ...BASIC_115.slice(0, -1).map((a, i) => `${a} ~~ ${BASIC_115.slice(i + 1).join(' + ')}`),
  ...BASIC_115.map((a) => `${a} ~ 1`),
].join('\n');

export const MPLUS_CH11: PackageExample[] = [
  {
    id: 'mplus-ex11.1',
    package: 'lavaan',
    title: 'Growth model with a missing-data correlate (Mplus ex. 11.1)',
    source: MPLUS_SRC('11.1'),
    links: mplusLinks('11.1'),
    description:
      'Linear growth of y1–y4 with missing values (FIML), and z, which is not in the model, as a correlate of missingness to make missing at random more plausible (Mplus: AUXILIARY = (m) z). Mplus’s (m) auxiliary is Graham’s saturated-correlates model: z correlated with every outcome’s residual, with its own mean and variance, which leaves the growth model’s fit and parameters unchanged in meaning; the syntax on the growth card writes it out. Reproduces the Mplus output: log-likelihood −1009.197, χ² = 3.930 on 5 df, AIC 2048.394 and BIC 2097.869 (with the 6 parameters of z, 15 in all; Mplus counts 9 for the growth model), and every estimate and standard error of the growth model. Opens its card on the Analyses tab.',
    shows:
      'Log-likelihood −1009.197, χ² = 3.930 on 5 df, and the growth factors as Mplus prints them: intercept mean 1.417 (SE 0.096), slope mean 2.011 (0.057), variances 1.101 and 0.261. The parameter count reads 15 where Mplus says 9: Mplus leaves out z’s mean, variance and four covariances, which the card’s syntax writes out; the log-likelihood, AIC and BIC include them in both.',
    data: mplusData('11.1'),
    constructs: [],
    paths: [],
    tags: [MPLUS_TAG],
    panel: {
      kind: 'growth',
      measures: items('y', 4),
      times: [0, 1, 2, 3],
      shape: 'linear',
      covariates: [],
      syntax: AUXILIARY,
    },
    information: 'observed',
    settings: { ...CB('ML'), missing: 'fiml' },
  },
  {
    id: 'mplus-ex11.2',
    package: 'lavaan',
    title: 'Descriptive statistics for dropout in a longitudinal study (Mplus ex. 11.2)',
    source: MPLUS_SRC('11.2'),
    links: mplusLinks('11.2'),
    description:
      'Six repeated measures y0–y5 with dropout and intermittent missing values (N = 1000), and five binary covariates z1–z5, described as Mplus’s TYPE = BASIC with DATA MISSING: TYPE = DDROPOUT describes them. The dropout indicators d1–d5 are computed columns (d_t = 1 for a case observed at t − 1 and missing from t on: 33, 35, 54, 40 and 151 cases). The missing-data card shows the 32 missing-data patterns in Mplus’s order with their frequencies, the covariance coverage, the EM estimates of the 16 variables’ means and covariances (the unrestricted model by FIML), and the dropout descriptives: 313 dropouts, 299 non-dropouts with complete data and 388 with intermittent missing values, and for each y and z (Mplus: DESCRIPTIVE = y0-y5 | * z1-z5, z_t at occasion t) the number observed, mean and SD among those who drop out after the occasion and those who do not, all dropouts and non-dropouts with and without intermittent missing values, and the whole sample. Reproduces the Mplus output: every pattern and frequency, every coverage, every EM mean and covariance within 0.001, and every count, mean and SD of the dropout tables. Mplus’s H1 log-likelihood (−2974.677) is not a maximum: the dropout indicators are functions of the missingness, so the covariance matrix of all 16 variables is singular at the EM solution (smallest eigenvalue about 2·10⁻⁸) and the likelihood grows without bound as EM goes on; Mplus’s value is where its EM stops, and the card shows none. Opens its card on the Analyses tab.',
    shows:
      'The descriptives Mplus’s TYPE = BASIC with DDROPOUT prints: 32 missing-data patterns and frequencies, the coverage, the EM means and covariances within 0.001, and the dropout tables (313 dropouts, 299 complete non-dropouts, 388 with intermittent gaps). No H1 log-likelihood is shown: the covariance matrix is singular at the EM solution, so Mplus’s −2974.677 is where its EM stopped, not a maximum.',
    data: mplusData('11.2'),
    constructs: [],
    paths: [],
    tags: [MPLUS_TAG, 'Missing data'],
    computed: [1, 2, 3, 4, 5].map(dropout),
    panel: {
      kind: 'missingdata',
      vars: [...items('z', 5), ...items('y', 6, 0), ...items('d', 5)],
      measures: items('y', 6, 0),
      descriptive: ['', ...items('z', 5)],
      mcar: false,
      jamjal: false,
    },
    settings: CB('ML'),
  },
  {
    id: 'mplus-ex11.4',
    package: 'lavaan',
    title: 'Pattern-mixture model for data not missing at random (Mplus ex. 11.4)',
    source: MPLUS_SRC('11.4'),
    links: mplusLinks('11.4'),
    description:
      'Linear growth of y0–y5 (FIML) with the growth factors regressed on dropout dummies d1–d5, so each dropout pattern has its own trajectory: a pattern-mixture model. d_t is 1 for a person whose last observation is at t − 1 (Mplus: DATA MISSING: TYPE = DDROPOUT), computed here as columns from the missing values: 33, 35, 54, 40 and 151 of the 1000 drop out at times 1–5. The slope’s shifts for d1 and d2 are held equal (Mplus: i ON d1-d5; s ON d3-d5; s ON d1 (1); s ON d2 (1)). Reproduces the Mplus output: log-likelihood −5454.840, 20 free parameters, χ² = 31.090 on 37 df, and every estimate; the standard errors agree within 0.001 except that of the shared slope shift, 0.160 here and 0.156 in Mplus’s output (0.160 is also what the numerical Hessian of the likelihood gives). Opens its card on the Analyses tab.',
    shows:
      'Log-likelihood −5454.840, 20 free parameters, χ² = 31.090 on 37 df, and the dropout shifts as Mplus prints them: i on d1–d5 from 0.543 to 0.123, s on d3–d5 0.375, 0.328 and 0.234, the shared slope shift for d1 and d2 0.421. Every standard error agrees within 0.001 except that shared shift’s: 0.160 here against Mplus’s 0.156, and 0.160 is what a numerical Hessian gives.',
    data: mplusData('11.4'),
    constructs: [],
    paths: [],
    tags: [MPLUS_TAG],
    computed: [1, 2, 3, 4, 5].map(dropout),
    panel: {
      kind: 'growth',
      measures: items('y', 6, 0),
      times: [0, 1, 2, 3, 4, 5],
      shape: 'linear',
      covariates: [],
      syntax: PATTERN_MIXTURE,
    },
    information: 'observed',
    settings: { ...CB('ML'), missing: 'fiml' },
  },
  {
    id: 'mplus-ex11.5',
    package: 'lavaan',
    title: 'Multiple imputation with descriptive statistics (Mplus ex. 11.5)',
    source: MPLUS_SRC('11.5'),
    links: mplusLinks('11.5'),
    description:
      'Ten imputed data sets for x1, x2 and y1–y4 (14–19% missing each; x1 binary and declared categorical), with the complete z1–z5 in the imputation model (Mplus: DATA IMPUTATION: IMPUTE = y1-y4 x1 (c) x2; NDATASETS = 10; v1–v10 travel with the data and are not used), then TYPE = BASIC: the means and covariances of the 11 variables averaged over the imputed data sets. Mplus imputes from a Bayesian estimation of the unrestricted (H1) model; here Missing values → multiple imputation with the joint H1 imputation, which does the same: data augmentation under the unrestricted multivariate normal model with flat priors, x1 through a latent normal response with a threshold (marked categorical), a data set every 100 iterations after 1000. The unrestricted model (every mean, variance and covariance free) fitted to each imputed data set and pooled by Rubin’s rules gives the averages Mplus prints. Imputation is random: every mean and covariance is within three Monte Carlo standard errors of the difference of two averages over 10 data sets (√(2B/10), B the between-imputation variance), and Mplus’s averages are within 2.3 Monte Carlo standard errors (√(B/10)) of what the imputation gives on average, estimated from 200 imputed data sets: over the 57 means, variances and covariances that involve imputed values the mean squared standardised difference is 0.98, as for an average of 10 draws from the same imputation model. The complete z1–z5 have their sample values.',
    shows:
      'The pooled means and covariances of the 11 variables over 10 imputed data sets (x1’s mean 0.526, x2’s −0.004), against Mplus’s averages from its own imputations. Imputation is random, so agreement is within Monte Carlo error, not to the decimal: every estimate within three Monte Carlo standard errors, Mplus’s averages within 2.3 of this imputation’s expectation. z1–z5 are complete.',
    data: mplusData('11.5'),
    constructs: [],
    paths: [],
    tags: [MPLUS_TAG],
    syntax: SATURATED_115,
    settings: {
      ...CB('ML'),
      missing: 'mi',
      miImputations: 10,
      miMethod: 'joint',
      miNominal: ['x1'],
      seed: 5,
    },
  },
  {
    id: 'mplus-ex11.6',
    package: 'lavaan',
    title: 'Growth model on multiply imputed data (Mplus ex. 11.6)',
    source: MPLUS_SRC('11.6'),
    links: mplusLinks('11.6'),
    description:
      'Linear growth of y1–y4 regressed on x1 and x2 (Mplus: i s | y1@0 y2@1 y3@2 y4@3; i s ON x1 x2), with missing values in every variable (29–58% of y1–y4, 17% of the binary x1, 22% of x2), estimated on 10 imputed data sets and pooled by Rubin’s rules (Mplus: DATA IMPUTATION: IMPUTE = y1-y4 x1 (c) x2; NDATASETS = 10). Mplus imputes from a Bayesian unrestricted (H1) model; here Missing values → multiple imputation with mice’s Bayesian normal regression (a draw from the posterior of a normal model for each continuous variable, logistic regression for x1, marked categorical), 10 data sets, lavaan.mi pooling. Imputation is random, so the pooled estimates differ from Mplus’s by Monte Carlo error: within three Monte Carlo standard errors of the difference of two pooled estimates (√(2B/10), B the between-imputation variance) for every parameter, the regressions on x1 and x2, the growth factors’ intercepts, residual variances and covariance, and the outcomes’ residual variances; the standard errors likewise. (Predictive mean matching, mice’s default, misses Mplus’s s on x2 by more than that: 0.17 against 0.224.)',
    shows:
      'Pooled growth estimates over 10 imputed data sets against Mplus’s: i on x1 1.053 and x2 0.323, s on x1 0.189 and x2 0.224, each within three Monte Carlo standard errors of Mplus’s because imputation is random; the standard errors likewise. A warning that some estimated variances are negative is expected: y4’s residual variance is near zero in Mplus too (0.340, SE 0.254).',
    data: mplusData('11.6'),
    constructs: [],
    paths: [],
    tags: [MPLUS_TAG, 'Growth curve'],
    syntax:
      'i =~ 1*y1 + 1*y2 + 1*y3 + 1*y4\ns =~ 0*y1 + 1*y2 + 2*y3 + 3*y4\ni + s ~ x1 + x2\ni ~~ s\ni ~ 1\ns ~ 1\ny1 ~ 0*1\ny2 ~ 0*1\ny3 ~ 0*1\ny4 ~ 0*1',
    settings: {
      ...CB('ML'),
      missing: 'mi',
      miImputations: 10,
      miMethod: 'micenorm',
      miNominal: ['x1'],
      seed: 11,
    },
    expectedMessages: [
      {
        pattern: 'some estimated ov variances are negative',
        level: 'warning',
        why: 'Mplus’s own estimate of y4’s residual variance is near zero (0.340, SE 0.254), so some imputed data sets give a negative one; the pooled estimate is what the example compares.',
      },
    ],
  },
  {
    id: 'mplus-ex11.7',
    package: 'blavaan',
    title: 'Plausible values from a Bayesian growth model of categorical items (Mplus ex. 11.7)',
    source: MPLUS_SRC('11.7'),
    links: mplusLinks('11.7'),
    description:
      'Nine binary items, u1–u3 at three occasions (u11 u21 u31, u12 …), measure a factor per occasion, f1–f3, with loadings and thresholds equal over time (labels lam2, lam3 and th1–th3), and the factors follow a linear growth model (Mplus: i s | f1@0 f2@1 f3@2; the intercept factor’s mean fixed at 0, the slope’s free; ESTIMATOR = BAYES). Probit links, the latent responses’ residual variances fixed at 1, as Mplus’s Bayes. The Bayesian SEM card fits it by MCMC (blavaan’s data augmentation, Stan, desktop R) with Mplus’s default priors: N(0, 5) for the items’ loadings and thresholds, flat for the slope’s mean and the variances, and draws 20 plausible values of every case’s factor scores (Mplus: SAVE = FSCORES(20); DATA IMPUTATION: NDATASETS = 20), summarised as Mplus’s SUMMARIES OF PLAUSIBLE VALUES does. The card’s posterior medians (3 chains of 2,000 after 1,000 burn-in) agree with Mplus’s within 0.34 posterior SDs (the slope’s mean 0.950 against 0.930; the loadings 1.080 and 1.139 against 1.081 and 1.147; the thresholds −0.662, −0.016, 0.487 against −0.661, −0.017, 0.488), and the SDs within 22% except two that Mplus puts below the large-sample standard error of the same model (lavaan WLSMV, theta parameterisation): the slope’s mean, 0.061 in Mplus, 0.101 by WLSMV, 0.107 here, and f2’s residual variance, 0.114, 0.127 and 0.162: Gibbs sampling with data augmentation mixes slowly for these, and Mplus stopped after 2,900 iterations. The plausible values agree with Mplus’s summaries: means over the 500 cases and 20 draws of f1, f2, f3, i and s −0.002, 0.968, 1.905, 0.005, 0.964 (Mplus −0.008, 0.966, 1.898, −0.001, 0.959), and the cases’ own SDs, averaged, within 11% (s 0.273 against 0.247). (blavaan 0.6’s draws of the occasion factors lack the slope’s mean; the card adds it back.) Random draws: results move with the seed. Opens its card on the Analyses tab.',
    shows:
      'Posterior medians within 0.34 posterior SDs of Mplus’s (slope mean 0.950 against 0.930; loadings 1.080 and 1.139 against 1.081 and 1.147), and 20 plausible values per case summarised as Mplus does (mean of s 0.964 against 0.959). Two posterior SDs exceed Mplus’s (the slope mean 0.107 against 0.061; WLSMV gives 0.101): Mplus’s short Gibbs run mixes slowly there. Results move with the seed.',
    data: mplusData('11.7', 'blavaan'),
    tags: [MPLUS_TAG, 'Bayesian', 'Growth', 'Plausible values'],
    constructs: [],
    paths: [],
    syntax: [
      'f1 =~ 1*u11 + lam2*u21 + lam3*u31',
      'f2 =~ 1*u12 + lam2*u22 + lam3*u32',
      'f3 =~ 1*u13 + lam2*u23 + lam3*u33',
      'u11 | th1*t1',
      'u12 | th1*t1',
      'u13 | th1*t1',
      'u21 | th2*t1',
      'u22 | th2*t1',
      'u23 | th2*t1',
      'u31 | th3*t1',
      'u32 | th3*t1',
      'u33 | th3*t1',
      'i =~ 1*f1 + 1*f2 + 1*f3',
      's =~ 0*f1 + 1*f2 + 2*f3',
      'i ~~ s',
      'i ~ 0*1',
      's ~ 1',
      'f1 ~ 0*1',
      'f2 ~ 0*1',
      'f3 ~ 0*1',
    ].join('\n'),
    ordered: ['u11', 'u21', 'u31', 'u12', 'u22', 'u32', 'u13', 'u23', 'u33'],
    settings: CB('WLSMV'),
    panel: {
      kind: 'bsem',
      identification: 'marker',
      chains: 3,
      burnin: 1000,
      sample: 2000,
      priors: 'mplus',
      plausible: 20,
    },
  },
];
