// A card that works on the model on the canvas calculates the model first when the Model tab has no current
// results (ensureModelCalculated), so the Model tab and the card agree; it waits for the estimation job to end.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyModel, resultsKey, useStore } from '../store';
import { ensureModelCalculated } from './store';
import { ANALYSIS_TYPES } from './registry';

const runs: string[] = [];
vi.mock('../runner', async (orig) => ({
  ...(await orig<typeof import('../runner')>()),
  run: (kind: string) => {
    runs.push(kind);
    // As the runner does: the job is set at once, the results arrive later, then the job ends.
    useStore.getState().setJob({ kind: 'estimate', done: 0, total: 1, workers: 1, label: 'test' });
    setTimeout(() => {
      const s = useStore.getState();
      useStore.setState({
        results: { key: resultsKey(s), pls: null, cb: null, boot: null } as never,
      });
      s.setJob(null);
    }, 10);
  },
}));

describe('a card that works on the model', () => {
  beforeEach(() => {
    runs.length = 0;
    useStore.setState({
      model: emptyModel(),
      results: null,
      job: null,
      data: {
        names: ['a1', 'b1'],
        cols: [Float64Array.from([1, 2, 3]), Float64Array.from([2, 1, 3])],
      },
    });
  });

  it('calculates the model first and waits for the job, and not when results are current', async () => {
    useStore.getState().addConstruct(0, 0, ['a1']);
    await ensureModelCalculated();
    expect(runs).toEqual(['estimate']);
    expect(useStore.getState().job).toBeNull();
    expect(useStore.getState().results?.key).toBe(resultsKey(useStore.getState()));
    await ensureModelCalculated();
    expect(runs).toEqual(['estimate']);
  });

  it('does nothing without data', async () => {
    useStore.setState({ data: null });
    await ensureModelCalculated();
    expect(runs).toEqual([]);
  });

  it('is declared by the cards that fit the model or read its scores', () => {
    const flagged = ANALYSIS_TYPES.filter((t) => t.fitsModel).map((t) => t.id);
    for (const id of [
      'dynamicfit',
      'bollenstine',
      'cbcompare',
      'scoreweights',
      'plspredict',
      'blindfold',
      'compare',
      'mga',
      'cta',
      'cca',
      'bsem',
      'nca',
      'qca',
      'endo',
      'minsample',
      'cmb',
    ])
      expect(flagged, id).toContain(id);
    const nca = ANALYSIS_TYPES.find((t) => t.id === 'nca')!;
    expect((nca.fitsModel as (o: unknown) => boolean)({ source: 'scores' })).toBe(true);
    expect((nca.fitsModel as (o: unknown) => boolean)({ source: 'columns' })).toBe(false);
  });
});
