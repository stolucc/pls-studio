// Mplus User's Guide, chapter 5 (see common.ts).

import { CB, f, fan, items, v } from '../define';
import type { PackageExample } from '../packages';
import { MPLUS_SRC, MPLUS_TAG, mplusData, mplusLinks } from './common';

const TWIN = { g: ['mz', 'dz'] };
/** Mplus MODEL = NOCOVARIANCES: every pair of the twin factors uncorrelated but the A and the C pairs. */
const uncorrelated = (fs: string[]) => fs.flatMap((a, i) => fs.slice(i + 1).filter((b) => !(a[0] === b[0] && 'ac'.includes(a[0]))).map((b) => `${a} ~~ 0*${b}`));

export const MPLUS_CH5: PackageExample[] = [
  {
    id: 'mplus-ex5.1', package: 'lavaan', title: 'CFA with continuous indicators (Mplus ex. 5.1)', source: MPLUS_SRC('5.1'), links: mplusLinks('5.1'),
    description: 'Two correlated factors of three indicators each, the first loading of each fixed at 1, with Mplus’s defaults: intercepts estimated (the constant) and standard errors from the observed information. Reproduces the Mplus output: χ² = 3.896 on 8 df, log-likelihood −4906.609, 19 free parameters, and the estimates and standard errors (three loadings differ by 0.001 from Mplus’s, which stops at a looser convergence criterion).',
    data: mplusData('5.1'), tags: [MPLUS_TAG], constructs: [f('f1', items('y', 3)), f('f2', items('y', 3, 4))], paths: [], constant: true, information: 'observed', settings: CB('ML'),
  },
  {
    id: 'mplus-ex5.2', package: 'lavaan', title: 'CFA with binary indicators, WLSMV (Mplus ex. 5.2)', source: MPLUS_SRC('5.2'), links: mplusLinks('5.2'),
    description: 'The same two-factor model on six binary indicators u1–u6 declared categorical: thresholds and tetrachoric correlations with Mplus’s default WLSMV estimator and delta parameterisation. Every loading, threshold and factor (co)variance and their standard errors are those Mplus prints. With the test statistic as Mplus’s (under the estimator; lavaan’s mimic = “Mplus”) χ² = 5.482 on 8 df, as Mplus (lavaan’s own scaled-shifted statistic is 5.474); lavaan’s SRMR (0.024) is computed differently from Mplus’s (0.021).',
    data: mplusData('5.2'), tags: [MPLUS_TAG], constructs: [f('f1', items('u', 3)), f('f2', items('u', 3, 4))], paths: [], ordered: items('u', 6), mimic: 'Mplus', settings: CB('WLSMV'),
  },
  {
    id: 'mplus-ex5.3', package: 'lavaan', title: 'CFA with continuous and categorical indicators (Mplus ex. 5.3)', source: MPLUS_SRC('5.3'), links: mplusLinks('5.3'),
    description: 'Two correlated factors: f1 of three binary indicators u1–u3 declared categorical, f2 of three continuous indicators y4–y6, with Mplus’s default WLSMV estimator and delta parameterisation (thresholds for the binary, intercepts and residual variances for the continuous indicators). WLSMV standard errors as Mplus’s (the default) and the test statistic as Mplus’s (lavaan’s mimic = “Mplus”, which also treats the continuous indicators’ variances as Mplus does). Reproduces the Mplus output: 16 free parameters, χ² = 3.935 on 8 df, and every estimate and standard error.',
    data: mplusData('5.3'), tags: [MPLUS_TAG], constructs: [f('f1', items('u', 3)), f('f2', items('y', 3, 4))], paths: [], ordered: items('u', 3), constant: true, mimic: 'Mplus', settings: CB('WLSMV'),
  },
  {
    id: 'mplus-ex5.5', package: 'ltm', title: 'Generalized partial credit IRT model (Mplus ex. 5.5, part 1)', source: MPLUS_SRC('5.5'), links: mplusLinks('5.5'),
    description: 'Twenty items u1–u20 with five ordered categories (N = 5000) and one factor f with variance 1 (Mplus: CATEGORICAL = u1-u20 (gpcm); f BY u1-u20*; f@1; ESTIMATOR = MLR): Muraki’s generalized partial credit model, which ltm’s gpcm fits by marginal maximum likelihood. With ltm’s default of 21 quadrature points the log-likelihood is off by 180 (−121801.6); the card is set to 81, and robust (sandwich) standard errors as Mplus’s MLR. Reproduces the Mplus output: log-likelihood −121621.098, 100 free parameters, AIC 243442.196, BIC 244093.915, every loading and step within 0.0011 and their MLR standard errors within 0.001 (the card’s logit-metric table; Mplus’s steps are minus ltm’s intercepts). The partial credit model takes a few minutes in the browser.',
    data: mplusData('5.5', 'ltm'), tags: [MPLUS_TAG], constructs: [], paths: [],
    panel: { kind: 'irt', items: items('u', 20), model: 'gpcm', quadrature: 81, robust: true }, settings: CB('ML'),
  },
  {
    id: 'mplus-ex5.5part2', package: 'ltm', title: 'Two-parameter logistic IRT model (Mplus ex. 5.5, part 2)', source: MPLUS_SRC('5.5'), links: mplusLinks('5.5part2'),
    description: 'Twenty binary items u1–u20 (N = 500), one factor f with variance 1 (Mplus: CATEGORICAL = u1-u20; f BY u1-u20*; f@1; ESTIMATOR = MLR): the two-parameter logistic model, fitted by ltm with 81 quadrature points and robust (sandwich) standard errors as Mplus’s MLR. Reproduces the Mplus output: log-likelihood −6265.314 (Mplus −6265.315), 40 free parameters, AIC 12610.628 (12610.630), BIC 12779.213 (12779.214), the thresholds and every MLR standard error within 0.001, and the loadings within 0.0015 (ltm’s are slightly lower, u1 1.0246 against 1.026, at a log-likelihood no lower than Mplus’s). The card also shows the IRT parameterisation (difficulty = threshold / loading).',
    data: mplusData('5.5part2', 'ltm'), tags: [MPLUS_TAG], constructs: [], paths: [],
    panel: { kind: 'irt', items: items('u', 20), model: 'twopl', quadrature: 81, robust: true }, settings: CB('ML'),
  },
  {
    id: 'mplus-ex5.6', package: 'lavaan', title: 'Second-order factor model (Mplus ex. 5.6)', source: MPLUS_SRC('5.6'), links: mplusLinks('5.6'),
    description: 'Four first-order factors of three indicators each load on one second-order factor f5, with Mplus’s defaults (intercepts estimated, observed-information standard errors). Reproduces the Mplus output: log-likelihood −7211.373, 40 free parameters, χ² = 46.743 on 50 df, and every estimate and standard error.',
    data: mplusData('5.6'), tags: [MPLUS_TAG],
    constructs: [f('f1', items('y', 3)), f('f2', items('y', 3, 4)), f('f3', items('y', 3, 7)), f('f4', items('y', 3, 10)), { name: 'f5', type: 'factor', mode: 'A', components: ['f1', 'f2', 'f3', 'f4'] }],
    paths: [], constant: true, information: 'observed', settings: CB('ML'),
  },
  {
    id: 'mplus-ex5.8', package: 'lavaan', title: 'CFA with covariates, MIMIC (Mplus ex. 5.8)', source: MPLUS_SRC('5.8'), links: mplusLinks('5.8'),
    description: 'Two factors regressed on three covariates x1–x3. Mplus frees the residual covariance of f1 and f2 by default (two factors regressed on the same covariates), drawn here as the double-headed arrow between their disturbances; intercepts and observed-information standard errors as Mplus. Reproduces the Mplus output: log-likelihood −4000.617, 25 free parameters, χ² = 20.023 on 20 df, and every estimate and standard error.',
    data: mplusData('5.8'), tags: [MPLUS_TAG, 'MIMIC'],
    constructs: [v('x1', true), v('x2', true), v('x3', true), f('f1', items('y', 3)), f('f2', items('y', 3, 4))],
    paths: fan(['x1', 'x2', 'x3'], ['f1', 'f2']), correlations: [['f1', 'f2', 'construct']], constant: true, information: 'observed', settings: CB('ML'),
  },
  {
    id: 'mplus-ex5.9', package: 'lavaan', title: 'Mean structure CFA with equal intercepts (Mplus ex. 5.9)', source: MPLUS_SRC('5.9'), links: mplusLinks('5.9'),
    description: 'Two factors whose three indicators all load 1 (Mplus: f1 BY y1a y1b@1 y1c@1), with the intercepts held equal within each factor ([y1a y1b y1c] (1)): a mean structure for repeated measures of one construct. Written as lavaan syntax with labelled intercepts (y1a ~ i1*1 …); intercepts and observed-information standard errors as Mplus. Reproduces the Mplus output: log-likelihood −4150.048, 11 free parameters, χ² = 12.844 on 16 df, and every estimate and standard error.',
    data: mplusData('5.9'), tags: [MPLUS_TAG], constructs: [], paths: [],
    syntax: 'f1 =~ y1a + 1*y1b + 1*y1c\nf2 =~ y2a + 1*y2b + 1*y2c\ny1a ~ i1*1\ny1b ~ i1*1\ny1c ~ i1*1\ny2a ~ i2*1\ny2b ~ i2*1\ny2c ~ i2*1',
    constant: true, information: 'observed', settings: CB('ML'),
  },
  {
    id: 'mplus-ex5.10', package: 'lavaan', title: 'Threshold structure CFA with categorical indicators (Mplus ex. 5.10)', source: MPLUS_SRC('5.10'), links: mplusLinks('5.10'),
    description: 'Example 5.9 with binary indicators declared categorical: loadings 1 and the thresholds held equal within each factor ([u1a$1 u1b$1 u1c$1] (1); lavaan u1a | t1*t1 …), with Mplus’s default WLSMV estimator and delta parameterisation. Reproduces every estimate and standard error Mplus prints, its 5 free parameters on 16 df and, with the test statistic as Mplus’s (lavaan’s mimic = “Mplus”), its χ² = 15.119 (lavaan’s own scaled-shifted statistic is 15.091).',
    data: mplusData('5.10'), tags: [MPLUS_TAG], constructs: [], paths: [],
    syntax: 'f1 =~ u1a + 1*u1b + 1*u1c\nf2 =~ u2a + 1*u2b + 1*u2c\nu1a | t1*t1\nu1b | t1*t1\nu1c | t1*t1\nu2a | t2*t1\nu2b | t2*t1\nu2c | t2*t1',
    mimic: 'Mplus', settings: CB('WLSMV'),
  },
  {
    id: 'mplus-ex5.11', package: 'lavaan', title: 'SEM with an indirect effect (Mplus ex. 5.11)', source: MPLUS_SRC('5.11'), links: mplusLinks('5.11'),
    description: 'Four factors of three indicators: f1 and f2 (correlated) explain f3, which explains f4; intercepts and observed-information standard errors as Mplus. Reproduces the Mplus output: log-likelihood −9646.960, 40 free parameters, χ² = 53.704 on 50 df, and every estimate and standard error. Example 5.12 is the same model with MODEL INDIRECT, the indirect effect of f1 on f4 as a defined parameter.',
    data: mplusData('5.11'), tags: [MPLUS_TAG],
    constructs: [f('f1', items('y', 3)), f('f2', items('y', 3, 4)), f('f3', items('y', 3, 7)), f('f4', items('y', 3, 10))],
    paths: [['f1', 'f3'], ['f2', 'f3'], ['f3', 'f4']], constant: true, information: 'observed', settings: CB('ML'),
  },
  {
    id: 'mplus-ex5.12', package: 'lavaan', title: 'SEM with an indirect effect, MODEL INDIRECT (Mplus ex. 5.12)', source: MPLUS_SRC('5.12'), links: mplusLinks('5.12'),
    description: 'The model of example 5.11 with MODEL INDIRECT (f4 IND f3 f1): the paths f1 → f3 and f3 → f4 labelled a and b, and the indirect effect defined as ind := a*b, with its delta-method standard error. Intercepts and observed-information standard errors as Mplus. Reproduces the Mplus output: log-likelihood −9646.960, 40 free parameters, χ² = 53.704 on 50 df, every estimate and standard error, and the indirect effect of f1 on f4, 0.266 (SE 0.043).',
    data: mplusData('5.12'), tags: [MPLUS_TAG], constructs: [], paths: [],
    syntax: 'f1 =~ y1 + y2 + y3\nf2 =~ y4 + y5 + y6\nf3 =~ y7 + y8 + y9\nf4 =~ y10 + y11 + y12\nf4 ~ b*f3\nf3 ~ a*f1 + f2\nind := a*b',
    constant: true, information: 'observed', settings: CB('ML'),
  },
  {
    id: 'mplus-ex5.13', package: 'modsem', title: 'Latent interaction by LMS (Mplus ex. 5.13)', source: MPLUS_SRC('5.13'), links: mplusLinks('5.13'),
    description: 'The model of example 5.11 on its own data, with the interaction of f1 and f2 on f3 (Mplus: f1 XWITH f2, TYPE = RANDOM, ALGORITHM = INTEGRATION): the latent moderated structural equations of Klein & Moosbrugger, which modsem’s LMS implements. Mplus estimates the interaction at 0.397, f3 on f1 0.439 and on f2 0.812, f4 on f3 0.585; modsem’s LMS gives 0.396, 0.438, 0.812 and 0.585 (the two programs integrate differently, so they agree to two decimals). Mplus estimates this model with MLR (robust standard errors) and reports a log-likelihood of −9672.065; modsem reports ML standard errors and its log-likelihood is not on the same footing, so AIC and BIC are not comparable with Mplus’s.',
    data: mplusData('5.13', 'modsem'), tags: [MPLUS_TAG],
    constructs: [f('f1', items('y', 3)), f('f2', items('y', 3, 4)), f('f3', items('y', 3, 7)), f('f4', items('y', 3, 10))],
    paths: [['f1', 'f3'], ['f2', 'f3'], ['f3', 'f4']], moderations: [['f1', 'f2', 'f3']], settings: { ...CB('ML'), interaction: 'lms' },
  },
  {
    id: 'mplus-ex5.14', package: 'lavaan', title: 'Two-group MIMIC model (Mplus ex. 5.14)', source: MPLUS_SRC('5.14'), links: mplusLinks('5.14'),
    description: 'The MIMIC model of example 5.8 in two groups (g: 1 = male, 2 = female; N = 1100) without a mean structure (Mplus: MODEL = NOMEANSTRUCTURE). Loadings are held equal across groups except that of y3 on f1, freed for females (MODEL female: f1 BY y3); regressions and residual variances differ by group. Standard errors from the expected information (Mplus: INFORMATION = EXPECTED; lavaan’s default). Reproduces the Mplus output: log-likelihood −8811.413, 35 free parameters, χ² = 41.735 on 43 df, and every estimate and standard error in both groups.',
    data: mplusData('5.14'), tags: [MPLUS_TAG, 'MIMIC'], labels: { g: ['male', 'female'] },
    constructs: [v('x1', true), v('x2', true), v('x3', true), f('f1', items('y', 3)), f('f2', items('y', 3, 4))],
    paths: fan(['x1', 'x2', 'x3'], ['f1', 'f2']), correlations: [['f1', 'f2', 'construct']],
    multigroup: { column: 'g', invariance: 'metric', free: [{ kind: 'loading', construct: 'f1', indicator: 'y3' }], meanStructure: false }, settings: CB('ML'),
  },
  {
    id: 'mplus-ex5.15', package: 'lavaan', title: 'Two-group MIMIC model with a mean structure (Mplus ex. 5.15)', source: MPLUS_SRC('5.15'), links: mplusLinks('5.15'),
    description: 'Example 5.14 with Mplus’s default mean structure: intercepts equal across groups and factor means fixed at zero for males and free for females, the loading and the intercept of y3 freed for females ([y3]). Observed-information standard errors as Mplus. Reproduces the Mplus output: log-likelihood −8812.330, 44 free parameters, χ² = 43.569 on 46 df, and every estimate and standard error in both groups.',
    data: mplusData('5.15'), tags: [MPLUS_TAG, 'MIMIC'], labels: { g: ['male', 'female'] },
    constructs: [v('x1', true), v('x2', true), v('x3', true), f('f1', items('y', 3)), f('f2', items('y', 3, 4))],
    paths: fan(['x1', 'x2', 'x3'], ['f1', 'f2']), correlations: [['f1', 'f2', 'construct']],
    multigroup: { column: 'g', invariance: 'scalar', free: [{ kind: 'loading', construct: 'f1', indicator: 'y3' }, { kind: 'intercept', indicator: 'y3' }] }, constant: true, information: 'observed', settings: CB('ML'),
  },
  {
    id: 'mplus-ex5.16', package: 'lavaan', title: 'Two-group MIMIC model with categorical indicators (Mplus ex. 5.16)', source: MPLUS_SRC('5.16'), links: mplusLinks('5.16'),
    description: 'The MIMIC model of example 5.14 with six binary indicators declared categorical, in two groups (g: 1 = male, 2 = female), with Mplus’s defaults for groups: loadings and thresholds equal, the factor means and the scale factors free in the second group; for females the loading and threshold of u3 are free (MODEL female: f1 BY u3; [u3$1]) and its scale factor fixed at 1 ({u3@1}). WLSMV, delta parameterisation. Reproduces the Mplus output: 37 free parameters on 41 df and every estimate and standard error in both groups (WLSMV standard errors as Mplus’s, the default). lavaan’s scaled-shifted χ² is 33.693, Mplus prints 33.718: Mplus’s test statistic (lavaan’s mimic = “Mplus”) is offered for one group only, as with groups lavaan’s mimic also changes which parameters are held equal.',
    data: mplusData('5.16'), tags: [MPLUS_TAG, 'MIMIC'], labels: { g: ['male', 'female'] },
    constructs: [v('x1', true), v('x2', true), v('x3', true), f('f1', items('u', 3)), f('f2', items('u', 3, 4))],
    paths: fan(['x1', 'x2', 'x3'], ['f1', 'f2']), correlations: [['f1', 'f2', 'construct']], ordered: items('u', 6),
    multigroup: { column: 'g', invariance: 'scalar', free: [{ kind: 'loading', construct: 'f1', indicator: 'u3' }, { kind: 'intercept', indicator: 'u3' }], ordinalScales: 'free' }, settings: CB('WLSMV'),
  },
  {
    id: 'mplus-ex5.17', package: 'lavaan', title: 'Two-group MIMIC model with categorical indicators, theta parameterisation (Mplus ex. 5.17)', source: MPLUS_SRC('5.17'), links: mplusLinks('5.17'),
    description: 'Example 5.16 in the theta parameterisation (Mplus: PARAMETERIZATION = THETA): residual variances of the latent responses fixed at 1 for males and free for females, except u3’s, fixed at 1 (u3@1). The same model as 5.16 differently scaled: lavaan’s χ² is that of 5.16 to six decimals (33.693; Mplus prints 33.719). The male group reproduces Mplus within 0.002 (estimates) and 0.001 (standard errors); in the female group the factor f1 is weakly determined (its variance has SE 0.71) and Mplus’s printed estimates differ by up to 0.021 (f1’s variance 1.579 against 1.599) and their standard errors, which follow the estimates, by up to 0.009 (that of f1’s variance 0.711 against 0.719): lavaan’s fit function is 0.0048524 at Mplus’s printed values and 0.0048522 at its own minimum, to which it returns when started from Mplus’s values.',
    data: mplusData('5.17'), tags: [MPLUS_TAG, 'MIMIC'], labels: { g: ['male', 'female'] },
    constructs: [v('x1', true), v('x2', true), v('x3', true), f('f1', items('u', 3)), f('f2', items('u', 3, 4))],
    paths: fan(['x1', 'x2', 'x3'], ['f1', 'f2']), correlations: [['f1', 'f2', 'construct']], ordered: items('u', 6), parameterization: 'theta',
    multigroup: { column: 'g', invariance: 'scalar', free: [{ kind: 'loading', construct: 'f1', indicator: 'u3' }, { kind: 'intercept', indicator: 'u3' }], ordinalScales: 'free' }, settings: CB('WLSMV'),
  },
  {
    id: 'mplus-ex5.20', package: 'lavaan', title: 'CFA with parameter constraints (Mplus ex. 5.20)', source: MPLUS_SRC('5.20'), links: mplusLinks('5.20'),
    description: 'Two factors with labelled loadings, factor variances and residual variances, and MODEL CONSTRAINT: the reliabilities rel2 and rel5 and the standardised loadings stan3 and stan6 as new parameters, held equal (rel5 = rel2; 0 = stan6 − stan3), and the inequalities ve2 > ve5 and ve4 > 0. Written as lavaan syntax: the new parameters are defined parameters (:=, SQRT as ^0.5), the equalities and inequalities lavaan constraints (under Constraints). Intercepts and observed-information standard errors as Mplus. Reproduces the Mplus output: log-likelihood −3898.949, 17 free parameters, χ² = 4.090 on 10 df, every estimate, rel2 = rel5 = 0.722 (SE 0.024) and stan3 = stan6 = 0.805 (SE 0.015); one standard error, of f2’s variance, is 0.088 against Mplus’s 0.087.',
    data: mplusData('5.20'), tags: [MPLUS_TAG], constructs: [], paths: [],
    syntax: ['f1 =~ y1 + lam2*y2 + lam3*y3', 'f2 =~ y4 + lam5*y5 + lam6*y6', 'f1 ~~ vf1*f1', 'f2 ~~ vf2*f2',
      ...[1, 2, 3, 4, 5, 6].map((i) => `y${i} ~~ ve${i}*y${i}`),
      'rel2 := lam2^2*vf1/(lam2^2*vf1 + ve2)', 'rel5 := lam5^2*vf2/(lam5^2*vf2 + ve5)',
      'stan3 := lam3*vf1^0.5/(lam3^2*vf1 + ve3)^0.5', 'stan6 := lam6*vf2^0.5/(lam6^2*vf2 + ve6)^0.5',
      'rel5 == rel2', 'stan6 == stan3', 've2 > ve5', 've4 > 0'].join('\n'),
    constant: true, information: 'observed', settings: CB('ML'),
  },
  {
    id: 'mplus-ex5.18', package: 'lavaan', title: 'Twin ACE model for continuous outcomes (Mplus ex. 5.18)', source: MPLUS_SRC('5.18'), links: mplusLinks('5.18'),
    description: 'Twin pairs (y1, y2) in two groups, monozygotic and dizygotic (g: 1 = mz, 2 = dz), with the additive genetic (a1, a2), common environment (c1, c2) and unique environment (e1, e2) factors of each twin: each twin’s outcome loads on its three factors, so y1 is an indicator of a1, c1 and e1 and y2 of a2, c2 and e2 (in CB-SEM an indicator may load on several factors). The factors have variance 1 and mean 0 (Mplus: a1 BY y1* (2); a1-e2@1; [a1-e2@0]); the loadings a, c and e are equal across twins and groups (labels la, lc, le), as are the means of y1 and y2 (label i); the outcomes have no residual variance of their own (y1-y2@0), which is the E factors’; the A factors correlate 1 in mz and 0.5 in dz pairs (a1 ~~ c(1, 0.5)*a2), the C factors 1 in both; every other pair of factors is uncorrelated (Mplus MODEL = NOCOVARIANCES). Observed-information standard errors as Mplus. Reproduces the Mplus output: log-likelihood −5217.340, 4 free parameters, χ² = 5.160 on 6 df, and every estimate and standard error: a = 0.801 (0.035), c = 0.333 (0.078), e = 0.515 (0.011). Example 5.21 is the same model through parameter constraints.',
    data: mplusData('5.18'), tags: [MPLUS_TAG, 'Twin model'], labels: TWIN, constructs: [], paths: [],
    syntax: ['a1 =~ NA*la*y1', 'a2 =~ NA*la*y2', 'c1 =~ NA*lc*y1', 'c2 =~ NA*lc*y2', 'e1 =~ NA*le*y1', 'e2 =~ NA*le*y2',
      'a1 ~~ 1*a1', 'a2 ~~ 1*a2', 'c1 ~~ 1*c1', 'c2 ~~ 1*c2', 'e1 ~~ 1*e1', 'e2 ~~ 1*e2',
      'a1 ~~ c(1, 0.5)*a2', 'c1 ~~ 1*c2', ...uncorrelated(['a1', 'a2', 'c1', 'c2', 'e1', 'e2']), 'y1 ~~ 0*y1', 'y2 ~~ 0*y2', 'y1 ~ i*1', 'y2 ~ i*1'].join('\n'),
    multigroup: { column: 'g', invariance: 'configural', free: [] }, information: 'observed', settings: CB('ML'),
  },
  {
    id: 'mplus-ex5.19', package: 'lavaan', title: 'Twin ACE model for categorical outcomes (Mplus ex. 5.19)', source: MPLUS_SRC('5.19'), links: mplusLinks('5.19'),
    description: 'Example 5.18 for binary twin outcomes (u1, u2 categorical, WLSMV): the latent responses of u1 and u2 load on their twin’s A and C factors (variance 1, mean 0; loadings la and lc equal across twins and groups), the A factors correlated 1 in mz and 0.5 in dz pairs, the C factors 1, the others uncorrelated (Mplus MODEL = NOCOVARIANCES); one threshold for both twins and groups (label t), and the latent responses’ scale fixed at 1 in both groups (Mplus {u1-u2@1} in dz), so the unique environment is the residual 1 − a² − c². Reproduces the Mplus output: 3 free parameters on 3 df, every estimate and standard error (a = 0.848, SE 0.060; the threshold 0.007, 0.024), c = 0.228 (SE 0.200) against Mplus’s 0.229 (0.199): c is weakly determined (c² = 2cov(dz) − cov(mz)) and the two programs stop 0.001 apart, as in example 5.22, the same model through constraints, where c is 0.228 too. lavaan’s scaled-shifted χ² is 0.904, Mplus prints 0.905.',
    data: mplusData('5.19'), tags: [MPLUS_TAG, 'Twin model'], labels: TWIN, constructs: [], paths: [],
    syntax: ['a1 =~ NA*la*u1', 'a2 =~ NA*la*u2', 'c1 =~ NA*lc*u1', 'c2 =~ NA*lc*u2',
      'a1 ~~ 1*a1', 'a2 ~~ 1*a2', 'c1 ~~ 1*c1', 'c2 ~~ 1*c2', 'a1 ~~ c(1, 0.5)*a2', 'c1 ~~ 1*c2', ...uncorrelated(['a1', 'a2', 'c1', 'c2']), 'u1 | t*t1', 'u2 | t*t1'].join('\n'),
    multigroup: { column: 'g', invariance: 'configural', free: [] }, settings: CB('WLSMV'),
  },
  {
    id: 'mplus-ex5.21', package: 'lavaan', title: 'Twin ACE model for continuous outcomes by parameter constraints (Mplus ex. 5.21)', source: MPLUS_SRC('5.21'), links: mplusLinks('5.21'),
    description: 'Twin pairs (y1, y2) in two groups, monozygotic and dizygotic (g: 1 = mz, 2 = dz): means and variances equal across twins and groups, the twin covariance covmz and covdz per group (lavaan c(covmz, covdz)). Mplus estimates the additive genetic, common and unique environment parameters a, c and e as new parameters with var = a² + c² + e², covmz = a² + c², covdz = 0.5a² + c²; lavaan cannot estimate parameters outside the model, so the three equations are solved instead: a = √(2(covmz − covdz)), c = √(2covdz − covmz), e = √(var − covmz) and the heritability h = a²/var are defined parameters, with delta-method standard errors. The same model, with the same maximum and standard errors. Reproduces the Mplus output: log-likelihood −5216.004, 4 free parameters, χ² = 5.161 on 6 df, every estimate and standard error, a = 0.801 (SE 0.035), c = 0.333 (0.078), e = 0.515 (0.011), h = 0.631 (0.053).',
    data: mplusData('5.21'), tags: [MPLUS_TAG, 'Twin model'], labels: TWIN, constructs: [], paths: [],
    syntax: 'y1 ~ i*1\ny2 ~ i*1\ny1 ~~ v*y1\ny2 ~~ v*y2\ny1 ~~ c(covmz, covdz)*y2\na := (2*(covmz - covdz))^0.5\nc := (2*covdz - covmz)^0.5\ne := (v - covmz)^0.5\nh := 2*(covmz - covdz)/v',
    multigroup: { column: 'g', invariance: 'configural', free: [] }, information: 'observed', settings: CB('ML'),
  },
  {
    id: 'mplus-ex5.22', package: 'lavaan', title: 'Twin ACE model for categorical outcomes by parameter constraints (Mplus ex. 5.22)', source: MPLUS_SRC('5.22'), links: mplusLinks('5.22'),
    description: 'Example 5.21 for binary twin outcomes (u1, u2 categorical, WLSMV): one threshold for both twins and groups, the tetrachoric correlation covmz and covdz per group, and as in 5.21 a = √(2(covmz − covdz)), c = √(2covdz − covmz), e = 1 − covmz and h = a² (the latent responses have variance 1) as defined parameters instead of Mplus’s new parameters. Reproduces every estimate and standard error Mplus prints, 3 free parameters on 3 df, a = 0.848 (SE 0.060), c = 0.228 (0.199), e = 0.229 (0.026), h = 0.719 (0.102); lavaan’s scaled-shifted χ² is 0.904, Mplus prints 0.905.',
    data: mplusData('5.22'), tags: [MPLUS_TAG, 'Twin model'], labels: TWIN, constructs: [], paths: [],
    syntax: 'u1 | t*t1\nu2 | t*t1\nu1 ~~ c(covmz, covdz)*u2\na := (2*(covmz - covdz))^0.5\nc := (2*covdz - covmz)^0.5\ne := 1 - covmz\nh := 2*(covmz - covdz)',
    multigroup: { column: 'g', invariance: 'configural', free: [] }, settings: CB('WLSMV'),
  },
  {
    id: 'mplus-ex5.23', package: 'stats', title: 'QTL sibling model with a per-pair genetic value (Mplus ex. 5.23)', source: MPLUS_SRC('5.23'), links: mplusLinks('5.23'),
    description: 'Sibling pairs (y1, y2; N = 2000) and pihat, the estimated proportion of alleles the pair shares identical by descent at a locus (a quantitative trait locus, QTL): the siblings’ means are equal (mu), their variances are a² + e² + q² (polygenic, environmental and QTL parts) and their covariance is 0.5a² + pihat·q², so the covariance varies from pair to pair with pihat (Mplus: CONSTRAINT = pihat; MODEL CONSTRAINT: NEW(a e q); var = a**2 + e**2 + q**2; cov = 0.5*a**2 + pihat*q**2). lavaan cannot let a covariance depend on a data value; the custom likelihood card fits the bivariate normal likelihood written with these expressions, pihat a data column in the covariance’s expression (a definition variable). Reproduces the Mplus output: log-likelihood −6355.741, 4 free parameters, AIC 12719.482, BIC 12741.885, the mean 0.012 (SE 0.023), the variance 1.528 (0.037) and the NEW parameters a = 0.848 (0.064), e = 0.622 (0.045), q = 0.649 (0.059), with observed-information standard errors (Mplus’s ML). The covariance, which differs between pairs, has no single value (Mplus prints 999). Opens its card on the Analyses tab.',
    data: mplusData('5.23', 'stats'), tags: [MPLUS_TAG, 'Twin model'], constructs: [], paths: [],
    panel: { kind: 'customml', type: 'normal', outcomes: ['y1', 'y2'], parameters: [{ name: 'mu', start: 0 }, { name: 'a', start: 0.8 }, { name: 'e', start: 0.6 }, { name: 'q', start: 0.6 }],
      logits: [], means: ['mu', 'mu'], variances: ['a^2 + e^2 + q^2', 'a^2 + e^2 + q^2'], covariances: ['0.5*a^2 + pihat*q^2'], defined: [], se: 'model' },
    settings: CB('ML'),
  },
  {
    id: 'mplus-ex5.25', package: 'lavaan', title: 'SEM with EFA and CFA factors (Mplus ex. 5.25)', source: MPLUS_SRC('5.25'), links: mplusLinks('5.25'),
    description: 'Two exploratory factors f1 and f2 of y1–y6 (Mplus: f1-f2 BY y1-y6 (*1), geomin rotation) explain the CFA factor f3, which explains f4: exploratory SEM. Mplus’s geomin uses ε = 0.0001 with two factors (lavaan’s default is 0.001, which moves the rotated loadings and with them the factor correlation and the paths from f1 and f2), so the block is set to 0.0001; intercepts and observed-information standard errors as Mplus. Reproduces the Mplus output: log-likelihood −6482.762, 44 free parameters, χ² = 51.353 on 46 df, and every estimate and standard error.',
    data: mplusData('5.25'), tags: [MPLUS_TAG],
    constructs: [f('f1', items('y', 3)), f('f2', items('y', 3, 4)), f('f3', items('y', 3, 7)), f('f4', items('y', 3, 10))],
    paths: [['f1', 'f3'], ['f2', 'f3'], ['f3', 'f4']], esem: { blocks: [['f1', 'f2']], rotation: 'geomin', epsilon: 0.0001 }, constant: true, information: 'observed', settings: CB('ML'),
  },
];
