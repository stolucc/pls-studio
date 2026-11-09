// The example of the Bayesian multilevel / DSEM card (analyses/dsem.tsx), from lme4's ?lmer help page, checked against
// lmer in examples/mplus/dsem.test.ts (the run recorded natively by dsem.native.test.ts: Stan does not run in webR).

import { CB } from '../define';
import type { PackageExample } from '../packages';

export const CARD_DSEM: PackageExample[] = [
  {
    id: 'rstan-dsem-sleepstudy', package: 'rstan', title: 'Sleep deprivation by Bayes: random intercepts and slopes in Stan', source: 'lme4, ?lmer (sleepstudy); Belenky et al. (2003)',
    links: [{ label: '?lmer', url: 'https://rdrr.io/cran/lme4/man/lmer.html' }, { label: '?sleepstudy', url: 'https://rdrr.io/cran/lme4/man/sleepstudy.html' }],
    description: 'The first model of lme4’s ?lmer help page, Reaction ~ Days + (Days | Subject): reaction times of 18 people over ten days of sleep deprivation, each with their own baseline and slowing per day, here written in Mplus’s syntax on the Bayesian multilevel / DSEM card (a random slope s | Reaction ON Days; the random intercept and slope covary, Reaction WITH s on the between level) and estimated by MCMC in Stan with Mplus’s default flat priors. The posterior medians of the fixed effects equal lmer’s REML estimates within a tenth of their standard errors (the mean intercept 251.5 against 251.4, the mean slope 10.44 against 10.47); their posterior SDs (8.4 and 1.8) are about a fifth larger than lmer’s standard errors (6.8 and 1.5), because the posterior also carries the uncertainty of the variances, which 18 subjects determine poorly. For the same reason the variances’ posterior medians lie above lmer’s REML estimates (intercept variance 932 against 612, slope variance 52 against 35; the residual variance 669 against 655), and their distributions are skewed: the 95% intervals are on the card. Runs in desktop R through the PLS Studio Helper (Stan compiles the model once, which needs a C++ toolchain). Opens its card on the Analyses tab.',
    shows: 'The posterior medians of the fixed effects sit at lmer’s REML estimates (intercept 251.5 against 251.4, slope 10.44 against 10.47), but their posterior SDs are larger (8.4 and 1.8 against 6.8 and 1.5) and the between-level variances lie above lmer’s (932 against 612, 52 against 35). With flat priors and 18 subjects the Bayesian fit is more uncertain, not different; the skewed intervals show why.',
    data: { package: 'lme4', name: 'sleepstudy' }, constructs: [], paths: [], tags: ['Mixed models'],
    panel: { kind: 'dsem', syntax: [
      'WITHIN = Days;',
      'CLUSTER = Subject;',
      'ANALYSIS:',
      'TYPE = TWOLEVEL RANDOM;',
      'ESTIMATOR = BAYES;',
      'MODEL:',
      '%WITHIN%',
      's | Reaction ON Days;',
      '%BETWEEN%',
      'Reaction WITH s;',
    ].join('\n'), chains: 2, warmup: 1000, draws: 2000 }, settings: CB('ML'),
  },
];
