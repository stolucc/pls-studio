import type { RPackage } from './rengine/bridge';
import { MAX_FILE_BYTES, parseCsv } from './engine/dataset';
import { confirmDialog, numberDialog } from './components/Overlays';
import { parseCovMatrixCsv, parseNacovCsv } from './examples/matrix';
import { safeFileName, downloadText } from './format';
import { parseProject, serializeProject, toSpec, validateModel } from './model/project';
import { makeSample } from './sample';
import { useSim } from './simStore';
import { addAnalysis, loadCards, useAnalyses } from './analyses/store';
import { parseCards } from './analyses/persist';
import { analysisType } from './analyses/registry';
import { getRecent, migrateLegacyAutosave, recentPersistent, saveRecent, type RecentEntry } from './recent';
import { useStore } from './store';
import type { CbEstimator } from './engine/cbsem';
import type { IpmaOptions } from './engine/ipma';
import type { McDesign } from './engine/montecarlo';
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
  const f = await pickFile('.csv,.tsv,.txt,text/csv');
  if (!f) return;
  if (!(await confirmDiscard('Starting a new project'))) return;
  useStore.getState().newProject();
  useSim.getState().setDesign(null);
  loadCards([]);
  useSim.getState().setRows(null, null);
  await importCsv(f);
}

export async function importCsv(file?: File | null) {
  const f = file ?? (await pickFile('.csv,.tsv,.txt,text/csv'));
  if (!f) return;
  const s = useStore.getState();
  if (f.size > MAX_FILE_BYTES) { s.toast('error', 'File is larger than 50 MB.'); return; }
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
async function importMatrix(fileName: string, m: { names: string[]; S: number[][] }) {
  const s = useStore.getState();
  const n = await numberDialog({
    title: 'Covariance matrix detected',
    body: `${fileName} is a ${m.names.length} × ${m.names.length} covariance matrix. CB-SEM can be estimated from it (ML, GLS, ULS; MLM/MLMV with a NACOV file). PLS and bootstrapping need raw data.`,
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
  s.setData({ names: m.names, cols: [], moments: { S: m.S, n, ...(nacov ? { nacov } : {}) } },
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
    useSim.getState().setDesign(p.simulation);
    loadCards(parseCards(p.analyses));
    useSim.getState().setRows(null, null);
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
export async function buildRScript(what: ScriptTarget = 'model'): Promise<{ text: string; file: string; pkg: string }> {
  const s = useStore.getState();
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

/** The R script for a whole Monte Carlo study (lavaan::simulateData, cSEM, lavaan). */
export async function exportSimulationScript(design: McDesign) {
  const s = useStore.getState();
  try {
    s.toast('info', 'Preparing the simulation script…');
    const { mcScriptR } = await import('./rengine/mc');
    downloadText(`${safeFileName(s.projectName)}-simulation.R`, await mcScriptR(design), 'text/x-r-source');
    s.toast('success', 'Simulation script saved: open it in R or RStudio to run the study.');
  } catch (e) {
    const { rMessage } = await import('./rengine/bridge');
    s.toast('error', `Could not create the R script: ${rMessage(e)}`);
  }
}

export function saveProject() {
  const s = useStore.getState();
  downloadText(`${safeFileName(s.projectName)}.plsproj.json`, serializeProject(s.model, s.settings, s.data, s.dataInfo, useSim.getState().design, useAnalyses.getState().cards), 'application/json');
  s.markSaved();
}

export async function newProject() {
  if (!(await confirmDiscard('Starting a new project'))) return;
  useStore.getState().newProject();
  useSim.getState().setDesign(null);
  loadCards([]);
  useSim.getState().setRows(null, null);
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
    useSim.getState().setDesign(p.simulation);
    loadCards(parseCards(p.analyses));
    useSim.getState().setRows(null, null);
  } catch (err) {
    s.toast('error', `Could not open “${entry.name}”: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export type ExampleId = 'customer' | 'emse' | 'poldem';

export async function loadSample(which: ExampleId = 'customer') {
  if (!(await confirmDiscard('Loading the example'))) return;
  const s = useStore.getState();
  if (which === 'emse') {
    const { makeEmseExample } = await import('./examples/emse');
    const ex = makeEmseExample(s.settings);
    s.loadProject({ name: ex.name, model: ex.model, settings: ex.settings, data: ex.data, info: ex.info, example: 'emse' });
    useSim.getState().setDesign(null);
    loadCards([]);
    s.toast('info', 'Stol, Schaarschmidt & Goldblit (2022), EMSE 27:35. Covariance + NACOV matrices (N = 155), estimated with MLM as in the paper. Press Calculate.');
    return;
  }
  if (which === 'poldem') {
    const { makePoldemExample } = await import('./examples/poldem');
    const ex = makePoldemExample(s.settings);
    s.loadProject({ name: ex.name, model: ex.model, settings: ex.settings, data: ex.data, info: ex.info, example: 'poldem' });
    useSim.getState().setDesign(null);
    loadCards([]);
    s.toast('info', 'Bollen (1989): industrialisation and political democracy, N = 75, with six correlated measurement errors. Press Calculate.');
    return;
  }
  const { data, info, model } = makeSample();
  s.loadProject({ name: 'Customer experience example', model, settings: { ...s.settings, method: 'pls' }, data, info, example: 'customer' });
  useSim.getState().setDesign(null);
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
  const [{ PACKAGE_EXAMPLES, exampleModel }, { autoLayout }] = await Promise.all([import('./examples/packages'), import('./model/layout')]);
  const ex = PACKAGE_EXAMPLES.find((e) => e.id === id);
  if (!ex) return;
  if (!(await confirmDiscard('Loading the example'))) return;
  const s = useStore.getState();
  s.toast('info', `Loading ${ex.data.package}::${ex.data.name} in R…`);
  try {
    const { rCall, rMessage } = await import('./rengine/bridge');
    const raw = ex.data.file ? await bundledDataset(ex.data.file)
      : await rCall<{ names: string[]; cols: (number | null)[][]; n: number; levels?: Record<string, string[] | string> | unknown[] }>('ps_dataset', { package: ex.data.package, name: ex.data.name, na: ex.data.na ?? [] }, ex.data.package as RPackage).catch((e) => { throw new Error(rMessage(e)); });
    const cols = raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN)));
    const missingCells = cols.reduce((n, c) => n + c.filter(Number.isNaN).length, 0);
    const model = exampleModel(ex);
    model.constructs = autoLayout(model);
    s.loadProject({
      name: ex.title, model, settings: { ...useStore.getState().settings, ...ex.settings, engine: 'r' },
      data: { names: raw.names, cols, ...categoriesOf(raw.levels) }, info: { fileName: `${ex.data.package}::${ex.data.name}`, rows: raw.n, missingCells, excluded: [] },
      example: ex.id,
    });
    useSim.getState().setDesign(null);
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
      const { usePlsAssessment } = await import('./components/PlsAssessmentPanel');
      usePlsAssessment.setState({ open: true, tab: ex.assessment.tab, predict: null, blindfold: null, compare: null, groups: null, cta: null, cca: null, preset: { ...ex.assessment } });
      useStore.getState().toast('success', `${ex.title} (${ex.source}).${coded} Press Calculate in the panel.`);
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
      const { useSegmentation } = await import('./components/SegmentationPanel');
      const seg = ex.segmentation;
      if (seg.method === 'pathmox') {
        // Segmentation variables with their category names; ordered ones in the example's order.
        const cats = categoriesOf(raw.levels).categories ?? {};
        const { useSegExtra } = await import('./components/SegmentationMethods');
        useSegExtra.setState({ pathmox: null, segments: (seg.segments ?? []).map((s) => ({ column: s.column, labels: cats[s.column] ?? [], ordered: !!s.order,
          ...(s.order ? { order: s.order.map((l) => (cats[s.column] ?? []).indexOf(l) + 1) } : {}) })) });
        useSegmentation.setState({ open: true, method: 'pathmox', rebus: null });
      } else if (seg.method === 'fimix' || seg.method === 'pos') {
        const { useSegExtra } = await import('./components/SegmentationMethods');
        useSegExtra.setState({ fimix: null });
        useSegmentation.setState({ open: true, method: seg.method, rebus: null });
      } else useSegmentation.setState({ open: true, method: 'rebus', rebus: null, preset: { from: seg.from ?? 2, to: seg.to ?? 4 } });
      useStore.getState().toast('success', `${ex.title} (${ex.source}).${coded} Press Estimate.`);
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
    text: serializeProject(s.model, s.settings, s.data, s.dataInfo, useSim.getState().design, useAnalyses.getState().cards),
  };
}

export async function autosave() {
  const e = currentEntry();
  if (e) await saveRecent(e);
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
