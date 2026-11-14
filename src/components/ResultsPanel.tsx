import { useState, type ReactNode } from 'react';
import { cancelJob, run } from '../runner';
import { useFreshResults, useStore, type State } from '../store';
import { IconChevronDown, IconChevronUp, IconPlay } from './icons';
import { useR } from '../rengine/status';
import { EngineBadge, engineOf } from './EngineBadge';
import { ExampleResultsBadge } from './validation/ExampleResultsBadge';
import { CB_TABS, CbTab, type CbTabId } from './results/CbTabs';
import '../analyses/dfiFit'; // (fills the fit tab's Dynamic-cutoffs slot)
import { MIIV_TABS, MiivTab, type MiivTabId } from './results/MiivTabs';
import { PlsTab, plsTabsFor, type PlsTabId } from './results/PlsTabs';
import { PROCESS_TABS, ProcessTab, type ProcessTabId } from './results/ProcessTabs';
import { processGraph } from '../process/fromModel';
import { MessagesView } from './results/Messages';
import { ScriptView } from './results/ScriptView';
import { IconAlert } from './icons';

/** The progress line: R's message, "Estimating…", or the resampling count. */
function progressText(job: NonNullable<State['job']>, rMessage: string): string {
  if (job.label) return rMessage || job.label;
  if (job.kind === 'estimate') return 'Estimating…';
  const what = job.kind === 'fittest' ? 'Fit test' : 'Bootstrapping';
  const cores = job.workers && job.workers > 1 ? ` · ${job.workers} cores` : '';
  return `${what} ${job.done}/${job.total}${cores}`;
}

/** Which parameters the multigroup invariance level holds equal. */
function heldEqualText(invariance: string): string {
  if (invariance === 'metric') return 'Loadings equal across groups';
  if (invariance === 'scalar') return 'Loadings and intercepts equal across groups';
  return 'Loadings, intercepts and residual variances equal across groups';
}

export function ResultsPanel({
  height,
  onResize,
}: {
  height: number;
  onResize: (h: number) => void;
}) {
  const open = useStore((s) => s.resultsOpen);
  const invariance = useStore((s) => s.model.multigroup?.invariance);
  const compareGroups = useStore((s) => s.compareGroups);
  const setOpen = useStore((s) => s.setResultsOpen);
  const job = useStore((s) => s.job);
  const method = useStore((s) => s.settings.method);
  const results = useFreshResults();
  const anyResults = useStore((s) => s.results !== null);
  const [plsTab, setPlsTab] = useState<PlsTabId>('overview');
  const [cbTab, setCbTab] = useState<CbTabId>('fit');
  const [miivTab, setMiivTab] = useState<MiivTabId>('equations');
  const [processTab, setProcessTab] = useState<ProcessTabId>('effects');
  /** A session tab shown instead of the method's results. */
  const [extra, setExtra] = useState<'messages' | 'script' | null>(null);
  const messageCount = useStore((s) => s.messages.length);
  const warned = useStore((s) =>
    s.messages.length > 0 && s.messages[s.messages.length - 1].level === 'error'
      ? 'error'
      : 'warning',
  );
  const confidence = useStore((s) => s.settings.confidence);
  const model = useStore((s) => s.model);
  const estimator = useStore((s) => s.settings.estimator);
  const isMiiv = method === 'cbsem' && estimator === '2SLS';
  const miiv = isMiiv ? (results?.miiv ?? null) : null;
  const pls = method === 'pls' ? (results?.pls ?? null) : null;
  const cb = method === 'cbsem' ? (results?.cb ?? null) : null;
  const proc = method === 'process' ? (results?.process ?? null) : null;
  const recognised = proc ? processGraph(model).recognised : null;
  const procTitle = recognised
    ? `PROCESS model ${recognised.model}`
    : 'Custom conditional process model';
  const boot = results?.boot ?? null;
  const rMessage = useR((s) => (s.status === 'loading' ? s.message : ''));
  const engineLabel = engineOf(results, method, isMiiv);

  // The method's tab list and the tab chosen in it.
  let tabs: readonly { id: string; label: string }[];
  let active: string;
  if (method === 'process') {
    tabs = PROCESS_TABS;
    active = processTab;
  } else if (method === 'pls') {
    tabs = plsTabsFor(pls);
    active = plsTab === 'hoc' && !pls?.higherOrder?.length ? 'overview' : plsTab;
  } else if (isMiiv) {
    tabs = MIIV_TABS;
    active = miivTab;
  } else {
    tabs = CB_TABS;
    active = cbTab;
  }
  const setTab = (id: string) => {
    setExtra(null);
    if (method === 'process') setProcessTab(id as ProcessTabId);
    else if (method === 'pls') setPlsTab(id as PlsTabId);
    else if (isMiiv) setMiivTab(id as MiivTabId);
    else setCbTab(id as CbTabId);
  };

  // A session tab, the current method's results, or the prompt to calculate.
  let body: ReactNode;
  if (extra === 'messages') body = <MessagesView />;
  else if (extra === 'script') body = <ScriptView />;
  else if (proc)
    body = <ProcessTab tab={processTab} res={proc} title={procTitle} level={confidence} />;
  else if (pls)
    body = (
      <PlsTab
        tab={active as PlsTabId}
        pls={pls}
        boot={boot}
        fitTest={results?.fitTest ?? null}
        onTab={setPlsTab}
      />
    );
  else if (miiv) body = <MiivTab tab={miivTab} miiv={miiv} />;
  else if (cb && !isMiiv)
    body = (
      <CbTab
        tab={cbTab}
        cb={cb}
        boot={boot}
        compare={compareGroups && !!cb.groups && !cb.groups.levels}
      />
    );
  else
    body = (
      <div className="empty-results">
        {anyResults ? 'The model or settings changed since the last run. ' : 'No results yet. '}
        <button className="btn sm primary" onClick={() => run('estimate')}>
          <IconPlay size={12} /> Calculate
        </button>
      </div>
    );

  const startResize = (e: React.PointerEvent) => {
    const startY = e.clientY;
    const startH = height;
    const move = (ev: PointerEvent) =>
      onResize(Math.min(window.innerHeight - 160, Math.max(160, startH + startY - ev.clientY)));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const progress = job && (
    <div className="progress">
      <span className="muted">{progressText(job, rMessage)}</span>
      <div className="bar">
        <div
          className={`fill${job.label ? ' indeterminate' : ''}`}
          style={{
            width: `${job.label || job.kind === 'estimate' ? 60 : (100 * job.done) / job.total}%`,
          }}
        />
      </div>
      <button className="btn sm" onClick={cancelJob}>
        Cancel
      </button>
    </div>
  );

  if (!open) {
    return (
      <div className="results-collapsed">
        {pls && (
          <span className="muted">
            Last run: {pls.consistent ? 'PLSc' : 'PLS'}, {pls.n} observations, {pls.iterations}{' '}
            iterations{boot ? `, ${boot.samples} bootstrap samples` : ''}
          </span>
        )}
        {miiv && (
          <span className="muted">
            Last run: MIIV-2SLS, {miiv.equations.length} equations, N = {miiv.n}
          </span>
        )}
        {proc && (
          <span className="muted">
            Last run: {procTitle}, n = {proc.n}
            {proc.boot.samples ? `, ${proc.boot.samples} bootstrap samples` : ''}
          </span>
        )}
        {cb && !isMiiv && (
          <span className="muted">
            Last run: {cb.estimator}, χ²({cb.fit.df}) = {cb.fit.chisq.toFixed(2)}, CFI{' '}
            {cb.fit.cfi.toFixed(3)}, RMSEA {cb.fit.rmsea.toFixed(3)}
          </span>
        )}
        <div className="spacer" />
        {progress}
        {messageCount > 0 && (
          <button
            className={`btn sm ghost msg-badge ${warned}`}
            onClick={() => {
              setExtra('messages');
              setOpen(true);
            }}
            title="Warnings and errors of this session"
          >
            <IconAlert size={13} /> {messageCount}
          </button>
        )}
        {/* Same corner as the collapse button of the open panel. */}
        <button className="btn sm ghost" onClick={() => setOpen(true)} aria-label="Expand results">
          Results <IconChevronUp size={14} />
        </button>
      </div>
    );
  }

  return (
    <section className="results" style={{ height }} aria-label="Results">
      <div className="results-resize" onPointerDown={startResize} />
      <div className="results-head" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={!extra && active === t.id}
            className={`tab${!extra && active === t.id ? ' on' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
        <button
          role="tab"
          aria-selected={extra === 'script'}
          className={`tab${extra === 'script' ? ' on' : ''}`}
          onClick={() => setExtra('script')}
          title="The R script that calculates this model, to read, copy or download"
        >
          R script
        </button>
        <button
          role="tab"
          aria-selected={extra === 'messages'}
          className={`tab${extra === 'messages' ? ' on' : ''}`}
          onClick={() => setExtra('messages')}
        >
          Messages{messageCount > 0 ? ` (${messageCount})` : ''}
        </button>
        <div className="spacer" />
        {cb?.groups && !cb.groups.levels && invariance && invariance !== 'configural' && (
          <span
            className="hint"
            title="Measurement invariance holds these parameters equal across groups; the tables that show them are the same in every group. Variances, covariances, structural paths and (from scalar on) latent means still differ per group."
          >
            {heldEqualText(invariance)}
          </span>
        )}
        {cb?.groups && (
          <div className="segmented group-switch" role="radiogroup" aria-label="Group shown">
            {cb.groups.labels.map((l, i) => (
              <button
                key={l}
                role="radio"
                aria-checked={!compareGroups && cb.groupIndex === i}
                className={!compareGroups && cb.groupIndex === i ? 'on' : ''}
                onClick={() => {
                  useStore.getState().setCompareGroups(false);
                  useStore.getState().showGroup(i);
                }}
                title={`Show the results of group ${l} (diagram and tables)`}
              >
                {cb.groups!.levels || cb.groups!.labels.length > 4 ? l : `Group ${l}`}
              </button>
            ))}
            {!cb.groups.levels && (
              <button
                role="radio"
                aria-checked={compareGroups}
                className={compareGroups ? 'on' : ''}
                onClick={() => useStore.getState().setCompareGroups(true)}
                title="Every table with one column set per group, differences from the first group, and the score test of each equality constraint"
              >
                All groups
              </button>
            )}
          </div>
        )}
        {!job && <ExampleResultsBadge />}
        {!job && <EngineBadge label={engineLabel} />}
        {progress}
        <button
          className="btn icon ghost"
          onClick={() => setOpen(false)}
          aria-label="Collapse results"
        >
          <IconChevronDown />
        </button>
      </div>
      <div className="results-body">{body}</div>
    </section>
  );
}
