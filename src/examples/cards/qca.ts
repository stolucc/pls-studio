// The examples of the fuzzy-set QCA card (analyses/qca.tsx): the QCA package's own documented analyses (?minimize,
// ?truthTable, ?pof, ?CV), checked against the package's printed results in cards/qca.webr.test.ts.

import { CB } from '../define';
import type { PackageExample } from '../packages';

const LINKS = {
  minimize: { label: '?minimize', url: 'https://rdrr.io/cran/QCA/man/minimize.html' },
  truthTable: { label: '?truthTable', url: 'https://rdrr.io/cran/QCA/man/truthTable.html' },
  pof: { label: '?pof', url: 'https://rdrr.io/cran/QCA/man/pof.html' },
  calibrate: { label: '?calibrate', url: 'https://rdrr.io/cran/QCA/man/calibrate.html' },
  lipset: { label: '?Lipset (LC, LF)', url: 'https://rdrr.io/cran/QCA/man/Lipset.html' },
  cv: { label: '?CV (CVF, CVR)', url: 'https://rdrr.io/cran/QCA/man/CV.html' },
  ragin: {
    label: 'Ragin (2008)',
    url: 'https://press.uchicago.edu/ucp/books/book/chicago/R/bo5973952.html',
  },
  dusa: { label: 'Dușa (2019), QCA with R', url: 'https://bookdown.org/dusadrian/QCAbook/' },
};
const LIPSET = ['DEV', 'URB', 'LIT', 'IND', 'STB'];
const CV = ['DEMOC', 'ETHFRACT', 'GEOCON', 'POLDIS', 'NATPRIDE'];

export const CARD_QCA: PackageExample[] = [
  {
    id: 'qca-lf-lipset',
    package: 'QCA',
    title: 'Survival of democracy: Lipset’s fuzzy sets (fsQCA)',
    source: 'QCA, ?minimize (LF: Ragin 2009, p. 112)',
    links: [LINKS.minimize, LINKS.truthTable, LINKS.lipset, LINKS.ragin, LINKS.dusa],
    description:
      'Lipset’s theory of the survival of democracy in inter-war Europe (18 countries), as fuzzy sets (Ragin 2009): development, urbanisation, literacy, industrialisation and government stability as conditions of survival. The ?minimize help page’s fuzzy-set analysis: truthTable(LF, SURV, incl.cut = 0.8, sort.by = "incl"), then the conservative solution, the parsimonious solution (DEV*~IND + URB*STB) and the intermediate solution with all five conditions expected present (dir.exp = c(DEV, URB, LIT, IND, STB)): DEV*URB*LIT*STB + DEV*LIT*~IND*STB, consistency 0.866, coverage 0.660. The data are already calibrated (0–1), so no calibration is applied; the analysis of necessity of each condition and its negation (pof) comes first. The package’s case names are not in the data the app loads, so cases are numbered. Opens its card on the Analyses tab.',
    shows:
      'Nine of the 32 configurations are observed, 23 are remainders, and only two rows pass the 0.8 consistency cut (0.904 and 0.804). The intermediate solution, DEV*URB*LIT*STB + DEV*LIT*~IND*STB, has consistency 0.866 and coverage 0.660; the parsimonious DEV*~IND + URB*STB rests on 12 simplifying assumptions. Read the necessity table first: inclN above 0.9 marks a candidate.',
    data: { package: 'QCA', name: 'LF' },
    constructs: [],
    paths: [],
    panel: {
      kind: 'qca',
      outcome: 'SURV',
      conditions: LIPSET,
      negate: false,
      inclCut: 0.8,
      nCut: 1,
      priCut: 0,
      sortBy: 'incl',
      dirExp: { DEV: '1', URB: '1', LIT: '1', IND: '1', STB: '1' },
      plot: 'intermediate',
    },
    settings: CB('ML'),
  },
  {
    id: 'qca-lc-lipset-crisp',
    package: 'QCA',
    title: 'Survival of democracy: Lipset’s crisp sets (csQCA)',
    source: 'QCA, ?minimize (LC: Rihoux & De Meur 2009, p. 57)',
    links: [LINKS.minimize, LINKS.truthTable, LINKS.lipset, LINKS.dusa],
    description:
      'The same 18 countries as binary crisp sets (Rihoux & De Meur 2009): the first example of ?minimize, truthTable(LC, SURV, sort.by = "incl, n") and its conservative solution DEV*~URB*LIT*STB + DEV*LIT*IND*STB (consistency 1, coverage 1; Rihoux & De Meur 2009, p. 57), and the parsimonious solution DEV*STB, which uses five remainders as simplifying assumptions. The consistency cut-off is 1, as the package’s default for crisp data. Opens its card on the Analyses tab.',
    shows:
      'With crisp sets every term has consistency 1: the conservative solution DEV*~URB*LIT*STB + DEV*LIT*IND*STB covers all eight surviving democracies (coverage 0.5 and 0.75 per term), and the parsimonious DEV*STB covers them alone, at the price of five simplifying assumptions about unobserved configurations. No intermediate solution is reported without directional expectations.',
    data: { package: 'QCA', name: 'LC' },
    constructs: [],
    paths: [],
    panel: {
      kind: 'qca',
      outcome: 'SURV',
      conditions: LIPSET,
      negate: false,
      inclCut: 1,
      nCut: 1,
      priCut: 0,
      sortBy: 'incl, n',
      dirExp: {},
      plot: 'parsimonious',
    },
    settings: CB('ML'),
  },
  {
    id: 'qca-lc-lipset-negated',
    package: 'QCA',
    title: 'Breakdown of democracy: the negated outcome (csQCA)',
    source: 'QCA, ?minimize (LC, ~SURV)',
    links: [LINKS.minimize, LINKS.truthTable, LINKS.lipset],
    description:
      'The ?minimize help page negates the outcome, truthTable(LC, ~SURV, sort.by = "incl, n"): which configurations are sufficient for the breakdown of democracy? The conservative solution ~DEV*~URB*~IND + DEV*LIT*IND*~STB and the parsimonious solution ~DEV + ~STB, each with consistency 1 and coverage 1. The card’s option “Analyse the negation of the outcome” is QCA’s ~SURV. Opens its card on the Analyses tab.',
    shows:
      'Breakdown is explained with consistency 1 and coverage 1: ~DEV*~URB*~IND (covering 0.8 of the breakdowns) + DEV*LIT*IND*~STB (0.2) conservatively, ~DEV + ~STB parsimoniously. Note that ~DEV + ~STB is the negation of DEV*STB, the parsimonious solution for survival: with these crisp data the two analyses mirror each other, which need not happen.',
    data: { package: 'QCA', name: 'LC' },
    constructs: [],
    paths: [],
    panel: {
      kind: 'qca',
      outcome: 'SURV',
      conditions: LIPSET,
      negate: true,
      inclCut: 1,
      nCut: 1,
      priCut: 0,
      sortBy: 'incl, n',
      dirExp: {},
      plot: 'parsimonious',
    },
    settings: CB('ML'),
  },
  {
    id: 'qca-cvf-protest',
    package: 'QCA',
    title: 'Ethnic protest: Cebotari & Vink’s fuzzy sets, model ambiguity',
    source: 'QCA, ?minimize and ?pof (CVF: Cebotari & Vink 2013)',
    links: [LINKS.minimize, LINKS.pof, LINKS.truthTable, LINKS.cv, LINKS.dusa],
    description:
      'Twenty-nine ethnic minorities in Europe (Cebotari & Vink 2013): democracy, ethnic fractionalisation, geographic concentration, political discrimination and national pride as conditions of ethnic protest. ?pof’s analysis of necessity (pof(conds, PROTEST), and the negated conditions pof(1 - conds, PROTEST)): geographic concentration is consistent as a necessary condition (0.904) but with low relevance (RoN 0.492). ?minimize’s truth table, truthTable(CVF, PROTEST, incl.cut = 0.8, sort.by = "incl, n"), and its parsimonious solution, which the package reports as four equally good models (M1–M4: ~NATPRIDE + DEMOC*GEOCON*POLDIS and two of four further terms) — model ambiguity, shown on the card with each model’s consistency and coverage (0.877–0.879 and 0.805–0.810). No directional expectations are set, so the intermediate solution is not reported. Opens its card on the Analyses tab.',
    shows:
      'Geographic concentration is nearly necessary for protest (consistency 0.904) but barely relevant (RoN 0.492), the mark of a trivial necessary condition; absent national pride is the most relevant (0.952). The parsimonious solution comes as four models, M1 to M4, sharing ~NATPRIDE + DEMOC*GEOCON*POLDIS, with consistency 0.877–0.879 and coverage 0.805–0.810: the data do not pick one.',
    data: { package: 'QCA', name: 'CVF' },
    constructs: [],
    paths: [],
    panel: {
      kind: 'qca',
      outcome: 'PROTEST',
      conditions: CV,
      negate: false,
      inclCut: 0.8,
      nCut: 1,
      priCut: 0,
      sortBy: 'incl, n',
      dirExp: {},
      plot: 'parsimonious',
    },
    settings: CB('ML'),
  },
  {
    id: 'qca-cvr-calibrate',
    package: 'QCA',
    title: 'Ethnic protest from raw scores: calibration by the direct method',
    source: 'QCA, ?CV (CVR with its documented anchors) and ?calibrate',
    links: [LINKS.calibrate, LINKS.cv, LINKS.minimize, LINKS.ragin],
    description:
      'The raw version of Cebotari & Vink’s data (CVR: Polity scores, fractionalisation indices, ordinal scales) calibrated into fuzzy sets by the direct method (calibrate(x, type = "fuzzy", thresholds = "e=…, c=…, i=…")) with the anchors the ?CV help page documents: democracy 2 / 7 / 9.5, ethnic fractionalisation 0 / 0.495 / 0.8, geographic concentration 0 / 1.25 / 3, political discrimination 0 / 0.75 / 3, national pride 0.5 / 1.5 / 2.5, protest 0.5 / 1.5 / 3 (exclusion, crossover, inclusion). The memberships reproduce the package’s calibrated dataset CVF (given to two decimals) to within 0.01, and the truth table and solutions are those of the CVF example (the same four parsimonious models, with the unrounded memberships). Opens its card on the Analyses tab.',
    shows:
      'In the Calibration table, each raw variable passes through the direct method with the documented anchors; the memberships match the package’s CVF columns to within 0.01, two decimals being all CVF holds. The truth table and solutions are the CVF example’s: the same four parsimonious models, with consistency and coverage within 0.005 of 0.877–0.879 and 0.805–0.810.',
    data: { package: 'QCA', name: 'CVR' },
    constructs: [],
    paths: [],
    panel: {
      kind: 'qca',
      outcome: 'PROTEST',
      conditions: CV,
      negate: false,
      inclCut: 0.8,
      nCut: 1,
      priCut: 0,
      sortBy: 'incl, n',
      dirExp: {},
      plot: 'parsimonious',
      calibration: {
        DEMOC: { method: 'direct', e: 2, c: 7, i: 9.5 },
        ETHFRACT: { method: 'direct', e: 0, c: 0.495, i: 0.8 },
        GEOCON: { method: 'direct', e: 0, c: 1.25, i: 3 },
        POLDIS: { method: 'direct', e: 0, c: 0.75, i: 3 },
        NATPRIDE: { method: 'direct', e: 0.5, c: 1.5, i: 2.5 },
        PROTEST: { method: 'direct', e: 0.5, c: 1.5, i: 3 },
      },
    },
    settings: CB('ML'),
  },
];
