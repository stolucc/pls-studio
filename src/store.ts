import { create } from 'zustand';
import { factorName } from './model/efa';
import type { FitTestResult } from './engine/bootstrap';
import type { CbResult } from './engine/cbsem';
import type { MiivResult } from './engine/miiv';
import type { BootstrapResult, Dataset, PlsResult } from './engine/types';
import type { CpaResult } from './rengine/cpa';
import type { InvarianceResult } from './rengine/lavaan';
import { autoLayout, suggestName } from './model/layout';
import { graphToModel, isSlotName, templateModel, templatePositions } from './process/canvas';
import { processGraph } from './process/fromModel';
import { materialise, mediatorRange, template } from './process/templates';
import {
  createsCycle, DEFAULT_SETTINGS, newId, pruneCorrelations, pruneFixedLoadings, toSpec, unconfirmedUncorrelated,
  type Construct, type Correlation, type DataInfo, type DefinedParameter, type ModelState, type Settings, type Side, type WaldTest,
} from './model/project';

export type Tool = 'select' | 'construct' | 'connect' | 'correlate';
export interface Selection { nodes: string[]; edges: string[]; moderations?: string[]; correlations?: string[] }
export const NO_SELECTION: Selection = { nodes: [], edges: [], moderations: [], correlations: [] };

export interface Toast { id: number; kind: 'error' | 'info' | 'success'; text: string }

/** A warning or error kept for the session (Messages tab): package warnings, failed runs, refused actions. */
export interface Message { id: number; at: number; level: 'error' | 'warning'; text: string; source?: string }
const MAX_MESSAGES = 300;

export interface Results {
  pls: PlsResult | null;
  cb: CbResult | null;
  miiv: MiivResult | null;
  /** Bootstrap for whichever method the key describes. */
  boot: BootstrapResult | null;
  fitTest: FitTestResult | null;
  /** Conditional process analysis (estimates and bootstrap in one run). */
  process?: CpaResult | null;
  /** CB-SEM measurement invariance across groups (lavaan). */
  invariance?: InvarianceResult | null;
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
  /**
   * Set while the open project is an example: changes are allowed but never
   * kept (not autosaved), so reopening it gives the original.
   */
  example: string | null;
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
  messages: Message[];
  dirty: boolean;
  showResultsOnDiagram: boolean;
  /** CB-SEM diagrams: draw error terms (ε) and disturbances (ζ). */
  showErrorTerms: boolean;
  /** Show the moderators' implied main effects (estimated, not drawn) as dashed arrows. */
  showImpliedEffects: boolean;
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
  /** Factors from an exploratory factor analysis, as common factors (one undo step); `correlate`: draw their correlations. */
  addFactors: (groups: string[][], correlate: boolean, names?: string[]) => string[];
  updateConstruct: (id: string, patch: Partial<Pick<Construct, 'name' | 'type' | 'mode' | 'side' | 'covariate' | 'components' | 'latent' | 'categorical'>>) => void;
  /** CB-SEM: label a path coefficient, loading or drawn covariance (null removes it); equal labels = equal values. */
  setLabel: (target: { kind: 'path'; id: string } | { kind: 'loading'; construct: string; indicator: string } | { kind: 'correlation'; id: string }, label: string | null) => void;
  setDefined: (defined: DefinedParameter[]) => void;
  setWaldTests: (tests: WaldTest[]) => void;
  /** Multiple-group CB-SEM results: show group `index` (diagram and tables). */
  showGroup: (index: number) => void;
  /** CB-SEM: exploratory SEM blocks and rotation (null removes them all). */
  setEsem: (esem: ModelState['esem'] | null) => void;
  /** CB-SEM: set or clear the two-level model. */
  setMultilevel: (ml: ModelState['multilevel'] | null) => void;
  /** CB-SEM: set or clear the multiple-group analysis. */
  setMultigroup: (mg: ModelState['multigroup'] | null) => void;
  /** CB-SEM: treat these indicators as ordered categorical (WLSMV), or as continuous again. */
  setOrdered: (names: string[], ordinal: boolean) => void;
  /** CB-SEM: hold a path coefficient, loading or drawn covariance at `value`, or free it (null). */
  fixParameter: (target: { kind: 'path'; id: string } | { kind: 'loading'; construct: string; indicator: string } | { kind: 'correlation'; id: string }, value: number | null) => void;
  moveConstruct: (id: string, x: number, y: number) => void;
  removeConstructs: (ids: string[]) => void;
  assignIndicators: (id: string, names: string[]) => void;
  removeIndicator: (id: string, name: string) => void;
  addPath: (from: string, to: string) => boolean;
  removePaths: (ids: string[]) => void;
  deleteItems: (constructIds: string[], pathIds: string[], moderationIds?: string[], correlationIds?: string[]) => void;
  addModeration: (moderatorId: string, pathId: string) => boolean;
  /** Moderated moderation (conditional process analysis): `moderatorId` moderates the moderation `moderationId`. */
  addThreeWay: (moderatorId: string, moderationId: string) => boolean;
  /** Quadratic effect of a path's predictor (X² → Y). */
  addQuadratic: (pathId: string) => boolean;
  /** `zero`: fix two exogenous constructs as uncorrelated instead of adding a free covariance. */
  addCorrelation: (kind: Correlation['kind'], a: string, b: string, zero?: boolean) => boolean;
  /** Exogenous constructs without a drawn correlation: draw them all (`correlate`), or confirm them as uncorrelated. */
  resolveExogenousCorrelations: (correlate: boolean) => void;
  reversePath: (id: string) => void;
  /** Replace the model by PROCESS model `model` with `k` mediators (empty slots; covariates kept). */
  applyTemplate: (model: number, k: number) => boolean;
  /** Change the number of mediators of the recognised PROCESS model, keeping its variables. */
  setMediatorCount: (k: number) => boolean;
  layout: () => void;

  setSelection: (s: Selection) => void;
  select: (kind: 'construct' | 'path', id: string) => void;
  setSelectedVars: (v: string[]) => void;
  setTool: (t: Tool) => void;
  setSettings: (p: Partial<Settings>) => void;
  setData: (data: Dataset, info: DataInfo) => void;
  loadProject: (p: { name: string; model: ModelState; settings: Settings; data: Dataset | null; info: DataInfo | null; id?: string; example?: string }) => void;
  /** Turn the open example into an ordinary project of one's own (kept from now on). */
  keepExample: () => void;
  setView: (v: View) => void;
  newProject: () => void;
  setProjectName: (name: string) => void;
  markSaved: () => void;

  setJob: (j: Job | null) => void;
  setResults: (r: Partial<Omit<Results, 'key'>>, key: string) => void;
  /** Errors are also kept in Messages, unless `log` is false (the message is logged elsewhere). */
  toast: (kind: Toast['kind'], text: string, opts?: { log?: boolean }) => void;
  logMessage: (level: Message['level'], text: string, source?: string) => void;
  clearMessages: () => void;
  dismissToast: (id: number) => void;
  setShowResultsOnDiagram: (v: boolean) => void;
  setShowErrorTerms: (v: boolean) => void;
  setShowImpliedEffects: (v: boolean) => void;
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
let messageId = 0;

/** Every warning a new result carries (R packages or the built-in engine), added to the session's messages. */
function withWarnings(messages: Message[], r: Partial<Omit<Results, 'key'>>): Message[] {
  const added: Message[] = [];
  for (const v of Object.values(r)) {
    const res = v as { warnings?: unknown; engine?: { package?: string; version?: string } } | null;
    if (!res || res.warnings == null) continue;
    const list = Array.isArray(res.warnings) ? res.warnings : [res.warnings];
    const source = res.engine?.package ? `${res.engine.package}${res.engine.version ? ` ${res.engine.version}` : ''}` : 'built-in engine';
    for (const w of list) if (typeof w === 'string' && w.trim()) added.push({ id: ++messageId, at: Date.now(), level: 'warning', text: w, source });
  }
  return added.length ? [...messages, ...added].slice(-MAX_MESSAGES) : messages;
}

export const emptyModel = (): ModelState => ({ constructs: [], paths: [], moderations: [] });

/** Fingerprint used to tell whether results still describe the current model. */
export function resultsKey(s: Pick<State, 'model' | 'settings' | 'dataVersion'>): string {
  // Inference options and the figure style do not change the estimates.
  const { bootSamples: _b, seed: _s, confidence: _c, figure: _f, charts: _h, ...plsSettings } = s.settings;
  // Conditional process analysis bootstraps as part of estimation; it also depends on
  // moderated moderations and covariate flags, and nothing in it reads correlations.
  if (s.settings.method === 'process') {
    const { figure: _g, charts: _i, ...settings } = s.settings;
    const { covariances: _k, ...spec } = toSpec(s.model);
    const three = (s.model.threeWay ?? []).map((t) => [t.moderation, t.moderator]);
    return JSON.stringify([spec, three, settings, s.dataVersion]);
  }
  // Correlations only enter CB-SEM, so drawing one does not make PLS results stale.
  const { covariances: _k, ...plsSpec } = toSpec(s.model);
  return JSON.stringify([s.settings.method === 'pls' ? plsSpec : toSpec(s.model), plsSettings, s.dataVersion]);
}

export const useStore = create<State>((set, get) => ({
  projectId: newId('proj'),
  cloud: null,
  example: null,
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
  messages: [],
  dirty: false,
  showResultsOnDiagram: true,
  showErrorTerms: true,
  showImpliedEffects: true,
  estimateScale: 'std',
  resultsOpen: false,
  fitRequest: 0,

  commit: (fn) => {
    if (readOnly(get())) return;
    set((s) => s.history
      ? { model: pruneCorrelations(pruneFixedLoadings(fn(s.model))), dirty: true }
      : { model: pruneCorrelations(pruneFixedLoadings(fn(s.model))), past: [...s.past.slice(-HISTORY + 1), s.model], future: [], dirty: true });
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
  addFactors: (groups, correlate, names) => {
    const ids = groups.map(() => newId('c'));
    get().commit((m) => {
      const all = groups.flat();
      let constructs = m.constructs.map((c) => ({ ...c, indicators: c.indicators.filter((i) => !all.includes(i)) }));
      const top = constructs.length ? Math.max(...constructs.map((c) => c.y)) + 300 : 0;
      groups.forEach((indicators, k) => {
        const taken = constructs.map((c) => c.name);
        const name = names?.[k] ? factorName(indicators, names[k], taken) : suggestName(indicators, taken, constructs.length + 1);
        constructs = [...constructs, { id: ids[k], name, type: 'factor', mode: 'A', indicators, x: (k % 4) * 320, y: top + Math.floor(k / 4) * 260, side: 'left' as Side }];
      });
      const pairs = correlate ? ids.flatMap((a, i) => ids.slice(i + 1).map((b) => ({ id: newId('k'), kind: 'construct' as const, a, b }))) : [];
      return { ...m, constructs, correlations: [...(m.correlations ?? []), ...pairs] };
    });
    set({ selection: { nodes: ids, edges: [] }, tool: 'select' });
    return ids;
  },
  updateConstruct: (id, patch) =>
    get().commit((m) => ({ ...m, constructs: m.constructs.map((c) => (c.id === id ? { ...c, ...patch } : c)) })),
  setLabel: (target, label) => get().commit((m) => {
    const set = <T extends { label?: string }>(x: T): T => { const { label: _l, ...rest } = x; return (label ? { ...rest, label } : rest) as T; };
    if (target.kind === 'path') return { ...m, paths: m.paths.map((p) => (p.id === target.id ? set(p) : p)) };
    if (target.kind === 'correlation') return { ...m, correlations: (m.correlations ?? []).map((k) => (k.id === target.id ? set(k) : k)) };
    return {
      ...m,
      constructs: m.constructs.map((c) => {
        if (c.id !== target.construct) return c;
        const { [target.indicator]: _old, ...rest } = c.loadingLabels ?? {};
        const loadingLabels = label ? { ...rest, [target.indicator]: label } : rest;
        const { loadingLabels: _x, ...base } = c;
        return Object.keys(loadingLabels).length ? { ...base, loadingLabels } : base;
      }),
    };
  }),
  setDefined: (defined) => get().commit((m) => { const { defined: _d, ...rest } = m; return defined.length ? { ...rest, defined } : rest; }),
  setWaldTests: (tests) => get().commit((m) => { const { waldTests: _w, ...rest } = m; return tests.length ? { ...rest, waldTests: tests } : rest; }),
  showGroup: (index) => set((s) => {
    const cb = s.results?.cb;
    const g = cb?.groups;
    if (!s.results || !cb || !g || !g.results[index]) return s;
    // The bootstrap follows: each group's (or level's) statistics.
    const boot = s.results.boot?.byBlock?.[index] ? { ...s.results.boot, stats: s.results.boot.byBlock[index] } : s.results.boot;
    return { results: { ...s.results, boot, cb: { ...g.results[index], groups: g, groupIndex: index, modindices: cb.modindices, wald: cb.wald } } };
  }),
  setEsem: (esem) => get().commit((m) => {
    const { esem: _e, ...rest } = m;
    const blocks = esem?.blocks.filter((b) => b.constructs.length >= 2) ?? [];
    return esem && blocks.length ? { ...rest, esem: { ...esem, blocks } } : rest;
  }),
  setMultilevel: (ml) => get().commit((m) => { const { multilevel: _l, ...rest } = m; return ml ? { ...rest, multilevel: ml } : rest; }),
  setMultigroup: (mg) => get().commit((m) => { const { multigroup: _g, ...rest } = m; return mg ? { ...rest, multigroup: mg } : rest; }),
  setOrdered: (names, ordinal) => get().commit((m) => {
    const now = new Set(m.ordered ?? []);
    for (const n of names) { if (ordinal) now.add(n); else now.delete(n); }
    const { ordered: _o, ...rest } = m;
    return now.size ? { ...rest, ordered: [...now] } : rest;
  }),
  fixParameter: (target, value) => get().commit((m) => {
    const set = <T extends { fixed?: number }>(x: T): T => { const { fixed: _f, ...rest } = x; return (value === null ? rest : { ...rest, fixed: value }) as T; };
    if (target.kind === 'path') return { ...m, paths: m.paths.map((p) => (p.id === target.id ? set(p) : p)) };
    if (target.kind === 'correlation') return { ...m, correlations: (m.correlations ?? []).map((k) => (k.id === target.id ? set(k) : k)) };
    return {
      ...m,
      constructs: m.constructs.map((c) => {
        if (c.id !== target.construct) return c;
        const { [target.indicator]: _old, ...rest } = c.fixedLoadings ?? {};
        const fixedLoadings = value === null ? rest : { ...rest, [target.indicator]: value };
        const { fixedLoadings: _x, ...base } = c;
        return Object.keys(fixedLoadings).length ? { ...base, fixedLoadings } : base;
      }),
    };
  }),
  moveConstruct: (id, x, y) =>
    readOnly(get()) ? undefined : set((s) => ({
      dirty: true,
      model: { ...s.model, constructs: s.model.constructs.map((c) => (c.id === id ? { ...c, x, y } : c)) },
    })),
  // Delegates to deleteItems so dangling paths and moderations go too.
  removeConstructs: (ids) => get().deleteItems(ids, []),
  assignIndicators: (id, names) =>
    get().commit((m) => {
      // Conditional process slots (X, M1, W, …) take the name of the single variable dropped on them.
      const slot = m.constructs.find((c) => c.id === id);
      const rename = get().settings.method === 'process' && slot && slot.indicators.length === 0 && isSlotName(slot.name)
        && names.length === 1 && !m.constructs.some((c) => c.name === names[0]);
      return {
        ...m,
        constructs: m.constructs.map((c) =>
          c.id === id
            ? { ...c, ...(rename ? { name: names[0] } : {}), indicators: [...c.indicators, ...names.filter((n) => !c.indicators.includes(n))] }
            : { ...c, indicators: c.indicators.filter((i) => !names.includes(i)) },
        ),
      };
    }),
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
      const moderations = m.moderations.filter((mo) => !moderationIds.includes(mo.id) && keep.has(mo.path) && !constructIds.includes(mo.moderator));
      const keptMods = new Set(moderations.map((mo) => mo.id));
      return {
        constructs: m.constructs.filter((c) => !constructIds.includes(c.id)).map((c) =>
          c.components?.some((x) => constructIds.includes(x)) ? { ...c, components: c.components.filter((x) => !constructIds.includes(x)) } : c),
        paths,
        moderations,
        ...(m.correlations ? { correlations: m.correlations.filter((k) => !correlationIds.includes(k.id)) } : {}),
        ...(m.threeWay ? { threeWay: m.threeWay.filter((t) => !moderationIds.includes(t.id) && keptMods.has(t.moderation) && !constructIds.includes(t.moderator)) } : {}),
      };
    });
    set({ selection: NO_SELECTION });
  },
  addQuadratic: (pathId) => {
    const p = get().model.paths.find((q) => q.id === pathId);
    return p ? get().addModeration(p.from, pathId) : false;
  },
  addModeration: (moderatorId, pathId) => {
    const { model, toast } = get();
    const p = model.paths.find((q) => q.id === pathId);
    if (!p) return false;
    // The predictor "moderating" its own path is its quadratic effect (X²).
    if (moderatorId === p.to) {
      toast('error', 'The outcome of a path cannot moderate it.');
      return false;
    }
    if (model.moderations.some((mo) => mo.moderator === moderatorId && mo.path === pathId)) return false;
    // The moderation implies the moderator's main effect on the outcome (as in PROCESS): it is
    // estimated without being drawn (toSpec), so it must not close a cycle.
    const drawn = model.paths.some((q) => q.from === moderatorId && q.to === p.to);
    if (!drawn && createsCycle(model.paths, moderatorId, p.to)) {
      toast('error', 'This moderator lies downstream of the outcome; moderating would create a cycle.');
      return false;
    }
    const id = newId('m');
    get().commit((m) => ({ ...m, moderations: [...m.moderations, { id, moderator: moderatorId, path: pathId }] }));
    set({ selection: { nodes: [], edges: [], moderations: [id] } });
    return true;
  },
  addThreeWay: (moderatorId, moderationId) => {
    const { model, toast } = get();
    const mo = model.moderations.find((x) => x.id === moderationId);
    const p = mo && model.paths.find((q) => q.id === mo.path);
    if (!mo || !p) return false;
    if ([p.from, p.to, mo.moderator].includes(moderatorId)) {
      toast('error', 'A moderated moderation needs a third variable: not the predictor, outcome or first moderator.');
      return false;
    }
    if ((model.threeWay ?? []).some((t) => t.moderation === moderationId)) {
      toast('error', 'This moderation is already moderated; PROCESS models have at most a three-way interaction.');
      return false;
    }
    const id = newId('t');
    get().commit((m) => ({ ...m, threeWay: [...(m.threeWay ?? []), { id, moderation: moderationId, moderator: moderatorId }] }));
    set({ selection: { nodes: [], edges: [], moderations: [id] } });
    return true;
  },
  addCorrelation: (kind, a, b, zero = false) => {
    const { model, toast } = get();
    if (a === b) return false;
    // Drawing a correlation between two constructs fixed at zero replaces the zero: now estimated.
    const fixed = !zero && (model.correlations ?? []).find((k) => k.zero && k.kind === kind && ((k.a === a && k.b === b) || (k.a === b && k.b === a)));
    if (fixed) {
      const id = newId('k');
      get().commit((m) => ({ ...m, correlations: [...(m.correlations ?? []).filter((k) => k.id !== fixed.id), { id, kind, a, b }] }));
      set({ selection: { nodes: [], edges: [], moderations: [], correlations: [id] } });
      const name = (id: string) => model.constructs.find((c) => c.id === id)?.name ?? id;
      toast('info', `${name(a)} and ${name(b)} are correlated now (no longer fixed at zero).`);
      return true;
    }
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
    get().commit((m) => ({ ...m, correlations: [...(m.correlations ?? []), { id, kind, a, b, ...(zero ? { zero: true } : {}) }] }));
    set({ selection: { nodes: [], edges: [], moderations: [], correlations: [id] } });
    return true;
  },
  resolveExogenousCorrelations: (correlate) => {
    const pairs = unconfirmedUncorrelated(get().model);
    if (!pairs.length) return;
    get().commit((m) => ({ ...m, correlations: [...(m.correlations ?? []), ...pairs.map(([a, b]) => ({ id: newId('k'), kind: 'construct' as const, a: a.id, b: b.id, ...(correlate ? {} : { zero: true }) }))] }));
    get().toast('info', correlate
      ? `Drew ${pairs.length} correlation${pairs.length > 1 ? 's' : ''} between exogenous constructs.`
      : `Kept ${pairs.length} pair${pairs.length > 1 ? 's' : ''} of exogenous constructs uncorrelated (fixed at zero; right-click a construct pair’s correlation to change it).`);
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
  applyTemplate: (number, k) => {
    const tp = template(number);
    if (!tp) return false;
    get().commit((m) => templateModel(tp, k, m));
    set((s) => ({ selection: NO_SELECTION, fitRequest: s.fitRequest + 1 }));
    return true;
  },
  setMediatorCount: (k) => {
    const { model, toast } = get();
    const found = processGraph(model).recognised;
    const tp = found && template(found.model);
    if (!found || !tp) return false;
    const [lo, hi] = mediatorRange(tp);
    if (k < lo || k > hi) {
      toast('error', `PROCESS model ${tp.model} takes ${lo === hi ? lo : `${lo} to ${hi}`} mediators.`);
      return false;
    }
    const taken = new Set(model.constructs.map((c) => c.name));
    const m = found.roles.m.slice(0, k);
    for (let i = 1; m.length < k; i++) if (!taken.has(`M${i}`) && !m.includes(`M${i}`)) m.push(`M${i}`);
    const roles = { ...found.roles, m };
    get().commit((prev) => graphToModel(materialise(tp, roles), prev, templatePositions(tp, roles)));
    set((s) => ({ selection: NO_SELECTION, fitRequest: s.fitRequest + 1 }));
    return true;
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
  loadProject: ({ name, model, settings, data, info, id, example }) =>
    set((s) => ({
      projectId: id ?? newId('proj'), view: 'editor', cloud: null, example: example ?? null, history: null, historyCounts: { undo: 0, redo: 0 },
      projectName: name, model, settings, data, dataInfo: info, dataVersion: s.dataVersion + 1,
      past: [], future: [], selection: NO_SELECTION, selectedVars: [], results: null, dirty: false, resultsOpen: false,
      fitRequest: s.fitRequest + 1, messages: [],
    })),
  newProject: () =>
    set((s) => ({
      projectId: newId('proj'), view: 'editor', cloud: null, example: null, history: null, historyCounts: { undo: 0, redo: 0 },
      projectName: 'Untitled model', model: emptyModel(), settings: DEFAULT_SETTINGS, data: null, dataInfo: null,
      dataVersion: s.dataVersion + 1, past: [], future: [], selection: NO_SELECTION, selectedVars: [], results: null,
      dirty: false, resultsOpen: false, messages: [],
    })),
  setProjectName: (projectName) => { if (!readOnly(get())) set({ projectName: projectName.slice(0, 100), dirty: true }); },
  markSaved: () => set({ dirty: false }),
  keepExample: () => set((s) => (s.example ? { example: null, projectId: newId('proj'), projectName: s.projectName.replace(/^Example: /, ''), dirty: true } : {})),

  setJob: (job) => set({ job }),
  setResults: (r, key) =>
    set((s) => {
      const base = s.results && s.results.key === key ? s.results : { pls: null, cb: null, miiv: null, boot: null, fitTest: null, process: null, key };
      return { results: { ...base, ...r, key }, resultsOpen: true, fitRequest: s.resultsOpen ? s.fitRequest : s.fitRequest + 1, messages: withWarnings(s.messages, r) };
    }),
  toast: (kind, text, opts) => {
    if (kind === 'error' && opts?.log !== false) get().logMessage('error', text);
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, text }] }));
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 7000 : 3500);
  },
  logMessage: (level, text, source) => set((s) => ({ messages: [...s.messages, { id: ++messageId, at: Date.now(), level, text, ...(source ? { source } : {}) }].slice(-MAX_MESSAGES) })),
  clearMessages: () => set({ messages: [] }),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  setShowErrorTerms: (showErrorTerms) => set({ showErrorTerms }),
  setShowImpliedEffects: (showImpliedEffects) => set({ showImpliedEffects }),
  setEstimateScale: (estimateScale) => set({ estimateScale }),
  setShowResultsOnDiagram: (showResultsOnDiagram) => set({ showResultsOnDiagram }),
  setResultsOpen: (resultsOpen) => set({ resultsOpen }),
}));

/** Results only when they match the current model; otherwise null. */
export function useFreshResults(): Results | null {
  return useStore((s) => (s.results && s.results.key === resultsKey(s) ? s.results : null));
}
