// What the tour's steps do to put the app in the state they show: the home screen, the tour's example
// open on a workspace, results calculated, a results tab chosen. Each is safe to call again, so that
// a step reached from the contents prepares itself however the person got there.

import { calculateHere } from '../../analyses/calculate';
import { addAnalysis, runCard, useAnalyses } from '../../analyses/store';
import { autosave, currentEntry, loadSample } from '../../io';
import { useCompute } from '../../rengine/compute';
import { useR } from '../../rengine/status';
import { resultsKey, useStore, type Workspace } from '../../store';
import { confirmDialog } from '../Overlays';
import { findTarget, preparing, useTour } from './engine';

/** The built-in example the tour walks through. */
export const TOUR_EXAMPLE = 'customer';

/** Whether the tour switched its example to the built-in engine because R was not ready. */
let switchedToBuiltin = false;
export const tourUsesBuiltin = () => switchedToBuiltin;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Resolves when no calculation is running (or after `timeout`). */
export function jobEnded(timeout = 300_000): Promise<void> {
  return new Promise((resolve) => {
    if (!useStore.getState().job) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      unsub();
      resolve();
    }, timeout);
    const unsub = useStore.subscribe((s) => {
      if (s.job) return;
      clearTimeout(timer);
      unsub();
      resolve();
    });
  });
}

/** The PLS results of the model as it is now, if calculated. */
export function hasFreshResults(): boolean {
  const s = useStore.getState();
  return !!s.results && s.results.key === resultsKey(s) && !!s.results.pls;
}

/** Bootstrap results of the model as it is now. */
export function hasFreshBootstrap(): boolean {
  return hasFreshResults() && !!useStore.getState().results?.boot;
}

/** Whether the project open is the example the tour opened. */
export function tourOwnsProject(): boolean {
  const s = useStore.getState();
  const own = useTour.getState().ownProject;
  return !!own && s.projectId === own && s.example === TOUR_EXAMPLE;
}

export function ensureHome() {
  const s = useStore.getState();
  if (s.view === 'home') return;
  void autosave();
  s.setView('home');
}

/** The text of the question before the tour replaces the open project with its example. */
function replaceQuestion(name: string, kept: boolean, example: boolean): string {
  if (example)
    return `The tour works in a fresh copy of the Customer experience example, in place of “${name}”. Examples open as the original, so nothing of yours is lost.`;
  if (kept)
    return `The tour works in the Customer experience example. “${name}” stays in Recent projects on the home screen, and the tour offers to reopen it at the end.`;
  return `The tour works in the Customer experience example, in place of “${name}”. Save your project first (File → Save project) if you want to keep it.`;
}

/**
 * Open the tour's example, unless the tour opened it already. Asks first when a project is open;
 * resolves false when the person declines.
 */
export async function ensureExample(): Promise<boolean> {
  const s = useStore.getState();
  if (tourOwnsProject()) {
    if (s.view !== 'editor') s.setView('editor');
    return true;
  }
  const hasWork = s.model.constructs.length > 0 || s.data !== null;
  const entry = currentEntry();
  if (hasWork) {
    const ok = await confirmDialog({
      title: 'Open the tour’s example?',
      body: replaceQuestion(s.projectName, !!entry, !!s.example),
      confirmLabel: 'Open the example',
    });
    if (!ok) {
      s.toast('info', 'Tour stopped. Your project is as it was.');
      return false;
    }
  }
  const previous = entry ? { id: entry.id, name: entry.name } : null;
  preparing('Opening the Customer experience example…');
  await loadSample(TOUR_EXAMPLE);
  const after = useStore.getState();
  if (after.example !== TOUR_EXAMPLE) return false;
  useTour.setState({ ownProject: after.projectId, previous });
  // R loads in the background on a first visit: the built-in engine calculates at once meanwhile.
  const helper = useCompute.getState().backend === 'helper';
  switchedToBuiltin = !helper && useR.getState().status !== 'ready';
  if (switchedToBuiltin) after.setSettings({ engine: 'builtin' });
  return true;
}

/** The tour's example on one of the editor's tabs, with nothing selected. */
export async function ensureWorkspace(w: Workspace): Promise<boolean> {
  if (!(await ensureExample())) return false;
  const s = useStore.getState();
  if (s.view !== 'editor') s.setView('editor');
  if (s.workspace !== w) s.setWorkspace(w);
  if (s.tool !== 'select') s.setTool('select');
  if (s.selection.nodes.length || s.selection.edges.length)
    s.setSelection({ nodes: [], edges: [] });
  if (s.selectedVars.length) s.setSelectedVars([]);
  return true;
}

/** The example calculated (estimated by the engine it is set to). */
export async function ensureResults(): Promise<boolean> {
  if (!(await ensureWorkspace('model'))) return false;
  await jobEnded();
  if (hasFreshResults()) return true;
  preparing('Calculating the example…');
  await calculateHere('estimate');
  await jobEnded();
  return true;
}

/** The example calculated and bootstrapped. */
export async function ensureBootstrap(): Promise<boolean> {
  if (!(await ensureResults())) return false;
  if (hasFreshBootstrap()) return true;
  preparing('Bootstrapping the example (a few seconds)…');
  await calculateHere('boot');
  await jobEnded();
  return true;
}

/** Click the element with this data-tour attribute once it is there (a tab), waiting up to `ms`. */
export async function clickTarget(key: string, ms = 2000): Promise<boolean> {
  const until = Date.now() + ms;
  for (;;) {
    const el = findTarget(key);
    if (el) {
      el.click();
      return true;
    }
    if (Date.now() >= until) return false;
    await sleep(50);
  }
}

/** The data-tour attribute of a results tab (ResultsPanel). */
export const resultsTab = (id: string) => `results-tab-${id}`;

/** The results panel open on a tab, after calculating (and bootstrapping, with `boot`). */
export async function showResultsTab(id: string, opts: { boot?: boolean } = {}): Promise<boolean> {
  const ok = opts.boot ? await ensureBootstrap() : await ensureResults();
  if (!ok) return false;
  useStore.getState().setResultsOpen(true);
  await clickTarget(resultsTab(id));
  return true;
}

/** The card the tour adds on the Analyses tab. */
export const TOUR_CARD = 'checklist';

export function tourCard() {
  return useAnalyses.getState().cards.find((c) => c.kind === 'analysis' && c.type === TOUR_CARD);
}

/** Add the reviewer checklist card (if there is none) and select it. */
export function addTourCard(): string | null {
  const existing = tourCard();
  if (existing) {
    useAnalyses.setState({ selected: existing.id });
    return existing.id;
  }
  return addAnalysis(TOUR_CARD);
}

export function tourCardHasRun(): boolean {
  const c = tourCard();
  return !!c && c.kind === 'analysis' && !!c.run;
}

export async function runTourCard() {
  const id = addTourCard();
  if (id) await runCard(id);
}
