import { AnalysesWorkspace } from './components/analyses/AnalysesWorkspace';
import { useAnalyses } from './analyses/store';
import { DataScreeningPanel } from './components/DataScreeningPanel';
import { EfaPanel } from './components/EfaPanel';
import { PlsAssessmentPanel } from './components/PlsAssessmentPanel';
import { SegmentationPanel } from './components/SegmentationPanel';
import { MultilevelPanel } from './components/MultilevelPanel';
import { DataWorkspace } from './components/DataViewer';
import { ReactFlowProvider } from '@xyflow/react';
import { useEffect, useState } from 'react';
import { Canvas } from './components/Canvas';
import { DataPanel } from './components/DataPanel';
import { Inspector } from './components/Inspector';
import { ConfirmModal, Toasts } from './components/Overlays';
import { ResultsPanel } from './components/ResultsPanel';
import { SimulationPanel } from './components/SimulationPanel';
import { LongitudinalPanel } from './components/LongitudinalPanel';
import { ItemsPanel } from './components/ItemsPanel';
import { useSim } from './simStore';
import { TopBar } from './components/TopBar';
import { HomeScreen } from './components/HomeScreen';
import { AuthDialog } from './components/cloud/AuthDialog';
import { useAuth } from './cloud/auth';
import { handleUrlParams } from './cloud/invites';
import { autosave, importCsv, loadSample, migrateAutosave, openProject, saveProject } from './io';
import { run } from './runner';
import { useStore } from './store';

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
}

export default function App() {
  const [resultsHeight, setResultsHeight] = useState(320);
  const view = useStore((s) => s.view);
  const workspace = useStore((s) => s.workspace);

  useEffect(() => {
    void migrateAutosave();
    void useAuth.getState().refresh().then(handleUrlParams);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsub = useStore.subscribe((s, prev) => {
      if (s.model === prev.model && s.settings === prev.settings && s.data === prev.data && s.projectName === prev.projectName) return;
      clearTimeout(timer);
      timer = setTimeout(() => void autosave(), 800);
    });
    // The simulation design is saved with the project too.
    const unsubSim = useSim.subscribe((s, prev) => {
      if (s.design === prev.design) return;
      clearTimeout(timer);
      timer = setTimeout(() => void autosave(), 800);
    });
    // So is the analysis log (a change to it is an unsaved change).
    const unsubCards = useAnalyses.subscribe((s, prev) => {
      if (s.cards === prev.cards) return;
      useStore.setState({ dirty: true });
      clearTimeout(timer);
      timer = setTimeout(() => void autosave(), 800);
    });
    return () => { unsub(); unsubSim(); unsubCards(); clearTimeout(timer); };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState();
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); void openProject(); return; }
      // Everything else is an editor shortcut.
      if (s.view === 'home') return;
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveProject(); return; }
      if (mod && e.key === 'Enter') { e.preventDefault(); run(e.shiftKey ? 'boot' : 'estimate'); return; }
      if (isTyping(e)) return;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) s.redo(); else s.undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); s.redo(); return; }
      // The rest act on the diagram.
      if (s.workspace !== 'model') return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && (s.selection.moderations?.length || s.selection.correlations?.length)) {
        e.preventDefault();
        s.deleteItems([], [], s.selection.moderations ?? [], s.selection.correlations ?? []);
        return;
      }
      if (mod || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'v') s.setTool('select');
      else if (k === 'c') s.setTool('construct');
      else if (k === 'p') s.setTool('connect');
      else if (k === 'r' && s.settings.method === 'cbsem') s.setTool('correlate');
      else if (k === 'escape') { s.setTool('select'); s.setSelection({ nodes: [], edges: [] }); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (view === 'home') {
    return (
      <>
        <HomeScreen />
        <AuthDialog />
        <ConfirmModal />
        <Toasts />
      </>
    );
  }

  return (
    <ReactFlowProvider>
      <div className="app">
        <TopBar />
        <div className="workspace">
          <div className="data-col" inert={workspace === 'analyses'}><DataPanel /></div>
          {/* The diagram stays mounted (and laid out) behind the Data tab, so switching back keeps its viewport. */}
          <main className="center" inert={workspace !== 'model'}>
            <Canvas onImport={() => void importCsv()} onSample={(w) => void loadSample(w)} />
            <ResultsPanel height={resultsHeight} onResize={setResultsHeight} />
          </main>
          <div className="inspector-col" inert={workspace !== 'model'}><Inspector /></div>
          {workspace === 'data' && <DataWorkspace />}
          {workspace === 'analyses' && <AnalysesWorkspace />}
        </div>
      </div>
      <SimulationPanel />
      <LongitudinalPanel />
      <ItemsPanel />
      <MultilevelPanel />
      <SegmentationPanel />
      <PlsAssessmentPanel />
      <EfaPanel />
      <DataScreeningPanel />
      <AuthDialog />
      <ConfirmModal />
      <Toasts />
    </ReactFlowProvider>
  );
}
