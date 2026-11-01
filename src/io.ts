import type { RPackage } from './rengine/bridge';
import { MAX_FILE_BYTES, parseCsv } from './engine/dataset';
import { confirmDialog, numberDialog } from './components/Overlays';
import { parseCovMatrixCsv, parseNacovCsv } from './examples/matrix';
import { dataFileFormat, readDataFile, readPackageFile } from './data/readFile';
import { safeFileName, downloadText } from './format';
import { parseProject, serializeProject, toSpec, validateModel, type DataInfo, type ModelState, type Settings } from './model/project';
import { covarianceDataset } from './data/covariance';
import { datasetCsv } from './replication/package';
import type { Dataset } from './engine/types';
import { makeSample } from './sample';
import { addAnalysis, loadCards, useAnalyses } from './analyses/store';
import { parseCards, withLegacySimulation } from './analyses/persist';
import { analysisType } from './analyses/registry';
import { getRecent, migrateLegacyAutosave, recentPersistent, saveRecent, type RecentEntry } from './recent';
import type { BuiltinExample } from './examples/textbook';
import { useStore } from './store';
import type { CbEstimator } from './engine/cbsem';
import type { IpmaOptions } from './engine/ipma';
import { processInput } from './process/input';


function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/**
 * Before replacing the current project. Projects are kept in Recent projects,
 * so normally the current one is just flushed there; only when browser storage
 * is unavailable do we ask before discarding unsaved changes.
 */
async function confirmDiscard(action: string): Promise<boolean> {
  const s = useStore.getState();
  if (s.model.constructs.length === 0 && !s.data) return true;
  if (await recentPersistent()) { await autosave(); return true; }
  if (!s.dirty) return true;
  return confirmDialog({
    title: 'Discard unsaved changes?',
    body: `${action} will replace the current model, and this browser cannot keep it in Recent projects. Save it to a file first if you want to keep it.`,
    confirmLabel: 'Discard changes',
    danger: true,
  });
}

/** Start a fresh project and import a data file into it (from the home screen). */
export async function newProjectFromData() {
  const f = await pickFile(DATA_FILES);
  if (!f) return;
  if (!(await confirmDiscard('Starting a new project'))) return;
  useStore.getState().newProject();
  loadCards([]);
  await importCsv(f);
}

/** The data files the import accepts: delimited text, SPSS, Stata and Excel. */
const DATA_FILES = '.csv,.tsv,.txt,text/csv,.sav,.zsav,.dta,.xlsx,.xls';

/** SPSS, Stata and Excel files, read by R; Excel asks for the sheet when there are several. */
async function importDataFile(f: File) {
  const s = useStore.getState();
  s.toast('info', `Reading ${f.name} in R…`);
  try {
    let r = await readDataFile(f);
    if (r.sheets.length > 1) {
      const k = await numberDialog({
        title: 'Which sheet?',
        body: `${f.name} has ${r.sheets.length} sheets: ${r.sheets.map((x, i) => `${i + 1}. ${x}`).join(', ')}. The data must be one table with the variable names in the first row.`,
        confirmLabel: 'Import',
        field: { label: 'Sheet number', min: 1, max: r.sheets.length, integer: true, initial: '1' },
      });
      if (k === null) return;
      if (k > 1) r = await readDataFile(f, r.sheets[k - 1]);
    }
    s.setData(r.data, r.info);
    const missingInds = s.model.constructs.flatMap((c) => c.indicators).filter((i) => !r.data.names.includes(i));
    const skipped = r.info.excluded.length ? ` ${r.info.excluded.length} column(s) skipped (${r.info.excluded.slice(0, 3).map((x) => x.name).join(', ')}${r.info.excluded.length > 3 ? ', …' : ''}).` : '';
    s.toast(missingInds.length ? 'error' : 'success', missingInds.length
      ? `Loaded ${f.name}, but ${missingInds.length} indicator(s) in the model are not in this file.`
      : `Loaded ${r.info.rows} rows × ${r.data.names.length} variables.${skipped}`);
  } catch (err) {
    const { rMessage } = await import('./rengine/bridge');
    s.toast('error', `Could not read ${f.name}: ${rMessage(err)}`);
  }
}

export async function importCsv(file?: File | null) {
  const f = file ?? (await pickFile(DATA_FILES));
  if (!f) return;
  const s = useStore.getState();
  if (f.size > MAX_FILE_BYTES) { s.toast('error', 'File is larger than 50 MB.'); return; }
  if (dataFileFormat(f.name)) { await importDataFile(f); return; }
  try {
    const text = await f.text();
    const matrix = parseCovMatrixCsv(text);
    if (matrix) { await importMatrix(f.name, matrix); return; }
    const parsed = parseCsv(text);
    if (parsed.dataset.names.length === 0) throw new Error('No numeric columns were found.');
    s.setData(parsed.dataset, { fileName: f.name.slice(0, 200), rows: parsed.rows, missingCells: parsed.missingCells, excluded: parsed.excludedColumns });
    const missingInds = s.model.constructs.flatMap((c) => c.indicators).filter((i) => !parsed.dataset.names.includes(i));
    const excluded = parsed.excludedColumns.length ? ` ${parsed.excludedColumns.length} non-numeric column(s) skipped.` : '';
    s.toast(missingInds.length ? 'error' : 'success',
      missingInds.length
        ? `Loaded ${f.name}, but ${missingInds.length} indicator(s) in the model are not in this file.`
        : `Loaded ${parsed.rows} rows × ${parsed.dataset.names.length} variables.${excluded}`);
  } catch (err) {
    s.toast('error', `Could not read ${f.name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** A labelled square covariance matrix: ask for N and optionally a NACOV file (for MLM/MLMV). */
async function importMatrix(fileName: string, m: { names: string[]; S: number[][]; means?: number[] }) {
  const s = useStore.getState();
  const n = await numberDialog({
    title: 'Covariance matrix detected',
    body: `${fileName} is a ${m.names.length} × ${m.names.length} covariance matrix${m.means ? ' with the variables’ means' : ''}. CB-SEM can be estimated from it (ML, GLS, ULS; MLM/MLMV with a NACOV file${m.means ? '; means and intercepts too' : ''}). PLS and bootstrapping need raw data.`,
    confirmLabel: 'Use matrix',
    field: { label: 'Sample size N', min: 3, max: 1e8, integer: true },
  });
  if (n === null) return;
  let nacov: number[][] | undefined;
  if (await confirmDialog({ title: 'Add a NACOV matrix?', body: 'An asymptotic covariance matrix of the sample covariances (e.g. lavaan’s NACOV) enables robust MLM and MLMV estimation. You can skip this.', confirmLabel: 'Choose NACOV file' })) {
    const nf = await pickFile('.csv,.txt,text/csv');
    if (nf) {
      try { nacov = parseNacovCsv(await nf.text(), m.names.length); } catch (err) { s.toast('error', err instanceof Error ? err.message : String(err)); }
    }
  }
  s.setData({ names: m.names, cols: [], moments: { S: m.S, n, ...(nacov ? { nacov } : {}), ...(m.means ? { means: m.means } : {}) } },
    { fileName: fileName.slice(0, 200), rows: n, missingCells: 0, excluded: [], kind: 'matrix', hasNacov: !!nacov });
  if (s.settings.method !== 'cbsem') s.setSettings({ method: 'cbsem' });
  s.toast('success', `Loaded a ${m.names.length}-variable covariance matrix (N = ${n})${nacov ? ' with NACOV' : ''}. Switched to CB-SEM.`);
}

export async function openProject() {
  if (!(await confirmDiscard('Opening a project'))) return;
  const f = await pickFile('.json,.plsproj,application/json');
  if (!f) return;
  const s = useStore.getState();
  if (f.size > MAX_FILE_BYTES * 2) { s.toast('error', 'Project file is too large.'); return; }
  try {
    const p = parseProject(await f.text());
    s.loadProject({ name: f.name.replace(/\.(plsproj\.)?json$|\.plsproj$/i, '').slice(0, 100) || 'Untitled model', ...p });
    loadCards(withLegacySimulation(parseCards(p.analyses), p.simulation));
    void autosave();
    s.toast('success', `Opened ${f.name}.`);
  } catch (err) {
    s.toast('error', err instanceof Error ? err.message : String(err));
  }
}

export type ScriptTarget = 'model' | 'bootstrap' | 'fittest' | 'invariance' | { ipma: IpmaOptions };

/**
 * Download the self-contained R script for the current model: exactly the code
 * the R engine runs for that analysis (lavaan / MIIVsem for CB-SEM, cSEM /
 * seminr for PLS, cSEM for the fit test and IPMA), with the data embedded.
 */
export async function exportRScript(what: ScriptTarget = 'model') {
  const s = useStore.getState();
  try {
    s.toast('info', 'Preparing the R script…');
    const r = await buildRScript(what);
    downloadText(r.file, r.text, 'text/x-r-source');
    s.toast('success', `R script saved: open it in R or RStudio to reproduce the calculation with ${r.pkg}.`);
  } catch (e) {
    s.toast('error', `Could not create the R script: ${(e as Error).message}`);
  }
}

/**
 * The R script for the current model and settings, as text: exactly what the R
 * engine runs for that analysis, data embedded. Throws with a readable message.
 */
export async function buildRScript(what: ScriptTarget = 'model', opts: { data?: Dataset; model?: ModelState } = {}): Promise<{ text: string; file: string; pkg: string }> {
  const st0 = useStore.getState();
  // (a replication package without the raw data: the model's covariance matrix stands in for the dataset)
  const s = { ...st0, data: opts.data ?? st0.data, model: opts.model ?? st0.model };
  const errors = validateModel(s.model, s.data, s.settings).filter((i) => i.level === 'error');
  if (errors.length || !s.data) throw new Error(errors[0]?.message ?? 'Import a dataset first.');
  const { rMessage } = await import('./rengine/bridge');
  const name = safeFileName(s.projectName);
  try {
    if (s.settings.method === 'process') {
      const input = processInput(s.model, s.settings, s.data);
      if (!input) throw new Error('The diagram is not a conditional process model yet.');
      const { cpaScriptR } = await import('./rengine/cpa');
      return { text: await cpaScriptR(s.data, input), file: `${name}-manymome.R`, pkg: 'manymome' };
    }
    const spec = toSpec(s.model);
    const st = s.settings;
    const cb = st.method === 'cbsem';
    if (what === 'invariance') {
      const { invarianceScriptR } = await import('./rengine/lavaan');
      return { text: await invarianceScriptR(s.data, spec, st.missing, st.estimator as CbEstimator), file: `${name}-lavaan-invariance.R`, pkg: 'lavaan' };
    }
    const options = { scheme: st.scheme, maxIter: st.maxIter, tolerance: 10 ** -st.stopExp, missing: st.missing, consistent: st.consistent, approach: st.plsApproach };
    const boot = { samples: Math.max(2, Math.floor(st.bootSamples)), seed: st.seed, confidence: st.confidence };
    const pkg = what === 'fittest' || (typeof what === 'object') ? 'cSEM' : cb ? (st.estimator === '2SLS' ? 'MIIVsem' : 'lavaan') : st.plsPackage;
    const suffix = typeof what === 'object' ? 'ipma' : what === 'model' ? '' : what;
    const [{ analysisScript }, { cbScriptLavaan }, { plsScriptR }] = await Promise.all([import('./rengine/analyses'), import('./rengine/lavaan'), import('./rengine/pls')]);
    let text: string;
    if (typeof what === 'object') text = await analysisScript(s.data, spec, { kind: 'ipma', options, ipma: what.ipma });
    else if (what === 'fittest') text = await analysisScript(s.data, spec, { kind: 'fitTest', options, boot });
    else if (cb && st.estimator === '2SLS') {
      if (what === 'bootstrap') throw new Error('MIIV-2SLS has no bootstrap; its standard errors are analytic.');
      text = await analysisScript(s.data, spec, { kind: 'miiv', missing: st.missing });
    } else if (what === 'bootstrap') {
      text = await analysisScript(s.data, spec, cb
        ? { kind: 'cbBoot', estimator: st.estimator as CbEstimator, missing: st.missing, boot, interaction: st.interaction }
        : { kind: 'plsBoot', pkg: st.plsPackage, options, boot });
    } else text = cb ? await cbScriptLavaan(s.data, spec, st.missing, st.estimator as CbEstimator, st.interaction, { m: st.miImputations, seed: st.seed }) : await plsScriptR(s.data, spec, options, st.plsPackage);
    return { text, file: `${name}-${pkg}${suffix ? `-${suffix}` : ''}.R`, pkg };
  } catch (e) {
    throw new Error(rMessage(e), { cause: e });
  }
}

/**
 * The current CB-SEM model's data reduced to its covariance matrix (listwise, N − 1; one matrix per group
 * with a grouping column), with the model adjusted to it: for sharing an analysis without the raw data.
 */
export function covarianceOnly(): { data: Dataset; info: DataInfo; model: ModelState } {
  const s = useStore.getState();
  if (!s.data) throw new Error('Import a dataset first.');
  const names = [...new Set(s.model.constructs.flatMap((c) => c.indicators))];
  if (!names.length) throw new Error('The model has no indicators yet.');
  const mg = s.model.multigroup;
  const data = covarianceDataset(s.data, names, mg?.column || undefined);
  const model: ModelState = mg ? { ...s.model, multigroup: { ...mg, column: '' } } : s.model;
  const info: DataInfo = { fileName: `${(s.dataInfo?.fileName ?? 'data').replace(/\.[A-Za-z]+$/, '')}-covariances.csv`, rows: data.moments!.n, missingCells: 0, excluded: [], kind: 'matrix' };
  return { data, info, model };
}

/** Why the current analysis cannot be shared as a covariance matrix instead of the raw data (null: it can). */
export function covarianceOnlyBlocked(): string | null {
  const s = useStore.getState();
  if (!s.data) return 'Import a dataset first.';
  if (s.data.moments && s.data.cols.length === 0) return 'The dataset already is a covariance matrix.';
  if (s.settings.method !== 'cbsem') return 'A covariance matrix reproduces CB-SEM only; PLS-SEM and conditional process analysis need the raw data.';
  if (!s.model.constructs.length) return 'Draw the model first: the matrix covers its indicators.';
  try {
    const { data, model } = covarianceOnly();
    const errors = validateModel(model, data, s.settings).filter((i) => i.level === 'error');
    return errors.length ? `With the covariance matrix: ${errors[0].message}` : null;
  } catch (e) {
    return (e as Error).message;
  }
}

/** Download the model's covariance matrix (CSV; N in the file name) instead of the raw data. */
export function exportCovarianceCsv() {
  const s = useStore.getState();
  const why = covarianceOnlyBlocked();
  if (why) { s.toast('error', why); return; }
  const { data } = covarianceOnly();
  const m = data.moments!;
  downloadText(`${safeFileName(s.projectName)}-covariances-N${m.n}.csv`, datasetCsv(data), 'text/csv');
  s.toast('success', `Covariance matrix of ${data.names.length} variables saved (${m.groups ? m.groups.map((g) => `${g.label}: N = ${g.n}`).join(', ') : `N = ${m.n}`}, listwise). lavaan refits the model from it; share it with N instead of the raw data.`);
}

export function saveProject() {
  const s = useStore.getState();
  downloadText(`${safeFileName(s.projectName)}.plsproj.json`, serializeProject(s.model, s.settings, s.data, s.dataInfo, null, useAnalyses.getState().cards), 'application/json');
  s.markSaved();
}

export async function newProject() {
  if (!(await confirmDiscard('Starting a new project'))) return;
  useStore.getState().newProject();
  loadCards([]);
}

/** Reopen a project from Recent projects. */
export async function openRecent(id: string) {
  const s = useStore.getState();
  if (id === s.projectId) { s.setView('editor'); return; }
  if (!(await confirmDiscard('Opening a project'))) return;
  const entry = await getRecent(id);
  if (!entry) { s.toast('error', 'That project is no longer in Recent projects.'); return; }
  try {
    const p = parseProject(entry.text);
    s.loadProject({ name: entry.name, ...p, id: entry.id });
    loadCards(withLegacySimulation(parseCards(p.analyses), p.simulation));
  } catch (err) {
    s.toast('error', `Could not open “${entry.name}”: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export type ExampleId = 'customer' | 'emse' | 'poldem' | 'mimic' | 'wheaton' | 'thurstone' | 'kerckhoff' | 'hayduk' | 'hayduk-stacked' | 'hayduk-revised' | 'hayduk-means' | 'hayduk-stacked-means' | 'dhp'
  | 'kline-roth' | 'kline-kabc' | 'kline-sabatelli' | 'kline-worland' | 'kline-romney-somatic' | 'kline-romney-medical' | 'kline-lynam' | 'kline-robbins' | 'kline-sauve'
  | 'brown-ne' | 'brown-tau' | 'brown-mtmm' | 'brown-coping' | 'brown-reliability' | 'brown-stress' | 'bollen-curran-lcm' | 'bollen-curran-alt';

/** The built-in examples other than the synthetic survey: each a module loaded on demand, and what the toast says. */
const BUILTIN: Record<Exclude<ExampleId, 'customer'>, { make: () => Promise<(s: Settings) => BuiltinExample>; toast: string }> = {
  emse: { make: () => import('./examples/emse').then((m) => m.makeEmseExample), toast: 'Stol, Schaarschmidt & Goldblit (2022), EMSE 27:35. Covariance + NACOV matrices (N = 155), estimated with MLM as in the paper. Press Calculate.' },
  mimic: { make: () => import('./examples/mimic').then((m) => m.makeMimicExample), toast: 'MIMIC model of social participation (Jöreskog & Sörbom; Schumacker & Lomax): correlation matrix, N = 530, maximum likelihood. Press Calculate.' },
  poldem: { make: () => import('./examples/poldem').then((m) => m.makePoldemExample), toast: 'Bollen (1989): industrialisation and political democracy, N = 75, with six correlated measurement errors. Press Calculate.' },
  wheaton: { make: () => import('./examples/textbook').then((m) => m.makeWheatonExample), toast: 'Wheaton et al. (1977), stability of alienation: covariance matrix, N = 932, maximum likelihood, with two correlated errors across the waves (Bollen 1989; Jöreskog & Sörbom). Press Calculate.' },
  thurstone: { make: () => import('./examples/textbook').then((m) => m.makeThurstoneExample), toast: 'Thurstone mental tests: second-order confirmatory factor analysis of nine tests, correlation matrix, N = 213 (SAS/STAT PROC CALIS manual). Press Calculate.' },
  hayduk: { make: () => import('./examples/textbook').then((m) => m.makeHaydukExample), toast: 'Hayduk (1987), Structural Equation Modeling with LISREL, ch. 4: smoking behaviour and antismoking acts, N = 432; seven single indicators with error variances fixed from their assessed reliabilities, maximum likelihood (R engine). Press Calculate.' },
  'hayduk-stacked': { make: () => import('./examples/textbook').then((m) => m.makeHaydukStackedExample), toast: 'Hayduk (1987), ch. 9: the smoking model stacked over younger (N = 213) and older (N = 219) respondents, one covariance matrix each; coefficients equal across the groups except the heavy arrows of Figure 9.1 (R engine). Press Calculate.' },
  'hayduk-revised': { make: () => import('./examples/textbook').then((m) => m.makeHaydukRevisedExample), toast: 'Hayduk (1987), Figure 8.6: smoking and antismoking views cause each other (non-recursive), identified by dropping sex -> smoking and religion -> views; N = 432, maximum likelihood (R engine). Press Calculate.' },
  dhp: { make: () => import('./examples/textbook').then((m) => m.makeDhpExample), toast: 'Duncan, Haller & Portes (1968): peer influences on aspirations, a non-recursive model with reciprocal effects and correlated disturbances; correlation matrix, N = 329, maximum likelihood. Press Calculate.' },
  'hayduk-means': { make: () => import('./examples/textbook').then((m) => m.makeHaydukMeansExample), toast: 'Hayduk (1987), Figure 9.8: the smoking model with means and intercepts from the matrix and its means, the marker intercepts fixed at his measurement biases (R engine). Press Calculate.' },
  'hayduk-stacked-means': { make: () => import('./examples/textbook').then((m) => m.makeHaydukStackedMeansExample), toast: 'Hayduk (1987), Figures 9.9 to 9.11: the stacked smoking model with means, two indicators of smoking and of religion, means and coefficients equal across the age groups except those freed (R engine). Press Calculate.' },
  'kline-roth': { make: () => import('./examples/kline').then((m) => m.makeRothExample), toast: 'Roth et al. (1989), Kline ch. 9: a path model of exercise, hardiness, fitness, stress and illness (N = 373) with labelled paths and the indirect effects ab and cd as defined parameters. Press Calculate.' },
  'kline-kabc': { make: () => import('./examples/kline').then((m) => m.makeKabcExample), toast: 'KABC-I (Kaufman & Kaufman 1983), Kline ch. 14: two-factor CFA of eight subtests, N = 200, chi-square 38.33 on 19 df. Press Calculate.' },
  'kline-sabatelli': { make: () => import('./examples/kline').then((m) => m.makeSabatelliExample), toast: 'Sabatelli & Bartle-Haring (2003), Kline ch. 14: a two-factor model whose ML solution has a negative error variance (a Heywood case), N = 103. Press Calculate and read the warning.' },
  'kline-worland': { make: () => import('./examples/kline').then((m) => m.makeWorlandExample), toast: 'Worland et al. (1984), Kline ch. 15: a four-factor structural regression model, N = 158, chi-square 37.32 on 39 df. Press Calculate.' },
  'kline-romney-somatic': { make: () => import('./examples/kline').then((m) => (s: Settings) => m.makeRomneyExample(s, 'somatic')), toast: 'Romney et al. (1992), Kline ch. 11: the psychosomatic model of quality of life after heart surgery, N = 469 (chi-square 40.49 on 5 df); compare with the medical model. Press Calculate.' },
  'kline-romney-medical': { make: () => import('./examples/kline').then((m) => (s: Settings) => m.makeRomneyExample(s, 'medical')), toast: 'Romney et al. (1992), Kline ch. 11: the conventional medical model, N = 469 (chi-square 3.25 on 3 df), the better of two non-nested models. Press Calculate.' },
  'kline-lynam': { make: () => import('./examples/kline').then((m) => m.makeLynamExample), toast: 'Lynam et al. (1993), Kline ch. 12: achievement and delinquency in two groups with means (N = 214 and 181), coefficients equal across the groups except achievement -> delinquency (R engine). Press Calculate.' },
  'kline-robbins': { make: () => import('./examples/kline').then((m) => m.makeRobbinsExample), toast: 'Robbins (2012), Kline ch. 19: institutional quality and trust cause each other (a causal loop with correlated disturbances), 64 countries, chi-square 5.90 on 5 df. Press Calculate.' },
  'kline-sauve': { make: () => import('./examples/kline').then((m) => m.makeSauveExample), toast: 'Sauve et al., Kline ch. 15: cognitive ability predicting a single-indicator outcome with reliability .76 (error variance fixed), two correlated errors, N = 193 (R engine). Press Calculate.' },
  'brown-ne': { make: () => import('./examples/brown').then((m) => m.makeBrownNeExample), toast: 'Brown (2015), Figure 4.1: a two-factor CFA of neuroticism and extraversion, N = 250 (chi-square 13.29 on 19 df). Press Calculate.' },
  'brown-tau': { make: () => import('./examples/brown').then((m) => m.makeBrownTauExample), toast: 'Brown (2015), Table 7.2: tau-equivalent auditory indicators, the three loadings held equal, N = 200; compare with the free model (chi-square 5.66 on 10 df versus 4.88 on 8). Press Calculate.' },
  'brown-mtmm': { make: () => import('./examples/brown').then((m) => m.makeBrownMtmmExample), toast: 'Brown (2015), Table 6.3: the correlated-uniqueness MTMM model of three personality disorders by three methods, N = 500 (chi-square 14.37 on 15 df). Press Calculate.' },
  'brown-coping': { make: () => import('./examples/brown').then((m) => m.makeBrownCopingExample), toast: 'Brown (2015), Table 8.2: four coping factors under two second-order factors, N = 275 (chi-square 83.00 on 49 df). Press Calculate.' },
  'brown-reliability': { make: () => import('./examples/brown').then((m) => m.makeBrownReliabilityExample), toast: 'Brown (2015), Table 8.8: intrusions and avoidance with one error covariance, N = 500; the Reliability tab gives the omegas his MODEL CONSTRAINT computes. Press Calculate.' },
  'brown-stress': { make: () => import('./examples/brown').then((m) => m.makeBrownStressExample), toast: 'Brown (2015), Table 8.12: life stress as a formative construct caused by three stressors, identified by satisfaction and optimism as its reflective second-order indicators, N = 500 (chi-square 55.88 on 23 df). Press Calculate.' },
  'bollen-curran-lcm': { make: () => import('./examples/bollencurran').then((m) => m.makeBollenCurranLcmExample), toast: 'Bollen & Curran (2004): a latent curve model drawn as a diagram, the five waves as single-indicator constructs and intercept and slope as higher-order factors with loadings held at 1, 1, 1, 1, 1 and 0, 1, 2, 3, 4; artificial covariance matrix, N = 500. Press Calculate.' },
  'bollen-curran-alt': { make: () => import('./examples/bollencurran').then((m) => m.makeBollenCurranAltExample), toast: 'Bollen & Curran (2004): the autoregressive latent trajectory model, the first wave predetermined and each wave predicting the next on top of the curve (R engine). Press Calculate.' },
  kerckhoff: { make: () => import('./examples/textbook').then((m) => m.makeKerckhoffExample), toast: 'Kerckhoff (1974), ambition and attainment: observed-variable path analysis from the LISREL manual, correlation matrix, N = 737. Press Calculate.' },
};

export async function loadSample(which: ExampleId = 'customer') {
  if (!(await confirmDiscard('Loading the example'))) return;
  const s = useStore.getState();
  // The built-in examples open with their documented settings too (see exampleSettings).
  const { exampleSettings } = await import('./examples/packages');
  const fresh = exampleSettings(s.settings);
  if (which !== 'customer') {
    const b = BUILTIN[which];
    const ex = (await b.make())(fresh);
    s.loadProject({ name: ex.name, model: ex.model, settings: ex.settings, data: ex.data, info: ex.info, example: which });
    loadCards([]);
    s.toast('info', b.toast);
    return;
  }
  const { data, info, model } = makeSample();
  s.loadProject({ name: 'Customer experience example', model, settings: { ...fresh, method: 'pls' }, data, info, example: 'customer' });
  loadCards([]);
  s.toast('info', 'Example loaded. Press Calculate to estimate the model.');
}

/**
 * R factors arrive as their codes 1, 2, ... (in level order): which code is
 * which, columns with the same levels listed together. Empty when none.
 */
export function factorCodes(levels: Record<string, string[] | string> | unknown[] | undefined): string {
  if (!levels || Array.isArray(levels)) return '';
  const byLevels = new Map<string, string[]>();
  for (const [col, l] of Object.entries(levels)) {
    const key = (Array.isArray(l) ? l : [l]).map((x, i) => `${i + 1} = ${x}`).join(', ');
    byLevels.set(key, [...(byLevels.get(key) ?? []), col]);
  }
  return byLevels.size ? ` Coded ${[...byLevels].map(([key, cols]) => `${cols.join(', ')}: ${key}`).join('; ')}.` : '';
}

/** A dataset shipped with the app (public/), for packages that cannot run in the browser's R. */
async function bundledDataset(file: string): Promise<{ names: string[]; cols: (number | null)[][]; n: number; levels?: undefined }> {
  const res = await fetch(new URL(`${import.meta.env.BASE_URL}${file}`, window.location.href));
  if (!res.ok) throw new Error(`Could not load ${file} (${res.status}).`);
  const { parseCsv } = await import('./engine/dataset');
  const d = parseCsv(await res.text()).dataset;
  return { names: d.names, cols: d.cols.map((c) => Array.from(c, (v) => (Number.isNaN(v) ? null : v))), n: d.cols[0]?.length ?? 0 };
}

/** R factor levels as the dataset's category labels (codes 1, 2, ... in level order). */
export function categoriesOf(levels: Record<string, string[] | string> | unknown[] | undefined): { categories?: Record<string, string[]> } {
  if (!levels || Array.isArray(levels) || !Object.keys(levels).length) return {};
  return { categories: Object.fromEntries(Object.entries(levels).map(([k, l]) => [k, (Array.isArray(l) ? l : [l]).map(String)])) };
}

/**
 * Open an example from an R package's documentation: its dataset is loaded
 * from the package (in the browser's R) and the model laid out automatically.
 */
export async function loadPackageExample(id: string) {
  const [{ PACKAGE_EXAMPLES, exampleModel, exampleSettings }, { autoLayout }] = await Promise.all([import('./examples/packages'), import('./model/layout')]);
  const ex = PACKAGE_EXAMPLES.find((e) => e.id === id);
  if (!ex) return;
  if (!(await confirmDiscard('Loading the example'))) return;
  const s = useStore.getState();
  s.toast('info', `Loading ${ex.data.package}::${ex.data.name} in R…`);
  try {
    const { rCall, rMessage } = await import('./rengine/bridge');
    const pf = ex.data.packageFile;
    // An SPSS / Stata / Excel file shipped in the package: read as a user's file would be.
    const fromFile = pf ? await readPackageFile(ex.data.package, pf.path, pf.format, pf.sheet).catch((e) => { throw new Error(rMessage(e)); }) : null;
    const raw = fromFile ? { names: fromFile.data.names, cols: [] as (number | null)[][], n: fromFile.info.rows, levels: undefined }
      : ex.data.file ? await bundledDataset(ex.data.file)
      : await rCall<{ names: string[]; cols: (number | null)[][]; n: number; levels?: Record<string, string[] | string> | unknown[] }>('ps_dataset', { package: ex.data.package, name: ex.data.name, na: ex.data.na ?? [] }, ex.data.package as RPackage).catch((e) => { throw new Error(rMessage(e)); });
    const cols = fromFile ? fromFile.data.cols : raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN)));
    const missingCells = cols.reduce((n, c) => n + c.filter(Number.isNaN).length, 0);
    const model = exampleModel(ex);
    model.constructs = autoLayout(model);
    let exData = fromFile ? fromFile.data : { names: raw.names, cols, ...categoriesOf(raw.levels) };
    let exInfo = fromFile ? fromFile.info : { fileName: `${ex.data.package}::${ex.data.name}`, rows: raw.n, missingCells, excluded: [] };
    // The help page's recodes: computed columns, then category labels for coded columns.
    if (ex.computed?.length) {
      const { computeColumn } = await import('./data/compute');
      for (const k of ex.computed) ({ data: exData, info: exInfo } = computeColumn(exData, exInfo, k.name, k.expr));
    }
    if (ex.labels) exData = { ...exData, categories: { ...(exData.categories ?? {}), ...ex.labels } };
    s.loadProject({
      name: ex.title, model, settings: exampleSettings(useStore.getState().settings, ex.settings),
      data: exData, info: exInfo,
      example: ex.id,
    });
    loadCards([]);
    const coded = factorCodes(raw.levels);
    if (ex.panel) {
      const p = ex.panel;
      if (analysisType(p.kind)) {
        // Analyses that live as cards: the example adds its card, set up.
        const { kind, ...preset } = p;
        addAnalysis(kind, preset);
        useStore.getState().setWorkspace('analyses');
      }
      useStore.getState().toast('success', `${ex.title} (${ex.source}).${coded} ${analysisType(p.kind) ? 'Press Run on the card.' : 'Press Estimate.'}`);
      return;
    }
    if (ex.assessment) {
      const { assessmentCard } = await import('./analyses/plsAssessment');
      addAnalysis(...assessmentCard(ex.assessment));
      useStore.getState().setWorkspace('analyses');
      useStore.getState().toast('success', `${ex.title} (${ex.source}).${coded} Press Run on the card.`);
      return;
    }
    if (ex.screening) {
      if (ex.screening.tab === 'influence') addAnalysis('influence');
      else addAnalysis('screen', { vars: [...new Set(ex.constructs.flatMap((k) => k.indicators ?? []))] });
      useStore.getState().setWorkspace('analyses');
      useStore.getState().toast('success', `${ex.title} (${ex.source}).${coded} Press Run on the card.`);
      return;
    }
    if (ex.segmentation) {
      const seg = ex.segmentation;
      // PATHMOX: segmentation variables with their category names; ordered ones in the example's order.
      const cats = categoriesOf(raw.levels).categories ?? {};
      const segments = (seg.segments ?? []).map((s) => ({ column: s.column, labels: cats[s.column] ?? [], ordered: !!s.order,
        ...(s.order ? { order: s.order.map((l) => (cats[s.column] ?? []).indexOf(l) + 1) } : {}) }));
      const { segmentationCard } = await import('./analyses/segmentation');
      addAnalysis(...segmentationCard(seg, segments));
      useStore.getState().setWorkspace('analyses');
      useStore.getState().toast('success', `${ex.title} (${ex.source}).${coded} Press Run on the card.`);
      return;
    }
    useStore.getState().toast('success', `${ex.title} (${ex.source}).${coded} Press Calculate.`);
  } catch (e) {
    useStore.getState().toast('error', `Could not load the example: ${(e as Error).message}`);
  }
}

// ---------- autosave into Recent projects (per-browser convenience) ----------

function dataLabel(s: ReturnType<typeof useStore.getState>): string {
  if (!s.data || !s.dataInfo) return 'no data';
  return s.dataInfo.kind === 'matrix' ? `covariance matrix · N = ${s.dataInfo.rows}` : `${s.dataInfo.fileName} · ${s.dataInfo.rows} rows`;
}

/** Recent-projects entry for the current project, or null for an empty one. */
export function currentEntry(): RecentEntry | null {
  const s = useStore.getState();
  // Shared projects live on the server; keeping a local copy would store their
  // (server-side encrypted) data unencrypted in the browser.
  if (s.cloud || s.projectId.startsWith('cloud:')) return null;
  // Examples are not kept: reopening one gives the original ("Keep as my project" makes a copy).
  if (s.example) return null;
  if (s.model.constructs.length === 0 && !s.data) return null;
  return {
    id: s.projectId, name: s.projectName, method: s.settings.method, updated: Date.now(),
    constructs: s.model.constructs.length, dataLabel: dataLabel(s),
    text: serializeProject(s.model, s.settings, s.data, s.dataInfo, null, useAnalyses.getState().cards),
  };
}

export async function autosave() {
  const e = currentEntry();
  if (e) await saveRecent(e);
  // Signed in: the project belongs in the account (cloud/keep.ts decides whether this one does, now).
  void import('./cloud/keep').then((m) => m.keepInAccount());
}

/** Move a pre-home-screen localStorage autosave into Recent projects. */
export function migrateAutosave() {
  return migrateLegacyAutosave((name, text) => {
    try {
      const p = parseProject(text);
      if (p.model.constructs.length === 0 && !p.data) return null;
      return { id: `proj-legacy-${Date.now().toString(36)}`, name: name.slice(0, 100), method: p.settings.method, updated: Date.now(), constructs: p.model.constructs.length, dataLabel: p.info ? p.info.fileName : 'no data', text };
    } catch {
      return null;
    }
  });
}

/** Replace the diagram with one from lavaan syntax, or Mplus MODEL syntax (converted by lavaan in R). */
export async function importModelSyntax() {
  const { formDialog, confirmDialog } = await import('./components/Overlays');
  const { looksLikeMplus, parseLavaanSyntax } = await import('./model/syntax');
  const values = await formDialog({
    title: 'Import model syntax',
    body: 'Paste lavaan syntax (=~ factors, ~ regressions, ~~ covariances, ~ 1 means, := defined parameters) or Mplus MODEL syntax (BY, ON, WITH). The diagram is built from it; what it cannot hold is listed.',
    confirmLabel: 'Build the diagram',
    fields: [{ label: 'Syntax', multiline: true, placeholder: 'visual =~ x1 + x2 + x3\ntextual =~ x4 + x5 + x6\ntextual ~ visual', check: (t) => (t.trim() ? null : 'Paste the model syntax.') }],
  });
  if (!values) return;
  const s = useStore.getState();
  try {
    let text = values[0];
    if (looksLikeMplus(text)) {
      const { rCall } = await import('./rengine/bridge');
      text = (await rCall<{ syntax: string }>('ps_mplus_syntax', { syntax: text }, 'lavaan')).syntax;
    }
    const { model, warnings } = parseLavaanSyntax(text);
    if (s.model.constructs.length && !(await confirmDialog({ title: 'Replace the diagram?', body: 'The current diagram is replaced by the imported model (undo brings it back). The data and the analyses stay.', confirmLabel: 'Replace' }))) return;
    useStore.getState().commit(() => model);
    if (useStore.getState().settings.method === 'process') useStore.getState().setSettings({ method: 'cbsem' });
    const missing = s.data ? [...new Set(model.constructs.flatMap((c) => c.indicators))].filter((i) => !s.data!.names.includes(i)) : [];
    useStore.getState().toast(warnings.length || missing.length ? 'info' : 'success',
      `${model.constructs.length} constructs and ${model.paths.length} paths imported.${missing.length ? ` Not in the data: ${missing.join(', ')}.` : ''}${warnings.length ? ` ${warnings.join(' ')}` : ''}`);
  } catch (e) {
    useStore.getState().toast('error', `Could not import the syntax: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** The model as an Mplus input file (with the data as a .dat file). */
export async function exportMplus() {
  const s = useStore.getState();
  if (!s.model.constructs.length) { s.toast('error', 'Draw a model first.'); return; }
  const { toMplus } = await import('./model/syntax');
  const { downloadText, safeFileName } = await import('./format');
  const { inp, dat, warnings } = toMplus(s.model, s.settings, s.data, s.dataInfo, s.projectName);
  const stem = safeFileName(s.projectName);
  downloadText(`${stem}.inp`, inp, 'text/plain');
  if (dat) downloadText(`${stem.replace(/[^A-Za-z0-9_-]+/g, '_')}.dat`, dat, 'text/plain');
  else if (s.dataInfo?.kind === 'matrix') s.toast('info', 'Covariance-matrix data: save the matrix as the .dat file Mplus expects (TYPE = COVARIANCE, lower triangle).');
  s.toast(warnings.length ? 'info' : 'success', `Mplus input written${dat ? ' with the data' : ''}.${warnings.length ? ` ${warnings.join(' ')}` : ''}`);
}
