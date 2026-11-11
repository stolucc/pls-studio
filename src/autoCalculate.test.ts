import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const validate = vi.hoisted(() => vi.fn(() => [] as { level: string }[]));
const run = vi.hoisted(() => vi.fn());
vi.mock('./model/project', async (orig) => ({
  ...(await orig<typeof import('./model/project')>()),
  validateModel: validate,
}));
vi.mock('./runner', () => ({ run }));

import { AUTO_CALCULATE_DELAY, startAutoCalculate } from './autoCalculate';
import { DEFAULT_SETTINGS, type Construct } from './model/project';
import { useStore } from './store';

const C = (id: string, x: number): Construct => ({
  id,
  name: id.toUpperCase(),
  type: 'factor',
  mode: 'A',
  indicators: [`${id}1`, `${id}2`],
  x,
  y: 0,
  side: 'left',
});

beforeEach(() => {
  vi.useFakeTimers();
  useStore.setState({
    settings: { ...DEFAULT_SETTINGS, autoCalculate: true },
    job: null,
    results: null,
    data: {
      names: ['a1', 'a2', 'b1', 'b2'],
      cols: [
        [1, 2, 3],
        [2, 3, 4],
        [3, 4, 5],
        [5, 4, 3],
      ].map((c) => Float64Array.from(c)),
    },
    model: {
      constructs: [C('a', 0), C('b', 500)],
      paths: [{ id: 'p', from: 'a', to: 'b' }],
      moderations: [],
    },
  } as never);
  validate.mockClear();
  run.mockClear();
});
afterEach(() => vi.useRealTimers());

it('validates only after the delay, and only for changes that can affect a run', async () => {
  const stop = startAutoCalculate();
  // Selecting, hovering and the like neither validate nor start a run.
  for (let i = 0; i < 5; i++)
    useStore.setState({ selection: { kind: 'construct', id: 'a' } } as never);
  vi.advanceTimersByTime(AUTO_CALCULATE_DELAY * 2);
  expect(validate).not.toHaveBeenCalled();
  // A burst of model edits validates once, after the last.
  for (let i = 0; i < 5; i++)
    useStore.setState((s) => ({ model: { ...s.model, paths: [...s.model.paths] } }));
  expect(validate).not.toHaveBeenCalled();
  vi.advanceTimersByTime(AUTO_CALCULATE_DELAY);
  expect(validate).toHaveBeenCalledTimes(1);
  await vi.dynamicImportSettled();
  expect(run).toHaveBeenCalledWith('estimate');
  stop();
});
