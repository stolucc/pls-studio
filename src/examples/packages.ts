// Examples from the R packages' own documentation: the dataset ships with the
// package (loaded in the browser's R at open time) and the model follows the
// package's help page, demo or tutorial. Models the editor cannot represent
// faithfully (equality labels, PLS higher-order composites, ignored structural
// models) are left out or noted.

import type { Correlation, ModelState, Settings } from '../model/project';
import { newId } from '../model/project';

export type ExamplePackage = 'lavaan' | 'MIIVsem' | 'cSEM' | 'seminr';

interface ExConstruct { name: string; type?: 'factor' | 'composite'; mode?: 'A' | 'B'; indicators?: string[]; components?: string[] }

export interface PackageExample {
  id: string;
  package: ExamplePackage;
  title: string;
  /** Where the model comes from (help page, demo, publication). */
  source: string;
  /** The original documentation (R help pages, demos, tutorials, publications). */
  links: { label: string; url: string }[];
  description: string;
  data: { package: ExamplePackage; name: string; na?: number[] };
  constructs: ExConstruct[];
  paths: [string, string][];
  correlations?: [string, string, Correlation['kind']][];
  moderations?: [string, string, string][];
  settings: Partial<Settings>;
}

const f = (name: string, indicators: string[]): ExConstruct => ({ name, type: 'factor', mode: 'A', indicators });
const c = (name: string, indicators: string[], mode: 'A' | 'B' = 'B'): ExConstruct => ({ name, type: 'composite', mode, indicators });
const items = (p: string, k: number, from = 1) => Array.from({ length: k }, (_, i) => `${p}${i + from}`);
const fan = (from: string[], to: string[]) => from.flatMap((a) => to.map((b): [string, string] => [a, b]));

const BOLLEN = {
  constructs: [f('ind60', items('x', 3)), f('dem60', items('y', 4)), f('dem65', items('y', 4, 5))],
  paths: [['ind60', 'dem60'], ['ind60', 'dem65'], ['dem60', 'dem65']] as [string, string][],
  correlations: [['y1', 'y5', 'indicator'], ['y2', 'y4', 'indicator'], ['y2', 'y6', 'indicator'], ['y3', 'y7', 'indicator'], ['y4', 'y8', 'indicator'], ['y6', 'y8', 'indicator']] as [string, string, 'indicator'][],
};
const HS = [f('visual', items('x', 3)), f('textual', items('x', 3, 4)), f('speed', items('x', 3, 7))];
const MOBI = [c('Image', items('IMAG', 5), 'A'), c('Expectation', items('CUEX', 3), 'A'), c('Quality', items('PERQ', 7), 'A'), c('Value', items('PERV', 2), 'A'),
  c('Satisfaction', items('CUSA', 3), 'A'), c('Complaints', ['CUSCO'], 'A'), c('Loyalty', items('CUSL', 3), 'A')];
const CB = (estimator: Settings['estimator']): Partial<Settings> => ({ method: 'cbsem', estimator, missing: 'casewise' });
const PLS = (plsPackage: 'cSEM' | 'seminr', consistent: boolean, scheme: Settings['scheme'] = 'path'): Partial<Settings> => ({ method: 'pls', plsPackage, consistent, scheme, missing: 'mean' });

export const PACKAGE_EXAMPLES: PackageExample[] = [
  {
    id: 'lavaan-hs', package: 'lavaan', title: 'Holzinger & Swineford: three-factor CFA', source: 'lavaan, ?cfa',
    links: [{ label: '?cfa', url: 'https://rdrr.io/cran/lavaan/man/cfa.html' }, { label: 'lavaan tutorial: CFA', url: 'https://lavaan.ugent.be/tutorial/cfa.html' }, { label: '?HolzingerSwineford1939', url: 'https://rdrr.io/cran/lavaan/man/HolzingerSwineford1939.html' }],
    description: 'Mental ability tests of 301 seventh- and eighth-grade children: visual, textual and speed factors, three tests each. The standard CFA example.',
    data: { package: 'lavaan', name: 'HolzingerSwineford1939' }, constructs: HS, paths: [], settings: CB('ML'),
  },
  {
    id: 'lavaan-poldem', package: 'lavaan', title: 'Industrialisation and political democracy', source: 'lavaan, ?sem (Bollen 1989)',
    links: [{ label: '?sem', url: 'https://rdrr.io/cran/lavaan/man/sem.html' }, { label: 'lavaan tutorial: SEM', url: 'https://lavaan.ugent.be/tutorial/sem.html' }, { label: '?PoliticalDemocracy', url: 'https://rdrr.io/cran/lavaan/man/PoliticalDemocracy.html' }],
    description: 'Bollen’s SEM with six correlated measurement errors. lavaan’s help page also holds loadings equal across 1960 and 1965 (labels a, b, c); equality constraints are not available in the editor, so this version estimates them freely (χ²(35) = 38.13).',
    data: { package: 'lavaan', name: 'PoliticalDemocracy' }, ...BOLLEN, settings: CB('ML'),
  },
  {
    id: 'miivsem-bollen', package: 'MIIVsem', title: 'Political democracy by MIIV-2SLS', source: 'MIIVsem, bollen1989a',
    links: [{ label: '?miive', url: 'https://rdrr.io/cran/MIIVsem/man/miive.html' }, { label: '?bollen1989a', url: 'https://rdrr.io/cran/MIIVsem/man/bollen1989a.html' }],
    description: 'The same model estimated equation by equation with model-implied instrumental variables (Bollen 1996). Correlated errors remove the instruments they invalidate; Sargan tests check each overidentified equation.',
    data: { package: 'MIIVsem', name: 'bollen1989a' }, ...BOLLEN, settings: CB('2SLS'),
  },
  {
    id: 'miivsem-hs', package: 'MIIVsem', title: 'Holzinger & Swineford CFA by MIIV-2SLS', source: 'MIIVsem applied to lavaan’s HolzingerSwineford1939',
    links: [{ label: '?miive', url: 'https://rdrr.io/cran/MIIVsem/man/miive.html' }, { label: '?HolzingerSwineford1939', url: 'https://rdrr.io/cran/lavaan/man/HolzingerSwineford1939.html' }],
    description: 'Each loading estimated by its own 2SLS regression on the marker indicator, with Sargan tests per equation. Compare with the ML CFA.',
    data: { package: 'lavaan', name: 'HolzingerSwineford1939' }, constructs: HS, paths: [], settings: CB('2SLS'),
  },
  {
    id: 'csem-threecf', package: 'cSEM', title: 'Three common factors (PLSc)', source: 'cSEM, ?threecommonfactors',
    links: [{ label: '?threecommonfactors', url: 'https://rdrr.io/cran/cSEM/man/threecommonfactors.html' }],
    description: 'Simulated data from a known three-factor model (N = 500). Consistent PLS recovers the population values; the help page runs the bootstrap test of overall fit (testOMF).',
    data: { package: 'cSEM', name: 'threecommonfactors' },
    constructs: [f('eta1', items('y1', 3, 1)), f('eta2', items('y2', 3, 1)), f('eta3', items('y3', 3, 1))],
    paths: [['eta1', 'eta2'], ['eta1', 'eta3'], ['eta2', 'eta3']], settings: PLS('cSEM', true),
  },
  {
    id: 'csem-satisfaction', package: 'cSEM', title: 'Customer satisfaction (ECSI)', source: 'cSEM, satisfaction data; Tenenhaus et al. (2005) model',
    links: [{ label: '?satisfaction', url: 'https://rdrr.io/cran/cSEM/man/satisfaction.html' }],
    description: 'European Customer Satisfaction Index for a mobile phone provider (N = 250): image, expectations, quality, value, satisfaction and loyalty.',
    data: { package: 'cSEM', name: 'satisfaction' },
    constructs: [f('IMAG', items('imag', 5)), f('EXPE', items('expe', 5)), f('QUAL', items('qual', 5)), f('VAL', items('val', 4)), f('SAT', items('sat', 4)), f('LOY', items('loy', 4))],
    paths: [['IMAG', 'EXPE'], ['IMAG', 'SAT'], ['IMAG', 'LOY'], ['EXPE', 'QUAL'], ['EXPE', 'VAL'], ['EXPE', 'SAT'], ['QUAL', 'VAL'], ['QUAL', 'SAT'], ['VAL', 'SAT'], ['SAT', 'LOY']],
    settings: PLS('cSEM', true),
  },
  {
    id: 'csem-bergami', package: 'cSEM', title: 'Organisational identification', source: 'cSEM, ?BergamiBagozzi2000 (Henseler 2021)',
    links: [{ label: '?BergamiBagozzi2000', url: 'https://rdrr.io/cran/cSEM/man/BergamiBagozzi2000.html' }],
    description: 'Bergami & Bagozzi (2000): organisational prestige and identification predicting affective commitment (love and joy), with gender as a single-indicator composite. Factorial scheme, PLSc.',
    data: { package: 'cSEM', name: 'BergamiBagozzi2000' },
    constructs: [f('OrgPres', items('cei', 8)), f('OrgIden', items('ma', 6)), f('AffLove', ['orgcmt1', 'orgcmt2', 'orgcmt3', 'orgcmt7']), f('AffJoy', ['orgcmt5', 'orgcmt8']), c('Gender', ['gender'])],
    paths: [['OrgPres', 'OrgIden'], ...fan(['OrgPres', 'OrgIden', 'Gender'], ['AffLove', 'AffJoy'])], settings: PLS('cSEM', true, 'factor'),
  },
  {
    id: 'csem-switching', package: 'cSEM', title: 'Switching intention: an interaction', source: 'cSEM, ?Switching (Henseler 2021)',
    links: [{ label: '?Switching', url: 'https://rdrr.io/cran/cSEM/man/Switching.html' }],
    description: 'Does investment in a relationship moderate the effect of satisfaction on the intention to switch? cSEM models the interaction term INV.SAT as the product of the construct scores.',
    data: { package: 'cSEM', name: 'Switching' },
    constructs: [f('INV', items('INV', 4)), f('SAT', items('SAT', 3)), f('INT', items('INT', 2))],
    paths: [['INV', 'INT'], ['SAT', 'INT']], moderations: [['INV', 'SAT', 'INT']], settings: PLS('cSEM', false, 'factor'),
  },
  {
    id: 'csem-russett', package: 'cSEM', title: 'Agricultural inequality and political instability', source: 'cSEM, ?Russett (Henseler 2020)',
    links: [{ label: '?Russett', url: 'https://rdrr.io/cran/cSEM/man/Russett.html' }],
    description: 'Russett’s (1964) data on 47 countries: composites of agricultural inequality and industrial development predicting political instability.',
    data: { package: 'cSEM', name: 'Russett' },
    constructs: [c('AgrIneq', ['gini', 'farm', 'rent']), c('IndDev', ['gnpr', 'labo']), c('PolInst', ['inst', 'ecks', 'deat', 'stab', 'dict'])],
    paths: [['AgrIneq', 'PolInst'], ['IndDev', 'PolInst']], settings: PLS('cSEM', false, 'factor'),
  },
  {
    id: 'csem-lancelot', package: 'cSEM', title: 'Privacy, trust and risk: mediation', source: 'cSEM, ?LancelotMiltgenetal2016 (Henseler 2020)',
    links: [{ label: '?LancelotMiltgenetal2016', url: 'https://rdrr.io/cran/cSEM/man/LancelotMiltgenetal2016.html' }],
    description: 'Privacy concerns affect the intention to provide data directly and through trust and perceived risk (N = 1090). Bootstrap the indirect effects.',
    data: { package: 'cSEM', name: 'LancelotMiltgenetal2016' },
    constructs: [f('Trust', ['trust1', 'trust2']), f('PrCon', items('privcon', 4)), f('Risk', items('risk', 3)), f('Int', ['intent1', 'intent2'])],
    paths: [['Trust', 'Int'], ['PrCon', 'Int'], ['Risk', 'Int'], ['Trust', 'Risk'], ['PrCon', 'Risk'], ['PrCon', 'Trust']], settings: PLS('cSEM', true, 'factor'),
  },
  {
    id: 'csem-benitez', package: 'cSEM', title: 'Social media capability and performance', source: 'cSEM, ?Benitezetal2020',
    links: [{ label: '?Benitezetal2020', url: 'https://rdrr.io/cran/cSEM/man/Benitezetal2020.html' }],
    description: 'Benitez et al. (2020): firms’ social media capability (a composite) between external and internal social media use and business process performance, with firm size and industry as control composites.',
    data: { package: 'cSEM', name: 'Benitezetal2020' },
    constructs: [f('SEXB', items('SEXB', 4)), f('SEMB', items('SEMB', 4)), c('SMC', items('SMC', 4)), c('BPP', items('BPP', 5)), c('FS', ['FirmSize']), c('Ind', items('Industry', 3))],
    paths: [['SEXB', 'SMC'], ['SEMB', 'SMC'], ['SMC', 'BPP'], ['Ind', 'BPP'], ['FS', 'BPP']], settings: PLS('cSEM', true, 'factor'),
  },
  {
    id: 'seminr-mobi', package: 'seminr', title: 'Mobile phone satisfaction (ECSI)', source: 'seminr, demo("seminr-pls-ecsi")',
    links: [{ label: 'demo seminr-pls-ecsi', url: 'https://github.com/sem-in-r/seminr/blob/master/demo/seminr-pls-ecsi.R' }, { label: '?mobi', url: 'https://rdrr.io/cran/seminr/man/mobi.html' }],
    description: 'The ECSI model on seminr’s mobi data: seven composites (Mode A), complaints as a single item.',
    data: { package: 'seminr', name: 'mobi' }, constructs: MOBI,
    paths: [...fan(['Image'], ['Expectation', 'Satisfaction', 'Loyalty']), ...fan(['Expectation'], ['Quality', 'Value', 'Satisfaction']), ...fan(['Quality'], ['Value', 'Satisfaction']),
      ['Value', 'Satisfaction'], ['Satisfaction', 'Complaints'], ['Satisfaction', 'Loyalty'], ['Complaints', 'Loyalty']],
    settings: PLS('seminr', false),
  },
  {
    id: 'seminr-interaction', package: 'seminr', title: 'Moderated satisfaction', source: 'seminr, demo("seminr-pls-interaction")',
    links: [{ label: 'demo seminr-pls-interaction', url: 'https://github.com/sem-in-r/seminr/blob/master/demo/seminr-pls-interaction.R' }, { label: '?mobi', url: 'https://rdrr.io/cran/seminr/man/mobi.html' }],
    description: 'Do expectations and value moderate the effect of image on satisfaction? Two-stage interaction terms (the demo also shows the orthogonalising and product-indicator approaches).',
    data: { package: 'seminr', name: 'mobi' }, constructs: [MOBI[0], MOBI[1], MOBI[3], MOBI[4]],
    paths: [['Image', 'Satisfaction'], ['Expectation', 'Satisfaction'], ['Value', 'Satisfaction']],
    moderations: [['Image', 'Expectation', 'Satisfaction'], ['Image', 'Value', 'Satisfaction']], settings: PLS('seminr', false),
  },
  {
    id: 'seminr-corprep', package: 'seminr', title: 'Corporate reputation (PLS-SEM primer)', source: 'seminr, corp_rep_data; Hair et al. (2021), chapter 5',
    links: [{ label: '?corp_rep_data', url: 'https://rdrr.io/cran/seminr/man/corp_rep_data.html' }, { label: 'Hair et al. (2021), PLS-SEM using R (open access)', url: 'https://doi.org/10.1007/978-3-030-80519-7' }],
    description: 'The extended corporate reputation model: quality, performance, CSR and attractiveness (Mode B) driving competence and likeability, satisfaction and loyalty. Missing values (-99) are replaced by indicator means.',
    data: { package: 'seminr', name: 'corp_rep_data', na: [-99] },
    constructs: [c('QUAL', items('qual_', 8)), c('PERF', items('perf_', 5)), c('CSOR', items('csor_', 5)), c('ATTR', items('attr_', 3)),
      c('COMP', items('comp_', 3), 'A'), c('LIKE', items('like_', 3), 'A'), c('CUSA', ['cusa'], 'A'), c('CUSL', items('cusl_', 3), 'A')],
    paths: [...fan(['QUAL', 'PERF', 'CSOR', 'ATTR'], ['COMP', 'LIKE']), ...fan(['COMP', 'LIKE'], ['CUSA', 'CUSL']), ['CUSA', 'CUSL']], settings: PLS('seminr', false),
  },
  {
    id: 'seminr-influencer', package: 'seminr', title: 'Influencer marketing', source: 'seminr, demo("seminr-pls-influencer") (Hair et al. 2021)',
    links: [{ label: 'demo seminr-pls-influencer', url: 'https://github.com/sem-in-r/seminr/blob/master/demo/seminr-pls-influencer.R' }, { label: '?influencer_data', url: 'https://rdrr.io/cran/seminr/man/influencer_data.html' }, { label: 'Hair et al. (2021), PLS-SEM using R (open access)', url: 'https://doi.org/10.1007/978-3-030-80519-7' }],
    description: 'Self-influencer congruence, likeability and quality predicting purchase intention and willingness to pay; perceived influencer credibility moderates the quality effect.',
    data: { package: 'seminr', name: 'influencer_data' },
    constructs: [c('SIC', items('sic_', 7)), c('PL', items('pl_', 4), 'A'), c('PQ', items('pq_', 4), 'A'), c('PI', items('pi_', 5), 'A'), c('WTP', ['wtp'], 'A'), c('PIC', items('pic_', 5), 'A')],
    paths: [...fan(['SIC'], ['PL', 'PQ', 'PI']), ...fan(['PL', 'PQ', 'PIC'], ['PI']), ['PI', 'WTP']],
    moderations: [['PQ', 'PIC', 'PI']], settings: PLS('seminr', false),
  },
];

/** The example as an editable model (positions are set by the automatic layout). */
export function exampleModel(ex: PackageExample): ModelState {
  const ids = new Map(ex.constructs.map((k) => [k.name, newId('c')]));
  const id = (n: string) => { const v = ids.get(n); if (!v) throw new Error(`Example ${ex.id}: unknown construct ${n}`); return v; };
  const paths = ex.paths.map(([a, b]) => ({ id: newId('p'), from: id(a), to: id(b) }));
  return {
    constructs: ex.constructs.map((k, i) => ({
      id: id(k.name), name: k.name, type: k.type ?? 'factor', mode: k.mode ?? 'A', indicators: k.indicators ?? [],
      x: (i % 4) * 320, y: Math.floor(i / 4) * 260, side: 'left' as const,
      ...(k.components ? { components: k.components.map(id) } : {}),
    })),
    paths,
    moderations: (ex.moderations ?? []).map(([from, moderator, to]) => ({ id: newId('m'), moderator: id(moderator), path: paths.find((p) => p.from === id(from) && p.to === id(to))!.id })),
    ...(ex.correlations?.length ? { correlations: ex.correlations.map(([a, b, kind]) => ({ id: newId('k'), kind, a: kind === 'construct' ? id(a) : a, b: kind === 'construct' ? id(b) : b })) } : {}),
  };
}
