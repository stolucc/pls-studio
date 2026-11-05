// Mplus User's Guide, chapter 6 (see common.ts).

import { CB, items } from '../define';
import type { PackageExample } from '../packages';
import { MPLUS_SRC, MPLUS_TAG, mplusData, mplusLinks, regression } from './common';

// Models written as lavaan syntax on the growth card (lavaan::growth: growth factor means free, intercepts of the occasions 0).
const PIECEWISE = `i =~ 1*y1 + 1*y2 + 1*y3 + 1*y4 + 1*y5
s1 =~ 0*y1 + 1*y2 + 2*y3 + 2*y4 + 2*y5
s2 =~ 0*y1 + 0*y2 + 0*y3 + 1*y4 + 2*y5`;
const PARALLEL = `i1 =~ 1*y11 + 1*y12 + 1*y13 + 1*y14
s1 =~ 0*y11 + 1*y12 + 2*y13 + 3*y14
i2 =~ 1*y21 + 1*y22 + 1*y23 + 1*y24
s2 =~ 0*y21 + 1*y22 + 2*y23 + 3*y24
s1 ~ i2
s2 ~ i1`;
const MULTIPLE_INDICATOR = `# a factor per occasion, loadings and intercepts equal over time
f1 =~ y11 + l2*y21 + l3*y31
f2 =~ y12 + l2*y22 + l3*y32
f3 =~ y13 + l2*y23 + l3*y33
y11 + y12 + y13 ~ a1*1
y21 + y22 + y23 ~ a2*1
y31 + y32 + y33 ~ a3*1
f1 + f2 + f3 ~ 0*1
# linear growth of the factors
i =~ 1*f1 + 1*f2 + 1*f3
s =~ 0*f1 + 1*f2 + 2*f3
i ~ 0*1`;
const AR1 = `i =~ 1*y1 + 1*y2 + 1*y3 + 1*y4
s =~ 0*y1 + 1*y2 + 2*y3 + 3*y4
# one residual variance; covariances rv*corr, rv*corr^2, rv*corr^3 at lags 1, 2, 3
y1 ~~ rv*y1
y2 ~~ rv*y2
y3 ~~ rv*y3
y4 ~~ rv*y4
y1 ~~ p1*y2
y2 ~~ p1*y3
y3 ~~ p1*y4
y1 ~~ p2*y3
y2 ~~ p2*y4
y1 ~~ p3*y4
corr := p1/rv
p2 == rv*(p1/rv)^2
p3 == rv*(p1/rv)^3`;
const COHORTS = `# groups in data order: 1990, 1989, 1988
i =~ 1*y1 + 1*y2 + 1*y3 + 1*y4
s =~ c(0, 0.1, 0.2)*y1 + c(0.2, 0.3, 0.4)*y2 + c(0.4, 0.5, 0.6)*y3 + c(0.6, 0.7, 0.8)*y4
i ~ c(mi, mi, mi)*1
s ~ c(ms, ms, ms)*1
i ~~ c(vi, vi, vi)*i
s ~~ c(vs, vs, vs)*s
i ~~ c(cis, cis, cis)*s
i ~ c(bi, bi, bi)*x
s ~ c(bs, bs, bs)*x
# the same age in two cohorts: equal effects of the time-varying covariate and residual variances
y1 ~ c(a1_90, a1_89, a2)*a21
y2 ~ c(a2, a2_89, a3)*a22
y3 ~ c(a3, a3_89, a4)*a23
y4 ~ c(a4, a4_89, a4_88)*a24
y1 ~~ c(r1_90, r1_89, r2)*y1
y2 ~~ c(r2, r2_89, r3)*y2
y3 ~~ c(r3, r3_89, r4)*y3
y4 ~~ c(r4, r4_89, r4_88)*y4`;

export const MPLUS_CH6: PackageExample[] = [
  {
    id: 'mplus-ex6.1', package: 'lavaan', title: 'Linear growth model (Mplus ex. 6.1)', source: MPLUS_SRC('6.1'), links: mplusLinks('6.1'),
    description: 'y11–y14 over four occasions (Mplus: i s | y11@0 y12@1 y13@2 y14@3): intercept and slope factors with means, variances and covariance. lavaan’s growth() with observed-information standard errors (Mplus’s default) reproduces the Mplus output: log-likelihood −3016.386, 9 free parameters, χ² = 4.593 on 5 df, and every estimate and standard error. Opens its card on the Analyses tab.',
    data: mplusData('6.1'), constructs: [], paths: [], tags: [MPLUS_TAG],
    panel: { kind: 'growth', measures: items('y1', 4), times: [0, 1, 2, 3], shape: 'linear', covariates: [] }, information: 'observed', settings: CB('ML'),
  },
  {
    id: 'mplus-ex6.8', package: 'lavaan', title: 'Latent basis growth model (Mplus ex. 6.8)', source: MPLUS_SRC('6.8'), links: mplusLinks('6.8'),
    description: 'Growth with the shape of the curve estimated: the slope loadings of the third and fourth occasions are free (Mplus: i s | y11@0 y12@1 y13 y14). lavaan’s growth() with observed-information standard errors (Mplus’s default) reproduces the Mplus output: log-likelihood −3016.249, 11 free parameters, χ² = 4.319 on 3 df, and every estimate and standard error. Opens its card on the Analyses tab.',
    data: mplusData('6.8'), constructs: [], paths: [], tags: [MPLUS_TAG],
    panel: { kind: 'growth', measures: items('y1', 4), times: [0, 1, 2, 3], shape: 'basis', covariates: [] }, information: 'observed', settings: CB('ML'),
  },
  {
    id: 'mplus-ex6.9', package: 'lavaan', title: 'Quadratic growth model (Mplus ex. 6.9)', source: MPLUS_SRC('6.9'), links: mplusLinks('6.9'),
    description: 'Intercept, linear and quadratic growth factors over four occasions (Mplus: i s q | y11@0 y12@1 y13@2 y14@3). lavaan’s growth() with observed-information standard errors (Mplus’s default) reproduces the Mplus output: log-likelihood −3975.519, 13 free parameters, χ² = 0.475 on 1 df, and every estimate and standard error. Opens its card on the Analyses tab.',
    data: mplusData('6.9'), constructs: [], paths: [], tags: [MPLUS_TAG],
    panel: { kind: 'growth', measures: items('y1', 4), times: [0, 1, 2, 3], shape: 'quadratic', covariates: [] }, information: 'observed', settings: CB('ML'),
  },
  {
    id: 'mplus-ex6.10', package: 'lavaan', title: 'Growth model with time-invariant and time-varying covariates (Mplus ex. 6.10)', source: MPLUS_SRC('6.10'), links: mplusLinks('6.10'),
    description: 'Linear growth of y11–y14 with the intercept and slope regressed on x1 and x2, and each occasion regressed on its own time-varying covariate a31–a34 (Mplus: i s ON x1 x2; y11 ON a31; …). lavaan’s growth() with observed-information standard errors (Mplus’s default) reproduces the Mplus output: log-likelihood −3070.619, 17 free parameters, χ² = 25.786 on 21 df, and every estimate and standard error. Opens its card on the Analyses tab.',
    data: mplusData('6.10'), constructs: [], paths: [], tags: [MPLUS_TAG],
    panel: { kind: 'growth', measures: items('y1', 4), times: [0, 1, 2, 3], shape: 'linear', covariates: ['x1', 'x2'], timeVarying: items('a3', 4) }, information: 'observed', settings: CB('ML'),
  },
  {
    id: 'mplus-ex6.11', package: 'lavaan', title: 'Piecewise growth model (Mplus ex. 6.11)', source: MPLUS_SRC('6.11'), links: mplusLinks('6.11'),
    description: 'Five occasions y1–y5 with one intercept and two slopes: s1 carries the change over the first three occasions, s2 the change after them (Mplus: i s1 | y1@0 y2@1 y3@2 y4@2 y5@2; i s2 | y1@0 y2@0 y3@0 y4@1 y5@2). Written as lavaan syntax on the growth card (lavaan’s growth(), observed-information standard errors as Mplus). Reproduces the Mplus output: log-likelihood −3706.171, 14 free parameters, χ² = 5.244 on 6 df, and every estimate and standard error. Opens its card on the Analyses tab.',
    data: mplusData('6.11'), constructs: [], paths: [], tags: [MPLUS_TAG],
    panel: { kind: 'growth', measures: items('y', 5), times: [0, 1, 2, 3, 4], shape: 'linear', covariates: [], syntax: PIECEWISE }, information: 'observed', settings: CB('ML'),
  },
  {
    id: 'mplus-ex6.13', package: 'lavaan', title: 'Parallel process growth model (Mplus ex. 6.13)', source: MPLUS_SRC('6.13'), links: mplusLinks('6.13'),
    description: 'Two outcomes measured on the same four occasions, each with its own linear growth (i1 s1 for y11–y14, i2 s2 for y21–y24), and each slope regressed on the other process’s intercept (Mplus: s1 ON i2; s2 ON i1). Written as lavaan syntax on the growth card (observed-information standard errors as Mplus). Reproduces the Mplus output: log-likelihood −5990.576, 20 free parameters, χ² = 31.167 on 24 df, and every estimate and standard error. The chart shows the first process. Opens its card on the Analyses tab.',
    data: mplusData('6.13'), constructs: [], paths: [], tags: [MPLUS_TAG],
    panel: { kind: 'growth', measures: items('y1', 4), times: [0, 1, 2, 3], shape: 'linear', covariates: [], syntax: PARALLEL }, information: 'observed', settings: CB('ML'),
  },
  {
    id: 'mplus-ex6.14', package: 'lavaan', title: 'Multiple indicator linear growth model (Mplus ex. 6.14)', source: MPLUS_SRC('6.14'), links: mplusLinks('6.14'),
    description: 'A factor at each of three occasions, measured by the same three indicators (yjt: indicator j at time t) with loadings and intercepts held equal over time, and linear growth of the factors (Mplus: f1 BY y11 y21-y31 (1-2); …; [y11 y12 y13] (3); …; i s | f1@0 f2@1 f3@2). The intercept factor’s mean is fixed at 0 (the indicators’ intercepts set the scale). Written as lavaan syntax on the growth card (observed-information standard errors as Mplus). Reproduces the Mplus output: log-likelihood −6357.999, 21 free parameters, χ² = 36.949 on 33 df, and every estimate and standard error. The chart shows the first indicator at each occasion. Opens its card on the Analyses tab.',
    data: mplusData('6.14'), constructs: [], paths: [], tags: [MPLUS_TAG],
    panel: { kind: 'growth', measures: ['y11', 'y12', 'y13'], times: [0, 1, 2], shape: 'linear', covariates: [], syntax: MULTIPLE_INDICATOR }, information: 'observed', settings: CB('ML'),
  },
  {
    id: 'mplus-ex6.17', package: 'lavaan', title: 'Linear growth model with AR(1) residuals (Mplus ex. 6.17)', source: MPLUS_SRC('6.17'), links: mplusLinks('6.17'),
    description: 'Linear growth of y1–y4 with first-order autocorrelated residuals: one residual variance for all occasions, and residual covariances resvar·corr at lag 1, resvar·corr² at lag 2 and resvar·corr³ at lag 3 (Mplus: y1-y4 (resvar); y1-y3 PWITH y2-y4 (p1); …; MODEL CONSTRAINT: NEW (corr); p1 = resvar*corr; …). lavaan has no free parameter outside the model, so the syntax writes the constraints as p2 == rv*(p1/rv)^2 and p3 == rv*(p1/rv)^3, with corr := p1/rv. The fit and every estimate reproduce the Mplus output: log-likelihood −6593.460, 7 free parameters, χ² = 2.469 on 7 df, corr = 0.502, residual variance 1.462. The standard errors of the means agree; those of the (co)variances do not: lavaan computes standard errors under nonlinear constraints without the constraints’ curvature, Mplus as for the likelihood written in resvar and corr (the numerical Hessian of that likelihood gives Mplus’s values). Mplus prints 0.225 for the residual variance, 0.209, 0.154 and 0.102 for the lag 1, 2 and 3 covariances, 0.067 for corr and 0.253 for the intercept variance; lavaan gives 0.235, 0.219, 0.161, 0.106, 0.070 and 0.263. Opens its card on the Analyses tab.',
    data: mplusData('6.17'), constructs: [], paths: [], tags: [MPLUS_TAG],
    panel: { kind: 'growth', measures: items('y', 4), times: [0, 1, 2, 3], shape: 'linear', covariates: [], syntax: AR1 }, information: 'observed', settings: CB('ML'),
  },
  {
    id: 'mplus-ex6.18', package: 'lavaan', title: 'Multiple group multiple cohort growth model (Mplus ex. 6.18)', source: MPLUS_SRC('6.18'), links: mplusLinks('6.18'),
    description: 'Three birth cohorts (g: 1990, 1989, 1988) measured at four ages, a year apart between cohorts, so each cohort has its own time scores (0–0.6, 0.1–0.7, 0.2–0.8). The growth factors’ means, variances, covariance and regressions on x are equal across cohorts; the effects of the time-varying covariates a21–a24 and the residual variances are equal where two cohorts are at the same age (Mplus: GROUPING = g; i s | y1@0 y2@.2 …; MODEL 1989: i s | y1@.1 …; equality labels). Written as lavaan syntax with per-group values c(…, …, …) and the group column on the growth card (observed-information standard errors as Mplus). Reproduces the Mplus output: log-likelihood −8179.476, 25 free parameters, χ² = 76.650 on 77 df, and every estimate and standard error in the three groups. Opens its card on the Analyses tab.',
    data: mplusData('6.18'), constructs: [], paths: [], tags: [MPLUS_TAG], labels: { g: ['1990', '1989', '1988'] },
    panel: { kind: 'growth', measures: items('y', 4), times: [0, 0.2, 0.4, 0.6], shape: 'linear', covariates: [], syntax: COHORTS, group: 'g' }, information: 'observed', settings: CB('ML'),
  },
  {
    id: 'mplus-ex6.23', package: 'stats', title: 'N = 1 time series: AR(1) model (Mplus ex. 6.23)', source: MPLUS_SRC('6.23'), links: mplusLinks('6.23'),
    description: 'One series y of 100 occasions regressed on its own previous value (Mplus: LAGGED = y(1); y ON y&1). The lag is a computed column, y_lag1 = lag(y), and the regression card fits the model by least squares on the 99 occasions that have one. Mplus estimates it by Bayes (posterior medians of 2000 MCMC iterations, flat priors, the first occasion’s missing lag treated as missing data), so the two agree as estimates of the same model rather than exactly: Mplus prints 0.171 (posterior SD 0.104) for the autoregression and 0.449 (0.121) for the intercept, the card 0.171 (SE 0.103) and 0.453 (0.118); Mplus’s residual variance is 1.137, the least-squares one (σ²) 1.116. Opens its card on the Analyses tab.',
    data: mplusData('6.23', 'stats'), constructs: [], paths: [], tags: [MPLUS_TAG, 'Time series'], computed: [{ name: 'y_lag1', expr: 'lag(y)' }],
    panel: regression('gaussian', 'identity', 'y', ['y_lag1']), settings: CB('ML'),
  },
  {
    id: 'mplus-ex6.23b', package: 'stats', title: 'N = 1 time series: AR(2) model (Mplus ex. 6.23b)', source: MPLUS_SRC('6.23b'), links: mplusLinks('6.23b'),
    description: 'The series of example 6.23 regressed on its previous two values (Mplus: LAGGED = y(2); y ON y&1 y&2), with the lags as computed columns lag(y) and lag(y, 2) and least squares on the 98 occasions that have both. Mplus estimates it by Bayes (posterior medians of 2000 MCMC iterations, the first occasions’ missing lags treated as missing data): it prints 0.179 (posterior SD 0.108) and −0.065 (0.105) for the lags and 0.480 (0.131) for the intercept, the card 0.178 (SE 0.105), −0.067 (0.105) and 0.487 (0.128); residual variance 1.144 in Mplus, σ² = 1.132 here. Opens its card on the Analyses tab.',
    data: mplusData('6.23b', 'stats'), constructs: [], paths: [], tags: [MPLUS_TAG, 'Time series'], computed: [{ name: 'y_lag1', expr: 'lag(y)' }, { name: 'y_lag2', expr: 'lag(y, 2)' }],
    panel: regression('gaussian', 'identity', 'y', ['y_lag1', 'y_lag2']), settings: CB('ML'),
  },
  {
    id: 'mplus-ex6.24', package: 'stats', title: 'N = 1 time series: AR(1) model with a covariate (Mplus ex. 6.24)', source: MPLUS_SRC('6.24'), links: mplusLinks('6.24'),
    description: 'y regressed on its previous value and on a covariate x now and one occasion earlier (Mplus: LAGGED = y(1) x(1); y ON y&1 x x&1), the lags as computed columns, by least squares on the 99 occasions that have them. Mplus estimates it by Bayes (posterior medians of 1000 MCMC iterations, the first occasion’s missing lags treated as missing data), so estimates differ by up to 0.013, about a tenth of a standard error: Mplus prints −0.022 (posterior SD 0.087) for y&1, 0.797 (0.106) for x, 0.603 (0.142) for x&1 and −0.082 (0.101) for the intercept, the card −0.031 (SE 0.089), 0.784 (0.103), 0.615 (0.138) and −0.085 (0.105); residual variance 1.083 in Mplus, σ² = 1.071 here. Opens its card on the Analyses tab.',
    data: mplusData('6.24', 'stats'), constructs: [], paths: [], tags: [MPLUS_TAG, 'Time series'], computed: [{ name: 'y_lag1', expr: 'lag(y)' }, { name: 'x_lag1', expr: 'lag(x)' }],
    panel: regression('gaussian', 'identity', 'y', ['y_lag1', 'x', 'x_lag1']), settings: CB('ML'),
  },
];
