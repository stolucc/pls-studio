// Mplus User's Guide, chapter 5: the IRT models with guessing and slipping (example 5.5, parts 3 and 4), fitted by
// mirt on the IRT card (see common.ts).

import { CB, items } from '../define';
import type { PackageExample } from '../packages';
import { MPLUS_SRC, MPLUS_TAG, mplusData, mplusLinks } from './common';

export const MPLUS_CH5IRT: PackageExample[] = [
  {
    id: 'mplus-ex5.5part3', package: 'mirt', title: 'Three-parameter logistic IRT model with priors (Mplus ex. 5.5, part 3)', source: MPLUS_SRC('5.5'), links: mplusLinks('5.5part3'),
    description: 'Twenty binary items u1–u20 (N = 5000) with a guessing parameter each (Mplus: CATEGORICAL = u1-u20 (3pl); f BY u1-u20*; f@1; ESTIMATOR = MLR) and Mplus’s prior N(1.386, 1) on each item’s second threshold u$2 = −logit(g), i.e. N(−1.386, 1) on the logit of the guessing parameter (g ≈ .2), which the IRT card’s 3PL model sets for mirt (robust standard errors as MLR: the sandwich with the priors in the information). With priors the estimates maximise the log-likelihood plus the log prior density, and that sum is what Mplus prints as its log-likelihood: the card’s log-likelihood is −64395.138 and the log prior −19.437, their sum −64414.575 against Mplus’s −64414.663 (60 free parameters; AIC 128949.150 against 128949.326). The remaining 0.09 is Mplus’s integration: it uses 15 rectangular points per person (adaptive, ±5 posterior SDs) where mirt uses 61 fixed points, and refitting with Mplus’s rule in desktop R reproduces −64414.662 and Mplus’s estimates within 0.005. On this flat likelihood the card’s exact maximum agrees with Mplus’s printed estimates within 0.002 for the loadings (u1 1.063, as Mplus), 0.005 for the thresholds and 0.01 for the guessing thresholds u$2 (u1 0.954 against 0.955), and its robust standard errors are within 3% of Mplus’s (0.162 against 0.160 for u1’s loading). The card also shows the IRT parameterisation (discrimination, difficulty, guessing). Opens its card on the Analyses tab.',
    data: mplusData('5.5part3', 'mirt'), tags: [MPLUS_TAG], constructs: [], paths: [],
    panel: { kind: 'irt', items: items('u', 20), model: 'threepl', priorG: [-1.386, 1], robust: true }, settings: CB('ML'),
  },
  {
    id: 'mplus-ex5.5part4', package: 'mirt', title: 'Four-parameter logistic IRT model with priors (Mplus ex. 5.5, part 4)', source: MPLUS_SRC('5.5'), links: mplusLinks('5.5part4'),
    description: 'Example 5.5 part 3 with an upper asymptote as well (N = 10000; Mplus: CATEGORICAL = u1-u20 (4pl); MLR) and Mplus’s priors N(1.386, 1) on u$2 = −logit(g) and N(−2, 1) on u$3 = −logit(u), i.e. N(−1.386, 1) and N(2, 1) on the logits of the lower and upper asymptotes: the IRT card’s 4PL model (mirt, robust standard errors). The log-likelihood plus the log prior, which Mplus prints, is −134598.457 (−134558.982 and −39.475) against Mplus’s −134598.580, 80 free parameters (AIC 269356.914 against 269357.161); refitting with Mplus’s 15-point rectangular integration in desktop R reproduces −134598.576, so the 0.12 is the integration’s. The 4PL is weakly determined (mirt’s EM needs some 4600 cycles to converge, so the card runs for minutes in the browser, about a minute in desktop R), and its estimates move with the integration rule: against Mplus’s printed estimates the card’s agree within 0.007 except for items 5, 13 and 17, whose asymptotes are the least determined: u5’s loading 1.853 against 1.770 (SE 0.895), its u$3 −1.339 against −1.374 (SE 0.427) and u$2 0.690 against 0.710, and u17’s loading 1.449 against 1.435; every estimate within 0.1 of its standard error. The robust standard errors are within 8% of Mplus’s. Opens its card on the Analyses tab.',
    data: mplusData('5.5part4', 'mirt'), tags: [MPLUS_TAG], constructs: [], paths: [],
    panel: { kind: 'irt', items: items('u', 20), model: 'fourpl', priorG: [-1.386, 1], priorU: [2, 1], robust: true }, settings: CB('ML'),
  },
];
