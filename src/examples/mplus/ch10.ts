// Mplus User's Guide, chapter 10: multilevel mixture models (see common.ts). Example 10.7, a two-level latent
// class model with a between-level class variable, is glca's multilevel latent class model on the LCA card.

import { CB, items } from '../define';
import type { PackageExample } from '../packages';
import { MPLUS_SRC, MPLUS_TAG, mplusData, mplusLinks } from './common';

export const MPLUS_CH10: PackageExample[] = [
  {
    id: 'mplus-ex10.7',
    package: 'glca',
    title: 'Two-level LCA with a between-level latent class variable (Mplus ex. 10.7)',
    source: MPLUS_SRC('10.7'),
    links: mplusLinks('10.7'),
    description:
      'Ten three-category items u1–u10 of 10000 students in 200 clusters (Mplus: CLASSES = cb(5) cw(4); TYPE = TWOLEVEL MIXTURE; BETWEEN = cb; cw#1-cw#3 ON cb): four latent classes of students, with thresholds per class, whose shares depend on five latent classes of clusters. That is the nonparametric multilevel latent class model (Vermunt 2003) that glca fits; the LCA card’s multilevel option runs it with 10 random starts. Mplus’s parameters are logits of the card’s probabilities: a threshold is logit P(u ≤ category | class); within cluster class j, log(P(cw = k) / P(cw = 4)) is cw#k’s intercept (cluster class 5) plus cw#k ON cb#j; cb#j’s intercept is log of the ratio of the shares of cluster classes j and 5. Reproduces the Mplus output (the classes matched to Mplus’s numbering): 99 free parameters and all 80 thresholds within 0.0021. glca’s log-likelihood is −98736.121, 0.006 above Mplus’s −98736.127 (AIC 197670.242 against 197670.253): Mplus stops at its convergence criterion short of the maximum, where the between-level logits are flat, so the 3 intercepts, the 12 effects of the cluster classes and the 4 cluster-class intercepts agree within 0.022 (the largest, cb#1’s intercept, −0.416 against −0.395 with a standard error of 0.406; cw#3 ON cb#1 2.068 against 2.053, SE 0.277). Not reproduced: the standard errors (Mplus’s MLR). Opens its card on the Analyses tab.',
    shows:
      'Ninety-nine free parameters and all 80 thresholds within 0.0021 of Mplus, the four student classes matched by their thresholds and the five cluster classes by their logits. glca’s log-likelihood −98736.121 is 0.006 above Mplus’s −98736.127: Mplus stops where the between-level logits are flat, so those agree within 0.022 (cb#1’s intercept −0.416 against −0.395, SE 0.406). No MLR standard errors.',
    data: mplusData('10.7', 'glca'),
    tags: [MPLUS_TAG],
    constructs: [],
    paths: [],
    panel: {
      kind: 'lca',
      items: items('u', 10),
      from: 4,
      to: 4,
      model: 'mlca',
      cluster: 'clus',
      clusterClasses: 5,
    },
    settings: CB('ML'),
  },
];
