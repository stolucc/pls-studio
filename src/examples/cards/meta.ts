// The example of the Meta-analysis card (analyses/meta.tsx): metafor's own ?rma example on the BCG vaccine trials
// (dat.bcg, shipped in metadat), checked against metafor's printed results in cards/meta.webr.test.ts.

import { CB } from '../define';
import type { PackageExample } from '../packages';

const BCG_AUTHORS = [
  'Aronson',
  'Ferguson & Simes',
  'Rosenthal et al',
  'Hart & Sutherland',
  'Frimodt-Moller et al',
  'Stein & Aronson',
  'Vandiviere et al',
  'TPT Madras',
  'Coetzee & Berjak',
  'Rosenthal et al',
  'Comstock et al',
  'Comstock & Webster',
  'Comstock et al',
];
const BCG_TABLE = { ai: 'tpos', bi: 'tneg', ci: 'cpos', di: 'cneg' };

export const CARD_META: PackageExample[] = [
  {
    id: 'metafor-bcg',
    package: 'metafor',
    title: 'Meta-analysis: the BCG vaccine against tuberculosis',
    source: 'metafor, ?rma (dat.bcg: Colditz et al. 1994)',
    links: [
      { label: 'metafor, ?rma', url: 'https://rdrr.io/cran/metafor/man/rma.uni.html' },
      { label: 'metadat, ?dat.bcg', url: 'https://rdrr.io/cran/metadat/man/dat.bcg.html' },
      {
        label: 'Viechtbauer (2010), Journal of Statistical Software 36(3)',
        url: 'https://doi.org/10.18637/jss.v036.i03',
      },
    ],
    description:
      '13 trials of the BCG vaccine against tuberculosis (Colditz et al. 1994; metadat’s dat.bcg, GPL): for each trial ' +
      'the vaccinated and unvaccinated groups’ cases (tpos, cpos) and non-cases (tneg, cneg), the absolute latitude of the ' +
      'trial (ablat) and its year. As on the ?rma help page, the log risk ratios are computed by escalc(measure = "RR") ' +
      'and pooled in a random-effects model (REML); the second card is the help page’s mixed-effects meta-regression on ' +
      'latitude and year. The trials are labelled by their authors. Opens two cards on the Analyses tab.',
    shows:
      'Vaccination lowers the risk of tuberculosis: the pooled log risk ratio is −0.715 [−1.067, −0.362], a risk ratio of ' +
      '0.489 [0.344, 0.696], but the trials differ a great deal (τ² = 0.313, I² = 92.2%, Q(12) = 152.2) and the prediction ' +
      'interval of the risk ratio, 0.155 to 1.549, includes no effect. Latitude explains much of it: in the meta-regression ' +
      'the log risk ratio falls by 0.028 per degree (p = 0.006), with R² = 64.6% of the heterogeneity accounted for.',
    data: { package: 'metadat', name: 'dat.bcg' },
    labels: { trial: BCG_AUTHORS },
    constructs: [],
    paths: [],
    panel: {
      kind: 'meta',
      measure: 'RR',
      columns: BCG_TABLE,
      method: 'REML',
      label: 'trial',
      bias: true,
      influence: true,
    },
    morePanels: [
      {
        kind: 'meta',
        measure: 'RR',
        columns: BCG_TABLE,
        method: 'REML',
        label: 'trial',
        moderators: ['ablat', 'year'],
        bias: false,
        influence: false,
      },
    ],
    settings: CB('ML'),
  },
];
