// Examples that open the Score-based invariance test card: the documented strucchange/lavaan example of Merkle, Fan &
// Zeileis (2014) and Wang, Merkle & Zeileis (2014), the GQ-6 gratitude scale of psychotools' YouthGratitude data tested
// along age group. Checked against strucchange run natively in cards/scoretest.webr.test.ts (scripts/validation/scoretest.R).

import { CB, f, items } from '../define';
import type { PackageExample } from '../packages';

const LINKS = [
  {
    label: 'Wang, Merkle & Zeileis (2014), Frontiers in Psychology (the R code)',
    url: 'https://doi.org/10.3389/fpsyg.2014.00438',
  },
  {
    label: 'Merkle, Fan & Zeileis (2014), Psychometrika',
    url: 'https://doi.org/10.1007/s11336-013-9376-7',
  },
  {
    label: 'Merkle & Zeileis (2013), Psychometrika',
    url: 'https://doi.org/10.1007/s11336-012-9302-4',
  },
  {
    label: '?YouthGratitude (psychotools)',
    url: 'https://rdrr.io/cran/psychotools/man/YouthGratitude.html',
  },
  {
    label: '?ordwmax, ?ordL2BB, ?catL2BB (strucchange)',
    url: 'https://rdrr.io/cran/strucchange/man/catL2BB.html',
  },
];
const CARD = 'Opens its card on the Analyses tab beside the diagram.';

export const CARD_SCORETEST: PackageExample[] = [
  {
    id: 'strucchange-gratitude-agegroup',
    package: 'strucchange',
    title: 'Score-based invariance test: youth gratitude (GQ-6) along age group',
    source:
      'Merkle, Fan & Zeileis (2014); Wang, Merkle & Zeileis (2014): strucchange on lavaan (psychotools’ YouthGratitude)',
    links: LINKS,
    description:
      'Froh et al.’s (2011) youth gratitude data (psychotools; children and adolescents aged 10 to 19 in six age groups): one factor of five GQ-6 items, fitted in the six age groups with their loadings held equal (tau-equivalent), and the weighted double maximum test (WDMo) of whether those four loadings change along the ordinal age group, from that one fit. The publications use the 1327 complete cases (rows whose 25 items are all whole numbers 1 to 9: WDMo 2.91, p = .059; maxLMo 11.16, p = .097; LMuo 31.4, p = .050; the LR test of free loadings χ²(20) = 38.08, p = .009); this example uses all 1405 rows as psychotools ships them, some items averaged rather than whole. Switch the test to maxLMo, or treat age group as categorical (LMuo) or continuous (DM, CvM, maxLM), as the paper does. ' +
      CARD,
    shows:
      'On all 1405 rows WDMo = 3.51, p = .008: the loadings drift with age, and the process peaks at the split after age 15 (10–15 against 16–19). On the publications’ 1327 complete cases the same test is not significant (p = .059), which is the paper’s point: the LR test’s significance comes from non-systematic differences between the groups.',
    data: { package: 'psychotools', name: 'YouthGratitude' },
    constructs: [f('gratitude', items('gq6_', 5))],
    paths: [],
    multigroup: { column: 'agegroup', invariance: 'metric', free: [] },
    panel: {
      kind: 'scoretest',
      covariate: 'agegroup',
      scale: 'ordinal',
      fn: 'WDMo',
      sets: ['loadings'],
      nrep: 50000,
    },
    settings: CB('ML'),
  },
];
