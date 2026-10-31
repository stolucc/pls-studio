// Model runs: every Calculate logs the model it estimated as a card on the
// Analyses tab, with the model itself, the settings, the data's identity and
// the results. Calculating an unchanged model again updates its card (a
// bootstrap joins the run); any change to the model, the estimation settings
// or the data starts a new version, whose card lists what changed. A run
// card can open its model on the Model tab again (through the undo stack).

import { engineOf } from '../components/EngineBadge';
import { choiceDialog } from '../components/Overlays';
import { renderFigureSvg } from '../figure/render';
import { figureSource } from '../figure/source';
import { DEFAULT_SETTINGS, parseModelState, parseSettings, type ModelState, type Settings } from '../model/project';
import { processGraph } from '../process/fromModel';
import { emptyModel, resultsKey, useStore } from '../store';
import { isObj, name } from './common';
import { describeChanges, ESTIMATION_KEYS, INFERENCE_KEYS, runData, runHash, settingChanges, type RunData } from './runHash';
import { SnapshotView, type SnapshotResult } from './snapshot';
import { addAnalysis, addFrozenCard, updateFrozenCard, useAnalyses } from './store';
import type { AnalysisCard, AnalysisType, Card } from './types';

export interface RunOptions {
  label: string;
  version: number;
  /** runHash of model, estimation settings and data: the version's identity. */
  hash: string;
  model: ModelState;
  settings: Settings;
  data: RunData;
  /** The version this one was edited from, when not the one before it (opened from the log). */
  from?: number;
  /** What changed from the previous version, in words. */
  changes: string[];
}
export type RunCard = AnalysisCard & { options: RunOptions };
export const METHOD_LABEL: Record<Settings['method'], string> = { pls: 'PLS-SEM', cbsem: 'CB-SEM', process: 'Conditional process analysis' };

export const runCards = (cards: Card[]): RunCard[] => cards.filter((c): c is RunCard => c.kind === 'analysis' && c.type === 'run');
const latestRun = (runs: RunCard[]) => runs.reduce<RunCard | null>((a, c) => (!a || c.options.version > a.options.version ? c : a), null);

/** The version id of the model on the Model tab as it is now. */
export function currentRunHash(): string {
  const s = useStore.getState();
  return runHash(s.model, s.settings, s.data);
}

/** The version last opened from the log: the next new version notes it came from there. */
let openedFrom: number | null = null;

/**
 * Log the results on screen (if they are current) as a model run: a new
 * version, or the existing card of this version with the results it now has
 * (an added bootstrap, a fit test).
 */
export async function logCurrentRun(): Promise<string | null> {
  const s = useStore.getState();
  if (s.cloud?.role === 'viewer') return null;
  const r = s.results;
  if (!r || r.key !== resultsKey(s)) return null;
  const method = s.settings.method;
  const twoSls = method === 'cbsem' && s.settings.estimator === '2SLS';
  if (!(method === 'process' ? r.process : method === 'cbsem' ? (twoSls ? r.miiv : r.cb) : r.pls)) return null;
  const hash = runHash(s.model, s.settings, s.data);
  const data = runData(s.data, s.dataInfo);
  let diagram: string | null;
  try { const src = figureSource(); diagram = src ? renderFigureSvg(src(), s.settings.figure).svg : null; } catch { diagram = null; }
  const recognised = method === 'process' ? processGraph(s.model).recognised : null;
  const engine = engineOf(r, method, twoSls);
  const result: SnapshotResult = {
    method: twoSls ? 'miiv' : method, description: `${engine ?? METHOD_LABEL[method]}${data.rows ? `, ${data.rows.toLocaleString()} observations` : ''} · ${new Date().toLocaleString()}`, diagram,
    pls: r.pls, cb: r.cb, miiv: r.miiv, process: r.process ?? null, boot: r.boot, fitTest: r.fitTest,
    processTitle: recognised ? `PROCESS model ${recognised.model}` : 'Custom conditional process model', level: s.settings.confidence,
  };
  const runs = runCards(useAnalyses.getState().cards);
  const existing = runs.find((c) => c.options.hash === hash);
  if (existing) { await updateFrozenCard(existing.id, result); return existing.id; }
  const latest = latestRun(runs);
  const version = (latest?.options.version ?? 0) + 1;
  const base = (openedFrom !== null ? runs.find((c) => c.options.version === openedFrom) : null) ?? latest;
  const changes = describeChanges(base ? base.options : null, { model: s.model, settings: s.settings, data });
  openedFrom = null;
  const options: RunOptions = { label: `Model v${version}`, version, hash, model: structuredClone(s.model), settings: structuredClone(s.settings), data, ...(base && base !== latest ? { from: base.options.version } : {}), changes };
  return addFrozenCard('run', options, result);
}

export type Divergence = 'keep' | 'discard';
const askDivergence = () => choiceDialog({
  title: 'Keep the model on the Model tab?',
  body: 'It has changes that were not calculated, so it is not in the log yet. Keep it as a card (not run), or discard those changes.',
  choices: [{ id: 'discard', label: 'Discard', danger: true }, { id: 'keep', label: 'Keep as a card', primary: true }],
}) as Promise<Divergence | null>;

/**
 * Open a logged version on the Model tab: its model (through the undo stack:
 * ⌘Z returns) and its estimation and inference settings; the diagram and
 * chart styles stay. An edited-but-uncalculated working model is kept as a
 * card or discarded, as the person chooses.
 */
export async function openRun(id: string, ask: () => Promise<Divergence | null> = askDivergence): Promise<boolean> {
  const s = useStore.getState();
  const runs = runCards(useAnalyses.getState().cards);
  const card = runs.find((c) => c.id === id);
  if (!card || s.cloud?.role === 'viewer') return false;
  const o = card.options;
  const here = runHash(s.model, s.settings, s.data);
  if (here === o.hash) { s.setWorkspace('model'); s.toast('info', `${o.label} is the model on the Model tab.`); return true; }
  if (s.model.constructs.length && !runs.some((c) => c.options.hash === here)) {
    const choice = await ask();
    if (!choice) return false;
    if (choice === 'keep') {
      const latest = latestRun(runCards(useAnalyses.getState().cards));
      const version = (latest?.options.version ?? 0) + 1;
      const data = runData(s.data, s.dataInfo);
      addAnalysis('run', { label: `Model v${version} (not run)`, version, hash: here, model: structuredClone(s.model), settings: structuredClone(s.settings), data, changes: describeChanges(latest ? latest.options : null, { model: s.model, settings: s.settings, data }) } satisfies RunOptions);
    }
  }
  const changed = settingChanges(s.settings, o.settings);
  s.commit(() => structuredClone(o.model));
  s.setSettings(Object.fromEntries([...ESTIMATION_KEYS, ...INFERENCE_KEYS].map((k) => [k, o.settings[k]])) as Partial<Settings>);
  openedFrom = o.version;
  useAnalyses.setState({ selected: id });
  s.setWorkspace('model');
  const now = runData(s.data, s.dataInfo);
  const notes = [changed.length ? `Settings: ${changed.join('; ')}.` : '', now.fingerprint !== o.data.fingerprint ? `It was calculated on ${o.data.name || 'other data'}${o.data.rows ? ` (${o.data.rows.toLocaleString()} rows)` : ''}, not the data open now.` : ''].filter(Boolean);
  s.toast(notes.length ? 'info' : 'success', `${o.label} opened on the Model tab (undo returns). ${notes.join(' ')}`.trim());
  return true;
}

const FIELDS = ['fingerprint', 'name', 'rows'] as const;
function parseRunData(raw: unknown): RunData | null {
  if (!isObj(raw) || FIELDS.some((k) => !(k in raw))) return null;
  const rows = Number(raw.rows);
  return typeof raw.fingerprint === 'string' && typeof raw.name === 'string' && Number.isFinite(rows) && rows >= 0 ? { fingerprint: raw.fingerprint.slice(0, 64), name: raw.name.slice(0, 300), rows: Math.floor(rows) } : null;
}

export const runAnalysis: AnalysisType<RunOptions, SnapshotResult> = {
  id: 'run', title: 'Model run', sub: 'a calculated version of the model: its results, settings and diagram (Calculate adds one)', group: 'Model runs',
  frozen: true,
  cardTitle: (o) => o.label || `Model v${o.version}`,
  display: ['label'],
  defaults: () => ({ label: 'Model', version: 0, hash: '', model: emptyModel(), settings: DEFAULT_SETTINGS, data: { fingerprint: 'none', name: '', rows: 0 }, changes: [] }),
  parseOptions: (raw) => {
    if (!isObj(raw)) return null;
    try {
      const model = parseModelState(raw.model);
      const settings = parseSettings(raw.settings);
      const data = parseRunData(raw.data);
      const version = Number(raw.version);
      if (!data || typeof raw.hash !== 'string' || !Number.isInteger(version) || version < 0 || version > 100_000) return null;
      const from = Number(raw.from);
      return {
        label: name(raw.label, 120) || `Model v${version}`, version, hash: raw.hash.slice(0, 64), model, settings, data,
        ...(Number.isInteger(from) && from > 0 ? { from } : {}),
        changes: Array.isArray(raw.changes) ? raw.changes.slice(0, 200).map((c) => name(c, 500)).filter(Boolean) : [],
      };
    } catch { return null; }
  },
  Options: ({ options: o, set, disabled }) => (
    <fieldset className="card-options" disabled={disabled}>
      <p className="hint" style={{ marginTop: 0 }}>Version {o.version}{o.from ? `, edited from v${o.from}` : ''}: {METHOD_LABEL[o.settings.method]} with {o.settings.engine === 'r' ? (o.settings.method === 'pls' ? o.settings.plsPackage : o.settings.method === 'cbsem' ? (o.settings.estimator === '2SLS' ? 'MIIVsem' : 'lavaan') : 'manymome') : 'the built-in engine'}
        {o.settings.method === 'cbsem' ? `, ${o.settings.estimator}` : o.settings.method === 'pls' ? `, ${o.settings.consistent ? 'PLSc' : 'PLS'}, ${o.settings.scheme} scheme` : ''}, missing values: {o.settings.missing}. Data: {o.data.name || 'none'}{o.data.rows ? ` (${o.data.rows.toLocaleString()} rows)` : ''}.</p>
      <div className="field"><label htmlFor="run-label">Name</label>
        <input id="run-label" className="input" maxLength={120} value={o.label} onChange={(e) => set({ ...o, label: e.target.value })} /></div>
      {o.changes.length > 0 && <div className="field"><label>Changed from the previous version</label><ul className="run-changes">{o.changes.map((c, i) => <li key={i}>{c}</li>)}</ul></div>}
    </fieldset>
  ),
  View: ({ result, options: o }) => (
    <div>
      {o.changes.length > 0 && <ul className="run-changes" aria-label="Changes from the previous version">{o.changes.map((c, i) => <li key={i}>{c}</li>)}</ul>}
      <SnapshotView r={result} />
    </div>
  ),
  blocked: () => 'A model run is logged by Calculate on the Model tab; open the model there to run it again.',
  fingerprint: (o) => o.hash,
  run: async () => { throw new Error('A model run is logged by Calculate on the Model tab.'); },
  summary: (o) => `${o.model.constructs.length} constructs, ${o.model.paths.length} paths${o.model.moderations.length ? `, ${o.model.moderations.length} moderations` : ''} · ${METHOD_LABEL[o.settings.method]}`,
};
