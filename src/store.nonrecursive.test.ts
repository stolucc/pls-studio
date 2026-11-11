// Reciprocal paths and loops are allowed in CB-SEM (non-recursive models) and refused in PLS-SEM.

import { beforeEach, expect, it } from 'vitest';
import { useStore } from './store';

const C = (id: string) => ({
  id,
  name: id.toUpperCase(),
  type: 'factor' as const,
  mode: 'A' as const,
  indicators: [`${id}1`, `${id}2`],
  x: 0,
  y: 0,
  side: 'left' as const,
});
beforeEach(() => {
  useStore.getState().newProject();
  useStore.setState({ toasts: [] });
  useStore.getState().commit((m) => ({
    ...m,
    constructs: [C('a'), C('b'), C('k')],
    paths: [
      { id: 'p', from: 'a', to: 'b' },
      { id: 'q', from: 'b', to: 'k' },
    ],
  }));
});
const toasts = () => useStore.getState().toasts.map((t) => `${t.kind}: ${t.text}`);
const path = (id: string) => useStore.getState().model.paths.find((p) => p.id === id);

it('PLS-SEM refuses a path the other way and a loop, pointing at CB-SEM', () => {
  useStore.getState().setSettings({ method: 'pls' });
  expect(useStore.getState().addPath('b', 'a')).toBe(false);
  expect(toasts()).toContainEqual(
    expect.stringContaining('switch to CB-SEM for a reciprocal effect'),
  );
  expect(useStore.getState().addPath('k', 'a')).toBe(false); // would close a -> b -> k -> a
  expect(toasts()).toContainEqual(expect.stringContaining('CB-SEM estimates non-recursive models'));
  // Reversing a -> k would close the same loop.
  useStore
    .getState()
    .commit((m) => ({ ...m, paths: [...m.paths, { id: 'r', from: 'a', to: 'k' }] }));
  useStore.getState().reversePath('r');
  expect(path('r')).toMatchObject({ from: 'a', to: 'k' });
  expect(toasts()).toContainEqual(
    expect.stringContaining('Reversing this path would create a cycle'),
  );
  expect(useStore.getState().model.paths.length).toBe(3);
});

it('CB-SEM accepts a reciprocal path and a loop, with a note about identification', () => {
  useStore.getState().setSettings({ method: 'cbsem' });
  expect(useStore.getState().addPath('b', 'a')).toBe(true);
  expect(useStore.getState().model.paths.length).toBe(3);
  expect(toasts()).toContainEqual(expect.stringMatching(/^info: Non-recursive model/));
  expect(useStore.getState().addPath('b', 'a')).toBe(false); // the same path twice: no
  expect(useStore.getState().addPath('k', 'a')).toBe(true); // a longer loop
  expect(useStore.getState().model.paths.length).toBe(4);
  // Reversing into a loop is allowed; reversing onto an existing path the other way is not.
  useStore.getState().reversePath('q');
  expect(path('q')).toMatchObject({ from: 'k', to: 'b' });
  useStore.getState().reversePath('p');
  expect(path('p')).toMatchObject({ from: 'a', to: 'b' });
  expect(toasts()).toContainEqual(expect.stringContaining('A path already runs that way'));
});
