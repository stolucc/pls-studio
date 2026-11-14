// Recent projects, kept in this browser (IndexedDB) so they can be reopened
// from the home screen. A per-browser convenience, not a backup: project
// files (Save) remain the durable copy. Falls back to memory when IndexedDB is
// unavailable (private windows, blocked storage).

import type { Method } from './model/project';

export interface RecentEntry {
  id: string;
  name: string;
  method: Method;
  updated: number;
  constructs: number;
  /** Short description of the data ("example.csv · 300 rows", "covariance matrix · N = 155"). */
  dataLabel: string;
  /** Serialized project file (format pls-studio v1). */
  text: string;
}

export type RecentMeta = Omit<RecentEntry, 'text'>;

const DB = 'pls-studio';
const STORE = 'recent';
export const MAX_RECENT = 12;
const LEGACY_KEY = 'pls-studio:autosave';

interface Backend {
  all(): Promise<RecentEntry[]>;
  put(e: RecentEntry): Promise<void>;
  remove(id: string): Promise<void>;
  persistent: boolean;
}

function memoryBackend(): Backend {
  const map = new Map<string, RecentEntry>();
  return {
    persistent: false,
    all: async () => [...map.values()],
    put: async (e) => {
      map.set(e.id, e);
    },
    remove: async (id) => {
      map.delete(id);
    },
  };
}

function idbBackend(): Backend | null {
  if (typeof indexedDB === 'undefined') return null;
  const open = () =>
    new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  let db: Promise<IDBDatabase> | null = null;
  // Settled when the transaction completes, not when its request succeeds: a write can still be
  // aborted after that (quota exceeded on commit), and then nothing was stored.
  const tx = async <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) => {
    db ??= open();
    const d = await db;
    return new Promise<T>((resolve, reject) => {
      const transaction = d.transaction(STORE, mode);
      const req = fn(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(req.result);
      transaction.onerror = () => reject(transaction.error ?? req.error);
      transaction.onabort = () => reject(transaction.error ?? new Error('Transaction aborted.'));
    });
  };
  return {
    persistent: true,
    all: () => tx('readonly', (s) => s.getAll() as IDBRequest<RecentEntry[]>),
    put: async (e) => {
      await tx('readwrite', (s) => s.put(e));
    },
    remove: async (id) => {
      await tx('readwrite', (s) => s.delete(id));
    },
  };
}

let backend: Backend | null = null;
let ready: Promise<Backend> | null = null;

/** Resolve a working backend, probing IndexedDB once and falling back to memory. */
function getBackend(): Promise<Backend> {
  ready ??= (async () => {
    const idb = idbBackend();
    if (idb) {
      try {
        await idb.all();
        backend = idb;
        return idb;
      } catch {
        /* blocked: fall through */
      }
    }
    backend = memoryBackend();
    return backend;
  })();
  return ready;
}

/** For tests: start from a clean in-memory store, or (probe) from scratch so the next call probes IndexedDB again. */
export function resetRecentForTests(probe = false) {
  if (probe) {
    backend = null;
    ready = null;
    return;
  }
  backend = memoryBackend();
  ready = Promise.resolve(backend);
}

export async function recentPersistent(): Promise<boolean> {
  return (await getBackend()).persistent;
}

export async function listRecent(): Promise<RecentMeta[]> {
  const b = await getBackend();
  try {
    const all = await b.all();
    return all.sort((a, c) => c.updated - a.updated).map(({ text: _t, ...meta }) => meta);
  } catch {
    return [];
  }
}

export async function getRecent(id: string): Promise<RecentEntry | null> {
  const b = await getBackend();
  try {
    return (await b.all()).find((e) => e.id === id) ?? null;
  } catch {
    return null;
  }
}

/**
 * Insert or update an entry and keep only the most recent MAX_RECENT. Resolves false when the
 * entry could not be stored (quota exceeded, storage blocked): the caller decides whether that
 * matters (before discarding the open project, it does).
 */
export async function saveRecent(entry: RecentEntry): Promise<boolean> {
  const b = await getBackend();
  try {
    await b.put(entry);
  } catch {
    return false;
  }
  try {
    const all = (await b.all()).sort((a, c) => c.updated - a.updated);
    for (const old of all.slice(MAX_RECENT)) await b.remove(old.id);
  } catch {
    // (the entry is stored; trimming the older ones can wait for the next save)
  }
  return true;
}

export async function removeRecent(id: string): Promise<void> {
  const b = await getBackend();
  try {
    await b.remove(id);
  } catch {
    /* ignore */
  }
}

/** One-time migration of the old single-slot localStorage autosave. */
export async function migrateLegacyAutosave(
  makeEntry: (name: string, text: string) => RecentEntry | null,
): Promise<void> {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return;
    const { name, project } = JSON.parse(raw) as { name?: unknown; project?: unknown };
    const entry =
      typeof project === 'string'
        ? makeEntry(typeof name === 'string' ? name : 'Untitled model', project)
        : null;
    if (entry) await saveRecent(entry);
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    // storage unavailable or malformed: nothing to migrate
  }
}

/** "3 minutes ago"-style label. */
export function relativeTime(t: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 14) return `${d} day${d > 1 ? 's' : ''} ago`;
  return new Date(t).toLocaleDateString();
}
