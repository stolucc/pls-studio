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

import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';
import { create } from 'zustand';
import type { McDesign } from '../engine/montecarlo';
import {
  DEFAULT_SETTINGS,
  FORMAT_VERSION,
  parseDataSection,
  parseProject,
  serializeDataSection,
  type ModelState,
  type Settings,
} from '../model/project';
import { parseCards, shareableCards, withLegacySimulation } from '../analyses/persist';
import { loadCards, useAnalyses } from '../analyses/store';
import type { Card } from '../analyses/types';
import { useStore } from '../store';
import { api } from './api';

export const LOCAL = 'pls-local';

const PALETTE = [
  '#e11d48',
  '#0891b2',
  '#16a34a',
  '#d97706',
  '#7c3aed',
  '#db2777',
  '#2563eb',
  '#65a30d',
];
export const colorFor = (id: string) =>
  PALETTE[[...id].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % PALETTE.length];

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ---------- model ⇄ document ----------

export function writeDoc(
  doc: Y.Doc,
  model: ModelState,
  settings: Settings,
  name: string,
  simulation: McDesign | null,
) {
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
      for (const [k, v] of Object.entries(fields))
        if (v !== undefined && !same(m.get(k), v)) m.set(k, v);
      for (const k of [...m.keys()])
        if (k !== 'o' && (fields as Record<string, unknown>)[k] === undefined) m.delete(k);
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
    for (const k of [...extra.keys()])
      if ((rest as Record<string, unknown>)[k] === undefined) extra.delete(k);
    for (const [k, v] of Object.entries(rest))
      if (v !== undefined && !same(extra.get(k), v)) extra.set(k, v);
    const meta = doc.getMap('meta');
    if (meta.get('name') !== name) meta.set('name', name);
    if (!same(meta.get('settings'), settings)) meta.set('settings', settings);
    if (!same(meta.get('simulation') ?? null, simulation)) meta.set('simulation', simulation);
    if (meta.get('format') !== FORMAT_VERSION) meta.set('format', FORMAT_VERSION);
  }, LOCAL);
}

/** The model fields kept in maps of their own (everything else is a key of the 'model' map). */
const OWN_MAPS = new Set(['constructs', 'paths', 'moderations', 'correlations']);

/**
 * Parse the shared state as a project file. Concurrent edits can merge into a state that no
 * single editor made and the validation rejects (one user declares x1 ordinal while another
 * declares it a count): then the fields of the 'model' map are dropped one at a time, in the
 * order of their names, and the first state that is valid is taken; failing that, all of them.
 * Every replica reads the same document, so every replica drops the same field. Throws only
 * when even the core model (constructs, paths, …) is invalid.
 */
function parseMerged(file: { model: Record<string, unknown> } & Record<string, unknown>): {
  parsed: ReturnType<typeof parseProject>;
  dropped: string[];
} {
  const parse = (model: Record<string, unknown>) =>
    parseProject(JSON.stringify({ ...file, model }));
  try {
    return { parsed: parse(file.model), dropped: [] };
  } catch (first) {
    const fields = Object.keys(file.model)
      .filter((k) => !OWN_MAPS.has(k))
      .sort();
    for (const field of fields) {
      const { [field]: _gone, ...rest } = file.model;
      try {
        return { parsed: parse(rest), dropped: [field] };
      } catch {
        /* not this one */
      }
    }
    const core = Object.fromEntries(Object.entries(file.model).filter(([k]) => OWN_MAPS.has(k)));
    try {
      return { parsed: parse(core), dropped: fields };
    } catch {
      throw first;
    }
  }
}

/**
 * Two paths between the same constructs (drawn by two people at once) become one: the one with
 * the smaller id is kept, and moderations of the other moderate it instead.
 */
function mergeParallelPaths<P extends { id: string; from?: unknown; to?: unknown }>(
  paths: P[],
): { paths: P[]; replaced: Map<string, string> } {
  const kept = new Map<string, P>();
  const replaced = new Map<string, string>();
  for (const p of [...paths].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const key = JSON.stringify([p.from, p.to]);
    const first = kept.get(key);
    if (first) replaced.set(p.id, first.id);
    else kept.set(key, p);
  }
  return { paths: paths.filter((p) => !replaced.has(p.id)), replaced };
}

/**
 * Read and validate the shared state (as an untrusted project file). `dropped`: model fields
 * left out because concurrent edits made them conflict (parseMerged).
 */
export function readDoc(doc: Y.Doc): {
  model: ModelState;
  settings: Settings;
  name: string;
  simulation: McDesign | null;
  dropped: string[];
} {
  const cs = doc.getMap<Y.Map<unknown>>('constructs');
  const constructs = [...cs.entries()]
    .map(
      ([id, m]) =>
        ({ ...(m.toJSON() as Record<string, unknown>), id }) as Record<string, unknown> & {
          id: string;
        },
    )
    .sort((a, b) => (Number(a.o) || 0) - (Number(b.o) || 0))
    .map(({ o: _o, ...c }) => c);
  const flat = (map: Y.Map<unknown>) =>
    [...map.entries()].map(
      ([id, v]) => ({ ...(v as object), id }) as Record<string, unknown> & { id: string },
    );
  const meta = doc.getMap('meta');
  // Concurrent edits can leave dangling references (a path drawn to a construct
  // someone else deleted at the same time): drop them rather than reject the state.
  const ids = new Set(constructs.map((c) => c.id));
  const { paths, replaced } = mergeParallelPaths(
    flat(doc.getMap('paths')).filter(
      (p) => ids.has(p.from as string) && ids.has(p.to as string) && p.from !== p.to,
    ),
  );
  const pathIds = new Set(paths.map((p) => p.id));
  const moderations = flat(doc.getMap('moderations'))
    .map((m) =>
      replaced.has(m.path as string) ? { ...m, path: replaced.get(m.path as string) } : m,
    )
    .filter((m) => ids.has(m.moderator as string) && pathIds.has(m.path as string));
  const indicators = new Set(
    constructs.flatMap((c) => (Array.isArray(c.indicators) ? (c.indicators as unknown[]) : [])),
  );
  const correlations = flat(doc.getMap('correlations')).filter(
    (k) =>
      k.a !== k.b &&
      (k.kind === 'construct'
        ? ids.has(k.a as string) && ids.has(k.b as string)
        : indicators.has(k.a) && indicators.has(k.b)),
  );
  // Moderated moderations whose moderation or moderator someone else removed.
  const extra = doc.getMap('model').toJSON() as Record<string, unknown>;
  const modIds = new Set(moderations.map((m) => m.id));
  if (Array.isArray(extra.threeWay)) {
    extra.threeWay = (extra.threeWay as unknown[]).filter(
      (t) =>
        !!t &&
        typeof t === 'object' &&
        modIds.has((t as Record<string, unknown>).moderation as string) &&
        ids.has((t as Record<string, unknown>).moderator as string),
    );
  }
  for (const c of constructs) {
    if (Array.isArray(c.components))
      c.components = (c.components as unknown[]).filter(
        (x) => typeof x === 'string' && ids.has(x) && x !== c.id,
      );
  }
  const file = {
    // (shared projects from before format 2 are migrated once, then written back as format 2)
    format: 'pls-studio',
    version: meta.get('format') === FORMAT_VERSION ? FORMAT_VERSION : 1,
    // (a path someone else removed takes its Gaussian copula along)
    model: {
      ...extra,
      ...(Array.isArray(extra.copulas)
        ? { copulas: extra.copulas.filter((k: { path: string }) => pathIds.has(k.path)) }
        : {}),
      constructs,
      paths,
      moderations,
      correlations,
    },
    settings: meta.get('settings') ?? DEFAULT_SETTINGS,
    data: null,
    simulation: meta.get('simulation') ?? null,
  };
  const { parsed: p, dropped } = parseMerged(file);
  const name =
    typeof meta.get('name') === 'string'
      ? (meta.get('name') as string).slice(0, 100)
      : 'Shared project';
  return { model: p.model, settings: p.settings, name, simulation: p.simulation, dropped };
}

/**
 * Resolves once the server has applied everything this client sent before the call: a sync
 * step 1 is sent after it, and the server, which handles a connection's messages in order,
 * answers it (sync step 2) only after applying them. Rejects when the socket is not open,
 * closes, or no answer comes within `timeoutMs`.
 */
export function awaitServerEcho(
  ws: WebSocket | null,
  doc: Y.Doc,
  timeoutMs = 20_000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== 1)
      return reject(new Error('There is no connection to the server.'));
    const done = (err?: Error) => {
      clearTimeout(timer);
      ws.removeEventListener('message', onMessage);
      ws.removeEventListener('close', onClose);
      if (err) reject(err);
      else resolve();
    };
    const onMessage = (ev: MessageEvent) => {
      if (!(ev.data instanceof ArrayBuffer)) return;
      const dec = decoding.createDecoder(new Uint8Array(ev.data));
      if (decoding.readVarUint(dec) !== 0) return; // (not a sync message)
      if (decoding.readVarUint(dec) === syncProtocol.messageYjsSyncStep2) done();
    };
    const onClose = () => done(new Error('The connection to the server closed.'));
    const timer = setTimeout(
      () => done(new Error('The server did not answer in time.')),
      timeoutMs,
    );
    ws.addEventListener('message', onMessage);
    ws.addEventListener('close', onClose);
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, 0);
    syncProtocol.writeSyncStep1(enc, doc);
    ws.send(encoding.toUint8Array(enc));
  });
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
  const order = Array.isArray(map.get('order'))
    ? (map.get('order') as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];
  const ids = [
    ...new Set([
      ...order.filter((id) => map.has(id)),
      ...[...map.keys()].filter((k) => k !== 'order' && !order.includes(k)),
    ]),
  ];
  return parseCards(ids.map((id) => map.get(id)));
}

// ---------- presence ----------

export interface Peer {
  clientId: number;
  userId: string;
  name: string;
  color: string;
  cursor: { x: number; y: number } | null;
  selection: string[];
}

export const usePresence = create<{ peers: Peer[] }>(() => ({ peers: [] }));

// ---------- session ----------

export class CollabSession {
  readonly doc = new Y.Doc();
  readonly provider: WebsocketProvider;
  readonly projectId: string;
  private undo: Y.UndoManager;
  private applying = false;
  private fetchingData = false;
  /** The data revision the dataset in the store was loaded at or uploaded as (null: unknown). */
  private dataRevision: number | null = null;
  private initialised = false;
  /** The shared state could not be read: stop writing to it (it would overwrite collaborators' work). */
  private broken = false;
  /** The conflicting fields last reported (to tell the user once, not at every change). */
  private reportedDrop = '';
  private unsubs: (() => void)[] = [];
  private lastCursor = 0;
  /**
   * Settles after the first sync: for a project seeded from this browser, once the server has
   * applied the seeded model (awaitServerEcho); rejects when that fails or the session ends first.
   */
  readonly ready: Promise<void>;
  private settleReady: (err?: Error) => void = () => {};

  constructor(
    projectId: string,
    user: { id: string; display_name: string },
    opts: { seed: boolean },
  ) {
    this.projectId = projectId;
    this.ready = new Promise<void>((resolve, reject) => {
      let settled = false;
      this.settleReady = (err) => {
        if (settled) return;
        settled = true;
        if (err) reject(err);
        else resolve();
      };
    });
    // (nobody may be waiting: opening a shared project does not)
    this.ready.catch(() => {});
    const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/projects`;
    this.provider = new WebsocketProvider(wsUrl, projectId, this.doc, { disableBc: true });
    this.provider.awareness.setLocalStateField('user', {
      id: user.id,
      name: user.display_name,
      color: colorFor(user.id),
    });

    this.provider.on('status', ({ status }: { status: string }) => {
      const st = useStore.getState();
      if (st.cloud?.projectId === projectId) {
        useStore.setState({
          cloud: {
            ...st.cloud,
            status:
              status === 'connected'
                ? 'online'
                : status === 'connecting'
                  ? 'connecting'
                  : 'offline',
          },
        });
      }
    });
    this.provider.on('sync', (synced: boolean) => {
      if (!synced || this.initialised) return;
      this.initialised = true;
      if (opts.seed && this.doc.getMap('constructs').size === 0) {
        this.push();
        writeCards(this.doc, useAnalyses.getState().cards);
        awaitServerEcho(this.provider.ws, this.doc).then(
          () => this.settleReady(),
          (err: Error) => this.settleReady(err),
        );
      } else {
        this.pull();
        this.settleReady();
      }
      void this.fetchData();
    });
    // Close codes 4403 (access removed) and 4401 (this sign-in ended: logout,
    // password reset or change elsewhere): leave the project.
    this.provider.on('connection-close', (ev: CloseEvent | null) => {
      if (ev?.code === 4403) {
        this.settleReady(new Error('Access to the project was removed.'));
        useStore.getState().toast('error', 'Your access to this shared project was removed.');
        closeSession();
        useStore.getState().setView('home');
      } else if (ev?.code === 4401) {
        useStore.getState().toast('error', 'You were signed out. Sign in again to keep editing.');
        closeSession();
        useStore.getState().setView('home');
        // (imported here: auth.ts and this module would otherwise import each other)
        void import('./auth').then((m) => m.useAuth.getState().refresh());
      }
    });

    this.doc.on('update', (_u: Uint8Array, origin: unknown) => {
      if (origin !== LOCAL && this.initialised) this.pull();
    });
    const sys = this.doc.getMap('sys');
    sys.observe((ev) => {
      if (ev.transaction.origin !== LOCAL && ev.keysChanged.has('dataRevision'))
        void this.fetchData();
    });

    this.undo = new Y.UndoManager(
      [
        this.doc.getMap('constructs'),
        this.doc.getMap('paths'),
        this.doc.getMap('moderations'),
        this.doc.getMap('correlations'),
        this.doc.getMap('model'),
        this.doc.getMap('meta'),
      ],
      { trackedOrigins: new Set([LOCAL]), captureTimeout: 400 },
    );
    const counts = () =>
      useStore.setState({
        historyCounts: { undo: this.undo.undoStack.length, redo: this.undo.redoStack.length },
      });
    this.undo.on('stack-item-added', counts);
    this.undo.on('stack-item-popped', counts);
    useStore.setState({ history: { undo: () => this.undo.undo(), redo: () => this.undo.redo() } });

    // Local store changes → document.
    this.unsubs.push(
      useStore.subscribe((s, prev) => {
        if (this.applying || !this.initialised || s.cloud?.projectId !== projectId) return;
        if (
          s.model !== prev.model ||
          s.settings !== prev.settings ||
          s.projectName !== prev.projectName
        )
          this.push();
        if (
          s.data !== prev.data &&
          !this.fetchingData &&
          s.data &&
          s.dataInfo &&
          s.cloud.role !== 'viewer'
        )
          void this.uploadData();
        if (s.selection !== prev.selection)
          this.provider.awareness.setLocalStateField('selection', s.selection.nodes);
      }),
    );
    this.unsubs.push(
      useAnalyses.subscribe((s, prev) => {
        if (
          !this.applying &&
          this.initialised &&
          s.cards !== prev.cards &&
          useStore.getState().cloud?.role !== 'viewer'
        )
          writeCards(this.doc, s.cards);
      }),
    );

    const onAwareness = () => {
      const peers: Peer[] = [];
      for (const [clientId, st] of this.provider.awareness.getStates()) {
        if (clientId === this.doc.clientID || !st.user) continue;
        peers.push({
          clientId,
          userId: st.user.id,
          name: String(st.user.name).slice(0, 80),
          color: st.user.color,
          cursor: st.cursor ?? null,
          selection: Array.isArray(st.selection) ? st.selection : [],
        });
      }
      usePresence.setState({ peers });
    };
    this.provider.awareness.on('change', onAwareness);
  }

  private push() {
    if (this.broken) return;
    const s = useStore.getState();
    writeDoc(this.doc, s.model, s.settings, s.projectName, null);
  }

  private pull() {
    let next;
    try {
      next = readDoc(this.doc);
    } catch (err) {
      // The local model is stale now: writing it back would delete collaborators' keys.
      console.warn('Invalid shared state', err);
      if (!this.broken)
        useStore
          .getState()
          .toast(
            'error',
            'The shared project could not be read after a collaborator’s change, so your changes are no longer sent. Reopen the project; save a copy to a file first if you need your recent edits.',
          );
      this.broken = true;
      return;
    }
    const drop = next.dropped.join(', ');
    if (drop && drop !== this.reportedDrop)
      useStore
        .getState()
        .toast(
          'info',
          `Concurrent edits conflicted, so part of the shared model was left out (${drop}). Check the model settings.`,
        );
    this.reportedDrop = drop;
    this.applying = true;
    try {
      const s = useStore.getState();
      const ids = new Set(next.model.constructs.map((c) => c.id));
      useStore.setState({
        model: next.model,
        settings: next.settings,
        projectName: next.name,
        selection: {
          ...s.selection,
          nodes: s.selection.nodes.filter((id) => ids.has(id)),
          edges: s.selection.edges.filter((id) => next.model.paths.some((p) => p.id === id)),
        },
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
    const before = useStore.getState().data;
    const editedHere = () => useStore.getState().data !== before;
    // The revision the local data were made from (null: none was loaded or uploaded).
    let base = this.dataRevision;
    let upload = false;
    try {
      // The revision first: read before the dataset, it is at most as new as the dataset, so an
      // upload from it is refused rather than overwriting a newer one.
      const meta = await api.get<{ data_revision?: number }>(`/api/projects/${this.projectId}`);
      const revision = typeof meta.data_revision === 'number' ? meta.data_revision : null;
      const text = await this.datasetText();
      if (text === null) {
        // No shared dataset: data added here meanwhile are uploaded (from this revision).
        base = revision;
        upload = editedHere();
      } else if (editedHere() && base !== null) {
        // Changed here while loading: keep the local edit and upload it from the revision it was
        // made from (refused, and then reported, if the shared dataset changed meanwhile).
        upload = true;
      } else {
        const { data, info } = parseDataSection(JSON.parse(text));
        if (editedHere())
          useStore
            .getState()
            .toast(
              'info',
              'The shared dataset arrived while you changed the data here, and replaces your change. Make it again if you still need it.',
            );
        base = revision;
        useStore.getState().setData(data, info);
      }
    } catch (err) {
      useStore
        .getState()
        .toast('error', `Could not load the shared dataset: ${(err as Error).message}`);
    } finally {
      this.dataRevision = base;
      this.fetchingData = false;
    }
    if (upload) await this.uploadData();
  }

  /** The shared dataset as JSON text, or null when the project has none. */
  private async datasetText(): Promise<string | null> {
    try {
      return await api.getText(`/api/projects/${this.projectId}/dataset`);
    } catch (err) {
      if ((err as { status?: number }).status === 404) return null;
      throw err;
    }
  }

  private async uploadData() {
    const s = useStore.getState();
    if (!s.data || !s.dataInfo) return;
    try {
      const { revision } = await api.put<{ revision: number }>(
        `/api/projects/${this.projectId}/dataset`,
        JSON.stringify(serializeDataSection(s.data, s.dataInfo)),
        this.dataRevision === null ? undefined : { 'If-Match': `"${this.dataRevision}"` },
      );
      this.dataRevision = revision;
      this.doc.transact(() => this.doc.getMap('sys').set('dataRevision', revision), LOCAL);
      s.toast('success', 'Dataset shared with collaborators (stored encrypted).');
    } catch (err) {
      if ((err as { status?: number }).status === 409) {
        s.toast(
          'error',
          'A collaborator changed the shared dataset at the same time, so your change was not shared. Their version is loaded now; make your change again.',
        );
        await this.fetchData();
        return;
      }
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
    this.settleReady(new Error('The shared session ended.'));
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

function startSession(
  projectId: string,
  role: 'owner' | 'editor' | 'viewer',
  user: { id: string; display_name: string },
  seed: boolean,
): CollabSession {
  current?.destroy();
  useStore.setState({ cloud: { projectId, role, status: 'connecting' }, history: null });
  current = new CollabSession(projectId, user, { seed });
  return current;
}

/** How long sharing waits for the server to have the model before it reports a failure. */
export const SEED_TIMEOUT_MS = 30_000;

/** Open a shared project from the server. */
export async function openCloudProject(
  projectId: string,
  user: { id: string; display_name: string },
) {
  const meta = await api.get<{ id: string; name: string; role: 'owner' | 'editor' | 'viewer' }>(
    `/api/projects/${projectId}`,
  );
  closeSession();
  useStore.getState().loadProject({
    name: meta.name,
    model: { constructs: [], paths: [], moderations: [] },
    settings: DEFAULT_SETTINGS,
    data: null,
    info: null,
    id: `cloud:${projectId}`,
  });
  loadCards([]);
  startSession(projectId, meta.role, user, false);
}

/**
 * Turn the open local project into a shared one (owner = you). Returns the project id once the
 * server has the model (the first sync and push have completed), so the caller may then drop a
 * local copy; rejects when that does not happen within SEED_TIMEOUT_MS (the session goes on and
 * may still sync later).
 */
export async function shareCurrentProject(user: {
  id: string;
  display_name: string;
}): Promise<string> {
  const s = useStore.getState();
  if (s.cloud) return s.cloud.projectId;
  const { id } = await api.post<{ id: string }>('/api/projects', { name: s.projectName });
  if (s.data && s.dataInfo)
    await api.put(
      `/api/projects/${id}/dataset`,
      JSON.stringify(serializeDataSection(s.data, s.dataInfo)),
      // (a new project: no one else can have uploaded one)
      { 'If-Match': '"0"' },
    );
  useStore.setState({ projectId: `cloud:${id}` });
  const session = startSession(id, 'owner', user, true);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error('The server did not receive the model in time.')),
      SEED_TIMEOUT_MS,
    );
  });
  try {
    await Promise.race([session.ready, timeout]);
  } finally {
    clearTimeout(timer);
  }
  return id;
}

// Leaving the project (opening another, going to a new one) ends the session.
useStore.subscribe((s, prev) => {
  if (current && s.projectId !== prev.projectId && s.projectId !== `cloud:${current.projectId}`)
    closeSession();
});
