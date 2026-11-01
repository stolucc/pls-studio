// Sharing a CB-SEM analysis as its covariance matrix instead of the raw data.

import { beforeEach, describe, expect, it } from 'vitest';
import { covarianceOnly, covarianceOnlyBlocked } from './io';
import { useStore } from './store';

const K = (id: string, ind: string[]) => ({ id, name: id, type: 'factor' as const, mode: 'A' as const, indicators: ind, x: 0, y: 0, side: 'left' as const });
beforeEach(() => {
  const s = useStore.getState();
  s.newProject();
  const col = (k: number) => Float64Array.from({ length: 40 }, (_, i) => ((i * (k + 3)) % 11) / 10 + (i % 5) * 0.1);
  s.setData({ names: ['x1', 'x2', 'y1', 'y2', 'g', 'z'], cols: [col(1), col(2), col(3), col(4), Float64Array.from({ length: 40 }, (_, i) => (i % 2) + 1), col(5)], categories: { g: ['women', 'men'] } },
    { fileName: 'survey.csv', rows: 40, missingCells: 0, excluded: [] });
  s.commit((m) => ({ ...m, constructs: [K('X', ['x1', 'x2']), K('Y', ['y1', 'y2'])], paths: [{ id: 'p', from: 'X', to: 'Y' }] }));
  s.setSettings({ method: 'cbsem', estimator: 'ML', engine: 'r' });
});

describe('covariance matrix instead of the raw data', () => {
  it('covers the model indicators only, listwise, with a matrix info', () => {
    expect(covarianceOnlyBlocked()).toBeNull();
    const { data, info, model } = covarianceOnly();
    expect(data.names).toEqual(['x1', 'x2', 'y1', 'y2']);
    expect(data.cols).toEqual([]);
    expect(data.moments!.n).toBe(40);
    expect(info).toMatchObject({ fileName: 'survey-covariances.csv', rows: 40, kind: 'matrix' });
    expect(model.multigroup).toBeUndefined();
  });
  it('with groups by a column: one matrix per group, and the model then groups by the matrices', () => {
    useStore.getState().setMultigroup({ column: 'g', invariance: 'metric', free: [] });
    expect(covarianceOnlyBlocked()).toBeNull();
    const { data, model } = covarianceOnly();
    expect(data.moments!.groups!.map((k) => [k.label, k.n])).toEqual([['women', 20], ['men', 20]]);
    expect(model.multigroup).toEqual({ column: '', invariance: 'metric', free: [] });
  });
  it('says why it is unavailable: not CB-SEM, no model, ordinal indicators, no data; a mean structure travels with the matrix', () => {
    useStore.getState().setSettings({ method: 'pls' });
    expect(covarianceOnlyBlocked()).toMatch(/CB-SEM only/);
    useStore.getState().setSettings({ method: 'cbsem' });
    // A mean structure is fine: the matrix carries the means.
    useStore.getState().addConstant();
    expect(covarianceOnlyBlocked()).toBeNull();
    expect(covarianceOnly().data.moments!.means!.length).toBe(4);
    useStore.getState().setOrdered(['x1'], true);
    expect(covarianceOnlyBlocked()).toMatch(/^With the covariance matrix: /);
    useStore.getState().newProject();
    expect(covarianceOnlyBlocked()).toBe('Import a dataset first.');
  });
});
