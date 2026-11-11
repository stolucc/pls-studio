// What an example is about, as short tags for the home screen: derived from
// its definition (method, estimator, what the model and its card contain), so
// they stay true when an example changes; `tags` on the example adds more.

import type { PackageExample } from './packages';

const PANEL_TAGS: Record<string, string[]> = {
  growth: ['Longitudinal', 'Growth curve'],
  irt: ['Items', 'IRT'],
  lca: ['Items', 'Latent classes'],
  lmm: ['Mixed models', 'Multilevel'],
  glmm: ['Mixed models', 'Generalized linear mixed model'],
  gmm: ['Longitudinal', 'Growth mixture'],
  endo: ['Regression', 'Endogeneity'],
  match: ['Causal inference'],
  did: ['Causal inference', 'Difference-in-differences', 'Panel data'],
  regression: ['Regression'],
  rsa: ['Regression', 'Response surface'],
  nca: ['Necessary conditions'],
  qca: ['Set-theoretic methods', 'fsQCA'],
  efa: ['Measurement', 'Factor analysis'],
  screen: ['Data screening'],
  network: ['Networks', 'Partial correlations'],
  ega: ['Networks', 'EGA'],
  bcorrelation: ['Bayesian', 'Correlation'],
  bsem: ['Bayesian', 'CB-SEM'],
  ttest: ['Basic statistics', 't-test'],
  anova: ['Basic statistics', 'ANOVA'],
  rmanova: ['Basic statistics', 'ANOVA', 'Repeated measures'],
  manova: ['Basic statistics', 'MANOVA'],
  methodcompare: ['PLS-SEM', 'CB-SEM'],
  parcelallocation: ['CB-SEM', 'Parcels'],
  correlation: ['Basic statistics', 'Correlation'],
  contingency: ['Basic statistics', 'Contingency table'],
  freqtest: ['Basic statistics', 'Binomial test'],
  reliability: ['Basic statistics', 'Reliability'],
  bttest: ['Bayesian', 't-test'],
  banova: ['Bayesian', 'ANOVA'],
  brmanova: ['Bayesian', 'ANOVA', 'Repeated measures'],
  bregression: ['Bayesian', 'Regression'],
  bcontingency: ['Bayesian', 'Contingency table'],
  bbinomial: ['Bayesian', 'Binomial test'],
  chart: ['Charts'],
  bollenstine: ['Bootstrap', 'Model fit'],
  dynamicfit: ['Model fit', 'Dynamic fit cutoffs'],
  cbcompare: ['Parameter comparisons'],
  cbmodels: ['Model comparison', 'Vuong test'],
  scoreweights: ['Factor scores'],
  plspredict: ['Prediction'],
  compare: ['Model comparison'],
  cta: ['Tetrad analysis'],
  minsample: ['Sample size'],
  pos: ['Segmentation'],
  mc: ['Simulation', 'Sample size'],
  riclpm: ['Longitudinal', 'Panel data', 'Cross-lagged'],
  lcs: ['Longitudinal', 'Latent change scores'],
  customml: ['Custom likelihood'],
  bmvreg: ['Bayesian', 'Regression'],
  efa2l: ['Measurement', 'Factor analysis', 'Multilevel'],
  missingdata: ['Missing data', 'Data screening'],
  quadml: ['Numerical integration'],
  dsem: ['Bayesian', 'Multilevel'],
  cmb: ['Measurement', 'Common method bias'],
  cvi: ['Measurement', 'Content validity'],
  scoretest: ['Measurement', 'Measurement invariance'],
  alignment: ['Measurement invariance', 'Multigroup', 'Alignment'],
  mnlfa: ['Measurement invariance', 'Items', 'DIF', 'MNLFA'],
  lsem: ['Measurement invariance', 'Local SEM'],
  dmacs: ['Measurement invariance', 'Effect sizes'],
  sempower: ['Power analysis', 'Sample size'],
  pwr: ['Basic statistics', 'Power analysis', 'Sample size'],
  pcor: ['Basic statistics', 'Partial correlations'],
  metasem: ['Meta-analysis'],
  semtree: ['SEM trees', 'Heterogeneity'],
  psem: ['Piecewise SEM', 'Path analysis', 'd-separation'],
  plsmultilevel: ['Multilevel', 'Random slopes'],
  regsem: ['Regularised SEM', 'Model modification'],
  hypotheses: ['Informative hypotheses', 'Bayes factors'],
  apim: ['Dyadic data', 'APIM', 'CB-SEM'],
  semsens: ['Sensitivity analysis', 'Unmeasured confounding'],
  medsens: ['Sensitivity analysis', 'Unmeasured confounding'],
};
/** Cards about the example's model: the model's method is a topic of the example. The other cards stand on their own. */
const MODEL_CARDS = new Set([
  'parcelallocation',
  'methodcompare',
  'bsem',
  'bollenstine',
  'dynamicfit',
  'cbcompare',
  'scoreweights',
  'plspredict',
  'compare',
  'cta',
  'minsample',
  'pos',
  'mc',
  'cmb',
  'regsem',
  'sempower',
  'metasem',
  'semtree',
  'plsmultilevel',
  'alignment',
  'semsens',
  'medsens',
  'scoretest',
  'cbmodels',
  'lsem',
  'dmacs',
  'psem',
  'hypotheses',
]);
const ASSESSMENT_TAGS: Record<string, string> = {
  predict: 'Prediction',
  blindfold: 'Blindfolding',
  compare: 'Model comparison',
  groups: 'Multigroup',
  cca: 'Confirmatory composite analysis',
};
const SEGMENTATION_TAGS: Record<string, string> = {
  rebus: 'Segmentation',
  fimix: 'Segmentation',
  pathmox: 'Segmentation',
  pos: 'Segmentation',
};

/** Mediation: some construct is both the head of one path and the tail of another. */
const hasMediation = (paths: [string, string][]) =>
  paths.some(([, to]) => paths.some(([from]) => from === to));

export function exampleTags(ex: PackageExample): string[] {
  const s = ex.settings;
  const out: string[] = [];
  const method = s.method ?? 'pls';
  // (an example that opens a card of its own, e.g. a regression or a t-test, is not about the model's method)
  const ofModel = !ex.panel || MODEL_CARDS.has(ex.panel.kind);
  if (ofModel && method === 'process') out.push('CPA', 'Mediation');
  else if (ofModel && method === 'cbsem') out.push(s.estimator === '2SLS' ? 'MIIV-2SLS' : 'CB-SEM');
  else if (ofModel) out.push(s.consistent ? 'PLSc' : 'PLS-SEM');
  if (ofModel && method === 'cbsem' && s.estimator && !['ML', '2SLS'].includes(s.estimator))
    out.push(s.estimator === 'RML' ? 'Robust ML' : s.estimator);
  if (s.missing === 'mi') out.push('Multiple imputation');
  if (s.missing === 'fiml') out.push('FIML');
  if (method === 'cbsem' && !ex.panel && ex.constructs.length && ex.paths.length === 0)
    out.push('CFA');
  if (ex.moderations?.length) out.push('Moderation');
  if (ex.copulas?.length) out.push('Endogeneity');
  if (method !== 'process' && hasMediation(ex.paths)) out.push('Mediation');
  if (ex.constructs.some((c) => c.components?.length)) out.push('Second-order');
  if (method === 'pls' && ex.constructs.some((c) => c.type === 'composite')) out.push('Composites');
  if (ex.multigroup || ex.assessment?.group) out.push('Multigroup');
  if (ex.multilevel) out.push('Multilevel');
  if (ex.esem) out.push('ESEM');
  if (ex.correlations?.some((k) => k[2] === 'indicator')) out.push('Correlated errors');
  if (ex.ordered?.length) out.push('Ordinal indicators');
  if (ex.constructs.some((c) => c.covariate)) out.push('Covariates');
  if (ex.constant || ex.means?.length) out.push('Mean structure');
  if (ex.panel)
    for (const p of [ex.panel, ...(ex.morePanels ?? [])]) out.push(...(PANEL_TAGS[p.kind] ?? []));
  if (ex.panel?.kind === 'endo' && ex.panel.method === 'iv') out.push('Instrumental variables');
  if (ex.panel?.kind === 'endo' && ex.panel.method === 'heckman') out.push('Sample selection');
  if (ex.panel?.kind === 'efa' && ex.panel.method === 'pca') out.push('PCA');
  if (ex.panel?.kind === 'match')
    out.push(ex.panel.method === 'weighting' ? 'Weighting' : 'Matching');
  if (ex.assessment) {
    const t = ASSESSMENT_TAGS[ex.assessment.tab];
    if (t && !out.includes(t)) out.push(t);
  }
  if (ex.segmentation) out.push(SEGMENTATION_TAGS[ex.segmentation.method ?? 'rebus']);
  if (ex.screening)
    out.push(ex.screening.tab === 'influence' ? 'Influential cases' : 'Data screening');
  if (ex.data.packageFile || ex.data.file)
    out.push(ex.data.packageFile ? 'File import' : 'Shipped data');
  // (data PLS Studio may not distribute: downloaded from their source when the example opens)
  if (ex.data.remote) out.push('Downloaded data');
  for (const t of ex.tags ?? []) if (!out.includes(t)) out.push(t);
  return [...new Set(out)];
}

/** Topics in alphabetical order (case-insensitive), each once: the home screen's topic filter. */
export function sortTopics(tags: Iterable<string>): string[] {
  return [...new Set(tags)].sort(
    (a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }) || a.localeCompare(b),
  );
}

/** Every tag in use, in alphabetical order (the home screen's topic filter). */
export function allTags(examples: PackageExample[]): string[] {
  return sortTopics(examples.flatMap((e) => exampleTags(e)));
}

/**
 * The authors whose book, manual or paper an example reproduces (surnames, one tag each,
 * so that "Bollen" finds Bollen's own models and Bollen & Curran's): the home screen's
 * author filter. Package help pages without such a source carry none.
 */
const AUTHORS_BY_ID: Record<string, string[]> = {
  'lavaan-poldem': ['Bollen'],
  'miivsem-bollen': ['Bollen'],
  'bollen-union': ['Bollen'],
  'bollen-felson': ['Bollen'],
  'bollen-accessibility': ['Bollen'],
  'cardata-duncan': ['Fox', 'Weisberg'],
  'cardata-prestige': ['Fox', 'Weisberg'],
  'faraway-gala': ['Faraway'],
  'mass-menarche': ['Venables', 'Ripley'],
  'mass-quine': ['Venables', 'Ripley'],
  'mass-housing': ['Venables', 'Ripley'],
  'mass-birthwt': ['Venables', 'Ripley'],
  'nnet-birthwt': ['Venables', 'Ripley'],
  'stats-dobson': ['Dobson'],
  'stats-clotting': ['McCullagh', 'Nelder'],
  'datasets-attitude': ['Chatterjee', 'Price'],
  'datasets-swiss': ['Mosteller', 'Tukey'],
  'csem-itflex': ['Henseler'],
  'csem-yoo': ['Henseler'],
  'csem-bergami': ['Henseler'],
  'csem-switching': ['Henseler'],
  'csem-russett': ['Henseler'],
  'csem-lancelot': ['Henseler'],
  'seminr-corprep': ['Hair'],
  'seminr-influencer': ['Hair'],
  'did-mpdta': ['Callaway', 'Sant’Anna'],
  'plspm-fimix': ['Sarstedt'],
  'manymome-med': ['Hayes'],
  'manymome-modmed': ['Hayes'],
  'manymome-serial': ['Hayes'],
  'seminr-corprep-predict': ['Hair'],
  'seminr-corprep-cta': ['Hair'],
  'seminr-corprep-minsample': ['Hair', 'Kock', 'Hadaya'],
  'plspm-pos': ['Becker'],
  'lavaan-hs-bollenstine': ['Bollen', 'Stine'],
  'muthen-mc-cfa': ['Muthén'],
  'mulder-riclpm': ['Mulder', 'Hamaker'],
  'dynamic-hs-cfahb': ['Wolf', 'McNeish'],
  'dynamic-hs-cfaone': ['Wolf', 'McNeish'],
  'dynamic-hs-exactfit': ['Wolf', 'McNeish'],
  'dynamic-hs-equivtest': ['Wolf', 'McNeish', 'Yuan'],
  'dynamic-holzinger-dddfi': ['Wolf', 'McNeish'],
  'dynamic-example-catone': ['Wolf', 'McNeish'],
  'dynamic-example-cathb': ['Wolf', 'McNeish'],
  'dynamic-example-likertone': ['Wolf', 'McNeish'],
  'dynamic-example-likerthb': ['Wolf', 'McNeish'],
  'dynamic-example-nnorhb': ['Wolf', 'McNeish'],
};

export function exampleAuthors(ex: Pick<PackageExample, 'id'>): string[] {
  if (ex.id.startsWith('mplus-')) return ['Muthén'];
  return AUTHORS_BY_ID[ex.id] ?? [];
}
