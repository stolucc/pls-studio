// The distribution-free estimator (ADF / WLS): offered for CB-SEM through lavaan,
// refused where it cannot work, kept in project files, exported to Mplus.

import { describe, expect, it } from 'vitest';
import { estimateCb } from '../engine/cbsem';
import { DEFAULT_SETTINGS, makeCovariancesExplicit, newId, parseProject, serializeProject, toSpec, validateModel, type ModelState } from './project';

const F = (name: string, indicators: string[]) => ({ id: newId('c'), name, type: 'factor' as const, mode: 'A' as const, indicators, x: 0, y: 0, side: 'left' as const });
const model: ModelState = makeCovariancesExplicit({ constructs: [F('A', ['a1', 'a2', 'a3']), F('B', ['b1', 'b2', 'b3'])], paths: [], moderations: [] });
const cols = Array.from({ length: 6 }, (_, j) => Float64Array.from({ length: 50 }, (_, i) => Math.sin(i * (j + 1)) + (i % 7) / 3));
const raw = { names: ['a1', 'a2', 'a3', 'b1', 'b2', 'b3'], cols };
const S = Array.from({ length: 6 }, (_, i) => Array.from({ length: 6 }, (_, j) => (i === j ? 1 : 0.3)));
const settings: typeof DEFAULT_SETTINGS = { ...DEFAULT_SETTINGS, method: 'cbsem', estimator: 'WLS', engine: 'r', missing: 'casewise' };
const errors = (m: ModelState, d: typeof raw | object, s = settings) => validateModel(m, d as never, s).filter((i) => i.level === 'error').map((i) => i.message).join(' | ');

describe('ADF (WLS)', () => {
  it('runs on raw data with the R engine', () => {
    expect(errors(model, raw)).toBe('');
  });
  it('needs raw data or a NACOV matrix, the R engine, and continuous indicators', () => {
    expect(errors(model, { names: raw.names, cols: [], moments: { S, n: 300 } })).toMatch(/NACOV/);
    expect(errors(model, raw, { ...settings, engine: 'builtin' })).toMatch(/done by lavaan/);
    expect(errors({ ...model, ordered: ['a1'] }, raw)).toMatch(/choose WLSMV/);
    expect(() => estimateCb(raw, toSpec(model), 'casewise', 'WLS')).toThrow(/done by lavaan/);
  });
  it('is kept in a project file', () => {
    expect(parseProject(serializeProject(model, settings, null, null)).settings.estimator).toBe('WLS');
  });
});
