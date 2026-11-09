// Live co-editing of a shared project: the model lives in a Y.js document
// synchronised through the PLS Studio server (y-websocket protocol).
//
// Document layout:
//   constructs:  Y.Map<id, Y.Map<field, value>>   (one map per construct, so
//                concurrent edits to different fields or constructs merge)
//   paths, moderations, correlations: Y.Map<id, plain object>
//   model:       every other model field (multigroup, ESEM, ordinal indicators,
//                defined parameters, Wald tests, weights, inequalities, …), one
//                key per field with a plain value, so new fields sync without
//                changes here
//   meta:        name, settings, simulation       (undoable)
//   analyses:    Y.Map<card id, card>, plus key 'order' (card ids): the
//                Analyses tab, without results (not undoable; each computer
//                keeps its own results, as the document is not encrypted at rest)
//   sys:         dataRevision                     (not undoable)
//
// Local edits are written as minimal diffs with origin LOCAL; Y.UndoManager
// tracks only LOCAL, so undo never reverts a collaborator's work. Everything
// read from the document passes the same validation as an untrusted project file.

import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';
import { create } from 'zustand';
import type { McDesign } from '../engine/montecarlo';
import { DEFAULT_SETTINGS, FORMAT_VERSION, parseDataSection, parseProject, serializeDataSection, type ModelState, type Settings } from '../model/project';
import { parseCards, shareableCards, withLegacySimulation } from '../analyses/persist';
import { loadCards, useAnalyses } from '../analyses/store';
import type { Card } from '../analyses/types';
import { useStore } from '../store';
import { api } from './api';

export const LOCAL = 'pls-local';

const PALETTE = ['#e11d48', '#0891b2', '#16a34a', '#d97706', '#7c3aed', '#db2777', '#2563eb', '#65a30d'];
export const colorFor = (id: string) => PALETTE[[...id].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % PALETTE.length];

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ---------- model ⇄ document ----------

export function writeDoc(doc: Y.Doc, model: ModelState, settings: Settings, name: string, simulation: McDesign | null) {
  doc.transact(() => {
    const cs = doc.getMap<Y.Map<unknown>>('constructs');
    const ids = new Set(model.constructs.map((c) => c.id));
    for (const k of [...cs.keys()]) if (!ids.has(k)) cs.delete(k);
    let nextOrder = Math.max(0, ...[...cs.values()].map((m) => (m.get('o') as number) ?? 0)) + 1;
    for (const c of model.constructs) {
      let m = cs.get(c.id);
      if (!m) {
        m = new Y.Map();
        cs.set(c.id, m);
        m.set('o', nextOrder++);
      }
      const { id: _id, ...fields } = c;
      for (const [k, v] of Object.entries(fields)) if (v !== undefined && !same(m.get(k), v)) m.set(k, v);
      for (const k of [...m.keys()]) if (k !== 'o' && (fields as Record<string, unknown>)[k] === undefined) m.delete(k);
    }
    const syncFlat = (map: Y.Map<unknown>, items: { id: string }[]) => {
      const keep = new Set(items.map((i) => i.id));
      for (const k of [...map.keys()]) if (!keep.has(k)) map.delete(k);
      for (const { id, ...rest } of items) if (!same(map.get(id), rest)) map.set(id, rest);
    };
    syncFlat(doc.getMap('paths'), model.paths);
    syncFlat(doc.getMap('moderations'), model.moderations);
    syncFlat(doc.getMap('correlations'), model.correlations ?? []);
    const { constructs: _c, paths: _p, moderations: _m, correlations: _k, ...rest } = model;
    const extra = doc.getMap('model');
    for (const k of [...extra.keys()]) if ((rest as Record<string, unknown>)[k] === undefined) extra.delete(k);
    for (const [k, v] of Object.entries(rest)) if (v !== undefined && !same(extra.get(k), v)) extra.set(k, v);
    const meta = doc.getMap('meta');
    if (meta.get('name') !== name) meta.set('name', name);
    if (!same(meta.get('settings'), settings)) meta.set('settings', settings);
    if (!same(meta.get('simulation') ?? null, simulation)) meta.set('simulation', simulation);
    if (meta.get('format') !== FORMAT_VERSION) meta.set('format', FORMAT_VERSION);
  }, LOCAL);
}

/** Read and validate the shared state (as an untrusted project file). */
export function readDoc(doc: Y.Doc): { model: ModelState; settings: Settings; name: string; simulation: McDesign | null } {
  const cs = doc.getMap<Y.Map<unknown>>('constructs');
  const constructs = [...cs.entries()]
    .map(([id, m]) => ({ ...(m.toJSON() as Record<string, unknown>), id }) as Record<string, unknown> & { id: string })
    .sort((a, b) => (Number(a.o) || 0) - (Number(b.o) || 0))
    .map(({ o: _o, ...c }) => c);
  const flat = (map: Y.Map<unknown>) => [...map.entries()].map(([id, v]) => ({ ...(v as object), id }) as Record<string, unknown> & { id: string });
  const meta = doc.getMap('meta');
  // Concurrent edits can leave dangling references (a path drawn to a construct
  // someone else deleted at the same time): drop them rather than reject the state.
  const ids = new Set(constructs.map((c) => c.id));
  const paths = flat(doc.getMap('paths')).filter((p) => ids.has(p.from as string) && ids.has(p.to as string));
  const pathIds = new Set(paths.map((p) => p.id));
  const moderations = flat(doc.getMap('moderations')).filter((m) => ids.has(m.moderator as string) && pathIds.has(m.path as string));
  const indicators = new Set(constructs.flatMap((c) => (Array.isArray(c.indicators) ? c.indicators as unknown[] : [])));
  const correlations = flat(doc.getMap('correlations'))
    .filter((k) => k.a !== k.b && (k.kind === 'construct' ? ids.has(k.a as string) && ids.has(k.b as string) : indicators.has(k.a) && indicators.has(k.b)));
  // Moderated moderations whose moderation or moderator someone else removed.
  const extra = doc.getMap('model').toJSON() as Record<string, unknown>;
  const modIds = new Set(moderations.map((m) => m.id));
  if (Array.isArray(extra.threeWay)) {
    extra.threeWay = (extra.threeWay as unknown[]).filter((t) => !!t && typeof t === 'object' && modIds.has((t as Record<string, unknown>).moderation as string) && ids.has((t as Record<string, unknown>).moderator as string));
  }
  for (const c of constructs) {
    if (Array.isArray(c.components)) c.components = (c.components as unknown[]).filter((x) => typeof x === 'string' && ids.has(x) && x !== c.id);
  }
  const file = {
    // (shared projects from before format 2 are migrated once, then written back as format 2)
    format: 'pls-studio', version: meta.get('format') === FORMAT_VERSION ? FORMAT_VERSION : 1,
    // (a path someone else removed takes its Gaussian copula along)
    model: { ...extra, ...(Array.isArray(extra.copulas) ? { copulas: extra.copulas.filter((k: { path: string }) => pathIds.has(k.path)) } : {}), constructs, paths, moderations, correlations },
    settings: meta.get('settings') ?? DEFAULT_SETTINGS,
    data: null,
    simulation: meta.get('simulation') ?? null,
  };
  const p = parseProject(JSON.stringify(file));
  const name = typeof meta.get('name') === 'string' ? (meta.get('name') as string).slice(0, 100) : 'Shared project';
  return { model: p.model, settings: p.settings, name, simulation: p.simulation };
}

/** Write the analysis log (without results) as minimal changes. */
export function writeCards(doc: Y.Doc, cards: Card[]) {
  doc.transact(() => {
    const map = doc.getMap<unknown>('analyses');
    const shared = shareableCards(cards);
    const ids = new Set(shared.map((c) => c.id));
    for (const k of [...map.keys()]) if (k !== 'order' && !ids.has(k)) map.delete(k);
    for (const c of shared) if (!same(map.get(c.id), c)) map.set(c.id, c);
    const order = shared.map((c) => c.id);
    if (!same(map.get('order'), order)) map.set('order', order);
  }, LOCAL);
}

/** Read and validate the shared analysis log. Cards missing from the order (concurrent adds) go last. */
export function readCards(doc: Y.Doc): Card[] {
  const map = doc.getMap<unknown>('analyses');
  const order = Array.isArray(map.get('order')) ? (map.get('order') as unknown[]).filter((x): x is string => typeof x === 'string') : [];
  const ids = [...new Set([...order.filter((id) => map.has(id)), ...[...map.keys()].filter((k) => k !== 'order' && !order.includes(k))])];
  return parseCards(ids.map((id) => map.get(id)));
}

// ---------- presence ----------

export interface Peer { clientId: number; userId: string; name: string; color: string; cursor: { x: number; y: number } | null; selection: string[] }

export const usePresence = create<{ peers: Peer[] }>(() => ({ peers: [] }));

// ---------- session ----------

export class CollabSession {
  readonly doc = new Y.Doc();
  readonly provider: WebsocketProvider;
  readonly projectId: string;
  private undo: Y.UndoManager;
  private applying = false;
  private fetchingData = false;
  private initialised = false;
  private unsubs: (() => void)[] = [];
  private lastCursor = 0;

  constructor(projectId: string, user: { id: string; display_name: string }, opts: { seed: boolean }) {
    this.projectId = projectId;
    const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/projects`;
    this.provider = new WebsocketProvider(wsUrl, projectId, this.doc, { disableBc: true });
    this.provider.awareness.setLocalStateField('user', { id: user.id, name: user.display_name, color: colorFor(user.id) });

    this.provider.on('status', ({ status }: { status: string }) => {
      const st = useStore.getState();
      if (st.cloud?.projectId === projectId) {
        useStore.setState({ cloud: { ...st.cloud, status: status === 'connected' ? 'online' : status === 'connecting' ? 'connecting' : 'offline' } });
      }
    });
    this.provider.on('sync', (synced: boolean) => {
      if (!synced || this.initialised) return;
      this.initialised = true;
      if (opts.seed && this.doc.getMap('constructs').size === 0) { this.push(); writeCards(this.doc, useAnalyses.getState().cards); }
      else this.pull();
      void this.fetchData();
    });
    // Close codes 4403 (access removed): leave the project.
    this.provider.on('connection-close', (ev: CloseEvent | null) => {
      if (ev?.code === 4403) {
        useStore.getState().toast('error', 'Your access to this shared project was removed.');
        closeSession();
        useStore.getState().setView('home');
      }
    });

    this.doc.on('update', (_u: Uint8Array, origin: unknown) => {
      if (origin !== LOCAL && this.initialised) this.pull();
    });
    const sys = this.doc.getMap('sys');
    sys.observe((ev) => {
      if (ev.transaction.origin !== LOCAL && ev.keysChanged.has('dataRevision')) void this.fetchData();
    });

    this.undo = new Y.UndoManager(
      [this.doc.getMap('constructs'), this.doc.getMap('paths'), this.doc.getMap('moderations'), this.doc.getMap('correlations'), this.doc.getMap('model'), this.doc.getMap('meta')],
      { trackedOrigins: new Set([LOCAL]), captureTimeout: 400 },
    );
    const counts = () => useStore.setState({ historyCounts: { undo: this.undo.undoStack.length, redo: this.undo.redoStack.length } });
    this.undo.on('stack-item-added', counts);
    this.undo.on('stack-item-popped', counts);
    useStore.setState({ history: { undo: () => this.undo.undo(), redo: () => this.undo.redo() } });

    // Local store changes → document.
    this.unsubs.push(useStore.subscribe((s, prev) => {
      if (this.applying || !this.initialised || s.cloud?.projectId !== projectId) return;
      if (s.model !== prev.model || s.settings !== prev.settings || s.projectName !== prev.projectName) this.push();
      if (s.data !== prev.data && !this.fetchingData && s.data && s.dataInfo && s.cloud.role !== 'viewer') void this.uploadData();
      if (s.selection !== prev.selection) this.provider.awareness.setLocalStateField('selection', s.selection.nodes);
    }));
    this.unsubs.push(useAnalyses.subscribe((s, prev) => {
      if (!this.applying && this.initialised && s.cards !== prev.cards && useStore.getState().cloud?.role !== 'viewer') writeCards(this.doc, s.cards);
    }));

    const onAwareness = () => {
      const peers: Peer[] = [];
      for (const [clientId, st] of this.provider.awareness.getStates()) {
        if (clientId === this.doc.clientID || !st.user) continue;
        peers.push({ clientId, userId: st.user.id, name: String(st.user.name).slice(0, 80), color: st.user.color, cursor: st.cursor ?? null, selection: Array.isArray(st.selection) ? st.selection : [] });
      }
      usePresence.setState({ peers });
    };
    this.provider.awareness.on('change', onAwareness);
  }

  private push() {
    const s = useStore.getState();
    writeDoc(this.doc, s.model, s.settings, s.projectName, null);
  }

  private pull() {
    let next;
    try {
      next = readDoc(this.doc);
    } catch (err) {
      console.warn('Ignoring invalid shared state', err);
      return;
    }
    this.applying = true;
    try {
      const s = useStore.getState();
      const ids = new Set(next.model.constructs.map((c) => c.id));
      useStore.setState({
        model: next.model,
        settings: next.settings,
        projectName: next.name,
        selection: { ...s.selection, nodes: s.selection.nodes.filter((id) => ids.has(id)), edges: s.selection.edges.filter((id) => next.model.paths.some((p) => p.id === id)) },
      });
      // A simulation design from before the Analyses tab becomes a card.
      const cards = withLegacySimulation(readCards(this.doc), next.simulation);
      if (!same(shareableCards(useAnalyses.getState().cards), cards)) loadCards(cards);
    } finally {
      this.applying = false;
    }
  }

  private async fetchData() {
    this.fetchingData = true;
    try {
      const text = await api.getText(`/api/projects/${this.projectId}/dataset`);
      const { data, info } = parseDataSection(JSON.parse(text));
      useStore.getState().setData(data, info);
    } catch (err) {
      if ((err as { status?: number }).status !== 404) useStore.getState().toast('error', `Could not load the shared dataset: ${(err as Error).message}`);
    } finally {
      this.fetchingData = false;
    }
  }

  private async uploadData() {
    const s = useStore.getState();
    if (!s.data || !s.dataInfo) return;
    try {
      const { revision } = await api.put<{ revision: number }>(`/api/projects/${this.projectId}/dataset`, JSON.stringify(serializeDataSection(s.data, s.dataInfo)));
      this.doc.transact(() => this.doc.getMap('sys').set('dataRevision', revision), LOCAL);
      s.toast('success', 'Dataset shared with collaborators (stored encrypted).');
    } catch (err) {
      s.toast('error', `Could not share the dataset: ${(err as Error).message}`);
    }
  }

  /** Throttled cursor broadcast (flow coordinates). */
  setCursor(pos: { x: number; y: number } | null) {
    const now = Date.now();
    if (pos && now - this.lastCursor < 50) return;
    this.lastCursor = now;
    this.provider.awareness.setLocalStateField('cursor', pos);
  }

  destroy() {
    this.unsubs.forEach((u) => u());
    this.undo.destroy();
    this.provider.destroy();
    this.doc.destroy();
    usePresence.setState({ peers: [] });
  }
}

// ---------- current session ----------

let current: CollabSession | null = null;
export const currentSession = () => current;

export function closeSession() {
  current?.destroy();
  current = null;
  useStore.setState({ cloud: null, history: null, historyCounts: { undo: 0, redo: 0 } });
}

function startSession(projectId: string, role: 'owner' | 'editor' | 'viewer', user: { id: string; display_name: string }, seed: boolean) {
  current?.destroy();
  useStore.setState({ cloud: { projectId, role, status: 'connecting' }, history: null });
  current = new CollabSession(projectId, user, { seed });
}

/** Open a shared project from the server. */
export async function openCloudProject(projectId: string, user: { id: string; display_name: string }) {
  const meta = await api.get<{ id: string; name: string; role: 'owner' | 'editor' | 'viewer' }>(`/api/projects/${projectId}`);
  closeSession();
  useStore.getState().loadProject({ name: meta.name, model: { constructs: [], paths: [], moderations: [] }, settings: DEFAULT_SETTINGS, data: null, info: null, id: `cloud:${projectId}` });
  loadCards([]);
  startSession(projectId, meta.role, user, false);
}

/** Turn the open local project into a shared one (owner = you). Returns the project id. */
export async function shareCurrentProject(user: { id: string; display_name: string }): Promise<string> {
  const s = useStore.getState();
  if (s.cloud) return s.cloud.projectId;
  const { id } = await api.post<{ id: string }>('/api/projects', { name: s.projectName });
  if (s.data && s.dataInfo) await api.put(`/api/projects/${id}/dataset`, JSON.stringify(serializeDataSection(s.data, s.dataInfo)));
  useStore.setState({ projectId: `cloud:${id}` });
  startSession(id, 'owner', user, true);
  return id;
}

// Leaving the project (opening another, going to a new one) ends the session.
useStore.subscribe((s, prev) => {
  if (current && s.projectId !== prev.projectId && s.projectId !== `cloud:${current.projectId}`) closeSession();
});
