// The model-run card: a calculated version of the model, with its results
// shown like a snapshot and the list of what changed. The actions that log and
// open runs are in runs.tsx (they need the stores; the registry must not).

import { DEFAULT_SETTINGS, parseModelState, parseSettings, type Settings } from '../model/project';
import { emptyModel } from '../store';
import { isObj, name } from './common';
import type { RunData, RunOptions } from './runHash';
import { SnapshotView, type SnapshotResult } from './snapshot';
import type { AnalysisType } from './types';

export const METHOD_LABEL: Record<Settings['method'], string> = { pls: 'PLS-SEM', cbsem: 'CB-SEM', process: 'Conditional process analysis' };

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
