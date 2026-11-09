// The example of the integration card (analyses/quadml.tsx), checked against the R help page it follows in
// cards/integration.webr.test.ts.

import { CB } from '../define';
import type { PackageExample } from '../packages';

export const CARD_INTEGRATION: PackageExample[] = [
  {
    id: 'ltm-quadml-lsat', package: 'ltm', title: 'Two-parameter logistic IRT by numerical integration: LSAT', source: 'ltm, ?ltm (ltm(LSAT ~ z1)); Bock & Lieberman (1970)',
    links: [{ label: '?ltm', url: 'https://rdrr.io/cran/ltm/man/ltm.html' }, { label: '?LSAT', url: 'https://rdrr.io/cran/ltm/man/LSAT.html' }],
    description: 'Five binary items of the Law School Admission Test (N = 1000; Bock & Lieberman 1970), the first example of R’s ?ltm help page: a two-parameter logistic model, ltm(LSAT ~ z1). On the integration card it is written in Mplus’s syntax, a factor f with variance 1 measured by the five items, its loadings free (f BY i1-i5*; f@1; CATEGORICAL = i1-i5), and integrated as ltm integrates it: 21 Gauss–Hermite points, not adaptive (INTEGRATION = GAUSSHERMITE (21); ADAPTIVE = OFF), with ML standard errors from the observed information. The items are the computed columns i1–i5 (the data’s columns are named “Item 1” … “Item 5”). The card’s loadings are ltm’s discriminations, its thresholds the discriminations times the difficulties (P(u = 1) = 1 / (1 + exp(threshold − loading × f))), and its log-likelihood ltm’s, −2466.653; the estimates agree within 0.001 (ltm’s optimizer stops a little short of the maximum: the discriminations 0.826, 0.723, 0.891, 0.688, 0.657 against ltm’s 0.825, 0.723, 0.890, 0.689, 0.657), and so do the standard errors of the discriminations. Opens its card on the Analyses tab.',
    shows: 'Log-likelihood −2466.653, ltm’s, with ten free parameters: the loadings are ltm’s discriminations (0.826, 0.723, 0.891, 0.688, 0.657 against ltm’s 0.825, 0.723, 0.890, 0.689, 0.657) and threshold ÷ loading its difficulties. The small differences come from ltm stopping its optimizer a little short of the maximum; the log-likelihoods agree to 1e-6.',
    data: { package: 'ltm', name: 'LSAT' }, constructs: [], paths: [], tags: ['Items', 'IRT'],
    computed: [1, 2, 3, 4, 5].map((i) => ({ name: `i${i}`, expr: `\`Item ${i}\`` })),
    panel: { kind: 'quadml', syntax: [
      'CATEGORICAL = i1-i5;',
      'ANALYSIS: ESTIMATOR = ML;',
      'INTEGRATION = GAUSSHERMITE (21);',
      'ADAPTIVE = OFF;',
      'MODEL:',
      'f BY i1-i5*;',
      'f@1;',
    ].join('\n') }, settings: CB('ML'),
  },
];
