import { describe, expect, it } from 'vitest';
import type { MissingTreatment } from '../engine/types';
import {
  DEFAULT_SETTINGS,
  parseProject,
  serializeProject,
  validateModel,
  type ModelState,
} from './project';

const col = () => Float64Array.from({ length: 100 }, (_, i) => (i * 7919) % 13);
const data = { names: ['a1', 'a2', 'a3', 'b1', 'b2', 'b3'], cols: Array.from({ length: 6 }, col) };
const K = (id: string, inds: string[]) => ({
  id,
  name: id,
  type: 'factor' as const,
  mode: 'A' as const,
  indicators: inds,
  x: 0,
  y: 0,
  side: 'left' as const,
});
const model: ModelState = {
  constructs: [K('A', ['a1', 'a2', 'a3']), K('B', ['b1', 'b2', 'b3'])],
  paths: [{ id: 'p', from: 'A', to: 'B' }],
  moderations: [],
};
const issues = (
  missing: MissingTreatment,
  over: Record<string, unknown> = {},
  m = model,
  d:
    | typeof data
    | { names: string[]; cols: Float64Array[]; moments: { S: number[][]; n: number } } = data,
) =>
  validateModel(m, d, {
    method: 'cbsem',
    consistent: false,
    engine: 'r',
    estimator: 'ML',
    missing,
    ...over,
  });
const errs = (...a: Parameters<typeof issues>) =>
  issues(...a)
    .filter((i) => i.level === 'error')
    .map((i) => i.message);

describe('CB-SEM pairwise deletion and the two-stage approach', () => {
  it('two-stage: ML, MLR, GLS or ULS, raw data, the R engine', () => {
    for (const est of ['ML', 'MLR', 'GLS', 'ULS'])
      expect(errs('twostage', { estimator: est })).toEqual([]);
    expect(errs('robusttwostage', { estimator: 'MLM' }).join()).toContain('ML, MLR, GLS or ULS');
    expect(errs('twostage', { engine: 'builtin' }).join()).toContain('the two-stage approach');
    const S = data.names.map((_, i) => data.names.map((__, j) => (i === j ? 1 : 0.3)));
    expect(
      errs('twostage', {}, model, { names: data.names, cols: [], moments: { S, n: 100 } }).join(),
    ).toContain('needs raw data');
    expect(errs('twostage', {}, { ...model, ordered: ['a1'] }).join()).toContain(
      'continuous indicators',
    );
  });

  it('pairwise: ML or ULS, with a warning about its standard errors', () => {
    expect(errs('pairwise')).toEqual([]);
    expect(
      issues('pairwise').some((i) => i.level === 'warning' && i.message.includes('too optimistic')),
    ).toBe(true);
    expect(errs('pairwise', { estimator: 'MLR' }).join()).toContain('ML or ULS');
  });

  it('are CB-SEM options: refused for PLS-SEM', () => {
    expect(
      validateModel(model, data, {
        method: 'pls',
        consistent: false,
        engine: 'r',
        missing: 'twostage',
      }).some((i) => i.level === 'error' && i.message.includes('CB-SEM option')),
    ).toBe(true);
  });

  it('are kept in project files', () => {
    for (const missing of ['pairwise', 'twostage', 'robusttwostage'] as const) {
      expect(
        parseProject(serializeProject(model, { ...DEFAULT_SETTINGS, missing }, null, null)).settings
          .missing,
      ).toBe(missing);
    }
  });
});
