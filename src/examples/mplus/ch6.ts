// Mplus User's Guide, chapter 6 (see common.ts).

import { CB, items } from '../define';
import type { PackageExample } from '../packages';
import { MPLUS_SRC, MPLUS_TAG, mplusData, mplusLinks } from './common';

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
];
