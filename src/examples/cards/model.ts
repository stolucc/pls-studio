// Examples that open a card: cards about a model (CB-SEM and PLS-SEM checks, prediction, segmentation, simulation), charts and the RI-CLPM. Each follows an R package's help page or a textbook, with
// the numbers it prints checked in cards/model.webr.test.ts.
//
// A sample of 150 drawn from Muthén & Muthén's (2002) CFA population is shipped as a CSV file (public/examples/montecarlo,
// generated with lavaan::simulateData and the paper's Monte Carlo seed 53487). Mulder & Hamaker's (2021) simulated
// RI-CLPM data are not shipped (their repository states no licence): the example downloads them from the tutorial's
// repository at a pinned commit when it opens (remote/source.ts, RICLPM_DATA).

import { c, CB, f, fan, items } from '../define';
import type { PackageExample } from '../packages';
import type { ModelState, Settings } from '../../model/project';
import { RICLPM_DATA } from '../remote/source';

const HS = [
  f('visual', items('x', 3)),
  f('textual', items('x', 3, 4)),
  f('speed', items('x', 3, 7)),
];
const HS_LINKS = [
  {
    label: '?HolzingerSwineford1939',
    url: 'https://rdrr.io/cran/lavaan/man/HolzingerSwineford1939.html',
  },
];
/** The HS CFA fitted in each school (configural groups): nonnest2's fit2, the comparison card's saved alternative. */
const HS_BY_SCHOOL: ModelState = {
  constructs: [
    ['visual', items('x', 3)],
    ['textual', items('x', 3, 4)],
    ['speed', items('x', 3, 7)],
  ].map(([name, indicators], i) => ({
    id: `alt-${name as string}`,
    name: name as string,
    type: 'factor' as const,
    mode: 'A' as const,
    indicators: indicators as string[],
    x: 0,
    y: 160 * i,
    side: 'left' as const,
  })),
  paths: [],
  moderations: [],
  correlations: [
    ['visual', 'textual'],
    ['visual', 'speed'],
    ['textual', 'speed'],
  ].map(([a, b]) => ({
    id: `alt-${a}-${b}`,
    kind: 'construct' as const,
    a: `alt-${a}`,
    b: `alt-${b}`,
  })),
  multigroup: { column: 'school', invariance: 'configural', free: [] },
};

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

/** seminr's mobi ECSI constructs, all Mode A composites (demo "seminr-alternative-models"). */
const MOBI = [
  c('Image', items('IMAG', 5), 'A'),
  c('Expectation', items('CUEX', 3), 'A'),
  c('Quality', items('PERQ', 7), 'A'),
  c('Value', items('PERV', 2), 'A'),
  c('Satisfaction', items('CUSA', 3), 'A'),
  c('Complaints', ['CUSCO'], 'A'),
  c('Loyalty', items('CUSL', 3), 'A'),
];
const ANTECEDENTS = ['Image', 'Expectation', 'Quality'],
  MEDIATORS = ['Satisfaction', 'Value'],
  OUTCOMES = ['Loyalty', 'Complaints'];
/** The demo's mediated_sm and overriding_effects_sm (both keep every construct, so the comparison card can use them). */
export const MOBI_MEDIATED: [string, string][] = [
  ...fan(ANTECEDENTS, MEDIATORS),
  ...fan(MEDIATORS, OUTCOMES),
];
export const MOBI_OVERRIDING: [string, string][] = [
  ...fan(ANTECEDENTS, MEDIATORS),
  ...fan([...ANTECEDENTS, ...MEDIATORS], OUTCOMES),
];

const SIMDATA = {
  data: { package: 'plspm' as const, name: 'simdata' },
  constructs: [
    f('Price', items('mv', 5)),
    f('Quality', items('mv', 5, 6)),
    f('Satisfaction', items('mv', 3, 11)),
  ],
  paths: [
    ['Price', 'Satisfaction'],
    ['Quality', 'Satisfaction'],
  ] as [string, string][],
};

/**
 * Rönkkö & Evermann (2013): two common factors with three indicators each (loadings .6, .7, .8) and one path,
 * β = 0 or .3; the paper simulates N = 100 with 500 replications. Henseler et al. (2014) vary it: β = .5, N = 500,
 * loadings .5, .7, .9, and a four-construct model that adds C → A and D → B (both .3).
 */
export const ronkkoEvermannPopulation = (
  beta: number,
  { loadings = [0.6, 0.7, 0.8], four = false }: { loadings?: number[]; four?: boolean } = {},
) => {
  const factor = (name: string) => ({
    name,
    type: 'factor',
    indicators: items(name.toLowerCase(), 3),
    loadings,
  });
  const paths = [{ from: 'A', to: 'B', value: beta }];
  if (four) paths.push({ from: 'C', to: 'A', value: 0.3 }, { from: 'D', to: 'B', value: 0.3 });
  return {
    constructs: (four ? ['A', 'B', 'C', 'D'] : ['A', 'B']).map(factor),
    paths,
    exoCor: [],
    skew: 0,
    kurtosis: 0,
  };
};

/** What the cards take from the paper, and what is the app's (both descriptions include it). */
const RONKKO_EVERMANN_DIFFERS =
  'As in the paper: the population, N = 100, 500 replications, PLS mode A and mode B with centroid weighting (the default of plspm, which the paper used) against regression on sum scores and ML SEM. The app’s choices: PLS by cSEM and SEM by the current lavaan; the reliability of a composite is the population reliability of each sample’s weights, (w′λ)² / w′Σw, where the paper correlates the estimated scores with the generated true scores; 500 bootstrap samples per replication with percentile intervals (change them on the card; the paper’s Figure 4, the bootstrap distributions of the first five replications, is not drawn); and the measurement checks as the app computes them (AVE − highest squared correlation appears as the Fornell–Larcker margin √AVE − highest correlation, which decides the same). The paper’s models with a misspecified measurement model (Table 4) are not part of these cards; cross-loadings and error correlations can be added on the card. Random numbers differ from the paper’s, so results agree up to Monte Carlo error.';

/** Which side of the PLS debate a card's population takes: every card tagged so says it. */
const FACTOR_POPULATION =
  ' The population is made of common factors, the view of measurement behind CB-SEM, which composites (PLS, sum scores) only approximate; with a population of composites the comparison turns around (Sarstedt et al. 2016), and no test of the data can say which of the two holds (data that fit a factor model fit a composite model too).';
const FACTOR_DEBATE_TAGS = ['PLS debate', 'Factor population'];

/** A card on Rönkkö & Evermann's population: the paper's (or the reply's) design, estimators and settings. */
const factorCard = ({
  beta,
  loadings,
  four = false,
  sampleSizes = [100],
  source,
  links,
  file,
}: {
  beta: number;
  loadings?: number[];
  four?: boolean;
  sampleSizes?: number[];
  source: string;
  links: { label: string; url: string }[];
  file: string;
}) => ({
  package: 'cSEM' as const,
  source,
  links,
  tags: FACTOR_DEBATE_TAGS,
  data: {
    package: 'cSEM' as const,
    name: `${source.split(',')[0]}, a sample of 100 (β = ${beta})`,
    file: `examples/montecarlo/${file}.csv`,
  },
  constructs: (four ? ['A', 'B', 'C', 'D'] : ['A', 'B']).map((name) =>
    f(name, items(name.toLowerCase(), 3)),
  ),
  paths: (four
    ? [
        ['C', 'A'],
        ['A', 'B'],
        ['D', 'B'],
      ]
    : [['A', 'B']]) as [string, string][],
  panel: {
    kind: 'mc' as const,
    population: ronkkoEvermannPopulation(beta, { loadings, four }),
    estimators: [
      {
        id: 'PLS mode A, centroid',
        method: 'pls',
        consistent: false,
        mode: 'A',
        scheme: 'centroid',
      },
      {
        id: 'PLS mode B, centroid',
        method: 'pls',
        consistent: false,
        mode: 'B',
        scheme: 'centroid',
      },
      { id: 'Sum scores', method: 'regression', dr: false },
      { id: 'CB-ML', method: 'cb', estimator: 'ML' },
    ],
    sampleSizes,
    replications: 500,
    seed: 2013,
    alpha: 0.05,
    bootSamples: 500,
    mcDraws: 0,
  },
  settings: {
    method: 'pls' as const,
    plsPackage: 'cSEM' as const,
    consistent: false,
    scheme: 'centroid' as const,
    missing: 'casewise' as const,
    seed: 2013,
  },
});

const RONKKO_EVERMANN_LINKS = [
  { label: 'Rönkkö & Evermann (2013)', url: 'https://doi.org/10.1177/1094428112474693' },
  { label: 'Henseler et al. (2014), the reply', url: 'https://doi.org/10.1177/1094428114526928' },
];

/** What the Henseler et al. cards take from the reply, and what is the app's. */
const HENSELER_DIFFERS =
  'As in the paper: Rönkkö & Evermann’s population with the one factor changed, 500 replications, PLS mode A and mode B with centroid weighting (semPLS’s default, which the paper used) against regression on sum scores; the card adds ML SEM (lavaan), which the paper’s Figures 3 and 5 leave out. The paper measures a composite’s reliability as the correlation of its scores with the generated true scores, the square root of the reliability the card reports ((w′λ)² / w′Σw, the population reliability of each sample’s weights): its .862 for sum scores is √.743. The paper’s most reliable single indicator and the share of samples in which PLS beats sum scores (Table 2) are not drawn. The paper’s Table 4 compares four bootstrap intervals; the card’s Type I error / power by test table has the t, normal, basic and percentile tests, and BCa when the card’s interval is set to BCa. Random numbers differ from the paper’s, so results agree up to Monte Carlo error.';

/** The parts both Rönkkö & Evermann cards share; beta: the path of the population. */
const ronkkoEvermannCard = (beta: number) =>
  factorCard({
    beta,
    source:
      'Rönkkö & Evermann (2013), A critical examination of common beliefs about partial least squares path modeling: the two-construct simulation',
    links: RONKKO_EVERMANN_LINKS,
    file: `ronkko2013-${beta === 0 ? 'null' : 'beta'}`,
  });

/** Henseler et al. (2014): Rönkkö & Evermann's design with one factor changed (Table 2's conditions c to f). */
const henselerCard = (
  condition: string,
  file: string,
  design: { beta: number; loadings?: number[]; four?: boolean; sampleSizes?: number[] },
) =>
  factorCard({
    ...design,
    source: `Henseler et al. (2014), Common beliefs and reality about PLS: condition ${condition} of the replication of Rönkkö & Evermann (2013)`,
    links: [...RONKKO_EVERMANN_LINKS].reverse(),
    file,
  });

/**
 * Goodhue, Lewis & Thompson (2012), Figure 1: four independent constructs Ksi1 … Ksi4 and Eta1, each with three
 * indicators (loadings .7, .8, .9); Ksi1 … Ksi4 → Eta1 = .48, .314, .114 and 0 (Cohen's f² .35, .15, .02 and none).
 * Study 2 makes the indicators skewed with Fleishman's polynomial applied to each indicator (Appendix D), which
 * also lowers their correlations; the card's other choice, Vale–Maurelli, keeps them.
 */
export const goodhuePopulation = ({ skew = 0, kurtosis = 0 } = {}) => ({
  ...(skew || kurtosis ? { nonnormal: 'fleishman' as const } : {}),
  constructs: [
    ...[1, 2, 3, 4].map((k) => ({
      name: `Ksi${k}`,
      type: 'factor',
      indicators: items('x', 3, 3 * k - 2),
      loadings: [0.7, 0.8, 0.9],
    })),
    { name: 'Eta1', type: 'factor', indicators: items('y', 3), loadings: [0.7, 0.8, 0.9] },
  ],
  paths: [0.48, 0.314, 0.114, 0].map((value, k) => ({ from: `Ksi${k + 1}`, to: 'Eta1', value })),
  exoCor: [],
  skew,
  kurtosis,
});

/** What both Goodhue et al. cards take from the paper, and what is the app's. */
const GOODHUE_DIFFERS =
  'As in the paper: the population of its Figure 1, 500 replications per sample size, PLS against regression on sum scores and ML SEM, PLS tested with 100 bootstrap samples. The app’s choices: PLS by cSEM with path weighting (the paper used PLS-Graph 3.0 and does not state its weighting scheme) and SEM by the current lavaan, where the paper used LISREL. The card tests PLS paths with the normal interval (z with the bootstrap standard error), where PLS-Graph uses t: at N = 20 and 40 this rejects a little more often, the null path Ksi4 → Eta1 included; the Type I error / power by test table has the t test as well. The paper rounds every indicator to a whole number (Appendix D), the card keeps them continuous, which makes them a little more reliable. The paper counts a LISREL run without an admissible solution as not detecting the path; the card leaves failed runs out of power and reports them, and improper solutions (a negative variance), separately. Random numbers differ from the paper’s, so results agree up to Monte Carlo error.';

const goodhueCard = (
  file: string,
  design: { sampleSizes: number[]; skew?: number; kurtosis?: number },
) => ({
  package: 'cSEM' as const,
  source: `Goodhue, Lewis & Thompson (2012), Does PLS have advantages for small sample size or non-normal data?: Study ${design.skew ? 2 : 1}`,
  links: [{ label: 'Goodhue et al. (2012)', url: 'https://doi.org/10.2307/41703490' }],
  tags: FACTOR_DEBATE_TAGS,
  data: {
    package: 'cSEM' as const,
    name: `Goodhue et al. (2012), a sample of 90${design.skew ? ' (skewed indicators)' : ''}`,
    file: `examples/montecarlo/${file}.csv`,
  },
  constructs: [
    ...[1, 2, 3, 4].map((k) => f(`Ksi${k}`, items('x', 3, 3 * k - 2))),
    f('Eta1', items('y', 3)),
  ],
  paths: [1, 2, 3, 4].map((k) => [`Ksi${k}`, 'Eta1']) as [string, string][],
  panel: {
    kind: 'mc' as const,
    population: goodhuePopulation({ skew: design.skew, kurtosis: design.kurtosis }),
    estimators: [
      { id: 'PLS', method: 'pls', consistent: false },
      { id: 'Sum scores', method: 'regression', dr: false },
      { id: 'CB-ML', method: 'cb', estimator: 'ML' },
    ],
    sampleSizes: design.sampleSizes,
    replications: 500,
    seed: 2012,
    alpha: 0.05,
    bootSamples: 100,
    mcDraws: 0,
    inference: { signChange: 'none', interval: 'normal' },
  },
  settings: {
    method: 'pls' as const,
    plsPackage: 'cSEM' as const,
    consistent: false,
    missing: 'casewise' as const,
    seed: 2012,
  },
});

/**
 * Goodhue, Lewis & Thompson (2012), Study 4 (Figure 5): three exogenous common factors, three mediators and one
 * outcome in a no-mediation, a partial-mediation and a full-mediation block, two of the nine paths zero; three
 * indicators per factor with loadings .7, .8, .9.
 */
const GOODHUE_COMPLEX_PATHS: [string, string, number][] = [
  ['Ksi1', 'Eta1', 0.328],
  ['Ksi1', 'Eta4', 0.274],
  ['Eta1', 'Eta4', 0],
  ['Ksi2', 'Eta2', 0.363],
  ['Ksi2', 'Eta4', 0.308],
  ['Eta2', 'Eta4', 0.308],
  ['Ksi3', 'Eta3', 0.393],
  ['Eta3', 'Eta4', 0.336],
  ['Ksi3', 'Eta4', 0],
];
const GOODHUE_COMPLEX_CONSTRUCTS = ['Ksi1', 'Ksi2', 'Ksi3', 'Eta1', 'Eta2', 'Eta3', 'Eta4'];

export const GOODHUE_COMPLEX_POPULATION = {
  constructs: GOODHUE_COMPLEX_CONSTRUCTS.map((name) => ({
    name,
    type: 'factor',
    indicators: items(`${name.toLowerCase()}_`, 3),
    loadings: [0.7, 0.8, 0.9],
  })),
  paths: GOODHUE_COMPLEX_PATHS.map(([from, to, value]) => ({ from, to, value })),
  exoCor: [],
  skew: 0,
  kurtosis: 0,
};

/**
 * Kock & Hadaya (2018), Experiment 2: the MBLC model (Majchrzak et al.) of six common factors with its path
 * estimates lowered by .25, the weakest .147; loadings .8 (not given in the paper).
 */
const KOCK_BLOCKS: [string, number][] = [
  ['CI', 2],
  ['CE', 6],
  ['CL', 3],
  ['CQ', 7],
  ['LO', 4],
  ['SO', 4],
];
const KOCK_PATHS: [string, string, number][] = [
  ['CI', 'CL', 0.256],
  ['CE', 'CL', 0.286],
  ['CL', 'LO', 0.147],
  ['CQ', 'LO', 0.275],
  ['CL', 'SO', 0.185],
  ['CQ', 'SO', 0.248],
];

export const KOCK_POPULATION = {
  constructs: KOCK_BLOCKS.map(([name, k]) => ({
    name,
    type: 'factor',
    indicators: items(`${name.toLowerCase()}`, k),
    loadings: Array.from({ length: k }, () => 0.8),
  })),
  paths: KOCK_PATHS.map(([from, to, value]) => ({ from, to, value })),
  exoCor: [],
  skew: 0,
  kurtosis: 0,
};

/**
 * Aguirre-Urreta, Marakas & Ellis (2013), Figure 4: X and Z (correlated .25) predict Y (.48, .28); X's loadings
 * equal, Z's spread around the same mean (thirds at ± .15), Y's .7; three indicators each.
 */
export const aguirre2013Population = (x: number) => ({
  constructs: [
    { name: 'X', type: 'factor', indicators: items('x', 3), loadings: [x, x, x] },
    { name: 'Z', type: 'factor', indicators: items('z', 3), loadings: [x - 0.15, x, x + 0.15] },
    { name: 'Y', type: 'factor', indicators: items('y', 3), loadings: [0.7, 0.7, 0.7] },
  ],
  paths: [
    { from: 'X', to: 'Y', value: 0.48 },
    { from: 'Z', to: 'Y', value: 0.28 },
  ],
  exoCor: [{ a: 'X', b: 'Z', value: 0.25 }],
  skew: 0,
  kurtosis: 0,
});

const aguirre2013Card = (file: string, x: number) => ({
  package: 'cSEM' as const,
  source:
    'Aguirre-Urreta, Marakas & Ellis (2013), Measurement of composite reliability in research using partial least squares: the simulation',
  links: [
    { label: 'Aguirre-Urreta et al. (2013)', url: 'https://doi.org/10.1145/2544415.2544417' },
  ],
  tags: FACTOR_DEBATE_TAGS,
  data: {
    package: 'cSEM' as const,
    name: `Aguirre-Urreta et al. (2013), a sample of 300 (loadings around ${x})`,
    file: `examples/montecarlo/${file}.csv`,
  },
  constructs: [f('X', items('x', 3)), f('Z', items('z', 3)), f('Y', items('y', 3))],
  paths: [
    ['X', 'Y'],
    ['Z', 'Y'],
  ] as [string, string][],
  correlations: [['X', 'Z', 'construct']] as [string, string, 'construct'][],
  panel: {
    kind: 'mc' as const,
    population: aguirre2013Population(x),
    estimators: [{ id: 'PLS', method: 'pls', consistent: false }],
    sampleSizes: [100, 300, 500],
    replications: 1000,
    seed: 2013,
    alpha: 0.05,
    bootSamples: 0,
    mcDraws: 0,
  },
  settings: {
    method: 'pls' as const,
    plsPackage: 'cSEM' as const,
    consistent: false,
    scheme: 'path' as const,
    missing: 'casewise' as const,
    seed: 2013,
  },
});

/** What the Aguirre-Urreta et al. cards take from the paper, and what is the app's. */
const AGUIRRE2013_DIFFERS =
  'As in the paper: the population (Figure 4) with three indicators per construct, N = 100, 300 and 500, 1,000 replications, PLS mode A, its composite reliability ρc from the PLS loadings, and the true reliability of each sample’s PLS-weighted composite (the paper’s Calc. CR; the card’s reliability row, (w′λ)² / w′Σw in the population). The app’s choices: cSEM with path weighting where the paper used PLS-Graph; the paper’s remedy, Raykov’s CFA-based reliability with the PLS weights (its ML CR), is not computed; its 6, 9 and 12 indicators are not part of the cards. The ρc row’s failing share is the share below .70; the paper’s decision error is the share of samples where ρc passes .70 while the true reliability does not. Random numbers differ from the paper’s, so results agree up to Monte Carlo error.';

/** Wolf et al. (2013): three standardized populations of their sample-size study (equal loadings, normal data). */
export const WOLF_CFA_POPULATION = {
  constructs: ['F1', 'F2'].map((name, j) => ({
    name,
    type: 'factor',
    indicators: items('x', 3, 3 * j + 1),
    loadings: [0.5, 0.5, 0.5],
  })),
  paths: [],
  exoCor: [{ a: 'F1', b: 'F2', value: 0.3 }],
  skew: 0,
  kurtosis: 0,
};

/** The latent mediation model: F1 → F2 → F3 and F1 → F3, all paths `beta`, three indicators of loading .65. */
export const wolfMediationPopulation = (beta: number, perFactor = 3, loading = 0.65) => ({
  constructs: ['F1', 'F2', 'F3'].map((name, j) => ({
    name,
    type: 'factor',
    indicators: items('x', perFactor, perFactor * j + 1),
    loadings: Array.from({ length: perFactor }, () => loading),
  })),
  paths: [
    { from: 'F1', to: 'F2', value: beta },
    { from: 'F2', to: 'F3', value: beta },
    { from: 'F1', to: 'F3', value: beta },
  ],
  exoCor: [],
  skew: 0,
  kurtosis: 0,
});

const WOLF_DIFFERS =
  'As in the paper: the population, normal data, ML estimation and its Wald tests (Mplus’s), and the criteria power ≥ .80 for the weakest parameter of interest, bias ≤ 5% and no estimation errors. The app’s choices: lavaan where the paper used Mplus 5.2; 1,000 replications per N where the paper used 10,000, so the power rows carry a Monte Carlo SE of about .013; the card runs a few N around the paper’s minimum instead of searching for it. Random numbers differ from the paper’s.';

const wolfCard = (
  file: string,
  population: object,
  constructs: ReturnType<typeof f>[],
  paths: [string, string][],
  sampleSizes: number[],
  mcDraws = 0,
) => ({
  package: 'lavaan' as const,
  source:
    'Wolf, Harrington, Clark & Miller (2013), Sample size requirements for structural equation models',
  links: [
    { label: 'Wolf et al. (2013)', url: 'https://doi.org/10.1177/0013164413495237' },
    { label: 'Author manuscript (PMC)', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC4334479/' },
  ],
  data: {
    package: 'lavaan' as const,
    name: 'Wolf et al. (2013), a sample of 200',
    file: `examples/montecarlo/${file}.csv`,
  },
  constructs,
  paths,
  panel: {
    kind: 'mc' as const,
    population,
    estimators: [{ id: 'CB-ML', method: 'cb', estimator: 'ML' }],
    sampleSizes,
    replications: 1000,
    seed: 53487,
    alpha: 0.05,
    bootSamples: 0,
    mcDraws,
  },
  settings: CB('ML'),
});

/**
 * Curran, West & Finch (1996): three factors (correlated .3) of three indicators with loadings .7; `cross`: the
 * two cross-loadings of .35 (x6 on F3, x7 on F2) the estimated model leaves out (their population B), whose
 * indicators keep uniqueness .51 and so have variance 1.27: standardised, .621 and .311.
 */
const CURRAN_B = [0.6213, 0.3106];

export const curranPopulation = (skew: number, kurtosis: number, cross = false) => ({
  constructs: ['F1', 'F2', 'F3'].map((name, j) => ({
    name,
    type: 'factor',
    indicators: items('x', 3, 3 * j + 1),
    loadings:
      !cross || j === 0
        ? [0.7, 0.7, 0.7]
        : j === 1
          ? [0.7, 0.7, CURRAN_B[0]]
          : [CURRAN_B[0], 0.7, 0.7],
  })),
  paths: [],
  exoCor: [
    { a: 'F1', b: 'F2', value: 0.3 },
    { a: 'F1', b: 'F3', value: 0.3 },
    { a: 'F2', b: 'F3', value: 0.3 },
  ],
  ...(cross
    ? {
        crossLoadings: [
          { indicator: 'x6', construct: 'F3', value: CURRAN_B[1] },
          { indicator: 'x7', construct: 'F2', value: CURRAN_B[1] },
        ],
      }
    : {}),
  skew,
  kurtosis,
});

const CURRAN_DIFFERS =
  'As in the paper: the population (Figure 1), N = 100, 200, 500 and 1,000, 200 replications, ML’s χ² test and the Satorra–Bentler scaled χ² (lavaan’s MLM), non-normal indicators by Fleishman’s polynomials with Vale & Maurelli’s intermediate correlations, as in EQS. The app’s choices: lavaan where the paper used EQS 3.0; population B standardised (the paper’s x6 and x7 keep uniqueness .51 and have variance 1.27; scaled to 1 their loadings are .621 and .311, the same correlations, so the same ML fit); the ADF χ² is not computed; improper solutions are kept where the paper dropped them. Random numbers differ from the paper’s, so results agree up to Monte Carlo error.';

const curranCard = (file: string, skew: number, kurtosis: number, cross = false) => ({
  package: 'lavaan' as const,
  source:
    'Curran, West & Finch (1996), The robustness of test statistics to nonnormality and specification error in confirmatory factor analysis',
  links: [{ label: 'Curran et al. (1996)', url: 'https://doi.org/10.1037/1082-989X.1.1.16' }],
  data: {
    package: 'lavaan' as const,
    name: `Curran et al. (1996), a sample of 200${skew ? ` (skew ${skew}, kurtosis ${kurtosis})` : ''}`,
    file: `examples/montecarlo/${file}.csv`,
  },
  constructs: ['F1', 'F2', 'F3'].map((name, j) => f(name, items('x', 3, 3 * j + 1))),
  paths: [] as [string, string][],
  correlations: [
    ['F1', 'F2', 'construct'],
    ['F1', 'F3', 'construct'],
    ['F2', 'F3', 'construct'],
  ] as [string, string, 'construct'][],
  panel: {
    kind: 'mc' as const,
    population: curranPopulation(skew, kurtosis, cross),
    estimators: [
      { id: 'CB-ML', method: 'cb', estimator: 'ML' },
      { id: 'CB-MLM', method: 'cb', estimator: 'MLM' },
    ],
    sampleSizes: [100, 200, 500, 1000],
    replications: 200,
    seed: 1996,
    alpha: 0.05,
    bootSamples: 0,
    mcDraws: 0,
  },
  settings: CB('ML'),
});

/**
 * Hu & Bentler (1999): three factors of five indicators (loadings .7, .7, .75, .8, .8), correlated .5, .4, .3;
 * `complex`: x1 also loads .7 on F3, which the estimated model leaves out (their Complex Misspecified I). x1
 * keeps uniqueness .51 and so has variance 1.88: standardised, both its loadings are .51.
 */
const HU_BENTLER_X1 = 0.5103;

export const huBentlerPopulation = (complex: boolean) => ({
  constructs: ['F1', 'F2', 'F3'].map((name, j) => ({
    name,
    type: 'factor',
    indicators: items('x', 5, 5 * j + 1),
    loadings: [complex && j === 0 ? HU_BENTLER_X1 : 0.7, 0.7, 0.75, 0.8, 0.8],
  })),
  paths: [],
  exoCor: [
    { a: 'F1', b: 'F2', value: 0.5 },
    { a: 'F1', b: 'F3', value: 0.4 },
    { a: 'F2', b: 'F3', value: 0.3 },
  ],
  ...(complex
    ? { crossLoadings: [{ indicator: 'x1', construct: 'F3', value: HU_BENTLER_X1 }] }
    : {}),
  skew: 0,
  kurtosis: 0,
});

const HU_BENTLER_DIFFERS =
  'As in the paper: the population, N = 150, 250, 500 and 1,000, 200 replications, ML, and the cutoffs SRMR .08, RMSEA .06, CFI and TLI .95 (Hu & Bentler’s recommendations). The app’s choices: lavaan where the paper used EQS; normal data only (the paper pools seven distributions, which matters little for SRMR and most for the χ²-based indices); x1 standardised (in the paper it keeps uniqueness .51 and has variance 1.88; scaled to 1 both its loadings are .51, the same correlations, so the same ML fit); its estimated complex model frees the other two cross-loadings, which here are not in the population; its N = 2,500 and 5,000 are not run. The paper pools its rows over N ≤ 250, 500 and N ≥ 1,000; the card gives each N. Random numbers differ from the paper’s, so results agree up to Monte Carlo error.';

const huBentlerCard = (file: string, complex: boolean) => ({
  package: 'lavaan' as const,
  source:
    'Hu & Bentler (1999), Cutoff criteria for fit indexes in covariance structure analysis: conventional criteria versus new alternatives',
  links: [{ label: 'Hu & Bentler (1999)', url: 'https://doi.org/10.1080/10705519909540118' }],
  data: {
    package: 'lavaan' as const,
    name: `Hu & Bentler (1999), a sample of 250${complex ? ' (one cross-loading)' : ''}`,
    file: `examples/montecarlo/${file}.csv`,
  },
  constructs: ['F1', 'F2', 'F3'].map((name, j) => f(name, items('x', 5, 5 * j + 1))),
  paths: [] as [string, string][],
  correlations: [
    ['F1', 'F2', 'construct'],
    ['F1', 'F3', 'construct'],
    ['F2', 'F3', 'construct'],
  ] as [string, string, 'construct'][],
  panel: {
    kind: 'mc' as const,
    population: huBentlerPopulation(complex),
    estimators: [{ id: 'CB-ML', method: 'cb', estimator: 'ML' }],
    sampleSizes: [150, 250, 500, 1000],
    replications: 200,
    seed: 1999,
    alpha: 0.05,
    bootSamples: 0,
    mcDraws: 0,
  },
  settings: CB('ML'),
});

/**
 * The bootstrap SE of PLS at small samples (PLS Studio's own check): A and B (uncorrelated) → C (.2, .3), three
 * indicators each loading .7, .8 and .9.
 */
const BOOT_SE_POPULATION = {
  constructs: ['A', 'B', 'C'].map((name) => ({
    name,
    type: 'factor',
    indicators: items(name.toLowerCase(), 3),
    loadings: [0.7, 0.8, 0.9],
  })),
  paths: [
    { from: 'A', to: 'C', value: 0.2 },
    { from: 'B', to: 'C', value: 0.3 },
  ],
  exoCor: [{ a: 'A', b: 'B', value: 0 }],
  skew: 0,
  kurtosis: 0,
} as const;

/**
 * Aguirre-Urreta & Rönkkö (2018), the simple model: K1, K2, K3 → E1 (γ each) and K4 → E1 (0), three indicators
 * per construct loading .7, .8 and .9 (their mixed condition). With the exogenous factors correlated .3 the
 * paths are rescaled by one factor (.48 → .3795, the paper's rounding) so that R² stays 3 · .48² = .6912;
 * other correlations r rescale them to √(.6912 / (3 + 6r)).
 */
export const aguirre2018Population = (exogCor: number) => {
  const gamma = exogCor === 0.3 ? 0.3795 : Math.sqrt((3 * 0.48 ** 2) / (3 + 6 * exogCor));
  const exogenous = ['K1', 'K2', 'K3', 'K4'];
  return {
    constructs: [...exogenous, 'E1'].map((name) => ({
      name,
      type: 'factor',
      indicators: items(`${name.toLowerCase()}_`, 3),
      loadings: [0.7, 0.8, 0.9],
    })),
    paths: exogenous.map((from, i) => ({ from, to: 'E1', value: i < 3 ? gamma : 0 })),
    exoCor: exogenous.flatMap((a, i) =>
      exogenous.slice(i + 1).map((b) => ({ a, b, value: exogCor })),
    ),
    skew: 0,
    kurtosis: 0,
  };
};

/** What the Aguirre-Urreta & Rönkkö cards take from the paper, and what is the app's. */
const AGUIRRE2018_DIFFERS =
  'As in the paper: the simple model with strong paths (.48, or .3795 with correlated predictors) and a zero path, normal data, PLS and PLSc (mode A, path weighting, consistent loadings) estimated on the same weights, no sign-change correction, and 95% bootstrap intervals checked against the population value. The app’s choices: cSEM where the paper used matrixpls; three indicators loading .7, .8 and .9 (one of the paper’s 12 measurement conditions, over which its appendix figures pool); N = 50, 250 and 1,000 of its five; 500 replications where it used 1,000; 1,000 bootstrap samples where it used 10,000; the plain bias-corrected interval (BC) and the non-normal condition are not run. Each card checks one interval, for PLS and PLSc. Random numbers differ from the paper’s, so results agree up to Monte Carlo error.';

const aguirre2018Card = (
  exogCor: number,
  interval: 'percentile' | 'bca' | 'normal',
  sampleSizes = [50, 250, 1000],
) => ({
  package: 'cSEM' as const,
  source:
    'Aguirre-Urreta & Rönkkö (2018), Statistical inference with PLSc using bootstrap confidence intervals: the simple model',
  links: [
    { label: 'Aguirre-Urreta & Rönkkö (2018)', url: 'https://doi.org/10.25300/MISQ/2018/13587' },
  ],
  tags: FACTOR_DEBATE_TAGS,
  data: {
    package: 'cSEM' as const,
    name: `Aguirre-Urreta & Rönkkö (2018), a sample of 250 (${exogCor ? 'predictors correlated .3' : 'uncorrelated predictors'})`,
    file: `examples/montecarlo/aguirre2018-${exogCor ? 'correlated' : 'uncorrelated'}.csv`,
  },
  constructs: ['K1', 'K2', 'K3', 'K4', 'E1'].map((name) =>
    f(name, items(`${name.toLowerCase()}_`, 3)),
  ),
  paths: ['K1', 'K2', 'K3', 'K4'].map((from): [string, string] => [from, 'E1']),
  ...(exogCor
    ? {
        correlations: ['K1', 'K2', 'K3', 'K4'].flatMap((a, i, all) =>
          all.slice(i + 1).map((b): [string, string, 'construct'] => [a, b, 'construct']),
        ),
      }
    : {}),
  panel: {
    kind: 'mc' as const,
    population: aguirre2018Population(exogCor),
    estimators: [
      { id: 'PLS', method: 'pls', consistent: false },
      { id: 'PLSc', method: 'pls', consistent: true },
    ],
    sampleSizes,
    replications: 500,
    seed: 2018,
    alpha: 0.05,
    bootSamples: 1000,
    mcDraws: 0,
    inference: { signChange: 'none', interval },
  },
  settings: {
    method: 'pls' as const,
    plsPackage: 'cSEM' as const,
    consistent: true,
    scheme: 'path' as const,
    missing: 'casewise' as const,
    seed: 2018,
  },
});

/**
 * Chin, Marcolin & Newsted (2003): Y = .3 X + .5 Z + .3 X·Z + ζ, X and Z uncorrelated common factors (the paper
 * gives no correlation), k indicators per construct with loadings .7, or `xz` on X and Z (Table 10's patterns).
 */
export const chinPopulation = (k: number, xz: number[] = Array.from({ length: k }, () => 0.7)) => ({
  constructs: [
    { name: 'X', type: 'factor', indicators: items('x', k), loadings: xz },
    { name: 'Z', type: 'factor', indicators: items('z', k), loadings: xz },
    {
      name: 'Y',
      type: 'factor',
      indicators: items('y', k),
      loadings: Array.from({ length: k }, () => 0.7),
    },
  ],
  paths: [
    { from: 'X', to: 'Y', value: 0.3 },
    { from: 'Z', to: 'Y', value: 0.5 },
  ],
  exoCor: [],
  interactions: [{ a: 'X', b: 'Z', to: 'Y', value: 0.3 }],
  skew: 0,
  kurtosis: 0,
});

/** What the Chin et al. cards take from the paper, and what is the app's. */
const CHIN_DIFFERS =
  'As in the paper: the population (Figure 2: standardised paths .3, .5 and .3 for the interaction, normal data, scores drawn first and indicators from them), loadings .7, 500 replications, PLS with every product of a standardised indicator of X with one of Z as the indicators of X·Z, and regression on the product of the summed scores (Table 9). The app’s choices: cSEM with path weighting where the paper used PLS-Graph 3.0 (its weighting scheme is not stated); X and Z uncorrelated (the paper does not say); sum scores standardised before their product. The paper calls a cell significant when the mean of its 500 estimates divided by their SD passes the one-tailed t (1.66 or 2.36 on 499 df), not by testing each sample; the card runs no bootstrap, so its PLS rows have no power, and the regression rows’ power is the OLS t test in each sample. Random numbers differ from the paper’s, so results agree up to Monte Carlo error.';

const chinCard = (file: string, k: number, sizes: number[], xz?: number[]) => ({
  package: 'seminr' as const,
  source:
    'Chin, Marcolin & Newsted (2003), A partial least squares latent variable modeling approach for measuring interaction effects: the Monte Carlo study',
  links: [{ label: 'Chin et al. (2003)', url: 'https://doi.org/10.1287/isre.14.2.189.16018' }],
  tags: FACTOR_DEBATE_TAGS,
  data: {
    package: 'seminr' as const,
    name: `Chin et al. (2003), a sample of 100 (${k} indicators per construct)`,
    file: `examples/montecarlo/${file}.csv`,
  },
  constructs: [f('X', items('x', k)), f('Z', items('z', k)), f('Y', items('y', k))],
  paths: [
    ['X', 'Y'],
    ['Z', 'Y'],
  ] as [string, string][],
  moderations: [['X', 'Z', 'Y', 'product_indicator']] as [
    string,
    string,
    string,
    'product_indicator',
  ][],
  panel: {
    kind: 'mc' as const,
    population: chinPopulation(k, xz),
    estimators: [
      { id: 'PLS', method: 'pls', consistent: false },
      { id: 'Sum scores', method: 'regression', dr: false },
    ],
    sampleSizes: sizes,
    replications: 500,
    seed: 2003,
    alpha: 0.05,
    bootSamples: 0,
    mcDraws: 0,
  },
  settings: SEMINR(),
});

/** Qureshi & Compeau (2009), Figure 1: the baseline group's paths A → C, B → C, A → D, C → D. */
const QURESHI_BASELINE = [0.05, 0.2, 0.35, 0.6];

/**
 * Qureshi & Compeau's population: A and B (correlated r) predict C, A and C predict D, k indicators per construct
 * loading .7, .8, .9 (repeated); `paths` the group's four path values.
 */
export const qureshiPopulation = (r: number, k: number, paths = QURESHI_BASELINE) => ({
  constructs: ['A', 'B', 'C', 'D'].map((name) => ({
    name,
    type: 'factor',
    indicators: items(name.toLowerCase(), k),
    loadings: Array.from({ length: k }, (_, i) => [0.7, 0.8, 0.9][i % 3]),
  })),
  paths: [
    ['A', 'C'],
    ['B', 'C'],
    ['A', 'D'],
    ['C', 'D'],
  ].map(([from, to], i) => ({ from, to, value: paths[i] })),
  exoCor: [{ a: 'A', b: 'B', value: r }],
  skew: 0,
  kurtosis: 0,
});

/** What the Qureshi & Compeau cards take from the paper, and what is the app's. */
const QURESHI_DIFFERS =
  'As in the paper: the population (Figure 1) with its baseline and comparison paths, invariant measurement (loadings .7, .8, .9), normal data, equal groups of n = 100 and 500, 500 replications, PLS per group with the pooled-SE t test of each path’s difference (Chin 2000), and ML multigroup SEM with a 1-df χ² difference test per path. The app’s choices: cSEM and lavaan where the paper used PLS-Graph 3.0 and AMOS 7.0; 200 bootstrap samples for the PLS standard errors (the paper does not say how many); the CB-SEM model holds the loadings equal across groups (the paper does not say whether AMOS did); each group drawn on its own instead of the paper’s Mplus samples screened for invariance; the non-normal mixtures are not run. The paper pools its detection rate over the four paths; the card gives each path. Random numbers differ from the paper’s, so results agree up to Monte Carlo error.';

const qureshiCard = (file: string, r: number, k: number, comparison: number[]) => ({
  package: 'lavaan' as const,
  source:
    'Qureshi & Compeau (2009), Assessing between-group differences in information systems research: a comparison of covariance- and component-based SEM',
  links: [{ label: 'Qureshi & Compeau (2009)', url: 'https://doi.org/10.2307/20650285' }],
  tags: FACTOR_DEBATE_TAGS,
  data: {
    package: 'lavaan' as const,
    name: `Qureshi & Compeau (2009), two groups of 250 (${k} indicators, r = ${r})`,
    file: `examples/montecarlo/${file}.csv`,
  },
  constructs: ['A', 'B', 'C', 'D'].map((name) => f(name, items(name.toLowerCase(), k))),
  paths: [
    ['A', 'C'],
    ['B', 'C'],
    ['A', 'D'],
    ['C', 'D'],
  ] as [string, string][],
  multigroup: { column: 'group', invariance: 'metric' as const, free: [] },
  panel: {
    kind: 'mc' as const,
    population: qureshiPopulation(r, k),
    groups: {
      paths: qureshiPopulation(r, k, comparison).paths.map(({ from, to, value }) => ({
        from,
        to,
        value,
      })),
    },
    estimators: [
      { id: 'PLS', method: 'pls', consistent: false },
      { id: 'CB-ML', method: 'cb', estimator: 'ML' },
    ],
    sampleSizes: [100, 500],
    replications: 500,
    seed: 2009,
    alpha: 0.05,
    bootSamples: 200,
    mcDraws: 0,
  },
  settings: CB('ML'),
});

/**
 * Henseler, Ringle & Sarstedt (2015), the main simulation: two common factors with three indicators each, the
 * same loadings in both, correlated φ (1: one factor split in two, which every check should flag), no path.
 */
export const henseler2015Population = (loadings: number[], phi: number) => ({
  constructs: ['A', 'B'].map((name) => ({
    name,
    type: 'factor',
    indicators: items(name.toLowerCase(), 3),
    loadings,
  })),
  paths: [],
  exoCor: [{ a: 'A', b: 'B', value: phi }],
  skew: 0,
  kurtosis: 0,
});

/** What the Henseler et al. (2015) cards take from the paper, and what is the app's. */
const HENSELER_2015_DIFFERS =
  'As in the paper: two common factors with three indicators each and no path, N = 100, 250, 500 and 1,000, 1,000 replications, PLS mode A (semPLS, whose default centroid weighting the card uses; with two constructs every scheme gives the same weights), and the checks: Fornell–Larcker on PLS’s loadings and construct correlation, the cross-loadings, HTMT against .85 and .90, and HTMT inference, which flags a pair when the upper bound of HTMT’s 90% normal bootstrap interval reaches 1. The app’s choices: PLS by cSEM; 500 bootstrap samples for HTMT inference (the paper does not say how many); the partial cross-loadings, whose test the paper does not describe, are not computed. Random numbers differ from the paper’s, so results agree up to Monte Carlo error. The paper reports specificity (the share not flagged); the card’s rows give the share failing each check.';

const henseler2015Card = (file: string, loadings: number[], phi: number) => ({
  package: 'cSEM' as const,
  source:
    'Henseler, Ringle & Sarstedt (2015), A new criterion for assessing discriminant validity in variance-based structural equation modeling: the Monte Carlo study',
  links: [
    {
      label: 'Henseler, Ringle & Sarstedt (2015)',
      url: 'https://doi.org/10.1007/s11747-014-0403-8',
    },
  ],
  tags: FACTOR_DEBATE_TAGS,
  data: {
    package: 'cSEM' as const,
    name: `Henseler et al. (2015), a sample of 250 (φ = ${phi})`,
    file: `examples/montecarlo/${file}.csv`,
  },
  constructs: [f('A', items('a', 3)), f('B', items('b', 3))],
  paths: [] as [string, string][],
  panel: {
    kind: 'mc' as const,
    population: henseler2015Population(loadings, phi),
    estimators: [
      {
        id: 'PLS mode A, centroid',
        method: 'pls',
        consistent: false,
        mode: 'A',
        scheme: 'centroid',
      },
    ],
    sampleSizes: [100, 250, 500, 1000],
    replications: 1000,
    seed: 2015,
    alpha: 0.05,
    bootSamples: 500,
    mcDraws: 0,
  },
  settings: {
    method: 'pls' as const,
    plsPackage: 'cSEM' as const,
    consistent: false,
    scheme: 'centroid' as const,
    missing: 'casewise' as const,
    seed: 2015,
  },
});

/**
 * Rönkkö & Cho (2022), the simulation's population (after Voorhees et al. 2016): three common factors with three
 * indicators each and the same loadings, factor variances 1; discriminant validity is assessed between F1 and F2,
 * correlated φ, and F3 correlates .5 with both.
 */
export const ronkkoChoPopulation = (phi: number, loadings: number[], perFactor = 3) => ({
  constructs: ['F1', 'F2', 'F3'].map((name, k) => ({
    name,
    type: 'factor',
    indicators: items('x', perFactor, perFactor * k + 1),
    // (6 or 9 items repeat the three-loading pattern, as in the paper)
    loadings: Array.from({ length: perFactor }, (_, i) => loadings[i % loadings.length]),
  })),
  paths: [],
  exoCor: [
    { a: 'F1', b: 'F2', value: phi },
    { a: 'F1', b: 'F3', value: 0.5 },
    { a: 'F2', b: 'F3', value: 0.5 },
  ],
  skew: 0,
  kurtosis: 0,
});

/** What the Rönkkö & Cho cards take from the paper, and what is the app's. */
const RONKKO_CHO_DIFFERS =
  'As in the paper: the population (three items per factor; the paper’s Tables 8 and 9 average over 3, 6 and 9), N = 50, 100, 250 and 1,000, 1,000 replications, CFA by ML (lavaan) with the factor correlation’s 95% Wald interval (delta method, the same as with factor variances fixed at 1), χ²(1) against the model with the correlation fixed at 1, AVE/SV_CFA (Fornell–Larcker with the CFA’s loadings and correlation) and HTMT, which the paper shows to be the correlation of sum scores disattenuated by standardised alpha (its r_DPR). The app’s choices: HTMT inference is Henseler et al.’s upper bound of a 90% normal bootstrap interval from 500 samples, where the paper’s CI_DPR is a 95% percentile interval from 1,000; the CFI(1), χ²(merge) and omega-disattenuated (r_DCR) techniques and the cutoff .95 are not computed. A check flags the pair when its value fails the cutoff (the paper’s detection rate). Random numbers differ from the paper’s, so results agree up to Monte Carlo error.';

const RONKKO_CHO_RUN =
  'The card simulates 1,000 samples at N = 50, 100, 250 and 1,000, each fitted by ML (lavaan) with every measurement check of CB-SEM and 500 bootstrap samples for HTMT inference.';

const ronkkoChoCard = (file: string, phi: number, loadings: number[], perFactor = 3) => ({
  package: 'lavaan' as const,
  source:
    'Rönkkö & Cho (2022), An updated guideline for assessing discriminant validity: the Monte Carlo simulation',
  links: [{ label: 'Rönkkö & Cho (2022)', url: 'https://doi.org/10.1177/1094428120968614' }],
  tags: FACTOR_DEBATE_TAGS,
  data: {
    package: 'lavaan' as const,
    name: `Rönkkö & Cho (2022), a sample of 250 (φ = ${phi})`,
    file: `examples/montecarlo/${file}.csv`,
  },
  constructs: ['F1', 'F2', 'F3'].map((name, k) =>
    f(name, items('x', perFactor, perFactor * k + 1)),
  ),
  paths: [] as [string, string][],
  correlations: [
    ['F1', 'F2', 'construct'],
    ['F1', 'F3', 'construct'],
    ['F2', 'F3', 'construct'],
  ] as [string, string, 'construct'][],
  panel: {
    kind: 'mc' as const,
    population: ronkkoChoPopulation(phi, loadings, perFactor),
    estimators: [{ id: 'CB-ML', method: 'cb', estimator: 'ML' }],
    sampleSizes: [50, 100, 250, 1000],
    replications: 1000,
    seed: 2022,
    alpha: 0.05,
    bootSamples: 500,
    mcDraws: 0,
    cbChecks: true,
  },
  settings: CB('ML'),
});

/**
 * Franke & Sarstedt (2019): two common factors X and Y of three parallel items each (loadings .71, or .85 for X
 * and .71 for Y), correlated φ.
 */
export const frankeSarstedtPopulation = (phi: number, lx: number, ly: number) => ({
  constructs: [
    { name: 'X', type: 'factor', indicators: items('x', 3), loadings: [lx, lx, lx] },
    { name: 'Y', type: 'factor', indicators: items('y', 3), loadings: [ly, ly, ly] },
  ],
  paths: [],
  exoCor: [{ a: 'X', b: 'Y', value: phi }],
  skew: 0,
  kurtosis: 0,
});

/** What the Franke & Sarstedt cards take from the paper, and what is the app's. */
const FRANKE_SARSTEDT_DIFFERS =
  'As in the paper: the population (three items per construct; the paper also has five), N = 100 and 500, 1,000 replications, CFA by ML with the factor correlation’s delta-method interval, and α = .10, so the interval is 90% and each test one-tailed at 5%: PHI(c) concludes discriminant validity when the upper bound lies below c. The card’s rows give the share failing each check, which is 1 minus the paper’s share indicating discriminant validity. The app’s choices: lavaan where the paper used Mplus; HTMT is compared by its point estimate (the paper’s Table II heuristic), its delta-method interval and McDonald’s criterion (MCD) are not computed; Fornell–Larcker is the margin √AVE − φ, which decides as AVE − φ² does. Random numbers differ from the paper’s, so results agree up to Monte Carlo error.';

const FRANKE_SARSTEDT_RUN =
  'The card simulates 1,000 samples at N = 100 and 500, each fitted by ML (lavaan) with every measurement check of CB-SEM.';

const frankeSarstedtCard = (file: string, phi: number, lx: number, ly: number) => ({
  package: 'lavaan' as const,
  source:
    'Franke & Sarstedt (2019), Heuristics versus statistics in discriminant validity testing: a comparison of four procedures, the simulation',
  links: [{ label: 'Franke & Sarstedt (2019)', url: 'https://doi.org/10.1108/IntR-12-2017-0515' }],
  tags: FACTOR_DEBATE_TAGS,
  data: {
    package: 'lavaan' as const,
    name: `Franke & Sarstedt (2019), a sample of 500 (φ = ${phi})`,
    file: `examples/montecarlo/${file}.csv`,
  },
  constructs: [f('X', items('x', 3)), f('Y', items('y', 3))],
  paths: [] as [string, string][],
  correlations: [['X', 'Y', 'construct']] as [string, string, 'construct'][],
  panel: {
    kind: 'mc' as const,
    population: frankeSarstedtPopulation(phi, lx, ly),
    estimators: [{ id: 'CB-ML', method: 'cb', estimator: 'ML' }],
    sampleSizes: [100, 500],
    replications: 1000,
    seed: 2019,
    alpha: 0.1,
    bootSamples: 0,
    mcDraws: 0,
    cbChecks: true,
  },
  settings: CB('ML'),
});

/** Composite population: the other side of the debate the factor population cards take. */
const COMPOSITE_POPULATION =
  ' The population is made of composites, the view of measurement behind PLS: each construct is a weighted sum of its indicators, without measurement error, and the indicators correlate freely within a block. CB-SEM and PLSc estimate such data as common factors, which they are not; with a population of common factors the comparison turns around (Rönkkö & Evermann 2013), and no test of the data can say which of the two holds.';
const COMPOSITE_DEBATE_TAGS = ['PLS debate', 'Composite population'];

/** Sarstedt et al. (2016): Reinartz et al.'s (2009) model of seven constructs, Y5 added with two null paths. */
const SARSTEDT_PATHS: [string, string, number][] = [
  ['Y1', 'Y2', 0.5],
  ['Y1', 'Y3', 0.15],
  ['Y1', 'Y4', 0.15],
  ['Y2', 'Y3', 0.5],
  ['Y2', 'Y4', 0.5],
  ['Y3', 'Y4', 0.3],
  ['Y5', 'Y2', 0],
  ['Y5', 'Y4', 0],
  ['Y4', 'Y6', 0.5],
  ['Y4', 'Y7', 0.5],
  ['Y5', 'Y7', 0.5],
  ['Y7', 'Y6', 0.15],
];

const SARSTEDT_CONSTRUCTS = ['Y1', 'Y2', 'Y3', 'Y4', 'Y5', 'Y6', 'Y7'];

/**
 * Sarstedt et al.'s population: every construct a common factor with `values` as loadings, or a composite with
 * `values` as weights and `withinCor` the correlation of its indicators (not given in the paper: the value that
 * gives the composite unit variance with equal correlations).
 */
export const sarstedtPopulation = (values: number[], withinCor?: number) => ({
  constructs: SARSTEDT_CONSTRUCTS.map((name) => ({
    name,
    type: withinCor === undefined ? 'factor' : 'composite',
    indicators: items(`${name.toLowerCase()}_`, values.length),
    ...(withinCor === undefined ? { loadings: values } : { weights: values, withinCor }),
  })),
  paths: SARSTEDT_PATHS.map(([from, to, value]) => ({ from, to, value })),
  exoCor: [],
  skew: 0,
  kurtosis: 0,
});

/** What the Sarstedt et al. cards take from the paper, and what is the app's. */
const SARSTEDT_DIFFERS =
  'As in the paper: the population (Figure 2), normal data, N = 100, 250, 500, 1,000 and 10,000, 300 replications, PLS mode A with path weighting (semPLS’s default), PLSc and ML SEM, every construct estimated as a common factor. The app’s choices: cSEM for PLS and PLSc where the paper used semPLS and matrixpls, lavaan where it used sem; the paper does not give the correlation of Y1 and Y5 (here 0) or, for composites, the correlations within a block (here equal, at the value that gives the weights unit variance). The paper reports the mean absolute error over the paths (MAE); the card gives each path’s bias and RMSE, and counts replications without a solution as failed where the paper notes cells where CB-SEM converged in fewer than half. Random numbers differ from the paper’s, so results agree up to Monte Carlo error.';

const SARSTEDT_RUN =
  'The card simulates 300 samples at N = 100, 250, 500, 1,000 and 10,000, each estimated by PLS (mode A, cSEM), PLSc and ML SEM (lavaan).';

const sarstedtCard = (file: string, values: number[], withinCor?: number) => {
  const composite = withinCor !== undefined;
  const block = (name: string) => items(`${name.toLowerCase()}_`, values.length);
  return {
    package: 'cSEM' as const,
    source:
      'Sarstedt, Hair, Ringle, Thiele & Gudergan (2016), Estimation issues with PLS and CBSEM: where the bias lies!, the simulation',
    links: [
      { label: 'Sarstedt et al. (2016)', url: 'https://doi.org/10.1016/j.jbusres.2016.06.007' },
    ],
    tags: composite ? COMPOSITE_DEBATE_TAGS : FACTOR_DEBATE_TAGS,
    data: {
      package: 'cSEM' as const,
      name: `Sarstedt et al. (2016), a sample of 250 (${composite ? 'composites' : 'common factors'})`,
      file: `examples/montecarlo/${file}.csv`,
    },
    constructs: SARSTEDT_CONSTRUCTS.map((name) =>
      composite ? c(name, block(name), 'A') : f(name, block(name)),
    ),
    paths: SARSTEDT_PATHS.map(([from, to]): [string, string] => [from, to]),
    panel: {
      kind: 'mc' as const,
      population: sarstedtPopulation(values, withinCor),
      estimators: [
        { id: 'PLS', method: 'pls', consistent: false },
        { id: 'PLSc', method: 'pls', consistent: true },
        { id: 'CB-ML', method: 'cb', estimator: 'ML' },
      ],
      sampleSizes: [100, 250, 500, 1000, 10000],
      replications: 300,
      seed: 2016,
      alpha: 0.05,
      bootSamples: 0,
      mcDraws: 0,
      ...(composite ? { factorModel: true } : {}),
    },
    settings: {
      method: 'pls' as const,
      plsPackage: 'cSEM' as const,
      consistent: false,
      scheme: 'path' as const,
      missing: 'casewise' as const,
      seed: 2016,
    },
  };
};

/** What the Hair et al. (2017) cards take from the paper, and what is the app's. */
const HAIR_MIRROR_DIFFERS =
  'As in the paper: the population (Figure 2, the composite population of Sarstedt et al. 2016, whose weights Table A1 of the online appendix gives), normal data, N = 100, 250, 500, 1,000 and 10,000, 300 replications, and the three methods. The app’s choices: cSEM for PLS and GSCA where the paper used semPLS and ASGSCA; the paper names neither PLS’s mode nor its scheme (here mode B, which estimates a composite’s weights, with path weighting) nor its test (here 200 bootstrap samples, percentile intervals, α = .05); the correlations within a block are equal, at the value that gives the weights unit variance (the paper defers to Schuberth et al. 2016). The paper pools its normal and two non-normal distributions; the card is normal only. It reports the mean absolute error of the weights and of the paths; the card gives each path’s bias, RMSE and power, not the weights. Random numbers differ from the paper’s, so results agree up to Monte Carlo error.';

const HAIR_MIRROR_RUN =
  'The card simulates 300 samples at N = 100, 250, 500, 1,000 and 10,000, each estimated by PLS (mode B, cSEM), GSCA (cSEM) and regression on sum scores, with 200 bootstrap samples for the tests of PLS and GSCA.';

const hairMirrorCard = (file: string, weights: number[], withinCor: number) => {
  const block = (name: string) => items(`${name.toLowerCase()}_`, weights.length);
  return {
    package: 'cSEM' as const,
    source:
      'Hair, Hult, Ringle, Sarstedt & Thiele (2017), Mirror, mirror on the wall: a comparative evaluation of composite-based structural equation modeling methods, the simulation',
    links: [{ label: 'Hair et al. (2017)', url: 'https://doi.org/10.1007/s11747-017-0517-x' }],
    tags: COMPOSITE_DEBATE_TAGS,
    data: {
      package: 'cSEM' as const,
      name: 'Hair et al. (2017), a sample of 250 (composites)',
      file: `examples/montecarlo/${file}.csv`,
    },
    constructs: SARSTEDT_CONSTRUCTS.map((name) => c(name, block(name))),
    paths: SARSTEDT_PATHS.map(([from, to]): [string, string] => [from, to]),
    panel: {
      kind: 'mc' as const,
      population: sarstedtPopulation(weights, withinCor),
      estimators: [
        { id: 'PLS', method: 'pls', consistent: false },
        { id: 'GSCA', method: 'pls', consistent: false, approach: 'GSCA' },
        { id: 'Sum scores', method: 'regression', dr: false },
      ],
      sampleSizes: [100, 250, 500, 1000, 10000],
      replications: 300,
      seed: 2017,
      alpha: 0.05,
      bootSamples: 200,
      mcDraws: 0,
    },
    settings: {
      method: 'pls' as const,
      plsPackage: 'cSEM' as const,
      consistent: false,
      scheme: 'path' as const,
      missing: 'casewise' as const,
      seed: 2017,
    },
  };
};

/**
 * Hwang et al. (2010), Figure 1: a chain of three common factors (.6, .6) with three indicators each (loadings
 * .7) and one cross-loading per factor (.21), which the estimated model leaves out; it adds the path η1 → η3,
 * zero in the population.
 */
export const HWANG_POPULATION = {
  constructs: [
    { name: 'E1', type: 'factor', indicators: ['z1', 'z2', 'z3'], loadings: [0.7, 0.7, 0.7] },
    { name: 'E2', type: 'factor', indicators: ['z4', 'z5', 'z6'], loadings: [0.7, 0.7, 0.7] },
    { name: 'E3', type: 'factor', indicators: ['z7', 'z8', 'z9'], loadings: [0.7, 0.7, 0.7] },
  ],
  paths: [
    { from: 'E1', to: 'E2', value: 0.6 },
    { from: 'E2', to: 'E3', value: 0.6 },
    { from: 'E1', to: 'E3', value: 0 },
  ],
  exoCor: [],
  crossLoadings: [
    { indicator: 'z4', construct: 'E1', value: 0.21 },
    { indicator: 'z7', construct: 'E2', value: 0.21 },
    { indicator: 'z6', construct: 'E3', value: 0.21 },
  ],
  skew: 0,
  kurtosis: 0,
};

/**
 * Cho, Sarstedt & Hwang (2022): the simple structural model (Cole & Preacher's Figure 3), four constructs of
 * three indicators with loadings .6, .7, .8, as components (Cho & Choi's nomological components: Table S10's
 * block, weights from its first principal component) or as common factors. The paper draws the paths at random
 * for each sample; the cards fix one draw.
 */
const CHO_BLOCK = [
  [1, 0.1225, 0.2603],
  [0.1225, 1, 0.3369],
  [0.2603, 0.3369, 1],
];

export const choPopulation = (component: boolean) => ({
  constructs: ['E1', 'E2', 'E3', 'E4'].map((name) => ({
    name,
    type: component ? 'composite' : 'factor',
    indicators: items(`${name.toLowerCase()}_`, 3),
    ...(component
      ? { weights: [0.4027, 0.4698, 0.5369], withinMatrix: CHO_BLOCK }
      : { loadings: [0.6, 0.7, 0.8] }),
  })),
  paths: [
    { from: 'E1', to: 'E3', value: 0.4 },
    { from: 'E2', to: 'E3', value: 0.3 },
    { from: 'E1', to: 'E4', value: 0.2 },
    { from: 'E3', to: 'E4', value: 0.4 },
  ],
  exoCor: [{ a: 'E1', b: 'E2', value: 0.2 }],
  skew: 0,
  kurtosis: 0,
});

/** What the Cho et al. cards take from the paper, and what is the app's. */
const CHO_DIFFERS =
  'As in the paper: the simple structural model, three indicators per construct with loadings .6, .7 and .8, the component population’s block of indicator correlations (Table S10 of the supporting information), an exogenous correlation of .2, normal data, N = 100, 200, 500 and 1,000, and PLS (path weighting, mode A and mode B), GSCA and ML SEM, every construct estimated as the method has it. The app’s choices: cSEM and lavaan where the paper used its own MATLAB code and lavaan 0.5-16; the paper draws the paths at random from ±.1 to ±.6 for every sample (1,000 draws per cell) and averages over them, the card fixes one draw (.4, .3, .2, .4) and replicates it 1,000 times; factor score regression (FSR) and the MAE of the loadings are not computed. The paper counts improper solutions as convergence problems; the card counts replications without convergence as failed and reports improper ones in the inadmissible column. Random numbers differ from the paper’s, so results agree up to Monte Carlo error.';

const CHO_RUN =
  'The card simulates 1,000 samples at N = 100, 200, 500 and 1,000, each estimated by PLS mode A and mode B (path weighting) and GSCA (cSEM), and by ML SEM (lavaan).';

const choCard = (file: string, component: boolean) => ({
  package: 'cSEM' as const,
  source:
    'Cho, Sarstedt & Hwang (2022), A comparative evaluation of factor- and component-based structural equation modelling approaches under (in)correct construct representations, the simulation',
  links: [{ label: 'Cho, Sarstedt & Hwang (2022)', url: 'https://doi.org/10.1111/bmsp.12255' }],
  tags: component ? COMPOSITE_DEBATE_TAGS : FACTOR_DEBATE_TAGS,
  data: {
    package: 'cSEM' as const,
    name: `Cho et al. (2022), a sample of 500 (${component ? 'components' : 'common factors'})`,
    file: `examples/montecarlo/${file}.csv`,
  },
  constructs: ['E1', 'E2', 'E3', 'E4'].map((name) =>
    component
      ? c(name, items(`${name.toLowerCase()}_`, 3), 'A')
      : f(name, items(`${name.toLowerCase()}_`, 3)),
  ),
  paths: [
    ['E1', 'E3'],
    ['E2', 'E3'],
    ['E1', 'E4'],
    ['E3', 'E4'],
  ] as [string, string][],
  correlations: [['E1', 'E2', 'construct']] as [string, string, 'construct'][],
  panel: {
    kind: 'mc' as const,
    population: choPopulation(component),
    estimators: [
      { id: 'PLS mode A', method: 'pls', consistent: false, mode: 'A' },
      { id: 'PLS mode B', method: 'pls', consistent: false, mode: 'B' },
      { id: 'GSCA', method: 'pls', consistent: false, approach: 'GSCA' },
      { id: 'CB-ML', method: 'cb', estimator: 'ML' },
    ],
    sampleSizes: [100, 200, 500, 1000],
    replications: 1000,
    seed: 2022,
    alpha: 0.05,
    bootSamples: 0,
    mcDraws: 0,
  },
  settings: {
    method: 'pls' as const,
    plsPackage: 'cSEM' as const,
    consistent: false,
    scheme: 'path' as const,
    missing: 'casewise' as const,
    seed: 2022,
  },
});

/**
 * Reinartz, Haenlein & Henseler (2009), Figure 1: a satisfaction-index-like chain of six common factors, one
 * exogenous (X), with strong (.5), medium (.3) and weak (.15) paths; `k` indicators per factor at `loading`.
 */
const REINARTZ_PATHS: [string, string, number][] = [
  ['X', 'E1', 0.5],
  ['X', 'E2', 0.15],
  ['X', 'E3', 0.15],
  ['E1', 'E2', 0.5],
  ['E1', 'E3', 0.5],
  ['E2', 'E3', 0.3],
  ['E3', 'E4', 0.5],
  ['E3', 'E5', 0.5],
  ['E4', 'E5', 0.15],
];
const REINARTZ_CONSTRUCTS = ['X', 'E1', 'E2', 'E3', 'E4', 'E5'];

export const reinartzPopulation = (k: number, loading: number) => ({
  constructs: REINARTZ_CONSTRUCTS.map((name) => ({
    name,
    type: 'factor',
    indicators: items(`${name.toLowerCase()}_`, k),
    loadings: Array.from({ length: k }, () => loading),
  })),
  paths: REINARTZ_PATHS.map(([from, to, value]) => ({ from, to, value })),
  exoCor: [],
  skew: 0,
  kurtosis: 0,
});

/** What the Reinartz et al. cards take from the paper, and what is the app's. */
const REINARTZ_DIFFERS =
  'As in the paper: the population (Figure 1), N = 100, 250, 500 and 1,000, ML SEM with its z tests and PLS mode A tested by the bootstrap standard error from 200 resamples (here the normal interval, the same test), α = .05 two-tailed. The app’s choices: cSEM and lavaan where the paper used its own PLS code and sem; path weighting (the paper does not name its scheme); 200 replications per cell, as the paper, but only normal data, which the paper found made no difference (its skewed latent variables are not part of the cards), and not its N = 10,000. The paper counts power over proper solutions only; the card counts replications without convergence as failed and keeps improper solutions, reporting them in the inadmissible column. Random numbers differ from the paper’s, so results agree up to Monte Carlo error.';

const reinartzCard = (file: string, k: number, loading: number) => ({
  package: 'cSEM' as const,
  source:
    'Reinartz, Haenlein & Henseler (2009), An empirical comparison of the efficacy of covariance-based and variance-based SEM, the Monte Carlo study',
  links: [
    { label: 'Reinartz et al. (2009)', url: 'https://doi.org/10.1016/j.ijresmar.2009.08.001' },
  ],
  tags: FACTOR_DEBATE_TAGS,
  data: {
    package: 'cSEM' as const,
    name: `Reinartz et al. (2009), a sample of 250 (${k} indicators, loadings ${loading})`,
    file: `examples/montecarlo/${file}.csv`,
  },
  constructs: REINARTZ_CONSTRUCTS.map((name) => f(name, items(`${name.toLowerCase()}_`, k))),
  paths: REINARTZ_PATHS.map(([from, to]): [string, string] => [from, to]),
  panel: {
    kind: 'mc' as const,
    population: reinartzPopulation(k, loading),
    estimators: [
      { id: 'PLS', method: 'pls', consistent: false },
      { id: 'CB-ML', method: 'cb', estimator: 'ML' },
    ],
    sampleSizes: [100, 250, 500, 1000],
    replications: 200,
    seed: 2009,
    alpha: 0.05,
    bootSamples: 200,
    mcDraws: 0,
    inference: { signChange: 'none', interval: 'normal' },
  },
  settings: {
    method: 'pls' as const,
    plsPackage: 'cSEM' as const,
    consistent: false,
    scheme: 'path' as const,
    missing: 'casewise' as const,
    seed: 2009,
  },
});

/**
 * Henseler & Sarstedt (2013), Figure 3: a mediation chain of three common factors (.6, .6, no direct effect) with
 * loadings .6, .7, .8; `omit`: the population's paths the estimated model leaves out (Table 1's models).
 */
export const henseler2013Population = (omit: string[]) => ({
  constructs: ['X1', 'X2', 'X3'].map((name, j) => ({
    name,
    type: 'factor',
    indicators: items('x', 3, 3 * j + 1),
    loadings: [0.6, 0.7, 0.8],
  })),
  paths: [
    { from: 'X1', to: 'X2', value: 0.6 },
    { from: 'X2', to: 'X3', value: 0.6 },
    { from: 'X1', to: 'X3', value: 0 },
  ].map((p) => (omit.includes(`${p.from}:${p.to}`) ? { ...p, omitted: true } : p)),
  exoCor: [],
  skew: 0,
  kurtosis: 0,
});

/** What the Henseler & Sarstedt cards take from the paper, and what is the app's. */
const HENSELER_SARSTEDT_DIFFERS =
  'The paper analyses one data set of 100 cases that reproduces the population’s correlation matrix exactly (its Table 2), under eight specifications; the card draws 1,000 samples at N = 100, 250 and 500 from that population instead, so the GoF and the fit tests vary as they would in practice. As in the paper: the population (Figure 3), PLS mode A with path weighting, ML SEM, GoF as the square root of the mean communality times the mean R². The app’s choices: cSEM and lavaan where the paper used SmartPLS and AMOS; the cutoff .36 (Wetzels et al. 2009’s “large”) for GoF; the relative GoF and the PCA and canonical-correlation baselines are not computed.';

const henseler2013Card = (file: string, omit: string[]) => ({
  package: 'cSEM' as const,
  source:
    'Henseler & Sarstedt (2013), Goodness-of-fit indices for partial least squares path modeling, the simulated example (Figure 3, Table 1)',
  links: [
    { label: 'Henseler & Sarstedt (2013)', url: 'https://doi.org/10.1007/s00180-012-0317-1' },
  ],
  tags: FACTOR_DEBATE_TAGS,
  data: {
    package: 'cSEM' as const,
    name: 'Henseler & Sarstedt (2013), a sample of 100',
    file: `examples/montecarlo/${file}.csv`,
  },
  constructs: ['X1', 'X2', 'X3'].map((name, j) => f(name, items('x', 3, 3 * j + 1))),
  paths: henseler2013Population(omit)
    .paths.filter((p) => !('omitted' in p))
    .map((p): [string, string] => [p.from, p.to]),
  panel: {
    kind: 'mc' as const,
    population: henseler2013Population(omit),
    estimators: [
      { id: 'PLS', method: 'pls', consistent: false },
      { id: 'CB-ML', method: 'cb', estimator: 'ML' },
    ],
    sampleSizes: [100, 250, 500],
    replications: 1000,
    seed: 2013,
    alpha: 0.05,
    bootSamples: 0,
    mcDraws: 0,
  },
  settings: {
    method: 'pls' as const,
    plsPackage: 'cSEM' as const,
    consistent: false,
    scheme: 'path' as const,
    missing: 'casewise' as const,
    seed: 2013,
  },
});

/**
 * Dijkstra & Henseler (2015), Figure 4: five common factors with 2 to 6 indicators of differing loadings, two
 * correlated exogenous factors (.7) and paths that are zero, small, medium and strong, some multicollinear.
 */
export const DIJKSTRA_HENSELER_POPULATION = {
  constructs: [
    { name: 'X1', type: 'factor', indicators: items('x1_', 2), loadings: [0.87, 0.94] },
    {
      name: 'X2',
      type: 'factor',
      indicators: items('x2_', 6),
      loadings: [0.4, 0.41, 0.47, 0.6, 0.63, 0.65],
    },
    { name: 'Y3', type: 'factor', indicators: items('y3_', 4), loadings: [0.49, 0.6, 0.8, 0.9] },
    { name: 'Y4', type: 'factor', indicators: items('y4_', 2), loadings: [0.63, 0.83] },
    {
      name: 'Y5',
      type: 'factor',
      indicators: items('y5_', 6),
      loadings: [0.65, 0.67, 0.75, 0.75, 0.9, 0.9],
    },
  ],
  paths: [
    { from: 'X2', to: 'Y3', value: 0 },
    { from: 'Y3', to: 'Y5', value: 0.35 },
    { from: 'X2', to: 'Y4', value: 0.7 },
    { from: 'X2', to: 'Y5', value: -0.7 },
    { from: 'X1', to: 'Y4', value: 0 },
    { from: 'X1', to: 'Y5', value: 0.22 },
  ],
  exoCor: [{ a: 'X1', b: 'X2', value: 0.7 }],
  skew: 0,
  kurtosis: 0,
};

/**
 * Rhemtulla, van Bork & Borsboom (2020), Part A as a sampling study: X → M → Y (.6 each), M an error-free
 * composite of three equally weighted components that correlate .5; X and Y are observed without error.
 */
export const RHEMTULLA_POPULATION = {
  constructs: [
    { name: 'X', type: 'composite', indicators: ['x'], weights: [1] },
    { name: 'M', type: 'composite', indicators: items('m', 3), weights: [1, 1, 1], withinCor: 0.5 },
    { name: 'Y', type: 'composite', indicators: ['y'], weights: [1] },
  ],
  paths: [
    { from: 'X', to: 'M', value: 0.6 },
    { from: 'M', to: 'Y', value: 0.6 },
  ],
  exoCor: [],
  skew: 0,
  kurtosis: 0,
};

/** Muthén & Muthén (2002), the CFA model: two factors of five indicators, loadings .8, residual variances .36, factor correlation .25. */
export const MUTHEN_POPULATION = {
  constructs: [
    { name: 'f1', type: 'factor', indicators: items('y', 5), loadings: [0.8, 0.8, 0.8, 0.8, 0.8] },
    {
      name: 'f2',
      type: 'factor',
      indicators: items('y', 5, 6),
      loadings: [0.8, 0.8, 0.8, 0.8, 0.8],
    },
  ],
  paths: [],
  exoCor: [{ a: 'f1', b: 'f2', value: 0.25 }],
  skew: 0,
  kurtosis: 0,
};

export const CARD_MODEL: PackageExample[] = [
  {
    id: 'datasets-faithful-chart',
    package: 'datasets',
    title: 'Histogram: eruptions of Old Faithful',
    source: 'datasets, ?faithful (Härdle 1991; Azzalini & Bowman 1990)',
    links: [{ label: '?faithful', url: 'https://rdrr.io/r/datasets/faithful.html' }],
    description:
      'Duration in minutes of 272 eruptions of the Old Faithful geyser in Yellowstone, the help page’s data: a histogram of the eruption times shows the two kinds of eruption, short ones around two minutes and long ones around four and a half (mean 3.49, SD 1.14). Change the card to a scatterplot of eruptions and waiting time, the help page’s second plot. Opens its card on the Analyses tab.',
    shows:
      'Two humps, not one: the eruptions pile up around two minutes and around four and a half, with few in between. The mean of 3.49 and SD of 1.14 printed with the chart describe neither kind, which is the point of looking at a distribution before summarising it.',
    data: { package: 'datasets', name: 'faithful' },
    constructs: [],
    paths: [],
    panel: { kind: 'chart', x: 'eruptions', y: '', group: '', bins: 0, fit: true },
    settings: CB('ML'),
    tags: ['Distributions'],
  },
  {
    id: 'datasets-faithful-scatter',
    package: 'datasets',
    title: 'Scatterplot: eruption time against waiting time at Old Faithful',
    source: 'datasets, ?faithful (Härdle 1991; Azzalini & Bowman 1990)',
    links: [{ label: '?faithful', url: 'https://rdrr.io/r/datasets/faithful.html' }],
    description:
      'The help page’s second plot: the duration of each of the 272 eruptions against the waiting time before it, with the least-squares line (plot(eruptions ~ waiting, data = faithful) with a fitted line). Longer waits are followed by longer eruptions: eruptions = −1.874 + 0.0756 × waiting, r = 0.90, and the two clusters of short and long eruptions show again. Opens its card on the Analyses tab.',
    shows:
      'The longer the wait, the longer the eruption: r = 0.90, with the fitted line eruptions = −1.874 + 0.0756 × waiting. The points form the same two clusters as the histogram, short eruptions after short waits and long after long, so the line runs through a gap with few observations.',
    data: { package: 'datasets', name: 'faithful' },
    constructs: [],
    paths: [],
    panel: {
      kind: 'chart',
      options: { kind: 'scatter', x: 'waiting', y: 'eruptions', group: '', bins: 0, fit: true },
    },
    settings: CB('ML'),
    tags: ['Regression'],
  },
  {
    id: 'lavaan-hs-bollenstine',
    package: 'lavaan',
    title: 'Bollen–Stine bootstrap: Holzinger & Swineford',
    source: 'lavaan, ?bootstrapLavaan (type = "bollen.stine")',
    links: [
      { label: '?bootstrapLavaan', url: 'https://rdrr.io/cran/lavaan/man/bootstrapLavaan.html' },
      ...HS_LINKS,
      { label: 'Bollen & Stine (1992)', url: 'https://doi.org/10.1177/0049124192021002004' },
    ],
    description:
      'The help page’s example: the three-factor CFA of the 301 children’s mental ability tests (χ² = 85.306, df = 24), and a bootstrap of the χ² test that does not assume multivariate normality (Bollen & Stine 1992): the data are transformed so that the model fits exactly, resampled and refitted. The help page draws 10 samples “in this example; in practice you may wish to use a much higher number”: here 1,000, with seed 1234. No bootstrap χ² reaches the observed one, so exact fit is rejected (p < .001), as the normal-theory test says. Opens its card on the Analyses tab beside the diagram.',
    shows:
      'Not one of the 1,000 bootstrap χ² values reaches the observed 85.306 on 24 df, so the Bollen–Stine p is 0 and exact fit is rejected without assuming normality, as the normal-theory test (p < .001) says. In the bootstrap distribution table, the observed value lies beyond even the 99% quantile.',
    data: { package: 'lavaan', name: 'HolzingerSwineford1939' },
    constructs: HS,
    paths: [],
    panel: { kind: 'bollenstine' },
    settings: { ...CB('ML'), bootSamples: 1000, seed: 1234 },
  },
  {
    id: 'lslx-hs-sfa',
    package: 'lslx',
    title: 'Regularised SEM: semi-confirmatory factor analysis (lslx)',
    source:
      'lslx, ?lslx (Semi-Confirmatory Factor Analysis) and vignette("factor-analysis") (Holzinger & Swineford)',
    links: [
      { label: '?lslx', url: 'https://rdrr.io/cran/lslx/man/lslx.html' },
      {
        label: 'Vignette: semi-confirmatory factor analysis',
        url: 'https://cran.r-project.org/web/packages/lslx/vignettes/factor-analysis.html',
      },
      ...HS_LINKS,
      { label: 'Huang, Chen & Weng (2017)', url: 'https://doi.org/10.1007/s11336-017-9554-9' },
    ],
    description:
      'The help page’s semi-confirmatory factor analysis: the three factors of the 301 children’s mental ability tests with unit variances, correlated, and every cross-loading (each test on the two other factors, 18 in all) penalised by the minimax concave penalty (MCP) at the penalty levels .02 to .60 in steps of .02 and the convexities 1.5, 3 and ∞ (∞ is the lasso), the level chosen by BIC. The model with all cross-loadings cannot be identified by maximum likelihood; the penalty selects the few it needs. Opens its card on the Analyses tab beside the diagram.',
    shows:
      'BIC chooses λ = .14 with δ = 1.5: four of the 18 cross-loadings stay non-zero, x9 (.32), x7 (−.26) and x5 (−.10) on visual and x1 on textual (.26), x9 being the cross-loading the ESEM example finds, and the model fits well (χ² = 30.93 on 20 df, p = .056; RMSEA .043, CFI .988), where the plain CFA does not (χ² = 85.3 on 24 df). The path chart shows the cross-loadings shrinking to zero as λ grows.',
    syntax: [
      'visual =~ NA*x1 + x2 + x3',
      'textual =~ NA*x4 + x5 + x6',
      'speed =~ NA*x7 + x8 + x9',
      'visual ~~ 1*visual',
      'textual ~~ 1*textual',
      'speed ~~ 1*speed',
      'visual ~~ textual',
      'visual ~~ speed',
      'textual ~~ speed',
    ].join('\n'),
    data: { package: 'lavaan', name: 'HolzingerSwineford1939' },
    constructs: [],
    paths: [],
    panel: {
      kind: 'regsem',
      penalise: ['loadings'],
      penalty: 'mcp',
      selector: 'bic',
      deltas: [1.5, 3, 'Inf'],
      lambdaAuto: false,
      lambdaLength: 30,
      lambdaFrom: 0.02,
      lambdaTo: 0.6,
    },
    settings: CB('ML'),
  },
  {
    id: 'lavaan-hs-wald',
    package: 'lavaan',
    title: 'Comparing loadings: critical ratios for differences',
    source: 'lavaan, ?lavTestWald (Holzinger & Swineford)',
    links: [
      { label: '?lavTestWald', url: 'https://rdrr.io/cran/lavaan/man/lavTestWald.html' },
      ...HS_LINKS,
    ],
    description:
      'The model of lavTestWald’s help page: the three-factor CFA with the second loadings labelled b1 (x2), b2 (x5) and b3 (x8). The card tests every pair of free loadings for a difference, z = (a − b) / SE(a − b), AMOS’s critical ratios for differences; each z² is the Wald test of the pair held equal, so z(x5, x8)² is lavTestWald(fit, "b2 == b3"). Opens its card on the Analyses tab beside the diagram.',
    shows:
      'A matrix of critical ratios for every pair of the six free loadings: a large |z| means the two loadings differ. Squaring z(x5, x8) gives lavTestWald’s χ² for b2 == b3 exactly, so the table is fifteen one-df Wald tests at once, read as z rather than χ².',
    data: { package: 'lavaan', name: 'HolzingerSwineford1939' },
    constructs: [
      f('visual', items('x', 3), { x2: 'b1' }),
      f('textual', items('x', 3, 4), { x5: 'b2' }),
      f('speed', items('x', 3, 7), { x8: 'b3' }),
    ],
    paths: [],
    panel: { kind: 'cbcompare', kinds: ['loadings'] },
    settings: CB('ML'),
  },
  {
    id: 'nonnest2-hs-vuong',
    package: 'nonnest2',
    title: 'Vuong’s tests: one group or two (Holzinger & Swineford)',
    source: 'nonnest2, ?vuongtest and ?icci (latent variable models)',
    links: [
      { label: '?vuongtest', url: 'https://rdrr.io/cran/nonnest2/man/vuongtest.html' },
      { label: '?icci', url: 'https://rdrr.io/cran/nonnest2/man/icci.html' },
      ...HS_LINKS,
      { label: 'Merkle, You & Preacher (2016)', url: 'https://doi.org/10.1037/met0000038' },
    ],
    description:
      'The help pages’ latent variable example: the three-factor CFA of the 301 children fitted in one group (the diagram, with the constant on the canvas: meanstructure = TRUE, as ?icci fits it) against the same CFA fitted separately in the two schools (the saved alternative, configural groups by school). The models are not nested (lavTestNET cannot check models with different numbers of groups, and lavTestLRT says its χ² difference is invalid), so the card shows Vuong’s distinguishability and non-nested likelihood-ratio tests (vuongtest(fit1, fit2)) and intervals of the AIC and BIC differences (icci(fit1, fit2)). Opens its card on the Analyses tab beside the diagram.',
    shows:
      'The data tell the models apart (variance test p = .006; .016 on ?vuongtest, whose one-group model has no mean structure) and the two-school model fits better (non-nested LR test z = −4.99, p < .001 for model 2). The information criteria disagree: the AIC difference (one group minus two) lies between 7.45 and 94.74, favouring two groups, while the BIC difference lies between −103.76 and −16.47, favouring one group with its 48 fewer parameters.',
    data: { package: 'lavaan', name: 'HolzingerSwineford1939' },
    constructs: HS,
    paths: [],
    constant: true,
    panel: { kind: 'cbmodels', alternative: { model: HS_BY_SCHOOL, savedAt: 0 }, nested: 'auto' },
    settings: CB('ML'),
  },
  {
    id: 'parcels-bfi',
    package: 'psych',
    title: 'Parcels: the Big Five, and how much the allocation matters',
    source: 'psych, ?bfi (the SAPA project); Little et al. (2002); Sterba & MacCallum (2010)',
    links: [
      { label: '?bfi', url: 'https://rdrr.io/cran/psych/man/bfi.html' },
      {
        label: '?parcelAllocation',
        url: 'https://rdrr.io/cran/semTools/man/parcelAllocation.html',
      },
    ],
    description:
      'Five correlated factors of five items each, measured by three parcels per factor. The negatively keyed items (A1, C4, C5, E1, E2, O2, O5) are reversed first (7 − x, computed columns), as they must be before items are averaged; the parcels are balanced by loading (Make parcels… in a factor’s panel). The card refits the model with the items assigned at random 100 times.',
    shows:
      'On the 25 items the model fits poorly (CFI 0.782); on the parcels CFI is 0.877, partly because parcels hide item-level misfit. Over 100 random allocations CFI ranges from 0.827 to 0.917 (mean 0.877) and χ² from 993.022 to 1962.324: the fit depends on which items go together, and these balanced parcels sit near the middle (percentile 50%), so balancing does not guarantee better fit. The correlation of agreeableness and conscientiousness stays between 0.294 and 0.374.',
    data: { package: 'psych', name: 'bfi', file: 'examples/samples/bfi.csv' },
    computed: [
      { name: 'A1r', expr: '7 - A1' },
      { name: 'C4r', expr: '7 - C4' },
      { name: 'C5r', expr: '7 - C5' },
      { name: 'E1r', expr: '7 - E1' },
      { name: 'E2r', expr: '7 - E2' },
      { name: 'O2r', expr: '7 - O2' },
      { name: 'O5r', expr: '7 - O5' },
      { name: 'A_P1', expr: 'mean(A3)' },
      { name: 'A_P2', expr: 'mean(A2, A1r)' },
      { name: 'A_P3', expr: 'mean(A5, A4)' },
      { name: 'C_P1', expr: 'mean(C4r)' },
      { name: 'C_P2', expr: 'mean(C2, C1)' },
      { name: 'C_P3', expr: 'mean(C5r, C3)' },
      { name: 'E_P1', expr: 'mean(E2r)' },
      { name: 'E_P2', expr: 'mean(E4, E5)' },
      { name: 'E_P3', expr: 'mean(E1r, E3)' },
      { name: 'N_P1', expr: 'mean(N1)' },
      { name: 'N_P2', expr: 'mean(N2, N5)' },
      { name: 'N_P3', expr: 'mean(N3, N4)' },
      { name: 'O_P1', expr: 'mean(O3)' },
      { name: 'O_P2', expr: 'mean(O1, O4)' },
      { name: 'O_P3', expr: 'mean(O5r, O2r)' },
    ],
    constructs: [
      f('A', ['A_P1', 'A_P2', 'A_P3']),
      f('C', ['C_P1', 'C_P2', 'C_P3']),
      f('E', ['E_P1', 'E_P2', 'E_P3']),
      f('N', ['N_P1', 'N_P2', 'N_P3']),
      f('O', ['O_P1', 'O_P2', 'O_P3']),
    ],
    paths: [],
    correlations: [
      ['A', 'C', 'construct'],
      ['A', 'E', 'construct'],
      ['A', 'N', 'construct'],
      ['A', 'O', 'construct'],
      ['C', 'E', 'construct'],
      ['C', 'N', 'construct'],
      ['C', 'O', 'construct'],
      ['E', 'N', 'construct'],
      ['E', 'O', 'construct'],
      ['N', 'O', 'construct'],
    ],
    panel: { kind: 'parcelallocation', allocations: 100 },
    settings: CB('ML'),
  },
  {
    id: 'compare-pls-cb',
    package: 'seminr',
    title: 'PLS-SEM and CB-SEM compared: mobile phone satisfaction',
    source: 'seminr, ?mobi; the comparison of Cheah et al. (2024, Fig. 6)',
    links: [{ label: '?mobi', url: 'https://rdrr.io/cran/seminr/man/mobi.html' }],
    description:
      'The same diagram estimated by PLS-SEM and by CB-SEM, shown side by side with their estimates in one table: expectation and quality predicting satisfaction, on seminr’s mobi data.',
    shows:
      'Two diagrams and a table of the paths, loadings and R² of both methods. Read the Difference column: PLS-SEM’s composite estimates of common factors usually differ from CB-SEM’s most in the loadings, which it tends to overstate, and in the paths, which it tends to understate. Pick the PLS figure style to see how each model type is drawn.',
    data: { package: 'seminr', name: 'mobi', file: 'examples/samples/mobi.csv' },
    constructs: [
      f('Expectation', items('CUEX', 3)),
      f('Quality', items('PERQ', 7)),
      f('Satisfaction', items('CUSA', 3)),
    ],
    paths: [
      ['Expectation', 'Satisfaction'],
      ['Quality', 'Satisfaction'],
    ],
    panel: { kind: 'methodcompare' },
    settings: { method: 'pls' },
  },
  {
    id: 'lavaan-hs-scoreweights',
    package: 'lavaan',
    title: 'Factor score weights: Holzinger & Swineford',
    source: 'lavaan, ?lavPredict (Holzinger & Swineford)',
    links: [
      { label: '?lavPredict', url: 'https://rdrr.io/cran/lavaan/man/lavPredict.html' },
      ...HS_LINKS,
    ],
    description:
      'The model of lavPredict’s help page, the three-factor CFA: the weights by which the regression method (Thurstone; AMOS’s factor score weights) turns the nine tests into scores of visual, textual and speed. Applied to the centred tests they give exactly the scores of lavPredict(fit). Switch to Bartlett weights on the card. Opens its card on the Analyses tab beside the diagram.',
    shows:
      'A 9 × 3 table of weights: multiply the centred tests by a factor’s column and the result is lavPredict’s score for that factor, to the sixth decimal. Each factor leans on its own three tests, but the other six get weights too because the factors correlate; switch to Bartlett weights, which use only a factor’s own tests.',
    data: { package: 'lavaan', name: 'HolzingerSwineford1939' },
    constructs: HS,
    paths: [],
    panel: { kind: 'scoreweights', method: 'regression' },
    settings: CB('ML'),
  },
  {
    id: 'seminr-corprep-predict',
    package: 'seminr',
    title: 'PLSpredict: corporate reputation',
    source: 'seminr, ?predict_pls; Hair et al. (2021), chapter 6',
    links: [
      { label: '?predict_pls', url: 'https://rdrr.io/cran/seminr/man/predict_pls.html' },
      { label: 'cSEM, ?predict', url: 'https://rdrr.io/cran/cSEM/man/predict.html' },
      ...HAIR,
    ],
    description:
      'The extended corporate reputation model of Hair et al. (2021), and its out-of-sample predictive power as in chapter 6: 10-fold cross-validation repeated 10 times, each indicator of competence, likeability, satisfaction and loyalty predicted by PLS and by a linear-regression benchmark (LM). The card runs seminr’s predict_pls from the exogenous constructs (predict_EA), seed 123, with seminr’s mean replacement in each training fold, as the help page: every PLS and LM error is that of seminr’s summary (seminr 2.5.0, as R in the browser has it), e.g. comp_1 RMSE 1.046 (LM 1.081), like_2 1.486 (LM 1.559); PLS beats the LM benchmark on 9 of 10 indicators (not cusa: 1.021 against 1.021). seminr 2.6.0 changed its linear benchmark, so desktop R with that version prints other LM errors (comp_1 1.067). With cSEM’s predict (the card’s default) the PLS errors agree within the noise of the random folds. Opens its card on the Analyses tab beside the diagram.',
    shows:
      'In the PLSpredict table, compare RMSE (PLS) with RMSE (LM) row by row: PLS predicts 9 of the 10 indicators better than the linear benchmark (comp_1 1.046 against 1.081, like_2 1.486 against 1.559) and ties on cusa, and every Q²predict is positive. A majority of indicators beating LM is read as medium predictive power.',
    ...CORP_REP,
    panel: { kind: 'plspredict', folds: 10, repetitions: 10, engine: 'seminr', technique: 'EA' },
    settings: SEMINR({ seed: 123 }),
  },
  {
    id: 'seminr-mobi-compare',
    package: 'seminr',
    title: 'Model comparison: mediated or overriding effects?',
    source: 'seminr, demo("seminr-alternative-models") (mobi)',
    links: [
      {
        label: 'demo seminr-alternative-models',
        url: 'https://github.com/sem-in-r/seminr/blob/master/demo/seminr-alternative-models.R',
      },
      { label: '?mobi', url: 'https://rdrr.io/cran/seminr/man/mobi.html' },
      { label: 'cSEM, ?testCVPAT', url: 'https://rdrr.io/cran/cSEM/man/testCVPAT.html' },
    ],
    description:
      'Two of the demo’s structural models on the same ECSI measurement: in the diagram, image, expectation and quality also act on loyalty and complaints directly (overriding effects); the saved alternative has them act only through satisfaction and value (mediated). The card compares them by information criteria per endogenous construct (the AIC and BIC seminr’s summary prints as it_criteria) and by CVPAT (Liengaard et al. 2021). Opens its card on the Analyses tab beside the diagram.',
    shows:
      'Satisfaction and value have the same equations in both models, so their AIC and BIC agree; the comparison turns on loyalty and complaints, where the lower criterion marks the better model. CVPAT then tests whether the out-of-sample loss of the two models differs; a p above .05 means the data do not separate them.',
    data: { package: 'seminr', name: 'mobi' },
    constructs: MOBI,
    paths: MOBI_OVERRIDING,
    panel: { kind: 'compare', alternative: { paths: MOBI_MEDIATED, savedAt: 0 } },
    settings: SEMINR({ seed: 123 }),
  },
  {
    id: 'seminr-corprep-cta',
    package: 'seminr',
    title: 'Confirmatory tetrad analysis: corporate reputation',
    source: 'seminr, corp_rep_data; Gudergan et al. (2008), CTA-PLS',
    links: [
      { label: 'Gudergan et al. (2008)', url: 'https://doi.org/10.1016/j.jbusres.2008.03.012' },
      ...HAIR,
    ],
    description:
      'Are the formative drivers of the corporate reputation model (Hair et al. 2021) reflective after all? CTA-PLS tests the vanishing tetrads a common factor implies for the blocks with four or more indicators: quality (8 items), performance and corporate social responsibility (5 each). Bias-corrected bootstrap intervals (1,000 samples, seed 123), Bonferroni-adjusted within each block. No R package implements CTA-PLS; the tetrads are checked against a computation by hand. Opens its card on the Analyses tab beside the diagram.',
    shows:
      'One table per block, headed by its verdict: 20 non-redundant tetrads for quality (8 items), 5 each for performance and corporate social responsibility. A tetrad whose Bonferroni-adjusted interval excludes zero is evidence against a reflective model for that block, which is what a formative specification needs.',
    ...CORP_REP,
    panel: { kind: 'cta' },
    settings: SEMINR({ bootSamples: 1000, seed: 123 }),
  },
  {
    id: 'seminr-corprep-minsample',
    package: 'seminr',
    title: 'Minimum sample size: the inverse square root method',
    source: 'Kock & Hadaya (2018); seminr, corp_rep_data (Hair et al. 2021)',
    links: [{ label: 'Kock & Hadaya (2018)', url: 'https://doi.org/10.1111/isj.12131' }, ...HAIR],
    description:
      'How many observations does the corporate reputation model need for its paths to be detected? Kock & Hadaya’s (2018) inverse square root method: n_min > (2.486 / |β|)² for a one-tailed test at 5% with 80% power, applied to every path of the estimated model (N = 344). Nine of the thirteen paths need fewer than the 344 observations there are; four would need more: competence → loyalty (β = 0.006), corporate social responsibility → competence (0.059), attractiveness → competence (0.086) and performance → likeability (0.117). Press Calculate, then Run on the card.',
    shows:
      'The Per path table: with z = 2.486, n_min = (2.486 / |β|)² for each of the 13 paths. Nine need fewer than the 344 observations; competence → loyalty (β = 0.006), CSR → competence (0.059), attractiveness → competence (0.086) and performance → likeability (0.117) need more, the first of them a sample no survey has.',
    ...CORP_REP,
    panel: { kind: 'minsample', alpha: 0.05, power: 0.8, tails: 'one', source: 'model', beta: 0.2 },
    settings: SEMINR({ seed: 123 }),
  },
  {
    id: 'plspm-pos',
    package: 'plspm',
    title: 'PLS-POS: the hidden segments of simdata',
    source: 'plspm simdata; PLS-POS (Becker, Rai, Ringle & Völckner 2013)',
    links: [
      { label: '?simdata', url: 'https://rdrr.io/cran/plspm/man/simdata.html' },
      { label: 'Becker et al. (2013)', url: 'https://doi.org/10.25300/MISQ/2013/37.3.01' },
    ],
    description:
      'The simulated customers of plspm (N = 400) once more: one half’s satisfaction follows price, the other’s quality. Prediction-oriented segmentation moves customers between two segments as long as the explained variance of satisfaction grows. No package implements PLS-POS: the app’s implementation (local models with cSEM) is checked by how well it recovers the segments the data were simulated with (the group column). Opens its card on the Analyses tab beside the diagram.',
    shows:
      'In the PLS-POS solution table, one segment’s satisfaction is driven by price (a path above 0.6) and the other’s by quality, and the segments’ R² of satisfaction exceeds the global model’s. Compared with the group column the data were simulated with, the assignment recovers more than 85% of the customers.',
    ...SIMDATA,
    panel: { kind: 'pos', segments: 2, nrep: 3 },
    settings: {
      method: 'pls',
      plsPackage: 'cSEM',
      consistent: false,
      scheme: 'path',
      missing: 'casewise',
      seed: 1,
    },
  },
  {
    id: 'muthen-mc-cfa',
    package: 'lavaan',
    title: 'Monte Carlo: sample size for a factor correlation (Muthén & Muthén 2002)',
    source:
      'Muthén & Muthén (2002), How to use a Monte Carlo study to decide on sample size and determine power: the CFA model',
    links: [
      { label: 'Muthén & Muthén (2002)', url: 'https://doi.org/10.1207/S15328007SEM0904_8' },
      { label: 'lavaan, ?simulateData', url: 'https://rdrr.io/cran/lavaan/man/simulateData.html' },
    ],
    description:
      'The paper’s CFA model: two factors of five indicators each, loadings .8, residual variances .36 and a correlation of .25 between the factors. With normal data and no missing values the paper finds that 150 observations give power .81 to detect the correlation. The card simulates the same population: 1,000 samples of 150, each fitted by ML (lavaan), with the bias, coverage and power of the correlation. The diagram is fitted to one sample of 150 from that population (lavaan::simulateData, the paper’s seed 53487). Opens its card on the Analyses tab beside the diagram.',
    shows:
      'The row for the f1 ↔ f2 correlation: power about .81 at N = 150, the paper’s figure, with a mean estimate of .25 (no bias) and 95% coverage near .95. With 1,000 rather than the paper’s 10,000 replications, the power has a Monte Carlo SE of about 0.012.',
    data: {
      package: 'lavaan',
      name: 'Muthén & Muthén (2002), a sample of 150',
      file: 'examples/montecarlo/muthen2002.csv',
    },
    constructs: [f('f1', items('y', 5)), f('f2', items('y', 5, 6))],
    paths: [],
    correlations: [['f1', 'f2', 'construct']],
    panel: {
      kind: 'mc',
      population: MUTHEN_POPULATION,
      estimators: [{ id: 'CB-ML', method: 'cb', estimator: 'ML' }],
      sampleSizes: [150],
      replications: 1000,
      seed: 53487,
      alpha: 0.05,
      bootSamples: 0,
      mcDraws: 1000,
    },
    settings: CB('ML'),
  },
  {
    id: 'ronkko-evermann-null',
    title: 'Monte Carlo: PLS at a null path (Rönkkö & Evermann 2013)',
    description:
      'The paper’s population: two common factors with three indicators each (loadings .6, .7, .8) and no effect of A on B. At N = 100 the PLS estimate of the null path is bimodal: PLS weights capitalise on chance correlations and pull the estimate away from 0 in either direction, more so in mode B, and the weights chasing chance make the composites less reliable than sum scores. The bootstrap’s tests do not account for it, and in a few samples PLS does not converge (counted as failed). The card simulates 500 samples of 100, each estimated by PLS mode A and mode B (cSEM, centroid weighting), regression on sum scores and ML SEM (lavaan), with every bootstrap test, the composites’ reliability and the measurement checks of a PLS report. The diagram is fitted to one sample of 100 from that population (lavaan::simulateData, seed 2013). ' +
      RONKKO_EVERMANN_DIFFERS +
      FACTOR_POPULATION +
      ' Opens its card on the Analyses tab beside the diagram.',
    shows:
      'Figure 3 of the paper: the distributions of the PLS mode A and mode B estimates of A → B have two peaks either side of 0 (SD about .19 and .26), where sum scores (SD about .10) and ML SEM (about .14) have one at 0. Figure 2: the reliability rows put sum scores at .75, PLS mode A near .61 and mode B near .28 (the ideal weights reach .77). The Type I error by test table shows which bootstrap tests keep the 5% level, and the AVE, ρc, HTMT and Fornell–Larcker rows how often each check passes.',
    ...ronkkoEvermannCard(0),
  },
  {
    id: 'ronkko-evermann-beta',
    title: 'Monte Carlo: PLS, sum scores and ML SEM at β = .3 (Rönkkö & Evermann 2013)',
    description:
      'The paper’s population with an effect of .3 of A on B: two common factors with three indicators each (loadings .6, .7, .8). Composites carry measurement error, so regression on sum scores underestimates the effect (about .22: reliability .75 times .3). PLS weights capitalise on chance, which raises the PLS estimate above the sum scores’ although its composites are less reliable: mode A stays below .3, mode B reaches it on average with a larger SD. ML SEM estimates it without bias, with a larger SD than PLS mode A. The card simulates 500 samples of 100, each estimated by PLS mode A and mode B (cSEM, centroid weighting), regression on sum scores and ML SEM (lavaan), with bias, power and coverage, every bootstrap test, the composites’ reliability and the measurement checks of a PLS report. The diagram is fitted to one sample of 100 from that population (lavaan::simulateData, seed 2013). ' +
      RONKKO_EVERMANN_DIFFERS +
      FACTOR_POPULATION +
      ' Opens its card on the Analyses tab beside the diagram.',
    shows:
      'Figure 3 of the paper: in the A → B table sum scores have a mean near .22, PLS mode A near .27 and mode B near .30 for a true .3; SDs about .10 (sum scores), .09 (mode A), .12 (mode B) and .13 (ML SEM, mean near .3). Figure 2: the reliability rows put sum scores at .75, PLS mode A near .72 and mode B near .51.',
    ...ronkkoEvermannCard(0.3),
  },
  {
    id: 'henseler-beta5',
    title: 'Monte Carlo: PLS at a moderate effect, β = .5 (Henseler et al. 2014)',
    description:
      'Henseler et al.’s condition c: Rönkkö & Evermann’s population (two common factors with three indicators each, loadings .6, .7, .8) with a moderate effect of A on B, β = .5 (R² = .25, more typical of applied work). With more covariance between the blocks to go on, PLS mode A weights the better indicators more and its composites become as reliable as sum scores, slightly more; mode B catches up much of its gap. The card simulates 500 samples of 100, each estimated by PLS mode A and mode B (cSEM, centroid weighting), regression on sum scores and ML SEM (lavaan), with bias, power and coverage, every bootstrap test and the composites’ reliability. The diagram is fitted to one sample of 100 from that population (lavaan::simulateData, seed 2013). ' +
      HENSELER_DIFFERS +
      FACTOR_POPULATION +
      ' Opens its card on the Analyses tab beside the diagram.',
    shows:
      'Table 2 of the paper, squared: the reliability rows put PLS mode A at about .75 (paper .867² = .752) and sum scores at .745 (.862² = .743), mode B lower (about .67). Figure 5c: the estimates of A → B are unimodal, PLS mode A near .40 and mode B near .43 against sum scores near .37 for a true .5 (all composites attenuate the path); ML SEM centers on .5 with the larger SD.',
    ...henselerCard('c', 'henseler2014-beta5', { beta: 0.5 }),
  },
  {
    id: 'henseler-n500',
    title: 'Monte Carlo: PLS at N = 100 and 500 (Henseler et al. 2014)',
    description:
      'Henseler et al.’s condition d: Rönkkö & Evermann’s population with β = .3 (two common factors with three indicators each, loadings .6, .7, .8) at N = 100 (condition b, the original) and N = 500. At N = 100 PLS mode A weights chase chance and its composites are less reliable than sum scores; at N = 500 the weights settle on the better indicators and mode A becomes the more reliable, while the spread of every estimator shrinks and the PLS estimates lose their wide tails. The card simulates 500 samples at each size, each estimated by PLS mode A and mode B (cSEM, centroid weighting), regression on sum scores and ML SEM (lavaan), with bias, power and coverage, every bootstrap test and the composites’ reliability. The diagram is fitted to one sample of 500 from that population (lavaan::simulateData, seed 2013). ' +
      HENSELER_DIFFERS +
      FACTOR_POPULATION +
      ' Opens its card on the Analyses tab beside the diagram.',
    shows:
      'Table 2 of the paper, squared: at N = 100 PLS mode A near .72 (paper .843² = .711) against sum scores .745 (.743); at N = 500 mode A near .75 (.868² = .753) above them, mode B rising from about .51 to .70. Figure 5d: at N = 500 the A → B estimates are unimodal with SD about .04 (PLS mode A mean near .23, sum scores .22, ML SEM .30).',
    ...henselerCard('d', 'henseler2014-n500', { beta: 0.3, sampleSizes: [100, 500] }),
  },
  {
    id: 'henseler-loadings',
    title: 'Monte Carlo: PLS with loadings .5, .7, .9 (Henseler et al. 2014)',
    description:
      'Henseler et al.’s condition e: Rönkkö & Evermann’s population with β = .3 and more unequal loadings, .5, .7 and .9 (two common factors with three indicators each). When the indicators differ more in quality, weighting them pays off more: PLS mode A’s composites become more reliable than sum scores even at N = 100, the paper’s argument that PLS reduces measurement error when there is something to weight. The card simulates 500 samples of 100, each estimated by PLS mode A and mode B (cSEM, centroid weighting), regression on sum scores and ML SEM (lavaan), with bias, power and coverage, every bootstrap test and the composites’ reliability. The diagram is fitted to one sample of 100 from that population (lavaan::simulateData, seed 2013). ' +
      HENSELER_DIFFERS +
      FACTOR_POPULATION +
      ' Opens its card on the Analyses tab beside the diagram.',
    shows:
      'Table 2 of the paper, squared: PLS mode A near .76 (paper .871² = .759) against sum scores .75 (.867² = .752); mode B well below (about .60). The A → B table: sum scores near .22, PLS mode A near .28 and mode B near .32 for a true .3; ML SEM near .29, with many improper solutions (the .5 loading leaves little to identify a factor of three indicators at N = 100).',
    ...henselerCard('e', 'henseler2014-loadings', { beta: 0.3, loadings: [0.5, 0.7, 0.9] }),
  },
  {
    id: 'henseler-four',
    title: 'Monte Carlo: PLS in a four-construct model (Henseler et al. 2014)',
    description:
      'Henseler et al.’s condition f: Rönkkö & Evermann’s two factors embedded in a nomological net, C → A → B ← D, every path .3 and every construct a common factor with three indicators (loadings .6, .7, .8). Each construct now has a neighbour PLS can weight toward, so the bimodal estimates of the two-construct model give way to unimodal ones and mode A’s composites are about as reliable as sum scores. The card simulates 500 samples of 100, each estimated by PLS mode A and mode B (cSEM, centroid weighting), regression on sum scores and ML SEM (lavaan), with bias, power and coverage for all three paths, every bootstrap test and the composites’ reliability. The diagram is fitted to one sample of 100 from that population (lavaan::simulateData, seed 2013). ' +
      HENSELER_DIFFERS +
      FACTOR_POPULATION +
      ' Opens its card on the Analyses tab beside the diagram.',
    shows:
      'Table 2 of the paper, squared: PLS mode A’s reliability about level with sum scores (both near .745; paper .858² = .736 against .862² = .743, mode A better in 59% of samples). Figure 5f: the A → B estimates are unimodal, PLS mode A near .24 and mode B near .26 against sum scores near .22 for a true .3; ML SEM near .29 with the larger SD.',
    ...henselerCard('f', 'henseler2014-four', { beta: 0.3, four: true }),
  },
  {
    id: 'goodhue-sample-size',
    title: 'Monte Carlo: power of PLS, regression and SEM at small samples (Goodhue et al. 2012)',
    description:
      'Goodhue, Lewis & Thompson’s Study 1, which tested the belief that PLS has an advantage at small samples: four independent constructs Ksi1 to Ksi4 predict Eta1 with paths .48, .314, .114 and 0 (Cohen’s large, medium, small and no effect), each construct a common factor with three indicators (loadings .7, .8, .9). At every sample size PLS and regression on sum scores detect the paths about equally often and estimate them about equally (both attenuated by measurement error); ML SEM estimates them without bias with a larger SD, and fails or gives improper solutions often at N = 20 and 40. None of the three reaches 80% power for the medium path below N = 90, so the ten-times rule (N = 40 here) gives too little power whatever the method. The card simulates 500 samples at N = 20, 40, 90, 150 and 200, each estimated by PLS (cSEM, 100 bootstrap samples), regression on sum scores and ML SEM (lavaan). The diagram is fitted to one sample of 90 from that population (lavaan::simulateData, seed 2012). ' +
      GOODHUE_DIFFERS +
      FACTOR_POPULATION +
      ' Opens its card on the Analyses tab beside the diagram.',
    shows:
      'Table A2 of the paper: the power chart’s medium path Ksi2 → Eta1 rises from about .2 at N = 20 to .4 to .5 at N = 40, .8 at 90 and near 1 at 200 for all three methods (paper: regression .22, .40, .76, .97; PLS .15, .41, .75, .97; LISREL .10, .37, .79, .98). Table A1: the mean estimates of the large path .48 are about .40 for regression, .41 for PLS and .48 for ML SEM at every N, while the SDs triple from N = 200 to 20. The null path Ksi4 → Eta1 is rejected about 5% of the time at N = 90 and above.',
    ...goodhueCard('goodhue2012-normal', { sampleSizes: [20, 40, 90, 150, 200] }),
  },
  {
    id: 'goodhue-nonnormal',
    title: 'Monte Carlo: power with skewed data (Goodhue et al. 2012)',
    description:
      'Goodhue, Lewis & Thompson’s Study 2: the population of their Study 1 (Ksi1 to Ksi4 → Eta1 = .48, .314, .114 and 0, three indicators each with loadings .7, .8, .9) with extremely skewed indicators, skewness 1.75 and excess kurtosis 3.75, at N = 40 and 90. The paper finds that all three methods lose power with such data (for the medium path at N = 90 from about 75% to about 50%), PLS no less than the others. Its data were made by applying Fleishman’s polynomial to each indicator after generating it (Appendix D), which also shrinks the correlations between indicators by about a quarter: the estimates drop (the large path from about .39 to .33 for regression) and the lost power follows from that. The card uses the same generator, so it reproduces the drop; switch Generated by to Vale–Maurelli, which keeps the population’s correlations, and the estimates and power return almost to those with normal data. The card simulates 500 samples at each size, each estimated by PLS (cSEM, 100 bootstrap samples), regression on sum scores and ML SEM (lavaan). The diagram is fitted to one sample of 90 from that population with Vale–Maurelli skewed indicators (lavaan::simulateData, seed 2012). ' +
      GOODHUE_DIFFERS +
      FACTOR_POPULATION +
      ' Fleishman’s table steps by .25: the paper’s skewness 1.8 and kurtosis 3.8 lie just outside what his polynomial can generate, 1.75 and 3.75 inside. Opens its card on the Analyses tab beside the diagram.',
    shows:
      'Tables A4 and A5 of the paper, extreme skew: mean estimates of the large path .48 about .33 for regression (paper .330 and .334), .35 for PLS (.351, .350) and .41 for ML SEM (.407, .428); power for the medium path .314 at N = 90 about .55 for regression, .50 for PLS and .53 for ML SEM (paper .53, .48, .50), at N = 40 about .3 and below. ML SEM gives many improper solutions. With Vale–Maurelli the same rows come out near the normal-data values (about .40, .41, .47 and power near .75).',
    ...goodhueCard('goodhue2012-skewed', { sampleSizes: [40, 90], skew: 1.75, kurtosis: 3.75 }),
  },
  {
    id: 'henseler2015-split',
    title: 'Monte Carlo: discriminant validity of one factor split in two (Henseler et al. 2015)',
    description:
      'Henseler, Ringle & Sarstedt’s sensitivity condition: one common factor measured by six indicators (loadings .7), estimated as two constructs of three, so the two constructs are the same (φ = 1) and every discriminant validity check should flag them. PLS weights both blocks alike and their composites correlate about .74, their reliability, so Fornell–Larcker (√AVE against that correlation) and the cross-loadings practically never flag; HTMT, computed from the indicator correlations alone, comes out at 1 and flags the pair against .85 and .90 in nearly every sample, and HTMT inference (its upper 90% bootstrap bound reaching 1) in about 95%, as a 5% test should. The card simulates 1,000 samples at N = 100, 250, 500 and 1,000, each estimated by PLS mode A (cSEM) with every measurement check and 500 bootstrap samples for HTMT inference. ' +
      ' The diagram is fitted to one sample of 250 from that population (lavaan::simulateData, seed 2015). ' +
      HENSELER_2015_DIFFERS +
      FACTOR_POPULATION +
      ' Opens its card on the Analyses tab beside the diagram.',
    shows:
      'Table 3 of the paper, loadings .7: the Fornell–Larcker rows fail about 4% of samples at N = 100 and none from N = 500 (paper, either construct: 6.9%, 0.3%, 0, 0); the cross-loadings margin never fails (0%); HTMT (.85) fails 99% at N = 100 and all from 250 (99.1%, 100%), HTMT (.90) 96%, 99.7% and 100% (95.9%, 99.9%, 100%); HTMT inference 96%, 95%, 95% and 94% (96.0%, 95.7%, 94.9%, 95.5%). The construct correlation row: about .74 for a true 1.',
    ...henseler2015Card('henseler2015-split', [0.7, 0.7, 0.7], 1),
  },
  {
    id: 'henseler2015-high',
    title: 'Monte Carlo: Fornell–Larcker with high loadings (Henseler et al. 2015)',
    description:
      'Henseler, Ringle & Sarstedt’s sensitivity condition with high loadings (.9): one common factor estimated as two constructs of three indicators (φ = 1). Reliable composites correlate about .93, close to 1, so Fornell–Larcker flags the pair in some samples at N = 100, and less often the larger the sample: its estimate of the margin settles on a small positive value (√AVE of PLS’s inflated loadings, about .93, against the correlation .927) and the chance of crossing 0 shrinks with N, the opposite of what a check should do. The cross-loadings never flag; HTMT flags every sample, HTMT inference about 95%. The card simulates 1,000 samples at N = 100, 250, 500 and 1,000, each estimated by PLS mode A (cSEM) with every measurement check and 500 bootstrap samples for HTMT inference. ' +
      ' The diagram is fitted to one sample of 250 from that population (lavaan::simulateData, seed 2015). ' +
      HENSELER_2015_DIFFERS +
      FACTOR_POPULATION +
      ' Opens its card on the Analyses tab beside the diagram.',
    shows:
      'Table 3 of the paper, loadings .9: the Fornell–Larcker rows fail about 29%, 17%, 9% and 3% of samples for each construct (paper, either construct: 42.1%, 27.3%, 15.4%, 4.8%); the cross-loadings margin never fails; HTMT (.85) and (.90) fail every sample (100%); HTMT inference 96%, 96%, 95% and 94% (96.3%, 96.0%, 95.5%, 96.0%).',
    ...henseler2015Card('henseler2015-high', [0.9, 0.9, 0.9], 1),
  },
  {
    id: 'henseler2015-unequal',
    title: 'Monte Carlo: discriminant validity with unequal loadings (Henseler et al. 2015)',
    description:
      'Henseler, Ringle & Sarstedt’s sensitivity condition with unequal loadings (.5, .7, .9 in each block): one common factor estimated as two constructs of three indicators (φ = 1). PLS weights the .9 indicators most, which makes the composites reliable (about .80) and their correlation high, so Fornell–Larcker flags about half the samples, still fewer as N grows; the cross-loadings never flag. HTMT averages the indicator correlations without weights and, as the loadings differ (no tau-equivalence), overshoots 1 (about 1.03), so all three HTMT checks flag nearly every sample, HTMT inference more often than the 95% of a 5% test. The card simulates 1,000 samples at N = 100, 250, 500 and 1,000, each estimated by PLS mode A (cSEM) with every measurement check and 500 bootstrap samples for HTMT inference. ' +
      ' The diagram is fitted to one sample of 250 from that population (lavaan::simulateData, seed 2015). ' +
      HENSELER_2015_DIFFERS +
      FACTOR_POPULATION +
      ' Opens its card on the Analyses tab beside the diagram.',
    shows:
      'Table 3 of the paper, loadings .5, .7, .9: the Fornell–Larcker rows fail about 50%, 46%, 40% and 32% of samples for each construct (paper, either construct: 64.6%, 59.5%, 53.9%, 42.1%); the cross-loadings margin never fails; HTMT (.85) and (.90) fail 99% to 100% (99.9% / 98.5% at N = 100, then 100%); HTMT inference 98%, 99%, 100% and 100% (98.2%, 99.4%, 99.8%, 100%). The HTMT rows: mean about 1.03 for a true correlation of 1.',
    ...henseler2015Card('henseler2015-unequal', [0.5, 0.7, 0.9], 1),
  },
  {
    id: 'henseler2015-close',
    title: 'Monte Carlo: two distinct but close constructs, φ = .9 (Henseler et al. 2015)',
    description:
      'Two distinct but close constructs, φ = .9 (loadings .7, three indicators each), from Henseler, Ringle & Sarstedt’s specificity curves: whether a check calls them distinct depends on the check. Fornell–Larcker and the cross-loadings never flag them; HTMT comes out at .90 on average, so HTMT (.85) flags most samples and more as N grows, HTMT (.90) about half at every N, and HTMT inference, which only flags a correlation that cannot be told from 1, many at N = 100 and almost none at N = 1,000. Which of these is right is a question about the constructs: the paper recommends .85 for conceptually distinct constructs, .90 for close ones, and inference for neither threshold. The card simulates 1,000 samples at N = 100, 250, 500 and 1,000, each estimated by PLS mode A (cSEM) with every measurement check and 500 bootstrap samples for HTMT inference. ' +
      ' The diagram is fitted to one sample of 250 from that population (lavaan::simulateData, seed 2015). ' +
      HENSELER_2015_DIFFERS +
      FACTOR_POPULATION +
      ' Opens its card on the Analyses tab beside the diagram.',
    shows:
      'Figure 5 of the paper, loadings .7, read at φ = .9: the HTMT (.85) row fails about 79%, 88%, 95% and 99% of samples (specificity near 0 at large N); HTMT (.90) about 50% at every N; HTMT inference 58% at N = 100, 21% at 250, 3% at 500 and 0 at 1,000; Fornell–Larcker and the cross-loadings never fail (specificity 100%). The construct correlation row: about .67 for a true .9 (the composites’ reliability is .74).',
    ...henseler2015Card('henseler2015-close', [0.7, 0.7, 0.7], 0.9),
  },
  {
    id: 'ronkko-cho-one',
    title: 'Monte Carlo: testing a factor correlation of 1 (Rönkkö & Cho 2022)',
    description:
      'Rönkkö & Cho’s sensitivity condition: three factors with three indicators each (loadings .8), the first two perfectly correlated (φ = 1) and the third correlated .5 with both, so F1 and F2 are one construct and every discriminant validity test should say so. The CFA estimates the correlation without bias (about 1.00); the upper bound of its 95% interval reaches 1 in about 97–98% of samples (CI_CFA(1)), and χ²(1), the χ² difference against the model with the correlation fixed at 1, is not significant in about 93–95%: both keep their 5% level. AVE/SV_CFA (Fornell–Larcker with the CFA’s correlation) and HTMT against .85 and .90 flag every sample. ' +
      RONKKO_CHO_RUN +
      ' The diagram is fitted to one sample of 250 from that population (lavaan::simulateData, seed 2022). ' +
      RONKKO_CHO_DIFFERS +
      FACTOR_POPULATION +
      ' Opens its card on the Analyses tab beside the diagram.',
    shows:
      'Table 8 of the paper, loadings .8, φ = 1 at N = 50 / 100 / 250 / 1,000: the CI_CFA(1) row (factor correlation CI vs 1) fails about 98%, 98%, 98% and 97% of samples (paper .992, .990, .983, .983); χ²(1) about 92%, 94%, 95% and 94% (paper .967 to .979, averaged over 3, 6 and 9 items, where more items keep the test closer to its level at small N); Fornell–Larcker 100% (1.000); HTMT (.85) and (.90) 98% to 100%; the correlation row about 1.00 at every N.',
    ...ronkkoChoCard('ronkko2022-one', 1, [0.8, 0.8, 0.8]),
  },
  {
    id: 'ronkko-cho-nine',
    title: 'Monte Carlo: a factor correlation of .9 against the cutoffs (Rönkkö & Cho 2022)',
    description:
      'Rönkkö & Cho’s population with a high but not perfect correlation, φ = .9 (loadings .8): whether the two factors are distinct depends on the cutoff. Against 1, the tests flag them less and less often as N grows (they are distinct), and at N = 50 they still flag many samples: three indicators per factor make the correlation imprecise. Against .90, the factor correlation’s interval flags them about 98% of the time (the correlation is not below .90) and HTMT against .90 about half the time, as an unbiased estimate at its cutoff should. Fornell–Larcker with the CFA’s correlation flags nearly every sample: AVE (.64) is below φ² (.81), so it calls the factors not distinct although they are, at any N. ' +
      RONKKO_CHO_RUN +
      ' The diagram is fitted to one sample of 250 from that population (lavaan::simulateData, seed 2022). ' +
      RONKKO_CHO_DIFFERS +
      FACTOR_POPULATION +
      ' Opens its card on the Analyses tab beside the diagram.',
    shows:
      'Tables 8 and 9 of the paper, φ = .9 at N = 50 / 100 / 250 / 1,000: CI_CFA(1) fails about 69%, 32%, 1% and 0% of samples, χ²(1) about 53%, 23%, 1% and 0% (paper, averaged over 3, 6 and 9 items: .293, .106, .005, .000 and .199, .081, .004, .000; three items are the least precise); CI_CFA(.90) about 99%, 99%, 99% and 98% (Table 9: .982, .987, .985, .980); HTMT (.90) about 55%, 54%, 53% and 51% (r_DPR(.90): .576 to .622); Fornell–Larcker about 90%, 97%, 100% and 100% (AVE/SV_CFA: .968, .993, 1.000, 1.000).',
    ...ronkkoChoCard('ronkko2022-nine', 0.9, [0.8, 0.8, 0.8]),
  },
  {
    id: 'ronkko-cho-nine-items',
    title: 'Monte Carlo: a factor correlation of .9 with nine items per factor (Rönkkö & Cho 2022)',
    description:
      'The card ronkko-cho-nine with nine indicators per factor instead of three (loadings .8, φ = .9), the paper’s largest item count: the factor correlation is now estimated precisely enough that the tests against 1 almost never call the factors the same, even at N = 50, where three items flag about two thirds of the samples. The tests against .90 and HTMT against .90 still sit at their cutoff, and Fornell–Larcker still flags nearly every sample: more items do not raise AVE (.64), so it stays below φ² (.81) at any N. ' +
      RONKKO_CHO_RUN +
      ' The diagram is fitted to one sample of 250 from that population (lavaan::simulateData, seed 2022). ' +
      RONKKO_CHO_DIFFERS +
      FACTOR_POPULATION +
      ' Opens its card on the Analyses tab beside the diagram.',
    shows:
      'With nine items at N = 50 / 100 / 250 / 1,000: CI_CFA(1) fails about 3%, 0, 0 and 0 of samples and χ²(1) about 1% and 0 (three items: 69% and 53% at N = 50; Table 8’s average over 3, 6 and 9 items, .293 and .199, lies between); CI_CFA(.90) about 99%; HTMT (.90) about 50% to 56%; Fornell–Larcker 99% to 100% (AVE/SV_CFA .968 to 1.000).',
    ...ronkkoChoCard('ronkko2022-nine-items', 0.9, [0.8, 0.8, 0.8], 9),
  },
  {
    id: 'ronkko-cho-unequal',
    title: 'Monte Carlo: HTMT with unequal loadings .9, .6, .3 (Rönkkö & Cho 2022)',
    description:
      'Rönkkö & Cho’s condition with unequal loadings .9, .6 and .3 and φ = .9: HTMT averages the indicator correlations as if the items were parallel, so with loadings this unequal it overestimates the correlation (about .98 to 1.03 for a true .9) and calls the factors the same in most samples at every N, while the CFA estimates .90 without bias and its interval flags them less and less often as N grows. Weak items also make small samples hard: a few replications at N = 50 and 100 do not converge, and many solutions are improper. ' +
      RONKKO_CHO_RUN +
      ' The diagram is fitted to one sample of 250 from that population (lavaan::simulateData, seed 2022). ' +
      RONKKO_CHO_DIFFERS +
      FACTOR_POPULATION +
      ' Opens its card on the Analyses tab beside the diagram.',
    shows:
      'Tables 6 and 8 of the paper, loadings .9, .6, .3, φ = .9, at N = 50 / 100 / 250 / 1,000: the HTMT rows average about 1.03, 1.01, .99 and .98 (r_DPR .989 at N = 250) and fail against .90 in 82% to 99% of samples; the correlation row about .90 (r_CFA .901); CI_CFA(1) about 84%, 73%, 38% and 0% (paper .388, .241, .124, .001, averaged over 3, 6 and 9 items); Fornell–Larcker 95% to 100% (AVE/SV_CFA .992 to 1.000).',
    ...ronkkoChoCard('ronkko2022-unequal', 0.9, [0.9, 0.6, 0.3]),
  },
  {
    id: 'franke-sarstedt-cutoff',
    title: 'Monte Carlo: a factor correlation at the .85 cutoff (Franke & Sarstedt 2019)',
    description:
      'Franke & Sarstedt’s condition with the correlation at a cutoff: two factors of three parallel items (loadings .71, AVE .50) correlated .85. The inferential test of PHI against .85 (the 90% interval’s upper bound below .85) concludes discriminant validity in about 4% of samples at both N, its 5% Type I error; against .90 it does so about as often as its power allows (16% at N = 100, 50% at 500), and against 1 in about 73% and 100%. The heuristics are cruder: HTMT against .85 says the factors are distinct about half the time, as a point estimate at its cutoff must, and Fornell–Larcker almost never (AVE .50 is below φ² = .72). ' +
      FRANKE_SARSTEDT_RUN +
      ' The diagram is fitted to one sample of 500 from that population (lavaan::simulateData, seed 2019). ' +
      FRANKE_SARSTEDT_DIFFERS +
      FACTOR_POPULATION +
      ' Opens its card on the Analyses tab beside the diagram.',
    shows:
      'Tables I and II of the paper, loadings .71, φ = .85, three items, N = 100 / 500, as 1 minus the card’s failing share: the factor correlation CI vs .85 row about .04 and .04 (paper PHI.85 .04, .04), vs .90 about .16 and .50 (PHI.90 .13, .45), vs 1 about .73 and 1.00 (PHI1 .73, 1); HTMT (.85) about .46 and .50 (Table II .46, .47), HTMT (.90) about .75 and .96 (.74, .94); Fornell–Larcker about .05 and 0 (Table II FL1 .06, 0).',
    ...frankeSarstedtCard('franke2019-cutoff', 0.85, 0.71, 0.71),
  },
  {
    id: 'franke-sarstedt-unequal',
    title: 'Monte Carlo: Fornell–Larcker with unequal loadings (Franke & Sarstedt 2019)',
    description:
      'Franke & Sarstedt’s condition with unequal loadings: X’s items load .85 (AVE .72) and Y’s .71 (AVE .50), and the factors correlate .90. Fornell–Larcker is computed per construct and its verdict depends on which one: for X it says the factors are distinct in some samples at N = 100 and almost never at 500, for Y never; the factor correlation’s interval treats the pair as one question and concludes the same for both (against 1: about 68% and 100%; against .90: about 4%, its Type I error). HTMT is unbiased with parallel items, so against .90 it says distinct about half the time. ' +
      FRANKE_SARSTEDT_RUN +
      ' The diagram is fitted to one sample of 500 from that population (lavaan::simulateData, seed 2019). ' +
      FRANKE_SARSTEDT_DIFFERS +
      FACTOR_POPULATION +
      ' Opens its card on the Analyses tab beside the diagram.',
    shows:
      'Tables I and II of the paper, loadings .85 / .71, φ = .9, three items, N = 100 / 500, as 1 minus the card’s failing share: the factor correlation CI vs 1 row about .68 and 1.00 (PHI1 .67, 1), vs .90 about .04 and .04 (PHI.90 .03, .05); Fornell–Larcker for X about .18 and .02 (Table II FL1 .17, .03), for Y 0 (FL2 0, 0); HTMT (.90) about .46 and .49 (.48, .49), HTMT (.85) about .16 and .01 (.14, .02).',
    ...frankeSarstedtCard('franke2019-unequal', 0.9, 0.85, 0.71),
  },
  {
    id: 'dijkstra-henseler-plsc',
    package: 'cSEM',
    title:
      'Monte Carlo: consistent PLS against PLS, sum scores and CB-SEM (Dijkstra & Henseler 2015)',
    source:
      'Dijkstra & Henseler (2015), Consistent partial least squares path modeling: the Monte Carlo simulation',
    links: [
      { label: 'Dijkstra & Henseler (2015)', url: 'https://doi.org/10.25300/MISQ/2015/39.2.02' },
    ],
    tags: FACTOR_DEBATE_TAGS,
    description:
      'Dijkstra & Henseler’s population, built to test PLSc: five common factors with two to six indicators of unequal loadings (reliabilities .7 to .9), two exogenous factors correlated .7, and paths that are zero, small, medium and strong, some among multicollinear predictors. PLS (factorial weighting) and regression on sum scores underestimate the strong paths by about .3 and, between the correlated predictors, move effect from one to the other: the zero path X1 → Y4 comes out at about .16 and is significant in a third of the samples at N = 100 and nearly all at 500, while the true .22 of X1 → Y5 is never found. PLSc removes the bias as ML SEM does, at the cost of a larger SD; GLS and ULS behave like ML. ' +
      'The card simulates 1,000 samples at N = 100, 200 and 500, each estimated by PLS (factorial weighting) and PLSc (cSEM) with 500 bootstrap samples, regression on sum scores, and ML, GLS and ULS SEM (lavaan). The diagram is fitted to one sample of 500 from that population (lavaan::simulateData, seed 2015). ' +
      'As in the paper: the population (Figure 4), normal data, N, 1,000 replications and the estimators; the paper’s PLSc weights by the factorial scheme, the card’s by the path scheme (cSEM’s default), which ρA makes consistent either way. The paper does not say how PLS and PLSc were tested; the card tests by the bootstrap’s percentile interval, which gives PLSc more power and a higher Type I error at N = 100 than the paper’s Table 4. Its non-normal condition (indicators multiplied by a random factor per case) is not part of the card, nor are FIML (the same as ML on complete data), DWLS and WLS (which needs N > 210). Random numbers differ from the paper’s, so results agree up to Monte Carlo error.' +
      FACTOR_POPULATION +
      ' Opens its card on the Analyses tab beside the diagram.',
    shows:
      'Table 3 of the paper at N = 100 / 500, bias of X2 → Y4 (true .70): PLS about −.27 / −.29 (paper −.274 / −.283), sum scores −.31 / −.31 (−.305 / −.303), PLSc .03 / .00 (.023 / .005), ML .02 / .00. Table 4, the zero path X1 → Y4 significant: PLS about 35% / 95% (33.3 / 92.5), sum scores 36% / 96% (35.2 / 94.9), PLSc about 7% / 4%, ML 4% / 4% (4.6 / 5.1); X1 → Y5 (.22) found by ML in 20% / 86% (20.4 / 87.2).',
    data: {
      package: 'cSEM',
      name: 'Dijkstra & Henseler (2015), a sample of 500',
      file: 'examples/montecarlo/dijkstra2015.csv',
    },
    constructs: DIJKSTRA_HENSELER_POPULATION.constructs.map((x) => f(x.name, x.indicators)),
    paths: DIJKSTRA_HENSELER_POPULATION.paths.map((x): [string, string] => [x.from, x.to]),
    correlations: [['X1', 'X2', 'construct']],
    panel: {
      kind: 'mc',
      population: DIJKSTRA_HENSELER_POPULATION,
      estimators: [
        { id: 'PLSc', method: 'pls', consistent: true },
        { id: 'PLS factorial', method: 'pls', consistent: false, scheme: 'factor' },
        { id: 'Sum scores', method: 'regression', dr: false },
        { id: 'CB-ML', method: 'cb', estimator: 'ML' },
        { id: 'CB-GLS', method: 'cb', estimator: 'GLS' },
        { id: 'CB-ULS', method: 'cb', estimator: 'ULS' },
      ],
      sampleSizes: [100, 200, 500],
      replications: 1000,
      seed: 2015,
      alpha: 0.05,
      bootSamples: 500,
      mcDraws: 0,
    },
    settings: {
      method: 'pls',
      plsPackage: 'cSEM',
      consistent: true,
      scheme: 'path',
      missing: 'casewise',
      seed: 2015,
    },
  },
  {
    id: 'reinartz-power',
    title:
      'Monte Carlo: power of PLS and CB-SEM, four indicators with loadings .7 (Reinartz et al. 2009)',
    description:
      'Reinartz, Haenlein & Henseler’s comparison in a typical cell: six common factors in a satisfaction-index-like chain with strong (.5), medium (.3) and weak (.15) paths, each factor measured by four indicators with loadings .7. PLS finds the effects with fewer cases: at N = 100 it detects a weak path in about 46% of samples where ML SEM detects about 23%, and a medium one in 84% against 55%; ML needs about N = 500 to 1,000 for the power PLS has at 250. But PLS’s estimates are off: the strong paths come out near .40 for .50 at every N, and its power on the weak paths is helped by overestimating them (about .16 to .17 for .15). ML is unbiased at every N, with a larger SD. ' +
      'The card simulates 200 samples at N = 100, 250, 500 and 1,000, each estimated by PLS (mode A, cSEM) with 200 bootstrap samples and by ML SEM (lavaan).' +
      ' The diagram is fitted to one sample of 250 from that population (lavaan::simulateData, seed 2009). ' +
      REINARTZ_DIFFERS +
      FACTOR_POPULATION +
      ' Opens its card on the Analyses tab beside the diagram.',
    shows:
      'Power by effect size at N = 100 / 250 / 1,000, weak (.15), medium (.3) and strong (.5) paths: PLS about .46, .84, .99 / .79, 1.00, 1.00 / 1.00; ML about .23, .55, .97 / .46, .94, 1.00 / .96, 1.00 (the paper’s Table 7, 4 indicators, loadings .7: CB-SEM .18, .51, .96 and PLS .44, .85, .99 at N = 100; .45 and .81 for weak paths at 250; .95 and 1.00 at 1,000). Strong paths: PLS about .40, ML .50.',
    ...reinartzCard('reinartz2009-power', 4, 0.7),
  },
  {
    id: 'reinartz-weak',
    title: 'Monte Carlo: PLS and CB-SEM with two indicators of loading .5 (Reinartz et al. 2009)',
    description:
      'Reinartz et al.’s hardest cell: the same six factors measured by two indicators each with loadings .5 (reliability .40). ML SEM does not converge or gives an improper solution in most samples at N = 100 (the paper found about half improper), still in about a fifth at 250, and its estimates there are wild (SDs of several units); from N = 500 on it is unbiased, with modest power for the weak and medium paths. PLS always gives a solution and has more power, but it estimates attenuated composites: the strong paths come out near .21 for .50 and the medium one near .19 for .30, at every N. The power of PLS here is the power to find an effect of the wrong size. ' +
      'The card simulates 200 samples at N = 100, 250, 500 and 1,000, each estimated by PLS (mode A, cSEM) with 200 bootstrap samples and by ML SEM (lavaan).' +
      ' The diagram is fitted to one sample of 250 from that population (lavaan::simulateData, seed 2009). ' +
      REINARTZ_DIFFERS +
      FACTOR_POPULATION +
      ' Opens its card on the Analyses tab beside the diagram.',
    shows:
      'At N = 100: ML without convergence in 66 of 200 samples and improper in 97 more; PLS strong paths about .21 to .24, power for weak / medium / strong about .19, .46, .47. At N = 500 / 1,000: ML weak, medium and strong power about .14, .36, .85 / .27, .65, .99 (the paper’s Table 7, 2 indicators, loadings .5: .13, .31, .86 / .29, .67, .98); PLS weak power about .77 / .97 (.78 / .95); PLS strong paths still about .20.',
    ...reinartzCard('reinartz2009-weak', 2, 0.5),
  },
  {
    id: 'henseler-sarstedt-gof-correct',
    title: 'Monte Carlo: GoF and the fit tests of the correct model (Henseler & Sarstedt 2013)',
    description:
      'Henseler & Sarstedt’s population: three common factors in a mediation chain, X1 → X2 → X3 (.6 each, no direct effect), with loadings .6, .7 and .8, estimated as the population has it (the paper’s Model 4). GoF averages PLS’s communalities and R²s; here it comes out near .37 to .38, below .36 in about a third of the samples at every N, although the model is right. ML SEM’s χ² test rejects about 5% to 8% of samples, its Type I error, and SRMR is below .08 almost always. GoF, the paper argues, measures how much variance the model explains, not whether it is the right model; the other two cards show it rising for a wrong one. ' +
      'The card simulates 1,000 samples at N = 100, 250 and 500, each estimated by PLS (mode A, cSEM) with its GoF and by ML SEM (lavaan) with its χ² test and fit indices. The diagram is fitted to one sample of 100 from that population (lavaan::simulateData, seed 2013). ' +
      HENSELER_SARSTEDT_DIFFERS +
      FACTOR_POPULATION +
      ' Opens its card on the Analyses tab beside the diagram.',
    shows:
      'At N = 100 / 250 / 500: GoF about .378, .373, .371 (Table 1, Model 4: .369), below .36 in about 35%, 35% and 32% of samples; PLS paths about .46 (Table 1: .455); ML paths .60, its χ² test rejecting 7.6%, 6.4% and 4.9%, SRMR about .055, .034, .024.',
    ...henseler2013Card('henseler2013', ['X1:X3']),
  },
  {
    id: 'henseler-sarstedt-gof-misspecified',
    title: 'Monte Carlo: GoF does not notice a missing path (Henseler & Sarstedt 2013)',
    description:
      'Henseler & Sarstedt’s population estimated without the effect of X1 on X2 and with a direct path X1 → X3 (the paper’s Model 2). The model is wrong, yet PLS’s GoF comes out higher than for the right model (about .38 to .39 against .37 to .38), as in the paper’s Table 1 (.374 against .369), because GoF rewards explained variance and the extra path explains some. In the paper ML SEM rejects the model; in lavaan, as in this app, two exogenous factors correlate freely, so without X1 → X2 the model is an equivalent one, fits exactly as the right model does, and no test of the data can tell them apart (the paper’s AMOS model fixed that correlation at 0). The direct path comes out near 0 in ML SEM and at about .09 in PLS. ' +
      'The card simulates 1,000 samples at N = 100, 250 and 500, each estimated by PLS (mode A, cSEM) with its GoF and by ML SEM (lavaan) with its χ² test and fit indices. The diagram is fitted to one sample of 100 from that population (lavaan::simulateData, seed 2013). ' +
      HENSELER_SARSTEDT_DIFFERS +
      FACTOR_POPULATION +
      ' Opens its card on the Analyses tab beside the diagram.',
    shows:
      'At N = 100 / 250 / 500: GoF about .392, .380, .378 (the right model’s card: .378, .373, .371; Table 1, Model 2: .374), below .36 in about 28%, 32% and 25% of samples; ML’s χ² test rejecting 7.3%, 5.9% and 4.9%, as for the right model; X1 → X3 (true 0) about .09 in PLS, 0 in ML.',
    ...henseler2013Card('henseler2013', ['X1:X2']),
  },
  {
    id: 'henseler-sarstedt-gof-omitted',
    title:
      'Monte Carlo: GoF and the fit tests when the mediator’s effect is left out (Henseler & Sarstedt 2013)',
    description:
      'Henseler & Sarstedt’s population estimated without the mediator’s effect X2 → X3 and with a direct path X1 → X3 (the paper’s Model 3). Here GoF does drop, to about .31, below .36 in most samples, because the model now explains little of X3. ML SEM again cannot reject it: lavaan, like this app, lets the residuals of two outcomes that predict nothing correlate, which makes this model equivalent to the right one, with the same fit. What both methods then report is a direct effect of X1 on X3 that does not exist, about .36 in ML SEM (significant in about 74% of samples at N = 100 and all at 500) and .28 in PLS: an effect the fit statistics cannot catch, only theory can. ' +
      'The card simulates 1,000 samples at N = 100, 250 and 500, each estimated by PLS (mode A, cSEM) with its GoF and by ML SEM (lavaan) with its χ² test and fit indices. The diagram is fitted to one sample of 100 from that population (lavaan::simulateData, seed 2013). ' +
      HENSELER_SARSTEDT_DIFFERS +
      FACTOR_POPULATION +
      ' Opens its card on the Analyses tab beside the diagram.',
    shows:
      'At N = 100 / 250 / 500: GoF about .316, .310, .307 (Table 1, Model 3: .304), below .36 in about 81%, 93% and 98% of samples; ML’s χ² test rejecting 7.3%, 5.9% and 4.9%, as for the right model; X1 → X3 (true 0) about .35 to .36 in ML (significant in 74%, 99% and 100%) and .28 to .29 in PLS (Table 1: .457 and .273).',
    ...henseler2013Card('henseler2013', ['X2:X3']),
  },
  {
    id: 'goodhue-complex',
    package: 'cSEM',
    title:
      'Monte Carlo: PLS, regression and CB-SEM in a complex model at small samples (Goodhue et al. 2012)',
    source:
      'Goodhue, Lewis & Thompson (2012), Does PLS have advantages for small sample size or non-normal data?: Study 4, the complex model',
    links: [{ label: 'Goodhue et al. (2012)', url: 'https://doi.org/10.2307/41703490' }],
    tags: FACTOR_DEBATE_TAGS,
    description:
      'Goodhue, Lewis & Thompson’s Study 4: whether PLS’s supposed advantages show in a complex model, seven common factors (loadings .7, .8, .9) in a no-mediation, a partial-mediation and a full-mediation block, with paths of .27 to .39 and two zero paths, at N = 20, 40, 90 and 150. None of the three methods has adequate power below N = 90: on average over the seven true paths PLS finds about 46% at N = 40, regression on sum scores 43%, ML SEM 45%, and they are about equal from N = 90 on. PLS and regression underestimate the paths (by about 10% to 20%, more for paths between endogenous constructs); ML SEM is unbiased but at N = 20 it rarely converges and at N = 40 more than half its solutions are improper. The paper’s answer to its title: no advantage for PLS in a complex model either. ' +
      'The card simulates 500 samples at N = 20, 40, 90 and 150, each estimated by PLS (cSEM) with 100 bootstrap samples, regression on sum scores and ML SEM (lavaan). The diagram is fitted to one sample of 150 from that population (lavaan::simulateData, seed 2012). ' +
      'As in the paper: the population (Figure 5; the paper does not give the correlations of the three exogenous factors, here 0), N, 500 replications and the three methods, PLS tested by its bootstrap standard error from 100 resamples. The app’s choices: cSEM with path weighting and lavaan where the paper used PLS-Graph and LISREL; the paper counts a replication without a solution as not significant, the card leaves it out of the power (its failed column), and lavaan fails far more often at N = 20 (about 440 of 500, LISREL 99). At N = 20 PLS’s bootstrap test also rejects the zero paths more often than the paper’s (about 10% against 1.5%). The non-normal run (online Table A12) is not part of the card. Random numbers differ from the paper’s, so results agree up to Monte Carlo error.' +
      FACTOR_POPULATION +
      ' Opens its card on the Analyses tab beside the diagram.',
    shows:
      'Ksi3 → Eta3 (.393) at N = 40: power PLS about .61, ML .55, regression .56 (the paper: 59% and 53%); at N = 150 mean estimates PLS .34, regression .33, ML .39 (relative bias −.13, −.16, 0; Figure 6: −.12, −.15, 0). Average power over the seven true paths at N = 40: PLS .46, regression .43, ML .45 (the paper: 43.0%, 41.2%, 43.0%). Zero paths at N = 90: rejected in about 6% to 8% by each method.',
    data: {
      package: 'cSEM',
      name: 'Goodhue et al. (2012), Study 4, a sample of 150',
      file: 'examples/montecarlo/goodhue2012-complex.csv',
    },
    constructs: GOODHUE_COMPLEX_CONSTRUCTS.map((name) =>
      f(name, items(`${name.toLowerCase()}_`, 3)),
    ),
    paths: GOODHUE_COMPLEX_PATHS.map(([from, to]): [string, string] => [from, to]),
    panel: {
      kind: 'mc',
      population: GOODHUE_COMPLEX_POPULATION,
      estimators: [
        { id: 'PLS', method: 'pls', consistent: false },
        { id: 'Sum scores', method: 'regression', dr: false },
        { id: 'CB-ML', method: 'cb', estimator: 'ML' },
      ],
      sampleSizes: [20, 40, 90, 150],
      replications: 500,
      seed: 2012,
      alpha: 0.05,
      bootSamples: 100,
      mcDraws: 0,
      inference: { signChange: 'none', interval: 'normal' },
    },
    settings: {
      method: 'pls',
      plsPackage: 'cSEM',
      consistent: false,
      missing: 'casewise',
      seed: 2012,
    },
  },
  {
    id: 'kock-hadaya-sample-size',
    package: 'cSEM',
    title: 'Monte Carlo: the minimum sample size for the weakest path (Kock & Hadaya 2018)',
    source:
      'Kock & Hadaya (2018), Minimum sample size estimation in PLS-SEM: the inverse square root and gamma-exponential methods, Experiment 2',
    links: [{ label: 'Kock & Hadaya (2018)', url: 'https://doi.org/10.1111/isj.12131' }],
    tags: FACTOR_DEBATE_TAGS,
    description:
      'Kock & Hadaya’s Experiment 2: the MBLC model of six common factors (2 to 7 indicators) with paths of .15 to .29, where power depends on the weakest path, CL → LO (.147). The inverse square root method puts the minimum N at (2.486 / .147)² = 287 for power .80 (one-tailed 5%), the gamma-exponential method at 273, the paper’s Monte Carlo at 265; the 10-times rule says 20 and the minimum-R² table 110. With loadings .8 the card needs about 400: PLS estimates the path at about .13, attenuated by the composites’ measurement error, and the rules take β as given. PLSc estimates .147 without bias but with a larger SD, so its power is the same. At N = 100, the minimum-R² answer, power is about .37. ' +
      'The card simulates 1,000 samples at N = 100, 200, 300 and 400, each estimated by PLS and PLSc (cSEM) with 500 bootstrap samples, a path significant when its bootstrap t (normal interval, α = .10 two-tailed) says so, the paper’s one-tailed 5% for a positive path. The diagram is fitted to one sample of 300 from that population (lavaan::simulateData, seed 2018). ' +
      'As in the paper: the model, the Experiment 2 paths, uncorrelated exogenous factors, 1,000 replications, PLS mode A and the bootstrap t test from 500 resamples. The app’s choices: cSEM with path weighting where the paper used its own MATLAB code; loadings .8, which the paper does not give (higher loadings attenuate less and lower the N needed, toward the paper’s 265); PLSc added. Random numbers differ from the paper’s, so results agree up to Monte Carlo error.' +
      FACTOR_POPULATION +
      ' Opens its card on the Analyses tab beside the diagram.',
    shows:
      'CL → LO (true .147), power at N = 100 / 200 / 300 / 400: PLS about .37, .57, .72, .79 and PLSc .40, .57, .71, .79, so .80 near N = 400 (the paper’s Monte Carlo: 265; inverse square root 287, gamma-exponential 273, 10-times rule 20). Mean estimates: PLS about .13, PLSc .15. The stronger paths reach .90 by N = 200.',
    data: {
      package: 'cSEM',
      name: 'Kock & Hadaya (2018), a sample of 300',
      file: 'examples/montecarlo/kock2018.csv',
    },
    constructs: KOCK_BLOCKS.map(([name, k]) => f(name, items(`${name.toLowerCase()}`, k))),
    paths: KOCK_PATHS.map(([from, to]): [string, string] => [from, to]),
    panel: {
      kind: 'mc',
      population: KOCK_POPULATION,
      estimators: [
        { id: 'PLS', method: 'pls', consistent: false },
        { id: 'PLSc', method: 'pls', consistent: true },
      ],
      sampleSizes: [100, 200, 300, 400],
      replications: 1000,
      seed: 2018,
      alpha: 0.1,
      bootSamples: 500,
      mcDraws: 0,
      inference: { signChange: 'none', interval: 'normal' },
    },
    settings: {
      method: 'pls',
      plsPackage: 'cSEM',
      consistent: false,
      scheme: 'path',
      missing: 'casewise',
      seed: 2018,
    },
  },
  {
    id: 'aguirre-reliability-medium',
    title:
      'Monte Carlo: PLS composite reliability overstated, three indicators around .6 (Aguirre-Urreta et al. 2013)',
    description:
      'Aguirre-Urreta, Marakas & Ellis’s question: does PLS’s composite reliability ρc, computed from PLS’s loadings, tell how reliable the composite PLS actually uses is? Two common factors X and Z (correlated .25) predict Y (.48 and .28); X’s three indicators load .6, Z’s .45, .6 and .75, Y’s .7. The PLS composites of X and Z have a true reliability of about .61 to .66, yet ρc reports about .77 to .80: PLS’s loadings are inflated because each indicator is part of the composite it is correlated with, so ρc overstates by about .15 and passes .70 in nearly every sample where the composite itself does not. For Y, with loadings .7, ρc reports .85 for a true .74. The paths are attenuated as well (X → Y about .34 for .48). ' +
      'The card simulates 1,000 samples at N = 100, 300 and 500, each estimated by PLS (mode A, cSEM). The diagram is fitted to one sample of 300 from that population (lavaan::simulateData, seed 2013). ' +
      AGUIRRE2013_DIFFERS +
      FACTOR_POPULATION +
      ' Opens its card on the Analyses tab beside the diagram.',
    shows:
      'At N = 100 / 500: ρc of X about .79 / .80, Z .77 / .79, Y .85 / .85; the true reliability of the same composites .61 / .63, .63 / .66, .74 / .74 (the paper’s Table 3, three indicators, N = 100: PLS CR .792, .771, .850 against Calc. CR .617, .631, .737). ρc below .70 in about 1.5% (X) and 6% (Z) of samples at N = 100, almost none at 500. X → Y (true .48) about .34, Z → Y (.28) about .23 to .25.',
    ...aguirre2013Card('aguirre2013-medium', 0.6),
  },
  {
    id: 'aguirre-reliability-low',
    title:
      'Monte Carlo: PLS composite reliability with weak indicators (Aguirre-Urreta et al. 2013)',
    description:
      'The same population with weak indicators: X’s three load .4, Z’s .25, .4 and .55, so the true reliability of their PLS composites is only about .32 to .39. PLS’s ρc reports about .60 to .70, roughly double, and passes .70 in about a third of the samples for X and a fifth for Z, the paper’s decision error: a researcher following the .70 rule keeps a scale whose composite is less than 40% true score. For Y (loadings .7) ρc is .85 for a true .74. The weaker the indicators, the larger the overstatement, and a larger sample does not shrink it. ' +
      'The card simulates 1,000 samples at N = 100, 300 and 500, each estimated by PLS (mode A, cSEM). The diagram is fitted to one sample of 300 from that population (lavaan::simulateData, seed 2013). ' +
      AGUIRRE2013_DIFFERS +
      FACTOR_POPULATION +
      ' Opens its card on the Analyses tab beside the diagram.',
    shows:
      'At N = 100 / 500: ρc of X about .66 / .70, Z .60 / .67, Y .85 / .85; the true reliability .32 / .36, .33 / .39, .73 / .74 (Table 3, N = 100: PLS CR .669, .634, .850 against Calc. CR .323, .325, .737). ρc below .70 for X in 67% / 54% and for Z in 81% / 82% of samples, so it passes .70 in about a third and a fifth. X → Y (true .48) about .29 / .27.',
    ...aguirre2013Card('aguirre2013-low', 0.4),
  },
  {
    id: 'wolf-cfa-weak',
    title:
      'Monte Carlo: the sample size a two-factor CFA with weak loadings needs (Wolf et al. 2013)',
    description:
      'Wolf, Harrington, Clark & Miller’s sample-size study: instead of a rule of thumb (N ≥ 200, or 10 cases per parameter), simulate the model you plan and find the N where every criterion holds. Here two common factors, correlated .3, each measured by three indicators of loading .5; the paper’s minimum is N = 460, against 120 with loadings .8. The weakest parameter is the factor correlation: ML estimates it without bias at every N, and its Wald test reaches power .80 between N = 340 and 400 (about .88 at 460). At N = 260 and 300 a few samples still end without a proper solution. ' +
      'The card simulates 1,000 samples at N = 260, 300, 340, 400 and 460, each estimated by ML SEM (lavaan). The diagram is fitted to one sample of 200 from that population (lavaan::simulateData, seed 53487, the paper’s). ' +
      WOLF_DIFFERS +
      ' Opens its card on the Analyses tab beside the diagram.',
    shows:
      'Factor correlation (true .30), power at N = 260 / 300 / 340 / 400 / 460: about .55, .64, .75, .82, .88, mean estimate .30 at every N (the paper’s minimum N: 460). Failed or improper solutions in 1, 3, 0, 0 and 0 of 1,000 samples. The χ² test rejects about 3% to 6%, its Type I error; CFI about .98 to .99.',
    ...wolfCard(
      'wolf2013-cfa',
      WOLF_CFA_POPULATION,
      [f('F1', items('x', 3)), f('F2', items('x', 3, 4))],
      [],
      [260, 300, 340, 400, 460],
    ),
    correlations: [['F1', 'F2', 'construct']],
  },
  {
    id: 'wolf-mediation',
    title: 'Monte Carlo: the sample size a latent mediation model needs (Wolf et al. 2013)',
    description:
      'Wolf et al.’s latent mediation model: F1 → F2 → F3 with a direct path F1 → F3, all .40, each factor measured by three indicators of loading .65. The weakest parameter of interest is the indirect effect (.16), which needs more cases than any single path: the paths reach power .80 by about N = 100 to 140, the indirect effect between 140 and 180. The paper’s minimum is 180, and 440 when the paths are .25. Estimates are unbiased from N = 140 on. ' +
      'The card simulates 1,000 samples at N = 100, 140, 180 and 220, each estimated by ML SEM (lavaan), the indirect effect tested by a Monte Carlo interval from 1,000 draws. The diagram is fitted to one sample of 200 from that population (lavaan::simulateData, seed 53487, the paper’s). ' +
      WOLF_DIFFERS +
      ' Opens its card on the Analyses tab beside the diagram.',
    shows:
      'Power at N = 100 / 140 / 180 / 220: F1 → F2 about .75, .91, .95, .98; the direct path F1 → F3 .68, .84, .92, .96; the indirect effect (true .16) .43, .74, .87, .95 (the paper at 140 / 180: direct .83 / .91, indirect .61 / .83). Estimates within 3% of the truth; the χ² test rejecting about 6% to 8%.',
    ...wolfCard(
      'wolf2013-mediation',
      wolfMediationPopulation(0.4),
      [f('F1', items('x', 3)), f('F2', items('x', 3, 4)), f('F3', items('x', 3, 7))],
      [
        ['F1', 'F2'],
        ['F2', 'F3'],
        ['F1', 'F3'],
      ],
      [100, 140, 180, 220],
      1000,
    ),
  },
  {
    id: 'wolf-single-indicator',
    title: 'Monte Carlo: a path model that ignores measurement error (Wolf et al. 2013)',
    description:
      'The same mediation population, but each factor measured by a single indicator of loading .65 (reliability .42), as when a path model is fitted to scale scores and their measurement error ignored. The model is just identified, so it fits exactly (χ² 0 with 0 df) and no fit statistic warns. The estimates are attenuated, about .17 for F1 → F2 and .20 for the other two paths, all .40 in the population, and the indirect effect about .03 for .16. Power falls with them: at N = 180 about .64 for F1 → F2 and .47 for the indirect effect, where the three-indicator model has .95 and .87. A larger sample buys power for an effect of the wrong size. ' +
      'The card simulates 1,000 samples at N = 50, 100 and 180, each estimated by ML (lavaan), the indirect effect tested by a Monte Carlo interval from 1,000 draws. The diagram is fitted to one sample of 200 from that population (lavaan::simulateData, seed 53487, the paper’s). ' +
      WOLF_DIFFERS +
      ' Opens its card on the Analyses tab beside the diagram.',
    shows:
      'At N = 50 / 100 / 180: F1 → F2 (true .40) about .16, .16, .17, power .24, .36, .64 (the paper at 180: .17 and .68); F1 → F3 and F2 → F3 about .20, power .35 to .81; the indirect effect (true .16) about .03, power .06, .18, .47.',
    ...wolfCard(
      'wolf2013-single',
      wolfMediationPopulation(0.4, 1, 0.65),
      [f('F1', ['x1']), f('F2', ['x2']), f('F3', ['x3'])],
      [
        ['F1', 'F2'],
        ['F2', 'F3'],
        ['F1', 'F3'],
      ],
      [50, 100, 180],
      1000,
    ),
  },
  {
    id: 'curran-nonnormal',
    title:
      'Monte Carlo: the χ² test of a correct CFA under severe non-normality (Curran et al. 1996)',
    description:
      'Curran, West & Finch’s question: what non-normal data do to the χ² test of a correct CFA. Three factors (correlated .3), three indicators of loading .7 each, the model right, and every indicator skewed 3 with kurtosis 21, their most severe condition. ML’s χ² test, which assumes normal data, rejects the correct model in about 38% to 49% of samples, and more at larger N, not less; the Satorra–Bentler scaled χ² brings that down to about 13% at N = 100 and 4% to 8% from 200 on. CFI and TLI also come out lower under ML, below .95 in about 40% to 50% of samples at N = 100. ML gives improper solutions in about 5% of samples at N = 100. ' +
      'The card simulates 200 samples at N = 100, 200, 500 and 1,000, each estimated by ML with its χ² test and by ML with the Satorra–Bentler correction (lavaan’s MLM). The diagram is fitted to one sample of 200 from that population (lavaan::simulateData, seed 1996). ' +
      CURRAN_DIFFERS +
      ' Opens its card on the Analyses tab beside the diagram.',
    shows:
      'χ² test rejecting the correct model at N = 100 / 200 / 500 / 1,000: ML about 38%, 38%, 40%, 49% (the paper’s Model 1, severe non-normality: 30%, 36%, 40%, 48%), Satorra–Bentler 13%, 8%, 6.5%, 4% (13%, 6.5%, 8.5%, 7%). Mean χ² (24 df): ML about 34 to 37, Satorra–Bentler 25 to 28. Improper ML solutions in 11, 3, 0 and 0 of 200 samples.',
    ...curranCard('curran1996-severe', 3, 21),
  },
  {
    id: 'curran-misspecified',
    title:
      'Monte Carlo: the power of the χ² test against omitted cross-loadings (Curran et al. 1996)',
    description:
      'Curran et al.’s population B: the same three factors, but two indicators also load on a second factor (x6 on F3 and x7 on F2, .35 in the paper’s metric), cross-loadings the estimated model leaves out. With normal data the χ² test is what finds them: it rejects the model in about half the samples at N = 100, 85% at 200 and all from 500 on, and the Satorra–Bentler test, not needed here, has the same power. The fit indices are less sure: RMSEA stays near .07, above .06 in about two thirds to 94% of samples, CFI near .95, failing it in about half, and SRMR is below .08 in nearly every sample from N = 200 on. ' +
      'The card simulates 200 samples at N = 100, 200, 500 and 1,000, each estimated by ML with its χ² test and by ML with the Satorra–Bentler correction (lavaan’s MLM). The diagram is fitted to one sample of 200 from that population (lavaan::simulateData, seed 1996). ' +
      CURRAN_DIFFERS +
      ' Opens its card on the Analyses tab beside the diagram.',
    shows:
      'χ² test rejecting the wrong model at N = 100 / 200 / 500 / 1,000: ML about 52%, 85%, 100%, 100% (the paper’s Model 3, normal data: 54.3%, 88.1%, 100%, 100%), Satorra–Bentler 51%, 85%, 100%, 100% (57.9%, 89.9%, 100%, 100%). RMSEA about .07, above .06 in 65%, 68%, 86% and 94% of samples; SRMR from .067 to .045, above .08 in 16% at N = 100 and none after; CFI about .95, below .95 in 39% to 53%.',
    ...curranCard('curran1996-cross', 0, 0, true),
  },
  {
    id: 'hu-bentler-true',
    title: 'Monte Carlo: fit index cutoffs for a correct CFA (Hu & Bentler 1999)',
    description:
      'Hu & Bentler’s simple model: three correlated factors (.5, .4, .3) with five indicators each (loadings .7 to .8), estimated as the population has it. Their cutoffs, SRMR ≤ .08, RMSEA ≤ .06 and CFI and TLI ≥ .95, were chosen to keep such a model while rejecting misspecified ones. With normal data the right model passes all four in every sample from N = 150 on: SRMR about .048 at N = 150 and .018 at 1,000, RMSEA .018 to .005, CFI .99 or more. The χ² test rejects about 4% to 6%, 10% at N = 150. The paper’s higher rejection rates for the true model come from its non-normal conditions. ' +
      'The card simulates 200 samples at N = 150, 250, 500 and 1,000, each estimated by ML SEM (lavaan) with its χ² test and fit indices. The diagram is fitted to one sample of 250 from that population (lavaan::simulateData, seed 1999). ' +
      HU_BENTLER_DIFFERS +
      ' Opens its card on the Analyses tab beside the diagram.',
    shows:
      'At N = 150 / 250 / 500 / 1,000: SRMR about .048, .036, .026, .018 and RMSEA .018, .011, .008, .005, above the cutoffs in no sample (the paper, pooled over seven distributions, N ≤ 250 / 500 / ≥ 1,000: SRMR 6.8%, 0.3%, 0%; RMSEA 28.0%, 5.4%, 0.1%); CFI .99 to 1.00; χ² test rejecting 10%, 5%, 4%, 5.5%.',
    ...huBentlerCard('hu1999-simple', false),
  },
  {
    id: 'hu-bentler-cross',
    title: 'Monte Carlo: fit index cutoffs against an omitted cross-loading (Hu & Bentler 1999)',
    description:
      'Hu & Bentler’s complex model with one cross-loading left out: x1 loads on F1 and also on F3 (.7 in the paper’s metric), but the estimated model has it on F1 only (their Complex Misspecified I). The χ² test rejects it in nearly every sample from N = 150 on. RMSEA, about .07, rejects it in 80% of samples at N = 150 and all at 1,000, and TLI, about .93, in 84% to 99%. SRMR does not: about .06 to .07, it passes .08 in most samples at N = 150 and every one from 500 on, the pattern behind the paper’s two-index rule (SRMR with RMSEA or CFI). ' +
      'The card simulates 200 samples at N = 150, 250, 500 and 1,000, each estimated by ML SEM (lavaan) with its χ² test and fit indices. The diagram is fitted to one sample of 250 from that population (lavaan::simulateData, seed 1999). ' +
      HU_BENTLER_DIFFERS +
      ' Opens its card on the Analyses tab beside the diagram.',
    shows:
      'At N = 150 / 250 / 500 / 1,000: SRMR about .073, .065, .062, .059, above .08 in 22%, 3.5%, 0% and 0% of samples (the paper, N ≤ 250 / 500 / ≥ 1,000: 36.5%, 10.6%, 0.9%); RMSEA about .07, above .06 in 80%, 81.5%, 95.5%, 100% (91.6%, 97.7%, 99.8%); CFI about .94, below .95 in 61% to 82%; χ² test rejecting 99.5% to 100%.',
    ...huBentlerCard('hu1999-complex', true),
  },
  {
    id: 'aguirre-ronkko-percentile',
    title:
      'Monte Carlo: percentile bootstrap intervals for PLS and PLSc (Aguirre-Urreta & Rönkkö 2018)',
    description:
      'Aguirre-Urreta & Rönkkö asked whether bootstrap confidence intervals of PLSc paths cover the population value as often as they claim. Their simple model: four common factors K1 to K4 affect E1 with .48, .48, .48 and 0 (R² .69), three indicators each loading .7, .8 and .9. The paper finds the percentile interval too wide at small samples (coverage .99 to 1.00 at N = 50) and PLS’s intervals further off the larger the sample, its estimates being attenuated. Here the PLSc percentile interval covers about .95 at every N: the paper’s over-coverage comes from inadmissible bootstrap draws. K4, related to nothing, has no determined weights at any N, so 57% to 89% of the PLSc solutions are inadmissible (a reliability or loading above 1). matrixpls, which the paper used, keeps such bootstrap draws by default (dropInadmissible = FALSE); their SDs reach 100, and intervals built from them cover almost always (matrixpls at N = 50: .99 percentile, .995 normal; with the draws dropped .94). The app drops them (ρA in (0, 1], correlations within ±1). The card simulates 500 samples at N = 50, 250 and 1,000, each estimated by PLS and PLSc (cSEM) with 1,000 bootstrap samples and percentile intervals. The diagram is fitted to one sample of 250 from that population (seed 2018). ' +
      AGUIRRE2018_DIFFERS +
      FACTOR_POPULATION +
      ' Opens its card on the Analyses tab beside the diagram.',
    shows:
      'γ1 (.48): PLSc mean .47, .48, .48 with coverage .94, .96, .96 at N = 50, 250, 1,000 (paper .99, .96, .96, read off Figure C1); PLS mean about .41 at every N, coverage .88, .64, .10. The paper’s PLS figures (.91 down to .44) pool its 12 measurement conditions; the PLS limits of those conditions (.355 to .464) imply about .46 pooled the same way. γ4 (0): Type I error PLSc .07, .05, .05; PLS .03, .01, .05. Inadmissible PLSc solutions: 89%, 68% and 57%.',
    ...aguirre2018Card(0, 'percentile'),
  },
  {
    id: 'aguirre-ronkko-bca',
    title: 'Monte Carlo: BCa bootstrap intervals for PLSc (Aguirre-Urreta & Rönkkö 2018)',
    description:
      'Aguirre-Urreta & Rönkkö asked whether bootstrap confidence intervals of PLSc paths cover the population value as often as they claim. Their simple model: four common factors K1 to K4 affect E1 with .48, .48, .48 and 0 (R² .69), three indicators each loading .7, .8 and .9. This card checks the bias-corrected and accelerated (BCa) interval, which shifts the percentile limits by the bootstrap’s median bias and by an acceleration taken from a jackknife (one refit per case). The paper recommends the percentile interval over BCa. Here BCa covers less than the percentile interval at N = 50 (.82 against .94 for γ1) and about as well at 250. K4, related to nothing, has no determined weights, so most PLSc solutions are inadmissible (a reliability or loading above 1); the app drops inadmissible bootstrap draws (ρA in (0, 1], correlations within ±1) and keeps the jackknife estimates that are finite. The card simulates 500 samples at N = 50 and 250 (not 1,000: the jackknife refits the model N times per sample), each estimated by PLS and PLSc (cSEM) with 1,000 bootstrap samples and BCa intervals. The diagram is fitted to one sample of 250 from that population (seed 2018). ' +
      AGUIRRE2018_DIFFERS +
      FACTOR_POPULATION +
      ' Opens its card on the Analyses tab beside the diagram.',
    shows:
      'γ1 (.48): PLSc mean .47, .48 with BCa coverage .82, .93 at N = 50, 250 (percentile card .94, .96); PLS mean .41, coverage .86, .64. γ4 (0): Type I error PLSc .12, .06; PLS .05, .02. Inadmissible PLSc solutions: 89% and 68%.',
    ...aguirre2018Card(0, 'bca', [50, 250]),
  },
  {
    id: 'aguirre-ronkko-normal',
    title:
      'Monte Carlo: normal bootstrap intervals for PLS and PLSc (Aguirre-Urreta & Rönkkö 2018)',
    description:
      'Aguirre-Urreta & Rönkkö asked whether bootstrap confidence intervals of PLSc paths cover the population value as often as they claim. Their simple model: four common factors K1 to K4 affect E1 with .48, .48, .48 and 0 (R² .69), three indicators each loading .7, .8 and .9. This card checks the normal interval, the estimate ± 1.96 bootstrap SE. The paper’s PLSc normal interval covers about .998 at every N and never settles, which it puts down to heavy-tailed bootstrap distributions. K4, related to nothing, has no determined weights at any N, so 57% to 89% of the PLSc solutions are inadmissible (a reliability or loading above 1). matrixpls, which the paper used, keeps such bootstrap draws by default (dropInadmissible = FALSE); their SDs reach 100, and intervals built from them cover almost always (matrixpls at N = 50: .99 percentile, .995 normal; with the draws dropped .94). The app drops them (ρA in (0, 1], correlations within ±1). With those draws dropped the interval comes close to .95. The card simulates 500 samples at N = 50, 250 and 1,000, each estimated by PLS and PLSc (cSEM) with 1,000 bootstrap samples and normal intervals. The diagram is fitted to one sample of 250 from that population (seed 2018). ' +
      AGUIRRE2018_DIFFERS +
      FACTOR_POPULATION +
      ' Opens its card on the Analyses tab beside the diagram.',
    shows:
      'γ1 (.48): PLSc coverage .92, .94, .96 at N = 50, 250, 1,000 (paper about .998 throughout); PLS .92, .65, .11 (paper, strong paths, .91, .75, .44). γ4 (0): Type I error PLSc .07, .03, .01 (conservative at 1,000: K4’s admissible draws are the more spread ones); PLS .07, .04, .06.',
    ...aguirre2018Card(0, 'normal'),
  },
  {
    id: 'aguirre-ronkko-correlated',
    title:
      'Monte Carlo: BCa intervals for PLSc with correlated predictors (Aguirre-Urreta & Rönkkö 2018)',
    description:
      'Aguirre-Urreta & Rönkkö’s correlated condition: the four common factors K1 to K4 correlated .3 and the paths rescaled to .3795, .3795, .3795 and 0 so that R² stays .69, three indicators each loading .7, .8 and .9, BCa intervals. K4 is now related to E1 through the other factors, so its weights are better determined: inadmissible PLSc solutions are 71% at N = 50 and 19% at 250, against 89% and 68% with uncorrelated factors; the paper finds this condition better behaved throughout. PLS attenuates the paths of K1 to K3 and moves part of their effect onto K4: its estimate of the zero path is biased upward, and its Type I error grows with N (the paper: PLS intervals for γ4 miss at the lower limit). The card simulates 500 samples at N = 50 and 250 (not 1,000: the BCa jackknife refits the model N times per sample), each estimated by PLS and PLSc (cSEM) with 1,000 bootstrap samples and BCa intervals. The diagram is fitted to one sample of 250 from that population (seed 2018). ' +
      AGUIRRE2018_DIFFERS +
      FACTOR_POPULATION +
      ' Opens its card on the Analyses tab beside the diagram.',
    shows:
      'γ1 (.3795): PLSc mean .38, .38 with BCa coverage .89, .94 at N = 50, 250 (paper about .94 to .96); PLS mean .33, .34, coverage .90, .86. γ4 (0): PLSc Type I error .07, .08 (paper about .05 to .07); PLS mean .04, .03 and Type I error .07, .12. Inadmissible PLSc solutions: 71% and 19%.',
    ...aguirre2018Card(0.3, 'bca', [50, 250]),
  },
  {
    id: 'chin-interaction-2',
    title: 'Monte Carlo: a latent interaction with two indicators per construct (Chin et al. 2003)',
    description:
      'Chin, Marcolin & Newsted’s Monte Carlo: two uncorrelated common factors X and Z and their product predict Y (.3, .5, and .3 for X·Z), and PLS estimates the interaction with product indicators, every product of a standardised indicator of X with one of Z. With two indicators per construct (loadings .7) the four product indicators are unreliable (loadings .49), and PLS puts X·Z at about .17 for .3 at every N, X at .20 and Z at .33: attenuated, as single scale scores would be. Regression on the product of sum scores gives about .15. A larger sample only narrows the estimates around the wrong value: at N = 500 their SD is .04, so the estimate is clearly non-zero but still about 45% too small. ' +
      'The card simulates 500 samples at N = 20, 50, 100, 150, 200 and 500, each estimated by PLS (cSEM, product indicators) and by regression on sum scores. The diagram is fitted with seminr’s product-indicator interaction to one sample of 100 from that population (seed 2003). ' +
      CHIN_DIFFERS +
      FACTOR_POPULATION +
      ' Opens its card on the Analyses tab beside the diagram.',
    shows:
      'X·Z (true .30), mean of 500 estimates at N = 20 / 100 / 500: PLS about .16, .18, .17 (the paper’s Table 7, two indicators, N = 500: .165), sum scores .14, .15, .16, OLS power .08, .38, .97; X → Y (.30) about .19 to .22 (Table 7 at 500: .198), Z → Y (.50) about .33 (.328). Mean / SD at N = 100: .18 / .11 = 1.6, short of the paper’s 1.66. PLS without convergence in 2 of 500 samples at N = 20 and 50.',
    ...chinCard('chin2003-2', 2, [20, 50, 100, 150, 200, 500]),
  },
  {
    id: 'chin-interaction-8',
    title:
      'Monte Carlo: a latent interaction with eight indicators per construct (Chin et al. 2003)',
    description:
      'The same population with eight indicators per construct, so 64 product indicators for X·Z. Now PLS recovers the interaction: about .31 at N = 100 (the paper .304) and within 10% of .3 from N = 50 to 200, while regression on sum scores stays near .25 at every N. The main effects stay attenuated (X about .27, Z about .43), since more indicators raise the composites’ reliability but not to 1. At small N, PLS’s X·Z estimate is lifted by chance correlations in the weights (about .33 at N = 50, SD .21); at N = 500 it settles at .26, the dip the paper put down to a simulation artifact (its .262). The card finds it too, with other software and random numbers, which suggests the attenuation is real and the smaller samples hide it. ' +
      'The card simulates 500 samples at N = 20, 50, 100, 150, 200 and 500, each estimated by PLS (cSEM, product indicators) and by regression on sum scores. The diagram is fitted with seminr’s product-indicator interaction to one sample of 100 from that population (seed 2004). ' +
      CHIN_DIFFERS +
      FACTOR_POPULATION +
      ' Opens its card on the Analyses tab beside the diagram.',
    shows:
      'X·Z (true .30) at N = 20 / 50 / 100 / 200 / 500: PLS about .27, .33, .31, .28, .26 (Table 7, eight indicators: .304 at 100, .300 at 200, .262 at 500), SD .39, .21, .10, .06, .04; sum scores .22 to .25 (Table 9 at 100: .249), OLS power .82 at N = 100. X → Y about .27 and Z → Y .40 to .44 (Table 7 at 100: .274, .431). Mean / SD at N = 100: 3.1, significant by the paper’s rule (2.36).',
    ...chinCard('chin2003-8', 8, [20, 50, 100, 150, 200, 500]),
  },
  {
    id: 'chin-interaction-unequal',
    title:
      'Monte Carlo: a latent interaction with unequal loadings, PLS against sum scores (Chin et al. 2003)',
    description:
      'Chin et al.’s Table 10: six indicators per construct, but those of X and Z unequally reliable (pattern A7, loadings .7, .7, .6, .6, .3, .3; Y’s .7), at N = 100. PLS weights the indicators, so the weak ones count less, and its X·Z estimate stays near .3 (about .31); regression on the product of sum scores weights them all equally and falls to about .20. Both attenuate the main effects (X about .24 to .25, Z .38 to .39). ' +
      'The card simulates 500 samples at N = 100, each estimated by PLS (cSEM, product indicators) and by regression on sum scores. The diagram is fitted with seminr’s product-indicator interaction to one sample of 100 from that population (seed 2005). ' +
      CHIN_DIFFERS +
      FACTOR_POPULATION +
      ' Opens its card on the Analyses tab beside the diagram.',
    shows:
      'X·Z (true .30) at N = 100: PLS about .31, SD .15 (Table 10, pattern A7: .304), sum scores .20, SD .09 (.189), OLS power .59; X → Y about .25 (PLS) and .24 (sum scores), Z → Y .38 and .39.',
    ...chinCard('chin2003-a7', 6, [100], [0.7, 0.7, 0.6, 0.6, 0.3, 0.3]),
  },
  {
    id: 'qureshi-small',
    title: 'Monte Carlo: small group differences, PLS and CB-SEM (Qureshi & Compeau 2009)',
    description:
      'Qureshi & Compeau’s question: when two groups differ in their paths, which finds it, PLS with a t test on the two groups’ bootstrap standard errors, or a multigroup CB-SEM model with a χ² difference test? A and B (uncorrelated) predict C, A and C predict D, each construct measured by three indicators (.7, .8, .9); the baseline group’s paths are .05, .20, .35 and .60, the comparison group’s each differ by .15 (.20, .35, .50, .45). With 100 cases per group either method finds such a difference in about one test in five, with 500 in about two in three, and they hardly differ. PLS estimates the differences smaller (about .12 to .13 for .15) because it attenuates both groups’ paths; ML is unbiased with larger SDs, and improper in 2% of samples at n = 100. The paper found no detection at all at n = 100 and CB-SEM well ahead at 500 (76% against 40%); the card does not reproduce that gap. ' +
      'The card simulates 500 samples of two groups of n = 100 and of n = 500, each group estimated by PLS (cSEM, mode A, 200 bootstrap samples) and both by ML multigroup SEM (lavaan). The diagram is that multigroup model (equal loadings) fitted to two groups of 250 from the populations (lavaan::simulateData, seeds 2009 and 2010). ' +
      QURESHI_DIFFERS +
      FACTOR_POPULATION +
      ' Opens its card on the Analyses tab beside the diagram.',
    shows:
      'Detection of each path’s difference (true ±.15) at n = 100 / 500 per group: PLS A → C .16 / .56, B → C .08 / .59, A → D .22 / .79, C → D .25 / .75 (mean .18 / .67); ML .17 / .58, .13 / .58, .18 / .73, .23 / .72 (mean .18 / .65). The paper’s Table 2 (normal data, r = 0, three indicators, d = .15): PLS 0% / 40%, CB-SEM 0% / 76%. Mean estimated differences at n = 500: PLS about .12 to .13, ML .15.',
    ...qureshiCard('qureshi2009-small', 0, 3, [0.2, 0.35, 0.5, 0.45]),
  },
  {
    id: 'qureshi-uncorrelated',
    title:
      'Monte Carlo: group differences found by PLS and CB-SEM, uncorrelated predictors, three indicators (Qureshi & Compeau 2009)',
    description:
      'The same population with a larger difference: the comparison group’s paths are .40, .55, .70 and .25, each .35 from the baseline’s. With 100 cases per group both methods find a difference in about 70% of the tests, with 500 in all of them. The paper found CB-SEM far ahead at n = 100 (68% against 31% for PLS); here they are level, PLS a little lower on the paths into C and higher on A → D. PLS again shrinks the differences (about .27 to .30 for .35); ML recovers them. ' +
      'The card simulates 500 samples of two groups of n = 100 and of n = 500, each group estimated by PLS (cSEM, mode A, 200 bootstrap samples) and both by ML multigroup SEM (lavaan). The diagram is that multigroup model (equal loadings) fitted to two groups of 250 from the populations (lavaan::simulateData, seeds 2009 and 2010). ' +
      QURESHI_DIFFERS +
      FACTOR_POPULATION +
      ' Opens its card on the Analyses tab beside the diagram.',
    shows:
      'Detection at n = 100: PLS A → C .64, B → C .52, A → D .83, C → D .77 (mean .69); ML .68, .58, .74, .78 (mean .70); at n = 500 both 1.00. The paper’s Table 2 (r = 0, three indicators, d = .35): PLS 31% / 100%, CB-SEM 68% / 100%. Mean differences at n = 500: PLS .27 to .30, ML .35.',
    ...qureshiCard('qureshi2009-uncorrelated', 0, 3, [0.4, 0.55, 0.7, 0.25]),
  },
  {
    id: 'qureshi-correlated',
    title:
      'Monte Carlo: group differences found by PLS and CB-SEM, correlated predictors, six indicators (Qureshi & Compeau 2009)',
    description:
      'The paper’s most striking cell: predictors correlated .4, six indicators per construct, and a difference of .25 on every path (comparison paths .30, .45, .60, .35). With 100 cases per group the paper found the differences in 96% of PLS’s tests and 4% of CB-SEM’s, and recommended PLS for such designs. The card finds no such reversal: both detect about half of them (PLS .50, ML .49), and at n = 500 nearly all (.99 and .98). The one systematic gap is in the estimates: PLS’s differences come out about .22 for .25, ML’s .25. Whatever gave the paper its 4%, it is not the χ² difference test as lavaan runs it here. Nor can any test give 96% here: from the SD of the difference estimates (about .10 to .15 at n = 100), the most powerful valid test at α = .05 finds them in about 52% of samples, the rate both methods reach. Checked outside the card: with no difference both tests reject 2% to 7% (they keep the 5% level), and PLS’s detection is the same with 1,000 bootstrap samples or the construct-level sign-change correction. ' +
      'The card simulates 500 samples of two groups of n = 100 and of n = 500, each group estimated by PLS (cSEM, mode A, 200 bootstrap samples) and both by ML multigroup SEM (lavaan). The diagram is that multigroup model (equal loadings) fitted to two groups of 250 from the populations (lavaan::simulateData, seeds 2009 and 2010). ' +
      QURESHI_DIFFERS +
      FACTOR_POPULATION +
      ' Opens its card on the Analyses tab beside the diagram.',
    shows:
      'Detection at n = 100: PLS A → C .38, B → C .33, A → D .66, C → D .64 (mean .50); ML .36, .40, .58, .63 (mean .49); at n = 500 PLS .97 to 1.00, ML .95 to 1.00. The paper’s Table 2 (r = .4, six indicators, d = .25): PLS 96% / 100%, CB-SEM 4% / 100%. Mean differences: PLS about .22, ML .25.',
    ...qureshiCard('qureshi2009-correlated', 0.4, 6, [0.3, 0.45, 0.6, 0.35]),
  },
  {
    id: 'pls-bootstrap-se',
    package: 'cSEM',
    title: 'Monte Carlo: how well the bootstrap estimates the SE of a PLS path',
    source:
      'PLS Studio: the bootstrap SE of PLS against the SD of the estimates, checked in cSEM, seminr, matrixpls and plspm',
    links: [
      { label: 'cSEM', url: 'https://cran.r-project.org/package=cSEM' },
      { label: 'seminr', url: 'https://cran.r-project.org/package=seminr' },
      { label: 'plspm', url: 'https://cran.r-project.org/package=plspm' },
      {
        label: 'matrixpls (archived)',
        url: 'https://cran.r-project.org/src/contrib/Archive/matrixpls/',
      },
    ],
    tags: FACTOR_DEBATE_TAGS,
    description:
      'Is the bootstrap a fair judge of a PLS estimate’s precision? Two uncorrelated common factors A and B affect C (.2 and .3), three indicators each loading .7, .8 and .9. The card simulates 500 samples at N = 50, 100, 250 and 500, each estimated by PLS (cSEM, mode A, path weighting) with 300 bootstrap samples, and the Boot SE / SD column sets each path’s mean bootstrap SE against the SD of its estimates across the samples, the precision the bootstrap is meant to estimate. ' +
      'Checked outside the card at N = 100 (200 samples, A → C): the ratio is the same in every R package that estimates PLS, cSEM 1.15, seminr 1.14, matrixpls 1.14 and plspm 1.24, and the same with 100, 500 or 2,000 bootstrap samples (1.15 each), so neither the software nor the number of draws causes it. Regression on sum scores, bootstrapped on the same samples, gives 1.02, and PLS with its weights held at the sample’s gives 0.93: the excess comes from re-estimating the weights in every bootstrap sample, where repeated cases make them vary more than they do between samples. It sits in the samples whose estimate came out small (the bootstrap SE correlates −.44 with the size of the estimate), where a construct’s weights are least determined. The diagram is fitted to one sample of 100 from that population (seed 2026). ' +
      FACTOR_POPULATION +
      ' Opens its card on the Analyses tab beside the diagram.',
    shows:
      'Boot SE / SD above 1 at small samples, more so for the weaker path: A → C (.2) 1.16 at N = 50, 1.20 at 100, 1.09 at 250 and 1.05 at 500; B → C (.3) 1.08, 1.10, 0.95 and 1.03. The intervals are too wide where the samples are small, which here offsets PLS’s downward bias (mean .19 for .2, .28 for .3), so coverage stays near .95 up to N = 100; at N = 500 the width is right but the bias remains and coverage falls to .92 and .87.',
    data: {
      package: 'cSEM',
      name: 'Bootstrap SE check, a sample of 100',
      file: 'examples/montecarlo/pls-bootstrap-se.csv',
    },
    constructs: ['A', 'B', 'C'].map((name) => f(name, items(name.toLowerCase(), 3))),
    paths: [
      ['A', 'C'],
      ['B', 'C'],
    ],
    panel: {
      kind: 'mc',
      population: BOOT_SE_POPULATION,
      estimators: [{ id: 'PLS', method: 'pls', consistent: false }],
      sampleSizes: [50, 100, 250, 500],
      replications: 500,
      seed: 2026,
      alpha: 0.05,
      bootSamples: 300,
      mcDraws: 0,
      inference: { signChange: 'none', interval: 'percentile' },
    },
    settings: {
      method: 'pls',
      plsPackage: 'cSEM',
      consistent: false,
      scheme: 'path',
      missing: 'casewise',
      seed: 2026,
    },
  },
  {
    id: 'sarstedt-factor-weak',
    title:
      'Monte Carlo: PLS, PLSc and CB-SEM on common factors with two weak indicators (Sarstedt et al. 2016)',
    description:
      'Sarstedt et al.’s Study I in its hardest cell: seven common factors, each measured by two indicators with loadings .5 (reliability .40), the condition where PLS’s composites carry the most measurement error. PLS underestimates every nonzero path by about a third to a half (Y1 → Y2 about .20 for .50), at every N: its mean absolute error over the twelve paths stays near .17 from N = 250 to 10,000. PLSc and ML SEM are consistent, but at N = 100 they pay with huge variance (MAE about .6, the factor correlations behind them estimated from two weak items) and ML SEM does not converge in about half the samples (Reinartz et al. found about half the solutions improper in this cell); from N = 500 on both beat PLS, and at 10,000 their error is a seventh of its. ' +
      SARSTEDT_RUN +
      ' The diagram is fitted to one sample of 250 from that population (MASS::mvrnorm, seed 2016). ' +
      SARSTEDT_DIFFERS +
      FACTOR_POPULATION +
      ' Opens its card on the Analyses tab beside the diagram.',
    shows:
      'At N = 100 / 250 / 500 / 1,000 / 10,000, Y1 → Y2 (true .50): PLS about .20 to .21 throughout; PLSc and ML SEM about .54 to .58 with SD about .5 at N = 100, then .53, .50, .50, .50 (SD .03 at 10,000). ML SEM does not converge in about half the samples at N = 100 and a tenth at 250. The paper’s MAE rows (2 indicators; loadings .5), averages over the other factor, show the same order: PLS best at N = 100, worst from 500 on.',
    ...sarstedtCard('sarstedt2016-factor-weak', [0.5, 0.5]),
  },
  {
    id: 'sarstedt-factor-unequal',
    title:
      'Monte Carlo: PLS, PLSc and CB-SEM on common factors with unequal loadings (Sarstedt et al. 2016)',
    description:
      'Sarstedt et al.’s Study I with a friendlier measurement model: seven common factors of four indicators, two loading .5 and two .9 (composite reliability about .82). PLS weights the strong indicators more and its bias shrinks, but does not vanish: Y1 → Y2 stays near .43 for .50 at every N, and its mean absolute error over the paths levels off near .04 while those of PLSc and ML SEM keep falling, to about .01 at N = 10,000. At N = 100 the three are about equally accurate, PLS slightly the best, which is the paper’s conclusion that the differences are marginal unless measurement is poor or samples are large. ' +
      SARSTEDT_RUN +
      ' The diagram is fitted to one sample of 250 from that population (MASS::mvrnorm, seed 2016). ' +
      SARSTEDT_DIFFERS +
      FACTOR_POPULATION +
      ' Opens its card on the Analyses tab beside the diagram.',
    shows:
      'At N = 100 / 1,000 / 10,000, Y1 → Y2 (true .50): PLS about .44, .43, .43; PLSc and ML SEM about .50 throughout, their SD shrinking from about .09 to .01. The paper’s Table 2 (4 indicators; loadings .5/.9) gives PLS MAE .09/.08 at N = 100 and .06/.04 at 10,000 against .01 for PLSc and CB-SEM; the card’s path rows show the same: no failed replications.',
    ...sarstedtCard('sarstedt2016-factor-unequal', [0.5, 0.5, 0.9, 0.9]),
  },
  {
    id: 'sarstedt-composite-equal',
    title:
      'Monte Carlo: PLS, PLSc and CB-SEM on composites of four indicators (Sarstedt et al. 2016)',
    description:
      'Sarstedt et al.’s Study II: the same seven constructs as composites, each the equally weighted sum of four indicators (weights .40) without measurement error, estimated as common factors by all three methods. PLS mode A estimates the composites’ paths without bias and its error shrinks with N, from about .06 at N = 100 to .01 at 10,000. PLSc corrects for measurement error the composites do not have: ρA of four weakly correlated indicators is low, so the correction roughly doubles the paths (Y1 → Y2 about 1.05 for .50) and blows up others, at every N. ML SEM does not converge in half or more of the samples, more as N grows and in none at 10,000, and where it does its paths are about as wrong (Y1 → Y2 about 1.0). ' +
      SARSTEDT_RUN +
      ' The diagram is fitted to one sample of 250 from that population (MASS::mvrnorm, seed 2016). ' +
      SARSTEDT_DIFFERS +
      COMPOSITE_POPULATION +
      ' Opens its card on the Analyses tab beside the diagram.',
    shows:
      'At N = 100 / 1,000 / 10,000, Y1 → Y2 (true .50): PLS about .51, .50, .50 (SD .07 to .01); PLSc about 1.10, 1.05, 1.04, with other paths far above 1; ML SEM about 1.0 where it converges, failing to in about 54% of samples at N = 100, 81% at 1,000 and all at 10,000. Table 3 of the paper (4 indicators, equal weights): MAE .07 to .01 for PLS, 2 to 18 for PLSc, about .8 for CB-SEM, which converged in fewer than half the runs.',
    ...sarstedtCard('sarstedt2016-composite-equal', [0.4, 0.4, 0.4, 0.4], 0.1875),
  },
  {
    id: 'sarstedt-composite-unequal',
    title:
      'Monte Carlo: PLS, PLSc and CB-SEM on composites with unequal weights (Sarstedt et al. 2016)',
    description:
      'Sarstedt et al.’s Study II with two unequally weighted indicators per composite (.30 and .90), estimated as common factors by all three methods. Mode A weights the indicators by their correlations with the neighbouring composites, not by the population’s weights, yet the paths come out right: PLS’s error falls from about .07 at N = 100 to .01 at 10,000. PLSc and ML SEM read the two indicators as a factor with unequal loadings and disattenuate by a reliability that does not exist: Y1 → Y2 comes out at 1.2 to 1.4 for .50, other paths are wildly off in either direction, and ML SEM does not converge in most samples. More data do not help; the bias is the model’s, not the sample’s. ' +
      SARSTEDT_RUN +
      ' The diagram is fitted to one sample of 250 from that population (MASS::mvrnorm, seed 2016). ' +
      SARSTEDT_DIFFERS +
      COMPOSITE_POPULATION +
      ' Opens its card on the Analyses tab beside the diagram.',
    shows:
      'At N = 100 / 1,000 / 10,000, Y1 → Y2 (true .50): PLS about .49, .50, .49 (SD .08 to .01); PLSc about 2.0 (SD over 4), 1.22, 1.21; ML SEM about 1.4, 1.3, 1.3, not converging in about 64%, 86% and 99% of samples. Table 3 of the paper (2 indicators, unequal weights): MAE .07 to .01 for PLS, 2.3 to 5 for PLSc, .5 to .7 for CB-SEM.',
    ...sarstedtCard('sarstedt2016-composite-unequal', [0.3, 0.9], 0.185),
  },
  {
    id: 'hair-mirror-unequal',
    title:
      'Monte Carlo: PLS, GSCA and sum scores on composites with unequal weights (Hair et al. 2017)',
    description:
      'Hair et al.’s comparison of the composite-based methods on Sarstedt et al.’s composite population: seven composites, each of four indicators with unequal weights .1, .3, .5 and .7. PLS (mode B) and GSCA estimate the composites’ weights and recover the paths ever more closely, their mean absolute error falling from about .07 at N = 100 to .006 at 10,000. Regression on sum scores weights the indicators equally, which is not the composite, so it underestimates the strong paths (Y1 → Y2 about .41 for .50) at every N: its error levels off near .05, about eight times theirs at N = 10,000. GSCA tests have the least power; on the weak paths (.15) at N = 100 PLS finds about 40%, as sum scores do, GSCA about 24%. ' +
      HAIR_MIRROR_RUN +
      ' The diagram is fitted to one sample of 250 from that population (MASS::mvrnorm, seed 2017). ' +
      HAIR_MIRROR_DIFFERS +
      COMPOSITE_POPULATION +
      ' Opens its card on the Analyses tab beside the diagram.',
    shows:
      'Mean absolute error of the paths at N = 100 / 250 / 1,000 / 10,000: PLS about .067, .040, .020, .006 and GSCA about .069, .041, .020, .006 (paper’s Figure 4, unequal weights, 4 indicators: .077/.078, .048/.047, .024/.024, .007/.007); sum scores .086, .068, .058, .052 (.089, .071, .058, .053). Power for the .15 paths at N = 100: PLS about .40, sum scores .43, GSCA .24 (Table A2: .70, .63, .41).',
    ...hairMirrorCard('hair2017-unequal', [0.1, 0.3, 0.5, 0.7], 0.093),
  },
  {
    id: 'hair-mirror-equal',
    title:
      'Monte Carlo: PLS, GSCA and sum scores on composites of eight equal weights (Hair et al. 2017)',
    description:
      'Hair et al.’s composite population with eight equally weighted indicators per composite (weights .25), the case that favours sum scores: their equal weights are the population’s, and they need no estimating. At N = 100 regression on sum scores is the most accurate of the three (mean absolute error about .06 against about .08 to .09 for PLS mode B and GSCA, which estimate eight weights per composite from 100 cases and overstate the paths); from N = 500 on the three are practically the same. GSCA’s tests have little power at N = 100 and PLS mode B’s have a raised Type I error (about 8%). ' +
      HAIR_MIRROR_RUN +
      ' The diagram is fitted to one sample of 250 from that population (MASS::mvrnorm, seed 2017). ' +
      HAIR_MIRROR_DIFFERS +
      COMPOSITE_POPULATION +
      ' Opens its card on the Analyses tab beside the diagram.',
    shows:
      'Mean absolute error of the paths at N = 100 / 250 / 1,000 / 10,000: sum scores about .063, .039, .019, .006; PLS .082, .043, .020, .006; GSCA .088, .045, .020, .006 (paper’s Figure 4, equal weights, 8 indicators: sum scores .066 at N = 100 against PLS .086, GSCA .093). Power for the .15 paths at N = 100: sum scores about .38, PLS .25, GSCA .04 (Table A2: .60, .84, .36); null paths rejected by PLS in about 8%.',
    ...hairMirrorCard('hair2017-equal', [0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25], 1 / 7),
  },
  {
    id: 'hwang-gsca-misspecified',
    package: 'cSEM',
    title: 'Monte Carlo: GSCA, PLS and CB-SEM when cross-loadings are left out (Hwang et al. 2010)',
    source:
      'Hwang, Malhotra, Kim, Tomiuk & Hong (2010), A comparative study on parameter recovery of three approaches to structural equation modeling: the misspecified model',
    links: [{ label: 'Hwang et al. (2010)', url: 'https://doi.org/10.1509/jmkr.47.4.699' }],
    tags: FACTOR_DEBATE_TAGS,
    description:
      'Hwang et al.’s misspecified model: three common factors in a chain (.6, .6), each measured by three indicators (loadings .7), with one cross-loading per factor (.21) that the estimated model leaves out, and an extra path E1 → E3 that is zero in the population. ML SEM, the method of the correct model, suffers most: the omitted cross-loadings link the blocks, and it puts their covariance into the paths, E1 → E2 about +10% and E2 → E3, which two of them feed, about +42%; the zero path comes out negative (about −.15) and significant in about half the samples at N = 400 and 500. PLS and GSCA, whose composites absorb the cross-loadings, stay close to their usual targets: about −13% on E1 → E2, 0 on E2 → E3, about 0 on the zero path. The paper’s conclusion: with misspecification the component methods recover the parameters better. ' +
      'The card simulates 500 samples at N = 100, 200, 300, 400 and 500, each estimated by PLS and GSCA (cSEM) and ML SEM (lavaan). The diagram is fitted to one sample of 300 from that population (lavaan::simulateData, seed 2010). ' +
      'As in the paper: the population (Figure 1, standardised), the misspecified model, normal data, N and 500 replications. The app’s choices: cSEM and lavaan where the paper used GeSCA and unnamed software for PLS (mode and scheme not given: here mode A, path weighting); the paper’s correctly specified model, which estimates the cross-loadings, is not possible in PLS without duplicating indicators (the paper does not say how it did) and is not part of the card, nor are its non-normal condition, its loadings and its bootstrap standard errors. The paper reports the relative bias averaged over the parameters (ML about +9.5% for the paths); the card gives each path’s. Random numbers differ from the paper’s, so results agree up to Monte Carlo error.' +
      FACTOR_POPULATION +
      ' Opens its card on the Analyses tab beside the diagram.',
    shows:
      'At N = 100 / 500: E1 → E2 (true .6) PLS and GSCA about .52, ML about .65 / .66; E2 → E3 (true .6) PLS and GSCA about .61 / .60, ML about .87 / .85; E1 → E3 (true 0) PLS and GSCA about 0, ML about −.17 / −.15, significant in about 14% / 55% of samples. No failed replications. The paper’s Figure 4: ML paths about +9.5%, PLS −5%, GSCA −6% on average.',
    data: {
      package: 'cSEM',
      name: 'Hwang et al. (2010), a sample of 300',
      file: 'examples/montecarlo/hwang2010.csv',
    },
    constructs: HWANG_POPULATION.constructs.map((x) => f(x.name, x.indicators)),
    paths: HWANG_POPULATION.paths.map((x): [string, string] => [x.from, x.to]),
    panel: {
      kind: 'mc',
      population: HWANG_POPULATION,
      estimators: [
        { id: 'PLS', method: 'pls', consistent: false },
        { id: 'GSCA', method: 'pls', consistent: false, approach: 'GSCA' },
        { id: 'CB-ML', method: 'cb', estimator: 'ML' },
      ],
      sampleSizes: [100, 200, 300, 400, 500],
      replications: 500,
      seed: 2010,
      alpha: 0.05,
      bootSamples: 0,
      mcDraws: 0,
    },
    settings: {
      method: 'pls',
      plsPackage: 'cSEM',
      plsApproach: 'GSCA',
      consistent: false,
      scheme: 'path',
      missing: 'casewise',
      seed: 2010,
    },
  },
  {
    id: 'cho-components',
    title: 'Monte Carlo: ML SEM, PLS and GSCA on a component population (Cho et al. 2022)',
    description:
      'Cho, Sarstedt & Hwang’s component population: four constructs in the simple model, each the first principal component of its three indicators (loadings .6, .7, .8), the block correlations of the paper’s Table S10. PLS (mode A or B) and GSCA estimate the components’ paths without bias, their mean absolute error falling from about .07 at N = 100 to .02 at 1,000. ML SEM treats each block as a common factor, which it is not, and gives an improper solution (a negative variance or a standardized loading beyond 1) in about 40% to 60% of the samples at every N, and badly biased paths where it gives one (E1 → E3 about .75 for .40, E1 → E4 about .55 for .20); its error stays above .3 as N grows. ' +
      CHO_RUN +
      ' The diagram is fitted to one sample of 500 from that population (MASS::mvrnorm, seed 2022). ' +
      CHO_DIFFERS +
      COMPOSITE_POPULATION +
      ' Opens its card on the Analyses tab beside the diagram.',
    shows:
      'Mean absolute error of the paths at N = 100 / 200 / 500 / 1,000: PLS mode A about .071, .049, .031, .021, mode B and GSCA about the same; ML about .59, .46, .34, .33 with 58%, 47%, 40% and 40% of solutions improper and a few not converging. Table S5 (component population, simple model, 3 indicators, r = 0) gives MLF .26 / .25 at N = 100 / 200 after dropping the improper ones, GSCA .07 / .05, PLS mode A .08 / .05; Table S1, 812 of 1,000 MLF solutions with problems at N = 100.',
    ...choCard('cho2022-components', true),
  },
  {
    id: 'cho-factors',
    title: 'Monte Carlo: ML SEM, PLS and GSCA on a factor population (Cho et al. 2022)',
    description:
      'Cho, Sarstedt & Hwang’s factor population: the same simple model with four common factors of three indicators (loadings .6, .7, .8). Now ML SEM is the consistent method: its mean absolute error falls from about .11 at N = 100 to .03 at 1,000, with a few improper solutions only at N = 100. PLS (mode A or B) and GSCA estimate composites of the factors, which underestimate the paths (E1 → E3 about .31 to .32 for .40) at every N, so their error levels off near .065; at N = 100 they are about as accurate as ML, whose variance is larger. With the component population the verdict reverses, which is the paper’s point: each method is right for its own construct representation. ' +
      CHO_RUN +
      ' The diagram is fitted to one sample of 500 from that population (MASS::mvrnorm, seed 2022). ' +
      CHO_DIFFERS +
      FACTOR_POPULATION +
      ' Opens its card on the Analyses tab beside the diagram.',
    shows:
      'Mean absolute error of the paths at N = 100 / 200 / 500 / 1,000: ML about .106, .073, .045, .031; PLS mode A about .088, .075, .068, .065; GSCA about .093, .078, .070, .066 (paper’s Figure 3, factor population by N: MLF .095, .065, .04, .03; GSCA and PLS .095, .08, .07, .068). E1 → E3 (true .40): ML about .39 to .40, PLS and GSCA about .31 to .32.',
    ...choCard('cho2022-factors', false),
  },
  {
    id: 'rhemtulla-composite-factor',
    package: 'lavaan',
    title:
      'Monte Carlo: a composite modelled as a common factor inflates its effects (Rhemtulla et al. 2020)',
    source:
      'Rhemtulla, van Bork & Borsboom (2020), Worse than measurement error: consequences of inappropriate latent variable measurement models, Part A as a sampling study',
    links: [
      { label: 'Rhemtulla et al. (2020)', url: 'https://doi.org/10.1037/met0000220' },
      { label: 'Code and materials (OSF)', url: 'https://osf.io/f8g4d/' },
    ],
    tags: COMPOSITE_DEBATE_TAGS,
    description:
      'Rhemtulla, van Bork & Borsboom’s argument as a sampling study: X affects M, M affects Y (.6 each, indirect effect .36), and M is the sum of three components that correlate .5, observed without error. Modelled as a common factor, M keeps only what its components share, which correlates more strongly with X and Y than the sum does, by √((1 + (p − 1)c) / (pc)) = √(4/3) here: the opposite of attenuation, and worse, the authors argue, than the measurement error the factor model is meant to remove. PLS and regression on sum scores estimate the composite’s paths; PLSc, correcting for error the composite does not have, inflates both paths to about .69 and the indirect effect to .48. ML SEM inflates them less (about .66), because a factor M cannot reproduce the correlation of X and Y under full mediation, so its χ² test rejects the model more often as N grows. The card simulates 1,000 samples at N = 100, 250 and 1,000, each estimated by PLS and PLSc (every construct as a common factor, cSEM), regression on sum scores and ML SEM (lavaan). The diagram is fitted to one sample of 250 from that population (MASS::mvrnorm, seed 2020). The paper fits its models to population covariance matrices, without samples; the card draws samples from a simpler population of its Part A (components that do not depend on X one by one, and no measurement error), so its numbers are the card’s own, the direction the paper’s.' +
      COMPOSITE_POPULATION +
      ' Opens its card on the Analyses tab beside the diagram.',
    shows:
      'At N = 100 / 250 / 1,000: PLS and sum scores about .60 for both paths and .36 for the indirect effect; PLSc about .69 and .48 (.6 · √(4/3) = .693 and .48, the inflation the paper derives); ML SEM about .65 to .66 and .43, its χ² test rejecting the model in about 21%, 51% and 99% of samples (RMSEA about .06 to .07).',
    data: {
      package: 'lavaan',
      name: 'Rhemtulla et al. (2020), a sample of 250',
      file: 'examples/montecarlo/rhemtulla2020.csv',
    },
    constructs: [f('X', ['x']), f('M', items('m', 3)), f('Y', ['y'])],
    paths: [
      ['X', 'M'],
      ['M', 'Y'],
    ],
    panel: {
      kind: 'mc',
      population: RHEMTULLA_POPULATION,
      estimators: [
        { id: 'PLS', method: 'pls', consistent: false },
        { id: 'PLSc', method: 'pls', consistent: true },
        { id: 'Sum scores', method: 'regression', dr: false },
        { id: 'CB-ML', method: 'cb', estimator: 'ML' },
      ],
      sampleSizes: [100, 250, 1000],
      replications: 1000,
      seed: 2020,
      alpha: 0.05,
      bootSamples: 0,
      mcDraws: 0,
      factorModel: true,
    },
    settings: CB('ML'),
  },
  {
    id: 'mulder-riclpm',
    package: 'lavaan',
    title: 'Random-intercept cross-lagged panel model (Mulder & Hamaker 2021)',
    source: 'Mulder & Hamaker (2021), Three extensions of the RI-CLPM: the basic RI-CLPM in lavaan',
    links: [
      {
        label: 'The RI-CLPM & extensions: lavaan',
        url: 'https://jeroendmulder.github.io/RI-CLPM/lavaan.html',
      },
      { label: 'Mulder & Hamaker (2021)', url: 'https://doi.org/10.1080/10705511.2020.1784738' },
      { label: 'Hamaker, Kuiper & Grasman (2015)', url: 'https://doi.org/10.1037/a0038889' },
    ],
    description:
      'The tutorial’s simulated data (N = 1,189) on two variables at five waves, and its basic RI-CLPM: random intercepts separate stable differences between persons from fluctuations within them, which carry the autoregressive and cross-lagged effects (χ² = 25.81, df = 21; FIML, the tutorial’s missing = "ML", whose observed-information standard errors it reproduces). Within persons, x predicts later y (0.12 to 0.19), y hardly predicts later x. The card also fits the traditional cross-lagged panel model for comparison. Opens its card on the Analyses tab.',
    shows:
      'Within-person lagged effects: x predicts later y (0.12 to 0.19, SE about 0.05) but y does not predict later x (within ±0.03), with χ² = 25.81 on 21 df. The random intercepts have variances .009 and .032 and covariance .010. The last table sets the RI-CLPM against the traditional CLPM, which lacks them.',
    data: { package: 'lavaan', name: 'RICLPM (Mulder & Hamaker 2021)', remote: RICLPM_DATA },
    constructs: [],
    paths: [],
    panel: { kind: 'riclpm', x: items('x', 5), y: items('y', 5), equal: false },
    settings: { ...CB('ML'), missing: 'fiml' },
  },
];
