// Mplus User's Guide, chapter 7: the factor (IRT) mixture of example 7.27, fitted by mirt on the IRT card (see common.ts).

import { CB, items } from '../define';
import type { PackageExample } from '../packages';
import { MPLUS_SRC, MPLUS_TAG, mplusData, mplusLinks } from './common';

export const MPLUS_CH7IRT: PackageExample[] = [
  {
    id: 'mplus-ex7.27', package: 'mirt', title: 'Factor (IRT) mixture with binary items (Mplus ex. 7.27)', source: MPLUS_SRC('7.27'), links: mplusLinks('7.27'),
    description: 'Two latent classes of a one-factor model for eight binary items u1–u8 (N = 2000; Mplus: CLASSES = c (2); f BY u1-u8; [f@0]; loadings, thresholds and the factor variance class-specific; ALGORITHM = INTEGRATION): a mixture IRT model, which the IRT card’s 2PL mixture fits with mirt (multipleGroup with dentype = "mixture-2"), from 10 starts (the first from k-means clusters of the response patterns). The card fixes the factor variance at 1 in each class and estimates every loading; Mplus fixes u1’s loading at 1 and estimates the variance: Mplus’s loadings are the card’s divided by u1’s, its factor variance the square of u1’s loading, and its thresholds the card’s. Reproduces the Mplus output: log-likelihood −8193.988 (Mplus −8193.989), 33 free parameters, AIC 16453.976 and BIC 16638.806, every threshold in both classes and the class logit c#1 = −0.037 (classes of 49% and 51%) within 0.001, the loadings (ratios of two of the card’s) within 0.0021 (u7 in Mplus’s class 2: 0.955 against 0.957), and the factor variances 2.222 and 2.826 (Mplus 2.219 and 2.824, standard errors 0.59 and 1.01) within 0.003. The standard errors, which mirt’s mixtures do not give, come from the second card the example opens: the mixture model card with Mplus’s own input (ALGORITHM = INTEGRATION: 15 rectangular points, adaptive within each class; STARTS = 50 5), which reaches −8193.989 and Mplus’s estimates within 0.002 (the class-1 factor variance 2.221 against 2.219, u7’s class-2 loading 0.955 against 0.957) and gives the MLR standard errors (the sandwich, from each case’s score); they agree with Mplus’s within 0.004 (u5’s class-2 loading: 0.203 against 0.206) except that of class 2’s factor variance (0.996 against 1.013), where the likelihood is flattest. Opens its cards on the Analyses tab.',
    shows: 'Two cards: the IRT card (mirt) reproduces log-likelihood −8193.988 (Mplus −8193.989), BIC 16638.806, every threshold and the class logit −0.037 (classes of 49% and 51%) within 0.001, the loadings within 0.0021. The classes have opposite threshold signs on u1–u4 and u5–u8. The mixture card adds the MLR standard errors, within 0.004 except class 2’s factor variance (0.996 against 1.013).',
    data: mplusData('7.27', 'mirt'), tags: [MPLUS_TAG], constructs: [], paths: [],
    panel: { kind: 'irt', items: items('u', 8), model: 'mixture', classes: 2 }, settings: CB('ML'),
    morePanels: [{ kind: 'mixture', syntax: [
      'CATEGORICAL = u1-u8;',
      'CLASSES = c (2);',
      'ALGORITHM = INTEGRATION;',
      'STARTS = 50 5;',
      'MODEL:',
      '%OVERALL%',
      'f BY u1-u8;',
      '[f@0];',
      '%c#1%',
      'f BY u1@1 u2-u8;',
      'f;',
      '[u1$1-u8$1];',
      '%c#2%',
      'f BY u1@1 u2-u8;',
      'f;',
      '[u1$1-u8$1];',
    ].join('\n') }],
  },
];
