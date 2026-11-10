// Examples that open the measurement invariance cards: sirt's alignment help-page example (four groups of
// data.inv4gr) and mnlfa's model 4 (data.mnlfa01), checked against the packages run natively in
// cards/invariance.webr.test.ts (scripts/validation/invariance_cards.R).

import { CB, f, type ExConstruct } from '../define';
import type { PackageExample } from '../packages';

const I11 = Array.from({ length: 11 }, (_, i) => `I${String(i + 1).padStart(2, '0')}`);
const INV4GR: ExConstruct[] = [f('F', I11)];
const SIRT_ALIGN = { label: '?invariance.alignment (sirt)', url: 'https://rdrr.io/cran/sirt/man/invariance.alignment.html' };
const AM2014 = { label: 'Asparouhov & Muthén (2014), SEM 21(4)', url: 'https://doi.org/10.1080/10705511.2014.919210' };

export const CARD_INVARIANCE: PackageExample[] = [
  {
    id: 'sirt-inv4gr-alignment', package: 'sirt', title: 'Alignment optimisation: one factor in four groups', source: 'sirt, ?invariance.alignment, example 2 (data.inv4gr)',
    links: [SIRT_ALIGN, { label: '?data.inv4gr (sirt)', url: 'https://rdrr.io/cran/sirt/man/data.invariance.html' }, AM2014],
    description: 'The help page’s example 2: eleven items of one factor F in four groups of 1000 simulated cases (data.inv4gr). The configural model is fitted in each group with the factor standardised (lavaan, as the help page does with semTools; χ² = 162.084 on 176 df, the value the help page prints), and invariance.alignment() aligns the group-wise loadings and intercepts with its defaults (power 0.5, scale 1, no weights). Group 3’s factor mean is about half an SD below group 1’s, the other groups close to it, and the SDs range from 1 to 1.33. The help page’s printed means and SDs come from an older sirt release (sirt notes changes of parametrisation since): the values here are those of the installed sirt. Opens its card on the Analyses tab beside the diagram.',
    shows: 'Approximate invariance holds well: R² is .975 for the loadings and .996 for the intercepts. Group 3’s aligned mean is −0.56 (group 1 = 0), while groups 2 and 4 stay within 0.06 of group 1; the SDs are 1.26, 1.33 and 1.11 times group 1’s. Within the help page’s tolerances (.2 for loadings, .4 for intercepts) no parameter counts as non-invariant: lower them on the card to see which items depart (at .05 for the loadings, I08 and I09 differ in all four groups).',
    data: { package: 'sirt', name: 'data.inv4gr' }, constructs: INV4GR, paths: [],
    panel: { kind: 'alignment', constructs: ['F'], group: 'group', groupWeights: 'equal', powerLambda: 0.5, powerNu: 0.5, scaleLambda: 1, scaleNu: 1, tolLambda: 0.2, tolNu: 0.4 }, settings: CB('ML'),
  },
  {
    id: 'mnlfa-mnlfa01-dif', package: 'mnlfa', title: 'Moderated nonlinear factor analysis: DIF by gender and age', source: 'mnlfa, ?mnlfa, example 1, model 4 (data.mnlfa01)',
    links: [{ label: '?mnlfa', url: 'https://rdrr.io/cran/mnlfa/man/mnlfa.html' }, { label: '?data.mnlfa01', url: 'https://rdrr.io/cran/mnlfa/man/data.mnlfa.html' },
      { label: 'Curran et al. (2014), MBR 49(3)', url: 'https://doi.org/10.1080/00273171.2014.889594' }],
    description: 'The help page’s model 4: twelve binary items I1–I12 of 1000 simulated persons under the 1PL, with the intercepts of items I4–I7 moderated by female (coded −0.5 / 0.5) and age (centred), the other eight items anchors, and the factor mean regressed on female and age (0 where both are 0; the SD free). The card writes the help page’s formulas: mnlfa_expand_to_list() for the intercepts, ~0 + female + age for the mean, ~1 for the SD. mnlfa estimates by EM and gives no standard errors: compare against the model without item moderation (untick the intercepts) by AIC and BIC. Opens its card on the Analyses tab.',
    shows: 'Uniform DIF in the four moderated items: I5’s intercept rises by 0.74 from men to women and I6’s falls by 0.47, while age moves I4 (−0.47) and I5 (0.42). Net of that DIF, women score 0.21 and each unit of age 0.33 higher on the factor. Deviance 14107.56 with 23 parameters (AIC 14154, BIC 14266), as the help page’s summary prints.',
    data: { package: 'mnlfa', name: 'data.mnlfa01' }, constructs: [], paths: [],
    panel: { kind: 'mnlfa', items: Array.from({ length: 12 }, (_, i) => `I${i + 1}`), itemType: '1PL', covariates: ['female', 'age'], categorical: [], intercept: ['female', 'age'], slope: [], mean: ['female', 'age'], sd: [], moderated: ['I4', 'I5', 'I6', 'I7'] },
    settings: CB('ML'),
  },
];
