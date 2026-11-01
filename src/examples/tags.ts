// What an example is about, as short tags for the home screen: derived from
// its definition (method, estimator, what the model and its card contain), so
// they stay true when an example changes; `tags` on the example adds more.

import type { PackageExample } from './packages';

const PANEL_TAGS: Record<string, string[]> = {
  growth: ['Longitudinal', 'Growth curve'], irt: ['Items', 'IRT'], lca: ['Items', 'Latent classes'], lmm: ['Mixed models'], gmm: ['Longitudinal', 'Growth mixture'],
  endo: ['Regression', 'Endogeneity'], match: ['Causal inference'], did: ['Causal inference', 'Difference-in-differences', 'Panel data'], regression: ['Regression'], rsa: ['Regression', 'Response surface'], nca: ['Necessary conditions'],
  efa: ['Measurement', 'Factor analysis'], screen: ['Data screening'], network: ['Networks'], ega: ['Networks', 'EGA'],
};
const ASSESSMENT_TAGS: Record<string, string> = { predict: 'Prediction', blindfold: 'Blindfolding', compare: 'Model comparison', groups: 'Multigroup', cca: 'Confirmatory composite analysis' };
const SEGMENTATION_TAGS: Record<string, string> = { rebus: 'Segmentation', fimix: 'Segmentation', pathmox: 'Segmentation', pos: 'Segmentation' };

/** Mediation: some construct is both the head of one path and the tail of another. */
const hasMediation = (paths: [string, string][]) => paths.some(([, to]) => paths.some(([from]) => from === to));

export function exampleTags(ex: PackageExample): string[] {
  const s = ex.settings;
  const out: string[] = [];
  const method = s.method ?? 'pls';
  if (method === 'process') out.push('CPA', 'Mediation');
  else if (method === 'cbsem') out.push(s.estimator === '2SLS' ? 'MIIV-2SLS' : 'CB-SEM');
  else out.push(s.consistent ? 'PLSc' : 'PLS-SEM');
  if (method === 'cbsem' && s.estimator && !['ML', '2SLS'].includes(s.estimator)) out.push(s.estimator === 'RML' ? 'Robust ML' : s.estimator);
  if (s.missing === 'mi') out.push('Multiple imputation');
  if (s.missing === 'fiml') out.push('FIML');
  if (method === 'cbsem' && !ex.panel && ex.constructs.length && ex.paths.length === 0) out.push('CFA');
  if (ex.moderations?.length) out.push('Moderation');
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
  if (ex.panel) out.push(...(PANEL_TAGS[ex.panel.kind] ?? []));
  if (ex.panel?.kind === 'endo' && ex.panel.method === 'iv') out.push('Instrumental variables');
  if (ex.panel?.kind === 'endo' && ex.panel.method === 'heckman') out.push('Sample selection');
  if (ex.panel?.kind === 'efa' && ex.panel.method === 'pca') out.push('PCA');
  if (ex.panel?.kind === 'match' && ex.panel.method === 'weighting') out.push('Weighting');
  if (ex.assessment) { const t = ASSESSMENT_TAGS[ex.assessment.tab]; if (t && !out.includes(t)) out.push(t); }
  if (ex.segmentation) out.push(SEGMENTATION_TAGS[ex.segmentation.method ?? 'rebus']);
  if (ex.screening) out.push(ex.screening.tab === 'influence' ? 'Influential cases' : 'Data screening');
  if (ex.data.packageFile || ex.data.file) out.push(ex.data.packageFile ? 'File import' : 'Shipped data');
  for (const t of ex.tags ?? []) if (!out.includes(t)) out.push(t);
  return [...new Set(out)];
}

/** Every tag in use, most frequent first (the home screen's topic filter). */
export function allTags(examples: PackageExample[]): string[] {
  const n = new Map<string, number>();
  for (const e of examples) for (const t of exampleTags(e)) n.set(t, (n.get(t) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
}
