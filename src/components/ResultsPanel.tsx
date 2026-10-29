import { useState } from 'react';
import { cancelJob, run } from '../runner';
import { useFreshResults, useStore } from '../store';
import { IconChevronDown, IconChevronUp, IconPlay } from './icons';
import { useR } from '../rengine/status';
import { EngineBadge, engineOf } from './EngineBadge';
import { CB_TABS, CbTab, type CbTabId } from './results/CbTabs';
import { MIIV_TABS, MiivTab, type MiivTabId } from './results/MiivTabs';
import { PLS_TABS, PlsTab, type PlsTabId } from './results/PlsTabs';
import { PROCESS_TABS, ProcessTab, type ProcessTabId } from './results/ProcessTabs';
import { processGraph } from '../process/fromModel';
import { MessagesView } from './results/Messages';
import { IconAlert } from './icons';

export function ResultsPanel({ height, onResize }: { height: number; onResize: (h: number) => void }) {
  const open = useStore((s) => s.resultsOpen);
  const setOpen = useStore((s) => s.setResultsOpen);
  const job = useStore((s) => s.job);
  const method = useStore((s) => s.settings.method);
  const results = useFreshResults();
  const anyResults = useStore((s) => s.results !== null);
  const [plsTab, setPlsTab] = useState<PlsTabId>('overview');
  const [cbTab, setCbTab] = useState<CbTabId>('fit');
  const [miivTab, setMiivTab] = useState<MiivTabId>('equations');
  const [processTab, setProcessTab] = useState<ProcessTabId>('effects');
  const [showMessages, setShowMessages] = useState(false);
  const messageCount = useStore((s) => s.messages.length);
  const warned = useStore((s) => s.messages.length > 0 && s.messages[s.messages.length - 1].level === 'error' ? 'error' : 'warning');
  const confidence = useStore((s) => s.settings.confidence);
  const model = useStore((s) => s.model);
  const estimator = useStore((s) => s.settings.estimator);
  const isMiiv = method === 'cbsem' && estimator === '2SLS';
  const miiv = isMiiv ? results?.miiv ?? null : null;
  const pls = method === 'pls' ? results?.pls ?? null : null;
  const cb = method === 'cbsem' ? results?.cb ?? null : null;
  const proc = method === 'process' ? results?.process ?? null : null;
  const recognised = proc ? processGraph(model).recognised : null;
  const procTitle = recognised ? `PROCESS model ${recognised.model}` : 'Custom conditional process model';
  const boot = results?.boot ?? null;
  const rMessage = useR((s) => (s.status === 'loading' ? s.message : ''));
  const engineLabel = engineOf(results, method, isMiiv);

  const tabs = method === 'process' ? PROCESS_TABS : method === 'pls' ? PLS_TABS : isMiiv ? MIIV_TABS : CB_TABS;
  const active = method === 'process' ? processTab : method === 'pls' ? plsTab : isMiiv ? miivTab : cbTab;
  const setTab = (id: string) => {
    setShowMessages(false);
    if (method === 'process') setProcessTab(id as ProcessTabId);
    else if (method === 'pls') setPlsTab(id as PlsTabId);
    else if (isMiiv) setMiivTab(id as MiivTabId);
    else setCbTab(id as CbTabId);
  };

  const body = showMessages ? <MessagesView />
    : proc ? <ProcessTab tab={processTab} res={proc} title={procTitle} level={confidence} />
    : pls ? <PlsTab tab={plsTab} pls={pls} boot={boot} fitTest={results?.fitTest ?? null} />
    : miiv ? <MiivTab tab={miivTab} miiv={miiv} />
    : cb && !isMiiv ? <CbTab tab={cbTab} cb={cb} boot={boot} />
      : (
        <div className="empty-results">
          {anyResults ? 'The model or settings changed since the last run. ' : 'No results yet. '}
          <button className="btn sm primary" onClick={() => run('estimate')}><IconPlay size={12} /> Calculate</button>
        </div>
      );

  const startResize = (e: React.PointerEvent) => {
    const startY = e.clientY, startH = height;
    const move = (ev: PointerEvent) => onResize(Math.min(window.innerHeight - 160, Math.max(160, startH + startY - ev.clientY)));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const progress = job && (
    <div className="progress">
      <span className="muted">
        {job.label ? rMessage || job.label : job.kind === 'estimate' ? 'Estimating…' : `${job.kind === 'fittest' ? 'Fit test' : 'Bootstrapping'} ${job.done}/${job.total}${job.workers && job.workers > 1 ? ` · ${job.workers} cores` : ''}`}
      </span>
      <div className="bar"><div className={`fill${job.label ? ' indeterminate' : ''}`} style={{ width: `${job.label || job.kind === 'estimate' ? 60 : (100 * job.done) / job.total}%` }} /></div>
      <button className="btn sm" onClick={cancelJob}>Cancel</button>
    </div>
  );

  if (!open) {
    return (
      <div className="results-collapsed">
        {pls && <span className="muted">Last run: {pls.consistent ? 'PLSc' : 'PLS'}, {pls.n} observations, {pls.iterations} iterations{boot ? `, ${boot.samples} bootstrap samples` : ''}</span>}
        {miiv && <span className="muted">Last run: MIIV-2SLS, {miiv.equations.length} equations, N = {miiv.n}</span>}
        {proc && <span className="muted">Last run: {procTitle}, n = {proc.n}{proc.boot.samples ? `, ${proc.boot.samples} bootstrap samples` : ''}</span>}
        {cb && !isMiiv && <span className="muted">Last run: {cb.estimator}, χ²({cb.fit.df}) = {cb.fit.chisq.toFixed(2)}, CFI {cb.fit.cfi.toFixed(3)}, RMSEA {cb.fit.rmsea.toFixed(3)}</span>}
        <div className="spacer" />
        {progress}
        {messageCount > 0 && (
          <button className={`btn sm ghost msg-badge ${warned}`} onClick={() => { setShowMessages(true); setOpen(true); }} title="Warnings and errors of this session">
            <IconAlert size={13} /> {messageCount}
          </button>
        )}
        {/* Same corner as the collapse button of the open panel. */}
        <button className="btn sm ghost" onClick={() => setOpen(true)} aria-label="Expand results">Results <IconChevronUp size={14} /></button>
      </div>
    );
  }

  return (
    <section className="results" style={{ height }} aria-label="Results">
      <div className="results-resize" onPointerDown={startResize} />
      <div className="results-head" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={!showMessages && active === t.id} className={`tab${!showMessages && active === t.id ? ' on' : ''}`} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
        <button role="tab" aria-selected={showMessages} className={`tab${showMessages ? ' on' : ''}`} onClick={() => setShowMessages(true)}>
          Messages{messageCount > 0 ? ` (${messageCount})` : ''}
        </button>
        <div className="spacer" />
        {cb?.groups && (
          <div className="segmented group-switch" role="radiogroup" aria-label="Group shown">
            {cb.groups.labels.map((l, i) => (
              <button key={l} role="radio" aria-checked={cb.groupIndex === i} className={cb.groupIndex === i ? 'on' : ''}
                onClick={() => useStore.getState().showGroup(i)} title={`Show the results of group ${l} (diagram and tables)`}>
                {cb.groups!.labels.length <= 4 ? `Group ${l}` : l}
              </button>
            ))}
          </div>
        )}
        {!job && <EngineBadge label={engineLabel} />}
        {progress}
        <button className="btn icon ghost" onClick={() => setOpen(false)} aria-label="Collapse results"><IconChevronDown /></button>
      </div>
      <div className="results-body">{body}</div>
    </section>
  );
}
