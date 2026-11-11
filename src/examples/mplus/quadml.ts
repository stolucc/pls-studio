// Mplus User's Guide: the models Mplus fits by numerical integration (ALGORITHM = INTEGRATION), on the integration
// card (analyses/quadml.tsx; see common.ts), written in Mplus's own syntax (the input without TITLE, DATA, NAMES and
// OUTPUT) and fitted in R (R/quadml.R) with Mplus's integration rule and MLR standard errors.

import { CB, items } from '../define';
import type { PackageExample } from '../packages';
import { MPLUS_SRC, MPLUS_TAG, mplusData, mplusLinks } from './common';

const quad = (...lines: string[]) => ({ kind: 'quadml' as const, syntax: lines.join('\n') });
/** Mplus's DATA TWOPART (cutpoint 0, TRANSFORM = LOG): bin = 1 above 0, cont = log(y) above 0 (missing at 0); the binary parts first, so that bin1-bin4 is a range. */
const twopart = [1, 2, 3, 4]
  .map((k) => ({ name: `bin${k}`, expr: `ifelse(y${k} > 0, 1, 0)` }))
  .concat([1, 2, 3, 4].map((k) => ({ name: `cont${k}`, expr: `log(y${k})` })));
/** Mplus's DATA MISSING: TYPE = SDROPOUT: d_t is 0 while y_t or a later occasion is observed, 1 at the occasion after the last observed one, missing after. */
const sdropout = (t: number) => ({
  name: `d${t}`,
  expr: `ifelse(1 - ${Array.from({ length: 6 - t }, (_, k) => `isna(y${t + k})`).join(' * ')}, 0, ifelse(isna(y${t - 1}), 0/0, 1))`,
});

export const MPLUS_QUADML: PackageExample[] = [
  {
    id: 'mplus-ex3.17',
    package: 'stats',
    title:
      'Path analysis with a categorical outcome and a missing continuous mediator (Mplus ex. 3.17)',
    source: MPLUS_SRC('3.17'),
    links: mplusLinks('3.17'),
    description:
      'A binary outcome u regressed on a continuous mediator y and on x, y regressed on x (Mplus: CATEGORICAL IS u; y ON x; u ON y x; MLR), with y missing for 151 of the 500 cases. The likelihood of a case without y integrates its logit model over y’s normal distribution given x, so the model needs numerical integration over one dimension for those cases. The integration card fits it by maximum likelihood in R with Mplus’s adaptive rectangular rule, 15 points: the exact likelihood (30 points and Gauss–Hermite give the same to 10⁻⁶): log-likelihood −820.994, 6 free parameters, AIC 1653.988, BIC 1679.276. Mplus integrates here by Monte Carlo (INTEGRATION = MONTECARLO, 250 random points), which cannot be reproduced and moves its numbers: it prints −820.920, while the exact log-likelihood at its printed estimates is −821.000. The estimates agree within 0.005 (y’s intercept 0.532 against Mplus’s 0.537, SE 0.056; y ON x −1.010 against −1.006; u’s threshold 0.090 against 0.093; u ON y 0.487 against 0.489; u ON x 1.028 against 1.027; y’s residual variance 1.019), every standard error within 0.001 (MLR). Opens its card on the Analyses tab.',
    shows:
      'The exact likelihood of the path model with y missing for 151 cases: log-likelihood −820.994 with 6 free parameters, where Mplus prints −820.920 from Monte Carlo integration with 250 points (its estimates give −821.000 exactly). The estimates agree within 0.005 (y’s intercept 0.532 against 0.537, u ON y 0.487 against 0.489) and every MLR standard error within 0.001.',
    data: mplusData('3.17', 'stats'),
    constructs: [],
    paths: [],
    tags: [MPLUS_TAG, 'Missing data'],
    panel: quad(
      'CATEGORICAL IS u;',
      'ANALYSIS: ESTIMATOR = MLR;',
      'MODEL:',
      'y ON x;',
      'u ON y x;',
    ),
    settings: CB('ML'),
  },
  {
    id: 'mplus-ex5.4',
    package: 'stats',
    title: 'CFA with censored and count factor indicators (Mplus ex. 5.4)',
    source: MPLUS_SRC('5.4'),
    links: mplusLinks('5.4'),
    description:
      'Two correlated factors: f1 measured by y1–y3, censored from above (a tobit model for each, normal below the largest value), f2 by the Poisson counts u4–u6 (log link), 500 cases (Mplus: CENSORED ARE y1-y3 (a); COUNT ARE u4-u6; f1 BY y1-y3; f2 BY u4-u6; MLR). The indicators are conditionally independent given the factors, whose two-dimensional normal distribution is integrated over numerically. The integration card follows Mplus’s rule: 15 rectangular points per dimension over ±5 standard deviations, adaptive (centred on each case’s posterior means and scaled by its posterior standard deviations of the Cholesky-standardised factors). Reproduces the Mplus output: log-likelihood −4424.258, 16 free parameters, AIC 8880.517, BIC 8947.950, and every estimate (loadings, intercepts, residual variances, the factor variances 0.761 and 0.734 and covariance 0.057) and MLR standard error within 0.001. Opens its card on the Analyses tab.',
    shows:
      'Log-likelihood −4424.258 with 16 free parameters, and the two factors’ variances 0.761 and 0.734 with a covariance of 0.057: the tobit indicators of f1 and the Poisson counts of f2 are nearly independent. Every loading, intercept and residual variance and every MLR standard error matches the Mplus output within 0.001.',
    data: mplusData('5.4', 'stats'),
    constructs: [],
    paths: [],
    tags: [MPLUS_TAG, 'Factor analysis'],
    panel: quad(
      'CENSORED ARE y1-y3 (a);',
      'COUNT ARE u4-u6;',
      'MODEL:',
      'f1 BY y1-y3;',
      'f2 BY u4-u6;',
    ),
    settings: CB('ML'),
  },
  {
    id: 'mplus-ex5.7',
    package: 'stats',
    title: 'Non-linear CFA: indicators on a factor and its square (Mplus ex. 5.7)',
    source: MPLUS_SRC('5.7'),
    links: mplusLinks('5.7'),
    description:
      'Five continuous indicators y1–y5 of a factor f, each also regressed on f squared (Mplus: TYPE = RANDOM; ALGORITHM = INTEGRATION; f BY y1-y5; fxf | f XWITH f; y1-y5 ON fxf). Given f the indicators are normal with means ν + λf + βf², so the likelihood integrates over f (one dimension), with Mplus’s adaptive rectangular rule, 15 points. The card’s maximum under that rule is −4027.494 (20 free parameters, AIC 8094.988, BIC 8179.281), and at Mplus’s printed estimates the same rule gives Mplus’s −4027.502 (−4027.503), but Mplus stops before the maximum: its gradient there is not zero and the card, started from Mplus’s estimates, climbs to its own. The likelihood is flat in f’s scale (the squared term and the factor variance trade off), so the estimates differ by up to 0.02, all within 0.15 of their standard errors: f’s variance 1.138 against 1.119 (SE 0.143), the loadings 1.043, 1.110, 0.979, 1.085 against 1.050, 1.119, 0.986, 1.093, the regressions on fxf −0.247, −0.246, −0.183, −0.199, −0.206 against −0.253, −0.251, −0.185, −0.203, −0.210; the intercepts within 0.006, the residual variances within 0.003, the standard errors within 0.005. (The posterior of f can have two modes here, which makes 15 adaptive points a rough rule: the exact maximum, by 101 fixed points over ±8, is −4027.362, with f’s variance 1.140.) Opens its card on the Analyses tab.',
    shows:
      'A documented stop short of the maximum: under Mplus’s own 15-point rule the card reaches −4027.494 (20 free parameters) where Mplus prints −4027.502, and the gradient there is not zero. The likelihood is flat in f’s scale, so estimates differ by up to 0.02, within 0.15 standard errors (f’s variance 1.138 against 1.119, SE 0.143; the fxf regressions −0.247 to −0.206 against −0.253 to −0.210).',
    data: mplusData('5.7', 'stats'),
    constructs: [],
    paths: [],
    tags: [MPLUS_TAG, 'Factor analysis', 'Interaction'],
    panel: quad(
      'ANALYSIS: TYPE = RANDOM;',
      'ALGORITHM = INTEGRATION;',
      'MODEL:',
      'f BY y1-y5;',
      'fxf | f XWITH f;',
      'y1-y5 ON fxf;',
    ),
    settings: CB('ML'),
  },
  {
    id: 'mplus-ex6.2',
    package: 'stats',
    title: 'Linear growth model for a censored outcome (Mplus ex. 6.2)',
    source: MPLUS_SRC('6.2'),
    links: mplusLinks('6.2'),
    description:
      'Linear growth of y11–y14, censored from below at 0 (Mplus: CENSORED ARE y11-y14 (b); i s | y11@0 y12@1 y13@2 y14@3; MLR): given the growth factors each occasion is a tobit model, and the two growth factors are integrated over with Mplus’s adaptive rectangular rule (15 points per dimension). Reproduces the Mplus output: log-likelihood −2857.721, 9 free parameters, AIC 5733.441, BIC 5771.373, the growth factors’ means 0.485 and 1.050, variances 0.958 and 0.189, covariance 0.148, the residual variances, and every MLR standard error within 0.001. Opens its card on the Analyses tab.',
    shows:
      'Log-likelihood −2857.721 with 9 free parameters, and the growth factors as Mplus prints them: means 0.485 and 1.050, variances 0.958 and 0.189, covariance 0.148, with a tobit residual variance per occasion. Every estimate and MLR standard error matches the Mplus output within 0.001.',
    data: mplusData('6.2', 'stats'),
    constructs: [],
    paths: [],
    tags: [MPLUS_TAG, 'Growth curve'],
    panel: quad(
      'CENSORED ARE y11-y14 (b);',
      'ANALYSIS: ESTIMATOR = MLR;',
      'MODEL:',
      'i s | y11@0 y12@1 y13@2 y14@3;',
    ),
    settings: CB('ML'),
  },
  {
    id: 'mplus-ex6.3',
    package: 'stats',
    title: 'Linear growth model for a censored-inflated outcome (Mplus ex. 6.3)',
    source: MPLUS_SRC('6.3'),
    links: mplusLinks('6.3'),
    description:
      'Linear growth of y11–y14 with a censored-inflated model (Mplus: CENSORED ARE y11-y14 (bi); i s | y11@0 … y14@3; ii si | y11#1@0 … y14#1@3; si@0; INTEGRATION = 7): a value at the censoring point 0 is either a structural zero, with a logit (the inflation part, its own growth factors ii and si, si without variance, its intercepts y#1 equal over time) or a censored value of the tobit model with growth factors i and s. Three dimensions (i, s, ii) with Mplus’s 7 adaptive rectangular points per dimension; for 7 points Mplus spreads them over ±3.5 standard deviations (±5 for 15 points), which reproduces its log-likelihood at its printed estimates exactly (−8014.921). The card’s maximum is −8014.919 (14 free parameters, AIC 16057.837 against 16057.841, BIC 16126.546 against 16126.550), its estimates within 0.0021 of Mplus’s (the residual variance of y11 1.426 against 1.424, SE 0.139; the covariance of i and s 0.105 against 0.104, SE 0.053; Mplus stops at its convergence criterion) and every MLR standard error within 0.0005. Opens its card on the Analyses tab.',
    shows:
      'Log-likelihood −8014.919 with 14 free parameters, against Mplus’s −8014.921, which the 7-point rule over ±3.5 standard deviations reproduces exactly at its estimates. The estimates agree within 0.0021 (y11’s residual variance 1.426 against 1.424, SE 0.139; i with s 0.105 against 0.104) and every MLR standard error within 0.0005; Mplus stops at its convergence criterion.',
    data: mplusData('6.3', 'stats'),
    constructs: [],
    paths: [],
    tags: [MPLUS_TAG, 'Growth curve'],
    panel: quad(
      'CENSORED ARE y11-y14 (bi);',
      'ANALYSIS: INTEGRATION = 7;',
      'MODEL:',
      'i s | y11@0 y12@1 y13@2 y14@3;',
      'ii si | y11#1@0 y12#1@1 y13#1@2 y14#1@3;',
      'si@0;',
    ),
    settings: CB('ML'),
  },
  {
    id: 'mplus-ex6.16',
    package: 'stats',
    title: 'Two-part (semicontinuous) growth model (Mplus ex. 6.16)',
    source: MPLUS_SRC('6.16'),
    links: mplusLinks('6.16'),
    description:
      'A two-part growth model for a semicontinuous outcome y1–y4 (zero or positive): Mplus’s DATA TWOPART splits each into a binary part (1 above 0) and a continuous part (the log of a positive value, missing at 0), here the computed columns bin1–bin4 = ifelse(y > 0, 1, 0) and cont1–cont4 = log(y) (log(0) is missing). A logit growth model for the binary part (iu su | bin1@0 …; su without variance, the thresholds equal over time), a normal one for the continuous part (iy sy | cont1@0 …), iu correlated with iy and sy except iu WITH sy@0 (MLR). The continuous part enters analytically given iu, so the integral is over iu alone (Mplus’s adaptive rectangular rule, 15 points). Reproduces the Mplus output: log-likelihood −3576.087 (Mplus −3576.088), 13 free parameters, AIC 7178.175 (7178.176), BIC 7232.965 (7232.966), every estimate within 0.001 except the last occasion’s residual variance (0.449 against 0.450, Mplus’s convergence), and every MLR standard error within 0.001. Opens its card on the Analyses tab.',
    shows:
      'Log-likelihood −3576.087 (Mplus −3576.088) with 13 free parameters, the binary part’s growth in logits and the continuous part’s in log units side by side, iu correlated with iy. Every estimate matches Mplus within 0.001 except the last occasion’s residual variance (0.449 against 0.450), and every MLR standard error within 0.001.',
    data: mplusData('6.16', 'stats'),
    constructs: [],
    paths: [],
    tags: [MPLUS_TAG, 'Growth curve'],
    computed: twopart,
    panel: quad(
      'CATEGORICAL = bin1-bin4;',
      'ANALYSIS: ESTIMATOR = MLR;',
      'MODEL:',
      'iu su | bin1@0 bin2@1 bin3@2 bin4@3;',
      'iy sy | cont1@0 cont2@1 cont3@2 cont4@3;',
      'su@0; iu WITH sy@0;',
    ),
    settings: CB('ML'),
  },
  {
    id: 'mplus-ex6.22',
    package: 'stats',
    title: 'Continuous-time survival with a factor influencing survival (Mplus ex. 6.22)',
    source: MPLUS_SRC('6.22'),
    links: mplusLinks('6.22'),
    description:
      'A parametric proportional hazards model for the time t (censored where tc = 1) with a piecewise-constant baseline hazard over 21 intervals (Mplus: SURVIVAL = t (20*1): twenty of length 1 and the rest; BASEHAZARD = ON; [t#1-t#21]), regressed on x and on a factor f measured by four binary items (logit), f regressed on x (Mplus: f BY u1-u4; t ON x f; f ON x; MLR). The likelihood of a case is the product of its items’ and its survival time’s (hazard^event × exp(−cumulative hazard)) given f, integrated over f with Mplus’s adaptive rectangular rule (15 points). Reproduces the Mplus output: log-likelihood −4644.938, 32 free parameters, AIC 9353.876, BIC 9510.924, the 21 base hazards, t ON x 0.085 and t ON f 0.038, the thresholds, f ON x 0.212 and f’s residual variance 2.465 within 0.001 and the loadings within 0.002 (u3 1.065 against 1.067); the MLR standard errors within 0.002 except f’s residual variance’s, 0.607 against Mplus’s 0.597 (the observed information alone gives 0.596). Opens its card on the Analyses tab.',
    shows:
      'Log-likelihood −4644.938 with 32 free parameters: 21 piecewise base hazards, t ON x 0.085 and t ON f 0.038, f ON x 0.212 and f’s residual variance 2.465, the loadings within 0.002 (u3 1.065 against 1.067). MLR standard errors agree within 0.002 except f’s residual variance’s: 0.607 against Mplus’s 0.597 (observed information alone gives 0.596).',
    data: mplusData('6.22', 'stats'),
    constructs: [],
    paths: [],
    tags: [MPLUS_TAG, 'Survival analysis'],
    panel: quad(
      'SURVIVAL = t (20*1);',
      'TIMECENSORED = tc;',
      'CATEGORICAL = u1-u4;',
      'ANALYSIS: ALGORITHM = INTEGRATION;',
      'BASEHAZARD = ON;',
      'MODEL:',
      'f BY u1-u4;',
      '[t#1-t#21];',
      't ON x f;',
      'f ON x;',
    ),
    settings: CB('ML'),
  },
  {
    id: 'mplus-ex11.3',
    package: 'stats',
    title: 'Diggle–Kenward selection model for data not missing at random (Mplus ex. 11.3)',
    source: MPLUS_SRC('11.3'),
    links: mplusLinks('11.3'),
    description:
      'Linear growth of y0–y5 (1000 cases) with dropout that may depend on the value that is not observed: the dropout indicators d1–d5 (Mplus’s DATA MISSING: TYPE = SDROPOUT; here computed columns: d_t is 0 while y_t or a later occasion is observed, 1 at the occasion after the last observed one, missing after it; 33, 35, 54, 40 and 151 dropouts, as Mplus counts) are logits regressed on the previous and the current occasion, with the same two slopes at every occasion (Mplus: i s | y0@0 … y5@5; d1 ON y0 (1) y1 (2); … d5 ON y4 (1) y5 (2); ML). A dropout’s current value, and an intermittently missing value before it, is integrated over its normal distribution given the observed ones (up to four dimensions per case; the growth factors enter analytically). Mplus integrates by Monte Carlo (1250 random points), which cannot be reproduced; the card uses adaptive Gauss–Hermite quadrature with 7 points per dimension (INTEGRATION = GAUSSHERMITE (7)), exact for this likelihood (5 and 10 points give the same within 0.03 and 0.001). Its maximum is −6526.650 (18 free parameters, AIC 13089.299, BIC 13177.639); at Mplus’s printed estimates the exact log-likelihood is −6526.665, where Mplus’s Monte Carlo approximation prints −6526.797. The growth model agrees within 0.002 (the means 1.998 and −1.044, variances 0.236 and 0.091, the residual variances); the dropout logits, which only the Monte Carlo integration moves, within 0.02, an eighth of their standard errors (slopes 0.341 and 0.606 against 0.359 and 0.586, SEs 0.16 and 0.18; thresholds within 0.017); the ML standard errors within 0.006. Opens its card on the Analyses tab.',
    shows:
      'Log-likelihood −6526.650 with 18 free parameters by exact quadrature, where Mplus’s Monte Carlo integration prints −6526.797 (the exact value at its estimates is −6526.665). The growth model agrees within 0.002 (means 1.998 and −1.044, variances 0.236 and 0.091); the dropout logits move most, within 0.02, an eighth of their standard errors (slopes 0.341 and 0.606 against 0.359 and 0.586).',
    data: mplusData('11.3', 'stats'),
    constructs: [],
    paths: [],
    tags: [MPLUS_TAG, 'Missing data', 'Growth curve'],
    computed: [1, 2, 3, 4, 5].map(sdropout),
    panel: quad(
      'CATEGORICAL = d1-d5;',
      'ANALYSIS: ESTIMATOR = ML;',
      'ALGORITHM = INTEGRATION;',
      'INTEGRATION = GAUSSHERMITE (7);',
      'MODEL:',
      `i s | ${items('y', 6, 0)
        .map((y, t) => `${y}@${t}`)
        .join(' ')};`,
      ...[1, 2, 3, 4, 5].flatMap((t) => [`d${t} ON y${t - 1} (1)`, `y${t} (2);`]),
    ),
    settings: CB('ML'),
  },
];
