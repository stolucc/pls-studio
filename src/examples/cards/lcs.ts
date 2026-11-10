// Examples that open the Latent change score card: lavaan's Demo.growth (the data of its growth-curve tutorial) with
// lcsm's specification of the dual change score model (Wiedemann et al.; McArdle 2009). Checked against lcsm's own
// specification and fit run natively in cards/lcs.webr.test.ts (scripts/validation/lcs.R).

import { CB } from '../define';
import type { PackageExample } from '../packages';

const LINKS = [
  { label: 'lcsm: specify_uni_lcsm, fit_uni_lcsm, fit_bi_lcsm', url: 'https://milanwiedemann.github.io/lcsm/' },
  { label: 'Kievit et al. (2018), Developmental Cognitive Neuroscience: LCS tutorial', url: 'https://doi.org/10.1016/j.dcn.2017.11.007' },
  { label: 'McArdle (2009), Annual Review of Psychology', url: 'https://doi.org/10.1146/annurev.psych.60.110707.163612' },
  { label: '?Demo.growth (lavaan)', url: 'https://rdrr.io/cran/lavaan/man/Demo.growth.html' },
];
const T = ['t1', 't2', 't3', 't4'], C = ['c1', 'c2', 'c3', 'c4'];

export const CARD_LCS: PackageExample[] = [
  {
    id: 'lavaan-demogrowth-lcs', package: 'lavaan', title: 'Latent change score model: dual change in Demo.growth', source: 'lavaan’s Demo.growth with lcsm’s specification of the dual change score model',
    links: LINKS,
    description: 'The four repeated measures t1 to t4 of lavaan’s growth-curve tutorial data (400 simulated persons), as a univariate dual change score model: a latent true score per occasion, latent changes between them, a constant change factor (α) and proportional change (β), with the changes also autoregressed (φ). The model and its parameter labels are those lcsm::specify_uni_lcsm writes; fitted by lavaan with ML. The second card couples t with the time-varying covariate c (c1 to c4): each variable’s change depends on the other’s previous true score (δ). Opens its cards on the Analyses tab.',
    shows: 'A steady rise carried by the constant change: α = 1.04 per occasion (z ≈ 15), faster for those who start higher, while proportional change (β = 0.03) and the autoregression of the changes (φ = −0.13) are not significant; fit is good (χ²(6) = 7.9, p = .24). In the coupled model neither δ is significant: c neither drives nor follows the changes in t.',
    data: { package: 'lavaan', name: 'Demo.growth' }, constructs: [], paths: [],
    panel: { kind: 'lcs', x: T, y: [], modelX: { constant: true, proportional: true, autoregressive: true }, modelY: { constant: true, proportional: true, autoregressive: false }, coupling: { deltaXY: false, deltaYX: false, xiXY: false, xiYX: false } },
    morePanels: [{ kind: 'lcs', x: T, y: C, modelX: { constant: true, proportional: true, autoregressive: false }, modelY: { constant: false, proportional: true, autoregressive: false }, coupling: { deltaXY: true, deltaYX: true, xiXY: false, xiYX: false } }],
    settings: CB('ML'),
  },
];
