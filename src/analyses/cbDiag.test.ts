import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parseModelState, toSpec, validateModel, type ModelState } from '../model/project';
import { cbRequest } from '../rengine/lavaan';
import { compareModelsRequest, epcCounts, epcVerdict, type EpcRow } from '../rengine/cbDiag';
import { dvClass, dvClassChi2, LOCALFIT_TESTS } from '../rengine/cbDiag';
import { compareModelsAnalysis as cm, compareModelsProblem, epcAnalysis as ep, discriminantAnalysis as dv, localFitAnalysis as lf, localTestProblem, zShade } from './cbDiag';
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

describe('discriminant validity card (Rönkkö & Cho 2022)', () => {
  it('classifies by the CI bound furthest from 0 (Table 12, CI-CFA(sys))', () => {
    expect(dvClass(0.3, 0.79)).toBe('none');
    expect(dvClass(0.6, 0.8)).toBe('marginal');
    expect(dvClass(0.8, 0.9)).toBe('moderate');
    expect(dvClass(0.93, 1.03)).toBe('severe');
    expect(dvClass(-0.95, -0.85)).toBe('moderate');
    expect(dvClass(null, 0.5)).toBeNull();
  });
  it('χ²(sys): the highest class the correlation is not significantly different from', () => {
    const t = (p: number | null) => ({ chisq: 1, df: 1, p });
    expect(dvClassChi2({ est: 0.97, cut80: t(1), cut90: t(1), cut100: t(0.3) })).toBe('severe');
    expect(dvClassChi2({ est: 0.88, cut80: t(1), cut90: t(0.2), cut100: t(0.001) })).toBe('moderate');
    expect(dvClassChi2({ est: 0.78, cut80: t(0.4), cut90: t(0.01), cut100: t(0.001) })).toBe('marginal');
    expect(dvClassChi2({ est: 0.82, cut80: t(0.01), cut90: t(0.01), cut100: t(0.001) })).toBe('marginal');
    expect(dvClassChi2({ est: 0.5, cut80: t(0.01), cut90: t(0.001), cut100: t(0.001) })).toBe('none');
    expect(dvClassChi2({ est: 0.5, cut80: t(null), cut90: t(0.001), cut100: t(0.001) })).toBeNull();
  });
  it('options, blocking and staleness', () => {
    expect(dv.parseOptions({ level: 0.9, merge: true })).toEqual({ level: 0.9, merge: true });
    expect(dv.parseOptions({ level: '0.9', merge: 'yes' })).toEqual({ level: 0.95, merge: false });
    expect(dv.parseOptions({ level: 2 })!.level).toBe(0.999);
    const o = dv.defaults(ctx());
    expect(dv.blocked(o, ctx())).toBeNull();
    expect(dv.blocked(o, ctx({ model: { ...model, constructs: [model.constructs[0]], paths: [] } }))).toMatch(/at least two factors/);
    expect(dv.blocked(o, ctx({ model: { ...model, multigroup: { column: 'g', invariance: 'configural', free: [] } } }))).toMatch(/one group/);
    expect(dv.blocked(o, ctx({ model: { ...model, constructs: [model.constructs[0], { ...model.constructs[1], type: 'composite' as const }] } }))).toMatch(/composites|common factors/);
    expect(dv.fingerprint({ ...o, merge: true }, ctx())).not.toBe(dv.fingerprint(o, ctx()));
    expect(dv.summary({ level: 0.95, merge: true })).toBe('95% CIs, χ²(sys) and χ²(merge)');
  });
});

describe('model comparison card (CB-SEM)', () => {
  const alt: ModelState = { ...model, paths: [] , correlations: [{ id: 'k', kind: 'construct', a: 'A', b: 'B' }] };
  const o = { alternative: { model: alt, savedAt: 5 }, nested: 'auto' as const };
  it('re-reads the saved alternative strictly from project files', () => {
    expect(cm.parseOptions(o)).toEqual(o);
    expect(cm.parseOptions({ alternative: { model: { constructs: 'x' }, savedAt: 1 }, nested: 'nested' })).toEqual({ alternative: null, nested: 'nested' });
    expect(cm.parseOptions({ alternative: { model: alt, savedAt: '9' }, nested: 'evil' })).toEqual({ alternative: { model: alt, savedAt: 0 }, nested: 'auto' });
    expect(cm.parseOptions(7)).toBeNull();
  });
  it('needs ML-family estimation, the same observed variables, a valid alternative that differs from the diagram', () => {
    expect(cm.blocked(o, ctx())).toBeNull();
    expect(compareModelsProblem({ ...o, alternative: null }, ctx())).toMatch(/Save the current model/);
    expect(compareModelsProblem(o, ctx({ settings: { ...settings, estimator: 'ULS' } }))).toMatch(/maximum-likelihood/);
    expect(compareModelsProblem(o, ctx({ model: { ...model, ordered: ['a1'] } }))).toMatch(/continuous/);
    expect(compareModelsProblem({ ...o, alternative: { model: { ...alt, constructs: [alt.constructs[0], { ...alt.constructs[1], indicators: ['b1', 'b2'] }] }, savedAt: 1 } }, ctx())).toMatch(/same observed variables/);
    expect(compareModelsProblem({ ...o, alternative: { model, savedAt: 1 } }, ctx())).toMatch(/still the alternative/);
    expect(compareModelsProblem({ ...o, alternative: { model: { ...alt, multigroup: { column: 'nope', invariance: 'configural', free: [] } }, savedAt: 1 } }, ctx())).toMatch(/cannot be fitted/);
    expect(cm.blocked(o, ctx({ data: { names: data.names.slice(0, 6), cols: [], moments: { S: [[1]], n: 10 } } }))).toMatch(/raw data/);
  });
  it('is stale when the alternative or the nesting choice changes', () => {
    const f = cm.fingerprint(o, ctx());
    expect(cm.fingerprint({ ...o, nested: 'nested' }, ctx())).not.toBe(f);
    expect(cm.fingerprint({ ...o, alternative: { model: { ...alt, correlations: [] }, savedAt: 5 } }, ctx())).not.toBe(f);
    expect(cm.fingerprint({ ...o, alternative: { model: alt, savedAt: 99 } }, ctx())).toBe(f);
  });
  it('sends the data columns of both models (the alternative’s grouping column too)', () => {
    const r = compareModelsRequest({ data, spec: toSpec(model), missing: 'casewise', estimator: 'ML', interaction: 'product' }, toSpec({ ...alt, multigroup: { column: 'g', invariance: 'configural', free: [] } }), 'auto');
    expect((r.data as { names: string[] }).names).toContain('g');
    expect(r.model.multigroup).toBeUndefined();
    expect(r.alternative.multigroup?.column).toBe('g');
    expect(r.compare).toEqual({ nested: 'auto' });
  });
});

describe('EPC-based judgement card (Saris, Satorra & van der Veld 2009)', () => {
  it('reads its options strictly and keeps the list display-only', () => {
    const d = ep.defaults(ctx());
    expect(ep.parseOptions({ ...d, stdLoad: 0.3, adjust: 'bonferroni', show: 'all' })).toEqual({ ...d, stdLoad: 0.3, adjust: 'bonferroni', show: 'all' });
    expect(ep.parseOptions({ stdLoad: '0.3', mialpha: 9, adjust: 'holm', show: 'x' })).toEqual({ ...d, mialpha: 0.5 });
    expect(ep.parseOptions(null)).toBeNull();
    expect(ep.display).toEqual(['show']);
    expect(ep.fingerprint({ ...d, show: 'all' }, ctx())).toBe(ep.fingerprint(d, ctx()));
    expect(ep.fingerprint({ ...d, cor: 0.2 }, ctx())).not.toBe(ep.fingerprint(d, ctx()));
  });
  it('is for continuous indicators of a model fitted as a whole', () => {
    const d = ep.defaults(ctx());
    expect(ep.blocked(d, ctx())).toBeNull();
    expect(ep.blocked(d, ctx({ model: { ...model, ordered: ['a1'] }, settings: { ...settings, estimator: 'WLSMV', missing: 'casewise' } }))).toMatch(/continuous/);
    expect(ep.blocked(d, ctx({ settings: { ...settings, estimator: '2SLS' } }))).toMatch(/equation by equation/);
  });
  it('counts the decisions and gives semTools’ global verdict', () => {
    const row = (decisionPow: string, decisionCi: string) => ({ decisionPow, decisionCi }) as EpcRow;
    const rows = [row('M', 'M'), row('EPC:M', 'I'), row('I', 'U'), row('EPC:NM', 'NM'), row('NM', 'NM')];
    expect(epcCounts(rows)).toEqual({ ci: { M: 1, I: 1, U: 1, NM: 2 }, pow: { M: 2, I: 1, NM: 2 } });
    expect(epcVerdict({ M: 1, I: 1, U: 1, NM: 2 })).toBe('UNDERPOWERED');
    expect(epcVerdict({ M: 1, I: 1, NM: 2 })).toBe('SUBSTANTIAL MISSPECIFICATION');
    expect(epcVerdict({ M: 0, I: 1, NM: 2 })).toBe('INCONCLUSIVE');
    expect(epcVerdict({ M: 0, I: 0, NM: 2 })).toBe('EQUIVALENT');
    expect(epcVerdict({ M: 0, I: 0, NM: 0 })).toBe('NO PARAMETERS EVALUATED');
  });
});
