// Mplus User's Guide, chapter 7: mixture modeling with cross-sectional data (see common.ts).
// The latent class card (analyses/items.tsx) fits them: categorical items with poLCA, continuous items
// (latent profiles) by EM in R. Mplus prints logits, the card probabilities: a threshold of category j
// is logit P(u ≤ j | class), an unordered category's intercept log(P(j) / P(last)), and the class
// intercept c#1 log(share of class 1 / share of the last class).

import { CB, items } from '../define';
import type { PackageExample } from '../packages';
import { MPLUS_SRC, MPLUS_TAG, mplusData, mplusLinks } from './common';

const lcaNote = 'poLCA estimates probabilities, Mplus logits: each threshold Mplus prints is logit P(u ≤ category | class) of the card’s probabilities, and c#1 the log of the ratio of the two class shares.';

export const MPLUS_CH7: PackageExample[] = [
  {
    id: 'mplus-ex7.3', package: 'poLCA', title: 'LCA with binary indicators (Mplus ex. 7.3)', source: MPLUS_SRC('7.3'), links: mplusLinks('7.3'),
    description: `Two latent classes from four binary items u1–u4 (Mplus: CLASSES = c (2); CATEGORICAL = u1-u4; TYPE = MIXTURE). The latent class card (poLCA, 10 random starts) reproduces the Mplus output: log-likelihood −965.244, 9 free parameters, BIC 1986.420, and every class-specific threshold and the class intercept (classes 27% and 73%). ${lcaNote} Not reproduced: the tests of equal means of the auxiliary variables x1–x10 across classes (AUXILIARY = x1-x10 (e)), and the standard errors (Mplus’s MLR sandwich; the card shows none). Opens its card on the Analyses tab.`,
    data: mplusData('7.3', 'poLCA'), constructs: [], paths: [], tags: [MPLUS_TAG],
    panel: { kind: 'lca', items: items('u', 4), from: 2, to: 2 }, settings: CB('ML'),
  },
  {
    id: 'mplus-ex7.4', package: 'poLCA', title: 'LCA with binary indicators, user-specified starting values (Mplus ex. 7.4)', source: MPLUS_SRC('7.4'), links: mplusLinks('7.4'),
    description: `Two latent classes from four binary items, which Mplus starts from given thresholds without random starts (STARTS = 0; [u1$1*1 …]). The card starts poLCA from 10 random starting points instead and reaches the same maximum: log-likelihood −1325.213, 9 free parameters, BIC 2706.357, and every threshold and the class intercept. ${lcaNote} Standard errors (Mplus’s MLR) are not reproduced. Opens its card on the Analyses tab.`,
    data: mplusData('7.4', 'poLCA'), constructs: [], paths: [], tags: [MPLUS_TAG],
    panel: { kind: 'lca', items: items('u', 4), from: 2, to: 2 }, settings: CB('ML'),
  },
  {
    id: 'mplus-ex7.5', package: 'poLCA', title: 'LCA with binary indicators, user-specified starting values and random starts (Mplus ex. 7.5)', source: MPLUS_SRC('7.5'), links: mplusLinks('7.5'),
    description: `The data of example 7.4, with Mplus’s random starts added to the given starting values (STARTS = 100 10; STITERATIONS = 20). The card’s 10 poLCA starts reach the same solution: log-likelihood −1325.213, 9 free parameters, BIC 2706.357, and every threshold and the class intercept (Mplus numbers the classes the other way round here). ${lcaNote} Standard errors (Mplus’s MLR) are not reproduced. Opens its card on the Analyses tab.`,
    data: mplusData('7.5', 'poLCA'), constructs: [], paths: [], tags: [MPLUS_TAG],
    panel: { kind: 'lca', items: items('u', 4), from: 2, to: 2 }, settings: CB('ML'),
  },
  {
    id: 'mplus-ex7.6', package: 'poLCA', title: 'LCA with three-category indicators (Mplus ex. 7.6)', source: MPLUS_SRC('7.6'), links: mplusLinks('7.6'),
    description: `Two latent classes from four ordered three-category items (N = 5000; Mplus: CATEGORICAL = u1-u4, two thresholds per item and class, started from given values). With both thresholds free in each class the ordered model is the unrestricted one poLCA fits, so the card (10 random starts) reproduces the Mplus output: log-likelihood −19214.480, 17 free parameters, BIC 38573.753, and all 16 thresholds and the class intercept. ${lcaNote} Standard errors (Mplus’s MLR) are not reproduced. Opens its card on the Analyses tab.`,
    data: mplusData('7.6', 'poLCA'), constructs: [], paths: [], tags: [MPLUS_TAG],
    panel: { kind: 'lca', items: items('u', 4), from: 2, to: 2 }, settings: CB('ML'),
  },
  {
    id: 'mplus-ex7.7', package: 'poLCA', title: 'LCA with unordered categorical indicators (Mplus ex. 7.7)', source: MPLUS_SRC('7.7'), links: mplusLinks('7.7'),
    description: 'Two latent classes from four three-category nominal items (N = 5000; Mplus: NOMINAL = u1-u4). Mplus prints, per class, the multinomial logit of categories 1 and 2 against category 3, log(P(j) / P(3)) of the card’s probabilities. The card (poLCA, 10 random starts, the best continued to convergence) reproduces the log-likelihood −21408.482, 17 free parameters, BIC 42961.756, the larger class’s eight logits and the class intercept. The smaller class (26%) is weakly determined (Mplus’s standard errors up to 3.9): the likelihood is so flat there that Mplus stops at its convergence criterion with these logits up to 0.003 from the maximum (u2: Mplus 2.353 and 2.838, the card 2.350 and 2.835), at the same log-likelihood. Standard errors (Mplus’s MLR) are not reproduced. Opens its card on the Analyses tab.',
    data: mplusData('7.7', 'poLCA'), constructs: [], paths: [], tags: [MPLUS_TAG],
    panel: { kind: 'lca', items: items('u', 4), from: 2, to: 2 }, settings: CB('ML'),
  },
  {
    id: 'mplus-ex7.8', package: 'poLCA', title: 'LCA with unordered categorical indicators, user-specified starting values (Mplus ex. 7.8)', source: MPLUS_SRC('7.8'), links: mplusLinks('7.8'),
    description: 'The data of example 7.7 with Mplus started from given logits ([u1#1-u4#1*0] …) as well as random starts; the card uses 10 random poLCA starts. As in 7.7 it reproduces the log-likelihood −21408.482, 17 free parameters, BIC 42961.756, the larger class’s logits and the class intercept; the weakly determined smaller class’s logits are within 0.003 of Mplus’s (u2: Mplus 2.353 and 2.838, the card 2.350 and 2.835), at the same log-likelihood. Standard errors (Mplus’s MLR) are not reproduced. Opens its card on the Analyses tab.',
    data: mplusData('7.8', 'poLCA'), constructs: [], paths: [], tags: [MPLUS_TAG],
    panel: { kind: 'lca', items: items('u', 4), from: 2, to: 2 }, settings: CB('ML'),
  },
  {
    id: 'mplus-ex7.9', package: 'stats', title: 'Latent profile analysis with continuous indicators (Mplus ex. 7.9)', source: MPLUS_SRC('7.9'), links: mplusLinks('7.9'),
    description: 'Two latent classes from four continuous items y1–y4 (Mplus: TYPE = MIXTURE without CATEGORICAL): the items are independent within class, with class-specific means and variances equal across classes (Mplus’s default). The latent class card’s latent-profile model with that structure (a normal mixture fitted by EM from 10 starts) reproduces the Mplus output: log-likelihood −3177.162, 13 free parameters, BIC 6435.114, the class means and variances and the class intercept (log of the ratio of the class shares). Standard errors (Mplus’s MLR) are not reproduced. Opens its card on the Analyses tab.',
    data: mplusData('7.9', 'stats'), constructs: [], paths: [], tags: [MPLUS_TAG],
    panel: { kind: 'lca', model: 'lpa', structure: 'EEI', items: items('y', 4), from: 2, to: 2 }, settings: CB('ML'),
  },
  {
    id: 'mplus-ex7.10', package: 'stats', title: 'Latent profile analysis with class-specific variances (Mplus ex. 7.10)', source: MPLUS_SRC('7.10'), links: mplusLinks('7.10'),
    description: 'The latent profile model of example 7.9 with the variances free in each class (Mplus: y1-y4; in each class), which Mplus starts from given means without random starts; the card starts EM from 10 points. It reproduces the Mplus output: log-likelihood −3174.564, 17 free parameters, BIC 6454.776, the class means and variances and the class intercept. Standard errors (Mplus’s MLR) are not reproduced. Opens its card on the Analyses tab.',
    data: mplusData('7.10', 'stats'), constructs: [], paths: [], tags: [MPLUS_TAG],
    panel: { kind: 'lca', model: 'lpa', structure: 'VVI', items: items('y', 4), from: 2, to: 2 }, settings: CB('ML'),
  },
  {
    id: 'mplus-ex7.22', package: 'stats', title: 'Mixture with continuous variables that correlate within class (Mplus ex. 7.22)', source: MPLUS_SRC('7.22'), links: mplusLinks('7.22'),
    description: 'Three latent classes of four continuous items that covary within class, the variances and covariances equal across classes (Mplus: y1 WITH y2-y4; … in %OVERALL%). The card’s latent-profile model with covariances equal across classes (EM from 10 starts) reproduces the Mplus output: log-likelihood −3054.963, 24 free parameters, BIC 6259.077, the three classes’ means, the common variances and covariances, and the two class intercepts. Standard errors (Mplus’s MLR) are not reproduced. Opens its card on the Analyses tab.',
    data: mplusData('7.22', 'stats'), constructs: [], paths: [], tags: [MPLUS_TAG],
    panel: { kind: 'lca', model: 'lpa', structure: 'EEE', items: items('y', 4), from: 3, to: 3 }, settings: CB('ML'),
  },
];
