// Mplus User's Guide, chapter 5 (see common.ts).

import { CB, f, fan, items, v } from '../define';
import type { PackageExample } from '../packages';
import { MPLUS_SRC, MPLUS_TAG, mplusData, mplusLinks } from './common';

export const MPLUS_CH5: PackageExample[] = [
  {
    id: 'mplus-ex5.1', package: 'lavaan', title: 'CFA with continuous indicators (Mplus ex. 5.1)', source: MPLUS_SRC('5.1'), links: mplusLinks('5.1'),
    description: 'Two correlated factors of three indicators each, the first loading of each fixed at 1, with Mplus’s defaults: intercepts estimated (the constant) and standard errors from the observed information. Reproduces the Mplus output: χ² = 3.896 on 8 df, log-likelihood −4906.609, 19 free parameters, and the estimates and standard errors (three loadings differ by 0.001 from Mplus’s, which stops at a looser convergence criterion).',
    data: mplusData('5.1'), tags: [MPLUS_TAG], constructs: [f('f1', items('y', 3)), f('f2', items('y', 3, 4))], paths: [], constant: true, information: 'observed', settings: CB('ML'),
  },
  {
    id: 'mplus-ex5.2', package: 'lavaan', title: 'CFA with binary indicators, WLSMV (Mplus ex. 5.2)', source: MPLUS_SRC('5.2'), links: mplusLinks('5.2'),
    description: 'The same two-factor model on six binary indicators u1–u6 declared categorical: thresholds and tetrachoric correlations with Mplus’s default WLSMV estimator and delta parameterisation. Every loading, threshold and factor (co)variance and their standard errors are those Mplus prints. The test statistics differ slightly in their adjustment: Mplus prints χ² = 5.482 on 8 df, lavaan’s scaled-shifted statistic is 5.474; lavaan’s SRMR (0.024) is computed differently from Mplus’s (0.021).',
    data: mplusData('5.2'), tags: [MPLUS_TAG], constructs: [f('f1', items('u', 3)), f('f2', items('u', 3, 4))], paths: [], ordered: items('u', 6), settings: CB('WLSMV'),
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
    id: 'mplus-ex5.11', package: 'lavaan', title: 'SEM with an indirect effect (Mplus ex. 5.11)', source: MPLUS_SRC('5.11'), links: mplusLinks('5.11'),
    description: 'Four factors of three indicators: f1 and f2 (correlated) explain f3, which explains f4; intercepts and observed-information standard errors as Mplus. Reproduces the Mplus output: log-likelihood −9646.960, 40 free parameters, χ² = 53.704 on 50 df, and every estimate and standard error. Mplus’s example 5.12 is the same model with MODEL INDIRECT: the indirect effect of f1 on f4 through f3 is 0.266 (SE 0.043, delta method); the app’s effects table shows it standardised, and the indirect-effects card gives it unstandardised with a Monte Carlo or bootstrap interval.',
    data: mplusData('5.11'), tags: [MPLUS_TAG],
    constructs: [f('f1', items('y', 3)), f('f2', items('y', 3, 4)), f('f3', items('y', 3, 7)), f('f4', items('y', 3, 10))],
    paths: [['f1', 'f3'], ['f2', 'f3'], ['f3', 'f4']], constant: true, information: 'observed', settings: CB('ML'),
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
    id: 'mplus-ex5.25', package: 'lavaan', title: 'SEM with EFA and CFA factors (Mplus ex. 5.25)', source: MPLUS_SRC('5.25'), links: mplusLinks('5.25'),
    description: 'Two exploratory factors f1 and f2 of y1–y6 (Mplus: f1-f2 BY y1-y6 (*1), geomin rotation) explain the CFA factor f3, which explains f4: exploratory SEM. Mplus’s geomin uses ε = 0.0001 with two factors (lavaan’s default is 0.001, which moves the rotated loadings and with them the factor correlation and the paths from f1 and f2), so the block is set to 0.0001; intercepts and observed-information standard errors as Mplus. Reproduces the Mplus output: log-likelihood −6482.762, 44 free parameters, χ² = 51.353 on 46 df, and every estimate and standard error.',
    data: mplusData('5.25'), tags: [MPLUS_TAG],
    constructs: [f('f1', items('y', 3)), f('f2', items('y', 3, 4)), f('f3', items('y', 3, 7)), f('f4', items('y', 3, 10))],
    paths: [['f1', 'f3'], ['f2', 'f3'], ['f3', 'f4']], esem: { blocks: [['f1', 'f2']], rotation: 'geomin', epsilon: 0.0001 }, constant: true, information: 'observed', settings: CB('ML'),
  },
];
