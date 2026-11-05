// Mplus User's Guide, chapter 9 (see common.ts): multilevel models. Mplus estimates TYPE = TWOLEVEL by MLR with
// observed-information standard errors; lavaan's two-level SEM does the same (estimator MLR, information observed).
// Random slopes are not available in lavaan: those examples run on lme4, by ML, whose standard errors are model-based.

import { CB } from '../define';
import type { PackageExample } from '../packages';
import { MPLUS_SRC, MPLUS_TAG, mplusData, mplusLinks } from './common';

const TWO_LEVEL = 'Two-level model';

export const MPLUS_CH9: PackageExample[] = [
  {
    id: 'mplus-ex9.1a', package: 'lavaan', title: 'Two-level regression with a random intercept (Mplus ex. 9.1a)', source: MPLUS_SRC('9.1a'), links: mplusLinks('9.1a'),
    description: 'y of 1000 students in 110 clusters (clus): within clusters regressed on the student-level x, between clusters (the random intercept) on the cluster-level w and xm (Mplus: WITHIN = x; BETWEEN = w xm; %WITHIN% y ON x; %BETWEEN% y ON w xm). x is centred at its grand mean as in Mplus (CENTER x (GRANDMEAN)): the computed column xc = center(x). The within level is the diagram; the between level is the model as written (Clusters: As written). lavaan’s two-level SEM with MLR and observed-information standard errors, Mplus’s defaults, reproduces the Mplus output: log-likelihood −1525.938, 6 free parameters, and every estimate and standard error (within, y on x 0.724 (0.033); between, y on w 0.570 (0.108), on xm 0.976 (0.160), intercept 1.991 (0.080)).',
    data: mplusData('9.1a'), tags: [MPLUS_TAG, TWO_LEVEL], computed: [{ name: 'xc', expr: 'center(x)' }],
    constructs: [], paths: [],
    syntax: 'level: 1\n  y ~ xc\nlevel: 2\n  y ~ w + xm',
    multilevel: { column: 'clus', between: 'model' }, information: 'observed', settings: CB('MLR'),
  },
  {
    id: 'mplus-ex9.1b', package: 'lavaan', title: 'Two-level regression with a latent covariate (Mplus ex. 9.1b)', source: MPLUS_SRC('9.1b'), links: mplusLinks('9.1b'),
    description: 'As example 9.1a, but x is not declared within-only: it has a within and a between part (Mplus’s latent covariate), and y’s random intercept is regressed on w and on x’s cluster-level part. The contextual effect betac = gamma01 − gamma10 is a defined parameter (Mplus: MODEL CONSTRAINT: NEW(betac)). x is centred at its grand mean (xc = center(x)); MLR with observed information. The within level agrees with the Mplus output (y on x 0.780 (0.032), residual variance 0.975 (0.043)), as do the log-likelihood (lavaan −2971.584, Mplus −2971.585) and every standard error. The between slopes differ in the third decimal: w 0.383 (Mplus 0.385), x 1.192 (1.188), betac 0.412 (0.408). The model is saturated, so χ² must be 0; Mplus prints 0.001 and a log-likelihood 0.001 lower, so it stopped short of the maximum along this flat direction (the between slope of x has a standard error of 0.177).',
    data: mplusData('9.1b'), tags: [MPLUS_TAG, TWO_LEVEL], computed: [{ name: 'xc', expr: 'center(x)' }],
    constructs: [], paths: [],
    syntax: 'level: 1\n  y ~ gamma10*xc\nlevel: 2\n  y ~ w + gamma01*xc\nbetac := gamma01 - gamma10',
    multilevel: { column: 'clus', between: 'model' }, information: 'observed', settings: CB('MLR'),
  },
  {
    id: 'mplus-ex9.2a', package: 'lme4', title: 'Two-level regression with a random slope (Mplus ex. 9.2a)', source: MPLUS_SRC('9.2a'), links: mplusLinks('9.2a'),
    description: 'y on the student-level x with a random intercept and a random slope s across 110 clusters, both regressed on the cluster-level w and xm and covarying (Mplus: s | y ON x; y s ON w xm; y WITH s). x is centred within clusters as in Mplus (CENTER x (GROUPMEAN)): the computed column xc = center(x, clus). A regression of the slope on w and xm is the cross-level interaction of x with them, so the products xcw = xc*w and xcxm = xc*xm are computed columns: lmer(y ~ xc + w + xm + xcw + xcxm + (xc | clus)) by ML. lme4 reproduces the Mplus log-likelihood (−1596.165, 10 parameters, AIC 3212.331, BIC 3261.408) and every estimate: intercept 2.134 and s 1.039 (Mplus [y] and [s]), y on w 0.968 and xm 1.231, s on w 0.412 and xm 0.526, the variances of the intercept 0.728 and slope 0.336, their covariance 0.308, the residual variance 1.035. Mplus’s standard errors are robust (MLR), lme4’s model-based: 0.096, 0.074, 0.131, 0.182, 0.100 and 0.137 here against Mplus’s 0.099, 0.076, 0.127, 0.179, 0.097 and 0.133; lme4 gives no standard errors for the variances. Opens its card on the Analyses tab.',
    data: mplusData('9.2a', 'lme4'), tags: [MPLUS_TAG],
    computed: [{ name: 'xc', expr: 'center(x, clus)' }, { name: 'xcw', expr: 'xc * w' }, { name: 'xcxm', expr: 'xc * xm' }],
    constructs: [], paths: [],
    panel: { kind: 'lmm', outcome: 'y', predictors: ['xc', 'w', 'xm', 'xcw', 'xcxm'], cluster: 'clus', slopes: ['xc'], center: 'none', estimation: 'ML' }, settings: CB('ML'),
  },
  {
    id: 'mplus-ex9.2b', package: 'lme4', title: 'Random slope: the slope at low and high w (Mplus ex. 9.2b)', source: MPLUS_SRC('9.2b'), links: mplusLinks('9.2b'),
    description: 'Example 9.2a’s model on the same data, with the mean of the random slope and its regression on w labelled (Mplus: [s] (gam0); s ON w (gam1)) to plot the within-cluster regression of y on x at w = −1 and w = +1 (MODEL CONSTRAINT: ylow = (gam0 − gam1)·x, yhigh = (gam0 + gam1)·x). The Mplus output is that of 9.2a, and lme4 reproduces it in the same way (log-likelihood −1596.165, every estimate; robust standard errors in Mplus, model-based here). The two slopes are gam0 ∓ gam1 = 1.039 ∓ 0.412: 0.627 at w = −1 and 1.451 at w = +1 (xm at 0), from the fixed effects of xc and xcw. Opens its card on the Analyses tab.',
    data: mplusData('9.2b', 'lme4'), tags: [MPLUS_TAG],
    computed: [{ name: 'xc', expr: 'center(x, clus)' }, { name: 'xcw', expr: 'xc * w' }, { name: 'xcxm', expr: 'xc * xm' }],
    constructs: [], paths: [],
    panel: { kind: 'lmm', outcome: 'y', predictors: ['xc', 'w', 'xm', 'xcw', 'xcxm'], cluster: 'clus', slopes: ['xc'], center: 'none', estimation: 'ML' }, settings: CB('ML'),
  },
  {
    id: 'mplus-ex9.6', package: 'lavaan', title: 'Two-level CFA with a random intercept factor (Mplus ex. 9.6)', source: MPLUS_SRC('9.6'), links: mplusLinks('9.6'),
    description: 'Four indicators y1–y4 of 1000 people in 110 clusters: within clusters a factor fw regressed on x1 and x2; between clusters a factor fb of the indicators’ random intercepts, regressed on the cluster-level w, with the between residual variances fixed at 0 (Mplus: %BETWEEN% fb BY y1-y4; y1-y4@0; fb ON w). The within level is the diagram; the between level is the model as written (Clusters: As written). lavaan’s two-level SEM with MLR and observed information, Mplus’s defaults, reproduces the log-likelihood (−6544.187; Mplus −6544.186), 19 free parameters, 17 df, and every estimate and standard error. The χ² differs: Mplus fits the unrestricted model at a looser criterion (0.0001), and its log-likelihood (−6542.255) is 0.027 below lavaan’s, so its unscaled statistic is 3.862 against lavaan’s 3.918; scaled, Mplus prints 5.081 (correction 0.760) and lavaan 4.067 (lavaan computes the two-level scaling correction differently).',
    data: mplusData('9.6'), tags: [MPLUS_TAG, TWO_LEVEL],
    constructs: [], paths: [],
    syntax: 'level: 1\n  fw =~ y1 + y2 + y3 + y4\n  fw ~ x1 + x2\nlevel: 2\n  fb =~ y1 + y2 + y3 + y4\n  y1 ~~ 0*y1; y2 ~~ 0*y2; y3 ~~ 0*y3; y4 ~~ 0*y4\n  fb ~ w',
    multilevel: { column: 'clus', between: 'model' }, information: 'observed', settings: CB('MLR'),
  },
  {
    id: 'mplus-ex9.16', package: 'lme4', title: 'Growth as a two-level model, long format (Mplus ex. 9.16)', source: MPLUS_SRC('9.16'), links: mplusLinks('9.16'),
    description: 'Linear growth of y over four occasions for 500 people in long format, one row per person and occasion (Mplus: DATA WIDETOLONG; the reshaped data are shipped as ex9.16long.csv): occasions are clustered in persons, y regressed on time (0–3) with a random slope s and on the time-varying covariate a3, and the random intercept and slope on x1 and x2 (Mplus: s | y ON time; y ON a3; y s ON x1 x2; y WITH s). The regressions of the slope are the interactions of time with x1 and x2, computed columns tx1 = time*x1 and tx2 = time*x2: lmer(y ~ time + a3 + x1 + x2 + tx1 + tx2 + (time | person)) by ML. lme4 reproduces the Mplus log-likelihood (−3075.852, 11 parameters, AIC 6173.704, BIC 6235.314) and every estimate: intercept 0.570, s 1.010, y on a3 0.297, y on x1 0.561 and x2 0.717, s on x1 0.263 and x2 0.473, the intercept and slope variances 1.079 and 0.203, their covariance 0.051, the residual variance 0.542. Mplus’s standard errors are robust (MLR), lme4’s model-based: 0.055, 0.025, 0.021, 0.054, 0.056, 0.025 and 0.026 here against Mplus’s 0.055, 0.025, 0.022, 0.054, 0.054, 0.027 and 0.025. Opens its card on the Analyses tab.',
    data: { ...mplusData('9.16', 'lme4'), file: 'examples/mplus/ex9.16long.csv' }, tags: [MPLUS_TAG, 'Growth model'],
    computed: [{ name: 'tx1', expr: 'time * x1' }, { name: 'tx2', expr: 'time * x2' }],
    constructs: [], paths: [],
    panel: { kind: 'lmm', outcome: 'y', predictors: ['time', 'a3', 'x1', 'x2', 'tx1', 'tx2'], cluster: 'person', slopes: ['time'], center: 'none', estimation: 'ML' }, settings: CB('ML'),
  },
];
