// Mplus User's Guide, chapter 6: growth models for counts (examples 6.6 and 6.7), fitted as generalized linear
// mixed models by adaptive Gauss-Hermite quadrature on the GLMM card (GLMMadaptive; see common.ts). Mplus's
// growth factors are the random effects: i the intercept, s the slope of time.

import { CB, items } from '../define';
import type { PackageExample } from '../packages';
import { MPLUS_SRC, MPLUS_TAG, mplusData, mplusLinks } from './common';

const WIDE = { layout: 'wide' as const, outcome: '', cluster: '', occasions: items('u1', 4), times: [0, 1, 2, 3], predictors: [], categorical: [] };

export const MPLUS_CH6GLMM: PackageExample[] = [
  {
    id: 'mplus-ex6.6', package: 'GLMMadaptive', title: 'Linear growth model for a count outcome, Poisson (Mplus ex. 6.6)', source: MPLUS_SRC('6.6'), links: mplusLinks('6.6'),
    description: 'A linear growth model for a Poisson count u11–u14 at four occasions (time scores 0–3; Mplus: COUNT = u11-u14; i s | u11@0 u12@1 u13@2 u14@3; MLR, 15 integration points). The growth factors i and s are the random intercept and the random slope of time of a Poisson mixed model, which the GLMM card fits on the wide data by adaptive Gauss-Hermite quadrature (GLMMadaptive, 15 points per random effect, robust standard errors as MLR). Reproduces the Mplus output: 5 free parameters, the means of i and s (0.203 and 0.039; Mplus 0.204 and 0.039), their variances 0.372 and 0.094 (0.373, 0.094) and covariance 0.022, all within 0.0013, and the standard errors within 0.0015 (the slope variance’s 0.013 against 0.012). The log-likelihood is −3446.345 (Mplus −3446.329, AIC 6902.689 against 6902.658): GLMMadaptive’s is the exact maximum (the same to 10⁻⁶ with 15, 21 and 31 points), and at Mplus’s printed estimates the exact log-likelihood is −3446.346, so Mplus’s value, 0.016 higher than the maximum, is the approximation of its own adaptive integration. Opens its card on the Analyses tab.',
    data: mplusData('6.6', 'GLMMadaptive'), tags: [MPLUS_TAG], constructs: [], paths: [],
    panel: { kind: 'glmm', ...WIDE, slopes: ['time'], family: 'poisson', ziPredictors: [], ziRandom: false, quadrature: 15, robust: true }, settings: CB('ML'),
  },
  {
    id: 'mplus-ex6.7', package: 'GLMMadaptive', title: 'Linear growth model for a count outcome, zero-inflated Poisson (Mplus ex. 6.7)', source: MPLUS_SRC('6.7'), links: mplusLinks('6.7'),
    description: 'A linear growth model for a zero-inflated Poisson count u11–u14 (Mplus: COUNT = u11-u14 (i); i s | u11@0 … u14@3; ii si | u11#1@0 … u14#1@3; s@0 si@0; INTEGRATION = 7; MLR): a zero-inflated Poisson mixed model with a random intercept in the count part (i) and in the zero part (ii, correlated with i), fixed slopes of time in both parts (s, si) and the zero part’s intercept equal over time (Mplus’s u#1 intercepts). The GLMM card fits it by adaptive Gauss-Hermite quadrature (GLMMadaptive, 15 points, robust standard errors). Mplus uses only 7 integration points here, too few for this likelihood: at Mplus’s printed estimates the exact log-likelihood is −2778.081, while Mplus prints −2778.140; the card’s maximum is −2778.078 (unchanged from 9 to 15 points). The estimates agree to 0.002 for the means of i, s and si, the zero part’s intercept (−0.164 against −0.162) and the variance of i (0.385 against 0.386); the zero part’s random intercept, which only zeros inform, differs most: its variance 1.226 against Mplus’s 1.189 (SE 0.535) and its covariance with i −0.196 against −0.203 (SE 0.117). Standard errors agree within 0.004 except those two (0.634 and 0.129 against 0.535 and 0.117). 7 free parameters; AIC 5570.155 (Mplus 5570.280). Opens its card on the Analyses tab.',
    data: mplusData('6.7', 'GLMMadaptive'), tags: [MPLUS_TAG], constructs: [], paths: [],
    panel: { kind: 'glmm', ...WIDE, slopes: [], family: 'zip', ziPredictors: ['time'], ziRandom: true, quadrature: 15, robust: true }, settings: CB('ML'),
  },
];
