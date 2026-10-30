import { autosave } from '../io';
import { AnalysesMenu } from './AnalysesMenu';
import { FileMenu } from './FileMenu';
import { run } from '../runner';
import { useStore, type Workspace } from '../store';
import { useState } from 'react';
import { switchMethod } from '../methodSwitch';
import { AccountMenu } from './cloud/AccountMenu';
import { PresenceBar } from './cloud/Presence';
import { ShareDialog } from './cloud/ShareDialog';
import { IconEye, IconShare, IconLogo, IconPlay, IconRedo, IconRepeat, IconUndo } from './icons';

const mod = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';

/** Switches the editor between the dataset and the diagram. */
export function WorkspaceTabs() {
  const workspace = useStore((s) => s.workspace);
  const setWorkspace = useStore((s) => s.setWorkspace);
  const tabs: [Workspace, string][] = [['data', 'Data'], ['model', 'Model']];
  return (
    <div className="segmented workspace-tabs" role="tablist" aria-label="Workspace">
      {tabs.map(([id, label]) => (
        <button key={id} role="tab" id={`ws-tab-${id}`} aria-selected={workspace === id} aria-controls={id === 'data' ? 'ws-data' : undefined}
          className={workspace === id ? 'on' : ''} onClick={() => setWorkspace(id)}>{label}</button>
      ))}
    </div>
  );
}

export function TopBar() {
  const name = useStore((s) => s.projectName);
  const setName = useStore((s) => s.setProjectName);
  const dirty = useStore((s) => s.dirty);
  const example = useStore((s) => s.example);
  const keepExample = useStore((s) => s.keepExample);
  const canUndo = useStore((s) => (s.history ? s.historyCounts.undo > 0 : s.past.length > 0));
  const canRedo = useStore((s) => (s.history ? s.historyCounts.redo > 0 : s.future.length > 0));
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const job = useStore((s) => s.job);
  const showResults = useStore((s) => s.showResultsOnDiagram);
  const setShowResults = useStore((s) => s.setShowResultsOnDiagram);
  const hasModel = useStore((s) => s.model.constructs.length > 0);
  const setView = useStore((s) => s.setView);
  const [shareOpen, setShareOpen] = useState(false);
  const method = useStore((s) => s.settings.method);
  const consistent = useStore((s) => s.settings.consistent);

  return (
    <header className="topbar">
      <button className="brand brand-btn" onClick={() => { void autosave(); setView('home'); }} title="Home: recent projects and examples">
        <span className="brand-mark"><IconLogo size={17} /></span>PLS Studio
      </button>
      <input className="project-name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Project name" maxLength={100} />
      {example ? (
        <span className="example-badge" title="An example: try anything; your changes are not kept, so it opens as the original next time.">
          Example
          <button className="btn sm ghost" onClick={() => { keepExample(); useStore.getState().toast('success', 'Now your own project: changes are kept in Recent projects.'); }}
            title="Keep this model, with your changes, as your own project">Keep<span className="lbl-wide"> as my project</span></button>
        </span>
      ) : dirty && <span className="dirty-dot" title="Unsaved changes" />}
      <div className="sep" />
      <FileMenu />
      <div className="sep" />
      <button className="btn icon ghost" onClick={undo} disabled={!canUndo} title={`Undo (${mod}Z)`} aria-label="Undo"><IconUndo /></button>
      <button className="btn icon ghost" onClick={redo} disabled={!canRedo} title={`Redo (${mod}⇧Z)`} aria-label="Redo"><IconRedo /></button>
      <div className="sep" />
      <WorkspaceTabs />
      <div className="spacer" />
      <PresenceBar />
      <button className="btn ghost" aria-label="Share" onClick={() => setShareOpen(true)} title="Invite people to work on this project"><IconShare /><span className="lbl">Share</span></button>
      <AccountMenu />
      <div className="sep" />
      <div className="segmented method-switch" role="radiogroup" aria-label="Estimation method">
        <button role="radio" aria-checked={method === 'pls'} className={method === 'pls' ? 'on' : ''} onClick={() => void switchMethod('pls')}>
          {consistent ? 'PLSc' : 'PLS-SEM'}
        </button>
        <button role="radio" aria-checked={method === 'cbsem'} className={method === 'cbsem' ? 'on' : ''} onClick={() => void switchMethod('cbsem')}>CB-SEM</button>
        <button role="radio" aria-checked={method === 'process'} className={method === 'process' ? 'on' : ''} onClick={() => void switchMethod('process')}
          title="CPA: conditional process analysis, Hayes's PROCESS models (mediation, moderation, moderated mediation) by OLS regression, with manymome">CPA</button>
      </div>
      <button className={`btn icon ghost${showResults ? '' : ' muted'}`} onClick={() => setShowResults(!showResults)}
        title={showResults ? 'Hide estimates on the diagram' : 'Show estimates on the diagram'} aria-pressed={showResults}>
        <IconEye />
      </button>
      <div className="sep" />
      <AnalysesMenu />
      {/* CPA bootstraps within Calculate. The button keeps its place (hidden) so the controls
          to its left, the method switch among them, do not move when the method changes. */}
      <button className="btn" aria-label="Bootstrap" onClick={() => run('boot')} disabled={!!job || !hasModel || method === 'process'} title="Bootstrap standard errors, p-values and confidence intervals"
        style={method === 'process' ? { visibility: 'hidden' } : undefined} aria-hidden={method === 'process'} tabIndex={method === 'process' ? -1 : undefined}>
        <IconRepeat /><span className="lbl-wide">Bootstrap</span>
      </button>
      <button className="btn primary" onClick={() => run('estimate')} disabled={!!job || !hasModel}
        title={`${method === 'pls' ? 'Run the PLS algorithm' : method === 'process' ? 'OLS regressions and bootstrap of the indirect effects (manymome)' : 'Maximum-likelihood estimation'} (${mod}↵)`}>
        <IconPlay size={14} /> Calculate
      </button>
      {shareOpen && <ShareDialog onClose={() => setShareOpen(false)} />}
    </header>
  );
}
