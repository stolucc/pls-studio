import { beforeEach, describe, expect, it } from 'vitest';
import { autosave, currentEntry, openRecent } from './io';
import { getRecent, listRecent, MAX_RECENT, relativeTime, removeRecent, resetRecentForTests, saveRecent, type RecentEntry } from './recent';
import { makeSample } from './sample';
import { DEFAULT_SETTINGS } from './model/project';
import { useStore } from './store';

const entry = (id: string, updated: number): RecentEntry => ({ id, name: id, method: 'pls', updated, constructs: 1, dataLabel: 'no data', text: '{}' });

describe('recent projects store', () => {
  beforeEach(() => resetRecentForTests());

  it('lists newest first without the project text', async () => {
    await saveRecent(entry('a', 1));
    await saveRecent(entry('b', 3));
    await saveRecent(entry('c', 2));
    const list = await listRecent();
    expect(list.map((e) => e.id)).toEqual(['b', 'c', 'a']);
    expect('text' in list[0]).toBe(false);
  });

  it('updates in place and keeps only the most recent entries', async () => {
    for (let i = 0; i < MAX_RECENT + 3; i++) await saveRecent(entry(`p${i}`, i));
    await saveRecent({ ...entry('p0', 1000), name: 'renamed' });
    const list = await listRecent();
    expect(list).toHaveLength(MAX_RECENT);
    expect(list[0]).toMatchObject({ id: 'p0', name: 'renamed' });
    expect(list.some((e) => e.id === 'p1')).toBe(false);
    await removeRecent('p0');
    expect(await getRecent('p0')).toBeNull();
  });

  it('formats relative times', () => {
    const now = 1_000_000_000;
    expect(relativeTime(now - 10_000, now)).toBe('just now');
    expect(relativeTime(now - 5 * 60_000, now)).toBe('5 min ago');
    expect(relativeTime(now - 3 * 3600_000, now)).toBe('3 h ago');
    expect(relativeTime(now - 2 * 86400_000, now)).toBe('2 days ago');
  });
});

describe('autosave into recents and reopening', () => {
  beforeEach(() => resetRecentForTests());

  it('does not store empty projects', async () => {
    useStore.getState().newProject();
    expect(currentEntry()).toBeNull();
  });

  it('round-trips the current project through Recent projects', async () => {
    const { data, info, model } = makeSample(120, 3);
    const st = useStore.getState();
    st.loadProject({ name: 'Survey', model, settings: DEFAULT_SETTINGS, data, info });
    const id = useStore.getState().projectId;
    await autosave();
    const [meta] = await listRecent();
    expect(meta).toMatchObject({ id, name: 'Survey', method: 'pls', constructs: 5 });
    expect(meta.dataLabel).toContain('120 rows');

    useStore.getState().newProject();
    useStore.setState({ dirty: false });
    expect(useStore.getState().projectId).not.toBe(id);
    await openRecent(id);
    const s = useStore.getState();
    expect(s.projectId).toBe(id);
    expect(s.projectName).toBe('Survey');
    expect(s.model.constructs).toHaveLength(5);
    expect(s.data!.cols[0].length).toBe(120);
    expect(s.view).toBe('editor');
  });
});
