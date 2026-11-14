// Replacing the open project flushes it to Recent projects first; when that fails (storage
// full or blocked), the discard dialog is shown instead of losing the changes silently.

import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  confirm: vi.fn<() => Promise<boolean>>(),
  saveRecent: vi.fn<() => Promise<boolean>>(),
}));
vi.mock('./components/Overlays', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./components/Overlays')>()),
  confirmDialog: mocks.confirm,
}));
vi.mock('./recent', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./recent')>()),
  recentPersistent: async () => true,
  saveRecent: mocks.saveRecent,
}));

import { autosave, openProject } from './io';
import { useStore } from './store';

beforeEach(() => {
  vi.clearAllMocks();
  useStore.getState().newProject();
  useStore.getState().addConstruct(0, 0, ['x1']);
  expect(useStore.getState().dirty).toBe(true);
});

it('autosave reports whether the project was kept', async () => {
  mocks.saveRecent.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  expect(await autosave()).toBe(true);
  expect(await autosave()).toBe(false);
});

it('asks before discarding when the project could not be kept in Recent projects', async () => {
  mocks.saveRecent.mockResolvedValue(false);
  mocks.confirm.mockResolvedValue(false);
  const model = useStore.getState().model;
  await openProject();
  expect(mocks.saveRecent).toHaveBeenCalledTimes(1);
  expect(mocks.confirm).toHaveBeenCalledTimes(1);
  expect(mocks.confirm.mock.calls[0]).toEqual([
    expect.objectContaining({
      title: 'Discard unsaved changes?',
      body: expect.stringMatching(/could not be kept in Recent projects/),
    }),
  ]);
  // Declined: the project stays open.
  expect(useStore.getState().model).toBe(model);
});
