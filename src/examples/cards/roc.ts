// The example of the ROC card (analyses/roc.tsx): pROC's own documented analysis of its aSAH data (?roc, ?ci.auc,
// ?coords, ?auc, ?roc.test), checked against pROC's printed results in cards/roc.webr.test.ts.

import { CB } from '../define';
import type { PackageExample } from '../packages';

const PROC = (page: string) => ({
  label: `pROC, ?${page}`,
  url: `https://rdrr.io/cran/pROC/man/${page}.html`,
});

export const CARD_ROC: PackageExample[] = [
  {
    id: 'proc-asah',
    package: 'pROC',
    title: 'ROC analysis: biomarkers of outcome after subarachnoid haemorrhage',
    source: 'pROC, ?roc, ?roc.test (aSAH: Turck et al. 2010)',
    links: [
      PROC('roc'),
      PROC('roc.test'),
      PROC('coords'),
      PROC('aSAH'),
      {
        label: 'Robin et al. (2011), BMC Bioinformatics 12:77',
        url: 'https://doi.org/10.1186/1471-2105-12-77',
      },
    ],
    description:
      '113 patients after aneurysmal subarachnoid haemorrhage (Turck et al. 2010; pROC’s aSAH, GPL-3): the clinical ' +
      'outcome (Good or Poor), the S100β protein in blood and the WFNS clinical score. As on pROC’s help pages, the ROC ' +
      'curve of s100b for a poor outcome (?roc), its AUC with DeLong’s interval (?ci.auc), the best threshold by ' +
      'Youden’s J (?coords), the partial AUC over specificities 0.8 to 1 (?auc) and DeLong’s paired test against the ' +
      'WFNS score (?roc.test). Opens its card on the Analyses tab.',
    shows:
      'S100β separates poor from good outcomes moderately: AUC 0.731, 95% CI 0.630 to 0.833 (DeLong). The best ' +
      'threshold, 0.205, catches 63% of poor outcomes at 81% specificity. The WFNS score does better (AUC 0.824): ' +
      'DeLong’s test gives Z = −2.209, p = 0.027.',
    data: { package: 'pROC', name: 'aSAH' },
    constructs: [],
    paths: [],
    panel: {
      kind: 'roc',
      response: 'outcome',
      predictor: 's100b',
      compare: 'paired',
      predictor2: 'wfns',
      pauc: true,
      paucFocus: 'specificity',
      paucFrom: 0.8,
      paucTo: 1,
    },
    settings: CB('ML'),
  },
];
