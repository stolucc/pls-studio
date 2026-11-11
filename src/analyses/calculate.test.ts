// Calculate from the top bar acts on what is in front of the person: the
// model on the Model tab, or the selected card on the Analyses tab.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resultsKey, useStore } from '../store';
import { calculateHere, calculateTarget } from './calculate';
import { logCurrentRun } from './runs';
import { addAnalysis, addText, loadCards, useAnalyses } from './store';

vi.mock('../runner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../runner')>()),
  run: vi.fn(),
}));
const { run } = await import('../runner');

const s = () => useStore.getState();
beforeEach(() => {
  s().newProject();
  useStore.setState({ cloud: null, toasts: [], workspace: 'analyses' });
  loadCards([]);
  vi.mocked(run).mockClear();
});

describe('what Calculate acts on', () => {
  it('is the model on the Model tab, and on the Analyses tab the selected analysis or model-run card', async () => {
    s().setWorkspace('model');
    expect(calculateTarget()).toEqual({ kind: 'model' });
    s().setWorkspace('analyses');
    expect(calculateTarget()).toEqual({ kind: 'model' }); // nothing selected
    const h = addText('heading', 'Section')!;
    expect(calculateTarget()).toEqual({ kind: 'model' }); // a heading is not runnable
    const n = addAnalysis('nca', { source: 'data', x: ['x'], y: 'y', permutations: 0 })!;
    expect(calculateTarget()).toEqual({
      kind: 'card',
      id: n,
      title: 'Necessary condition analysis',
    });
    s().setData(
      { names: ['a1', 'b1'], cols: [Float64Array.from([1, 2, 3]), Float64Array.from([2, 3, 5])] },
      { fileName: 'd.csv', rows: 3, missingCells: 0, excluded: [] },
    );
    const a = s().addConstruct(0, 0, ['a1']),
      b = s().addConstruct(1, 0, ['b1']);
    s().addPath(a, b);
    useStore.setState((x) => ({
      results: {
        pls: { n: 3 } as never,
        cb: null,
        miiv: null,
        boot: null,
        fitTest: null,
        key: resultsKey(x),
      },
    }));
    const r = (await logCurrentRun())!;
    expect(calculateTarget()).toEqual({ kind: 'run', id: r, title: 'Model v1' });
    useAnalyses.setState({ selected: h });
    expect(calculateTarget()).toEqual({ kind: 'model' });
  });

  it('runs the selected analysis card (blocked: it says why, nothing is calculated), opens a run card on the Model tab and calculates, or calculates the model', async () => {
    const n = addAnalysis('nca', { source: 'data', x: ['x'], y: 'y', permutations: 0 })!;
    await calculateHere('estimate');
    expect(useAnalyses.getState().errors[n]).toContain('raw data');
    expect(run).not.toHaveBeenCalled();
    s().setData(
      { names: ['a1', 'b1'], cols: [Float64Array.from([1, 2, 3]), Float64Array.from([2, 3, 5])] },
      { fileName: 'd.csv', rows: 3, missingCells: 0, excluded: [] },
    );
    const a = s().addConstruct(0, 0, ['a1']),
      b = s().addConstruct(1, 0, ['b1']);
    s().addPath(a, b);
    useStore.setState((x) => ({
      results: {
        pls: { n: 3 } as never,
        cb: null,
        miiv: null,
        boot: null,
        fitTest: null,
        key: resultsKey(x),
      },
    }));
    const v1 = (await logCurrentRun())!;
    s().removePaths([s().model.paths[0].id]);
    useStore.setState((x) => ({
      results: {
        pls: { n: 3 } as never,
        cb: null,
        miiv: null,
        boot: null,
        fitTest: null,
        key: resultsKey(x),
      },
    }));
    await logCurrentRun(); // v2, so v1 can be opened without the keep/discard question
    useAnalyses.setState({ selected: v1 });
    useStore.setState({ workspace: 'analyses' });
    await calculateHere('boot'); // v1 is selected: opened on the Model tab, then bootstrapped
    expect(s().workspace).toBe('model');
    expect(s().model.paths).toHaveLength(1);
    expect(run).toHaveBeenCalledWith('boot');
    useAnalyses.setState({ selected: null });
    useStore.setState({ workspace: 'analyses' });
    await calculateHere('estimate');
    expect(run).toHaveBeenLastCalledWith('estimate');
  });
});
