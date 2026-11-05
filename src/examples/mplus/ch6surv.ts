// Mplus User's Guide, chapter 6: discrete- and continuous-time survival analysis (examples 6.19, 6.20, 6.21; see common.ts).

import { CB } from '../define';
import type { PackageExample } from '../packages';
import { MPLUS_SRC, MPLUS_TAG, mplusData, mplusLinks, regression } from './common';

export const MPLUS_CH6SURV: PackageExample[] = [
  {
    id: 'mplus-ex6.19', package: 'stats', title: 'Discrete-time survival analysis (Mplus ex. 6.19)', source: MPLUS_SRC('6.19'), links: mplusLinks('6.19'),
    description: 'Event indicators u1–u4 for four periods, missing after the event, and a covariate x (500 persons). Mplus writes the model as a factor f BY u1-u4@1 with f@0 and f ON x, which is a logistic regression of each period’s event on x with one slope and a threshold per period (Muthén & Masyn 2005). The same likelihood is a logistic regression on the person-period data: one row per person and period at risk (1545 rows; the shipped file ex6.19long.csv, reshaped from the guide’s data), the period as categorical predictor. glm reproduces Mplus’s log-likelihood (−726.559) and the slope of x (0.597). The card’s intercept is period 1’s log-odds, minus Mplus’s first threshold (2.047), and the other periods are differences from it: Mplus’s thresholds are −(intercept + period effect), 1.455, 1.106 and 0.762. Mplus’s MLR standard errors are a sandwich over persons; the card’s cluster-robust ones by id (vcovCL, which adds the small-sample factor G/(G − 1)) agree within 0.001: 0.070 for x and 0.138 for the first threshold. Opens its card on the Analyses tab.',
    data: { ...mplusData('6.19', 'stats'), file: 'examples/mplus/ex6.19long.csv' }, constructs: [], paths: [], tags: [MPLUS_TAG, 'Survival analysis'],
    panel: { ...regression('binomial', 'logit', 'u', ['period', 'x']), categorical: ['period'], se: 'cluster', cluster: 'id' }, settings: CB('ML'),
  },
  {
    id: 'mplus-ex6.20', package: 'stats', title: 'Cox regression (Mplus ex. 6.20)', source: MPLUS_SRC('6.20'), links: mplusLinks('6.20'),
    description: 'A continuous-time survival analysis with the Cox proportional hazards model: survival time t (50 persons, 21 censored) regressed on x (Mplus: SURVIVAL = t, TIMECENSORED = tc (0 = NOT 1 = RIGHT); t ON x). survival’s coxph, the status column read as 1 = censored, reproduces the log hazard ratio (0.494) and, with HC0 (coxph’s robust sandwich; Mplus’s default MLR), its standard error (0.262; the model-based one is 0.235). Mplus’s log-likelihood (5.099) is computed on another basis than coxph’s partial log-likelihood (−89.531), so neither it nor AIC and BIC can be compared. Opens its card on the Analyses tab.',
    data: mplusData('6.20', 'stats'), constructs: [], paths: [], tags: [MPLUS_TAG, 'Survival analysis'],
    panel: { ...regression('survival', 'logit', 't', ['x']), status: 'tc', statusCensored: true, se: 'HC0' }, settings: CB('ML'),
  },
  {
    id: 'mplus-ex6.21', package: 'stats', title: 'Piecewise exponential survival model (Mplus ex. 6.21)', source: MPLUS_SRC('6.21'), links: mplusLinks('6.21'),
    description: 'A parametric proportional hazards model: the baseline hazard constant within each of 20 intervals of length 1 and beyond 20 (Mplus: SURVIVAL = t (20*1), BASEHAZARD = ON, [t#1-t#21]), and t regressed on x. The card splits each person’s time at the cut points 1, …, 20 (survival’s survSplit) and fits the events by Poisson regression with the log exposure as offset, the interval coefficients being the log baseline hazards. Reproduces the Mplus output: log-likelihood −1037.276, 22 free parameters, AIC 2118.552, BIC 2211.273, the coefficient of x (0.090) and the 21 baseline hazards, and, with HC0 (the sandwich clustered by person, Mplus’s default MLR), every standard error (the hazards’ by the delta method). Opens its card on the Analyses tab.',
    data: mplusData('6.21', 'stats'), constructs: [], paths: [], tags: [MPLUS_TAG, 'Survival analysis'],
    panel: { ...regression('survival', 'logit', 't', ['x']), status: 'tc', statusCensored: true, cuts: Array.from({ length: 20 }, (_, i) => i + 1), se: 'HC0' }, settings: CB('ML'),
  },
];
