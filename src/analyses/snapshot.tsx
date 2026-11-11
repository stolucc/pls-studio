// Model snapshots (projects from before model runs): the results of the model
// on the canvas (and its diagram), frozen as a card on the Analyses tab. A
// snapshot is never re-run and never goes stale. New ones are no longer taken:
// Calculate logs a model run (runs.tsx), which shows its results the same way.

import { useState } from 'react';
import type { FitTestResult } from '../engine/bootstrap';
import type { BootstrapResult, PlsResult } from '../engine/types';
import type { CbResult } from '../engine/cbsem';
import type { MiivResult } from '../engine/miiv';
import type { CpaResult } from '../rengine/cpa';
import { CB_TABS, CbTab, type CbTabId } from '../components/results/CbTabs';
import { MIIV_TABS, MiivTab, type MiivTabId } from '../components/results/MiivTabs';
import { PLS_TABS, PlsTab, type PlsTabId } from '../components/results/PlsTabs';
import { PROCESS_TABS, ProcessTab, type ProcessTabId } from '../components/results/ProcessTabs';
import { useReportMode } from '../report/context';
import { fingerprint } from './codec';
import { isObj, name } from './common';
import type { AnalysisType } from './types';

export interface SnapshotOptions {
  label: string;
}
export interface SnapshotResult {
  method: 'pls' | 'cbsem' | 'miiv' | 'process';
  /** What was estimated, e.g. "PLS-SEM (cSEM), 250 observations". */
  description: string;
  /** The diagram as an SVG document (shown only as an image). */
  diagram: string | null;
  pls?: PlsResult | null;
  cb?: CbResult | null;
  miiv?: MiivResult | null;
  process?: CpaResult | null;
  boot?: BootstrapResult | null;
  fitTest?: FitTestResult | null;
  processTitle?: string;
  level: number;
}

/** Tabs that compute something on demand (IPMA) are left out of a frozen snapshot. */
// (built on first use: the result tabs and the card store import each other)
const tabsOf = (m: SnapshotResult['method']) =>
  ({
    pls: PLS_TABS.filter((t) => t.id !== 'ipma'),
    cbsem: CB_TABS,
    miiv: MIIV_TABS,
    process: PROCESS_TABS,
  })[m];

/** The diagram, as an image: the SVG is never inserted into the page as markup. */
export const diagramSrc = (svg: string) =>
  `data:image/svg+xml;base64,${btoa(String.fromCharCode(...new TextEncoder().encode(svg)))}`;

/** The body of one results tab of a snapshot (or model run). */
function tabBody(r: SnapshotResult, tab: string) {
  if (r.method === 'pls' && r.pls) {
    return (
      <PlsTab tab={tab as PlsTabId} pls={r.pls} boot={r.boot ?? null} fitTest={r.fitTest ?? null} />
    );
  }
  if (r.method === 'cbsem' && r.cb) {
    return <CbTab tab={tab as CbTabId} cb={r.cb} boot={r.boot ?? null} />;
  }
  if (r.method === 'miiv' && r.miiv) {
    return <MiivTab tab={tab as MiivTabId} miiv={r.miiv} />;
  }
  if (r.method === 'process' && r.process) {
    return (
      <ProcessTab
        tab={tab as ProcessTabId}
        res={r.process}
        title={r.processTitle ?? 'Conditional process model'}
        level={r.level}
      />
    );
  }
  return null;
}

/** Results of a snapshot or a model run: its diagram and its tabs (in the report, every tab). */
export function SnapshotView({ r }: { r: SnapshotResult }) {
  const tabs = tabsOf(r.method) as readonly { id: string; label: string }[];
  const [tab, setTab] = useState(tabs[0].id);
  const report = useReportMode();
  const empty = <div className="muted">This snapshot has no results.</div>;
  const diagram = r.diagram && (
    <img
      className="snapshot-diagram"
      src={diagramSrc(r.diagram)}
      alt="The model’s diagram at the time of the snapshot"
    />
  );
  if (report) {
    const has = tabBody(r, tabs[0].id) !== null;
    return (
      <div className="snapshot">
        <div className="hint">{r.description}</div>
        {diagram}
        {has
          ? tabs.map((t) => (
              <section key={t.id}>
                <h4>{t.label}</h4>
                {tabBody(r, t.id)}
              </section>
            ))
          : empty}
      </div>
    );
  }
  return (
    <div className="snapshot">
      <div className="hint">{r.description}</div>
      {diagram}
      <div className="segmented wrap efa-tabs" role="tablist" aria-label="Snapshot results">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? 'on' : ''}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="results-body">{tabBody(r, tab) ?? empty}</div>
    </div>
  );
}

export const snapshotAnalysis: AnalysisType<SnapshotOptions, SnapshotResult> = {
  id: 'snapshot',
  title: 'Model snapshot',
  sub: 'the model’s results, frozen (take one from the Model tab)',
  group: 'Model runs',
  frozen: true,
  cardTitle: (o) => o.label || 'Model snapshot',
  display: ['label'],
  defaults: () => ({ label: 'Model snapshot' }),
  parseOptions: (raw) => (isObj(raw) ? { label: name(raw.label, 120) || 'Model snapshot' } : null),
  Options: ({ options: o, set, disabled }) => (
    <fieldset className="card-options" disabled={disabled}>
      <p className="hint" style={{ marginTop: 0 }}>
        A frozen copy of the model’s results at one moment. Change the model on the Model tab and
        take another snapshot to compare.
      </p>
      <div className="field">
        <label htmlFor="snap-label">Name</label>
        <input
          id="snap-label"
          className="input"
          maxLength={120}
          value={o.label}
          onChange={(e) => set({ label: e.target.value })}
        />
      </div>
    </fieldset>
  ),
  View: ({ result }) => <SnapshotView r={result} />,
  blocked: () => 'A snapshot is frozen: take a new one from the Model tab (Snapshot to Analyses).',
  fingerprint: () => fingerprint(['snapshot']),
  run: async () => {
    throw new Error('A snapshot is frozen: take a new one from the Model tab.');
  },
  summary: () => 'frozen results',
};
