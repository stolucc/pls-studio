// The example that opens the Dyadic APIM card: dySEM's commitmentM couples (Sakaluk, Fisher & Kilshaw 2021),
// satisfaction and commitment as latent variables of five items per partner, the model dySEM's scriptAPIM
// writes. dySEM cannot run in the browser's R (it imports semPlot), so its data are shipped as a CSV
// (public/examples/dyadic, GPL-3). Checked against dySEM's syntax fitted natively in cards/apim.webr.test.ts
// (scripts/validation/apim.R).

import { CB } from '../define';
import type { PackageExample } from '../packages';

const items = (stem: string, who: string) => [1, 2, 3, 4, 5].map((i) => `${stem}${i}_${who}`);

export const CARD_APIM: PackageExample[] = [
  {
    id: 'lavaan-apim-commitment',
    package: 'lavaan',
    title: 'Dyadic APIM: satisfaction and commitment in 282 couples',
    source: 'dySEM, ?scriptAPIM and ?commitmentM (Sakaluk, Fisher & Kilshaw 2021); Kenny, Kashy & Cook (2006)',
    links: [
      { label: '?scriptAPIM (dySEM)', url: 'https://rdrr.io/cran/dySEM/man/scriptAPIM.html' },
      { label: '?commitmentM (dySEM)', url: 'https://rdrr.io/cran/dySEM/man/commitmentM.html' },
      { label: 'Sakaluk, Fisher & Kilshaw (2021), Personal Relationships', url: 'https://doi.org/10.1111/pere.12341' },
      { label: 'Kenny & Ledermann (2010), J Family Psychology', url: 'https://doi.org/10.1037/a0019651' },
    ],
    description: 'Ratings of relationship satisfaction (X, five items) and commitment (Y, five items) by both partners of 282 mixed-sex couples (dySEM’s commitmentM, GPL-3; the 266 complete couples). The latent APIM as dySEM’s scriptAPIM writes it: the items’ loadings and intercepts equal across partners, the same item’s errors correlated, member 1 (the female partner) scaled to variance 1 and mean 0. Distinguishable dyads: each partner has their own actor and partner effect, and k = partner / actor for each. The card fits the indistinguishable model too, for the test of distinguishability. Opens its card on the Analyses tab; Draw on canvas puts the model on the Model tab.',
    shows: 'Both actor effects are strong (a1 = .85 for women, a2 = 1.14 for men). The man’s satisfaction also predicts the woman’s commitment (p1 = .39, k1 = .46, CI .11 to .80), but not the reverse (p2 = .04, k2 = .03). The test of distinguishability rejects equal partners: χ²(16) = 79.66, p < .001.',
    data: { package: 'lavaan', name: 'commitmentM (dySEM)', file: 'examples/dyadic/commitmentM.csv' },
    constructs: [],
    paths: [],
    panel: {
      kind: 'apim',
      x1: items('sat.g', 'f'), x2: items('sat.g', 'm'), y1: items('com', 'f'), y2: items('com', 'm'),
      dyads: 'distinguishable', bootstrap: false,
    },
    settings: { ...CB('ML'), missing: 'casewise' },
  },
];
