// Examples that open the Informative hypotheses card: restriktor's tutorial SEM example (GORICA) and bain's vignette
// latent regression (Bayes factors), each with the package's own data, model, hypotheses and seed. Checked against the
// packages run natively in cards/hypotheses.webr.test.ts (scripts/validation/hypotheses.R).

import { CB } from '../define';
import type { PackageExample } from '../packages';

const CARD = 'Opens its card on the Analyses tab beside the diagram.';

export const CARD_HYPOTHESES: PackageExample[] = [
  {
    id: 'restriktor-poldem-gorica',
    package: 'restriktor',
    title: 'GORICA: is democracy’s stability a larger effect than industrialisation?',
    source: 'restriktor, vignette("Tutorial_GORICA_restriktor_lavaan"), SEM example (Bollen 1989)',
    links: [
      {
        label: 'Tutorial: GORICA with restriktor and lavaan',
        url: 'https://cran.r-project.org/web/packages/restriktor/vignettes/Tutorial_GORICA_restriktor_lavaan.html',
      },
      { label: '?goric', url: 'https://rdrr.io/cran/restriktor/man/goric.html' },
      {
        label: 'Altinisik et al. (2021), Psychological Methods',
        url: 'https://doi.org/10.1037/met0000400',
      },
      {
        label: '?PoliticalDemocracy',
        url: 'https://rdrr.io/cran/lavaan/man/PoliticalDemocracy.html',
      },
    ],
    description:
      'Bollen’s model of industrialisation and political democracy in 75 countries (data from lavaan) with its six correlated measurement errors, as restriktor’s tutorial writes it: the two paths into democracy in 1965 are labelled beta_dem65_ind60 and beta_dem65_dem60, and the hypothesis says democracy in 1960 predicts democracy in 1965 more strongly than industrialisation does, in size: abs(beta_dem65_dem60) > abs(beta_dem65_ind60), on the standardised estimates, against its complement, with the tutorial’s set.seed(100). ' +
      CARD,
    shows:
      'The hypothesis has GORICA −5.70 against 31.14 for its complement: weight 1.000, all the support (the standardised effects are .89 and .18). Both have penalty 1.5, so the decision rests on fit alone; the tutorial prints the same values.',
    syntax: [
      'ind60 =~ x1 + x2 + x3',
      'dem60 =~ y1 + y2 + y3 + y4',
      'dem65 =~ y5 + y6 + y7 + y8',
      'dem60 ~ ind60',
      'dem65 ~ beta_dem65_ind60*ind60 + beta_dem65_dem60*dem60',
      'y1 ~~ y5',
      'y2 ~~ y4',
      'y2 ~~ y6',
      'y3 ~~ y7',
      'y4 ~~ y8',
      'y6 ~~ y8',
    ].join('\n'),
    data: { package: 'lavaan', name: 'PoliticalDemocracy' },
    constructs: [],
    paths: [],
    panel: {
      kind: 'hypotheses',
      text: 'abs(beta_dem65_dem60) > abs(beta_dem65_ind60)',
      method: 'gorica',
      comparison: 'complement',
      standardized: true,
      fraction: 1,
    },
    settings: { ...CB('ML'), seed: 100 },
  },
  {
    id: 'bain-sesame-latent',
    package: 'bain',
    title: 'Bayes factors for ordered effects: Sesame Street (bain)',
    source: 'bain, vignette("Introduction_to_bain"), latent regression (sesamesim)',
    links: [
      {
        label: 'Introduction to bain',
        url: 'https://cran.r-project.org/web/packages/bain/vignettes/Introduction_to_bain.html',
      },
      { label: '?bain', url: 'https://rdrr.io/cran/bain/man/bain.html' },
      { label: '?sesamesim', url: 'https://rdrr.io/cran/bain/man/sesamesim.html' },
      { label: 'Gu, Mulder & Hoijtink (2018), BJMSP', url: 'https://doi.org/10.1111/bmsp.12110' },
      {
        label: 'Van Lissa et al. (2021), SEM',
        url: 'https://doi.org/10.1080/10705511.2020.1745644',
      },
    ],
    description:
      'bain’s simulated Sesame Street data (240 children; bain’s package data, GPL): the knowledge factor after watching (A, six tests) regressed on knowledge before (B, six tests), age and the Peabody test, both factors with unit variances as the vignette’s std.lv = TRUE. The vignette’s three hypotheses on the standardised paths, labelled b_B, b_peabody and b_age here (bain names them A~B, A~peabody, A~age): b_B > b_peabody = b_age = 0; b_B > b_peabody > b_age = 0; b_B > b_peabody > b_age > 0, with fraction 1 and set.seed(100). ' +
      CARD,
    shows:
      'The first hypothesis — only prior knowledge matters — is best: Bayes factor 150.9 against the unconstrained hypothesis and posterior probability .79 among the three (.786 with the complement added). The second gets .18 and the fully ordered third .03; the matrix says H1 is 4.3 times as likely as H2. The vignette prints the same.',
    syntax: [
      'A =~ NA*Ab + Al + Af + An + Ar + Ac',
      'B =~ NA*Bb + Bl + Bf + Bn + Br + Bc',
      'A ~ b_B*B + b_age*age + b_peabody*peabody',
      'A ~~ 1*A',
      'B ~~ 1*B',
    ].join('\n'),
    data: { package: 'bain', name: 'sesamesim' },
    constructs: [],
    paths: [],
    panel: {
      kind: 'hypotheses',
      text: 'b_B > b_peabody = b_age = 0\nb_B > b_peabody > b_age = 0\nb_B > b_peabody > b_age > 0',
      method: 'bain',
      comparison: 'unconstrained',
      standardized: true,
      fraction: 1,
    },
    settings: { ...CB('ML'), seed: 100 },
  },
];
