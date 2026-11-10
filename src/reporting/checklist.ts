// The checks reviewers ask for, per method, each marked from the results: done
// (with the evidence), an issue (with what fails), not applicable, or one the
// author has to answer (nothing in the results can show it). Based on Hair et
// al. (2019) for PLS-SEM, Jackson, Gillaspy & Purc-Stephenson (2009) for CFA and
// CB-SEM, and the JARS-Quant SEM standards (Appelbaum et al., 2018, Table 7);
// Hayes (2022) for conditional process analysis.

import type { Issue } from '../model/project';
import type { ReportInput } from './methods';

export type CheckStatus = 'done' | 'issue' | 'na' | 'author';
/** Where the user can address an item: a tab of the Model tab's results, or an analysis card to add. */
export type CheckLink = { kind: 'tab'; label: string } | { kind: 'card'; type: string; label: string } | { kind: 'model'; label: string };
export interface CheckItem {
  id: string;
  section: 'Specification' | 'Data' | 'Estimation' | 'Measurement model' | 'Structural model' | 'Model fit' | 'Groups' | 'Reporting';
  label: string;
  status: CheckStatus;
  evidence: string;
  /** Citation keys (reporting/citations.ts) of the guideline behind the item. */
  sources: string[];
  link?: CheckLink;
}

const f2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : '—');
const f3 = (x: number) => (Number.isFinite(x) ? x.toFixed(3) : '—');
/** p as APA writes it: no leading zero, < .001. */
const pv = (p: number) => (!Number.isFinite(p) ? '—' : p < 0.001 ? '< .001' : `= ${p.toFixed(3).replace(/^0/, '')}`);
const join = (xs: string[], max = 8) => (xs.length > max ? `${xs.slice(0, max).join(', ')} and ${xs.length - max} more` : xs.join(', '));
const ran = (input: ReportInput, ...types: string[]) => (input.log ?? []).some((c) => c.run && types.includes(c.type));

const tab = (label: string): CheckLink => ({ kind: 'tab', label });
const card = (type: string, label: string): CheckLink => ({ kind: 'card', type, label });

/** A chain X → M → Y in the diagram (an indirect effect to test). */
function hasMediation(input: ReportInput): boolean {
  const { paths } = input.model;
  return paths.some((p) => paths.some((q) => q.from === p.to));
}

function specItem(issues: Issue[] | undefined, sources: string[]): CheckItem {
  const errors = (issues ?? []).filter((i) => i.level === 'error'), warnings = (issues ?? []).filter((i) => i.level === 'warning');
  return {
    id: 'specification', section: 'Specification', label: 'Model specified and identified without problems', sources,
    status: errors.length || warnings.length ? 'issue' : 'done',
    evidence: errors.length || warnings.length ? [...errors, ...warnings].map((i) => i.message).join(' ') : 'The model check on the Model tab finds no problems.',
    link: { kind: 'model', label: 'Model tab' },
  };
}

function missingItem(input: ReportInput, dropped: number, sources: string[]): CheckItem {
  const { info, settings: s } = input;
  const how: Record<string, string> = { mean: 'mean replacement', casewise: 'listwise deletion', pairwise: 'pairwise deletion', fiml: 'FIML', mi: 'multiple imputation', twostage: 'the two-stage approach', robusttwostage: 'the robust two-stage approach' };
  if (info?.kind === 'matrix') return { id: 'missing', section: 'Data', label: 'Missing data and their treatment reported', status: 'na', evidence: 'Covariance-matrix input.', sources };
  if (info && info.missingCells === 0) return { id: 'missing', section: 'Data', label: 'Missing data and their treatment reported', status: 'done', evidence: 'No missing values in the data.', sources };
  return {
    id: 'missing', section: 'Data', label: 'Missing data and their treatment reported', sources,
    status: s.missing === 'mean' ? 'issue' : 'done',
    evidence: `${info ? `${info.missingCells} missing cells; ` : ''}treated by ${how[s.missing] ?? s.missing}${dropped ? ` (${dropped} cases dropped)` : ''}.${s.missing === 'mean' ? ' Mean replacement shrinks variances and correlations; reviewers prefer FIML or multiple imputation where the method allows.' : ''} Report the amount and pattern of missingness.`,
    link: card('missingdata', 'Add Missing data'),
  };
}

function bootItem(input: ReportInput, needed: boolean, label: string, sources: string[]): CheckItem {
  const b = input.boot;
  if (!needed) return { id: 'bootstrap', section: 'Estimation', label, status: 'na', evidence: 'No effect in the model that needs resampling.', sources };
  return b
    ? { id: 'bootstrap', section: 'Estimation', label, status: 'done', evidence: `${b.samples.toLocaleString('en-US')} bootstrap resamples, ${Math.round(b.confidence * 100)}% ${b.interval === 'bca' ? 'BCa' : b.interval === 'studentized' ? 'studentized' : 'percentile'} intervals${b.failed ? ` (${b.failed} failed)` : ''}.`, sources, link: tab('Bootstrapping') }
    : { id: 'bootstrap', section: 'Estimation', label, status: 'issue', evidence: 'Not bootstrapped yet: run Bootstrap on the Model tab.', sources, link: tab('Bootstrapping') };
}

const cmbItem = (input: ReportInput, sources: string[]): CheckItem => (ran(input, 'cmb')
  ? { id: 'cmb', section: 'Data', label: 'Common method variance addressed', status: 'done', evidence: 'A common method bias card has run (see the log).', sources, link: card('cmb', 'Add Common method bias') }
  : { id: 'cmb', section: 'Data', label: 'Common method variance addressed', status: 'author', evidence: 'Not checked in the log. With self-reported data from one source, reviewers expect procedural remedies and a statistical check.', sources, link: card('cmb', 'Add Common method bias') });

const softwareItem = (engine: { package: string; version: string } | undefined, sources: string[]): CheckItem => ({
  id: 'software', section: 'Reporting', label: 'Software, version and estimation settings reported', sources, status: 'author',
  evidence: `Computed by ${engine ? `${engine.package} ${engine.version}` : 'PLS Studio’s built-in engine'}: name it with its version, the estimator and the settings (the Methods text card drafts the paragraph).`,
  link: card('methodstext', 'Add Methods text'),
});

// ---------------------------------------------------------------- CB-SEM

function cbChecks(input: ReportInput, issues: Issue[] | undefined): CheckItem[] {
  const cb = input.cb!;
  const JA = ['jackson2009'], JARS = ['appelbaum2018'], BOTH = ['jackson2009', 'appelbaum2018'];
  const out: CheckItem[] = [specItem(issues, JARS)];
  const fit = cb.fit;
  out.push({ id: 'convergence', section: 'Estimation', label: 'Estimation converged to an admissible solution', sources: JA,
    status: cb.converged ? 'done' : 'issue', evidence: cb.converged ? `Converged after ${cb.iterations} iterations${cb.warnings.length ? `; warnings: ${cb.warnings.join(' ')}` : ''}.` : 'The estimation did not converge.', link: tab('Model fit') });
  // Heywood cases: negative variances, standardised loadings beyond ±1.
  const negative = cb.estimates.filter((e) => e.op === '~~' && e.lhs === e.rhs && e.est < 0).map((e) => e.lhs);
  const beyond = cb.indicators.filter((_, i) => Math.abs(cb.stdLoadings[i]) > 1).map((x) => x.name);
  out.push({ id: 'heywood', section: 'Estimation', label: 'No Heywood cases (negative variances, standardised loadings beyond ±1)', sources: JA,
    status: negative.length || beyond.length ? 'issue' : 'done',
    evidence: negative.length || beyond.length ? `${negative.length ? `Negative variance: ${join(negative)}. ` : ''}${beyond.length ? `Standardised loading beyond ±1: ${join(beyond)}.` : ''}`.trim() : 'Every variance is non-negative and every standardised loading within ±1.', link: tab('Variances & covariances') });
  const robust = fit.chisqScaled !== undefined;
  const df = robust ? fit.dfScaled ?? fit.df : fit.df;
  out.push({ id: 'chisq', section: 'Model fit', label: 'χ² test reported with df and p', sources: BOTH,
    status: !Number.isFinite(fit.chisq) ? 'issue' : df === 0 ? 'na' : 'done',
    evidence: !Number.isFinite(fit.chisq) ? 'No χ² statistic in the results.' : df === 0 ? 'The model is just-identified (df = 0): its fit cannot be tested.' : `${robust ? 'Scaled χ²' : 'χ²'}(${df}) = ${f2(robust ? fit.chisqScaled! : fit.chisq)}, p ${pv(robust ? fit.pvalueScaled ?? fit.pvalue : fit.pvalue)}${(robust ? fit.pvalueScaled ?? fit.pvalue : fit.pvalue) < 0.05 ? ': exact fit rejected; discuss the misfit (residuals, modification indices) rather than relying on approximate indices alone' : ''}.`,
    link: tab('Model fit') });
  if (df !== 0 && Number.isFinite(fit.chisq)) {
    const cfi = fit.cfiRobust ?? fit.cfi, tli = fit.tliRobust ?? fit.tli, rmsea = fit.rmseaRobust ?? fit.rmsea;
    const miss = [cfi < 0.95 && `CFI ${f3(cfi)} < .95`, tli < 0.95 && `TLI ${f3(tli)} < .95`, rmsea > 0.06 && `RMSEA ${f3(rmsea)} > .06`, fit.srmr > 0.08 && `SRMR ${f3(fit.srmr)} > .08`].filter(Boolean) as string[];
    out.push({ id: 'indices', section: 'Model fit', label: 'CFI, TLI, RMSEA with its 90% CI, and SRMR reported (Hu & Bentler, 1999 cut-offs)', sources: ['hu1999', ...BOTH],
      status: miss.length ? 'issue' : 'done',
      evidence: `${fit.cfiRobust !== undefined ? 'Robust ' : ''}CFI = ${f3(cfi)}, TLI = ${f3(tli)}, RMSEA = ${f3(rmsea)}${fit.rmseaRobust === undefined ? ` [90% CI ${f3(fit.rmseaLow)}, ${f3(fit.rmseaHigh)}]` : ''}, SRMR = ${f3(fit.srmr)}.${miss.length ? ` Misses: ${miss.join('; ')}.` : ''} The cut-offs are guidelines; dynamic fit index cut-offs tailor them to the model.`,
      link: card('dynamicfit', 'Add Dynamic fit cutoffs') });
  }
  const factorIdx = cb.constructs.map((_, j) => j).filter((j) => cb.indicators.filter((x) => x.construct === j).length > 1 && input.model.constructs.find((k) => k.name === cb.constructs[j])?.type !== 'composite');
  if (factorIdx.length) {
    const low = cb.indicators.flatMap((x, i) => (factorIdx.includes(x.construct) && Math.abs(cb.stdLoadings[i]) < 0.5 ? [`${x.name} (${f2(cb.stdLoadings[i])})`] : []));
    out.push({ id: 'loadings', section: 'Measurement model', label: 'Standardised loadings of at least .50', sources: JA, status: low.length ? 'issue' : 'done',
      evidence: low.length ? `Below .50: ${join(low)}.` : 'Every standardised loading is at least .50.', link: tab('Loadings') });
    const rel = factorIdx.map((j) => ({ name: cb.constructs[j], ...cb.reliability[j] })).filter((r) => r.cr !== undefined);
    const bad = rel.filter((r) => r.cr < 0.7 || r.ave < 0.5).map((r) => `${r.name} (CR ${f2(r.cr)}, AVE ${f2(r.ave)})`);
    out.push({ id: 'reliability', section: 'Measurement model', label: 'Composite reliability ≥ .70 and AVE ≥ .50', sources: ['fornell1981', ...JA], status: bad.length ? 'issue' : 'done',
      evidence: bad.length ? `Below the thresholds: ${join(bad)}.` : `Met by every factor (${join(rel.map((r) => `${r.name}: CR ${f2(r.cr)}, AVE ${f2(r.ave)}`))}).`, link: tab('Reliability') });
    out.push(htmtItem(cb.constructs, cb.htmt, 0.85, ['henseler2015']));
  }
  // Groups: invariance before comparing them.
  const mg = input.model.multigroup;
  out.push(!mg ? { id: 'invariance', section: 'Groups', label: 'Measurement invariance established before comparing groups', status: 'na', evidence: 'One group.', sources: ['appelbaum2018'] }
    : input.invariance ? { id: 'invariance', section: 'Groups', label: 'Measurement invariance established before comparing groups', status: 'done', evidence: `Tested: ${input.invariance.levels.map((l) => `${l.level} (CFI ${f3(l.cfi)}${l.cfiChange !== undefined ? `, ΔCFI ${f3(l.cfiChange)}` : ''}${l.p !== undefined ? `, Δχ² p ${pv(l.p)}` : ''})`).join('; ')}.`, sources: ['appelbaum2018'], link: tab('Measurement invariance') }
    : { id: 'invariance', section: 'Groups', label: 'Measurement invariance established before comparing groups', status: 'issue', evidence: `The groups are fitted at the ${mg.invariance} level without the sequence of invariance tests in the results.`, sources: ['appelbaum2018'], link: tab('Measurement invariance') });
  // Sample size against free parameters (N:q).
  const q = fit.npar;
  if (q > 0) {
    const ratio = cb.n / q;
    out.push({ id: 'samplesize', section: 'Data', label: 'Sample size adequate for the number of free parameters', sources: JA, status: ratio < 10 ? 'issue' : 'done',
      evidence: `N = ${cb.n}, q = ${q} free parameters: N:q = ${ratio.toFixed(1)}${ratio < 10 ? ', below 10:1' : ratio < 20 ? ' (10:1 is often taken as a minimum; 20:1 is recommended)' : ''}. Justify the sample size, ideally by a power analysis.`,
      link: card('mc', 'Add Monte Carlo simulation') });
  }
  out.push(missingItem(input, cb.droppedRows, BOTH));
  const nonnormal = ['MLR', 'MLM', 'MLMV', 'WLSMV', 'WLS'].includes(cb.estimator);
  out.push({ id: 'distribution', section: 'Estimation', label: 'Distributional assumptions checked; estimator justified', sources: BOTH,
    status: nonnormal || ran(input, 'screen') ? 'done' : 'author',
    evidence: nonnormal ? `${cb.estimator} does not assume multivariate normality.${ran(input, 'screen') ? ' The data were screened.' : ''}` : ran(input, 'screen') ? `${cb.estimator}; the data screening card reports univariate and multivariate normality.` : `${cb.estimator} assumes multivariate normality: report a normality check, or use a robust estimator (MLR).`,
    link: card('screen', 'Add Data screening') });
  out.push(bootItem(input, hasMediation(input), 'Indirect effects tested with bootstrap confidence intervals', JARS));
  if (input.model.paths.length) out.push({ id: 'r2', section: 'Structural model', label: 'Variance explained (R²) of the endogenous constructs reported', sources: JARS, status: 'done',
    evidence: `${cb.constructs.flatMap((n, j) => (cb.r2Constructs[j] !== null && cb.r2Constructs[j] !== undefined ? [`${n}: ${f2(cb.r2Constructs[j]!)}`] : [])).join(', ')}.`, link: tab('Regressions') });
  out.push({ id: 'modifications', section: 'Specification', label: 'Post hoc modifications reported and justified', sources: BOTH, status: 'author',
    evidence: `${cb.modindices?.length ? `${cb.modindices.length} modification indices ≥ 3.84 in the results. ` : ''}Report every change made after seeing the data, with its theoretical justification.`, link: tab('Modification indices') });
  out.push({ id: 'equivalent', section: 'Specification', label: 'Equivalent and alternative models considered', sources: BOTH, status: 'author', evidence: 'Not something the results can show: name the equivalent models (e.g. reversed paths) and why yours is preferred.' });
  out.push(cmbItem(input, ['appelbaum2018']));
  out.push(softwareItem((cb as { engine?: { package: string; version: string } }).engine, JARS));
  return out;
}

function htmtItem(names: string[], htmt: (number | null)[][], cut: number, sources: string[]): CheckItem {
  const pairs: string[] = [];
  let max = 0;
  htmt.forEach((row, i) => row.forEach((v, j) => { if (v !== null && Number.isFinite(v) && i !== j) { max = Math.max(max, v); if (v >= cut) pairs.push(`${names[i]}–${names[j]} (${f2(v)})`); } }));
  return { id: 'htmt', section: 'Measurement model', label: `Discriminant validity: HTMT below ${cut === 0.85 ? '.85 (.90 for conceptually similar constructs)' : cut}`, sources,
    status: pairs.length ? 'issue' : 'done', evidence: pairs.length ? `At or above .85: ${join(pairs)}.` : `Largest HTMT ${f2(max)}.`, link: { kind: 'tab', label: 'Discriminant validity' } };
}

// ---------------------------------------------------------------- PLS-SEM

function plsChecks(input: ReportInput, issues: Issue[] | undefined): CheckItem[] {
  const pls = input.pls!;
  const H = ['hair2019'];
  const out: CheckItem[] = [specItem(issues, H)];
  out.push({ id: 'convergence', section: 'Estimation', label: 'The PLS algorithm converged', sources: H, status: pls.converged ? 'done' : 'issue',
    evidence: pls.converged ? `Converged after ${pls.iterations} iterations (at most ${input.settings.maxIter}).` : `Did not converge within ${pls.iterations} iterations.`, link: tab('Overview') });
  const m = input.model;
  const block = (j: number) => pls.indicators.map((x, i) => ({ ...x, i })).filter((x) => x.construct === j);
  const at = (name: string) => pls.constructs.indexOf(name);
  const modeA = m.constructs.filter((k) => !k.components?.length && k.indicators.length > 1 && (k.type === 'factor' || k.mode === 'A')).map((k) => at(k.name)).filter((j) => j >= 0);
  const modeB = m.constructs.filter((k) => !k.components?.length && k.indicators.length > 1 && k.mode === 'B').map((k) => at(k.name)).filter((j) => j >= 0);
  if (modeA.length) {
    const q = (j: number) => pls.quality[j];
    const low = modeA.flatMap((j) => block(j).filter((x) => pls.loadings[x.i] < 0.708).map((x) => ({ text: `${x.name} (${f3(pls.loadings[x.i])})`, ok: pls.loadings[x.i] >= 0.4 && q(j).ave >= 0.5 && q(j).rhoC >= 0.7 })));
    out.push({ id: 'indicatorreliability', section: 'Measurement model', label: 'Indicator reliability: loadings of at least .708', sources: H,
      status: low.some((x) => !x.ok) ? 'issue' : 'done',
      evidence: !low.length ? 'Every Mode A loading is at least .708.' : `Below .708: ${join(low.map((x) => x.text))}.${low.every((x) => x.ok) ? ' Kept: each is above .40 and its construct meets the reliability and AVE thresholds.' : ' Consider removing indicators below .40, or below .708 where that raises ρC or AVE above the threshold.'}`, link: tab('Loadings & weights') });
    const rel = modeA.map((j) => ({ name: pls.constructs[j], ...q(j) }));
    const badRel = rel.filter((r) => r.rhoC < 0.7 || r.rhoA < 0.7 || r.rhoC > 0.95);
    out.push({ id: 'reliability', section: 'Measurement model', label: 'Internal consistency: ρA and ρC between .70 and .95', sources: ['dijkstra2015', ...H], status: badRel.length ? 'issue' : 'done',
      evidence: `${join(rel.map((r) => `${r.name}: ρA ${f2(r.rhoA)}, ρC ${f2(r.rhoC)}`))}.${badRel.length ? ` Outside .70–.95: ${join(badRel.map((r) => r.name))}${badRel.some((r) => r.rhoC > 0.95) ? ' (above .95: redundant items)' : ''}.` : ''}`, link: tab('Reliability') });
    const badAve = rel.filter((r) => r.ave < 0.5);
    out.push({ id: 'ave', section: 'Measurement model', label: 'Convergent validity: AVE of at least .50', sources: ['fornell1981', ...H], status: badAve.length ? 'issue' : 'done',
      evidence: `${join(rel.map((r) => `${r.name}: ${f2(r.ave)}`))}.${badAve.length ? ` Below .50: ${join(badAve.map((r) => r.name))}.` : ''}`, link: tab('Reliability') });
    out.push(htmtItem(pls.constructs, pls.htmt, 0.85, ['henseler2015', ...H]));
  }
  if (modeB.length) {
    const vifs = modeB.flatMap((j) => block(j).map((x) => ({ name: x.name, v: pls.vifOuter[x.i] })));
    const high = vifs.filter((x) => x.v >= 5), mid = vifs.filter((x) => x.v >= 3 && x.v < 5);
    out.push({ id: 'outervif', section: 'Measurement model', label: 'Formative indicators: collinearity (VIF below 3; 5 or above is critical)', sources: H, status: high.length ? 'issue' : 'done',
      evidence: `Largest VIF ${f2(Math.max(...vifs.map((x) => x.v)))}.${high.length ? ` At least 5: ${join(high.map((x) => `${x.name} (${f2(x.v)})`))}.` : ''}${mid.length ? ` Between 3 and 5: ${join(mid.map((x) => `${x.name} (${f2(x.v)})`))}.` : ''}`, link: tab('Loadings & weights') });
    const weights = input.boot?.stats.some((s) => s.group === 'weight');
    out.push({ id: 'weights', section: 'Measurement model', label: 'Formative indicators: significance and relevance of the outer weights', sources: H, status: weights ? 'done' : 'issue',
      evidence: weights ? 'Bootstrap intervals of the outer weights are in the results; non-significant weights with loadings of at least .50 can be kept.' : 'Bootstrap the model to test the outer weights.', link: tab('Bootstrapping') });
  }
  if (m.paths.length) {
    const inner = pls.vifInner.flatMap((row, i) => row.flatMap((v, j) => (v === null ? [] : [{ path: `${pls.constructs[i]} → ${pls.constructs[j]}`, v }])));
    const maxV = Math.max(0, ...inner.map((x) => x.v));
    out.push({ id: 'innervif', section: 'Structural model', label: 'Collinearity among predictors: inner VIF below 3', sources: H, status: maxV >= 5 ? 'issue' : 'done',
      evidence: `Largest inner VIF ${f2(maxV)}${maxV >= 3 ? ` (${join(inner.filter((x) => x.v >= 3).map((x) => x.path))})` : ''}.`, link: tab('Path coefficients') });
    out.push({ id: 'r2', section: 'Structural model', label: 'R² of the endogenous constructs reported', sources: H, status: 'done',
      evidence: pls.constructs.flatMap((n, j) => (pls.rSquared[j] !== null ? [`${n}: ${f2(pls.rSquared[j]!)}`] : [])).join(', ') + ' (.25 / .50 / .75 weak / moderate / substantial).', link: tab('Overview') });
    out.push({ id: 'f2', section: 'Structural model', label: 'Effect sizes f² reported', sources: ['cohen1988', ...H], status: pls.fSquare.some((r) => r.some((v) => v !== null)) ? 'done' : 'issue',
      evidence: pls.fSquare.some((r) => r.some((v) => v !== null)) ? 'f² of every path is in the results (.02 / .15 / .35 small / medium / large).' : 'No f² in the results.', link: tab('Path coefficients') });
    out.push(bootItem(input, true, 'Path coefficients tested with bootstrap confidence intervals', H));
    out.push(ran(input, 'plspredict')
      ? { id: 'predict', section: 'Structural model', label: 'Predictive power: PLSpredict (Q²predict, RMSE/MAE against the LM benchmark)', status: 'done', evidence: 'A PLSpredict card has run.', sources: ['shmueli2019', ...H], link: card('plspredict', 'Add PLSpredict') }
      : { id: 'predict', section: 'Structural model', label: 'Predictive power: PLSpredict (Q²predict, RMSE/MAE against the LM benchmark)', status: 'issue', evidence: `${ran(input, 'blindfold') ? 'Only blindfolding Q² has run, which mixes in-sample explanation and prediction. ' : ''}Not assessed yet.`, sources: ['shmueli2019', ...H], link: card('plspredict', 'Add PLSpredict') });
  }
  const srmr = pls.fit.estimated.srmr;
  out.push({ id: 'srmr', section: 'Model fit', label: 'Approximate fit (SRMR below .08), reported with caution', sources: ['henseler2014', ...H], status: Number.isFinite(srmr) ? (srmr < 0.08 ? 'done' : 'issue') : 'na',
    evidence: Number.isFinite(srmr) ? `SRMR of the estimated model ${f3(srmr)}. Hair et al. (2019) advise against relying on fit measures in PLS-SEM.` : 'No SRMR in the results.', link: tab('Model fit') });
  out.push(ran(input, 'mga') ? { id: 'micom', section: 'Groups', label: 'Measurement invariance (MICOM) before comparing groups', status: 'done', evidence: 'A MICOM and multigroup card has run.', sources: ['henseler2016'], link: card('mga', 'Add MICOM and multigroup analysis') }
    : { id: 'micom', section: 'Groups', label: 'Measurement invariance (MICOM) before comparing groups', status: 'na', evidence: 'No group comparison in the log.', sources: ['henseler2016'], link: card('mga', 'Add MICOM and multigroup analysis') });
  out.push({ id: 'samplesize', section: 'Data', label: 'Sample size justified (minimum sample size)', sources: H, status: ran(input, 'minsample') ? 'done' : 'author',
    evidence: `N = ${pls.n}.${ran(input, 'minsample') ? ' The minimum sample size card has run.' : ' Justify it, e.g. by the inverse square root method.'}`, link: card('minsample', 'Add Minimum sample size') });
  out.push(missingItem(input, pls.droppedRows, H));
  out.push(cmbItem(input, H));
  out.push(softwareItem((pls as { engine?: { package: string; version: string } }).engine, ['appelbaum2018']));
  return out;
}

// ---------------------------------------------------------------- conditional process analysis

function processChecks(input: ReportInput, issues: Issue[] | undefined): CheckItem[] {
  const r = input.process!;
  const HY = ['hayes2022'], JARS = ['appelbaum2018'];
  const out: CheckItem[] = [specItem(issues, HY)];
  const latent = r.latent.length > 0;
  out.push(latent ? { id: 'hc', section: 'Estimation', label: 'Heteroskedasticity-consistent standard errors (HC3 or HC4)', status: 'na', evidence: 'Latent-variable model (lavaan::sam): no OLS standard errors.', sources: ['hayes2007'] }
    : { id: 'hc', section: 'Estimation', label: 'Heteroskedasticity-consistent standard errors (HC3 or HC4)', sources: ['hayes2007', 'long2000'], status: r.hc === 'none' ? 'author' : 'done',
      evidence: r.hc === 'none' ? 'OLS standard errors assume homoskedasticity: check the residuals, or choose HC3 / HC4 in the settings.' : `${r.hc} standard errors.`, link: { kind: 'model', label: 'Model tab (settings)' } });
  out.push({ id: 'assumptions', section: 'Data', label: 'Regression assumptions and influential cases checked', sources: HY, status: ran(input, 'screen') ? 'done' : 'author',
    evidence: ran(input, 'screen') ? 'The data screening card has run.' : 'Report checks of linearity, the residuals’ distribution and influential cases.', link: card('screen', 'Add Data screening') });
  const indirect = r.indirect.length > 0;
  out.push(!indirect ? { id: 'bootstrap', section: 'Estimation', label: 'Indirect effects tested with bootstrap confidence intervals (at least 5,000 resamples)', status: 'na', evidence: 'No indirect effect in the model.', sources: HY }
    : { id: 'bootstrap', section: 'Estimation', label: 'Indirect effects tested with bootstrap confidence intervals (at least 5,000 resamples)', sources: r.inference === 'montecarlo' ? ['preacher2012', ...HY] : HY,
      status: r.boot.samples >= 5000 ? 'done' : 'issue',
      evidence: `${r.boot.samples.toLocaleString('en-US')} ${r.inference === 'montecarlo' ? 'Monte Carlo draws' : 'bootstrap resamples'}${r.boot.samples < 5000 ? ': increase to at least 5,000 for stable interval limits' : ''}.`, link: tab('Direct & indirect effects') });
  const moderated = r.moderators.length > 0;
  out.push(!moderated ? { id: 'probing', section: 'Structural model', label: 'Interactions probed (conditional effects, Johnson–Neyman)', status: 'na', evidence: 'No moderator.', sources: HY }
    : { id: 'probing', section: 'Structural model', label: 'Interactions probed (conditional effects, Johnson–Neyman)', status: 'done', sources: HY,
      evidence: `Conditional effects at ${r.moderators.map((x) => `${x.name} = ${x.values.map((v) => f2(v)).join(' / ')}`).join('; ')}${r.jn.length ? '; Johnson–Neyman regions in the results' : ''}.`, link: tab(r.jn.length ? 'Johnson–Neyman' : 'Direct & indirect effects') });
  out.push(!(moderated && indirect) ? { id: 'index', section: 'Structural model', label: 'Index of moderated mediation reported', status: 'na', evidence: 'Not a moderated mediation model.', sources: HY }
    : { id: 'index', section: 'Structural model', label: 'Index of moderated mediation reported', status: r.indices.length ? 'done' : 'issue', sources: HY,
      evidence: r.indices.length ? `${r.indices.length} ${r.indices.length === 1 ? 'index' : 'indices'} with ${r.inference === 'montecarlo' ? 'Monte Carlo' : 'bootstrap'} intervals.` : 'The model has no linear index for this moderation: compare conditional indirect effects instead.', link: tab('Direct & indirect effects') });
  const scales = input.model.constructs.filter((k) => k.indicators.length > 1 && !k.latent);
  out.push(!scales.length ? { id: 'scales', section: 'Measurement model', label: 'Reliability of the multi-item scales reported', status: 'na', evidence: latent ? 'The scales are latent variables.' : 'Single-item measures.', sources: JARS }
    : { id: 'scales', section: 'Measurement model', label: 'Reliability of the multi-item scales reported', sources: JARS, status: ran(input, 'reliability') ? 'done' : 'issue',
      evidence: `${scales.map((k) => k.name).join(', ')} ${scales.length === 1 ? 'is a mean score' : 'are mean scores'}, which ignores measurement error${ran(input, 'reliability') ? '; a reliability card has run' : ': report α or ω'}.`, link: card('reliability', 'Add Reliability and agreement') });
  out.push({ id: 'effects', section: 'Structural model', label: 'Direct, indirect and total effects reported with intervals', sources: HY, status: 'done',
    evidence: `${r.direct ? 'Direct' : ''}${indirect ? `${r.direct ? ', ' : ''}${r.indirect.length} indirect` : ''}${r.total ? ' and total' : ''} effects in the results.`, link: tab('Direct & indirect effects') });
  out.push({ id: 'causal', section: 'Specification', label: 'Causal ordering and design justified', sources: ['hayes2022', 'appelbaum2018'], status: 'author', evidence: 'The results cannot show it: justify the order of X, M and Y (design, timing) and discuss confounders.' });
  out.push(missingItem(input, 0, JARS));
  out.push(softwareItem(r.engine, JARS));
  return out;
}

/** Why there is no checklist yet; null when the results for the method are there. */
export function checklistBlocked(input: ReportInput): string | null {
  const s = input.settings;
  if (s.method === 'cbsem' && s.estimator === '2SLS') return 'The checklist covers PLS-SEM, CB-SEM estimated by lavaan or the built-in engine, and conditional process analysis; not MIIV-2SLS.';
  const have = s.method === 'pls' ? input.pls : s.method === 'process' ? input.process : input.cb;
  return have ? null : 'Calculate the model first (Model tab): the checklist reads its results.';
}

/** The reviewer checklist for the model with its results; `issues`: the model check (validateModel). */
export function reviewerChecklist(input: ReportInput, issues?: Issue[]): CheckItem[] {
  const why = checklistBlocked(input);
  if (why) throw new Error(why);
  const s = input.settings;
  return s.method === 'pls' ? plsChecks(input, issues) : s.method === 'process' ? processChecks(input, issues) : cbChecks(input, issues);
}

export const statusCounts = (items: CheckItem[]) => ({ done: items.filter((i) => i.status === 'done').length, issue: items.filter((i) => i.status === 'issue').length, author: items.filter((i) => i.status === 'author').length, na: items.filter((i) => i.status === 'na').length });
