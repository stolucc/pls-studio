import { describe, expect, it } from 'vitest';
import { arrowSlice, constructSlice, emptyModel, historySlice, layoutSlice, messageSlice, parameterSlice, projectSlice, resultsSlice, useStore, viewSlice, type State } from './store';

const slices = { historySlice, constructSlice, arrowSlice, layoutSlice, parameterSlice, projectSlice, resultsSlice, viewSlice, messageSlice };

// A store of plain state for one slice on its own.
function harness(initial: Partial<State>) {
  let state = { ...useStore.getState(), ...initial } as State;
  const get = () => state;
  const set: Parameters<typeof historySlice>[0] = (p) => { state = { ...state, ...(typeof p === 'function' ? p(state) : p) }; };
  return { get, set };
}

describe('the store slices', () => {
  it('give every action of the store exactly once', () => {
    const noop = (() => undefined) as never;
    const keys = Object.values(slices).flatMap((f) => Object.keys(f(noop, noop)));
    expect(new Set(keys).size).toBe(keys.length);
    const actions = Object.entries(useStore.getState()).filter(([, v]) => typeof v === 'function').map(([k]) => k);
    expect(keys.sort()).toEqual(actions.sort());
  });

  it('history: undo and redo model edits, on their own', () => {
    const { get, set } = harness({ model: emptyModel(), past: [], future: [], history: null, cloud: null });
    const h = historySlice(set, get);
    h.commit((m) => ({ ...m, paths: [{ id: 'p', from: 'a', to: 'b' }] }));
    expect(get().model.paths).toHaveLength(1);
    expect(get().dirty).toBe(true);
    h.undo();
    expect(get().model.paths).toHaveLength(0);
    expect(get().future).toHaveLength(1);
    h.redo();
    expect(get().model.paths).toHaveLength(1);
    expect(get().past).toHaveLength(1);
  });

  it('view: selection and display switches, on their own', () => {
    const { get, set } = harness({});
    const v = viewSlice(set, get);
    v.select('construct', 'c1');
    expect(get().selection).toEqual({ nodes: ['c1'], edges: [] });
    v.setShowIntercepts(true);
    expect(get().showIntercepts).toBe(true);
  });
});
