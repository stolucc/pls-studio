// Mplus User's Guide, chapter 7: the factor (IRT) mixture of example 7.27, fitted by mirt on the IRT card (see common.ts).

import { CB, items } from '../define';
import type { PackageExample } from '../packages';
import { MPLUS_SRC, MPLUS_TAG, mplusData, mplusLinks } from './common';

export const MPLUS_CH7IRT: PackageExample[] = [
  {
    id: 'mplus-ex7.27', package: 'mirt', title: 'Factor (IRT) mixture with binary items (Mplus ex. 7.27)', source: MPLUS_SRC('7.27'), links: mplusLinks('7.27'),
    description: 'Two latent classes of a one-factor model for eight binary items u1–u8 (N = 2000; Mplus: CLASSES = c (2); f BY u1-u8; [f@0]; loadings, thresholds and the factor variance class-specific; ALGORITHM = INTEGRATION): a mixture IRT model, which the IRT card’s 2PL mixture fits with mirt (multipleGroup with dentype = "mixture-2"), from 10 starts (the first from k-means clusters of the response patterns). The card fixes the factor variance at 1 in each class and estimates every loading; Mplus fixes u1’s loading at 1 and estimates the variance: Mplus’s loadings are the card’s divided by u1’s, its factor variance the square of u1’s loading, and its thresholds the card’s. Reproduces the Mplus output: log-likelihood −8193.988 (Mplus −8193.989), 33 free parameters, AIC 16453.976 and BIC 16638.806, every threshold in both classes and the class logit c#1 = −0.037 (classes of 49% and 51%) within 0.001, the loadings (ratios of two of the card’s) within 0.0021 (u7 in Mplus’s class 2: 0.955 against 0.957), and the factor variances 2.222 and 2.826 (Mplus 2.219 and 2.824, standard errors 0.59 and 1.01) within 0.003. Not reproduced: the standard errors (mirt’s mixtures give none). Opens its card on the Analyses tab.',
    data: mplusData('7.27', 'mirt'), tags: [MPLUS_TAG], constructs: [], paths: [],
    panel: { kind: 'irt', items: items('u', 8), model: 'mixture', classes: 2 }, settings: CB('ML'),
  },
];
