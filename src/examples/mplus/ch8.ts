// Mplus User's Guide, chapter 8: mixture modeling with longitudinal data (see common.ts).
// The growth mixture models of continuous outcomes run on the growth mixture card with a residual
// variance per occasion (analyses/longitudinal.tsx, residuals 'occasion'); the latent class growth
// models of ordered categorical outcomes on the latent class card (analyses/items.tsx, model 'lcga').
// Both are likelihoods written out in R and maximised from random starts.

import { CB, items } from '../define';
import type { PackageExample } from '../packages';
import { MPLUS_SRC, MPLUS_TAG, mplusData, mplusLinks } from './common';

const lcgaNote = 'Within class, P(u ≤ j) = 1 / (1 + exp(−(τj − i − s·t))), with the thresholds τ equal over time and classes, no growth factor variance within class (Mplus’s default for categorical outcomes) and the intercept of one class fixed at 0. The card fixes the smaller class’s intercept; the test re-expresses its thresholds and intercepts relative to the class Mplus fixes (Mplus’s last).';

const gmmNote = 'Mplus’s defaults, which the card’s model with a residual variance per occasion follows: the intercept and slope means differ across classes; their regressions on x, their variances and covariance and the four residual variances are equal across classes. The card numbers the classes by size and reports class membership as logits against its last class; the test matches the classes and re-expresses the logits against Mplus’s last class. Not reproduced: the standard errors, Mplus’s MLR sandwich, where the card gives observed-information ones (e.g. i ON x: Mplus';

export const MPLUS_CH8: PackageExample[] = [
  {
    id: 'mplus-ex8.1', package: 'stats', title: 'GMM for a continuous outcome (Mplus ex. 8.1)', source: MPLUS_SRC('8.1'), links: mplusLinks('8.1'),
    description: `Two classes of linear growth in y1–y4 with random intercepts and slopes, x predicting both the growth factors and the class (Mplus: i s | y1@0 y2@1 y3@2 y4@3; i s ON x; c ON x; STARTS = 40 8). ${gmmNote} 0.103, the card 0.095). The growth mixture card reproduces the Mplus output: log-likelihood −3183.703, 15 free parameters, BIC 6460.626, every estimate of both classes, and c#1 ON x (0.776) and the class intercept. Opens its card on the Analyses tab (it also fits one class).`,
    data: mplusData('8.1', 'stats'), constructs: [], paths: [], tags: [MPLUS_TAG],
    panel: { kind: 'gmm', format: 'wide', measures: items('y', 4), times: [0, 1, 2, 3], subject: '', time: '', outcome: '', covariates: ['x'], shape: 'linear', random: 'slope', to: 2, nrep: 10, residuals: 'occasion', membership: ['x'] }, settings: CB('ML'),
  },
  {
    id: 'mplus-ex8.2', package: 'stats', title: 'GMM for a continuous outcome, user-specified starting values (Mplus ex. 8.2)', source: MPLUS_SRC('8.2'), links: mplusLinks('8.2'),
    description: `The growth mixture model of example 8.1 on other data, which Mplus starts from given class means ([i*1 s*.5] and [i*3 s*1]) as well as random starts; the card starts from k-means of the persons’ own growth factors. ${gmmNote} 0.148, the card 0.120). The growth mixture card reproduces the Mplus output: log-likelihood −3337.654, 15 free parameters, BIC 6768.526, every estimate of both classes, and c#1 ON x and the class intercept. Opens its card on the Analyses tab (it also fits one class).`,
    data: mplusData('8.2', 'stats'), constructs: [], paths: [], tags: [MPLUS_TAG],
    panel: { kind: 'gmm', format: 'wide', measures: items('y', 4), times: [0, 1, 2, 3], subject: '', time: '', outcome: '', covariates: ['x'], shape: 'linear', random: 'slope', to: 2, nrep: 10, residuals: 'occasion', membership: ['x'] }, settings: CB('ML'),
  },
  {
    id: 'mplus-ex8.9', package: 'stats', title: 'LCGA for a binary outcome (Mplus ex. 8.9)', source: MPLUS_SRC('8.9'), links: mplusLinks('8.9'),
    description: `Two trajectory classes of a binary outcome measured four times (Mplus: i s | u1@0 u2@1 u3@2 u4@3; CATEGORICAL = u1-u4; TYPE = MIXTURE). The latent class card’s growth model (10 random starts) reproduces the Mplus output: log-likelihood −1272.307, 5 free parameters, BIC 2575.687, the threshold (0.776), each class’s intercept and slope means, and the class intercept. ${lcgaNote} Standard errors (Mplus’s MLR) are not reproduced. Opens its card on the Analyses tab.`,
    data: mplusData('8.9', 'stats'), constructs: [], paths: [], tags: [MPLUS_TAG, 'Longitudinal'],
    panel: { kind: 'lca', model: 'lcga', items: items('u', 4), times: [0, 1, 2, 3], from: 2, to: 2 }, settings: CB('ML'),
  },
  {
    id: 'mplus-ex8.10', package: 'stats', title: 'LCGA for a three-category outcome (Mplus ex. 8.10)', source: MPLUS_SRC('8.10'), links: mplusLinks('8.10'),
    description: `Two trajectory classes of an ordered three-category outcome measured four times (Mplus: i s | u1@0 u2@1 u3@2 u4@3 with CATEGORICAL = u1-u4). The latent class card’s growth model (10 random starts) reproduces the Mplus output: log-likelihood −1706.048, 6 free parameters, BIC 3449.384, the two thresholds (0.746, 1.276), each class’s intercept and slope means, and the class intercept. ${lcgaNote} Standard errors (Mplus’s MLR) are not reproduced. Opens its card on the Analyses tab.`,
    data: mplusData('8.10', 'stats'), constructs: [], paths: [], tags: [MPLUS_TAG, 'Longitudinal'],
    panel: { kind: 'lca', model: 'lcga', items: items('u', 4), times: [0, 1, 2, 3], from: 2, to: 2 }, settings: CB('ML'),
  },
];
