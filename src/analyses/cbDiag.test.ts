import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parseModelState, toSpec, validateModel, type ModelState } from '../model/project';
import { cbRequest } from '../rengine/lavaan';
import { LOCALFIT_TESTS } from '../rengine/cbDiag';
import { localFitAnalysis as lf, localTestProblem, zShade } from './cbDiag';
import { cbFingerprint } from './cbModel';
import type { AnalysisCtx } from './types';

const col = (...v: number[]) => Float64Array.from(v);
const K = (id: string, inds: string[]) => ({ id, name: id, type: 'factor' as const, mode: 'A' as const, indicators: inds, x: 0, y: 0, side: 'left' as const });
const model: ModelState = { constructs: [K('A', ['a1', 'a2', 'a3']), K('B', ['b1', 'b2', 'b3'])], paths: [{ id: 'p', from: 'A', to: 'B' }], moderations: [] };
const data = { names: ['a1', 'a2', 'a3', 'b1', 'b2', 'b3', 'age', 'g'], cols: Array.from({ length: 8 }, (_, i) => col(i, i + 1, i + 3, i + 2)) };
const settings = { ...DEFAULT_SETTINGS, method: 'cbsem' as const, engine: 'r' as const, estimator: 'ML' as const };
const ctx = (over: Partial<AnalysisCtx> = {}): AnalysisCtx => ({ data, info: null, settings, pls: null, projectName: 'p', model, ...over });

describe('local fit card', () => {
  it('reads its options strictly from project files', () => {
    expect(lf.parseOptions({ tests: ['peba4', 'evil(); x', 'browne.residual.adf', 'peba4'], base: 'RLS', top: 30 })).toEqual({ tests: ['browne.residual.adf', 'peba4'], base: 'RLS', top: 30 });
    expect(lf.parseOptions({ tests: 'peba4', base: 'x', top: '30' })).toEqual({ tests: [], base: 'standard', top: 15 });
    expect(lf.parseOptions({ top: 1e9 })!.top).toBe(500);
    expect(lf.parseOptions(null)).toBeNull();
  });

  it('says which tests do not apply to the model, and blocks a run that chose one', () => {
    expect(LOCALFIT_TESTS.map((t) => localTestProblem(t, ctx())).filter(Boolean)).toEqual([]);
    expect(localTestProblem('mean.var.adjusted.corrected', ctx({ settings: { ...settings, estimator: 'MLR' } }))).toBe('needs the ML estimator');
    expect(localTestProblem('scaled.shifted.corrected', ctx({ settings: { ...settings, missing: 'fiml' } }))).toMatch(/complete data/);
    expect(localTestProblem('scaled.shifted.corrected', ctx({ model: { ...model, multigroup: { column: 'g', invariance: 'configural', free: [] } } }))).toBe('is for one group');
    expect(localTestProblem('peba4', ctx({ settings: { ...settings, estimator: 'MLR' } }))).toMatch(/ML or MLM/);
    expect(localTestProblem('peba4', ctx({ settings: { ...settings, estimator: 'MLM' } }))).toBeNull();
    expect(localTestProblem('browne.residual.nt.model', ctx({ model: { ...model, ordered: ['a1'] } }))).toMatch(/continuous/);
    const o = lf.defaults(ctx());
    expect(lf.blocked(o, ctx())).toBeNull();
    expect(lf.blocked({ ...o, tests: ['peba4'] }, ctx({ settings: { ...settings, estimator: 'MLR' } }))).toMatch(/pEBA4.*needs the ML or MLM estimator: unselect it/);
    expect(lf.blocked(o, ctx({ settings: { ...settings, estimator: '2SLS' } }))).toMatch(/equation by equation/);
    expect(lf.blocked(o, ctx({ settings: { ...settings, missing: 'mi' } }))).toMatch(/multiple imputation/);
    expect(lf.blocked(o, ctx({ settings: { ...settings, method: 'pls' } }))).toMatch(/CB-SEM/);
    // Covariance matrices are fine (residuals need the moments only).
    expect(lf.blocked(o, ctx({ data: { names: data.names.slice(0, 6), cols: [], moments: { S: Array.from({ length: 6 }, (_, i) => Array.from({ length: 6 }, (__, j) => (i === j ? 1 : 0.3))), n: 100 } } }))).toBeNull();
  });

  it('is stale when the tests or their base change, not when only the number of listed residuals does', () => {
    const o = lf.defaults(ctx());
    expect(lf.fingerprint({ ...o, top: 3 }, ctx())).toBe(lf.fingerprint(o, ctx()));
    expect(lf.fingerprint({ ...o, base: 'RLS' }, ctx())).not.toBe(lf.fingerprint(o, ctx()));
    expect(lf.display).toEqual(['top']);
    expect(lf.summary(o)).toBe('residual z-tests, 2 further tests');
  });

  it('shades |z| ≥ 1.96 by sign and size', () => {
    expect(zShade(1.5)).toBeUndefined();
    expect(zShade(null)).toBeUndefined();
    expect(zShade(2)).toMatch(/^rgba\(42, 120, 214, /);
    expect(zShade(-2)).toMatch(/^rgba\(227, 73, 72, /);
    expect(Number(zShade(10)!.match(/([\d.]+)\)$/)![1])).toBeCloseTo(0.57, 6);
  });
});

describe('auxiliary variables of FIML and the two-stage approach', () => {
  const aux = { ...model, auxiliary: ['age'] };
  it('travel in the request with FIML and the two-stage approach only', () => {
    const r = cbRequest(data, toSpec(aux), 'fiml', 'ML');
    expect(r.model.auxiliary).toEqual(['age']);
    expect((r.data as { names: string[] }).names).toContain('age');
    expect(cbRequest(data, toSpec(aux), 'twostage', 'ML').model.auxiliary).toEqual(['age']);
    const cw = cbRequest(data, toSpec(aux), 'casewise', 'ML');
    expect(cw.model.auxiliary).toBeUndefined();
    expect((cw.data as { names: string[] }).names).not.toContain('age');
    expect(cbRequest(data, toSpec(model), 'fiml', 'ML').model.auxiliary).toBeUndefined();
  });

  it('make the CB-SEM cards stale when they or their column change', () => {
    const fiml = { ...settings, missing: 'fiml' as const };
    const f = cbFingerprint(ctx({ model: aux, settings: fiml }));
    expect(f).not.toBe(cbFingerprint(ctx({ settings: fiml })));
    expect(cbFingerprint(ctx({ model: aux, settings: fiml, data: { ...data, cols: [...data.cols.slice(0, 6), col(9, 9, 9, 9), data.cols[7]] } }))).not.toBe(f);
  });

  it('are validated: FIML or two-stage, raw continuous data, not indicators or other roles, no clusters', () => {
    const errs = (m: ModelState, s = {}, d: typeof data | null = data) => validateModel(m, d, { ...settings, missing: 'fiml', ...s }).filter((i) => i.level === 'error').map((i) => i.message);
    const warns = (m: ModelState, s = {}) => validateModel(m, data, { ...settings, ...s }).filter((i) => i.level === 'warning').map((i) => i.message);
    expect(errs(aux)).toEqual([]);
    expect(errs(aux, { missing: 'robusttwostage', estimator: 'MLR' })).toEqual([]);
    expect(warns(aux, { missing: 'casewise' }).some((m) => /auxiliary variables \(age\).*ignored/.test(m))).toBe(true);
    expect(warns(aux, { missing: 'mi' }).some((m) => /imputation’s own auxiliary variables/.test(m))).toBe(true);
    expect(errs({ ...model, auxiliary: ['nope'] })).toContain('Auxiliary variables not in the data: nope.');
    expect(errs({ ...model, auxiliary: ['a1'] })).toContain('Auxiliary variables must not be indicators of the model: a1.');
    expect(errs({ ...aux, auxiliary: ['g'], multigroup: { column: 'g', invariance: 'configural', free: [] } }).some((m) => /g already has a role/.test(m))).toBe(true);
    expect(errs({ ...aux, ordered: ['a1'] }, { estimator: 'WLSMV' }).some((m) => /continuous indicators/.test(m))).toBe(true);
    expect(errs({ ...aux, cluster: 'g' }).some((m) => /not available with clusters/.test(m))).toBe(true);
    expect(errs(aux, { engine: 'builtin' }).some((m) => /lavaan option/.test(m))).toBe(true);
  });

  it('survive a project file, strictly read', () => {
    const m = parseModelState({ ...model, auxiliary: ['age', 7, '', 'age', 'x'.repeat(300)] });
    expect(m.auxiliary).toEqual(['age', 'x'.repeat(200)]);
    expect(parseModelState({ ...model, auxiliary: 'age' }).auxiliary).toBeUndefined();
    expect(parseModelState({ ...model, auxiliary: [] }).auxiliary).toBeUndefined();
  });
});
