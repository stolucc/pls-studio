import { create } from 'zustand';
import type { FitTestResult } from './engine/bootstrap';
import type { CbResult } from './engine/cbsem';
import type { MiivResult } from './engine/miiv';
import type { BootstrapResult, Dataset, PlsResult } from './engine/types';
import { autoLayout, suggestName } from './model/layout';
import {
  createsCycle, DEFAULT_SETTINGS, newId, pruneCorrelations, toSpec,
  type Construct, type Correlation, type DataInfo, type ModelState, type Settings, type Side,
} from './model/project';

export type Tool = 'select' | 'construct' | 'connect' | 'correlate';
export interface Selection { nodes: string[]; edges: string[]; moderations?: string[]; correlations?: string[] }
export const NO_SELECTION: Selection = { nodes: [], edges: [], moderations: [], correlations: [] };

export interface Toast { id: number; kind: 'error' | 'info' | 'success'; text: string }

export interface Results {
  pls: PlsResult | null;
  cb: CbResult | null;
  miiv: MiivResult | null;
  /** Bootstrap for whichever method the key describes. */
  boot: BootstrapResult | null;
  fitTest: FitTestResult | null;
  /** Fingerprint of the model/settings/data the results were computed for. */
  key: string;
}

export type JobKind = 'estimate' | 'boot' | 'fittest';
export interface Job { kind: JobKind; done: number; total: number; workers?: number; /** Set for R calculations (no step count): what is running. */ label?: string }

export type View = 'home' | 'editor';

export interface CloudState {
  projectId: string;
  role: 'owner' | 'editor' | 'viewer';
  status: 'connecting' | 'online' | 'offline';
}

/** Collaborative undo (Y.UndoManager, own changes only) replaces the local history. */
export interface HistoryOverride { undo(): void; redo(): void }

interface State {
  /** Identifies the project in the recent-projects store. */
  projectId: string;
  /** Set while the open project is a shared (server) project. */
  cloud: CloudState | null;
  history: HistoryOverride | null;
  /** Undo/redo availability when `history` is set. */
  historyCounts: { undo: number; redo: number };
  view: View;
  projectName: string;
  model: ModelState;
  past: ModelState[];
  future: ModelState[];
  settings: Settings;
  data: Dataset | null;
  dataInfo: DataInfo | null;
  dataVersion: number;
  selection: Selection;
  selectedVars: string[];
  tool: Tool;
  results: Results | null;
  job: Job | null;
  toasts: Toast[];
  dirty: boolean;
  showResultsOnDiagram: boolean;
  /** CB-SEM diagrams: draw error terms (ε) and disturbances (ζ). */
  showErrorTerms: boolean;
  /** CB-SEM diagrams: standardised (std.all) or unstandardised estimates. */
  estimateScale: 'std' | 'unstd';
  resultsOpen: boolean;
  /** Incremented whenever the canvas should re-fit the view (project load, layout). */
  fitRequest: number;

  commit: (fn: (m: ModelState) => ModelState) => void;
  undo: () => void;
  redo: () => void;
  checkpoint: () => void;

  addConstruct: (x: number, y: number, indicators?: string[]) => string;
  updateConstruct: (id: string, patch: Partial<Pick<Construct, 'name' | 'type' | 'mode' | 'side' | 'covariate' | 'components'>>) => void;
  moveConstruct: (id: string, x: number, y: number) => void;
  removeConstructs: (ids: string[]) => void;
  assignIndicators: (id: string, names: string[]) => void;
  removeIndicator: (id: string, name: string) => void;
  addPath: (from: string, to: string) => boolean;
  removePaths: (ids: string[]) => void;
  deleteItems: (constructIds: string[], pathIds: string[], moderationIds?: string[], correlationIds?: string[]) => void;
  addModeration: (moderatorId: string, pathId: string) => boolean;
  addCorrelation: (kind: Correlation['kind'], a: string, b: string) => boolean;
  reversePath: (id: string) => void;
  layout: () => void;

  setSelection: (s: Selection) => void;
  select: (kind: 'construct' | 'path', id: string) => void;
  setSelectedVars: (v: string[]) => void;
  setTool: (t: Tool) => void;
  setSettings: (p: Partial<Settings>) => void;
  setData: (data: Dataset, info: DataInfo) => void;
  loadProject: (p: { name: string; model: ModelState; settings: Settings; data: Dataset | null; info: DataInfo | null; id?: string }) => void;
  setView: (v: View) => void;
  newProject: () => void;
  setProjectName: (name: string) => void;
  markSaved: () => void;

  setJob: (j: Job | null) => void;
  setResults: (r: Partial<Omit<Results, 'key'>>, key: string) => void;
  toast: (kind: Toast['kind'], text: string) => void;
  dismissToast: (id: number) => void;
  setShowResultsOnDiagram: (v: boolean) => void;
  setShowErrorTerms: (v: boolean) => void;
  setEstimateScale: (v: 'std' | 'unstd') => void;
  setResultsOpen: (v: boolean) => void;
}

const HISTORY = 100;

let lastReadOnlyToast = 0;
/** Viewers of shared projects cannot edit; tell them (at most every few seconds). */
function readOnly(s: State): boolean {
  if (s.cloud?.role !== 'viewer') return false;
  if (Date.now() - lastReadOnlyToast > 4000) {
    lastReadOnlyToast = Date.now();
    s.toast('info', 'You have view access to this shared project. Ask the owner for edit access to make changes.');
  }
  return true;
}
let toastId = 0;

export const emptyModel = (): ModelState => ({ constructs: [], paths: [], moderations: [] });

/** Fingerprint used to tell whether results still describe the current model. */
export function resultsKey(s: Pick<State, 'model' | 'settings' | 'dataVersion'>): string {
  // Inference options and the figure style do not change the estimates.
  const { bootSamples: _b, seed: _s, confidence: _c, figure: _f, ...plsSettings } = s.settings;
  // Correlations only enter CB-SEM, so drawing one does not make PLS results stale.
  const { covariances: _k, ...plsSpec } = toSpec(s.model);
  return JSON.stringify([s.settings.method === 'pls' ? plsSpec : toSpec(s.model), plsSettings, s.dataVersion]);
}

export const useStore = create<State>((set, get) => ({
  projectId: newId('proj'),
  cloud: null,
  history: null,
  historyCounts: { undo: 0, redo: 0 },
  view: 'home',
  projectName: 'Untitled model',
  model: emptyModel(),
  past: [],
  future: [],
  settings: DEFAULT_SETTINGS,
  data: null,
  dataInfo: null,
  dataVersion: 0,
  selection: NO_SELECTION,
  selectedVars: [],
  tool: 'select',
  results: null,
  job: null,
  toasts: [],
  dirty: false,
  showResultsOnDiagram: true,
  showErrorTerms: true,
  estimateScale: 'std',
  resultsOpen: false,
  fitRequest: 0,

  commit: (fn) => {
    if (readOnly(get())) return;
    set((s) => s.history
      ? { model: pruneCorrelations(fn(s.model)), dirty: true }
      : { model: pruneCorrelations(fn(s.model)), past: [...s.past.slice(-HISTORY + 1), s.model], future: [], dirty: true });
  },
  checkpoint: () => set((s) => ({ past: [...s.past.slice(-HISTORY + 1), s.model], future: [] })),
  undo: () => {
    if (get().history) { get().history!.undo(); return; }
    set((s) => {
      const prev = s.past.at(-1);
      if (!prev) return s;
      return { model: prev, past: s.past.slice(0, -1), future: [s.model, ...s.future], dirty: true, selection: NO_SELECTION };
    });
  },
  redo: () => {
    if (get().history) { get().history!.redo(); return; }
    set((s) => {
      const next = s.future[0];
      if (!next) return s;
      return { model: next, past: [...s.past, s.model], future: s.future.slice(1), dirty: true, selection: NO_SELECTION };
    });
  },

  addConstruct: (x, y, indicators = []) => {
    const id = newId('c');
    get().commit((m) => {
      const name = suggestName(indicators, m.constructs.map((c) => c.name), m.constructs.length + 1);
      const constructs = m.constructs.map((c) => ({ ...c, indicators: c.indicators.filter((i) => !indicators.includes(i)) }));
      return { ...m, constructs: [...constructs, { id, name, type: 'factor', mode: 'A', indicators, x, y, side: 'left' as Side }] };
    });
    set({ selection: { nodes: [id], edges: [] }, tool: 'select' });
    return id;
  },
  updateConstruct: (id, patch) =>
    get().commit((m) => ({ ...m, constructs: m.constructs.map((c) => (c.id === id ? { ...c, ...patch } : c)) })),
  moveConstruct: (id, x, y) =>
    readOnly(get()) ? undefined : set((s) => ({
      dirty: true,
      model: { ...s.model, constructs: s.model.constructs.map((c) => (c.id === id ? { ...c, x, y } : c)) },
    })),
  // Delegates to deleteItems so dangling paths and moderations go too.
  removeConstructs: (ids) => get().deleteItems(ids, []),
  assignIndicators: (id, names) =>
    get().commit((m) => ({
      ...m,
      constructs: m.constructs.map((c) =>
        c.id === id
          ? { ...c, indicators: [...c.indicators, ...names.filter((n) => !c.indicators.includes(n))] }
          : { ...c, indicators: c.indicators.filter((i) => !names.includes(i)) },
      ),
    })),
  removeIndicator: (id, name) =>
    get().commit((m) => ({
      ...m,
      constructs: m.constructs.map((c) => (c.id === id ? { ...c, indicators: c.indicators.filter((i) => i !== name) } : c)),
    })),
  addPath: (from, to) => {
    const { model, toast } = get();
    if (model.paths.some((p) => p.from === from && p.to === to)) return false;
    if (model.paths.some((p) => p.from === to && p.to === from)) {
      toast('error', 'A path already runs the other way. Use "Reverse" on it instead.');
      return false;
    }
    if (createsCycle(model.paths, from, to)) {
      toast('error', 'That path would create a cycle. PLS-SEM models must be recursive.');
      return false;
    }
    const id = newId('p');
    get().commit((m) => ({ ...m, paths: [...m.paths, { id, from, to }] }));
    return true;
  },
  removePaths: (ids) => get().deleteItems([], ids),
  deleteItems: (constructIds, pathIds, moderationIds = [], correlationIds = []) => {
    if (constructIds.length === 0 && pathIds.length === 0 && moderationIds.length === 0 && correlationIds.length === 0) return;
    get().commit((m) => {
      const paths = m.paths.filter((p) => !pathIds.includes(p.id) && !constructIds.includes(p.from) && !constructIds.includes(p.to));
      const keep = new Set(paths.map((p) => p.id));
      return {
        constructs: m.constructs.filter((c) => !constructIds.includes(c.id)).map((c) =>
          c.components?.some((x) => constructIds.includes(x)) ? { ...c, components: c.components.filter((x) => !constructIds.includes(x)) } : c),
        paths,
        moderations: m.moderations.filter((mo) => !moderationIds.includes(mo.id) && keep.has(mo.path) && !constructIds.includes(mo.moderator)),
        ...(m.correlations ? { correlations: m.correlations.filter((k) => !correlationIds.includes(k.id)) } : {}),
      };
    });
    set({ selection: NO_SELECTION });
  },
  addModeration: (moderatorId, pathId) => {
    const { model, toast } = get();
    const p = model.paths.find((q) => q.id === pathId);
    if (!p) return false;
    if (moderatorId === p.from || moderatorId === p.to) {
      toast('error', 'A construct cannot moderate a path it is part of.');
      return false;
    }
    if (model.moderations.some((mo) => mo.moderator === moderatorId && mo.path === pathId)) return false;
    const needsMain = !model.paths.some((q) => q.from === moderatorId && q.to === p.to);
    if (needsMain && createsCycle(model.paths, moderatorId, p.to)) {
      toast('error', 'This moderator lies downstream of the outcome; moderating would create a cycle.');
      return false;
    }
    const id = newId('m');
    get().commit((m) => ({
      ...m,
      // Moderation always needs the moderator's main effect on the outcome.
      paths: needsMain ? [...m.paths, { id: newId('p'), from: moderatorId, to: p.to }] : m.paths,
      moderations: [...m.moderations, { id, moderator: moderatorId, path: pathId }],
    }));
    if (needsMain) toast('info', 'Added the moderator’s direct path to the outcome, which moderation requires.');
    set({ selection: { nodes: [], edges: [], moderations: [id] } });
    return true;
  },
  addCorrelation: (kind, a, b) => {
    const { model, toast } = get();
    if (a === b) return false;
    if ((model.correlations ?? []).some((k) => k.kind === kind && ((k.a === a && k.b === b) || (k.a === b && k.b === a)))) {
      toast('info', 'These two are already correlated.');
      return false;
    }
    if (kind === 'construct') {
      const covariate = model.constructs.find((c) => (c.id === a || c.id === b) && c.covariate);
      if (covariate) { toast('error', `${covariate.name} is an observed covariate; its covariances are fixed at the sample values.`); return false; }
    } else {
      const single = model.constructs.find((c) => c.indicators.length === 1 && (c.indicators.includes(a) || c.indicators.includes(b)));
      if (single) { toast('error', `${single.name} has a single indicator, which has no measurement error to correlate.`); return false; }
    }
    const id = newId('k');
    get().commit((m) => ({ ...m, correlations: [...(m.correlations ?? []), { id, kind, a, b }] }));
    set({ selection: { nodes: [], edges: [], moderations: [], correlations: [id] } });
    return true;
  },
  reversePath: (id) => {
    const { model, toast } = get();
    const p = model.paths.find((q) => q.id === id);
    if (!p) return;
    const others = model.paths.filter((q) => q.id !== id);
    if (createsCycle(others, p.to, p.from)) {
      toast('error', 'Reversing this path would create a cycle.');
      return;
    }
    get().commit((m) => ({ ...m, paths: m.paths.map((q) => (q.id === id ? { ...q, from: q.to, to: q.from } : q)) }));
  },
  layout: () => {
    get().commit((m) => ({ ...m, constructs: autoLayout(m) }));
    set((s) => ({ fitRequest: s.fitRequest + 1 }));
  },

  setSelection: (selection) => set({ selection }),
  select: (kind, id) => set({ selection: kind === 'construct' ? { nodes: [id], edges: [] } : { nodes: [], edges: [id] } }),
  setSelectedVars: (selectedVars) => set({ selectedVars }),
  setTool: (tool) => set({ tool }),
  setSettings: (p) => { if (!readOnly(get())) set((s) => ({ settings: { ...s.settings, ...p }, dirty: true })); },
  setData: (data, dataInfo) => set((s) => ({ data, dataInfo, dataVersion: s.dataVersion + 1, dirty: true, selectedVars: [] })),
  setView: (view) => set({ view }),
  loadProject: ({ name, model, settings, data, info, id }) =>
    set((s) => ({
      projectId: id ?? newId('proj'), view: 'editor', cloud: null, history: null, historyCounts: { undo: 0, redo: 0 },
      projectName: name, model, settings, data, dataInfo: info, dataVersion: s.dataVersion + 1,
      past: [], future: [], selection: NO_SELECTION, selectedVars: [], results: null, dirty: false, resultsOpen: false,
      fitRequest: s.fitRequest + 1,
    })),
  newProject: () =>
    set((s) => ({
      projectId: newId('proj'), view: 'editor', cloud: null, history: null, historyCounts: { undo: 0, redo: 0 },
      projectName: 'Untitled model', model: emptyModel(), settings: DEFAULT_SETTINGS, data: null, dataInfo: null,
      dataVersion: s.dataVersion + 1, past: [], future: [], selection: NO_SELECTION, selectedVars: [], results: null,
      dirty: false, resultsOpen: false,
    })),
  setProjectName: (projectName) => { if (!readOnly(get())) set({ projectName: projectName.slice(0, 100), dirty: true }); },
  markSaved: () => set({ dirty: false }),

  setJob: (job) => set({ job }),
  setResults: (r, key) =>
    set((s) => {
      const base = s.results && s.results.key === key ? s.results : { pls: null, cb: null, miiv: null, boot: null, fitTest: null, key };
      return { results: { ...base, ...r, key }, resultsOpen: true, fitRequest: s.resultsOpen ? s.fitRequest : s.fitRequest + 1 };
    }),
  toast: (kind, text) => {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, text }] }));
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 7000 : 3500);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  setShowErrorTerms: (showErrorTerms) => set({ showErrorTerms }),
  setEstimateScale: (estimateScale) => set({ estimateScale }),
  setShowResultsOnDiagram: (showResultsOnDiagram) => set({ showResultsOnDiagram }),
  setResultsOpen: (resultsOpen) => set({ resultsOpen }),
}));

/** Results only when they match the current model; otherwise null. */
export function useFreshResults(): Results | null {
  return useStore((s) => (s.results && s.results.key === resultsKey(s) ? s.results : null));
}
