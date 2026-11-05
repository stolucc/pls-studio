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
const dropout = (t: number) => ({ name: `d${t}`, expr: [`(1 - isna(y${t - 1}))`, ...Array.from({ length: 6 - t }, (_, k) => `isna(y${t + k})`)].join(' * ') });

export const MPLUS_CH11: PackageExample[] = [
  {
    id: 'mplus-ex11.1', package: 'lavaan', title: 'Growth model with a missing-data correlate (Mplus ex. 11.1)', source: MPLUS_SRC('11.1'), links: mplusLinks('11.1'),
    description: 'Linear growth of y1–y4 with missing values (FIML), and z, which is not in the model, as a correlate of missingness to make missing at random more plausible (Mplus: AUXILIARY = (m) z). Mplus’s (m) auxiliary is Graham’s saturated-correlates model: z correlated with every outcome’s residual, with its own mean and variance, which leaves the growth model’s fit and parameters unchanged in meaning; the syntax on the growth card writes it out. Reproduces the Mplus output: log-likelihood −1009.197, χ² = 3.930 on 5 df, AIC 2048.394 and BIC 2097.869 (with the 6 parameters of z, 15 in all; Mplus counts 9 for the growth model), and every estimate and standard error of the growth model. Opens its card on the Analyses tab.',
    data: mplusData('11.1'), constructs: [], paths: [], tags: [MPLUS_TAG],
    panel: { kind: 'growth', measures: items('y', 4), times: [0, 1, 2, 3], shape: 'linear', covariates: [], syntax: AUXILIARY }, information: 'observed', settings: { ...CB('ML'), missing: 'fiml' },
  },
  {
    id: 'mplus-ex11.4', package: 'lavaan', title: 'Pattern-mixture model for data not missing at random (Mplus ex. 11.4)', source: MPLUS_SRC('11.4'), links: mplusLinks('11.4'),
    description: 'Linear growth of y0–y5 (FIML) with the growth factors regressed on dropout dummies d1–d5, so each dropout pattern has its own trajectory: a pattern-mixture model. d_t is 1 for a person whose last observation is at t − 1 (Mplus: DATA MISSING: TYPE = DDROPOUT), computed here as columns from the missing values: 33, 35, 54, 40 and 151 of the 1000 drop out at times 1–5. The slope’s shifts for d1 and d2 are held equal (Mplus: i ON d1-d5; s ON d3-d5; s ON d1 (1); s ON d2 (1)). Reproduces the Mplus output: log-likelihood −5454.840, 20 free parameters, χ² = 31.090 on 37 df, and every estimate; the standard errors agree within 0.001 except that of the shared slope shift, 0.160 here and 0.156 in Mplus’s output (0.160 is also what the numerical Hessian of the likelihood gives). Opens its card on the Analyses tab.',
    data: mplusData('11.4'), constructs: [], paths: [], tags: [MPLUS_TAG], computed: [1, 2, 3, 4, 5].map(dropout),
    panel: { kind: 'growth', measures: items('y', 6, 0), times: [0, 1, 2, 3, 4, 5], shape: 'linear', covariates: [], syntax: PATTERN_MIXTURE }, information: 'observed', settings: { ...CB('ML'), missing: 'fiml' },
  },
  {
    id: 'mplus-ex11.6', package: 'lavaan', title: 'Growth model on multiply imputed data (Mplus ex. 11.6)', source: MPLUS_SRC('11.6'), links: mplusLinks('11.6'),
    description: 'Linear growth of y1–y4 regressed on x1 and x2 (Mplus: i s | y1@0 y2@1 y3@2 y4@3; i s ON x1 x2), with missing values in every variable (29–58% of y1–y4, 17% of the binary x1, 22% of x2), estimated on 10 imputed data sets and pooled by Rubin’s rules (Mplus: DATA IMPUTATION: IMPUTE = y1-y4 x1 (c) x2; NDATASETS = 10). Mplus imputes from a Bayesian unrestricted (H1) model; here Missing values → multiple imputation with mice’s Bayesian normal regression (a draw from the posterior of a normal model for each continuous variable, logistic regression for x1, marked categorical), 10 data sets, lavaan.mi pooling. Imputation is random, so the pooled estimates differ from Mplus’s by Monte Carlo error: within three Monte Carlo standard errors of the difference of two pooled estimates (√(2B/10), B the between-imputation variance) for every parameter, the regressions on x1 and x2, the growth factors’ intercepts, residual variances and covariance, and the outcomes’ residual variances; the standard errors likewise. (Predictive mean matching, mice’s default, misses Mplus’s s on x2 by more than that: 0.17 against 0.224.)',
    data: mplusData('11.6'), constructs: [], paths: [], tags: [MPLUS_TAG, 'Growth curve'],
    syntax: 'i =~ 1*y1 + 1*y2 + 1*y3 + 1*y4\ns =~ 0*y1 + 1*y2 + 2*y3 + 3*y4\ni + s ~ x1 + x2\ni ~~ s\ni ~ 1\ns ~ 1\ny1 ~ 0*1\ny2 ~ 0*1\ny3 ~ 0*1\ny4 ~ 0*1',
    settings: { ...CB('ML'), missing: 'mi', miImputations: 10, miMethod: 'micenorm', miNominal: ['x1'], seed: 11 },
  },
];
