// Mplus User's Guide, chapter 7: mixture modeling with cross-sectional data (see common.ts).
// The latent class card (analyses/items.tsx) fits them: categorical items with poLCA, continuous items
// (latent profiles) by EM in R. Mplus prints logits, the card probabilities: a threshold of category j
// is logit P(u ≤ j | class), an unordered category's intercept log(P(j) / P(last)), and the class
// intercept c#1 log(share of class 1 / share of the last class).

import { CB, items } from '../define';
import type { PackageExample } from '../packages';
import { MPLUS_SRC, MPLUS_TAG, mplusData, mplusLinks, regression } from './common';

const lcaNote =
  'poLCA estimates probabilities, Mplus logits: each threshold Mplus prints is logit P(u ≤ category | class) of the card’s probabilities, and c#1 the log of the ratio of the two class shares.';

export const MPLUS_CH7: PackageExample[] = [
  {
    id: 'mplus-ex7.3',
    package: 'poLCA',
    title: 'LCA with binary indicators (Mplus ex. 7.3)',
    source: MPLUS_SRC('7.3'),
    links: mplusLinks('7.3'),
    description: `Two latent classes from four binary items u1–u4 (Mplus: CLASSES = c (2); CATEGORICAL = u1-u4; TYPE = MIXTURE). The latent class card (poLCA, 10 random starts) reproduces the Mplus output: log-likelihood −965.244, 9 free parameters, BIC 1986.420, and every class-specific threshold and the class intercept (classes 27% and 73%). ${lcaNote} Not reproduced: the tests of equal means of the auxiliary variables x1–x10 across classes (AUXILIARY = x1-x10 (e)), and the standard errors (Mplus’s MLR sandwich; the card shows none). Opens its card on the Analyses tab.`,
    shows:
      'Reproduces Mplus: log-likelihood −965.244, 9 free parameters, BIC 1986.420, classes of 27% and 73%. Read the item probabilities against the printed thresholds (logit P(u ≤ 1 | class)): the smaller class endorses u1 and u2 but not u3 and u4, the larger class the reverse. No standard errors on the card.',
    data: mplusData('7.3', 'poLCA'),
    constructs: [],
    paths: [],
    tags: [MPLUS_TAG],
    panel: { kind: 'lca', items: items('u', 4), from: 2, to: 2 },
    settings: CB('ML'),
  },
  {
    id: 'mplus-ex7.4',
    package: 'poLCA',
    title: 'LCA with binary indicators, user-specified starting values (Mplus ex. 7.4)',
    source: MPLUS_SRC('7.4'),
    links: mplusLinks('7.4'),
    description: `Two latent classes from four binary items, which Mplus starts from given thresholds without random starts (STARTS = 0; [u1$1*1 …]). The card starts poLCA from 10 random starting points instead and reaches the same maximum: log-likelihood −1325.213, 9 free parameters, BIC 2706.357, and every threshold and the class intercept. ${lcaNote} Standard errors (Mplus’s MLR) are not reproduced. Opens its card on the Analyses tab.`,
    shows:
      'The same maximum as Mplus from random starts instead of its given starting values: log-likelihood −1325.213, 9 free parameters, BIC 2706.357, every threshold within 0.001. The class intercept 0.041 means two classes of almost equal size that mirror each other on all four items. No standard errors on the card.',
    data: mplusData('7.4', 'poLCA'),
    constructs: [],
    paths: [],
    tags: [MPLUS_TAG],
    panel: { kind: 'lca', items: items('u', 4), from: 2, to: 2 },
    settings: CB('ML'),
  },
  {
    id: 'mplus-ex7.5',
    package: 'poLCA',
    title:
      'LCA with binary indicators, user-specified starting values and random starts (Mplus ex. 7.5)',
    source: MPLUS_SRC('7.5'),
    links: mplusLinks('7.5'),
    description: `The data of example 7.4, with Mplus’s random starts added to the given starting values (STARTS = 100 10; STITERATIONS = 20). The card’s 10 poLCA starts reach the same solution: log-likelihood −1325.213, 9 free parameters, BIC 2706.357, and every threshold and the class intercept (Mplus numbers the classes the other way round here). ${lcaNote} Standard errors (Mplus’s MLR) are not reproduced. Opens its card on the Analyses tab.`,
    shows:
      'Mplus’s random starts and the card’s 10 poLCA starts land on the solution of example 7.4: log-likelihood −1325.213, 9 free parameters, BIC 2706.357. Mplus numbers the classes the other way round here, so its class intercept is −0.041 where 7.4 prints 0.041: the labels are arbitrary, the thresholds identical.',
    data: mplusData('7.5', 'poLCA'),
    constructs: [],
    paths: [],
    tags: [MPLUS_TAG],
    panel: { kind: 'lca', items: items('u', 4), from: 2, to: 2 },
    settings: CB('ML'),
  },
  {
    id: 'mplus-ex7.6',
    package: 'poLCA',
    title: 'LCA with three-category indicators (Mplus ex. 7.6)',
    source: MPLUS_SRC('7.6'),
    links: mplusLinks('7.6'),
    description: `Two latent classes from four ordered three-category items (N = 5000; Mplus: CATEGORICAL = u1-u4, two thresholds per item and class, started from given values). With both thresholds free in each class the ordered model is the unrestricted one poLCA fits, so the card (10 random starts) reproduces the Mplus output: log-likelihood −19214.480, 17 free parameters, BIC 38573.753, and all 16 thresholds and the class intercept. ${lcaNote} Standard errors (Mplus’s MLR) are not reproduced. Opens its card on the Analyses tab.`,
    shows:
      'Reproduces Mplus: log-likelihood −19214.480, 17 free parameters, BIC 38573.753, all 16 thresholds and the class intercept within 0.001. With two thresholds per item the card shows three probabilities per item and class; u1 and u2 run high where u3 and u4 run low, and the reverse. No standard errors on the card.',
    data: mplusData('7.6', 'poLCA'),
    constructs: [],
    paths: [],
    tags: [MPLUS_TAG],
    panel: { kind: 'lca', items: items('u', 4), from: 2, to: 2 },
    settings: CB('ML'),
  },
  {
    id: 'mplus-ex7.7',
    package: 'poLCA',
    title: 'LCA with unordered categorical indicators (Mplus ex. 7.7)',
    source: MPLUS_SRC('7.7'),
    links: mplusLinks('7.7'),
    description:
      'Two latent classes from four three-category nominal items (N = 5000; Mplus: NOMINAL = u1-u4). Mplus prints, per class, the multinomial logit of categories 1 and 2 against category 3, log(P(j) / P(3)) of the card’s probabilities. The card (poLCA, 10 random starts, the best continued to convergence) reproduces the log-likelihood −21408.482, 17 free parameters, BIC 42961.756, the larger class’s eight logits and the class intercept. The smaller class (26%) is weakly determined (Mplus’s standard errors up to 3.9): the likelihood is so flat there that Mplus stops at its convergence criterion with these logits up to 0.003 from the maximum (u2: Mplus 2.353 and 2.838, the card 2.350 and 2.835), at the same log-likelihood. Standard errors (Mplus’s MLR) are not reproduced. Opens its card on the Analyses tab.',
    shows:
      'Reproduces log-likelihood −21408.482, 17 free parameters, BIC 42961.756, the larger class’s eight logits and the class intercept. Look at the smaller class (26%): Mplus’s standard errors there reach 3.9, and its u2 logits (2.353, 2.838) differ from the card’s (2.350, 2.835) because Mplus stops on a flat likelihood, at the same log-likelihood.',
    data: mplusData('7.7', 'poLCA'),
    constructs: [],
    paths: [],
    tags: [MPLUS_TAG],
    panel: { kind: 'lca', items: items('u', 4), from: 2, to: 2 },
    settings: CB('ML'),
  },
  {
    id: 'mplus-ex7.8',
    package: 'poLCA',
    title:
      'LCA with unordered categorical indicators, user-specified starting values (Mplus ex. 7.8)',
    source: MPLUS_SRC('7.8'),
    links: mplusLinks('7.8'),
    description:
      'The data of example 7.7 with Mplus started from given logits ([u1#1-u4#1*0] …) as well as random starts; the card uses 10 random poLCA starts. As in 7.7 it reproduces the log-likelihood −21408.482, 17 free parameters, BIC 42961.756, the larger class’s logits and the class intercept; the weakly determined smaller class’s logits are within 0.003 of Mplus’s (u2: Mplus 2.353 and 2.838, the card 2.350 and 2.835), at the same log-likelihood. Standard errors (Mplus’s MLR) are not reproduced. Opens its card on the Analyses tab.',
    shows:
      'The solution of example 7.7 whether Mplus starts from its given logits or the card from 10 random starts: log-likelihood −21408.482, 17 free parameters, BIC 42961.756. The larger class agrees within 0.001; the weakly determined smaller class’s logits within 0.003 (u2: 2.350 and 2.835 against 2.353 and 2.838), at the same log-likelihood.',
    data: mplusData('7.8', 'poLCA'),
    constructs: [],
    paths: [],
    tags: [MPLUS_TAG],
    panel: { kind: 'lca', items: items('u', 4), from: 2, to: 2 },
    settings: CB('ML'),
  },
  {
    id: 'mplus-ex7.9',
    package: 'stats',
    title: 'Latent profile analysis with continuous indicators (Mplus ex. 7.9)',
    source: MPLUS_SRC('7.9'),
    links: mplusLinks('7.9'),
    description:
      'Two latent classes from four continuous items y1–y4 (Mplus: TYPE = MIXTURE without CATEGORICAL): the items are independent within class, with class-specific means and variances equal across classes (Mplus’s default). The latent class card’s latent-profile model with that structure (a normal mixture fitted by EM from 10 starts) reproduces the Mplus output: log-likelihood −3177.162, 13 free parameters, BIC 6435.114, the class means and variances and the class intercept (log of the ratio of the class shares). Standard errors (Mplus’s MLR) are not reproduced. Opens its card on the Analyses tab.',
    shows:
      'Reproduces Mplus: log-likelihood −3177.162, 13 free parameters, BIC 6435.114. Two profiles of nearly equal size (class intercept −0.085) sit about two units apart on every item: means −1.093 to −0.943 in one class, 0.865 to 1.037 in the other, with one set of variances (0.975–1.134) shared. No standard errors on the card.',
    data: mplusData('7.9', 'stats'),
    constructs: [],
    paths: [],
    tags: [MPLUS_TAG],
    panel: { kind: 'lca', model: 'lpa', structure: 'EEI', items: items('y', 4), from: 2, to: 2 },
    settings: CB('ML'),
  },
  {
    id: 'mplus-ex7.10',
    package: 'stats',
    title: 'Latent profile analysis with class-specific variances (Mplus ex. 7.10)',
    source: MPLUS_SRC('7.10'),
    links: mplusLinks('7.10'),
    description:
      'The latent profile model of example 7.9 with the variances free in each class (Mplus: y1-y4; in each class), which Mplus starts from given means without random starts; the card starts EM from 10 points. It reproduces the Mplus output: log-likelihood −3174.564, 17 free parameters, BIC 6454.776, the class means and variances and the class intercept. Standard errors (Mplus’s MLR) are not reproduced. Opens its card on the Analyses tab.',
    shows:
      'Reproduces Mplus: log-likelihood −3174.564, 17 free parameters, BIC 6454.776, class means and variances within 0.001. Against example 7.9, freeing the variances per class costs 4 parameters and moves the log-likelihood only from −3177.162 to −3174.564, so the BIC rises from 6435.114: the equal-variance profiles are preferred.',
    data: mplusData('7.10', 'stats'),
    constructs: [],
    paths: [],
    tags: [MPLUS_TAG],
    panel: { kind: 'lca', model: 'lpa', structure: 'VVI', items: items('y', 4), from: 2, to: 2 },
    settings: CB('ML'),
  },
  {
    id: 'mplus-ex7.22',
    package: 'stats',
    title: 'Mixture with continuous variables that correlate within class (Mplus ex. 7.22)',
    source: MPLUS_SRC('7.22'),
    links: mplusLinks('7.22'),
    description:
      'Three latent classes of four continuous items that covary within class, the variances and covariances equal across classes (Mplus: y1 WITH y2-y4; … in %OVERALL%). The card’s latent-profile model with covariances equal across classes (EM from 10 starts) reproduces the Mplus output: log-likelihood −3054.963, 24 free parameters, BIC 6259.077, the three classes’ means, the common variances and covariances, and the two class intercepts. Standard errors (Mplus’s MLR) are not reproduced. Opens its card on the Analyses tab.',
    shows:
      'Reproduces Mplus: log-likelihood −3054.963, 24 free parameters, BIC 6259.077, three profiles and two class intercepts within 0.001. The means step from about −2 (−2.126 to −1.987) through about 0 to about +2 (1.791 to 2.015) with one covariance matrix shared across classes; the within-class covariances (y1 with y4 0.476) are what a plain profile model omits.',
    data: mplusData('7.22', 'stats'),
    constructs: [],
    paths: [],
    tags: [MPLUS_TAG],
    panel: { kind: 'lca', model: 'lpa', structure: 'EEE', items: items('y', 4), from: 3, to: 3 },
    settings: CB('ML'),
  },
  {
    id: 'mplus-ex7.25',
    package: 'stats',
    title: 'Zero-inflated Poisson regression as a two-class model (Mplus ex. 7.25)',
    source: MPLUS_SRC('7.25'),
    links: mplusLinks('7.25'),
    description:
      'A count u1 regressed on x1 and x3, written in Mplus as a mixture: in class 1 the count is fixed at zero ([u1@-15], u1 ON x1@0 x3@0), in class 2 it is Poisson with log rate on x1 and x3, and the class regressed on x1 and x3 (c ON x1 x3). That is the zero-inflated Poisson regression: class 1 is the structural zero, its logit c#1 the inflation. The regression card’s zero-inflated Poisson model (maximum likelihood in R) with HC0 (the sandwich; Mplus’s default MLR) reproduces the Mplus output: log-likelihood −724.663, 6 free parameters, AIC 1461.327, BIC 1486.614, class 2’s intercept and slopes (1.042, 0.634, 0.287) and the inflation’s (c#1: −1.238, 2.189, 0.961), each with its standard error. Opens its card on the Analyses tab.',
    shows:
      'Reproduces the two-class Mplus model as a zero-inflated Poisson regression: log-likelihood −724.663, 6 free parameters, AIC 1461.327. Read the count part as Mplus’s class 2 (intercept 1.042, x1 0.634, x3 0.287) and the inflation as c#1 (−1.238, 2.189, 0.961): x1 raises both the rate and the chance of a structural zero. HC0 SEs match MLR within 0.001.',
    data: mplusData('7.25', 'stats'),
    constructs: [],
    paths: [],
    tags: [MPLUS_TAG, 'Count data'],
    panel: { ...regression('poisson', 'log', 'u1', ['x1', 'x3']), inflated: true, se: 'HC0' },
    settings: CB('ML'),
  },
  {
    id: 'mplus-ex7.28',
    package: 'stats',
    title: 'Twin model for binary outcomes with known classes (Mplus ex. 7.28)',
    source: MPLUS_SRC('7.28'),
    links: mplusLinks('7.28'),
    description:
      'Binary twin outcomes u1, u2 (N = 3000 pairs) with zygosity as a known class (KNOWNCLASS = cdz: dz = 0 monozygotic, 1 dizygotic) and a probit link: each twin’s latent response is a factor f plus a unit residual, the factors’ variance a² + c² + 0.001 and their covariance a² + c² in mz and 0.5a² + c² in dz pairs, one threshold for both twins (Mplus: f1 BY u1; f2 BY u2; f1-f2 (varf); f1 WITH f2 (covmz) and (covdz); MODEL CONSTRAINT). The classes are observed, so the likelihood is a bivariate probit for the twins times a binomial for the classes. The example opens two custom likelihood cards: the probit model of u1 and u2, the thresholds t and the latent responses’ variances a² + c² + 0.001 + 1 and covariance a² + c² − dz·0.5a² (dz, the class, a data column), with varf, covmz, covdz and h = a²/(a² + c² + 1) defined; and a nominal model of dz whose logit k is Mplus’s class mean cdz#1 (0.053, SE 0.028, as printed). Both with sandwich (MLR) standard errors, as Mplus. Mplus integrates the two factors numerically (adaptive quadrature, 15 points per dimension), the card computes the bivariate normal probabilities exactly (pbivnorm): at Mplus’s own estimates the exact log-likelihood is −9927.527, Mplus prints −9927.558, the quadrature’s error. The cards reach −9927.526 (AIC 19863.052; 4 parameters), and with the likelihood flat in c (SE 0.34) their estimates differ from Mplus’s by up to 0.004: t 0.013 (SE 0.029), a 1.682 (0.119) against 1.679 (0.116), c 0.335 (0.347) against 0.339 (0.340), h 0.718 (0.067) against 0.717 (0.066), varf 2.942 against 2.934, covdz 1.527 against 1.524. Opens its cards on the Analyses tab.',
    shows:
      'Two cards, one likelihood: the probit card reaches −9927.526 against Mplus’s −9927.558 (its quadrature error; the exact value at Mplus’s estimates is −9927.527), the class card gives cdz#1 0.053 (SE 0.028) as printed. Heritability h 0.718 (SE 0.067) against 0.717; c 0.335 against 0.339 with SE 0.34, so the shared environment is not determined here.',
    data: mplusData('7.28', 'stats'),
    tags: [MPLUS_TAG, 'Twin model'],
    constructs: [],
    paths: [],
    panel: {
      kind: 'customml',
      type: 'probit',
      outcomes: ['u1', 'u2'],
      parameters: [
        { name: 't', start: 0 },
        { name: 'a', start: 1 },
        { name: 'c', start: 0.5 },
      ],
      logits: [],
      means: ['t', 't'],
      variances: ['a^2 + c^2 + 0.001 + 1', 'a^2 + c^2 + 0.001 + 1'],
      covariances: ['a^2 + c^2 - dz*0.5*a^2'],
      defined: [
        { name: 'varf', expr: 'a^2 + c^2 + 0.001' },
        { name: 'covmz', expr: 'a^2 + c^2' },
        { name: 'covdz', expr: '0.5*a^2 + c^2' },
        { name: 'h', expr: 'a^2/(a^2 + c^2 + 1)' },
      ],
      se: 'robust',
    },
    morePanels: [
      {
        kind: 'customml',
        type: 'nominal',
        outcomes: ['dz'],
        parameters: [{ name: 'k', start: 0 }],
        logits: ['k'],
        means: [],
        variances: [],
        covariances: [],
        defined: [],
        se: 'robust',
      },
    ],
    settings: CB('ML'),
  },
  {
    id: 'mplus-ex7.30',
    package: 'stats',
    title:
      'Cox regression with a treatment effect, as a mixture with observed classes (Mplus ex. 7.30)',
    source: MPLUS_SRC('7.30'),
    links: mplusLinks('7.30'),
    description:
      'A survival time t (500 persons, 143 censored) on a covariate x, with the treatment u as a class indicator whose thresholds are fixed at ±15 (Mplus: [u$1@15] in class 1, [u$1@-15] in class 2), so the classes are the observed groups u = 0 and u = 1, and the class-specific intercept of t ([t@0] in class 1, [t] in class 2) is the log hazard ratio of treatment. That is a Cox regression of t on x and u: survival’s coxph with HC0 (the robust sandwich; Mplus’s default MLR) reproduces the coefficient of x (0.541, SE 0.057) and the treatment effect (0.974, SE 0.117), and c#1 (−0.160, SE 0.090) is the log of the ratio of the group sizes. Mplus’s log-likelihood (−98.989) is on its own basis: the partial log-likelihood coxph reports (−1824.250), minus the number of events, minus the log of each event’s distance to the previous observed time (Mplus’s baseline hazard, a step function), plus the binomial log-likelihood of u; the test computes it this way to within 0.001. Opens its card on the Analyses tab.',
    shows:
      'Reproduces Mplus with coxph and HC0: x 0.541 (SE 0.057) and the treatment effect 0.974 (SE 0.117), both log hazard ratios, and c#1 −0.160 is the log ratio of the group sizes. The log-likelihood looks wrong but is not: coxph’s partial −1824.250 becomes Mplus’s −98.989 once its baseline-hazard convention and the binomial part for u are added.',
    data: mplusData('7.30', 'stats'),
    constructs: [],
    paths: [],
    tags: [MPLUS_TAG, 'Survival analysis'],
    panel: {
      ...regression('survival', 'logit', 't', ['x', 'u']),
      status: 'tcent',
      statusCensored: true,
      se: 'HC0',
    },
    settings: CB('ML'),
  },
];
