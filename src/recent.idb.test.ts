// The IndexedDB backend (through fake-indexeddb), the fallback to memory when
// it is blocked, the legacy-autosave migration and the edges of relativeTime.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRecent, listRecent, migrateLegacyAutosave, recentPersistent, relativeTime, removeRecent, resetRecentForTests, saveRecent, type RecentEntry } from './recent';

const entry = (id: string, updated: number): RecentEntry => ({ id, name: id, method: 'pls', updated, constructs: 1, dataLabel: 'no data', text: '{}' });
const realIdb = indexedDB;

afterEach(() => { Object.defineProperty(globalThis, 'indexedDB', { value: realIdb, configurable: true, writable: true }); resetRecentForTests(); });

describe('IndexedDB backend', () => {
  it('stores entries in the browser database, which survives a fresh probe', async () => {
    Object.defineProperty(globalThis, 'indexedDB', { value: new IDBFactory(), configurable: true, writable: true });
    resetRecentForTests(true);
    expect(await recentPersistent()).toBe(true);
    await saveRecent(entry('a', 1));
    await saveRecent(entry('b', 2));
    await saveRecent({ ...entry('a', 3), name: 'A again' });
    expect((await listRecent()).map((e) => [e.id, e.name])).toEqual([['a', 'A again'], ['b', 'b']]);
    resetRecentForTests(true); // a new page load: the same database is opened again
    expect((await getRecent('a'))?.text).toBe('{}');
    await removeRecent('a');
    expect(await getRecent('a')).toBeNull();
    expect((await listRecent()).map((e) => e.id)).toEqual(['b']);
  });
  it('falls back to memory when IndexedDB is blocked', async () => {
    const open = () => { const r = { error: new Error('blocked'), onerror: null as null | (() => void), onsuccess: null, onupgradeneeded: null }; setTimeout(() => r.onerror?.(), 0); return r; };
    Object.defineProperty(globalThis, 'indexedDB', { value: { open }, configurable: true, writable: true });
    resetRecentForTests(true);
    expect(await recentPersistent()).toBe(false);
    await saveRecent(entry('m', 1));
    expect((await listRecent()).map((e) => e.id)).toEqual(['m']);
  });
  it('is memory only when there is no IndexedDB at all', async () => {
    Object.defineProperty(globalThis, 'indexedDB', { value: undefined, configurable: true, writable: true });
    resetRecentForTests(true);
    expect(await recentPersistent()).toBe(false);
  });
  it('survives a database that fails after the probe (closed by the browser, quota exceeded)', async () => {
    let calls = 0;
    const ok = <T,>(result: T) => { const r = { result, onsuccess: null as null | (() => void), onerror: null }; setTimeout(() => r.onsuccess?.(), 0); return r; };
    const db = { transaction: () => { if (++calls > 1) throw new Error('database is closing'); return { objectStore: () => ({ getAll: () => ok([]) }) }; } };
    Object.defineProperty(globalThis, 'indexedDB', { value: { open: () => ok(db) }, configurable: true, writable: true });
    resetRecentForTests(true);
    expect(await recentPersistent()).toBe(true);
    expect(await listRecent()).toEqual([]);
    expect(await getRecent('z')).toBeNull();
    await expect(saveRecent(entry('q', 2))).resolves.toBeUndefined();
    await expect(removeRecent('z')).resolves.toBeUndefined();
    expect(calls).toBeGreaterThan(1);
  });
});

describe('legacy autosave migration', () => {
  const storage = (raw: string | null) => {
    const removeItem = vi.fn();
    Object.defineProperty(globalThis, 'localStorage', { value: { getItem: (k: string) => (k === 'pls-studio:autosave' ? raw : null), removeItem }, configurable: true, writable: true });
    return removeItem;
  };
  afterEach(() => { Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true, writable: true }); });
  it('does nothing without a slot or without storage', async () => {
    const removeItem = storage(null);
    await migrateLegacyAutosave(() => entry('x', 1));
    expect(removeItem).not.toHaveBeenCalled();
    Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true, writable: true });
    await expect(migrateLegacyAutosave(() => entry('x', 1))).resolves.toBeUndefined();
    expect(await listRecent()).toEqual([]);
  });
  it('moves the slot into the recents and removes it, naming untitled models', async () => {
    const removeItem = storage(JSON.stringify({ project: '{"v":1}' }));
    const make = vi.fn((name: string, text: string) => ({ ...entry('legacy', 5), name, text }));
    await migrateLegacyAutosave(make);
    expect(make).toHaveBeenCalledWith('Untitled model', '{"v":1}');
    expect((await getRecent('legacy'))?.text).toBe('{"v":1}');
    expect(removeItem).toHaveBeenCalledWith('pls-studio:autosave');
  });
  it('keeps the stored name, and drops slots that are malformed, not a project, or rejected', async () => {
    const r1 = storage(JSON.stringify({ name: 'Old', project: 'p' }));
    const make = vi.fn((name: string, text: string) => ({ ...entry('legacy', 5), name, text }));
    await migrateLegacyAutosave(make);
    expect(make).toHaveBeenCalledWith('Old', 'p');
    expect(r1).toHaveBeenCalledTimes(1);
    resetRecentForTests();
    const r2 = storage('{not json');
    await migrateLegacyAutosave(make);
    expect(r2).not.toHaveBeenCalled();
    const r3 = storage(JSON.stringify({ name: 'Old', project: 42 }));
    await migrateLegacyAutosave(make);
    expect(r3).toHaveBeenCalledTimes(1);
    const r4 = storage(JSON.stringify({ project: 'p' }));
    await migrateLegacyAutosave(() => null);
    expect(r4).toHaveBeenCalledTimes(1);
    expect(await listRecent()).toEqual([]);
  });
});

describe('relativeTime at the boundaries', () => {
  const now = 1_700_000_000_000;
  it('switches units at 45 s, 60 min, 24 h and 14 days', () => {
    expect(relativeTime(now - 44_000, now)).toBe('just now');
    expect(relativeTime(now - 45_000, now)).toBe('1 min ago');
    expect(relativeTime(now - 59 * 60_000, now)).toBe('59 min ago');
    expect(relativeTime(now - 60 * 60_000, now)).toBe('1 h ago');
    expect(relativeTime(now - 23 * 3600_000, now)).toBe('23 h ago');
    expect(relativeTime(now - 24 * 3600_000, now)).toBe('1 day ago');
    expect(relativeTime(now - 13 * 86400_000, now)).toBe('13 days ago');
    expect(relativeTime(now - 14 * 86400_000, now)).toBe(new Date(now - 14 * 86400_000).toLocaleDateString());
    expect(relativeTime(now + 5_000, now)).toBe('just now'); // clock skew: never negative
  });
});
