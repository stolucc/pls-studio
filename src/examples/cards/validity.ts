// Examples that open the validity cards: common method bias on the corporate reputation PLS model (Kock's
// full-collinearity VIFs from the construct scores, Harman's single-factor test on its indicators) and the content
// validity index of Polit & Beck's (2006) worked table, checked in cards/validity.webr.test.ts against seminr and
// psych run natively (scripts/validation/validity_cards.R) and the values the paper prints.
//
// Polit & Beck's Table 1 marks only whether each expert found an item relevant (a rating of 3 or 4): the shipped CSV
// (public/examples/tests/polit2006.csv) codes a relevant rating as 4 and the dissent as 2.

import { c, CB, fan, items } from '../define';
import type { PackageExample } from '../packages';
import type { Settings } from '../../model/project';

/** seminr's estimate_pls() defaults (path weighting, mean replacement, 300 iterations, 1e-07), as the seminr examples in packages.ts. */
const SEMINR = (more: Partial<Settings> = {}): Partial<Settings> => ({
  method: 'pls',
  plsPackage: 'seminr',
  consistent: false,
  scheme: 'path',
  missing: 'mean',
  ...more,
});

/** Hair et al. (2021): the extended corporate reputation model (as seminr-corprep in packages.ts). */
const CORP_REP = {
  data: { package: 'seminr' as const, name: 'corp_rep_data', na: [-99] },
  constructs: [
    c('QUAL', items('qual_', 8)),
    c('PERF', items('perf_', 5)),
    c('CSOR', items('csor_', 5)),
    c('ATTR', items('attr_', 3)),
    c('COMP', items('comp_', 3), 'A'),
    c('LIKE', items('like_', 3), 'A'),
    c('CUSA', ['cusa'], 'A'),
    c('CUSL', items('cusl_', 3), 'A'),
  ],
  paths: [
    ...fan(['QUAL', 'PERF', 'CSOR', 'ATTR'], ['COMP', 'LIKE']),
    ...fan(['COMP', 'LIKE'], ['CUSA', 'CUSL']),
    ['CUSA', 'CUSL'],
  ] as [string, string][],
};
const HAIR = [
  { label: '?corp_rep_data', url: 'https://rdrr.io/cran/seminr/man/corp_rep_data.html' },
  {
    label: 'Hair et al. (2021), PLS-SEM using R (open access)',
    url: 'https://doi.org/10.1007/978-3-030-80519-7',
  },
];

export const CARD_VALIDITY: PackageExample[] = [
  {
    id: 'seminr-corprep-cmb',
    package: 'seminr',
    title: 'Common method bias: full-collinearity VIFs and Harman’s test',
    source: 'Kock (2015); Podsakoff et al. (2003); seminr, corp_rep_data (Hair et al. 2021)',
    links: [
      { label: 'Kock (2015), IJeC 11(4)', url: 'https://doi.org/10.4018/ijec.2015100101' },
      {
        label: 'Podsakoff et al. (2003), J Appl Psych 88(5)',
        url: 'https://doi.org/10.1037/0021-9010.88.5.879',
      },
      ...HAIR,
    ],
    description:
      'Does one method behind all the measures inflate the corporate reputation model? Two cards: Kock’s (2015) full-collinearity test regresses each of the eight constructs on all the others from the PLS construct scores (N = 344, mean replacement as in the book); every VIF is below Kock’s 3.3 (the largest is quality’s, 4.28 — above it, so the test flags quality: QUAL, a Mode B composite of eight items, is the one construct the others predict closely). Harman’s single-factor test extracts one unrotated principal component from the 31 indicators (336 complete cases): it accounts for 40.7% of their variance, under the 50% convention, and four eigenvalues exceed 1 — a weak test, as Podsakoff et al. note. Press Calculate, then Run on the cards; the VIFs reproduce diag(solve(cor(scores))) of seminr’s construct scores and the test psych::principal, run natively.',
    shows:
      'Seven of the eight full-collinearity VIFs lie between 2.02 and 3.15, under Kock’s 3.3; quality’s is 4.28, so the test flags that one construct, a Mode B composite of eight items the others predict closely. Harman’s single component explains 40.7% of the indicators’ variance, under 50%, with four eigenvalues above 1: no sign of one method factor.',
    ...CORP_REP,
    panel: { kind: 'cmb', type: 'vif', source: 'model', vars: [], extraction: 'pca' },
    morePanels: [{ kind: 'cmb', type: 'harman', source: 'model', vars: [], extraction: 'pca' }],
    settings: SEMINR({ seed: 123 }),
  },
  {
    id: 'polit-cvi',
    package: 'stats',
    title: 'Content validity index: Polit & Beck’s worked table',
    source: 'Polit & Beck (2006), Table 1; Polit, Beck & Owen (2007)',
    links: [
      {
        label: 'Polit & Beck (2006), Research in Nursing & Health 29(5)',
        url: 'https://doi.org/10.1002/nur.20147',
      },
      {
        label: 'Polit, Beck & Owen (2007), Research in Nursing & Health 30(4)',
        url: 'https://doi.org/10.1002/nur.20199',
      },
      {
        label: 'Lynn (1986), Nursing Research 35(6)',
        url: 'https://doi.org/10.1097/00006199-198611000-00017',
      },
    ],
    description:
      'Polit & Beck’s (2006) fictitious ratings of a 10-item scale by three experts: all three found items 1–7 relevant (I-CVI = 1.00) and one expert dissented on each of items 8–10 (I-CVI = .67), so S-CVI/UA = .70 (universal agreement on 7 of 10 items) while S-CVI/Ave = .90 — the paper’s point that the two scale indices can differ widely and the one computed should be named. The card adds Polit, Beck & Owen’s (2007) modified kappa: with three experts, two agreeing by chance has probability pc = .375, so an I-CVI of .67 is k* = .47 (fair), and unanimity k* = 1.00 (excellent). The table marks relevance only (a rating of 3 or 4); the shipped file codes it 4 and the dissent 2. Opens its card on the Analyses tab.',
    shows:
      'Two scale indices from one table: S-CVI/UA is .70 (universal agreement on 7 of 10 items) while S-CVI/Ave is .90, so the index used must be named. In the item table, an I-CVI of .67 becomes k* = .47 (fair) once chance agreement of three experts (pc = .375) is removed; unanimity stays k* = 1.00 (excellent).',
    data: {
      package: 'stats',
      name: 'Polit & Beck (2006), Table 1',
      file: 'examples/tests/polit2006.csv',
    },
    constructs: [],
    paths: [],
    panel: { kind: 'cvi', raters: ['expert1', 'expert2', 'expert3'], item: 'item', threshold: 3 },
    settings: CB('ML'),
  },
];
