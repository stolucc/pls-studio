// Mplus User's Guide, chapter 5: the EFA and ESEM examples 5.24–5.30 (see common.ts).

import { CB, f, items } from '../define';
import type { PackageExample } from '../packages';
import { MPLUS_SRC, MPLUS_TAG, mplusData, mplusLinks } from './common';

/** Two exploratory factors of y1–y10 in one ESEM block (y1–y5 and y6–y10 only seed the diagram: every loading is estimated). */
const TWO = [f('f1', items('y', 5)), f('f2', items('y', 5, 6))];

export const MPLUS_CH5EFA: PackageExample[] = [
  {
    id: 'mplus-ex5.24', package: 'lavaan', title: 'EFA with covariates and direct effects, MIMIC (Mplus ex. 5.24)', source: MPLUS_SRC('5.24'), links: mplusLinks('5.24'),
    description: 'Two exploratory factors of y1–y8 (Mplus: f1-f2 BY y1-y8 (*1), geomin rotation) regressed on the covariates x1 and x2 (f1-f2 ON x1-x2), with direct effects of x1 on the indicator y1 and of x2 on y8 (y1 ON x1; y8 ON x2): arrows from the covariates to the indicators’ boxes, beside their loadings. Geomin’s ε is 0.0001, Mplus’s value for two factors; the factors’ residual covariance is free (Mplus’s default; f1 ~~ f2, between their disturbances); intercepts and observed-information standard errors as Mplus. Reproduces the Mplus output: log-likelihood −4630.127, 37 free parameters, χ² = 30.268 on 23 df, and every estimate and standard error, the direct effects included.',
    data: mplusData('5.24'), tags: [MPLUS_TAG, 'ESEM', 'MIMIC'], constructs: [], paths: [],
    syntax: 'f1 =~ y1 + y2 + y3 + y4\nf2 =~ y5 + y6 + y7 + y8\nf1 + f2 ~ x1 + x2\ny1 ~ x1\ny8 ~ x2\nf1 ~~ f2',
    esem: { blocks: [['f1', 'f2']], rotation: 'geomin', epsilon: 0.0001 }, constant: true, information: 'observed', settings: CB('ML'),
  },
  {
    id: 'mplus-ex5.27', package: 'lavaan', title: 'Multiple-group EFA without measurement invariance (Mplus ex. 5.27)', source: MPLUS_SRC('5.27'), links: mplusLinks('5.27'),
    description: 'Two exploratory factors of y1–y10 (Mplus: f1-f2 BY y1-y10 (*1), geomin rotation) in two groups (group: 1 = g1, 2 = g2; N = 1000), with nothing held equal: each group has its own rotated loadings, factor correlation, intercepts and residual variances, and the factor means are zero in both. Mplus’s geomin uses ε = 0.0001 with two factors, so the block is set to it; intercepts and observed-information standard errors as Mplus. Reproduces the Mplus output: log-likelihood −17300.588, 78 free parameters, χ² = 63.815 on 52 df, and every estimate and standard error in both groups (to 0.0015: Mplus stops at a looser convergence criterion; the residual variance of y7 in g2 is 2.223 against 2.224). Mplus’s variants b–e of this example, which hold the loadings (and then the intercepts, factor covariances and means) equal across groups, are not included: lavaan reproduces their fit, but rotates the invariant loadings differently from Mplus (up to 0.005 apart) and, in d and e, cannot hold the rotated factor variances at 1.',
    data: mplusData('5.27'), tags: [MPLUS_TAG, 'ESEM'], labels: { group: ['g1', 'g2'] },
    constructs: TWO, paths: [], esem: { blocks: [['f1', 'f2']], rotation: 'geomin', epsilon: 0.0001 },
    multigroup: { column: 'group', invariance: 'configural', free: [] }, constant: true, information: 'observed', settings: CB('ML'),
  },
  {
    id: 'mplus-ex5.28', package: 'lavaan', title: 'EFA with residual variances kept positive (Mplus ex. 5.28)', source: MPLUS_SRC('5.28'), links: mplusLinks('5.28'),
    description: 'Two exploratory factors of y1–y10 (geomin, ε = 0.0001 as Mplus with two factors) on a small sample (N = 100), with the residual variances constrained to be positive (Mplus: y1-y10 (v1-v10); MODEL CONSTRAINT: DO(1,10) v#>0). The constraint binds for y9, whose residual variance stays at 0. Here it is Constraints → keep variances non-negative (lavaan’s bounds = "pos.var"), the same lower bound; intercepts and observed-information standard errors as Mplus. Reproduces the Mplus output: log-likelihood −540.347, 39 free parameters, χ² = 22.751 on 26 df, and every estimate and standard error.',
    data: mplusData('5.28'), tags: [MPLUS_TAG, 'ESEM'],
    constructs: TWO, paths: [], esem: { blocks: [['f1', 'f2']], rotation: 'geomin', epsilon: 0.0001 }, positiveVariances: true, constant: true, information: 'observed', settings: CB('ML'),
  },
  {
    id: 'mplus-ex5.29', package: 'lavaan', title: 'Bifactor EFA, bi-geomin (Mplus ex. 5.29)', source: MPLUS_SRC('5.29'), links: mplusLinks('5.29'),
    description: 'A general factor fg and two specific factors f1 and f2, all loading on y1–y10 and bi-geomin rotated (Mplus: fg f1 f2 BY y1-y10 (*1), ROTATION = BI-GEOMIN; N = 5000): the general factor is uncorrelated with the specific ones, which correlate. geomin’s ε is 0.001, Mplus’s value for three factors; intercepts and observed-information standard errors as Mplus. Reproduces the Mplus fit (log-likelihood −100433.997, 47 free parameters, χ² = 24.364 on 18 df), every estimate within 0.0015 (the loading of y1 on fg 0.932 against 0.931; y4, close to a Heywood case, has residual variance 0.985 against 0.986), and the standard errors of the intercepts and residual variances. The standard errors of the rotated loadings and of the factor correlation differ from Mplus’s, which does not document how it computes them under bi-geomin: lavaan’s are smaller, most where the general and specific loadings trade off (y4 on fg 0.399 against 0.808, y5 on f1 0.065 against 0.146, the factor correlation 0.088 against 0.182), by at most 0.002 for the loadings on f2.',
    data: mplusData('5.29'), tags: [MPLUS_TAG, 'ESEM', 'Bifactor'],
    // The general factor fg is the block's first; the specific factors seed the diagram with y1–y4 and y5–y10.
    constructs: [f('fg', []), f('f1', items('y', 4)), f('f2', items('y', 6, 5))],
    paths: [], esem: { blocks: [['fg', 'f1', 'f2']], rotation: 'bigeomin', epsilon: 0.001 }, constant: true, information: 'observed', settings: CB('ML'),
  },
  {
    id: 'mplus-ex5.30', package: 'lavaan', title: 'Bifactor model: a CFA general factor and two exploratory factors (Mplus ex. 5.30)', source: MPLUS_SRC('5.30'), links: mplusLinks('5.30'),
    description: 'A general factor fg of all ten indicators y1–y10, scaled by its variance (Mplus: fg BY y1-y10*; fg@1: every loading estimated, the variance fixed at 1; under Scale in the factor’s panel), and two exploratory factors f1 and f2 of y1–y8 only (f1-f2 BY y1-y8 (*1), geomin, ε = 0.0001 as Mplus with two factors), so that y9 and y10 load on the general factor alone; the general factor is uncorrelated with the exploratory ones (fg WITH f1-f2@0), which correlate through the rotation. Intercepts and observed-information standard errors as Mplus. Reproduces the Mplus output: log-likelihood −5741.460, 45 free parameters, χ² = 23.536 on 20 df, and every estimate and standard error (geomin, not bi-geomin: the caveat of example 5.29 about the standard errors of rotated loadings does not arise).',
    data: mplusData('5.30'), tags: [MPLUS_TAG, 'ESEM', 'Bifactor'], constructs: [], paths: [],
    syntax: ['fg =~ NA*y1 + ' + items('y', 9, 2).join(' + '), 'fg ~~ 1*fg', 'f1 =~ y1 + y2 + y3 + y4', 'f2 =~ y5 + y6 + y7 + y8', 'fg ~~ 0*f1', 'fg ~~ 0*f2'].join('\n'),
    esem: { blocks: [['f1', 'f2']], rotation: 'geomin', epsilon: 0.0001 }, constant: true, information: 'observed', settings: CB('ML'),
  },
];
