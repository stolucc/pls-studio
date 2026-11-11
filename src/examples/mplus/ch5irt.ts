// Mplus User's Guide, chapter 5: the IRT models with guessing and slipping (example 5.5, parts 3 and 4), fitted by
// mirt on the IRT card (see common.ts).

import { CB, items } from '../define';
import type { PackageExample } from '../packages';
import { MPLUS_SRC, MPLUS_TAG, mplusData, mplusLinks } from './common';

export const MPLUS_CH5IRT: PackageExample[] = [
  {
    id: 'mplus-ex5.5part3',
    package: 'mirt',
    title: 'Three-parameter logistic IRT model with priors (Mplus ex. 5.5, part 3)',
    source: MPLUS_SRC('5.5'),
    links: mplusLinks('5.5part3'),
    description:
      'Twenty binary items u1–u20 (N = 5000) with a guessing parameter each (Mplus: CATEGORICAL = u1-u20 (3pl); f BY u1-u20*; f@1; ESTIMATOR = MLR) and Mplus’s prior N(1.386, 1) on each item’s second threshold u$2 = −logit(g), i.e. N(−1.386, 1) on the logit of the guessing parameter (g ≈ .2). The IRT card’s 3PL model with Mplus’s integration rule (its option: 15 rectangular points per person, adaptive, as Mplus; the integration card’s engine) maximises the log-likelihood plus the log prior, which is what Mplus prints as its log-likelihood: −64414.662 against Mplus’s −64414.663 (60 free parameters; AIC 128949.324 against 128949.326). The estimates agree with Mplus’s within 0.002 for the loadings (u1 1.063, as Mplus), 0.003 for the first thresholds and 0.0045 for the guessing thresholds u$2 (u19 1.607 against 1.611); the robust standard errors are 0.7–2.3% above Mplus’s (u1’s loading 0.162 against 0.160), as the card’s MLR standard errors of logit factor models are throughout (examples 6.22 and 3.10; the observed information and the scores give them, Mplus’s are smaller for an unidentified reason). Without the option the card fits the exact likelihood with mirt (61 fixed points): −64414.575, the guessing thresholds within 0.01 of Mplus’s. The card also shows the IRT parameterisation (discrimination, difficulty, guessing). Opens its card on the Analyses tab.',
    shows:
      'Log-likelihood plus log prior −64414.662 against Mplus’s −64414.663 with 60 free parameters, loadings within 0.002 (u1 1.063, as Mplus) and guessing thresholds within 0.0045 (u19 1.607 against 1.611). The robust standard errors run 0.7–2.3% above Mplus’s (u1’s loading 0.162 against 0.160), as for the card’s other logit factor models. Takes minutes in the browser.',
    data: mplusData('5.5part3', 'mirt'),
    tags: [MPLUS_TAG],
    constructs: [],
    paths: [],
    panel: {
      kind: 'irt',
      items: items('u', 20),
      model: 'threepl',
      priorG: [-1.386, 1],
      robust: true,
      integration: 'mplus',
    },
    settings: CB('ML'),
  },
  {
    id: 'mplus-ex5.5part4',
    package: 'mirt',
    title: 'Four-parameter logistic IRT model with priors (Mplus ex. 5.5, part 4)',
    source: MPLUS_SRC('5.5'),
    links: mplusLinks('5.5part4'),
    description:
      'Example 5.5 part 3 with an upper asymptote as well (N = 10000; Mplus: CATEGORICAL = u1-u20 (4pl); MLR) and Mplus’s priors N(1.386, 1) on u$2 = −logit(g) and N(−2, 1) on u$3 = −logit(u), i.e. N(−1.386, 1) and N(2, 1) on the logits of the lower and upper asymptotes: the IRT card’s 4PL model (mirt, robust standard errors). The log-likelihood plus the log prior, which Mplus prints, is −134598.457 (−134558.982 and −39.475) against Mplus’s −134598.580, 80 free parameters (AIC 269356.914 against 269357.161); refitting with Mplus’s 15-point rectangular integration in desktop R reproduces −134598.576, so the 0.12 is the integration’s. The 4PL is weakly determined (mirt’s EM needs some 4600 cycles to converge, so the card runs for minutes in the browser, about a minute in desktop R), and its estimates move with the integration rule: against Mplus’s printed estimates the card’s agree within 0.007 except for items 5, 13 and 17, whose asymptotes are the least determined: u5’s loading 1.853 against 1.770 (SE 0.895), its u$3 −1.339 against −1.374 (SE 0.427) and u$2 0.690 against 0.710, and u17’s loading 1.449 against 1.435; every estimate within 0.1 of its standard error. The robust standard errors are within 8% of Mplus’s. Mplus’s rule does not explain those three items: with it (the card’s option, about 8 minutes in desktop R, too long for the browser) the log-likelihood is −134598.576 and u5’s loading 1.852, as mirt’s, so Mplus stops short of the maximum on this flat likelihood. Opens its card on the Analyses tab.',
    shows:
      'Log-likelihood plus log prior −134598.457 against Mplus’s −134598.580 (80 free parameters); the 0.12 is Mplus’s integration rule. Most estimates agree within 0.007; items 5, 13 and 17, whose asymptotes are least determined, differ within 0.1 SE (u5’s loading 1.853 against 1.770, SE 0.895). Mplus’s own rule gives 1.852 too: it stops short of the maximum. Takes minutes in the browser.',
    data: mplusData('5.5part4', 'mirt'),
    tags: [MPLUS_TAG],
    constructs: [],
    paths: [],
    panel: {
      kind: 'irt',
      items: items('u', 20),
      model: 'fourpl',
      priorG: [-1.386, 1],
      priorU: [2, 1],
      robust: true,
    },
    settings: CB('ML'),
  },
];
