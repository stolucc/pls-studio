// Examples that open the item response, latent class and generalized linear mixed model cards with the models of
// mirt's, glca's and lme4's help pages (fitted by mirt, glca and GLMMadaptive), checked in cards/items.webr.test.ts
// against the packages run directly in the same R.

import { CB, items } from '../define';
import type { PackageExample } from '../packages';

export const CARD_ITEMS: PackageExample[] = [
  {
    id: 'mirt-lsat7-3pl', package: 'mirt', title: 'LSAT section 7: a guessing parameter with a prior', source: 'mirt, ?mirt (LSAT7)',
    links: [{ label: '?mirt', url: 'https://rdrr.io/cran/mirt/man/mirt.html' }, { label: '?LSAT7', url: 'https://rdrr.io/cran/mirt/man/LSAT7.html' }],
    description: 'Five binary items of the Law School Admission Test, section 7 (Bock & Lieberman 1970), stored as the 32 response patterns with their frequencies (N = 1000). As on mirt’s help page, items 1–4 are 2PL items and item 5 has a guessing parameter, with a normal prior N(−1.5, 3) on its logit (“PRIOR = (5, g, norm, −1.5, 3)”, g ≈ .18): the card’s 3PL model with guessing for Item.5 only, the frequency column freq, and the prior. Reproduces mirt run directly on the expanded data (coef(mod1.3PL.norm), with the card’s convergence criterion TOL = 1e-6; mirt’s default 1e-4 stops item 5’s threshold 0.008 short on this flat likelihood): log-likelihood −2658.79, item 5’s guessing parameter .19. Opens its card on the Analyses tab.',
    data: { package: 'mirt', name: 'LSAT7' }, constructs: [], paths: [],
    panel: { kind: 'irt', items: items('Item.', 5), model: 'threepl', guessItems: ['Item.5'], priorG: [-1.5, 3], freq: 'freq' }, settings: CB('ML'),
  },
  {
    id: 'glca-nyts18-mlca', package: 'glca', title: 'Tobacco use of students in schools: multilevel latent classes', source: 'glca, ?glca (nyts18, Model 4)',
    links: [{ label: '?glca', url: 'https://rdrr.io/cran/glca/man/glca.html' }, { label: '?nyts18', url: 'https://rdrr.io/cran/glca/man/nyts18.html' }],
    description: 'Five yes/no items on ever using e-cigarettes, cigars, smokeless tobacco, electronic cigarettes and hookah, from the 2018 National Youth Tobacco Survey (1734 students in 45 schools): three classes of students whose shares differ between two classes of schools, the multilevel latent class model of glca’s help page (nclass = 3, ncluster = 2, group = SCH_ID). Reproduces glca run directly with the same starts: log-likelihood, class shares and item probabilities. Opens its card on the Analyses tab.',
    data: { package: 'glca', name: 'nyts18' }, constructs: [], paths: [],
    panel: { kind: 'lca', items: ['ECIGT', 'ECIGAR', 'ESLT', 'EELCIGT', 'EHOOKAH'], from: 3, to: 3, model: 'mlca', cluster: 'SCH_ID', clusterClasses: 2 }, settings: CB('ML'),
  },
  {
    id: 'glmmadaptive-cbpp', package: 'GLMMadaptive', title: 'Contagious bovine pleuropneumonia: a binomial mixed model', source: 'lme4, ?glmer (cbpp), by GLMMadaptive',
    links: [{ label: '?glmer', url: 'https://rdrr.io/cran/lme4/man/glmer.html' }, { label: '?cbpp', url: 'https://rdrr.io/cran/lme4/man/cbpp.html' }, { label: 'GLMMadaptive ?mixed_model', url: 'https://rdrr.io/cran/GLMMadaptive/man/mixed_model.html' }],
    description: 'New cases of CBPP among the cattle of 15 herds in four periods (Lesnoff et al. 2004): the number of cases out of the herd size, by period, with a random intercept per herd, the model of lme4’s help page (glmer(cbind(incidence, size − incidence) ~ period + (1 | herd), family = binomial, nAGQ = 25)). GLMMadaptive fits it with 25 adaptive Gauss-Hermite points: the card reproduces glmer’s fixed effects and herd variance (.419) within 0.001 and the log-likelihood −91.983 of lme4 2.1.0 (the older lme4 2.0-6 in the browser reports −50.005 for this fit with nAGQ > 1, a different constant). Opens its card on the Analyses tab.',
    data: { package: 'lme4', name: 'cbpp' }, constructs: [], paths: [],
    panel: { kind: 'glmm', layout: 'long', outcome: 'incidence', cluster: 'herd', occasions: [], times: [], predictors: ['period'], categorical: ['period'], slopes: [], family: 'binomial', trials: 'size', ziPredictors: [], ziRandom: false, quadrature: 25, robust: false }, settings: CB('ML'),
  },
];
