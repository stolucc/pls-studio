// @vitest-environment happy-dom
// A card whose result cannot be shown says so; running it again (a new run)
// shows the new result instead of keeping the earlier failure.
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { addAnalysis, loadCards, useAnalyses } from '../../analyses/store';
import { useStore } from '../../store';
import { AnalysesWorkspace } from './AnalysesWorkspace';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const good = {
  y: 'x2',
  permutations: 0,
  conditions: [
    {
      x: 'x1',
      n: 3,
      scope: [1, 3, 1, 3],
      ceFdh: 0.25,
      crFdh: 0.2,
      intercept: null,
      slope: null,
      accuracy: null,
      p: null,
      peers: { x: [1], y: [1] },
      points: { x: [1], y: [1] },
      bottleneck: [{ y: 0, ceFdh: null, crFdh: null }],
    },
  ],
  warnings: [],
};

it('shows a later run’s result after an earlier one could not be shown', () => {
  useStore.getState().newProject();
  useStore
    .getState()
    .setData(
      { names: ['x1', 'x2'], cols: [Float64Array.from([1, 2, 3]), Float64Array.from([1, 3, 2])] },
      { fileName: 'd.csv', rows: 3, missingCells: 0, excluded: [] },
    );
  loadCards([]);
  const opts = { source: 'data', x: ['x1'], y: 'x2', permutations: 0, outliers: true };
  const id = addAnalysis('nca', opts)!;
  const options = JSON.stringify(opts);
  const setRun = (at: number, result: unknown) =>
    useAnalyses.setState((st) => ({
      cards: st.cards.map((c) =>
        c.kind === 'analysis' ? { ...c, run: { at, fingerprint: 'f', options } } : c,
      ),
      results: { [id]: result },
      errors: {},
    }));
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    setRun(1, { y: 'x2', permutations: 0, conditions: null, warnings: [] });
    act(() => root.render(<AnalysesWorkspace />));
    expect(host.textContent).toContain('This result cannot be shown');

    act(() => setRun(2, good));
    expect(host.textContent).not.toContain('This result cannot be shown');
  } finally {
    act(() => root.unmount());
    host.remove();
    spy.mockRestore();
  }
});
