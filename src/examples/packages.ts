// Examples from the R packages' own documentation: the dataset ships with the
// package (loaded in the browser's R at open time) and the model follows the
// package's help page, demo or tutorial. Models the editor cannot represent
// faithfully (PLS higher-order composites, ignored structural models) are left
// out or noted. Every R package the app calculates with has examples here.

import type { EsemRotation, MultigroupSpec } from '../engine/types';
import type { Correlation, ModelState, Settings } from '../model/project';
import { DEFAULT_SETTINGS, makeCovariancesExplicit, newId } from '../model/project';
import type { GrowthInput } from '../rengine/longitudinal';
import type { IrtModel } from '../rengine/items';
import type { LmmInput } from '../rengine/mixed';
import type { GmmOptions } from '../analyses/longitudinal';
import type { EndoPreset } from '../analyses/endo';
import type { MatchPreset } from '../analyses/match';
import type { DidOptions } from '../analyses/did';
import type { RegressionOptions } from '../analyses/regression';
import type { RsaPreset } from '../analyses/rsa';
import type { EfaPreset } from '../analyses/efa';
import type { DataFileFormat } from '../data/readFile';
import type { EgaOptions, NetworkOptions } from '../analyses/network';
import type { BCorrelationOptions } from '../analyses/bayes';
import type { BsemOptions } from '../rengine/bsem';
import type { AssessmentPreset } from '../analyses/plsAssessment';
import type { NcaPreset } from '../analyses/nca';

export type ExamplePackage = 'lavaan' | 'did' | 'fixest' | 'stats' | 'datasets' | 'carData' | 'faraway' | 'MASS' | 'nnet' | 'psych' | 'semfindr' | 'rsem' | 'mice' | 'lavaan.mi' | 'WeightIt' | 'MIIVsem' | 'modsem' | 'manymome' | 'cSEM' | 'seminr' | 'ltm' | 'poLCA' | 'lme4' | 'lcmm' | 'plspm' | 'ivreg' | 'REndo' | 'sampleSelection' | 'MatchIt' | 'RSA' | 'NCA' | 'genpathmox' | 'haven' | 'readxl' | 'bootnet' | 'EGAnet' | 'BayesFactor' | 'blavaan';
export const EXAMPLE_PACKAGES: ExamplePackage[] = ['lavaan', 'did', 'fixest', 'stats', 'datasets', 'carData', 'faraway', 'MASS', 'nnet', 'psych', 'semfindr', 'rsem', 'mice', 'lavaan.mi', 'WeightIt', 'MIIVsem', 'modsem', 'manymome', 'cSEM', 'seminr', 'plspm', 'ltm', 'poLCA', 'lme4', 'lcmm', 'ivreg', 'REndo', 'sampleSelection', 'MatchIt', 'RSA', 'NCA', 'genpathmox', 'haven', 'readxl', 'bootnet', 'EGAnet', 'BayesFactor', 'blavaan'];

interface ExConstruct {
  name: string; type?: 'factor' | 'composite'; mode?: 'A' | 'B'; indicators?: string[]; components?: string[];
  /** Observed covariate (CB-SEM fixed.x; conditional process analysis: enters every equation). */
  covariate?: boolean;
  /** Loading labels by indicator: loadings with the same label are equal. */
  labels?: Record<string, string>;
}

/** Analyses that open as a card on the Analyses tab, preset with the example's columns. */
export type ExamplePanel =
  | { kind: 'growth'; measures: string[]; times: number[]; shape: GrowthInput['shape']; covariates: string[]; timeVarying?: string[] }
  | { kind: 'irt'; items: string[]; model: IrtModel }
  | { kind: 'lca'; items: string[]; from: number; to: number }
  | ({ kind: 'lmm' } & LmmInput)
  | ({ kind: 'gmm' } & GmmOptions)
  | ({ kind: 'endo' } & EndoPreset)
  | ({ kind: 'match' } & MatchPreset)
  | ({ kind: 'rsa' } & RsaPreset)
  | ({ kind: 'nca' } & NcaPreset)
  | ({ kind: 'efa' } & EfaPreset)
  | ({ kind: 'did' } & DidOptions)
  | ({ kind: 'regression' } & Omit<RegressionOptions, 'plot'> & { plot?: string })
  | { kind: 'screen'; vars: string[] }
  | ({ kind: 'network' } & Partial<NetworkOptions>)
  | ({ kind: 'ega' } & Partial<EgaOptions>)
  | ({ kind: 'bcorrelation' } & BCorrelationOptions)
  | ({ kind: 'bsem' } & BsemOptions);

export interface PackageExample {
  id: string;
  package: ExamplePackage;
  title: string;
  /** Where the model comes from (help page, demo, publication). */
  source: string;
  /** The original documentation (R help pages, demos, tutorials, publications). */
  links: { label: string; url: string }[];
  description: string;
  /** The dataset in the package; `file`: shipped with the app instead (packages that cannot run in the browser's R). */
  /** file: a CSV shipped with the app; packageFile: an SPSS, Stata or Excel file shipped in the R package, read by R. */
  data: { package: ExamplePackage; name: string; na?: number[]; file?: string; packageFile?: { path: string; format: DataFileFormat; sheet?: string } };
  constructs: ExConstruct[];
  paths: [string, string][];
  correlations?: [string, string, Correlation['kind']][];
  /** [predictor, moderator, outcome, method?]: the method is seminr's interaction_term(method = …); absent = two_stage. */
  moderations?: ([string, string, string] | [string, string, string, 'orthogonal' | 'product_indicator'])[];
  /** CB-SEM: multiple groups; `free` names constructs by name (mapped to ids when the model is built). */
  multigroup?: MultigroupSpec;
  /** CB-SEM: indicators treated as ordered categorical (WLSMV). */
  ordered?: string[];
  /** CB-SEM: standard errors from the observed information (Mplus's ML default). */
  information?: 'observed';
  /** CB-SEM: the CFI/TLI baseline of uncorrelated variables (the source's syntax writes the exogenous covariances out). */
  baseline?: 'independence';
  multilevel?: ModelState['multilevel'];
  /** CB-SEM: exploratory SEM blocks of construct names. */
  esem?: { blocks: string[][]; rotation: EsemRotation; epsilon?: number; orthogonal?: boolean };
  /** Columns computed from the loaded data before anything else (as a help page recodes its data), and category labels for coded columns. */
  computed?: { name: string; expr: string }[];
  labels?: Record<string, string[]>;
  /** CB-SEM: the constant (triangle) on the canvas: meanstructure = TRUE, every indicator intercept free. */
  constant?: boolean;
  /** CB-SEM: arrows from the constant: latent means (or an observed variable's intercept), free, fixed or labelled. Implies `constant`. */
  means?: { construct: string; fixed?: number; label?: string }[];
  /** Conditional process analysis: the PROCESS model number the diagram is recognised as. */
  processModel?: number;
  /** Adds this analysis card instead of a diagram (constructs and paths are empty). */
  panel?: ExamplePanel;
  /** Adds a segmentation card for the example's diagram: REBUS (numbers of classes) or PATHMOX (segmentation variables; ordered ones with their categories in order). */
  segmentation?: { method?: 'rebus' | 'pathmox' | 'fimix' | 'pos'; from?: number; to?: number; segments?: { column: string; order?: string[] }[] };
  /** Adds the PLS-SEM assessment card for the example's diagram (which one, and the grouping column or omission distance). */
  assessment?: AssessmentPreset;
  /** Adds a Data screening card on the example's indicators, or (influence) an Influential cases card. */
  screening?: { tab: 'univariate' | 'normality' | 'outliers' | 'influence'; approach?: 'exact' | 'approximate' };
  settings: Partial<Settings>;
  /** Further topics the home screen shows (most are derived from the definition: examples/tags.ts). */
  tags?: string[];
}

const f = (name: string, indicators: string[], labels?: Record<string, string>): ExConstruct => ({ name, type: 'factor', mode: 'A', indicators, ...(labels ? { labels } : {}) });
/** A single observed variable (conditional process analysis), optionally a covariate. */
const v = (name: string, covariate = false): ExConstruct => ({ name, type: 'factor', mode: 'A', indicators: [name], ...(covariate ? { covariate } : {}) });
const c = (name: string, indicators: string[], mode: 'A' | 'B' = 'B'): ExConstruct => ({ name, type: 'composite', mode, indicators });
const items = (p: string, k: number, from = 1) => Array.from({ length: k }, (_, i) => `${p}${i + from}`);
const fan = (from: string[], to: string[]) => from.flatMap((a) => to.map((b): [string, string] => [a, b]));
/** The Mplus User's Guide examples (Muthén & Muthén): the guide's page for one example and its chapter's inputs, data and outputs. */
const mplusLinks = (ex: string) => [
  { label: `Mplus User’s Guide, example ${ex}`, url: `https://www.statmodel.com/usersguide/chap${ex.split('.')[0]}/ex${ex}.html` },
  { label: `Chapter ${ex.split('.')[0]}: inputs, data and outputs`, url: `https://www.statmodel.com/usersguide/chapter${ex.split('.')[0]}.shtml` },
];
const mplusData = (ex: string, pkg: ExamplePackage = 'lavaan') => ({ package: pkg, name: `Mplus example ${ex}`, file: `examples/mplus/ex${ex}.csv` });
const MPLUS_TAG = 'Mplus User’s Guide';
const MPLUS_SRC = (ex: string) => `Mplus User’s Guide (Muthén & Muthén 2017), example ${ex}`;
const regression = (family: RegressionOptions['family'], link: string, outcome: string, predictors: string[]) =>
  ({ kind: 'regression' as const, family, link, outcome, predictors, categorical: [], interactions: [], trials: '', weights: '', se: 'model' as RegressionOptions['se'], cluster: '' });

const BOLLEN = {
  constructs: [f('ind60', items('x', 3)), f('dem60', items('y', 4)), f('dem65', items('y', 4, 5))],
  paths: [['ind60', 'dem60'], ['ind60', 'dem65'], ['dem60', 'dem65']] as [string, string][],
  correlations: [['y1', 'y5', 'indicator'], ['y2', 'y4', 'indicator'], ['y2', 'y6', 'indicator'], ['y3', 'y7', 'indicator'], ['y4', 'y8', 'indicator'], ['y6', 'y8', 'indicator']] as [string, string, 'indicator'][],
};
const HS = [f('visual', items('x', 3)), f('textual', items('x', 3, 4)), f('speed', items('x', 3, 7))];
const MOBI = [c('Image', items('IMAG', 5), 'A'), c('Expectation', items('CUEX', 3), 'A'), c('Quality', items('PERQ', 7), 'A'), c('Value', items('PERV', 2), 'A'),
  c('Satisfaction', items('CUSA', 3), 'A'), c('Complaints', ['CUSCO'], 'A'), c('Loyalty', items('CUSL', 3), 'A')];
const CB = (estimator: Settings['estimator']): Partial<Settings> => ({ method: 'cbsem', estimator, missing: 'casewise' });
const CPA: Partial<Settings> = { method: 'process', missing: 'casewise', probe: 'percentiles', hc: 'none' };
const PLS = (plsPackage: 'cSEM' | 'seminr', consistent: boolean, scheme: Settings['scheme'] = 'path'): Partial<Settings> => ({ method: 'pls', plsPackage, consistent, scheme, missing: 'mean' });
/**
 * A cSEM help-page example: csem()'s defaults are consistent PLS, the path
 * scheme, .tolerance = 1e-05, .iter_max = 100 and .R = 499 resamples; the
 * Henseler (2020, 2021) examples set the factorial scheme and 1e-06.
 */
const CSEM = (consistent = true, scheme: Settings['scheme'] = 'path', stopExp = 5): Partial<Settings> => ({ ...PLS('cSEM', consistent, scheme), stopExp, maxIter: 100, bootSamples: 499 });
/** A seminr example: estimate_pls()'s defaults match the app's (path weighting, mean replacement, 300 iterations, 1e-07); bootstrap_model() resamples as the demo does. */
const SEMINR = (nboot: number, more: Partial<Settings> = {}): Partial<Settings> => ({ ...PLS('seminr', false), bootSamples: nboot, ...more });

export const PACKAGE_EXAMPLES: PackageExample[] = [
  {
    id: 'lavaan-hs', package: 'lavaan', title: 'Holzinger & Swineford: three-factor CFA', source: 'lavaan, ?cfa',
    links: [{ label: '?cfa', url: 'https://rdrr.io/cran/lavaan/man/cfa.html' }, { label: 'lavaan tutorial: CFA', url: 'https://lavaan.ugent.be/tutorial/cfa.html' }, { label: '?HolzingerSwineford1939', url: 'https://rdrr.io/cran/lavaan/man/HolzingerSwineford1939.html' }],
    description: 'Mental ability tests of 301 seventh- and eighth-grade children: visual, textual and speed factors, three tests each. The standard CFA example.',
    data: { package: 'lavaan', name: 'HolzingerSwineford1939' }, constructs: HS, paths: [], settings: CB('ML'),
  },
  {
    id: 'lavaan-hs-means', package: 'lavaan', title: 'Holzinger & Swineford with a mean structure', source: 'lavaan tutorial: mean structures; ?lavTestLRT',
    links: [{ label: 'lavaan tutorial: mean structures', url: 'https://lavaan.ugent.be/tutorial/means.html' }, { label: '?lavTestLRT', url: 'https://rdrr.io/cran/lavaan/man/lavTestLRT.html' }, { label: '?HolzingerSwineford1939', url: 'https://rdrr.io/cran/lavaan/man/HolzingerSwineford1939.html' }],
    description: 'The three-factor CFA fitted with meanstructure = TRUE: the constant (triangle) on the canvas frees the intercept of every test; the latent means stay at zero, so the fit is unchanged (χ² = 85.306, df = 24). Draw an arrow from the constant to a factor to estimate its mean instead.',
    data: { package: 'lavaan', name: 'HolzingerSwineford1939' }, constructs: HS, paths: [], constant: true, settings: CB('ML'),
  },
  {
    id: 'lavaan-poldem', package: 'lavaan', title: 'Industrialisation and political democracy', source: 'lavaan, ?sem (Bollen 1989)',
    links: [{ label: '?sem', url: 'https://rdrr.io/cran/lavaan/man/sem.html' }, { label: 'lavaan tutorial: SEM', url: 'https://lavaan.ugent.be/tutorial/sem.html' }, { label: '?PoliticalDemocracy', url: 'https://rdrr.io/cran/lavaan/man/PoliticalDemocracy.html' }],
    description: 'Bollen’s SEM with six correlated measurement errors and, as on lavaan’s help page, the loadings of democracy held equal across 1960 and 1965 (labels a, b, c; χ²(38) = 40.18). Right-click a loading to change its label.',
    data: { package: 'lavaan', name: 'PoliticalDemocracy' }, ...BOLLEN,
    constructs: [BOLLEN.constructs[0], f('dem60', items('y', 4), { y2: 'a', y3: 'b', y4: 'c' }), f('dem65', items('y', 4, 5), { y6: 'a', y7: 'b', y8: 'c' })], settings: CB('ML'),
  },
  {
    id: 'lavaan-hs-groups', package: 'lavaan', title: 'Measurement invariance across two schools', source: 'lavaan tutorial: multiple groups',
    links: [{ label: 'lavaan tutorial: multiple groups', url: 'https://lavaan.ugent.be/tutorial/groups.html' }, { label: '?HolzingerSwineford1939', url: 'https://rdrr.io/cran/lavaan/man/HolzingerSwineford1939.html' }],
    description: 'The three-factor CFA in the Grant-White (1) and Pasteur (2) schools with equal loadings and intercepts (scalar invariance, χ²(60) = 164.10). Compare the invariance levels under Groups.',
    data: { package: 'lavaan', name: 'HolzingerSwineford1939' }, constructs: HS, paths: [],
    multigroup: { column: 'school', invariance: 'scalar', free: [] }, settings: CB('ML'),
  },
  {
    id: 'lavaan-hs-esem', package: 'lavaan', title: 'Exploratory SEM: three rotated factors', source: 'lavaan tutorial: EFA (efa blocks)',
    links: [{ label: 'lavaan tutorial: EFA', url: 'https://lavaan.ugent.be/tutorial/efa.html' }, { label: '?efa', url: 'https://rdrr.io/cran/lavaan/man/efa.html' }],
    description: 'The Holzinger & Swineford factors in one efa block: every test loads on all three factors, geomin-rotated. Cross-loadings show where the CFA’s simple structure is too strict (x9 on visual).',
    data: { package: 'lavaan', name: 'HolzingerSwineford1939' }, constructs: HS, paths: [],
    esem: { blocks: [['visual', 'textual', 'speed']], rotation: 'geomin' }, settings: CB('ML'),
  },
  {
    id: 'lavaan-twolevel', package: 'lavaan', title: 'Two-level factor model', source: 'lavaan tutorial: multilevel SEM, ?Demo.twolevel',
    links: [{ label: 'lavaan tutorial: multilevel SEM', url: 'https://lavaan.ugent.be/tutorial/multilevel.html' }, { label: '?Demo.twolevel', url: 'https://rdrr.io/cran/lavaan/man/Demo.twolevel.html' }],
    description: 'Simulated data, 2500 people in 200 clusters, the tutorial’s model: within clusters a factor of y1–y3 regressed on x1–x3; between clusters a factor of the same items (fb in the tutorial) regressed on the cluster-level w1 and w2. Reproduces the tutorial: χ² = 8.092 on 10 df, 20 parameters; within, fw on x1 0.510, x2 0.407, x3 0.205; between, fb on w1 0.165 and w2 0.131. Results: switch Within / Between in the results header.',
    data: { package: 'lavaan', name: 'Demo.twolevel' },
    constructs: [f('fw', items('y', 3)), v('x1', true), v('x2', true), v('x3', true)], paths: [['x1', 'fw'], ['x2', 'fw'], ['x3', 'fw']],
    multilevel: { column: 'cluster', between: 'factors', betweenCovariates: ['w1', 'w2'] }, settings: CB('ML'),
  },
  {
    id: 'lavaan-growth', package: 'lavaan', title: 'Linear latent growth curve', source: 'lavaan tutorial: growth curve models (Demo.growth)',
    links: [{ label: '?growth', url: 'https://rdrr.io/cran/lavaan/man/growth.html' }, { label: 'lavaan tutorial: growth curves', url: 'https://lavaan.ugent.be/tutorial/growth.html' }, { label: '?Demo.growth', url: 'https://rdrr.io/cran/lavaan/man/Demo.growth.html' }],
    description: 'Four repeated measures t1–t4 (N = 400): random intercept and linear slope with time scores 0, 1, 2, 3, the first model of lavaan’s growth tutorial. Reproduces it: χ² = 8.069 on 5 df. Opens its card on the Analyses tab.',
    data: { package: 'lavaan', name: 'Demo.growth' }, constructs: [], paths: [],
    panel: { kind: 'growth', measures: items('t', 4), times: [0, 1, 2, 3], shape: 'linear', covariates: [] }, settings: CB('ML'),
  },
  {
    id: 'lavaan-growth-conditional', package: 'lavaan', title: 'Conditional latent curve model with time-varying covariates', source: 'lavaan tutorial: growth curve models (Demo.growth)',
    links: [{ label: 'lavaan tutorial: growth curve models', url: 'https://lavaan.ugent.be/tutorial/growth.html' }, { label: '?growth', url: 'https://rdrr.io/cran/lavaan/man/growth.html' }, { label: '?Demo.growth', url: 'https://rdrr.io/cran/lavaan/man/Demo.growth.html' }],
    description: 'The tutorial’s second model: intercept and linear slope over t1–t4 regressed on x1 and x2, and each occasion on its own time-varying covariate c1–c4 (Bollen & Curran’s conditional latent curve model). Opens its card on the Analyses tab.',
    data: { package: 'lavaan', name: 'Demo.growth' }, constructs: [], paths: [],
    panel: { kind: 'growth', measures: items('t', 4), times: [0, 1, 2, 3], shape: 'linear', covariates: ['x1', 'x2'], timeVarying: items('c', 4) }, settings: CB('ML'),
  },
  {
    id: 'did-mpdta', package: 'did', title: 'Minimum wages and teen employment: staggered difference-in-differences', source: 'did, ?att_gt and ?aggte (mpdta)',
    links: [{ label: '?att_gt', url: 'https://rdrr.io/cran/did/man/att_gt.html' }, { label: '?aggte', url: 'https://rdrr.io/cran/did/man/aggte.html' }, { label: '?mpdta', url: 'https://rdrr.io/cran/did/man/mpdta.html' }],
    description: 'Callaway & Sant’Anna (2021): log teen employment in 500 US counties, 2004–2007, with states raising the minimum wage in 2004, 2006 or 2007 (first.treat; 0 = never). Group-time effects against never-treated counties, aggregated overall (ATT −0.04) and by length of exposure, with the help page’s seed (09152024) for the bootstrap. Opens its card on the Analyses tab.',
    data: { package: 'did', name: 'mpdta' }, constructs: [], paths: [],
    panel: { kind: 'did', design: 'staggered', outcome: 'lemp', unit: 'countyreal', time: 'year', treated: 'first.treat', post: '', firstPeriod: null, covariates: [], control: 'nevertreated', eventStudy: true }, settings: { ...CB('ML'), seed: 9152024 },
  },
  {
    id: 'fixest-base-did', package: 'fixest', title: 'Two-way fixed effects with an event study', source: 'fixest, ?i and ?base_did',
    links: [{ label: '?i', url: 'https://rdrr.io/cran/fixest/man/i.html' }, { label: '?base_did', url: 'https://rdrr.io/cran/fixest/man/base_did.html' }, { label: 'fixest: difference-in-differences', url: 'https://lrberge.github.io/fixest/articles/fixest_walkthrough.html' }],
    description: 'fixest’s simulated panel: 104 individuals over 10 periods, about half treated from period 6 with a gradual effect on y. The help page’s model, y ~ x1 + i(period, treat, 5) | id + period: the treated group’s deviation in each period relative to period 5, with the overall before–after effect. Opens its card on the Analyses tab.',
    data: { package: 'fixest', name: 'base_did' }, constructs: [], paths: [],
    panel: { kind: 'did', design: 'twfe', outcome: 'y', unit: 'id', time: 'period', treated: 'treat', post: 'post', firstPeriod: 6, covariates: ['x1'], control: 'nevertreated', eventStudy: true }, settings: CB('ML'),
  },
  {
    id: 'stats-dobson', package: 'stats', title: 'Poisson regression: Dobson’s randomised trial', source: 'stats, ?glm (Dobson 1990, p. 93)',
    links: [{ label: '?glm', url: 'https://rdrr.io/r/stats/glm.html' }],
    description: 'The help page’s first example: counts in a 3 × 3 randomised controlled trial, counts ~ outcome + treatment with a Poisson log link. Opens its card on the Analyses tab.',
    data: { package: 'stats', name: 'Dobson (1990)', file: 'examples/regression/dobson.csv' }, constructs: [], paths: [], tags: ['Count data'],
    panel: { kind: 'regression', family: 'poisson', link: 'logit', outcome: 'counts', predictors: ['outcome', 'treatment'], categorical: ['outcome', 'treatment'], interactions: [], trials: '', weights: '', se: 'model', cluster: '' }, settings: CB('ML'),
  },
  {
    id: 'stats-clotting', package: 'stats', title: 'Gamma regression: blood clotting times', source: 'stats, ?glm (McCullagh & Nelder 1989, pp. 300–302)',
    links: [{ label: '?glm', url: 'https://rdrr.io/r/stats/glm.html' }],
    description: 'Clotting time of lot 1 against log(plasma concentration), a Gamma model with the inverse link, as on the help page (log(u) is a computed column). Opens its card on the Analyses tab.',
    data: { package: 'stats', name: 'clotting (McCullagh & Nelder)', file: 'examples/regression/clotting.csv' }, constructs: [], paths: [], computed: [{ name: 'log_u', expr: 'log(u)' }],
    panel: { kind: 'regression', family: 'gamma', link: 'logit', outcome: 'lot1', predictors: ['log_u'], categorical: [], interactions: [], trials: '', weights: '', se: 'model', cluster: '' }, settings: CB('ML'),
  },
  {
    id: 'datasets-infert', package: 'datasets', title: 'Logistic regression: infertility after abortion', source: 'datasets, ?infert (model1)',
    links: [{ label: '?infert', url: 'https://rdrr.io/r/datasets/infert.html' }],
    description: 'Trichopoulos et al. (1976): 248 women, infertility (case) on the numbers of spontaneous and induced abortions, logistic regression as on the help page. Odds ratios, classification accuracy and the Hosmer–Lemeshow test. Opens its card on the Analyses tab.',
    data: { package: 'datasets', name: 'infert' }, constructs: [], paths: [], tags: ['Logistic regression'],
    panel: { kind: 'regression', family: 'binomial', link: 'logit', outcome: 'case', predictors: ['spontaneous', 'induced'], categorical: [], interactions: [], trials: '', weights: '', se: 'model', cluster: '' }, settings: CB('ML'),
  },
  {
    id: 'mass-menarche', package: 'MASS', title: 'Probit regression with binomial counts: age of menarche', source: 'MASS, ?menarche',
    links: [{ label: '?menarche', url: 'https://rdrr.io/cran/MASS/man/menarche.html' }],
    description: 'Milicer & Szczotka (1966): in each age group, how many of the girls had reached menarche. Successes (Menarche) out of trials (Total) on Age, probit link, exactly the help page’s model. Opens its card on the Analyses tab.',
    data: { package: 'MASS', name: 'menarche' }, constructs: [], paths: [], tags: ['Binomial counts'],
    panel: { kind: 'regression', family: 'binomial', link: 'probit', outcome: 'Menarche', predictors: ['Age'], categorical: [], interactions: [], trials: 'Total', weights: '', se: 'model', cluster: '' }, settings: CB('ML'),
  },
  {
    id: 'mass-quine', package: 'MASS', title: 'Negative binomial regression: days absent from school', source: 'MASS, ?glm.nb (quine.nb1)',
    links: [{ label: '?glm.nb', url: 'https://rdrr.io/cran/MASS/man/glm.nb.html' }, { label: '?quine', url: 'https://rdrr.io/cran/MASS/man/quine.html' }],
    description: 'Quine’s 146 Australian schoolchildren: days absent on sex, age group, ethnicity and learner status, over-dispersed counts. The help page’s nested model Days ~ Sex/(Age + Eth*Lrn): sex, and within each sex the effects of age, ethnicity, learner and ethnicity × learner (interaction terms without those main effects). Opens its card on the Analyses tab.',
    data: { package: 'MASS', name: 'quine' }, constructs: [], paths: [], tags: ['Count data'],
    panel: { kind: 'regression', family: 'negbin', link: 'logit', outcome: 'Days', predictors: ['Sex'], categorical: [], interactions: [['Sex', 'Age'], ['Sex', 'Eth'], ['Sex', 'Lrn'], ['Sex', 'Eth', 'Lrn']], trials: '', weights: '', se: 'model', cluster: '' }, settings: CB('ML'),
  },
  {
    id: 'mass-housing', package: 'MASS', title: 'Ordinal regression: satisfaction with housing', source: 'MASS, ?polr (house.plr)',
    links: [{ label: '?polr', url: 'https://rdrr.io/cran/MASS/man/polr.html' }, { label: '?housing', url: 'https://rdrr.io/cran/MASS/man/housing.html' }],
    description: 'Madsen (1976): satisfaction (low, medium, high) of Copenhagen residents on perceived influence, housing type and contact with neighbours, a proportional-odds model weighted by the frequency of each combination, as on the help page. Opens its card on the Analyses tab.',
    data: { package: 'MASS', name: 'housing' }, constructs: [], paths: [], tags: ['Ordinal outcome'],
    panel: { kind: 'regression', family: 'ordinal', link: 'logistic', outcome: 'Sat', predictors: ['Infl', 'Type', 'Cont'], categorical: [], interactions: [], trials: '', weights: 'Freq', se: 'model', cluster: '' }, settings: CB('ML'),
  },
  {
    id: 'mass-birthwt', package: 'MASS', title: 'Logistic regression: risk factors for low birth weight', source: 'MASS, ?birthwt',
    links: [{ label: '?birthwt', url: 'https://rdrr.io/cran/MASS/man/birthwt.html' }],
    description: 'Hosmer & Lemeshow’s 189 births at Baystate Medical Center: low birth weight on age, weight, race, smoking, previous premature labours (ptd), hypertension, uterine irritability and physician visits (0, 1, 2+), with the help page’s recodes as computed columns. Opens its card on the Analyses tab.',
    data: { package: 'MASS', name: 'birthwt' }, constructs: [], paths: [], tags: ['Logistic regression'],
    computed: [{ name: 'ptd', expr: 'ptl > 0' }, { name: 'ftv2', expr: 'min(ftv, 2)' }], labels: { race: ['white', 'black', 'other'], ftv2: ['0', '1', '2+'] },
    panel: { kind: 'regression', family: 'binomial', link: 'logit', outcome: 'low', predictors: ['age', 'lwt', 'race', 'smoke', 'ptd', 'ht', 'ui', 'ftv2'], categorical: [], interactions: [], trials: '', weights: '', se: 'model', cluster: '' }, settings: CB('ML'),
  },
  {
    id: 'nnet-birthwt', package: 'nnet', title: 'Multinomial logistic regression: low birth weight', source: 'nnet, ?multinom (bwt.mu)',
    links: [{ label: '?multinom', url: 'https://rdrr.io/cran/nnet/man/multinom.html' }, { label: '?birthwt', url: 'https://rdrr.io/cran/MASS/man/birthwt.html' }],
    description: 'The help page fits multinom(low ~ ., bwt) on the same recoded birth-weight data: with two outcome levels one equation, equal to the logistic fit. Replace the outcome by a variable with more levels for one equation per level. Opens its card on the Analyses tab.',
    data: { package: 'MASS', name: 'birthwt' }, constructs: [], paths: [], tags: ['Multinomial outcome'],
    computed: [{ name: 'ptd', expr: 'ptl > 0' }, { name: 'ftv2', expr: 'min(ftv, 2)' }], labels: { race: ['white', 'black', 'other'], ftv2: ['0', '1', '2+'] },
    panel: { kind: 'regression', family: 'multinomial', link: 'logit', outcome: 'low', predictors: ['age', 'lwt', 'race', 'smoke', 'ptd', 'ht', 'ui', 'ftv2'], categorical: [], interactions: [], trials: '', weights: '', se: 'model', cluster: '' }, settings: CB('ML'),
  },
  {
    id: 'datasets-attitude', package: 'datasets', title: 'Linear regression: the attitude survey', source: 'datasets, ?attitude (Chatterjee & Price 1977)',
    links: [{ label: '?attitude', url: 'https://rdrr.io/r/datasets/attitude.html' }],
    description: 'Chatterjee & Price’s survey of 30 departments of a financial organisation: the overall rating of a department on the proportion of favourable responses to six questions (complaints, privileges, learning, raises, critical, advance), lm(rating ~ .) as on the help page. Opens its card on the Analyses tab.',
    data: { package: 'datasets', name: 'attitude' }, constructs: [], paths: [], tags: ['Textbook example'],
    panel: { kind: 'regression', family: 'gaussian', link: 'identity', outcome: 'rating', predictors: ['complaints', 'privileges', 'learning', 'raises', 'critical', 'advance'], categorical: [], interactions: [], trials: '', weights: '', se: 'model', cluster: '' }, settings: CB('ML'),
  },
  {
    id: 'datasets-swiss', package: 'datasets', title: 'Linear regression: Swiss fertility and socio-economic indicators', source: 'datasets, ?swiss (Mosteller & Tukey 1977)',
    links: [{ label: '?swiss', url: 'https://rdrr.io/r/datasets/swiss.html' }],
    description: 'A standardised fertility measure for 47 French-speaking provinces of Switzerland in 1888 on agriculture, examination, education, Catholic and infant mortality: lm(Fertility ~ .) as on the help page (Mosteller & Tukey, Data Analysis and Regression). Opens its card on the Analyses tab.',
    data: { package: 'datasets', name: 'swiss' }, constructs: [], paths: [], tags: ['Textbook example'],
    panel: { kind: 'regression', family: 'gaussian', link: 'identity', outcome: 'Fertility', predictors: ['Agriculture', 'Examination', 'Education', 'Catholic', 'Infant.Mortality'], categorical: [], interactions: [], trials: '', weights: '', se: 'model', cluster: '' }, settings: CB('ML'),
  },
  {
    id: 'cardata-duncan', package: 'carData', title: 'Linear regression: Duncan’s occupational prestige', source: 'carData, ?Duncan; Fox & Weisberg, An R Companion to Applied Regression, ch. 1',
    links: [{ label: '?Duncan', url: 'https://rdrr.io/cran/carData/man/Duncan.html' }, { label: 'An R Companion to Applied Regression', url: 'https://www.john-fox.ca/Companion/' }],
    description: 'Duncan’s (1961) 45 US occupations: prestige (percentage rated good or better) on income and education (percentages of incumbents earning $3,500 or more and with a high-school diploma), the opening regression of Fox & Weisberg’s Companion: lm(prestige ~ income + education). Opens its card on the Analyses tab.',
    data: { package: 'carData', name: 'Duncan' }, constructs: [], paths: [], tags: ['Textbook example'],
    panel: { kind: 'regression', family: 'gaussian', link: 'identity', outcome: 'prestige', predictors: ['income', 'education'], categorical: [], interactions: [], trials: '', weights: '', se: 'model', cluster: '' }, settings: CB('ML'),
  },
  {
    id: 'cardata-prestige', package: 'carData', title: 'Linear regression: Canadian occupational prestige', source: 'carData, ?Prestige; Fox & Weisberg, An R Companion to Applied Regression, ch. 4',
    links: [{ label: '?Prestige', url: 'https://rdrr.io/cran/carData/man/Prestige.html' }, { label: 'An R Companion to Applied Regression', url: 'https://www.john-fox.ca/Companion/' }],
    description: 'Pineo–Porter prestige of 102 Canadian occupations (1971) on education, log₂ income and percentage of women, as in the Companion: lm(prestige ~ education + log2(income) + women); the log is a computed column. Opens its card on the Analyses tab.',
    data: { package: 'carData', name: 'Prestige' }, constructs: [], paths: [], tags: ['Textbook example'],
    computed: [{ name: 'log2_income', expr: 'log2(income)' }],
    panel: { kind: 'regression', family: 'gaussian', link: 'identity', outcome: 'prestige', predictors: ['education', 'log2_income', 'women'], categorical: [], interactions: [], trials: '', weights: '', se: 'model', cluster: '' }, settings: CB('ML'),
  },
  {
    id: 'faraway-gala', package: 'faraway', title: 'Poisson regression: species on the Galápagos islands', source: 'faraway, ?gala; Faraway, Extending the Linear Model with R, ch. 5',
    links: [{ label: '?gala', url: 'https://rdrr.io/cran/faraway/man/gala.html' }, { label: 'Extending the Linear Model with R', url: 'https://julianfaraway.github.io/faraway/ELM/' }],
    description: 'Johnson & Raven’s (1973) counts of plant species on 30 Galápagos islands on area, elevation, distance to the nearest island and to Santa Cruz, and the area of the adjacent island: Faraway’s Poisson log-linear model, glm(Species ~ Area + Elevation + Nearest + Scruz + Adjacent, poisson). The large residual deviance (717 on 24 df) is his point about overdispersion. Opens its card on the Analyses tab.',
    data: { package: 'faraway', name: 'gala' }, constructs: [], paths: [], tags: ['Count data', 'Textbook example'],
    panel: { kind: 'regression', family: 'poisson', link: 'log', outcome: 'Species', predictors: ['Area', 'Elevation', 'Nearest', 'Scruz', 'Adjacent'], categorical: [], interactions: [], trials: '', weights: '', se: 'model', cluster: '' }, settings: CB('ML'),
  },
  {
    id: 'miivsem-bollen', package: 'MIIVsem', title: 'Political democracy by MIIV-2SLS', source: 'MIIVsem, bollen1989a',
    links: [{ label: '?miive', url: 'https://rdrr.io/cran/MIIVsem/man/miive.html' }, { label: '?bollen1989a', url: 'https://rdrr.io/cran/MIIVsem/man/bollen1989a.html' }],
    description: 'The same model estimated equation by equation with model-implied instrumental variables (Bollen 1996). Correlated errors remove the instruments they invalidate; Sargan tests check each overidentified equation.',
    data: { package: 'MIIVsem', name: 'bollen1989a' }, ...BOLLEN, settings: CB('2SLS'),
  },
  // The Mplus User's Guide examples: generated data (N = 500, 1100 for the two-group examples) published with each example,
  // shipped with the app, with Mplus's defaults (mean structure, observed information, geomin epsilon). The tests compare each with
  // the numbers its Mplus output prints (scripts/validation/mplus_printed.py, src/engine/__fixtures__/textbook/mplus_printed.json).
  {
    id: 'mplus-ex3.1', package: 'stats', title: 'Linear regression (Mplus ex. 3.1)', source: MPLUS_SRC('3.1'), links: mplusLinks('3.1'),
    description: 'Mplus’s first example: a linear regression of y1 on x1 and x3 (generated data, N = 500). R’s lm gives the coefficients and the log-likelihood Mplus prints (−694.334). Mplus estimates by maximum likelihood, R by least squares: the residual variance (Mplus 0.941) and the standard errors (Mplus 0.043, 0.042, 0.044) are divided by N there and by N − 3 here, so the card’s are about 0.3% larger (residual standard deviation 0.973, standard errors up to 0.001 larger). Opens its card on the Analyses tab.',
    data: mplusData('3.1', 'stats'), constructs: [], paths: [], tags: [MPLUS_TAG],
    panel: regression('gaussian', 'identity', 'y1', ['x1', 'x3']), settings: CB('ML'),
  },
  {
    id: 'mplus-ex3.5', package: 'stats', title: 'Logistic regression (Mplus ex. 3.5)', source: MPLUS_SRC('3.5'), links: mplusLinks('3.5'),
    description: 'A binary u1 regressed on x1 and x3 by maximum likelihood (Mplus: ESTIMATOR = ML, log-likelihood −202.620). R’s glm with a logit link gives the same coefficients and log-likelihood. Opens its card on the Analyses tab.',
    data: mplusData('3.5', 'stats'), constructs: [], paths: [], tags: [MPLUS_TAG, 'Logistic regression'],
    panel: regression('binomial', 'logit', 'u1', ['x1', 'x3']), settings: CB('ML'),
  },
  {
    id: 'mplus-ex3.7', package: 'stats', title: 'Poisson regression (Mplus ex. 3.7)', source: MPLUS_SRC('3.7'), links: mplusLinks('3.7'),
    description: 'A count u1 regressed on x1 and x3 by Poisson regression. R’s glm with a log link gives the coefficients and the log-likelihood Mplus prints (−966.884). Mplus’s default estimator for counts is MLR, whose standard errors are White’s sandwich without a small-sample correction (HC0), so the card is set to HC0 and reproduces them: 0.027, 0.026 and 0.030 for x1, x3 and the intercept (HC3, the card’s small-sample choice, gives 0.028, 0.026 and 0.030). Opens its card on the Analyses tab.',
    data: mplusData('3.7', 'stats'), constructs: [], paths: [], tags: [MPLUS_TAG, 'Count data'],
    panel: { ...regression('poisson', 'log', 'u1', ['x1', 'x3']), se: 'HC0' }, settings: CB('ML'),
  },
  {
    id: 'mplus-ex3.11', package: 'lavaan', title: 'Path analysis with observed variables (Mplus ex. 3.11)', source: MPLUS_SRC('3.11'), links: mplusLinks('3.11'),
    description: 'Three covariates x1–x3 explain y1 and y2, which with x2 explain y3: Mplus’s path analysis of observed variables, conditional on the covariates (no residual covariance between y1 and y2). As in Mplus, the intercepts are estimated (the constant on the canvas) and the standard errors come from the observed information. Reproduces the Mplus output: log-likelihood −2364.002, 15 free parameters, χ² = 0.757 on 3 df, and every estimate and standard error.',
    data: mplusData('3.11'), tags: [MPLUS_TAG, 'Path analysis'],
    constructs: [v('x1', true), v('x2', true), v('x3', true), v('y1'), v('y2'), v('y3')],
    paths: [...fan(['x1', 'x2', 'x3'], ['y1', 'y2']), ['y1', 'y3'], ['y2', 'y3'], ['x2', 'y3']], constant: true, information: 'observed', settings: CB('ML'),
  },
  {
    id: 'mplus-ex5.1', package: 'lavaan', title: 'CFA with continuous indicators (Mplus ex. 5.1)', source: MPLUS_SRC('5.1'), links: mplusLinks('5.1'),
    description: 'Two correlated factors of three indicators each, the first loading of each fixed at 1, with Mplus’s defaults: intercepts estimated (the constant) and standard errors from the observed information. Reproduces the Mplus output: χ² = 3.896 on 8 df, log-likelihood −4906.609, 19 free parameters, and the estimates and standard errors (three loadings differ by 0.001 from Mplus’s, which stops at a looser convergence criterion).',
    data: mplusData('5.1'), tags: [MPLUS_TAG], constructs: [f('f1', items('y', 3)), f('f2', items('y', 3, 4))], paths: [], constant: true, information: 'observed', settings: CB('ML'),
  },
  {
    id: 'mplus-ex5.2', package: 'lavaan', title: 'CFA with binary indicators, WLSMV (Mplus ex. 5.2)', source: MPLUS_SRC('5.2'), links: mplusLinks('5.2'),
    description: 'The same two-factor model on six binary indicators u1–u6 declared categorical: thresholds and tetrachoric correlations with Mplus’s default WLSMV estimator and delta parameterisation. Every loading, threshold and factor (co)variance and their standard errors are those Mplus prints. The test statistics differ slightly in their adjustment: Mplus prints χ² = 5.482 on 8 df, lavaan’s scaled-shifted statistic is 5.474; lavaan’s SRMR (0.024) is computed differently from Mplus’s (0.021).',
    data: mplusData('5.2'), tags: [MPLUS_TAG], constructs: [f('f1', items('u', 3)), f('f2', items('u', 3, 4))], paths: [], ordered: items('u', 6), settings: CB('WLSMV'),
  },
  {
    id: 'mplus-ex5.6', package: 'lavaan', title: 'Second-order factor model (Mplus ex. 5.6)', source: MPLUS_SRC('5.6'), links: mplusLinks('5.6'),
    description: 'Four first-order factors of three indicators each load on one second-order factor f5, with Mplus’s defaults (intercepts estimated, observed-information standard errors). Reproduces the Mplus output: log-likelihood −7211.373, 40 free parameters, χ² = 46.743 on 50 df, and every estimate and standard error.',
    data: mplusData('5.6'), tags: [MPLUS_TAG],
    constructs: [f('f1', items('y', 3)), f('f2', items('y', 3, 4)), f('f3', items('y', 3, 7)), f('f4', items('y', 3, 10)), { name: 'f5', type: 'factor', mode: 'A', components: ['f1', 'f2', 'f3', 'f4'] }],
    paths: [], constant: true, information: 'observed', settings: CB('ML'),
  },
  {
    id: 'mplus-ex5.8', package: 'lavaan', title: 'CFA with covariates, MIMIC (Mplus ex. 5.8)', source: MPLUS_SRC('5.8'), links: mplusLinks('5.8'),
    description: 'Two factors regressed on three covariates x1–x3. Mplus frees the residual covariance of f1 and f2 by default (two factors regressed on the same covariates), drawn here as the double-headed arrow between their disturbances; intercepts and observed-information standard errors as Mplus. Reproduces the Mplus output: log-likelihood −4000.617, 25 free parameters, χ² = 20.023 on 20 df, and every estimate and standard error.',
    data: mplusData('5.8'), tags: [MPLUS_TAG, 'MIMIC'],
    constructs: [v('x1', true), v('x2', true), v('x3', true), f('f1', items('y', 3)), f('f2', items('y', 3, 4))],
    paths: fan(['x1', 'x2', 'x3'], ['f1', 'f2']), correlations: [['f1', 'f2', 'construct']], constant: true, information: 'observed', settings: CB('ML'),
  },
  {
    id: 'mplus-ex5.11', package: 'lavaan', title: 'SEM with an indirect effect (Mplus ex. 5.11)', source: MPLUS_SRC('5.11'), links: mplusLinks('5.11'),
    description: 'Four factors of three indicators: f1 and f2 (correlated) explain f3, which explains f4; intercepts and observed-information standard errors as Mplus. Reproduces the Mplus output: log-likelihood −9646.960, 40 free parameters, χ² = 53.704 on 50 df, and every estimate and standard error. Mplus’s example 5.12 is the same model with MODEL INDIRECT: the indirect effect of f1 on f4 through f3 is 0.266 (SE 0.043, delta method); the app’s effects table shows it standardised, and the indirect-effects card gives it unstandardised with a Monte Carlo or bootstrap interval.',
    data: mplusData('5.11'), tags: [MPLUS_TAG],
    constructs: [f('f1', items('y', 3)), f('f2', items('y', 3, 4)), f('f3', items('y', 3, 7)), f('f4', items('y', 3, 10))],
    paths: [['f1', 'f3'], ['f2', 'f3'], ['f3', 'f4']], constant: true, information: 'observed', settings: CB('ML'),
  },
  {
    id: 'mplus-ex5.13', package: 'modsem', title: 'Latent interaction by LMS (Mplus ex. 5.13)', source: MPLUS_SRC('5.13'), links: mplusLinks('5.13'),
    description: 'The model of example 5.11 on its own data, with the interaction of f1 and f2 on f3 (Mplus: f1 XWITH f2, TYPE = RANDOM, ALGORITHM = INTEGRATION): the latent moderated structural equations of Klein & Moosbrugger, which modsem’s LMS implements. Mplus estimates the interaction at 0.397, f3 on f1 0.439 and on f2 0.812, f4 on f3 0.585; modsem’s LMS gives 0.396, 0.438, 0.812 and 0.585 (the two programs integrate differently, so they agree to two decimals). Mplus estimates this model with MLR (robust standard errors) and reports a log-likelihood of −9672.065; modsem reports ML standard errors and its log-likelihood is not on the same footing, so AIC and BIC are not comparable with Mplus’s.',
    data: mplusData('5.13', 'modsem'), tags: [MPLUS_TAG],
    constructs: [f('f1', items('y', 3)), f('f2', items('y', 3, 4)), f('f3', items('y', 3, 7)), f('f4', items('y', 3, 10))],
    paths: [['f1', 'f3'], ['f2', 'f3'], ['f3', 'f4']], moderations: [['f1', 'f2', 'f3']], settings: { ...CB('ML'), interaction: 'lms' },
  },
  {
    id: 'mplus-ex5.14', package: 'lavaan', title: 'Two-group MIMIC model (Mplus ex. 5.14)', source: MPLUS_SRC('5.14'), links: mplusLinks('5.14'),
    description: 'The MIMIC model of example 5.8 in two groups (g: 1 = male, 2 = female; N = 1100) without a mean structure (Mplus: MODEL = NOMEANSTRUCTURE). Loadings are held equal across groups except that of y3 on f1, freed for females (MODEL female: f1 BY y3); regressions and residual variances differ by group. Standard errors from the expected information (Mplus: INFORMATION = EXPECTED; lavaan’s default). Reproduces the Mplus output: log-likelihood −8811.413, 35 free parameters, χ² = 41.735 on 43 df, and every estimate and standard error in both groups.',
    data: mplusData('5.14'), tags: [MPLUS_TAG, 'MIMIC'], labels: { g: ['male', 'female'] },
    constructs: [v('x1', true), v('x2', true), v('x3', true), f('f1', items('y', 3)), f('f2', items('y', 3, 4))],
    paths: fan(['x1', 'x2', 'x3'], ['f1', 'f2']), correlations: [['f1', 'f2', 'construct']],
    multigroup: { column: 'g', invariance: 'metric', free: [{ kind: 'loading', construct: 'f1', indicator: 'y3' }], meanStructure: false }, settings: CB('ML'),
  },
  {
    id: 'mplus-ex5.15', package: 'lavaan', title: 'Two-group MIMIC model with a mean structure (Mplus ex. 5.15)', source: MPLUS_SRC('5.15'), links: mplusLinks('5.15'),
    description: 'Example 5.14 with Mplus’s default mean structure: intercepts equal across groups and factor means fixed at zero for males and free for females, the loading and the intercept of y3 freed for females ([y3]). Observed-information standard errors as Mplus. Reproduces the Mplus output: log-likelihood −8812.330, 44 free parameters, χ² = 43.569 on 46 df, and every estimate and standard error in both groups.',
    data: mplusData('5.15'), tags: [MPLUS_TAG, 'MIMIC'], labels: { g: ['male', 'female'] },
    constructs: [v('x1', true), v('x2', true), v('x3', true), f('f1', items('y', 3)), f('f2', items('y', 3, 4))],
    paths: fan(['x1', 'x2', 'x3'], ['f1', 'f2']), correlations: [['f1', 'f2', 'construct']],
    multigroup: { column: 'g', invariance: 'scalar', free: [{ kind: 'loading', construct: 'f1', indicator: 'y3' }, { kind: 'intercept', indicator: 'y3' }] }, constant: true, information: 'observed', settings: CB('ML'),
  },
  {
    id: 'mplus-ex5.25', package: 'lavaan', title: 'SEM with EFA and CFA factors (Mplus ex. 5.25)', source: MPLUS_SRC('5.25'), links: mplusLinks('5.25'),
    description: 'Two exploratory factors f1 and f2 of y1–y6 (Mplus: f1-f2 BY y1-y6 (*1), geomin rotation) explain the CFA factor f3, which explains f4: exploratory SEM. Mplus’s geomin uses ε = 0.0001 with two factors (lavaan’s default is 0.001, which moves the rotated loadings and with them the factor correlation and the paths from f1 and f2), so the block is set to 0.0001; intercepts and observed-information standard errors as Mplus. Reproduces the Mplus output: log-likelihood −6482.762, 44 free parameters, χ² = 51.353 on 46 df, and every estimate and standard error.',
    data: mplusData('5.25'), tags: [MPLUS_TAG],
    constructs: [f('f1', items('y', 3)), f('f2', items('y', 3, 4)), f('f3', items('y', 3, 7)), f('f4', items('y', 3, 10))],
    paths: [['f1', 'f3'], ['f2', 'f3'], ['f3', 'f4']], esem: { blocks: [['f1', 'f2']], rotation: 'geomin', epsilon: 0.0001 }, constant: true, information: 'observed', settings: CB('ML'),
  },
  {
    id: 'mplus-ex6.1', package: 'lavaan', title: 'Linear growth model (Mplus ex. 6.1)', source: MPLUS_SRC('6.1'), links: mplusLinks('6.1'),
    description: 'y11–y14 over four occasions (Mplus: i s | y11@0 y12@1 y13@2 y14@3): intercept and slope factors with means, variances and covariance. lavaan’s growth() with observed-information standard errors (Mplus’s default) reproduces the Mplus output: log-likelihood −3016.386, 9 free parameters, χ² = 4.593 on 5 df, and every estimate and standard error. Opens its card on the Analyses tab.',
    data: mplusData('6.1'), constructs: [], paths: [], tags: [MPLUS_TAG],
    panel: { kind: 'growth', measures: items('y1', 4), times: [0, 1, 2, 3], shape: 'linear', covariates: [] }, information: 'observed', settings: CB('ML'),
  },
  {
    id: 'mplus-ex6.8', package: 'lavaan', title: 'Latent basis growth model (Mplus ex. 6.8)', source: MPLUS_SRC('6.8'), links: mplusLinks('6.8'),
    description: 'Growth with the shape of the curve estimated: the slope loadings of the third and fourth occasions are free (Mplus: i s | y11@0 y12@1 y13 y14). lavaan’s growth() with observed-information standard errors (Mplus’s default) reproduces the Mplus output: log-likelihood −3016.249, 11 free parameters, χ² = 4.319 on 3 df, and every estimate and standard error. Opens its card on the Analyses tab.',
    data: mplusData('6.8'), constructs: [], paths: [], tags: [MPLUS_TAG],
    panel: { kind: 'growth', measures: items('y1', 4), times: [0, 1, 2, 3], shape: 'basis', covariates: [] }, information: 'observed', settings: CB('ML'),
  },
  {
    id: 'mplus-ex6.9', package: 'lavaan', title: 'Quadratic growth model (Mplus ex. 6.9)', source: MPLUS_SRC('6.9'), links: mplusLinks('6.9'),
    description: 'Intercept, linear and quadratic growth factors over four occasions (Mplus: i s q | y11@0 y12@1 y13@2 y14@3). lavaan’s growth() with observed-information standard errors (Mplus’s default) reproduces the Mplus output: log-likelihood −3975.519, 13 free parameters, χ² = 0.475 on 1 df, and every estimate and standard error. Opens its card on the Analyses tab.',
    data: mplusData('6.9'), constructs: [], paths: [], tags: [MPLUS_TAG],
    panel: { kind: 'growth', measures: items('y1', 4), times: [0, 1, 2, 3], shape: 'quadratic', covariates: [] }, information: 'observed', settings: CB('ML'),
  },
  {
    id: 'mplus-ex6.10', package: 'lavaan', title: 'Growth model with time-invariant and time-varying covariates (Mplus ex. 6.10)', source: MPLUS_SRC('6.10'), links: mplusLinks('6.10'),
    description: 'Linear growth of y11–y14 with the intercept and slope regressed on x1 and x2, and each occasion regressed on its own time-varying covariate a31–a34 (Mplus: i s ON x1 x2; y11 ON a31; …). lavaan’s growth() with observed-information standard errors (Mplus’s default) reproduces the Mplus output: log-likelihood −3070.619, 17 free parameters, χ² = 25.786 on 21 df, and every estimate and standard error. Opens its card on the Analyses tab.',
    data: mplusData('6.10'), constructs: [], paths: [], tags: [MPLUS_TAG],
    panel: { kind: 'growth', measures: items('y1', 4), times: [0, 1, 2, 3], shape: 'linear', covariates: ['x1', 'x2'], timeVarying: items('a3', 4) }, information: 'observed', settings: CB('ML'),
  },
  {
    id: 'bollen-union', package: 'MIIVsem', title: 'Union sentiment of textile workers (Bollen 1989, ch. 4)', source: 'MIIVsem, ?bollen1989b; Bollen (1989), Structural Equations with Latent Variables, pp. 82–83',
    links: [{ label: '?bollen1989b', url: 'https://rdrr.io/cran/MIIVsem/man/bollen1989b.html' }],
    description: 'McDonald & Clelland’s (1984) 173 southern non-union textile workers: age and years in the mill (correlated) explain deference to managers, support for labour activism and union sentiment, a recursive path model of observed variables with free exogenous variances. Reproduces Bollen’s Table 4.3: union sentiment on deference −.218, activism .850, years .861; χ² = 1.26 on 3 df. Switch the estimator to MIIV-2SLS for Bollen’s own instrumental-variable estimates.',
    data: { package: 'MIIVsem', name: 'bollen1989b' }, tags: ['Path analysis', 'Textbook example'],
    constructs: [v('age'), v('yrsmill'), v('deferenc'), v('laboract'), v('unionsen')],
    // (the help page writes yrsmill ~~ age out: lavaan's baseline for CFI/TLI is then every variable uncorrelated)
    paths: [['age', 'deferenc'], ['age', 'laboract'], ['deferenc', 'laboract'], ['deferenc', 'unionsen'], ['laboract', 'unionsen'], ['yrsmill', 'unionsen']], baseline: 'independence', settings: CB('ML'),
  },
  {
    id: 'bollen-felson', package: 'MIIVsem', title: 'Are the good beautiful? A reciprocal effect (Felson & Bohrnstedt 1979)', source: 'MIIVsem, ?felson1979; Bollen (1989), ch. 4',
    links: [{ label: '?felson1979', url: 'https://rdrr.io/cran/MIIVsem/man/felson1979.html' }],
    description: 'Teenagers’ perceived academic ability and perceived attractiveness cause each other (N = 209): grade point average is the instrument for ability, height, weight and a stranger’s attractiveness rating for attractiveness. A non-recursive path model; χ² = 2.91 on 3 df, attractiveness ← ability 1.53, ability ← attractiveness −.02.',
    data: { package: 'MIIVsem', name: 'felson1979' }, tags: ['Non-recursive', 'Path analysis', 'Textbook example'],
    constructs: [v('gpa'), v('height'), v('weight'), v('rating'), v('acad'), v('attract')],
    paths: [['gpa', 'acad'], ['attract', 'acad'], ['height', 'attract'], ['weight', 'attract'], ['rating', 'attract'], ['acad', 'attract']], settings: CB('ML'),
  },
  {
    id: 'bollen-accessibility', package: 'MIIVsem', title: 'Perceived accessibility of clinics: his and her informants (Bollen, Speizer & Mroz 1996)', source: 'MIIVsem, ?bollen1996',
    links: [{ label: '?bollen1996', url: 'https://rdrr.io/cran/MIIVsem/man/bollen1996.html' }],
    description: 'Three female and three male informants in each of 220 Tanzanian clusters rated how accessible a family-planning clinic is and how easy it is to reach: the help page’s four factors (female and male accessibility, female and male ease), estimated as MIIVsem does, by MIIV-2SLS. Every Sargan test rejects (χ² 105 to 125 on 9 df, p < .001): each equation’s instruments do not fit the model as written. The variances and covariances estimated afterwards (var.cov) give factor correlations above 1 (female access with female ease 1.12, male 1.08), which R reports as a warning: as written, the four-factor model is misspecified for these data.',
    data: { package: 'MIIVsem', name: 'bollen1996' }, tags: ['CFA', 'Textbook example'],
    constructs: [f('femaleAccess', items('access', 3)), f('maleAccess', items('access', 3, 4)), f('femaleEasy', items('easy', 3)), f('maleEasy', items('easy', 3, 4))], paths: [],
    settings: CB('2SLS'),
  },
  {
    id: 'bollen-reisenzein', package: 'MIIVsem', title: 'Attribution, affect and helping (Reisenzein 1986)', source: 'MIIVsem, ?reisenzein1986',
    links: [{ label: '?reisenzein1986', url: 'https://rdrr.io/cran/MIIVsem/man/reisenzein1986.html' }, { label: 'Reisenzein (1986)', url: 'https://doi.org/10.1037/0022-3514.50.6.1123' }],
    description: 'Weiner’s attribution–affect model in a randomised vignette experiment (N = 138): whether a collapsed subway passenger is drunk or ill (the manipulation, an observed covariate) → perceived controllability → sympathy and anger → helping, each a three-indicator factor. The help page gives no model code: this is the model its description states in words (situation → controllability → sympathy and anger → helping), not necessarily Reisenzein’s published specification. χ² = 87.2 on 61 df.',
    data: { package: 'MIIVsem', name: 'reisenzein1986' }, tags: ['Mediation', 'Textbook example'],
    constructs: [v('Z1', true), f('controllability', ['Z2', 'Z3', 'Z4']), f('sympathy', ['Z5', 'Z6', 'Z7']), f('anger', ['Z8', 'Z9', 'Z10']), f('helping', ['Z11', 'Z12', 'Z13'])],
    paths: [['Z1', 'controllability'], ['controllability', 'sympathy'], ['controllability', 'anger'], ['sympathy', 'helping'], ['anger', 'helping']], settings: CB('ML'),
  },
  {
    id: 'miivsem-hs', package: 'MIIVsem', title: 'Holzinger & Swineford CFA by MIIV-2SLS', source: 'MIIVsem applied to lavaan’s HolzingerSwineford1939',
    links: [{ label: '?miive', url: 'https://rdrr.io/cran/MIIVsem/man/miive.html' }, { label: '?HolzingerSwineford1939', url: 'https://rdrr.io/cran/lavaan/man/HolzingerSwineford1939.html' }],
    description: 'Each loading estimated by its own 2SLS regression on the marker indicator, with Sargan tests per equation. Compare with the ML CFA.',
    data: { package: 'lavaan', name: 'HolzingerSwineford1939' }, constructs: HS, paths: [], settings: CB('2SLS'),
  },
  {
    id: 'modsem-oneint', package: 'modsem', title: 'Latent interaction by LMS', source: 'modsem, article “LMS and QML approaches” (oneInt)',
    links: [{ label: 'modsem: LMS and QML', url: 'https://modsem.org/articles/lms_qml.html' }, { label: '?modsem', url: 'https://rdrr.io/cran/modsem/man/modsem.html' }, { label: '?oneInt', url: 'https://rdrr.io/cran/modsem/man/oneInt.html' }],
    description: 'Simulated data (N = 2000) with one latent interaction: Y on X, Z and X × Z by the latent moderated structural equations method (Klein & Moosbrugger 2000), as modsem’s LMS article runs it: modsem(m1, oneInt, method = "lms"). Reproduces the article: Y on X 0.673, Z 0.569, X:Z 0.718; the likelihood-ratio test against the model without the interaction D = 676.56 on 1 df; the fit measures shown are those of that model (χ² 17.52 on 24 df), as modsem reports them. (?modsem’s first example uses the double-centring approach instead.)',
    data: { package: 'modsem', name: 'oneInt' },
    constructs: [f('X', items('x', 3)), f('Z', items('z', 3)), f('Y', items('y', 3))],
    paths: [['X', 'Y'], ['Z', 'Y']], moderations: [['X', 'Z', 'Y']], settings: { ...CB('ML'), interaction: 'lms' },
  },
  {
    id: 'manymome-med', package: 'manymome', title: 'Simple mediation with covariates', source: 'manymome, ?data_med (PROCESS model 4)',
    links: [{ label: '?data_med', url: 'https://rdrr.io/cran/manymome/man/data_med.html' }],
    description: 'x → m → y with control variables c1 and c2 (N = 100). The help page fits these equations with lavaan: a = 0.935, b = 0.785, indirect effect 0.733 (delta-method SE 0.236). Conditional process analysis estimates the same equations by least squares, which gives the same coefficients and indirect effect, with a percentile bootstrap interval (manymome) instead of the delta-method standard error.',
    data: { package: 'manymome', name: 'data_med' },
    constructs: [v('x'), v('m'), v('y'), v('c1', true), v('c2', true)], paths: [['x', 'm'], ['m', 'y'], ['x', 'y']], processModel: 4, settings: CPA,
  },
  {
    id: 'manymome-modmed', package: 'manymome', title: 'First-stage moderated mediation', source: 'manymome, vignette “Moderated mediation with lm()” (data_med_mod_a; PROCESS model 7)',
    links: [{ label: 'manymome: moderated mediation with lm()', url: 'https://sfcheung.github.io/manymome/articles/mome_lm.html' }, { label: '?data_med_mod_a', url: 'https://rdrr.io/cran/manymome/man/data_med_mod_a.html' }],
    description: 'w moderates the x → m path, as in manymome’s vignette: lm(m ~ x*w + c1 + c2) and lm(y ~ m + x + c1 + c2), 100 bootstrap samples with seed 54532, w probed at its mean and one SD either side. Reproduces the vignette: conditional indirect effects 3.060, 2.136 and 1.212, index of moderated mediation 0.938 [0.178, 1.732]. (The help page’s lavaan model also regresses y on w.)',
    data: { package: 'manymome', name: 'data_med_mod_a' },
    constructs: [v('x'), v('w'), v('m'), v('y'), v('c1', true), v('c2', true)], paths: [['x', 'm'], ['m', 'y'], ['x', 'y']], moderations: [['x', 'w', 'm']], processModel: 7, settings: { ...CPA, probe: 'meansd', bootSamples: 100, seed: 54532 },
  },
  {
    id: 'manymome-serial', package: 'manymome', title: 'Serial mediation', source: 'manymome, ?data_serial (PROCESS model 6)',
    links: [{ label: '?data_serial', url: 'https://rdrr.io/cran/manymome/man/data_serial.html' }],
    description: 'x → m1 → m2 → y with covariates c1 and c2 (N = 100). The help page fits these equations with lavaan and prints the serial indirect effect, 0.180 (delta-method SE 0.09); conditional process analysis estimates them by least squares (the same coefficients and indirect effect) with percentile bootstrap intervals, and adds the other two indirect paths and the total.',
    data: { package: 'manymome', name: 'data_serial' },
    constructs: [v('x'), v('m1'), v('m2'), v('y'), v('c1', true), v('c2', true)],
    paths: [['x', 'm1'], ['x', 'm2'], ['m1', 'm2'], ['x', 'y'], ['m1', 'y'], ['m2', 'y']], processModel: 6, settings: CPA,
  },
  {
    id: 'plspm-rebus', package: 'plspm', title: 'REBUS-PLS: two hidden segments', source: 'plspm, ?it.reb (simdata)',
    links: [{ label: '?it.reb', url: 'https://rdrr.io/cran/plspm/man/it.reb.html' }, { label: '?rebus.test', url: 'https://rdrr.io/cran/plspm/man/rebus.test.html' }, { label: '?simdata', url: 'https://rdrr.io/cran/plspm/man/simdata.html' }],
    description: 'Simulated customers (N = 400) in two segments: for one, satisfaction follows price; for the other, quality. The global model blurs them (GoF .49); REBUS-PLS recovers the segments (GQI .83). Opens its card on the Analyses tab.',
    data: { package: 'plspm', name: 'simdata' },
    constructs: [f('Price', items('mv', 5)), f('Quality', items('mv', 5, 6)), f('Satisfaction', items('mv', 3, 11))],
    paths: [['Price', 'Satisfaction'], ['Quality', 'Satisfaction']], segmentation: { from: 2, to: 3 },
    // plspm()'s defaults: centroid scheme, tol = 1e-06, maxiter = 100 (no missing-value handling; simdata is complete).
    settings: { ...PLS('cSEM', false, 'centroid'), missing: 'casewise', stopExp: 6, maxIter: 100 },
  },
  {
    id: 'ivreg-kmenta', package: 'ivreg', title: 'Supply and demand: two-stage least squares', source: 'ivreg, ?ivreg (Kmenta)',
    links: [{ label: '?ivreg', url: 'https://rdrr.io/cran/ivreg/man/ivreg.html' }, { label: '?Kmenta', url: 'https://rdrr.io/cran/ivreg/man/Kmenta.html' }],
    description: 'Kmenta’s food market (20 years): demand Q on price P, which is endogenous (set by supply and demand together), with income D; farm price F and time A instrument the price. Weak-instrument, Wu–Hausman and Sargan tests. Opens its card on the Analyses tab.',
    data: { package: 'ivreg', name: 'Kmenta' }, constructs: [], paths: [],
    panel: { kind: 'endo', method: 'iv', outcome: 'Q', endogenous: ['P'], exogenous: ['D'], instruments: ['F', 'A'] }, settings: CB('ML'),
  },
  {
    id: 'rendo-copula', package: 'REndo', title: 'Gaussian copula: two endogenous regressors', source: 'REndo, ?copulaCorrection (dataCopCont2)',
    links: [{ label: '?copulaCorrection', url: 'https://rdrr.io/cran/REndo/man/copulaCorrection.html' }, { label: '?dataCopCont2', url: 'https://rdrr.io/cran/REndo/man/dataCopCont2.html' }],
    description: 'Simulated data (N = 2500) where P1 and P2 correlate with the error. The copula terms P* reveal the endogeneity without instruments and correct the coefficients (true values: P1 −1, P2 0.8); 10 bootstrap samples for the standard errors, as on the help page (num.boots = 10). REndo cannot run in the browser: its estimator is rewritten in R here and checked against REndo to ten digits. REndo’s data, shipped with the app. Opens its card on the Analyses tab.',
    data: { package: 'REndo', name: 'dataCopCont2', file: 'examples/rendo/dataCopCont2.csv' }, constructs: [], paths: [],
    panel: { kind: 'endo', method: 'copula', outcome: 'y', endogenous: ['P1', 'P2'], exogenous: ['X1', 'X2'] }, settings: { ...CB('ML'), bootSamples: 10 },
  },
  {
    id: 'rendo-het', package: 'REndo', title: 'Instruments from heteroskedasticity (Lewbel)', source: 'REndo, ?hetErrorsIV (dataHetIV)',
    links: [{ label: '?hetErrorsIV', url: 'https://rdrr.io/cran/REndo/man/hetErrorsIV.html' }, { label: '?dataHetIV', url: 'https://rdrr.io/cran/REndo/man/dataHetIV.html' }],
    description: 'Simulated data (N = 2500): P is endogenous and no external instrument exists; the heteroskedastic errors of P on X1 and X2 build internal instruments (Lewbel 2012). REndo cannot run in the browser: its estimator is rewritten in R here and checked against REndo to ten digits. REndo’s data, shipped with the app. Opens its card on the Analyses tab.',
    data: { package: 'REndo', name: 'dataHetIV', file: 'examples/rendo/dataHetIV.csv' }, constructs: [], paths: [],
    panel: { kind: 'endo', method: 'het', outcome: 'y', endogenous: ['P'], exogenous: ['X1', 'X2'], hetRegressors: ['X1', 'X2'] }, settings: CB('ML'),
  },
  {
    id: 'rendo-hm', package: 'REndo', title: 'Higher-moment instruments (Lewbel)', source: 'REndo, ?higherMomentsIV (dataHigherMoments)',
    links: [{ label: '?higherMomentsIV', url: 'https://rdrr.io/cran/REndo/man/higherMomentsIV.html' }, { label: '?dataHigherMoments', url: 'https://rdrr.io/cran/REndo/man/dataHigherMoments.html' }],
    description: 'Simulated data (N = 2500): instruments from products of de-meaned variables, as on the help page (gp with g = x², and yp). REndo cannot run in the browser: its estimator is rewritten in R here and checked against REndo to ten digits. REndo’s data, shipped with the app. Opens its card on the Analyses tab.',
    data: { package: 'REndo', name: 'dataHigherMoments', file: 'examples/rendo/dataHigherMoments.csv' }, constructs: [], paths: [],
    panel: { kind: 'endo', method: 'hm', outcome: 'y', endogenous: ['P'], exogenous: ['X1', 'X2'], hetRegressors: ['X1', 'X2'], hmTypes: ['gp', 'yp'] }, settings: CB('ML'),
  },
  {
    id: 'rendo-liv', package: 'REndo', title: 'Latent instrumental variables', source: 'REndo, ?latentIV (dataLatentIV)',
    links: [{ label: '?latentIV', url: 'https://rdrr.io/cran/REndo/man/latentIV.html' }, { label: '?dataLatentIV', url: 'https://rdrr.io/cran/REndo/man/dataLatentIV.html' }],
    description: 'Simulated data (N = 2500): y on an endogenous P without any instrument. The latent IV model splits P into a hidden two-group instrument and an endogenous part (true slope −1). REndo cannot run in the browser: its estimator is rewritten in R here and checked against REndo (estimates to six digits). REndo’s data, shipped with the app. Opens its card on the Analyses tab.',
    data: { package: 'REndo', name: 'dataLatentIV', file: 'examples/rendo/dataLatentIV.csv' }, constructs: [], paths: [],
    panel: { kind: 'endo', method: 'liv', outcome: 'y', endogenous: ['P'], exogenous: [] }, settings: CB('ML'),
  },
  {
    id: 'sampleselection-mroz', package: 'sampleSelection', title: 'Women’s wages: Heckman selection', source: 'sampleSelection, ?selection (Mroz87)',
    links: [{ label: '?selection', url: 'https://rdrr.io/cran/sampleSelection/man/selection.html' }, { label: '?Mroz87', url: 'https://rdrr.io/cran/sampleSelection/man/Mroz87.html' }],
    description: 'Mroz (1987): wages are observed only for the 428 of 753 women in the labour force. As on the help page: kids = any child under 18 (kids5 + kids618 > 0), a probit for participation on age, age², family income, kids and education, and the wage equation on experience, experience², education and city, corrected for selection. Heckman’s two-step estimates (the help page’s heckit()); switch to maximum likelihood for its selection() fit. Opens its card on the Analyses tab.',
    data: { package: 'sampleSelection', name: 'Mroz87' }, constructs: [], paths: [],
    computed: [{ name: 'kids', expr: 'kids5 + kids618 > 0' }, { name: 'age2', expr: 'age^2' }, { name: 'exper2', expr: 'exper^2' }],
    panel: { kind: 'endo', method: 'heckman', outcome: 'wage', exogenous: ['exper', 'exper2', 'educ', 'city'], selection: { outcome: 'lfp', regressors: ['age', 'age2', 'faminc', 'kids', 'educ'] }, heckmanMethod: '2step' }, settings: CB('ML'),
  },
  {
    id: 'rsa-motcon', package: 'RSA', title: 'Motive congruence: response surface', source: 'RSA, ?RSA (motcon)',
    links: [{ label: '?RSA', url: 'https://rdrr.io/cran/RSA/man/RSA.html' }, { label: '?motcon', url: 'https://rdrr.io/cran/RSA/man/motcon.html' }, { label: 'Shanock et al. (2010)', url: 'https://doi.org/10.1007/s10869-010-9183-4' }],
    description: 'Does it matter whether explicit and implicit power motives match (N = 84)? Polynomial regression of positive affect on both motives, read along the lines of congruence and incongruence — the analysis of Schaarschmidt, Stol & Fitzgerald (EJIS 2025) on identification imbalance. RSA’s data, shipped with the app. Opens its card on the Analyses tab.',
    data: { package: 'RSA', name: 'motcon', file: 'examples/rsa/motcon.csv' }, constructs: [], paths: [],
    panel: { kind: 'rsa', outcome: 'postVA', x: 'ePow', y: 'iPow', controls: [], estimation: 'MLR', center: 'none' }, settings: CB('ML'),
  },
  {
    id: 'psych-bfi', package: 'psych', title: 'Big Five personality items: exploratory factor analysis', source: 'psych, ?bfi and ?fa (Revelle)',
    links: [{ label: '?fa', url: 'https://rdrr.io/cran/psych/man/fa.html' }, { label: '?fa.parallel', url: 'https://rdrr.io/cran/psych/man/fa.parallel.html' }, { label: '?bfi', url: 'https://rdrr.io/cran/psych/man/bfi.html' }],
    description: '25 self-report items of the Big Five (agreeableness, conscientiousness, extraversion, neuroticism, openness) from 2800 people. Parallel analysis, MAP and a five-factor minimum-residual solution with oblimin rotation; Build model turns it into five correlated factors for a CFA. Opens its card on the Analyses tab.',
    data: { package: 'psych', name: 'bfi' }, constructs: [], paths: [],
    panel: { kind: 'efa', vars: ['A1', 'A2', 'A3', 'A4', 'A5', 'C1', 'C2', 'C3', 'C4', 'C5', 'E1', 'E2', 'E3', 'E4', 'E5', 'N1', 'N2', 'N3', 'N4', 'N5', 'O1', 'O2', 'O3', 'O4', 'O5'],
      method: 'minres', criterion: 'fixed', nfactors: 5, rotation: 'oblimin', parallel: 20 }, settings: CB('ML'),
  },
  {
    id: 'psych-harman5', package: 'psych', title: 'Socio-economic variables: principal components', source: 'psych, ?principal (Harman.5)',
    links: [{ label: '?principal', url: 'https://rdrr.io/cran/psych/man/principal.html' }, { label: '?Harman.5', url: 'https://rdrr.io/cran/psych/man/Harman.html' }],
    description: 'Harman’s five socio-economic variables for 12 census tracts (population, schooling, employment, professional services, house value): two principal components with varimax rotation, as on the help page. Opens its card on the Analyses tab.',
    data: { package: 'psych', name: 'Harman.5' }, constructs: [], paths: [],
    panel: { kind: 'efa', vars: ['population', 'schooling', 'employment', 'professional', 'housevalue'], method: 'pca', criterion: 'fixed', nfactors: 2, rotation: 'varimax', parallel: 0 }, settings: CB('ML'),
  },
  {
    id: 'nca-example', package: 'NCA', title: 'Necessary conditions for innovation', source: 'NCA, ?nca_analysis (nca.example)',
    links: [{ label: '?nca_analysis', url: 'https://rdrr.io/cran/NCA/man/nca_analysis.html' }, { label: '?nca.example', url: 'https://rdrr.io/cran/NCA/man/nca.example.html' }, { label: 'Dul (2016)', url: 'https://doi.org/10.1177/1094428115584005' }],
    description: 'Are individualism and risk taking necessary for innovation performance (28 countries)? Ceiling lines, effect sizes and bottleneck tables, as nca_analysis(data, c(1, 2), 3) on the help page (no permutation test; set permutations on the card for one). The card computes the two ceiling envelopment lines, CE-FDH and CR-FDH; nca_analysis’s default also draws an OLS regression line for comparison, which the card does not show. NCA cannot run in the browser: its estimators are rewritten in R here and checked against NCA. NCA’s data, shipped with the app. Opens its card on the Analyses tab.',
    data: { package: 'NCA', name: 'nca.example', file: 'examples/nca/nca_example.csv' }, constructs: [], paths: [],
    panel: { kind: 'nca', x: ['Individualism', 'Risk taking'], y: 'Innovation performance', permutations: 0 }, settings: CB('ML'),
  },
  {
    id: 'matchit-lalonde', package: 'MatchIt', title: 'Job training: propensity score matching', source: 'MatchIt, vignette “MatchIt: Getting Started” (lalonde)',
    links: [{ label: 'MatchIt: Getting Started', url: 'https://kosukeimai.github.io/MatchIt/articles/MatchIt.html' }, { label: '?matchit', url: 'https://rdrr.io/cran/MatchIt/man/matchit.html' }, { label: '?lalonde', url: 'https://rdrr.io/cran/MatchIt/man/lalonde.html' }],
    description: 'Lalonde (1986): did a job-training programme raise 1978 earnings? As in MatchIt’s “Getting started” vignette: the 185 trainees and 429 non-participants fully matched on a probit propensity score from age, education, race, marital status, degree and earlier earnings, then the outcome model with the covariates and their interactions with treatment, averaged over the trainees by g-computation, standard errors clustered by matched set. The vignette’s code gives $1977 (SE 704) with the packages here (MatchIt 4.8.1, optmatch 0.10.8, marginaleffects 1.0.0), which the card reproduces exactly; its text cites $2114 (SE 646), written for earlier versions (it does not print that output). Choose Nearest neighbour to see the vignette’s first attempt, which leaves race imbalanced. Opens its card on the Analyses tab.',
    data: { package: 'MatchIt', name: 'lalonde' }, constructs: [], paths: [],
    panel: { kind: 'match', treatment: 'treat', covariates: ['age', 'educ', 'race', 'married', 'nodegree', 're74', 're75'], outcome: 're78', method: 'full', distance: 'glm', link: 'probit', estimand: 'ATT', matchEffect: 'dr' }, settings: CB('ML'),
  },
  {
    id: 'plspm-fimix', package: 'plspm', title: 'FIMIX-PLS: the same hidden segments', source: 'plspm simdata; FIMIX-PLS with flexmix (Sarstedt et al. 2011)',
    links: [{ label: '?simdata', url: 'https://rdrr.io/cran/plspm/man/simdata.html' }, { label: 'flexmix', url: 'https://rdrr.io/cran/flexmix/man/flexmix.html' }, { label: 'Sarstedt et al. (2011)', url: 'https://doi.org/10.1007/BF03396856' }],
    description: 'The two simulated customer segments again, found by a finite mixture of the structural model (FIMIX-PLS; Sarstedt et al. 2011): no package documents this analysis on simdata, so it is the app’s FIMIX-PLS (flexmix’s mixture of regressions on the cSEM construct scores, ten starts per number of segments), checked against flexmix run directly on the same scores. BIC points to two segments with price-driven and quality-driven satisfaction. Opens its card on the Analyses tab.',
    data: { package: 'plspm', name: 'simdata' },
    constructs: [f('Price', items('mv', 5)), f('Quality', items('mv', 5, 6)), f('Satisfaction', items('mv', 3, 11))],
    paths: [['Price', 'Satisfaction'], ['Quality', 'Satisfaction']], segmentation: { method: 'fimix' }, settings: { ...PLS('cSEM', false, 'path'), missing: 'casewise' },
  },
  {
    id: 'ltm-lsat', package: 'ltm', title: 'LSAT: Rasch model', source: 'ltm, ?rasch',
    links: [{ label: '?rasch', url: 'https://rdrr.io/cran/ltm/man/rasch.html' }, { label: '?LSAT', url: 'https://rdrr.io/cran/ltm/man/LSAT.html' }],
    description: 'Five binary items of the Law School Admission Test (N = 1000), Bock & Lieberman (1970): item difficulties and a common discrimination. Opens its card on the Analyses tab.',
    data: { package: 'ltm', name: 'LSAT' }, constructs: [], paths: [],
    panel: { kind: 'irt', items: items('Item ', 5), model: 'rasch' }, settings: CB('ML'),
  },
  {
    id: 'ltm-science', package: 'ltm', title: 'Attitudes to science: graded response', source: 'ltm, ?grm',
    links: [{ label: '?grm', url: 'https://rdrr.io/cran/ltm/man/grm.html' }, { label: '?Science', url: 'https://rdrr.io/cran/ltm/man/Science.html' }],
    description: 'Four four-category Likert items from the 1992 Eurobarometer (N = 392), coded 1 = strongly disagree to 4 = strongly agree: thresholds and discriminations (Samejima). Opens its card on the Analyses tab.',
    data: { package: 'ltm', name: 'Science' }, constructs: [], paths: [],
    panel: { kind: 'irt', items: ['Comfort', 'Work', 'Future', 'Benefit'], model: 'grm' }, settings: CB('ML'),
  },
  {
    id: 'polca-carcinoma', package: 'poLCA', title: 'Pathologists’ ratings: latent classes', source: 'poLCA, ?carcinoma',
    links: [{ label: '?carcinoma', url: 'https://rdrr.io/cran/poLCA/man/carcinoma.html' }, { label: '?poLCA', url: 'https://rdrr.io/cran/poLCA/man/poLCA.html' }],
    description: 'Seven pathologists rating 118 slides for carcinoma (Agresti 2002): two to four latent classes compared by BIC and entropy. Reproduces the help page’s log-likelihoods (−317.2568, −293.7050, −289.2858); the card runs every class number from 10 starts with up to 5000 iterations, as the help page does for four classes. Opens its card on the Analyses tab.',
    data: { package: 'poLCA', name: 'carcinoma' }, constructs: [], paths: [],
    panel: { kind: 'lca', items: ['A', 'B', 'C', 'D', 'E', 'F', 'G'], from: 2, to: 4 }, settings: CB('ML'),
  },
  {
    id: 'polca-values', package: 'poLCA', title: 'Universalistic and particularistic values', source: 'poLCA, ?values',
    links: [{ label: '?values', url: 'https://rdrr.io/cran/poLCA/man/values.html' }],
    description: 'Four dilemmas answered by 216 respondents (Stouffer & Toby 1951): the classic one- to three-class comparison. Reproduces the help page’s log-likelihoods (−543.6498, −504.4677, −503.3011). Opens its card on the Analyses tab.',
    data: { package: 'poLCA', name: 'values' }, constructs: [], paths: [],
    panel: { kind: 'lca', items: ['A', 'B', 'C', 'D'], from: 1, to: 3 }, settings: CB('ML'),
  },
  {
    id: 'lme4-sleepstudy', package: 'lme4', title: 'Sleep deprivation: random slopes', source: 'lme4, ?lmer (sleepstudy)',
    links: [{ label: '?lmer', url: 'https://rdrr.io/cran/lme4/man/lmer.html' }, { label: '?sleepstudy', url: 'https://rdrr.io/cran/lme4/man/sleepstudy.html' }, { label: 'lmerTest', url: 'https://rdrr.io/cran/lmerTest/man/lmer.html' }],
    description: 'Reaction times of 18 people over ten days of sleep deprivation (Belenky et al. 2003): each person has their own baseline and their own slowing per day, Reaction ~ Days + (Days | Subject). Opens its card on the Analyses tab.',
    data: { package: 'lme4', name: 'sleepstudy' }, constructs: [], paths: [],
    panel: { kind: 'lmm', outcome: 'Reaction', predictors: ['Days'], cluster: 'Subject', slopes: ['Days'], center: 'none', estimation: 'REML' }, settings: CB('ML'),
  },
  {
    id: 'lcmm-hlme', package: 'lcmm', title: 'Growth mixture: latent trajectory classes', source: 'lcmm, ?hlme (data_hlme)',
    links: [{ label: '?hlme', url: 'https://rdrr.io/cran/lcmm/man/hlme.html' }, { label: '?gridsearch', url: 'https://rdrr.io/cran/lcmm/man/gridsearch.html' }, { label: '?data_hlme', url: 'https://rdrr.io/cran/lcmm/man/data_hlme.html' }],
    description: 'Simulated repeated measures of 100 people (long format): one to three classes of linear change with random intercepts and slopes, X1 as a covariate. The help page fits one and two classes (Y ~ Time * X1 with class membership predicted by X2 and X3); this card fits the simpler model without the interaction and the membership predictors, up to three classes, each from 30 random starts (gridsearch, 30 iterations each; the help page’s gridsearch example uses 50 and 10). Opens its card on the Analyses tab.',
    data: { package: 'lcmm', name: 'data_hlme' }, constructs: [], paths: [],
    panel: { kind: 'gmm', format: 'long', measures: [], times: [], subject: 'ID', time: 'Time', outcome: 'Y', covariates: ['X1'], shape: 'linear', random: 'slope', to: 3, nrep: 30 }, settings: CB('ML'),
  },
  {
    id: 'csem-threecf', package: 'cSEM', title: 'Three common factors (PLSc)', source: 'cSEM, ?threecommonfactors',
    links: [{ label: '?threecommonfactors', url: 'https://rdrr.io/cran/cSEM/man/threecommonfactors.html' }],
    description: 'Simulated data from a known three-factor model (N = 500). Consistent PLS recovers the population values; the help page runs the bootstrap test of overall fit (testOMF).',
    data: { package: 'cSEM', name: 'threecommonfactors' },
    constructs: [f('eta1', items('y1', 3, 1)), f('eta2', items('y2', 3, 1)), f('eta3', items('y3', 3, 1))],
    paths: [['eta1', 'eta2'], ['eta1', 'eta3'], ['eta2', 'eta3']], settings: CSEM(),
  },
  {
    id: 'csem-satisfaction', package: 'cSEM', title: 'Customer satisfaction (ECSI model)', source: 'cSEM, ?infer (satisfaction)',
    links: [{ label: '?infer', url: 'https://rdrr.io/cran/cSEM/man/infer.html' }, { label: '?satisfaction', url: 'https://rdrr.io/cran/cSEM/man/satisfaction.html' }],
    description: 'An ECSI-type model on cSEM’s satisfaction data: 250 customers of a Spanish credit institution rate image, expectations, quality, value, satisfaction and loyalty. The model of cSEM’s ?infer help page: six common factors, csem() defaults (consistent PLS, path scheme). Consistent PLS gives some path coefficients beyond ±1 here (quality → value 2.59, expectations → value −1.74): the disattenuation is unstable for these data, which comparing with PLSc switched off shows.',
    data: { package: 'cSEM', name: 'satisfaction' },
    constructs: [f('IMAG', items('imag', 5)), f('EXPE', items('expe', 5)), f('QUAL', items('qual', 5)), f('VAL', items('val', 4)), f('SAT', items('sat', 4)), f('LOY', items('loy', 4))],
    paths: [['IMAG', 'EXPE'], ['IMAG', 'SAT'], ['IMAG', 'LOY'], ['EXPE', 'QUAL'], ['EXPE', 'VAL'], ['EXPE', 'SAT'], ['QUAL', 'VAL'], ['QUAL', 'SAT'], ['VAL', 'SAT'], ['SAT', 'LOY']],
    settings: CSEM(),
  },
  {
    id: 'csem-gender', package: 'cSEM', title: 'Customer satisfaction: women and men (MICOM, MGA)', source: 'cSEM, ?testMICOM, ?testMGD (satisfaction_gender)',
    links: [{ label: '?testMICOM', url: 'https://rdrr.io/cran/cSEM/man/testMICOM.html' }, { label: '?testMGD', url: 'https://rdrr.io/cran/cSEM/man/testMGD.html' }, { label: '?satisfaction_gender', url: 'https://rdrr.io/cran/cSEM/man/satisfaction_gender.html' }],
    description: 'The ECSI model as on cSEM’s ?testMGD help page (composites for expectations, image, satisfaction and value; common factors for quality and loyalty, consistent PLS) applied to 148 women and 102 men; the help pages themselves run testMGD on three almost identical subsets of satisfaction and testMICOM on generated data. Is the measurement invariant (MICOM), and do the paths differ (multigroup analysis)? The card permutes 499 times (seed 1234). Opens its card on the Analyses tab.',
    data: { package: 'cSEM', name: 'satisfaction_gender' },
    constructs: [c('IMAG', items('imag', 5)), c('EXPE', items('expe', 5)), f('QUAL', items('qual', 5)), c('VAL', items('val', 4)), c('SAT', items('sat', 4)), f('LOY', items('loy', 4))],
    paths: [['IMAG', 'EXPE'], ['EXPE', 'QUAL'], ['EXPE', 'VAL'], ['QUAL', 'VAL'], ['IMAG', 'SAT'], ['EXPE', 'SAT'], ['QUAL', 'SAT'], ['VAL', 'SAT'], ['IMAG', 'LOY'], ['SAT', 'LOY']],
    assessment: { tab: 'groups', group: 'gender' }, settings: CSEM(),
  },
  {
    id: 'csem-itflex', package: 'cSEM', title: 'IT infrastructure flexibility: confirmatory composite analysis', source: 'cSEM, ?ITFlex (Henseler 2021)',
    links: [{ label: '?ITFlex', url: 'https://rdrr.io/cran/cSEM/man/ITFlex.html' }, { label: '?testOMF', url: 'https://rdrr.io/cran/cSEM/man/testOMF.html' }],
    description: 'Benitez, Ray & Henseler (2018): IT compatibility, connectivity, modularity and personnel skills as composites (100 firms), with the saturated structural model and the factorial scheme, as on the help page. Is the composite model supported? Opens its card on the Analyses tab.',
    data: { package: 'cSEM', name: 'ITFlex' },
    constructs: [c('ITComp', items('ITCOMP', 4)), c('Modul', items('MOD', 4)), c('ITConn', items('ITCONN', 4)), c('ITPers', items('ITPSF', 4))],
    paths: [['ITComp', 'ITPers'], ['Modul', 'ITPers'], ['ITConn', 'ITPers'], ['ITComp', 'Modul'], ['ITConn', 'Modul'], ['ITComp', 'ITConn']],
    assessment: { tab: 'cca' }, settings: CSEM(true, 'factor', 6),
  },
  {
    id: 'csem-2ndorder', package: 'cSEM', title: 'Second-order construct: a common factor of composites', source: 'cSEM, ?csem (dgp_2ndorder_cf_of_c)',
    links: [{ label: '?csem', url: 'https://rdrr.io/cran/cSEM/man/csem.html' }, { label: '?dgp_2ndorder_cf_of_c', url: 'https://rdrr.io/cran/cSEM/man/dgp_2ndorder_cf_of_c.html' }],
    description: 'cSEM’s help example (simulated, N = 500): c4 is a second-order common factor of the composites c1–c3, predicted by eta1 and predicting eta2. Two-stage approach: the first-order constructs first, then c4 from their scores. Consistent PLS, as on the help page.',
    data: { package: 'cSEM', name: 'dgp_2ndorder_cf_of_c' },
    constructs: [c('c1', ['y11', 'y12']), c('c2', items('y2', 4)), c('c3', items('y3', 8)), f('eta1', items('y4', 3)), f('eta2', items('y5', 3)),
      { name: 'c4', type: 'factor', mode: 'A', components: ['c1', 'c2', 'c3'] }],
    paths: [['eta1', 'c4'], ['eta1', 'eta2'], ['c4', 'eta2']],
    settings: CSEM(),
  },
  {
    id: 'csem-2ndorder-embedded', package: 'cSEM', title: 'Second-order construct: embedded two-stage approach', source: 'cSEM, ?csem (res_mixed)',
    links: [{ label: '?csem', url: 'https://rdrr.io/cran/cSEM/man/csem.html' }, { label: '?dgp_2ndorder_cf_of_c', url: 'https://rdrr.io/cran/cSEM/man/dgp_2ndorder_cf_of_c.html' }],
    description: 'The same help example with .approach_2ndorder = "mixed": the first stage uses the repeated indicators, so c4 is in the model from the start; the second stage then measures c4 by the scores of c1–c3 (Ringle, Sarstedt & Straub, 2012). Compare with the two-stage and repeated-indicators variants.',
    data: { package: 'cSEM', name: 'dgp_2ndorder_cf_of_c' },
    constructs: [c('c1', ['y11', 'y12']), c('c2', items('y2', 4)), c('c3', items('y3', 8)), f('eta1', items('y4', 3)), f('eta2', items('y5', 3)),
      { name: 'c4', type: 'factor', mode: 'A', components: ['c1', 'c2', 'c3'] }],
    paths: [['eta1', 'c4'], ['eta1', 'eta2'], ['c4', 'eta2']],
    settings: { ...CSEM(), hocApproach: 'embedded' },
  },
  {
    id: 'csem-2ndorder-repeated', package: 'cSEM', title: 'Second-order construct: repeated indicators', source: 'cSEM, ?csem (res_RI)',
    links: [{ label: '?csem', url: 'https://rdrr.io/cran/cSEM/man/csem.html' }, { label: '?dgp_2ndorder_cf_of_c', url: 'https://rdrr.io/cran/cSEM/man/dgp_2ndorder_cf_of_c.html' }],
    description: 'The help page’s repeated-indicators respecification: the indicators of c1–c3 are copied to measure c4 as well, and c1–c3 predict c4. Note the artefact the page illustrates: c4 is explained almost entirely by its dimensions, so eta1 → c4 vanishes; with antecedents, prefer a two-stage approach.',
    data: { package: 'cSEM', name: 'dgp_2ndorder_cf_of_c' },
    constructs: [c('c1', ['y11', 'y12']), c('c2', items('y2', 4)), c('c3', items('y3', 8)), f('eta1', items('y4', 3)), f('eta2', items('y5', 3)),
      { name: 'c4', type: 'factor', mode: 'A', components: ['c1', 'c2', 'c3'] }],
    paths: [['eta1', 'c4'], ['eta1', 'eta2'], ['c4', 'eta2']],
    settings: { ...CSEM(), hocApproach: 'repeated' },
  },
  {
    id: 'csem-yoo', package: 'cSEM', title: 'Brand equity: a composite of common factors (second order)', source: 'cSEM, ?Yooetal2000 (Henseler 2021)',
    links: [{ label: '?Yooetal2000', url: 'https://rdrr.io/cran/cSEM/man/Yooetal2000.html' }],
    description: 'Yoo, Donthu & Lee (2000), the example of Henseler’s book (569 consumers): brand equity is a composite of perceived quality, brand loyalty and brand awareness/associations (common factors), driven by price, store image, distribution intensity, advertising spending and deal frequency. Two-stage approach, factorial scheme, consistent PLS, as on the help page.',
    data: { package: 'cSEM', name: 'Yooetal2000' },
    constructs: [f('PR', items('PR', 3)), f('IM', items('IM', 3)), f('DI', items('DI', 3)), f('AD', items('AD', 3)), f('DL', items('DL', 3)),
      f('QL', items('QL', 6)), f('LO', ['LO1', 'LO3']), f('AA', items('AA', 6)),
      { name: 'BR', type: 'composite', mode: 'B', components: ['QL', 'LO', 'AA'] }],
    paths: [['PR', 'BR'], ['IM', 'BR'], ['DI', 'BR'], ['AD', 'BR'], ['DL', 'BR']],
    settings: CSEM(true, 'factor', 6),
  },
  {
    id: 'seminr-hoc', package: 'seminr', title: 'Satisfaction as a higher-order composite (two-stage)', source: 'seminr, demo(seminr-pls-higher_order)',
    links: [{ label: 'demo source', url: 'https://github.com/sem-in-r/seminr/blob/master/demo/seminr-pls-higher_order.R' }, { label: '?higher_composite', url: 'https://rdrr.io/cran/seminr/man/higher_composite.html' }],
    description: 'seminr’s higher-order demo on the mobi data: satisfaction is a higher-order composite of image and value (two-stage, Mode A), driven by expectation and quality and driving complaints and loyalty. Try Mode B for image and value: the demo’s second variant.',
    data: { package: 'seminr', name: 'mobi' },
    constructs: [c('Image', items('IMAG', 5), 'A'), c('Expectation', items('CUEX', 3), 'A'), c('Quality', items('PERQ', 7), 'A'), c('Value', items('PERV', 2), 'A'),
      { name: 'Satisfaction', type: 'composite', mode: 'A', components: ['Image', 'Value'] }, c('Complaints', ['CUSCO'], 'A'), c('Loyalty', items('CUSL', 3), 'A')],
    paths: [['Expectation', 'Satisfaction'], ['Quality', 'Satisfaction'], ['Satisfaction', 'Complaints'], ['Satisfaction', 'Loyalty']],
    settings: SEMINR(1000),
  },
  {
    id: 'semfindr-cfa', package: 'semfindr', title: 'Influential cases in a CFA', source: 'semfindr, ?cfa_dat2',
    links: [{ label: '?cfa_dat2', url: 'https://rdrr.io/cran/semfindr/man/cfa_dat2.html' }, { label: '?influence_stat', url: 'https://rdrr.io/cran/semfindr/man/influence_stat.html' }],
    description: 'semfindr’s two-factor CFA on simulated data (N = 100) with influential cases, as on ?cfa_dat2: influence_stat() on the fitted model, semfindr’s approximate approach (no refits); generalized Cook’s distance shows which cases move the estimates. Switch the card to refitting without each case for the exact values (?influence_stat’s leave-one-out approach). Opens its card on the Analyses tab.',
    data: { package: 'semfindr', name: 'cfa_dat2' },
    constructs: [f('f1', ['x1', 'x2', 'x3']), f('f2', ['x4', 'x5', 'x6'])],
    paths: [], correlations: [['f1', 'f2', 'construct']],
    screening: { tab: 'influence', approach: 'approximate' }, settings: CB('ML'),
  },
  {
    id: 'rsem-mardia', package: 'rsem', title: 'Robust ML with missing data: exam scores', source: 'rsem, ?rsem.lavaan (mardiamv25)',
    links: [{ label: '?rsem.lavaan', url: 'https://rdrr.io/cran/rsem/man/rsem.lavaan.html' }, { label: '?mardiamv25', url: 'https://rdrr.io/cran/rsem/man/mardiamv25.html' }],
    description: 'Mardia, Kent & Bibby’s exam scores of 88 students, with 31 missing values in Vectors and in Statistics: two correlated factors, each of two scores, as on the help page (without its mean structure). Robust ML (Yuan & Zhang): atypical students are down-weighted, and the missing values are used through EM.',
    data: { package: 'rsem', name: 'mardiamv25' },
    constructs: [f('f1', ['Mechanics', 'Vectors']), f('f2', ['Analysis', 'Statistics'])],
    paths: [], correlations: [['f1', 'f2', 'construct']],
    settings: { ...CB('RML'), missing: 'fiml' },
  },
  {
    id: 'mice-nhanes', package: 'mice', title: 'Multiple imputation: cholesterol by age, hypertension and BMI', source: 'mice, ?pool.r.squared (nhanes)',
    links: [{ label: '?pool.r.squared', url: 'https://rdrr.io/cran/mice/man/pool.r.squared.html' }, { label: '?nhanes', url: 'https://rdrr.io/cran/mice/man/nhanes.html' }],
    description: 'The NHANES excerpt of mice’s help pages (25 people, a third of the values missing), as on ?pool.r.squared: mice(nhanes, seed = 16117) with its five imputations, then cholesterol regressed on age, hypertension and BMI in every imputed data set, pooled by Rubin’s rules. Here the regression is a path model of observed variables estimated by maximum likelihood (lavaan.mi): the pooled coefficients are those of the help page’s lm(); the standard errors are maximum-likelihood ones (divided by N rather than by the residual degrees of freedom) and so smaller than lm’s.',
    data: { package: 'mice', name: 'nhanes' },
    // (in nhanes's column order: mice's imputations depend on it)
    constructs: [v('age'), v('bmi'), v('hyp'), v('chl')],
    paths: [['age', 'chl'], ['hyp', 'chl'], ['bmi', 'chl']],
    settings: { ...CB('ML'), missing: 'mi', miImputations: 5, seed: 16117 },
  },
  {
    id: 'lavaanmi-hs', package: 'lavaan.mi', title: 'CFA with multiply imputed data', source: 'lavaan.mi, ?lavaan.mi and ?HS20imps',
    links: [{ label: '?lavaan.mi', url: 'https://rdrr.io/cran/lavaan.mi/man/lavaan.mi.html' }, { label: '?HS20imps', url: 'https://rdrr.io/cran/lavaan.mi/man/HS20imps.html' }],
    description: 'The three-factor CFA of lavaan’s ?cfa on Holzinger & Swineford’s tests with the help page’s missing values (x5: the lowest 30% deleted; x9: the youngest 30%), imputed as ?HS20imps does: Amelia with age and school as auxiliary variables (school nominal), 20 imputations, seed 456, which gives the HS20imps data sets exactly. The CFA in each, pooled by Rubin’s rules (lavaan.mi’s cfa.mi).',
    data: { package: 'lavaan.mi', name: 'HSMiss', file: 'examples/mi/HSMiss.csv' },
    constructs: [f('visual', ['x1', 'x2', 'x3']), f('textual', ['x4', 'x5', 'x6']), f('speed', ['x7', 'x8', 'x9'])],
    paths: [], settings: { ...CB('ML'), missing: 'mi', miImputations: 20, seed: 456, miMethod: 'amelia', miAuxiliary: ['ageyr', 'agemo', 'school'], miNominal: ['school'] },
  },
  {
    id: 'weightit-lalonde', package: 'WeightIt', title: 'Job training: entropy balancing weights', source: 'WeightIt, vignette “Estimate Balancing Weights” (lalonde)',
    links: [{ label: 'WeightIt: Getting started', url: 'https://ngreifer.github.io/WeightIt/articles/WeightIt.html' }, { label: '?weightit', url: 'https://rdrr.io/cran/WeightIt/man/weightit.html' }],
    description: 'Lalonde (1986), as in WeightIt’s introductory vignette: the effect of job training on 1978 earnings for the trainees (ATT) with entropy-balancing weights (method = "ebal"), then lm_weightit() with the covariates and their interactions with treatment, averaged over the trainees by g-computation, with standard errors that account for estimating the weights. Reproduces the vignette: 1273 (SE 770). The vignette starts with logistic propensity-score weights; switch the card’s weights to compare. Opens its card on the Analyses tab.',
    data: { package: 'MatchIt', name: 'lalonde' }, constructs: [], paths: [],
    panel: { kind: 'match', treatment: 'treat', covariates: ['age', 'educ', 'race', 'married', 'nodegree', 're74', 're75'], outcome: 're78', method: 'weighting', estimand: 'ATT', effectModel: 'dr', weightMethod: 'ebal' }, settings: CB('ML'),
  },
  {
    id: 'genpathmox-csibank', package: 'genpathmox', title: 'Bank customers: PATHMOX segmentation tree', source: 'genpathmox, ?pls.pathmox (csibank)',
    links: [{ label: '?pls.pathmox', url: 'https://rdrr.io/cran/genpathmox/man/pls.pathmox.html' }, { label: '?csibank', url: 'https://rdrr.io/cran/genpathmox/man/csibank.html' }],
    description: 'Satisfaction and loyalty of 1707 customers of a Spanish bank: does the model differ by gender, age, education, occupation or region? PATHMOX splits by age and then education and region. Consistent PLS, as on the help page. Opens its card on the Analyses tab.',
    data: { package: 'genpathmox', name: 'csibank' },
    constructs: [c('QUAL', items('qual', 7)), f('IMAG', items('imag', 6)), f('VAL', items('val', 4)), f('SAT', items('sat', 3)), f('LOY', items('loy', 3))],
    paths: [['QUAL', 'VAL'], ['IMAG', 'SAT'], ['QUAL', 'SAT'], ['VAL', 'SAT'], ['IMAG', 'LOY'], ['SAT', 'LOY']],
    segmentation: { method: 'pathmox', segments: [{ column: 'Gender' }, { column: 'Age', order: ['<=25', '26-35', '36-45', '46-55', '56-65', '>=66'] },
      { column: 'Education', order: ['Unfinished', 'Elementary', 'Highschool', 'Undergrad', 'Graduated'] }, { column: 'Occupation' }, { column: 'Region' }] },
    settings: CSEM(),
  },
  {
    id: 'csem-bergami', package: 'cSEM', title: 'Organisational identification', source: 'cSEM, ?BergamiBagozzi2000 (Henseler 2021)',
    links: [{ label: '?BergamiBagozzi2000', url: 'https://rdrr.io/cran/cSEM/man/BergamiBagozzi2000.html' }],
    description: 'Bergami & Bagozzi (2000): organisational prestige and identification predicting affective commitment (love and joy), with gender as a single-indicator composite. Factorial scheme, PLSc.',
    data: { package: 'cSEM', name: 'BergamiBagozzi2000' },
    constructs: [f('OrgPres', items('cei', 8)), f('OrgIden', items('ma', 6)), f('AffLove', ['orgcmt1', 'orgcmt2', 'orgcmt3', 'orgcmt7']), f('AffJoy', ['orgcmt5', 'orgcmt8']), c('Gender', ['gender'])],
    paths: [['OrgPres', 'OrgIden'], ...fan(['OrgPres', 'OrgIden', 'Gender'], ['AffLove', 'AffJoy'])], settings: CSEM(true, 'factor', 6),
  },
  {
    id: 'csem-switching', package: 'cSEM', title: 'Switching intention: an interaction', source: 'cSEM, ?Switching (Henseler 2021)',
    links: [{ label: '?Switching', url: 'https://rdrr.io/cran/cSEM/man/Switching.html' }],
    description: 'Does investment in a relationship moderate the effect of satisfaction on the intention to switch? cSEM models the interaction term INV.SAT as the product of the construct scores. Factorial scheme, consistent PLS, as on the help page.',
    data: { package: 'cSEM', name: 'Switching' },
    constructs: [f('INV', items('INV', 4)), f('SAT', items('SAT', 3)), f('INT', items('INT', 2))],
    paths: [['INV', 'INT'], ['SAT', 'INT']], moderations: [['INV', 'SAT', 'INT']], settings: CSEM(true, 'factor', 6),
  },
  {
    id: 'csem-russett', package: 'cSEM', title: 'Agricultural inequality and political instability', source: 'cSEM, ?Russett (Henseler 2020)',
    links: [{ label: '?Russett', url: 'https://rdrr.io/cran/cSEM/man/Russett.html' }],
    description: 'Russett’s (1964) data on 47 countries: composites of agricultural inequality and industrial development predicting political instability.',
    data: { package: 'cSEM', name: 'Russett' },
    constructs: [c('AgrIneq', ['gini', 'farm', 'rent']), c('IndDev', ['gnpr', 'labo']), c('PolInst', ['inst', 'ecks', 'deat', 'stab', 'dict'])],
    paths: [['AgrIneq', 'PolInst'], ['IndDev', 'PolInst']], settings: CSEM(true, 'factor', 6),
  },
  {
    id: 'csem-lancelot', package: 'cSEM', title: 'Privacy, trust and risk: mediation', source: 'cSEM, ?LancelotMiltgenetal2016 (Henseler 2020)',
    links: [{ label: '?LancelotMiltgenetal2016', url: 'https://rdrr.io/cran/cSEM/man/LancelotMiltgenetal2016.html' }],
    description: 'Privacy concerns affect the intention to provide data directly and through trust and perceived risk (N = 1090). Bootstrap the indirect effects.',
    data: { package: 'cSEM', name: 'LancelotMiltgenetal2016' },
    constructs: [f('Trust', ['trust1', 'trust2']), f('PrCon', items('privcon', 4)), f('Risk', items('risk', 3)), f('Int', ['intent1', 'intent2'])],
    paths: [['Trust', 'Int'], ['PrCon', 'Int'], ['Risk', 'Int'], ['Trust', 'Risk'], ['PrCon', 'Risk'], ['PrCon', 'Trust']], settings: CSEM(true, 'factor', 6),
  },
  {
    id: 'csem-benitez', package: 'cSEM', title: 'Social media capability and performance', source: 'cSEM, ?Benitezetal2020',
    links: [{ label: '?Benitezetal2020', url: 'https://rdrr.io/cran/cSEM/man/Benitezetal2020.html' }],
    description: 'Benitez et al. (2020): firms’ social media capability (a composite) between external and internal social media use and business process performance, with firm size and industry as control composites.',
    data: { package: 'cSEM', name: 'Benitezetal2020' },
    constructs: [f('SEXB', items('SEXB', 4)), f('SEMB', items('SEMB', 4)), c('SMC', items('SMC', 4)), c('BPP', items('BPP', 5)), c('FS', ['FirmSize']), c('Ind', items('Industry', 3))],
    paths: [['SEXB', 'SMC'], ['SEMB', 'SMC'], ['SMC', 'BPP'], ['Ind', 'BPP'], ['FS', 'BPP']], settings: CSEM(true, 'factor', 6),
  },
  {
    id: 'seminr-mobi', package: 'seminr', title: 'Mobile phone satisfaction (ECSI)', source: 'seminr, demo("seminr-pls-ecsi")',
    links: [{ label: 'demo seminr-pls-ecsi', url: 'https://github.com/sem-in-r/seminr/blob/master/demo/seminr-pls-ecsi.R' }, { label: '?mobi', url: 'https://rdrr.io/cran/seminr/man/mobi.html' }],
    description: 'The ECSI model on seminr’s mobi data: seven composites (Mode A), complaints as a single item.',
    data: { package: 'seminr', name: 'mobi' }, constructs: MOBI,
    paths: [...fan(['Image'], ['Expectation', 'Satisfaction', 'Loyalty']), ...fan(['Expectation'], ['Quality', 'Value', 'Satisfaction']), ...fan(['Quality'], ['Value', 'Satisfaction']),
      ['Value', 'Satisfaction'], ['Satisfaction', 'Complaints'], ['Satisfaction', 'Loyalty'], ['Complaints', 'Loyalty']],
    settings: SEMINR(1000),
  },
  {
    id: 'sempls-qsquared', package: 'cSEM', title: 'Mobile phone satisfaction: blindfolding Q²', source: 'semPLS, ?qSquared (ECSImobi on mobi): qSquared(ecsi, d = 4, impfun = meanimp, dlines = FALSE)',
    links: [{ label: '?qSquared', url: 'https://rdrr.io/cran/semPLS/man/semplsGOF.html' }, { label: '?mobi', url: 'https://rdrr.io/cran/seminr/man/mobi.html' }],
    description: 'The ECSI model of semPLS’s help page (sempls with the centroid scheme), and Stone–Geisser Q² from blindfolding with omission distance 4. The blindfolding card omits single data points and replaces them by the indicator means (Wold’s procedure, as SmartPLS): semPLS’s qSquared with impfun = meanimp and dlines = FALSE, its reference here. The help page calls qSquared with its defaults instead, omitting whole rows of each block and refitting with pairwise correlations, which a cSEM fit on complete data cannot do; its Q² values differ. Estimated with cSEM (semPLS is not available in the browser). Opens its card on the Analyses tab.',
    data: { package: 'seminr', name: 'mobi' }, constructs: MOBI,
    paths: [...fan(['Image'], ['Expectation', 'Satisfaction', 'Loyalty']), ...fan(['Expectation'], ['Quality', 'Value', 'Satisfaction']), ...fan(['Quality'], ['Value', 'Satisfaction']),
      ['Value', 'Satisfaction'], ['Satisfaction', 'Complaints'], ['Satisfaction', 'Loyalty'], ['Complaints', 'Loyalty']],
    assessment: { tab: 'blindfold', distance: 4 }, settings: { ...PLS('cSEM', false, 'centroid'), stopExp: 7, maxIter: 20 },
  },
  {
    id: 'seminr-interaction', package: 'seminr', title: 'Moderated satisfaction', source: 'seminr, demo("seminr-pls-interaction")',
    links: [{ label: 'demo seminr-pls-interaction', url: 'https://github.com/sem-in-r/seminr/blob/master/demo/seminr-pls-interaction.R' }, { label: '?mobi', url: 'https://rdrr.io/cran/seminr/man/mobi.html' }],
    description: 'Do expectations and value moderate the effect of image on satisfaction? Two-stage interaction terms (the demo also shows the orthogonalising and product-indicator approaches).',
    data: { package: 'seminr', name: 'mobi' }, constructs: [MOBI[0], MOBI[1], MOBI[3], MOBI[4]],
    paths: [['Image', 'Satisfaction'], ['Expectation', 'Satisfaction'], ['Value', 'Satisfaction']],
    moderations: [['Image', 'Expectation', 'Satisfaction'], ['Image', 'Value', 'Satisfaction']], settings: SEMINR(500),
  },
  {
    id: 'seminr-interaction-methods', package: 'seminr', title: 'Orthogonalising and product-indicator interaction terms', source: 'seminr, ?interaction_term',
    links: [{ label: '?interaction_term', url: 'https://rdrr.io/cran/seminr/man/interaction_term.html' }, { label: '?mobi', url: 'https://rdrr.io/cran/seminr/man/mobi.html' }],
    description: 'The help-page example: image × expectation as an orthogonalised term and image × value from product indicators, both predicting satisfaction with the main effects. Select a moderation arrow to switch its term between two-stage, orthogonalising and product indicators.',
    data: { package: 'seminr', name: 'mobi' }, constructs: [MOBI[0], MOBI[1], MOBI[3], MOBI[4]],
    paths: [['Image', 'Satisfaction'], ['Expectation', 'Satisfaction'], ['Value', 'Satisfaction']],
    moderations: [['Image', 'Expectation', 'Satisfaction', 'orthogonal'], ['Image', 'Value', 'Satisfaction', 'product_indicator']], settings: SEMINR(500),
  },
  {
    id: 'seminr-corprep', package: 'seminr', title: 'Corporate reputation (PLS-SEM primer)', source: 'seminr, corp_rep_data; Hair et al. (2021), chapter 5',
    links: [{ label: '?corp_rep_data', url: 'https://rdrr.io/cran/seminr/man/corp_rep_data.html' }, { label: 'Hair et al. (2021), PLS-SEM using R (open access)', url: 'https://doi.org/10.1007/978-3-030-80519-7' }],
    description: 'The extended corporate reputation model: quality, performance, CSR and attractiveness (Mode B) driving competence and likeability, satisfaction and loyalty. Missing values (-99) are replaced by indicator means; 1,000 bootstrap subsamples with seed 123, as in the book.',
    data: { package: 'seminr', name: 'corp_rep_data', na: [-99] },
    constructs: [c('QUAL', items('qual_', 8)), c('PERF', items('perf_', 5)), c('CSOR', items('csor_', 5)), c('ATTR', items('attr_', 3)),
      c('COMP', items('comp_', 3), 'A'), c('LIKE', items('like_', 3), 'A'), c('CUSA', ['cusa'], 'A'), c('CUSL', items('cusl_', 3), 'A')],
    paths: [...fan(['QUAL', 'PERF', 'CSOR', 'ATTR'], ['COMP', 'LIKE']), ...fan(['COMP', 'LIKE'], ['CUSA', 'CUSL']), ['CUSA', 'CUSL']], settings: SEMINR(1000, { seed: 123 }),
  },
  {
    id: 'seminr-influencer', package: 'seminr', title: 'Influencer marketing', source: 'seminr, demo("seminr-pls-influencer") (Hair et al. 2021)',
    links: [{ label: 'demo seminr-pls-influencer', url: 'https://github.com/sem-in-r/seminr/blob/master/demo/seminr-pls-influencer.R' }, { label: '?influencer_data', url: 'https://rdrr.io/cran/seminr/man/influencer_data.html' }, { label: 'Hair et al. (2021), PLS-SEM using R (open access)', url: 'https://doi.org/10.1007/978-3-030-80519-7' }],
    description: 'Self-influencer congruence, likeability and quality predicting purchase intention and willingness to pay; perceived influencer credibility moderates the quality effect.',
    data: { package: 'seminr', name: 'influencer_data' },
    constructs: [c('SIC', items('sic_', 7)), c('PL', items('pl_', 4), 'A'), c('PQ', items('pq_', 4), 'A'), c('PI', items('pi_', 5), 'A'), c('WTP', ['wtp'], 'A'), c('PIC', items('pic_', 5), 'A')],
    paths: [...fan(['SIC'], ['PL', 'PQ', 'PI']), ...fan(['PL', 'PQ', 'PIC'], ['PI']), ['PI', 'WTP']],
    moderations: [['PQ', 'PIC', 'PI']], settings: SEMINR(500),
  },
  {
    id: 'haven-iris', package: 'haven', title: 'An SPSS file: Fisher’s iris measurements', source: 'haven, ?read_sav (iris.sav)',
    links: [{ label: '?read_sav', url: 'https://haven.tidyverse.org/reference/read_spss.html' }, { label: 'haven', url: 'https://haven.tidyverse.org/' }],
    description: 'haven’s example SPSS file (.sav): the four flower measurements of Fisher’s iris data, read as you would read your own SPSS file (value labels dropped, numbers kept), with two principal components of the measurements: an analysis added by this example (the help page only reads the file). Opens its card on the Analyses tab.',
    data: { package: 'haven', name: 'iris.sav', packageFile: { path: 'examples/iris.sav', format: 'sav' } }, constructs: [], paths: [],
    panel: { kind: 'efa', vars: ['Sepal.Length', 'Sepal.Width', 'Petal.Length', 'Petal.Width'], method: 'pca', criterion: 'fixed', nfactors: 2, rotation: 'varimax', parallel: 0 }, settings: CB('ML'),
  },
  {
    id: 'readxl-mtcars', package: 'readxl', title: 'An Excel file: car road tests', source: 'readxl, ?read_excel (datasets.xlsx)',
    links: [{ label: '?read_excel', url: 'https://readxl.tidyverse.org/reference/read_excel.html' }, { label: 'readxl', url: 'https://readxl.tidyverse.org/' }],
    description: 'readxl’s example workbook (.xlsx), its first sheet, mtcars (the others are chickwts and quakes): the 1974 Motor Trend road tests of 32 cars, read as you would read your own Excel file, with data screening of six measures (distributions, multivariate normality, outliers): an analysis added by this example (the help page only reads the file). Opens its card on the Analyses tab.',
    data: { package: 'readxl', name: 'datasets.xlsx', packageFile: { path: 'extdata/datasets.xlsx', format: 'xlsx', sheet: 'mtcars' } }, constructs: [], paths: [],
    panel: { kind: 'screen', vars: ['mpg', 'disp', 'hp', 'drat', 'wt', 'qsec'] }, settings: CB('ML'),
  },
  {
    id: 'bootnet-bfi', package: 'bootnet', title: 'Big Five items as a network', source: 'bootnet, ?estimateNetwork (psych::bfi)',
    links: [{ label: '?estimateNetwork', url: 'https://rdrr.io/cran/bootnet/man/estimateNetwork.html' }, { label: 'Epskamp, Borsboom & Fried (2018)', url: 'https://doi.org/10.3758/s13428-017-0862-1' }],
    description: 'The 25 Big Five items of psych’s bfi (2800 people) as a regularised partial-correlation network (EBICglasso), as on bootnet’s help page: the five traits appear as clusters of items; centrality shows which items are most connected. Opens its card on the Analyses tab.',
    data: { package: 'psych', name: 'bfi' }, constructs: [], paths: [],
    panel: { kind: 'network', vars: ['A1', 'A2', 'A3', 'A4', 'A5', 'C1', 'C2', 'C3', 'C4', 'C5', 'E1', 'E2', 'E3', 'E4', 'E5', 'N1', 'N2', 'N3', 'N4', 'N5', 'O1', 'O2', 'O3', 'O4', 'O5'], estimator: 'EBICglasso', corMethod: 'cor_auto', missing: 'pairwise' }, settings: CB('ML'),
  },
  {
    id: 'eganet-wmt2', package: 'EGAnet', title: 'Wiener Matrizen-Test: how many dimensions?', source: 'EGAnet, ?EGA (wmt2)',
    links: [{ label: '?EGA', url: 'https://r-ega.net/reference/EGA.html' }, { label: 'Golino & Epskamp (2017)', url: 'https://doi.org/10.1371/journal.pone.0174035' }],
    description: 'Eighteen items of the Wiener Matrizen-Test 2 (1019 people), as in EGAnet’s help example: exploratory graph analysis finds the dimensions as communities of the item network, with network loadings. Opens its card on the Analyses tab.',
    data: { package: 'EGAnet', name: 'wmt2' }, constructs: [], paths: [],
    panel: { kind: 'ega', vars: ['wmt1', 'wmt2', 'wmt3', 'wmt4', 'wmt5', 'wmt6', 'wmt7', 'wmt8', 'wmt9', 'wmt10', 'wmt11', 'wmt12', 'wmt13', 'wmt14', 'wmt15', 'wmt16', 'wmt17', 'wmt18'], model: 'glasso', algorithm: 'walktrap', corr: 'auto' }, settings: CB('ML'),
  },
  {
    id: 'bayesfactor-iris', package: 'BayesFactor', title: 'Bayesian correlation: sepal length and width of irises', source: 'BayesFactor, ?correlationBF',
    links: [{ label: '?correlationBF', url: 'https://rdrr.io/cran/BayesFactor/man/correlationBF.html' }, { label: 'Ly, Verhagen & Wagenmakers (2016)', url: 'https://doi.org/10.1016/j.jmp.2015.06.004' }],
    description: 'Anderson’s 150 irises: is sepal length correlated with sepal width? The help page’s call, with BayesFactor’s default prior (rscale “medium”, a stretched beta of width 1/3; JASP’s default would be 1). The Bayes factor and the posterior of ρ. Opens its card on the Analyses tab.',
    data: { package: 'datasets', name: 'iris' }, constructs: [], paths: [],
    panel: { kind: 'bcorrelation', vars: ['Sepal.Length', 'Sepal.Width'], alternative: 'two.sided', priorWidth: 1 / 3, iterations: 10000 }, settings: CB('ML'),
  },
  {
    id: 'blavaan-hs', package: 'blavaan', title: 'Bayesian CFA: Holzinger & Swineford', source: 'blavaan, ?bcfa',
    links: [{ label: '?bcfa', url: 'https://rdrr.io/cran/blavaan/man/bcfa.html' }, { label: 'Merkle & Rosseel (2018), Journal of Statistical Software', url: 'https://doi.org/10.18637/jss.v085.i04' }],
    description: 'The three-factor model of the 301 children’s mental ability tests, fitted by MCMC (Stan) as on blavaan’s help page: blavaan’s defaults (3 chains, 500 burn-in and 1,000 draws each, its default priors, marker indicators). Posterior means and intervals, R-hat, PPP, WAIC and LOO. Runs in desktop R through the PLS Studio Helper (Stan does not run in the browser). Opens its card on the Analyses tab.',
    data: { package: 'lavaan', name: 'HolzingerSwineford1939' }, constructs: HS, paths: [],
    panel: { kind: 'bsem', identification: 'marker', chains: 3, burnin: 500, sample: 1000 }, settings: CB('ML'),
  },
];

/** The data columns a panel example uses. */
export function panelColumns(p: ExamplePanel): string[] {
  switch (p.kind) {
    case 'growth': return [...p.measures, ...p.covariates, ...(p.timeVarying ?? [])];
    case 'did': return [p.outcome, p.unit, p.time, p.treated, ...(p.post ? [p.post] : []), ...p.covariates];
    case 'regression': return [...new Set([p.outcome, ...p.predictors, ...p.interactions.flat(), p.trials, p.weights, p.cluster].filter(Boolean))];
    case 'irt': case 'lca': return p.items;
    case 'lmm': return [p.outcome, ...p.predictors, p.cluster];
    case 'gmm': return [...(p.format === 'wide' ? p.measures : [p.subject, p.time, p.outcome]), ...p.covariates];
    case 'endo': return [p.outcome ?? '', ...(p.exogenous ?? []), ...(p.endogenous ?? []), ...(p.instruments ?? []), ...(p.selection ? [p.selection.outcome, ...p.selection.regressors] : [])].filter(Boolean);
    case 'match': return [p.treatment ?? '', ...(p.covariates ?? []), p.outcome ?? ''].filter(Boolean);
    case 'rsa': return [p.outcome ?? '', p.x ?? '', p.y ?? '', ...(p.controls ?? [])].filter(Boolean);
    case 'nca': return [...p.x, p.y];
    case 'efa': return p.vars ?? [];
    case 'screen': return p.vars;
    case 'network': case 'ega': return p.vars ?? [];
    case 'bcorrelation': return p.vars;
    // (the Bayesian SEM card fits the diagram: its columns are the constructs' indicators)
    case 'bsem': return [];
  }
}

/**
 * The example as an editable model (positions are set by the automatic layout).
 * CB-SEM: exogenous constructs are correlated as in the package examples
 * (lavaan's default), and those correlations are drawn (makeCovariancesExplicit).
 * PLS-SEM and CPA have no such parameters, so nothing is added.
 */
/**
 * The settings an example opens with: its documented settings over the
 * defaults, so it runs as its source describes whatever the previous project
 * used (bootstrap count, missing-value treatment, seed, PLSc, ...). Only the
 * look of the diagram and the charts carries over from the current project.
 */
export function exampleSettings(current: Settings, overrides: Partial<Settings> = {}): Settings {
  return { ...DEFAULT_SETTINGS, figure: current.figure, charts: current.charts, ...overrides, engine: 'r' };
}

export function exampleModel(ex: PackageExample): ModelState {
  const m = exampleModelAsWritten(ex);
  return ex.settings.method === 'cbsem' ? makeCovariancesExplicit(m) : m;
}

function exampleModelAsWritten(ex: PackageExample): ModelState {
  const ids = new Map(ex.constructs.map((k) => [k.name, newId('c')]));
  const id = (n: string) => { const v = ids.get(n); if (!v) throw new Error(`Example ${ex.id}: unknown construct ${n}`); return v; };
  const paths = ex.paths.map(([a, b]) => ({ id: newId('p'), from: id(a), to: id(b) }));
  return {
    constructs: ex.constructs.map((k, i) => ({
      id: id(k.name), name: k.name, type: k.type ?? 'factor', mode: k.mode ?? 'A', indicators: k.indicators ?? [],
      x: (i % 4) * 320, y: Math.floor(i / 4) * 260, side: 'left' as const,
      ...(k.components ? { components: k.components.map(id) } : {}),
      ...(k.covariate ? { covariate: true } : {}),
      ...(k.labels ? { loadingLabels: k.labels } : {}),
    })),
    paths,
    moderations: (ex.moderations ?? []).map(([from, moderator, to, method]) => ({ id: newId('m'), moderator: id(moderator), path: paths.find((p) => p.from === id(from) && p.to === id(to))!.id, ...(method ? { method } : {}) })),
    ...(ex.correlations?.length ? { correlations: ex.correlations.map(([a, b, kind]) => ({ id: newId('k'), kind, a: kind === 'construct' ? id(a) : a, b: kind === 'construct' ? id(b) : b })) } : {}),
    ...(ex.multigroup ? { multigroup: { ...ex.multigroup, free: ex.multigroup.free.map((p) => (p.kind === 'loading' || p.kind === 'mean' ? { ...p, construct: id(p.construct) } : p.kind === 'regression' ? { ...p, from: id(p.from), to: id(p.to) } : p)) } } : {}),
    ...(ex.ordered?.length ? { ordered: [...ex.ordered] } : {}),
    ...(ex.multilevel ? { multilevel: ex.multilevel } : {}),
    ...(ex.esem ? { esem: { rotation: ex.esem.rotation, blocks: ex.esem.blocks.map((b) => ({ id: newId('e'), constructs: b.map(id) })), ...(ex.esem.epsilon !== undefined ? { epsilon: ex.esem.epsilon } : {}), ...(ex.esem.orthogonal ? { orthogonal: true } : {}) } } : {}),
    ...(ex.information ? { information: ex.information } : {}),
    ...(ex.baseline ? { baseline: ex.baseline } : {}),
    // The constant sits left of the first column (autoLayout moves only the constructs).
    ...(ex.constant || ex.means?.length ? { constant: { x: -220, y: 120 } } : {}),
    ...(ex.means?.length ? { means: ex.means.map((t) => ({ id: newId('mt'), target: id(t.construct), ...(t.fixed !== undefined ? { fixed: t.fixed } : {}), ...(t.label ? { label: t.label } : {}) })) } : {}),
  };
}
