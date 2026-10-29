import { autosave, importCsv, newProject, openProject, saveProject } from '../io';
import { run } from '../runner';
import { useStore } from '../store';
import { useState } from 'react';
import { switchMethod } from '../methodSwitch';
import { AccountMenu } from './cloud/AccountMenu';
import { PresenceBar } from './cloud/Presence';
import { ShareDialog } from './cloud/ShareDialog';
import { useSim } from '../simStore';
import { IconEye, IconHome, IconShare, IconLogo, IconSparkle, IconNew, IconOpen, IconPlay, IconRedo, IconRepeat, IconSave, IconUndo, IconUpload } from './icons';

const mod = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';

export function TopBar() {
  const name = useStore((s) => s.projectName);
  const setName = useStore((s) => s.setProjectName);
  const dirty = useStore((s) => s.dirty);
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
      <button className="btn ghost" aria-label="Home" onClick={() => { void autosave(); setView('home'); }} title="Home: recent projects, examples"><IconHome /><span className="lbl">Home</span></button>
      <input className="project-name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Project name" maxLength={100} />
      {dirty && <span className="dirty-dot" title="Unsaved changes" />}
      <div className="sep" />
      <button className="btn ghost" aria-label="New" onClick={() => void newProject()} title="New project"><IconNew /><span className="lbl">New</span></button>
      <button className="btn ghost" aria-label="Open" onClick={() => void openProject()} title={`Open project (${mod}O)`}><IconOpen /><span className="lbl">Open</span></button>
      <button className="btn ghost" onClick={saveProject} title={`Save project (${mod}S)`} aria-label="Save"><IconSave /><span className="lbl">Save</span></button>
      <button className="btn ghost" aria-label="Import data" onClick={() => void importCsv()} title="Import a CSV dataset"><IconUpload /><span className="lbl">Import data</span></button>
      <div className="sep" />
      <button className="btn icon ghost" onClick={undo} disabled={!canUndo} title={`Undo (${mod}Z)`} aria-label="Undo"><IconUndo /></button>
      <button className="btn icon ghost" onClick={redo} disabled={!canRedo} title={`Redo (${mod}⇧Z)`} aria-label="Redo"><IconRedo /></button>
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
      {method !== 'process' && (
        <>
          <button className="btn ghost" aria-label="Simulate" onClick={() => useSim.getState().setOpen(true)} disabled={!hasModel} title="Monte Carlo simulation: power, sample size, estimator comparison">
            <IconSparkle size={15} /><span className="lbl">Simulate</span>
          </button>
          <button className="btn" onClick={() => run('boot')} disabled={!!job || !hasModel} title="Bootstrap standard errors, p-values and confidence intervals">
            <IconRepeat /> Bootstrap
          </button>
        </>
      )}
      <button className="btn primary" onClick={() => run('estimate')} disabled={!!job || !hasModel}
        title={`${method === 'pls' ? 'Run the PLS algorithm' : method === 'process' ? 'OLS regressions and bootstrap of the indirect effects (manymome)' : 'Maximum-likelihood estimation'} (${mod}↵)`}>
        <IconPlay size={14} /> Calculate
      </button>
      {shareOpen && <ShareDialog onClose={() => setShareOpen(false)} />}
    </header>
  );
}
