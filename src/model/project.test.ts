import { describe, expect, it } from 'vitest';
import { covarianceLayout } from '../components/CovarianceLayer';
import { correlationEndError, correlationPairError, createsCycle, DEFAULT_SETTINGS, exogenousPairs, impliedCorrelations, impliedIntercepts, type Construct, type ModelState, parseProject, parseSettings, pruneCorrelations, pruneMeans, serializeProject, type Settings, toSpec, validateModel } from './project';

const data = { names: ['a1', 'a2', 'b1', 'c1'], cols: [1, 2, 3, 4].map(() => Float64Array.from({ length: 100 }, (_, i) => i % 7)) };
const C = (id: string, name: string, indicators: string[]) => ({ id, name, type: 'factor' as const, mode: 'A' as const, indicators, x: 0, y: 0, side: 'left' as const });
const base: ModelState = {
  constructs: [C('A', 'Alpha', ['a1', 'a2']), C('B', 'Beta', ['b1'])],
  paths: [{ id: 'p1', from: 'A', to: 'B' }],
  moderations: [],
};
const errors = (m: ModelState, d = data) => validateModel(m, d).filter((i) => i.level === 'error').map((i) => i.message);

describe('validateModel', () => {
  it('accepts a valid model', () => expect(errors(base)).toEqual([]));
  it('requires data', () => expect(errors(base, null as never)).toContain('Import a dataset first.'));
  it('flags empty constructs, shared and unknown indicators, isolation', () => {
    const m: ModelState = {
      constructs: [C('A', 'Alpha', ['a1', 'zz']), C('B', 'Beta', ['a1']), C('D', 'Delta', [])],
      paths: [{ id: 'p1', from: 'A', to: 'B' }],
      moderations: [],
    };
    const e = errors(m);
    expect(e.some((x) => x.includes('"a1" is assigned to both'))).toBe(true);
    expect(e.some((x) => x.includes('"zz"') && x.includes('not in the current dataset'))).toBe(true);
    expect(e.some((x) => x.includes('"Delta" has no indicators'))).toBe(true);
    expect(e.some((x) => x.includes('"Delta" is not connected'))).toBe(true);
  });
  it('flags duplicate names and cycles', () => {
    const m: ModelState = {
      constructs: [C('A', 'X', ['a1']), C('B', 'x', ['b1'])],
      paths: [{ id: 'p1', from: 'A', to: 'B' }, { id: 'p2', from: 'B', to: 'A' }],
      moderations: [],
    };
    const e = errors(m);
    expect(e.some((x) => x.includes('used more than once'))).toBe(true);
    expect(e.some((x) => x.includes('cycle'))).toBe(true);
  });
  it('warns on small samples', () => {
    const small = { names: data.names, cols: data.cols.map((c) => c.slice(0, 5)) };
    expect(validateModel(base, small).some((i) => i.level === 'warning' && i.message.includes('10-times'))).toBe(true);
  });
});

describe('createsCycle', () => {
  const paths = [{ id: '1', from: 'A', to: 'B' }, { id: '2', from: 'B', to: 'C' }];
  it('detects direct, indirect and self loops', () => {
    expect(createsCycle(paths, 'C', 'A')).toBe(true);
    expect(createsCycle(paths, 'A', 'A')).toBe(true);
    expect(createsCycle(paths, 'A', 'C')).toBe(false);
  });
});

describe('project files', () => {
  it('round-trips model, settings and data (including NaN)', () => {
    const d = { names: ['a1'], cols: [Float64Array.from([1, NaN, 3])] };
    const text = serializeProject(base, { ...DEFAULT_SETTINGS, bootSamples: 500 }, d, { fileName: 'x.csv', rows: 3, missingCells: 1, excluded: [] });
    const p = parseProject(text);
    expect(p.model).toEqual(base);
    expect(p.settings.bootSamples).toBe(500);
    expect(Number.isNaN(p.data!.cols[0][1])).toBe(true);
    expect(p.info!.missingCells).toBe(1);
    expect(toSpec(p.model).paths).toEqual([{ from: 'Alpha', to: 'Beta' }]);
  });
  it('rejects foreign or malformed files', () => {
    expect(() => parseProject('nope')).toThrow(/not valid JSON/);
    expect(() => parseProject('{"format":"other"}')).toThrow(/Not a PLS Studio/);
    const bad = JSON.parse(serializeProject(base, DEFAULT_SETTINGS, null, null));
    bad.model.paths[0].to = 'ghost';
    expect(() => parseProject(JSON.stringify(bad))).toThrow(/unknown construct/);
  });
  it('clamps out-of-range settings', () => {
    const f = JSON.parse(serializeProject(base, DEFAULT_SETTINGS, null, null));
    f.settings = { bootSamples: 1e9, maxIter: -5, scheme: '<script>', confidence: 7 };
    const p = parseProject(JSON.stringify(f));
    expect(p.settings.bootSamples).toBe(100000);
    expect(p.settings.maxIter).toBe(10);
    expect(p.settings.scheme).toBe('path');
    expect(p.settings.confidence).toBe(0.999);
  });
});

describe('method-specific validation', () => {
  const composite: ModelState = {
    ...base,
    constructs: base.constructs.map((c, i) => (i === 0 ? { ...c, type: 'composite' as const, mode: 'B' as const } : c)),
  };
  it('CB-SEM rejects composites with the built-in engine only; PLS accepts them', () => {
    expect(errors(composite)).toEqual([]);
    const cb = (engine: 'r' | 'builtin') => validateModel(composite, data, { method: 'cbsem', consistent: false, engine }).filter((i) => i.level === 'error' && i.message.includes('composite'));
    expect(cb('builtin').some((i) => i.message.includes('estimated by lavaan'))).toBe(true);
    expect(cb('r')).toEqual([]);
  });
  it('warns about Mode B common factors under PLSc', () => {
    const m: ModelState = { ...base, constructs: base.constructs.map((c, i) => (i === 0 ? { ...c, mode: 'B' as const } : c)) };
    expect(validateModel(m, data, { method: 'pls', consistent: true }).some((i) => i.message.includes('PLSc'))).toBe(true);
  });
  it('migrates old project files: Mode B becomes a composite', () => {
    const f = JSON.parse(serializeProject(base, DEFAULT_SETTINGS, null, null));
    f.model.constructs.forEach((c: Record<string, unknown>) => delete c.type);
    f.model.constructs[1].mode = 'B';
    delete f.settings.method;
    const p = parseProject(JSON.stringify(f));
    expect(p.model.constructs.map((c) => c.type)).toEqual(['factor', 'composite']);
    expect(p.settings.method).toBe('pls');
    expect(p.settings.consistent).toBe(false);
  });
});

describe('project files with a simulation design', () => {
  it('round-trips the design and drops an invalid one', async () => {
    const { defaultDesign, populationFromModel } = await import('./simulation');
    const design = defaultDesign(populationFromModel(base, null, null));
    const p = parseProject(serializeProject(base, DEFAULT_SETTINGS, null, null, design));
    expect(p.simulation).toEqual(design);
    const f = JSON.parse(serializeProject(base, DEFAULT_SETTINGS, null, null, design));
    f.simulation = 'garbage';
    expect(parseProject(JSON.stringify(f)).simulation).toBeNull();
  });
});

describe('higher-order constructs and covariates', () => {
  const cbs = { method: 'cbsem' as const, consistent: false };
  const m: ModelState = {
    constructs: [C('A', 'Alpha', ['a1']), C('B', 'Beta', ['b1']), { ...C('H', 'High', []), components: ['A', 'B'] }, { ...C('X', 'Cov', ['c1']), covariate: true }],
    paths: [{ id: 'p1', from: 'X', to: 'H' }],
    moderations: [],
  };
  const d4 = { names: ['a1', 'b1', 'c1'], cols: [0, 1, 2].map(() => Float64Array.from({ length: 100 }, (_, i) => i % 5)) };
  it('maps components to names and covariates in the engine spec', () => {
    const spec = toSpec(m);
    expect(spec.constructs[2].components).toEqual(['Alpha', 'Beta']);
    expect(spec.constructs[3].covariate).toBe(true);
  });
  it('accepts them in CB-SEM, and in PLS through cSEM or seminr with PLS path modeling', () => {
    expect(validateModel(m, d4, cbs).filter((i) => i.level === 'error')).toEqual([]);
    const pls = (o: object) => validateModel(m, d4, { method: 'pls', consistent: false, ...o }).filter((i) => i.level === 'error' && i.constructId === 'H').map((i) => i.message);
    expect(pls({})).toEqual([]);
    expect(pls({ engine: 'builtin' })[0]).toMatch(/second-order construct: in PLS these are estimated by cSEM or seminr. Choose “R packages”/);
    expect(pls({ plsPackage: 'seminr' })).toEqual([]);
    expect(validateModel(m, d4, { method: 'pls', consistent: true, plsPackage: 'seminr' }).some((i) => i.constructId === 'H' && i.level === 'error' && /Choose cSEM, or turn off PLSc for seminr/.test(i.message))).toBe(true);
    expect(pls({ plsApproach: 'GSCA' })[0]).toMatch(/PLS-PM/);
  });
  it('PLS: components are first-order constructs outside the structural model', () => {
    const inModel: ModelState = { ...m, paths: [...m.paths, { id: 'p2', from: 'A', to: 'X' }] };
    const e = validateModel(inModel, d4, { method: 'pls', consistent: false }).filter((i) => i.level === 'error').map((i) => i.message);
    expect(e.some((x) => x.includes('"Alpha" is a component of "High" and cannot also be in the structural model'))).toBe(true);
    const nested: ModelState = { ...m, constructs: [...m.constructs, { ...C('T', 'Top', []), components: ['H', 'A'] }], paths: [{ id: 'p3', from: 'T', to: 'X' }] };
    expect(validateModel(nested, d4, { method: 'pls', consistent: false }).some((i) => i.message.includes('"High" is a component of "Top": in PLS, components are first-order constructs with indicators'))).toBe(true);
  });
  it('rejects components with incoming paths and covariates with predictors', () => {
    const bad: ModelState = { ...m, paths: [...m.paths, { id: 'p2', from: 'X', to: 'A' }, { id: 'p3', from: 'A', to: 'X' }] };
    const e = validateModel(bad, d4, cbs).map((i) => i.message);
    expect(e.some((x) => x.includes('component of "High"'))).toBe(true);
    expect(e.some((x) => x.includes('Covariate "Cov" cannot have incoming paths'))).toBe(true);
  });
});

describe('inequality constraints', () => {
  const C = (id: string, inds: string[]) => ({ id, name: id, type: 'factor' as const, mode: 'A' as const, indicators: inds, x: 0, y: 0, side: 'left' as const });
  const m: ModelState = { constructs: [{ ...C('F', ['a1', 'a2', 'a3']), loadingLabels: { a2: 'b' } }], paths: [], moderations: [] };
  it('parses one per line on labels, prints them for lavaan, and keeps the variance bound', () => {
    const spec = toSpec({ ...m, inequalities: 'b > 0.5\n\nb < 2', positiveVariances: true });
    expect(spec.inequalities).toEqual(['b > 0.5', 'b < 2']);
    expect(spec.positiveVariances).toBe(true);
  });
  it('reports unknown names and malformed lines, and keeps them in project files', () => {
    const errs = (text: string) => validateModel({ ...m, inequalities: text }, null, { method: 'cbsem', consistent: false, estimator: 'ML' }).filter((i) => i.level === 'error' && i.message.startsWith('Inequality')).map((i) => i.message);
    expect(errs('c > 0')[0]).toMatch(/c is not a label/);
    expect(errs('b >= 0')[0]).toMatch(/Write an inequality/);
    expect(errs('b > 0 > 1')[0]).toMatch(/Write an inequality/);
    expect(errs('b > 0', ).length).toBe(0);
    expect(validateModel({ ...m, positiveVariances: true }, null, { method: 'cbsem', consistent: false, estimator: '2SLS' }).some((i) => i.level === 'error' && /MIIV-2SLS/.test(i.message))).toBe(true);
    const file = parseProject(serializeProject({ ...m, inequalities: 'b > 0', positiveVariances: true }, DEFAULT_SETTINGS, null, null));
    expect(file.model).toMatchObject({ inequalities: 'b > 0', positiveVariances: true });
  });
});

describe('single indicator with known reliability', () => {
  const C = (id: string, inds: string[]) => ({ id, name: id, type: 'factor' as const, mode: 'A' as const, indicators: inds, x: 0, y: 0, side: 'left' as const });
  const m = (reliability: number, extra = {}): ModelState => ({ constructs: [C('F', ['a1', 'a2', 'a3']), { ...C('G', ['b1']), reliability, ...extra }], paths: [{ id: 'p', from: 'F', to: 'G' }], moderations: [] });
  const cbs = { method: 'cbsem' as const, consistent: false, estimator: 'ML' as const };
  const errs = (x: ModelState) => validateModel(x, null, cbs).filter((i) => i.level === 'error' && /reliability/.test(i.message)).map((i) => i.message);
  it('passes the reliability to the spec for a single-indicator factor only', () => {
    expect(toSpec(m(0.8)).constructs[1].reliability).toBe(0.8);
    expect(toSpec(m(0.8, { covariate: true })).constructs[1].reliability).toBeUndefined();
    expect(toSpec(m(0.8, { indicators: ['b1', 'b2'] })).constructs[1].reliability).toBeUndefined();
  });
  it('requires 0 < r <= 1 on a single indicator, and keeps it in project files', () => {
    expect(errs(m(0.8))).toEqual([]);
    expect(errs(m(1))).toEqual([]);
    expect(errs(m(0))[0]).toMatch(/above 0 and at most 1/);
    expect(errs(m(1.2))[0]).toMatch(/above 0 and at most 1/);
    expect(errs(m(0.8, { covariate: true }))[0]).toMatch(/single-indicator factor only/);
    expect(errs(m(0.8, { indicators: ['b1', 'b2'] }))[0]).toMatch(/single-indicator factor only/);
    expect(validateModel(m(0.8), null, { ...cbs, estimator: '2SLS' }).some((i) => i.level === 'error' && /MIIV-2SLS/.test(i.message))).toBe(true);
    expect(parseProject(serializeProject(m(0.75), DEFAULT_SETTINGS, null, null)).model.constructs[1].reliability).toBe(0.75);
    expect(parseProject(serializeProject(m(7), DEFAULT_SETTINGS, null, null)).model.constructs[1].reliability).toBeUndefined();
  });
});

describe('composites in CB-SEM', () => {
  const C = (id: string, inds: string[], type: 'factor' | 'composite' = 'factor') => ({ id, name: id, type, mode: type === 'composite' ? 'B' as const : 'A' as const, indicators: inds, x: 0, y: 0, side: 'left' as const });
  const m: ModelState = { constructs: [C('K', ['k1', 'k2', 'k3'], 'composite'), C('F', ['a1', 'a2', 'a3'])], paths: [{ id: 'p', from: 'K', to: 'F' }], moderations: [] };
  const cbs = { method: 'cbsem' as const, consistent: false, estimator: 'ML' as const };
  const errs = (x: ModelState, extra = {}) => validateModel(x, null, { ...cbs, ...extra }).filter((i) => i.level === 'error' && i.message.includes('"K"') || i.message.includes('Composite "K"')).map((i) => i.message);
  it('are estimated by lavaan (R engine) and keep their type in the spec', () => {
    expect(errs(m)).toEqual([]);
    expect(toSpec(m).constructs[0].type).toBe('composite');
  });
  it('are refused where lavaan’s composites do not apply', () => {
    expect(errs(m, { engine: 'builtin' })[0]).toMatch(/estimated by lavaan/);
    expect(errs(m, { estimator: '2SLS' })[0]).toMatch(/MIIV-2SLS/);
    expect(errs(m, { estimator: 'RML' })[0]).toMatch(/robust ML/);
    expect(errs(m, { missing: 'mi' })[0]).toMatch(/multiple imputation/);
    expect(errs({ ...m, constructs: [C('K', ['k1'], 'composite'), m.constructs[1]] })[0]).toMatch(/at least two indicators/);
    expect(errs({ ...m, multigroup: { column: 'g', invariance: 'configural', free: [] } })[0]).toMatch(/multiple-group/);
    expect(errs({ ...m, correlations: [{ id: 'e', kind: 'indicator', a: 'k1', b: 'k2' }] })[0]).toMatch(/covary freely/);
    expect(errs({ ...m, constructs: [{ ...m.constructs[0], loadingLabels: { k2: 'w' } }, m.constructs[1]] })[0]).toMatch(/cannot be fixed or labelled/);
    expect(errs({ ...m, constructs: [...m.constructs, { ...C('H', []), components: ['K', 'F'] }] })[0]).toMatch(/higher-order/);
    expect(errs({ ...m, constructs: [...m.constructs, C('Z', ['z1', 'z2'])], moderations: [{ id: 'mo', moderator: 'Z', path: 'p' }] })[0]).toMatch(/latent interactions/);
  });
  it('draw no error terms on composite indicators; a single indicator with a known reliability gets one', () => {
    const withRel: ModelState = { ...m, constructs: [...m.constructs, { ...C('S', ['s1']), reliability: 0.8 }, C('T', ['t1'])] };
    const places = covarianceLayout(withRel, true, true).places;
    expect([...places.keys()].sort()).toEqual(['a1', 'a2', 'a3', 's1']);
  });
});

describe('multiple imputation', () => {
  const C = (id: string, inds: string[]) => ({ id, name: id, type: 'factor' as const, mode: 'A' as const, indicators: inds, x: 0, y: 0, side: 'left' as const });
  const m: ModelState = { constructs: [C('F', ['a1', 'a2', 'a3']), C('G', ['b1', 'b2'])], paths: [{ id: 'p', from: 'F', to: 'G' }], moderations: [] };
  const col = (f: (i: number) => number) => Float64Array.from({ length: 100 }, (_, i) => f(i));
  const d = { names: ['a1', 'a2', 'a3', 'b1', 'b2'], cols: [col((i) => (i % 9 ? i % 5 : NaN)), col((i) => i % 7), col((i) => i % 3), col((i) => i % 4), col((i) => i % 6)] };
  const errs = (o: object) => validateModel(m, d, { method: 'cbsem', consistent: false, estimator: 'ML', missing: 'mi', ...o }).filter((i) => i.level === 'error').map((i) => i.message);
  it('CB-SEM: ML or MLR with the R engine, also with groups', () => {
    expect(errs({})).toEqual([]);
    expect(validateModel({ ...m, multigroup: { column: 'b1', invariance: 'metric', free: [] } }, d, { method: 'cbsem', consistent: false, estimator: 'ML', missing: 'mi' })
      .filter((i) => i.level === 'error' && /Multiple imputation/.test(i.message))).toEqual([]);
    expect(errs({ estimator: 'MLR' })).toEqual([]);
    expect(errs({ estimator: 'GLS' })[0]).toMatch(/ML or MLR estimator/);
    expect(errs({ engine: 'builtin' })[0]).toMatch(/mice and lavaan.mi/);
  });
  it('PLS-SEM: the R engine; CPA: not available', () => {
    expect(errs({ method: 'pls' })).toEqual([]);
    expect(errs({ method: 'pls', engine: 'builtin' })[0]).toMatch(/uses mice/);
    expect(errs({ method: 'process' }).some((x) => /available in PLS-SEM and CB-SEM/.test(x))).toBe(true);
  });
  it('the number of imputations is kept and bounded', () => {
    const file = JSON.parse(serializeProject(m, { ...DEFAULT_SETTINGS, missing: 'mi', miImputations: 7 }, null, null));
    expect(parseProject(JSON.stringify(file)).settings).toMatchObject({ missing: 'mi', miImputations: 7 });
    file.settings.miImputations = 5000;
    expect(parseProject(JSON.stringify(file)).settings.miImputations).toBe(200);
  });
});

describe('robust ML (rsem)', () => {
  const C = (id: string, inds: string[]) => ({ id, name: id, type: 'factor' as const, mode: 'A' as const, indicators: inds, x: 0, y: 0, side: 'left' as const });
  const m: ModelState = { constructs: [C('F', ['a1', 'a2', 'a3'])], paths: [], moderations: [] };
  const col = (f: (i: number) => number) => Float64Array.from({ length: 100 }, (_, i) => f(i));
  const d = { names: ['a1', 'a2', 'a3', 'g'], cols: [col((i) => i % 5), col((i) => i % 7), col((i) => i % 3), col((i) => 1 + (i % 2))] };
  const errs = (model: ModelState, o: object = {}) => validateModel(model, d, { method: 'cbsem', consistent: false, estimator: 'RML', ...o }).filter((i) => i.level === 'error').map((i) => i.message);
  it('needs R and one group of continuous indicators; FIML (EM) is fine', () => {
    expect(errs(m)).toEqual([]);
    expect(errs(m, { missing: 'fiml' })).toEqual([]);
    expect(errs(m, { engine: 'builtin' })[0]).toMatch(/rsem with lavaan/);
    expect(errs({ ...m, multigroup: { column: 'g', invariance: 'configural', free: [] } }).some((x) => /one group of continuous indicators/.test(x))).toBe(true);
    expect(errs({ ...m, ordered: ['a1'] }).some((x) => /one group of continuous indicators/.test(x))).toBe(true);
  });
  it('is kept when a project is saved and loaded', () => {
    const file = JSON.parse(serializeProject(m, { ...DEFAULT_SETTINGS, method: 'cbsem', estimator: 'RML' }, null, null));
    expect(parseProject(JSON.stringify(file)).settings.estimator).toBe('RML');
  });
});

describe('sampling weights (CB-SEM)', () => {
  const C = (id: string, inds: string[]) => ({ id, name: id, type: 'factor' as const, mode: 'A' as const, indicators: inds, x: 0, y: 0, side: 'left' as const });
  const m: ModelState = { constructs: [C('F', ['a1', 'a2', 'a3'])], paths: [], moderations: [], weights: 'w' };
  const col = (f: (i: number) => number) => Float64Array.from({ length: 100 }, (_, i) => f(i));
  const d = { names: ['a1', 'a2', 'a3', 'w'], cols: [col((i) => i % 5), col((i) => i % 7), col((i) => i % 3), col((i) => 1 + (i % 4))] };
  const errs = (model: ModelState, o: object = {}, data = d) => validateModel(model, data, { method: 'cbsem', consistent: false, estimator: 'ML', ...o }).filter((i) => i.level === 'error').map((i) => i.message);
  it('accepts a complete non-negative column with ML / MLR / MLM, and carries it in the spec', () => {
    expect(errs(m)).toEqual([]);
    expect(errs(m, { estimator: 'MLR' })).toEqual([]);
    expect(toSpec(m).weights).toBe('w');
  });
  it('rejects other estimators, the built-in engine, bad weights and clashes', () => {
    expect(errs(m, { estimator: 'GLS' })[0]).toMatch(/ML, MLR or MLM/);
    expect(errs(m, { engine: 'builtin' })[0]).toMatch(/R packages/);
    const neg = { ...d, cols: d.cols.map((c, k) => (k === 3 ? Float64Array.from(c, (v, i) => (i === 5 ? -1 : v)) : c)) };
    expect(errs(m, {}, neg)[0]).toMatch(/non-negative numbers without missing values/);
    expect(errs({ ...m, weights: 'a1' })[0]).toMatch(/cannot be both the sampling weights and an indicator/);
    expect(errs({ ...m, multilevel: { column: 'w', between: 'saturated' } }).some((x) => /two-level/.test(x))).toBe(true);
  });
  it('warns that PLS-SEM ignores them, and survives a save and load', () => {
    expect(validateModel(m, d, { method: 'pls', consistent: false }).some((i) => i.level === 'warning' && /PLS-SEM ignores them/.test(i.message))).toBe(true);
    const file = JSON.parse(serializeProject(m, DEFAULT_SETTINGS, null, null));
    expect(parseProject(JSON.stringify(file)).model.weights).toBe('w');
  });
});

describe('correlations (double-headed arrows)', () => {
  const cbs = { method: 'cbsem' as const, consistent: false };
  const d = { names: ['a1', 'a2', 'b1', 'b2', 'c1', 'c2', 'x1'], cols: Array.from({ length: 7 }, (_, k) => Float64Array.from({ length: 100 }, (_, i) => (i * (k + 2)) % 11)) };
  const m: ModelState = {
    constructs: [C('A', 'Alpha', ['a1', 'a2']), C('B', 'Beta', ['b1', 'b2']), C('G', 'Gamma', ['c1', 'c2']), C('X', 'Solo', ['x1'])],
    paths: [{ id: 'p1', from: 'A', to: 'B' }, { id: 'p2', from: 'A', to: 'G' }, { id: 'p3', from: 'X', to: 'B' }],
    moderations: [],
    correlations: [{ id: 'k1', kind: 'construct', a: 'B', b: 'G' }, { id: 'k2', kind: 'indicator', a: 'a1', b: 'b2' }],
  };
  const errs = (model: ModelState) => validateModel(model, d, cbs).filter((i) => i.level === 'error').map((i) => i.message);

  it('accepts disturbance and error correlations in CB-SEM; PLS only warns', () => {
    expect(errs(m)).toEqual([]);
    const pls = validateModel(m, d, { method: 'pls', consistent: false });
    expect(pls.some((i) => i.level === 'warning' && i.message.includes('PLS-SEM ignores them'))).toBe(true);
  });
  it('rejects exogenous–endogenous pairs and single-indicator errors', () => {
    expect(errs({ ...m, correlations: [{ id: 'k', kind: 'construct', a: 'A', b: 'B' }] }).some((e) => e.includes('exogenous construct with an endogenous'))).toBe(true);
    expect(errs({ ...m, correlations: [{ id: 'k', kind: 'indicator', a: 'x1', b: 'a1' }] }).some((e) => e.includes('single-indicator'))).toBe(true);
  });
  it('round-trips through project files and rejects unknown references', () => {
    const p = parseProject(serializeProject(m, DEFAULT_SETTINGS, null, null));
    expect(p.model.correlations).toEqual(m.correlations);
    const bad = { ...m, correlations: [{ id: 'k', kind: 'indicator' as const, a: 'a1', b: 'zz' }] };
    expect(() => parseProject(serializeProject(bad, DEFAULT_SETTINGS, null, null))).toThrow(/correlation/);
    // Files without correlations keep their old shape.
    expect('correlations' in parseProject(serializeProject(base, DEFAULT_SETTINGS, null, null)).model).toBe(false);
  });
  it('prunes correlations whose constructs or indicators are gone', () => {
    const without = { ...m, constructs: m.constructs.filter((c) => c.id !== 'G').map((c) => (c.id === 'A' ? { ...c, indicators: ['a2'] } : c)) };
    expect(pruneCorrelations(without).correlations).toEqual([]);
    expect(pruneCorrelations(m)).toBe(m);
  });
});

describe('exogenous correlations are explicit (the diagram is the model)', () => {
  const m: ModelState = {
    constructs: [C('A', 'Alpha', ['a1', 'a2']), C('B', 'Beta', ['b1', 'b2']), C('G', 'Gamma', ['c1', 'c2']),
      { ...C('X', 'Age', ['x1']), covariate: true }, { ...C('Y', 'Sex', ['y1']), covariate: true }, C('E', 'Empty', [])],
    paths: [{ id: 'p1', from: 'A', to: 'G' }, { id: 'p2', from: 'B', to: 'G' }, { id: 'p3', from: 'X', to: 'G' }],
    moderations: [],
  };
  const data = { names: ['a1', 'a2', 'b1', 'b2', 'c1', 'c2', 'x1', 'y1'], cols: Array.from({ length: 8 }, (_, k) => Float64Array.from({ length: 80 }, (_, i) => Math.sin(i * (k + 1.7)) + (i % (k + 3)))) };
  const cb = { method: 'cbsem' as const, consistent: false };
  const asked = (model: ModelState) => validateModel(model, data, cb).filter((i) => i.action === 'exogenous-correlations');
  it('choices are exogenous latent pairs; implied arcs only for covariates (fixed.x)', () => {
    expect(exogenousPairs(m).map(([a, b]) => [a.id, b.id])).toEqual([['A', 'B']]);
    expect(impliedCorrelations(m).map((k) => [k.a, k.b])).toEqual([['X', 'Y']]);
  });
  it('an undrawn pair is fixed at zero and asked about; drawn, it is estimated', () => {
    expect(toSpec(m).covariances).toEqual([{ a: 'Alpha', b: 'Beta', kind: 'construct', zero: true }]);
    expect(asked(m)).toEqual([expect.objectContaining({ level: 'warning', message: expect.stringMatching(/^No correlation is drawn between Alpha ↔ Beta: .* uncorrelated\. Intended\?$/) })]);
    const drawn: ModelState = { ...m, correlations: [{ id: 'k', kind: 'construct', a: 'B', b: 'A' }] };
    expect(toSpec(drawn).covariances).toEqual([{ a: 'Beta', b: 'Alpha', kind: 'construct' }]);
    expect(asked(drawn)).toEqual([]);
    // Confirmed as uncorrelated: fixed at zero once, no question.
    const confirmed: ModelState = { ...m, correlations: [{ id: 'k', kind: 'construct', a: 'A', b: 'B', zero: true }] };
    expect(toSpec(confirmed).covariances).toEqual([{ a: 'Alpha', b: 'Beta', kind: 'construct', zero: true }]);
    expect(asked(confirmed)).toEqual([]);
    // Not asked outside CB-SEM, nor for MIIV-2SLS (which estimates the covariances anyway).
    expect(validateModel(m, data, { method: 'pls', consistent: false }).some((i) => i.action)).toBe(false);
    expect(validateModel(m, data, { ...cb, estimator: '2SLS' }).some((i) => i.action)).toBe(false);
  });
  it('factors of one ESEM block are correlated by the rotation, not asked about', () => {
    const e: ModelState = { ...m, paths: [], esem: { rotation: 'geomin', blocks: [{ id: 'b', constructs: ['A', 'B'] }] } };
    expect(exogenousPairs(e).some(([a, b]) => a.id === 'A' && b.id === 'B')).toBe(false);
    expect(impliedCorrelations(e).map((k) => [k.a, k.b])).toContainEqual(['A', 'B']);
    expect(toSpec(e).covariances?.some((k) => k.a === 'Alpha' && k.b === 'Beta')).toBeFalsy();
  });
  it('format-1 projects (CB-SEM correlated undrawn pairs) are migrated to drawn correlations', () => {
    const file = (version: number) => JSON.stringify({ format: 'pls-studio', version, model: m, settings: DEFAULT_SETTINGS, data: null });
    const old = parseProject(file(1)).model;
    expect(old.correlations?.map((k) => [k.a, k.b, k.zero ?? false])).toEqual([['A', 'B', false]]);
    expect(toSpec(old).covariances).toEqual([{ a: 'Alpha', b: 'Beta', kind: 'construct' }]);
    expect(parseProject(file(2)).model.correlations ?? []).toEqual([]);
    expect(JSON.parse(serializeProject(m, DEFAULT_SETTINGS, null, null)).version).toBe(2);
    // An old fixed zero stays a fixed zero (now: confirmed uncorrelated).
    const zeroed = parseProject(JSON.stringify({ format: 'pls-studio', version: 1, model: { ...m, correlations: [{ id: 'z', kind: 'construct', a: 'A', b: 'B', zero: true }] }, settings: DEFAULT_SETTINGS, data: null })).model;
    expect(zeroed.correlations).toEqual([{ id: 'z', kind: 'construct', a: 'A', b: 'B', zero: true }]);
  });
});

describe('correlation drawing rules', () => {
  const m: ModelState = {
    constructs: [C('A', 'Alpha', ['a1', 'a2']), C('B', 'Beta', ['b1', 'b2']), C('G', 'Gamma', ['c1', 'c2']), C('H', 'Eta', ['h1', 'h2'])],
    paths: [{ id: 'p1', from: 'A', to: 'G' }, { id: 'p2', from: 'A', to: 'H' }],
    moderations: [],
  };
  const shape = (id: string) => ({ kind: 'construct' as const, id });
  const zeta = (id: string) => ({ kind: 'construct' as const, id, via: 'disturbance' as const });
  it('refuses endogenous constructs themselves but accepts their disturbances', () => {
    expect(correlationEndError(m, shape('G'))).toMatch(/endogenous/);
    expect(correlationEndError(m, zeta('G'))).toBeNull();
    expect(correlationEndError(m, shape('B'))).toBeNull();
    expect(correlationPairError(m, zeta('G'), zeta('H'))).toBeNull();
    expect(correlationPairError(m, shape('A'), shape('B'))).toBeNull();
  });
  it('refuses exogenous ↔ disturbance and mixed kinds', () => {
    expect(correlationPairError(m, shape('B'), zeta('G'))).toMatch(/uncorrelated by assumption/);
    expect(correlationPairError(m, shape('A'), { kind: 'indicator', id: 'b1' })).toMatch(/two indicator errors/);
  });
});

describe('disturbance covariance with a direct path', () => {
  it('warns that the model is non-recursive', () => {
    const d = { names: ['a1', 'a2', 'b1', 'b2', 'c1', 'c2'], cols: Array.from({ length: 6 }, (_, k) => Float64Array.from({ length: 100 }, (_, i) => (i * (k + 2)) % 11)) };
    const m: ModelState = {
      constructs: [C('A', 'Alpha', ['a1', 'a2']), C('B', 'Beta', ['b1', 'b2']), C('G', 'Gamma', ['c1', 'c2'])],
      paths: [{ id: 'p1', from: 'A', to: 'B' }, { id: 'p2', from: 'A', to: 'G' }, { id: 'p3', from: 'B', to: 'G' }],
      moderations: [],
      correlations: [{ id: 'k', kind: 'construct', a: 'B', b: 'G' }],
    };
    const issues = validateModel(m, d, { method: 'cbsem', consistent: false });
    expect(issues.some((i) => i.level === 'warning' && i.message.includes('non-recursive'))).toBe(true);
    expect(issues.filter((i) => i.level === 'error')).toEqual([]);
  });
});

describe('engine settings', () => {
  it('default to the R packages (cSEM for PLS) and round-trip through project files', () => {
    expect(DEFAULT_SETTINGS.engine).toBe('r');
    expect(DEFAULT_SETTINGS.plsPackage).toBe('cSEM');
    const p = parseProject(serializeProject(base, { ...DEFAULT_SETTINGS, engine: 'builtin', plsPackage: 'seminr' }, null, null));
    expect(p.settings.engine).toBe('builtin');
    expect(p.settings.plsPackage).toBe('seminr');
  });
  it('fall back to the defaults for unknown values', () => {
    const text = serializeProject(base, DEFAULT_SETTINGS, null, null).replace('"engine":"r"', '"engine":"python"').replace('"plsPackage":"cSEM"', '"plsPackage":"x"');
    const p = parseProject(text);
    expect(p.settings.engine).toBe('r');
    expect(p.settings.plsPackage).toBe('cSEM');
  });
});

describe('PLSc and Mode B common factors', () => {
  const model = (type: 'factor' | 'composite', mode: 'A' | 'B'): ModelState => ({
    constructs: [
      { id: 'a', name: 'A', type, mode, indicators: ['a1', 'a2', 'a3'], x: 0, y: 0, side: 'left' },
      { id: 'b', name: 'B', type: 'factor', mode: 'A', indicators: ['b1', 'b2', 'b3'], x: 300, y: 0, side: 'right' },
    ],
    paths: [{ id: 'p', from: 'a', to: 'b' }], moderations: [],
  });
  const data = { names: ['a1', 'a2', 'a3', 'b1', 'b2', 'b3'], cols: Array.from({ length: 6 }, (_, k) => Float64Array.from({ length: 60 }, (_, i) => ((i * (k + 3)) % 11) / 10)) };
  const warns = (m: ModelState, consistent: boolean) => validateModel(m, data, { method: 'pls', consistent }).filter((i) => i.level === 'warning' && /PLSc/.test(i.message)).map((i) => i.message);
  it('warns about a common factor in Mode B only when PLSc is on', () => {
    expect(warns(model('factor', 'B'), true)).toEqual([expect.stringMatching(/^"A" is a common factor estimated with Mode B: PLSc’s correction \(ρA\) assumes Mode A weights.*Use Mode A, or model "A" as a composite\.$/)]);
    expect(warns(model('factor', 'B'), false)).toEqual([]);
    expect(warns(model('factor', 'A'), true)).toEqual([]);
    expect(warns(model('composite', 'B'), true)).toEqual([]);
  });
});

describe('validateModel: combinations the engines refuse, caught before anything runs', () => {
  const C2 = (id: string, name: string, ind: string[]): Construct => ({ id, name, type: 'factor', mode: 'A', indicators: ind, x: 0, y: 0, side: 'left' });
  const m: ModelState = { constructs: [C2('A', 'Alpha', ['a1', 'a2']), C2('B', 'Beta', ['b1', 'b2'])], paths: [{ id: 'p', from: 'A', to: 'B' }], moderations: [] };
  const raw = { names: ['a1', 'a2', 'b1', 'b2'], cols: [Float64Array.from([1, 2, 3, 4, 5]), Float64Array.from([2, 1, 4, 3, 5]), Float64Array.from([1, 3, 2, 5, 4]), Float64Array.from([5, 4, 3, 2, 1])] };
  const matrix = { names: raw.names, cols: [], moments: { S: [[1, .3, .2, .1], [.3, 1, .2, .1], [.2, .2, 1, .4], [.1, .1, .4, 1]], n: 100 } };
  const errs = (settings: Parameters<typeof validateModel>[2], model = m, data: Parameters<typeof validateModel>[1] = raw) => validateModel(model, data, settings).filter((i) => i.level === 'error').map((i) => i.message);

  it('PLS: seminr has no centroid scheme; GSCA, PCA and sum scores are cSEM only', () => {
    expect(errs({ method: 'pls', consistent: false, plsPackage: 'seminr', scheme: 'centroid' })).toContainEqual(expect.stringContaining('seminr offers the path and factor weighting schemes only'));
    expect(errs({ method: 'pls', consistent: false, plsPackage: 'seminr', plsApproach: 'GSCA' })).toContainEqual(expect.stringContaining('estimated with cSEM; choose cSEM'));
    expect(errs({ method: 'pls', consistent: false, engine: 'builtin', plsApproach: 'PCA' })).toContainEqual(expect.stringContaining('choose “R packages”'));
    expect(errs({ method: 'pls', consistent: false, plsPackage: 'seminr', scheme: 'path' })).toEqual([]);
  });

  it('CB-SEM with a covariance matrix: no interactions, MLR, robust ML, groups, levels, weights, imputation or FIML', () => {
    const e = errs({ method: 'cbsem', consistent: false, estimator: 'MLR', missing: 'mi' }, { ...m, moderations: [{ id: 'mo', moderator: 'B', path: 'p' }], multigroup: { column: 'g', invariance: 'metric', free: [] }, weights: 'w' } as ModelState, matrix);
    for (const part of ['Latent interactions need raw data', 'MLR needs raw data', 'Multiple-group analysis needs raw data', 'Sampling weights need raw data', 'Multiple imputation needs raw data']) expect(e).toContainEqual(expect.stringContaining(part));
    expect(errs({ method: 'cbsem', consistent: false, estimator: 'ML' }, m, matrix)).toEqual([]);
  });

  it('CB-SEM: imputation with ML or MLR only; LMS / QML single-group without ESEM or weights; weights with ML, MLR, MLM or WLSMV', () => {
    expect(errs({ method: 'cbsem', consistent: false, estimator: 'MLM', missing: 'mi' })).toContainEqual(expect.stringContaining('choose the ML or MLR estimator'));
    expect(errs({ method: 'cbsem', consistent: false, estimator: 'RML', missing: 'mi' })).toContainEqual(expect.stringContaining('Robust ML (rsem) uses the missing values itself'));
    const lms = errs({ method: 'cbsem', consistent: false, estimator: 'ML', interaction: 'lms' }, { ...m, moderations: [{ id: 'mo', moderator: 'B', path: 'p' }], multigroup: { column: 'g', invariance: 'configural', free: [] }, weights: 'w' } as ModelState);
    expect(lms).toContainEqual(expect.stringContaining('need a single-group model'));
    expect(lms).toContainEqual(expect.stringContaining('cannot be combined with LMS / QML'));
    expect(errs({ method: 'cbsem', consistent: false, estimator: 'GLS' }, { ...m, weights: 'w' })).toContainEqual(expect.stringContaining('With sampling weights choose ML, MLR or MLM'));
  });

  it('flags indicators that are constant or have no values', () => {
    const d = { names: raw.names, cols: [raw.cols[0], Float64Array.from([3, 3, 3, 3, NaN]), Float64Array.from([NaN, NaN, NaN, NaN, NaN]), raw.cols[3]] };
    const e = errs({ method: 'pls', consistent: false }, m, d);
    expect(e).toContainEqual('Indicator "a2" (in "Alpha") is constant (3 in every row): it carries no information.');
    expect(e).toContainEqual('Indicator "b1" (in "Beta") has no values.');
  });
});

describe('the mean structure (the constant)', () => {
  const K = (id: string, name: string, ind: string[], extra: Partial<Construct> = {}): Construct => ({ id, name, type: 'factor', mode: 'A', indicators: ind, x: 0, y: 0, side: 'left', ...extra });
  const m: ModelState = {
    constructs: [K('A', 'Alpha', ['a1', 'a2']), K('B', 'Beta', ['b1', 'b2']), K('X', 'Age', ['age'], { covariate: true })],
    paths: [{ id: 'p', from: 'A', to: 'B' }, { id: 'q', from: 'X', to: 'B' }], moderations: [],
    constant: { x: -200, y: 0 }, means: [{ id: 'm1', target: 'A' }, { id: 'm2', target: 'X', fixed: 12 }, { id: 'm3', target: 'B', label: 'mb' }],
  };
  const raw = { names: ['a1', 'a2', 'b1', 'b2', 'age'], cols: [[1, 2, 3, 4, 5], [2, 1, 4, 3, 5], [1, 3, 2, 5, 4], [5, 4, 3, 2, 1], [20, 21, 19, 22, 23]].map((c) => Float64Array.from(c)) };
  const cbs = { method: 'cbsem' as const, consistent: false, estimator: 'ML' as const };

  it('reaches the engine specification by name, with fixed values and labels', () => {
    const spec = toSpec(m);
    expect(spec.meanStructure).toBe(true);
    expect(spec.means).toEqual([{ construct: 'Alpha' }, { construct: 'Age', fixed: 12 }, { construct: 'Beta', label: 'mb' }]);
    expect(toSpec({ ...m, constant: undefined }).meanStructure).toBeUndefined();
  });

  it('survives a project file; arrows to unknown constructs, duplicates and arrows without the constant are dropped', () => {
    const back = parseProject(serializeProject(m, DEFAULT_SETTINGS, null, null)).model;
    expect(back.constant).toEqual({ x: -200, y: 0 });
    expect(back.means).toEqual(m.means);
    const text = serializeProject({ ...m, means: [...m.means!, { id: 'm4', target: 'ZZ' }, { id: 'm5', target: 'A' }] }, DEFAULT_SETTINGS, null, null);
    expect(parseProject(text).model.means).toEqual(m.means);
    expect(parseProject(serializeProject({ ...m, constant: undefined }, DEFAULT_SETTINGS, null, null)).model.means).toBeUndefined();
    expect(pruneMeans({ ...m, constant: undefined }).means).toBeUndefined();
    expect(pruneMeans({ ...m, constructs: m.constructs.slice(0, 2) }).means).toEqual([m.means![0], m.means![2]]);
  });

  it('is a lavaan feature: not in PLS, the built-in engine, MIIV, covariance-matrix input, groups or two-level models', () => {
    const errs = (settings: Parameters<typeof validateModel>[2], model = m, data: Parameters<typeof validateModel>[1] = raw) => validateModel(model, data, settings).filter((i) => i.level === 'error').map((i) => i.message);
    expect(errs(cbs)).toEqual([]);
    expect(errs({ method: 'pls', consistent: false })).toContainEqual(expect.stringContaining('is a CB-SEM feature'));
    expect(errs({ ...cbs, engine: 'builtin' })).toContainEqual(expect.stringContaining('estimated by lavaan'));
    expect(errs({ ...cbs, estimator: '2SLS' })).toContainEqual(expect.stringContaining('not available with MIIV-2SLS'));
    expect(errs(cbs, m, { names: raw.names, cols: [], moments: { S: raw.names.map((_, i) => raw.names.map((_, j) => (i === j ? 1 : 0.2))), n: 50 } })).toContainEqual(expect.stringContaining('carries no means'));
    expect(errs(cbs, { ...m, multigroup: { column: 'g', invariance: 'scalar', free: [] } })).toContainEqual(expect.stringContaining('come from the invariance level'));
    expect(errs(cbs, { ...m, constructs: [...m.constructs, K('H', 'Higher', [], { components: ['A', 'B'] })], means: [{ id: 'm9', target: 'H' }] })).toContainEqual(expect.stringContaining('second-order construct'));
  });
});

describe('intercepts the constant implies', () => {
  const c = (id: string, indicators: string[], extra: Partial<Construct> = {}): Construct => ({ id, name: id, type: 'factor', mode: 'A', indicators, x: 0, y: 0, side: 'left', ...extra });
  const base: ModelState = { constructs: [c('A', ['a1', 'a2']), c('B', ['b1']), c('Z', ['z'], { covariate: true }), c('H', [], { components: ['A', 'B'] })], paths: [], moderations: [] };
  it('are none without the constant, and every indicator intercept with it (not covariates or higher-order constructs)', () => {
    expect(impliedIntercepts(base)).toEqual([]);
    expect(impliedIntercepts({ ...base, constant: { x: 0, y: 0 } })).toEqual([
      { construct: 'A', indicator: 'a1' }, { construct: 'A', indicator: 'a2' }, { construct: 'B', indicator: 'b1' },
    ]);
  });
  it('leave out the marker of a construct whose latent mean is drawn free, but not one fixed at a value', () => {
    const k = { ...base, constant: { x: 0, y: 0 } };
    expect(impliedIntercepts({ ...k, means: [{ id: 'm', target: 'A' }] })).toEqual([{ construct: 'A', indicator: 'a2' }, { construct: 'B', indicator: 'b1' }]);
    expect(impliedIntercepts({ ...k, means: [{ id: 'm', target: 'A', fixed: 0 }] })).toHaveLength(3);
    expect(impliedIntercepts({ ...k, means: [{ id: 'm', target: 'Z' }] })).toHaveLength(3);
  });
});

describe('interaction terms (seminr’s method per moderation)', () => {
  const c = (id: string, indicators: string[]): Construct => ({ id, name: id, type: 'composite', mode: 'A', indicators, x: 0, y: 0, side: 'left' });
  const model: ModelState = {
    constructs: [c('X', ['x1', 'x2']), c('M', ['m1', 'm2']), c('Y', ['y1', 'y2'])], paths: [{ id: 'p', from: 'X', to: 'Y' }, { id: 'q', from: 'M', to: 'Y' }],
    moderations: [{ id: 'mo', moderator: 'M', path: 'p', method: 'orthogonal' }],
  };
  const data = { names: ['x1', 'x2', 'm1', 'm2', 'y1', 'y2'], cols: Array.from({ length: 6 }, (_, k) => Float64Array.from({ length: 50 }, (_, i) => Math.sin(i * (k + 1.1)) + (i % (k + 2)))) };
  it('survives the project file, reaches the spec, and drops unknown methods', () => {
    const back = parseProject(serializeProject(model, DEFAULT_SETTINGS, null, null)).model;
    expect(back.moderations[0].method).toBe('orthogonal');
    expect(toSpec(back).moderations).toEqual([{ from: 'X', moderator: 'M', to: 'Y', method: 'orthogonal' }]);
    const loose = parseProject(serializeProject({ ...model, moderations: [{ ...model.moderations[0], method: 'magic' as 'orthogonal' }] }, DEFAULT_SETTINGS, null, null)).model;
    expect(loose.moderations[0].method).toBeUndefined();
    expect(toSpec(loose).moderations![0]).not.toHaveProperty('method');
  });
  it('is accepted with seminr only', () => {
    const errors = (s: Partial<Settings>) => validateModel(model, data, { ...DEFAULT_SETTINGS, method: 'pls', ...s }).filter((i) => i.level === 'error').map((i) => i.message);
    expect(errors({ engine: 'r', plsPackage: 'seminr' })).toEqual([]);
    expect(errors({ engine: 'r', plsPackage: 'cSEM' })).toEqual([expect.stringMatching(/orthogonalising: that interaction term is seminr’s/)]);
    expect(errors({ engine: 'builtin' })).toEqual([expect.stringMatching(/seminr/)]);
    // A two-stage term (no method) is fine everywhere; CB-SEM ignores the field (lavaan has its own product indicators).
    const plain = { ...model, moderations: [{ id: 'mo', moderator: 'M', path: 'p' }] };
    expect(validateModel(plain, data, { ...DEFAULT_SETTINGS, method: 'pls', engine: 'r', plsPackage: 'cSEM' }).filter((i) => i.level === 'error')).toEqual([]);
    expect(validateModel({ ...model, constructs: model.constructs.map((k) => ({ ...k, type: 'factor' as const })) }, data, { ...DEFAULT_SETTINGS, method: 'cbsem' }).filter((i) => /seminr/.test(i.message))).toEqual([]);
  });
});

describe('the second-order approach setting', () => {
  it('is parsed strictly and defaults to two-stage', () => {
    expect(parseSettings({ hocApproach: 'embedded' }).hocApproach).toBe('embedded');
    expect(parseSettings({ hocApproach: 'repeated' }).hocApproach).toBe('repeated');
    expect(parseSettings({ hocApproach: 'mixed' }).hocApproach).toBe('two_stage');
    expect(parseSettings({}).hocApproach).toBe('two_stage');
  });
  it('allows the embedded approach with cSEM only', () => {
    const c = (id: string, indicators: string[], extra: Partial<Construct> = {}): Construct => ({ id, name: id, type: 'composite', mode: 'A', indicators, x: 0, y: 0, side: 'left', ...extra });
    const model: ModelState = { constructs: [c('A', ['a1', 'a2']), c('B', ['b1', 'b2']), c('H', [], { components: ['A', 'B'] }), c('Y', ['y1', 'y2'])], paths: [{ id: 'p', from: 'H', to: 'Y' }], moderations: [] };
    const names = ['a1', 'a2', 'b1', 'b2', 'y1', 'y2'];
    const data = { names, cols: names.map((_, k) => Float64Array.from({ length: 50 }, (_, i) => Math.sin(i * (k + 1.1)) + (i % (k + 2)))) };
    const errors = (s: Partial<Settings>) => validateModel(model, data, { ...DEFAULT_SETTINGS, method: 'pls', engine: 'r', ...s }).filter((i) => i.level === 'error').map((i) => i.message);
    expect(errors({ plsPackage: 'cSEM', hocApproach: 'embedded' })).toEqual([]);
    expect(errors({ plsPackage: 'seminr', hocApproach: 'embedded' })).toEqual([expect.stringMatching(/embedded two-stage approach is cSEM’s/)]);
    expect(errors({ plsPackage: 'seminr', hocApproach: 'repeated' })).toEqual([]);
    expect(errors({ plsPackage: 'cSEM', hocApproach: 'repeated' })).toEqual([]);
  });
});

describe('sampling clusters (cluster-robust standard errors, CB-SEM)', () => {
  const C = (id: string, inds: string[]) => ({ id, name: id, type: 'factor' as const, mode: 'A' as const, indicators: inds, x: 0, y: 0, side: 'left' as const });
  const m: ModelState = { constructs: [C('F', ['a1', 'a2', 'a3'])], paths: [], moderations: [], cluster: 'school' };
  const col = (f: (i: number) => number) => Float64Array.from({ length: 100 }, (_, i) => f(i));
  const d = { names: ['a1', 'a2', 'a3', 'school', 'w'], cols: [col((i) => i % 5), col((i) => i % 7), col((i) => i % 3), col((i) => i % 10), col((i) => 1 + (i % 4))] };
  const errs = (model: ModelState, o: object = {}, data = d) => validateModel(model, data, { method: 'cbsem', consistent: false, estimator: 'ML', ...o }).filter((i) => i.level === 'error').map((i) => i.message);
  it('is accepted with ML and MLR, survives the file and reaches the spec', () => {
    expect(errs(m)).toEqual([]);
    expect(errs(m, { estimator: 'MLR' })).toEqual([]);
    expect(toSpec(m).cluster).toBe('school');
    expect(parseProject(serializeProject(m, DEFAULT_SETTINGS, null, null)).model.cluster).toBe('school');
    expect(toSpec({ ...m, cluster: undefined })).not.toHaveProperty('cluster');
  });
  it('rejects the built-in engine, 2SLS and rsem, two-level models, imputation, LMS, clashes and missing or constant columns', () => {
    expect(errs(m, { engine: 'builtin' })[0]).toMatch(/R packages/);
    expect(errs(m, { estimator: '2SLS' })[0]).toMatch(/MIIV-2SLS/);
    expect(errs(m, { estimator: 'RML' })[0]).toMatch(/robust ML/);
    expect(errs({ ...m, multilevel: { column: 'school', between: 'saturated' } }).some((e) => /alternatives/.test(e))).toBe(true);
    expect(errs(m, { missing: 'mi' })[0]).toMatch(/multiple imputation/);
    expect(errs({ ...m, cluster: 'a1' })[0]).toMatch(/cannot be both the sampling clusters and an indicator/);
    expect(errs({ ...m, cluster: 'w', weights: 'w' }).some((e) => /sampling weights/.test(e))).toBe(true);
    expect(errs({ ...m, cluster: 'nope' })[0]).toMatch(/not in the current dataset/);
    const one = { ...d, cols: d.cols.map((c, k) => (k === 3 ? Float64Array.from(c, () => 1) : c)) };
    expect(errs(m, {}, one)[0]).toMatch(/at least two clusters/);
    expect(validateModel(m, d, { method: 'pls', consistent: false }).some((i) => i.level === 'warning' && /PLS-SEM ignores them/.test(i.message))).toBe(true);
  });
});

describe('stacked models: one covariance matrix per group, structural equalities across groups', () => {
  const C2 = (id: string, name: string, ind: string[]): Construct => ({ id, name, type: 'factor', mode: 'A', indicators: ind, x: 0, y: 0, side: 'left', reliability: 0.9 });
  const m: ModelState = {
    constructs: [C2('A', 'Alpha', ['a1']), C2('B', 'Beta', ['b1']), C2('K', 'Kappa', ['k1'])], paths: [{ id: 'p', from: 'A', to: 'B' }, { id: 'q', from: 'K', to: 'B' }], moderations: [],
    multigroup: { column: '', invariance: 'configural', structural: ['regressions'], free: [{ kind: 'regression', from: 'K', to: 'B' }] },
  };
  const groups = [{ label: 'Younger', S: [[1, 0.3, 0.2], [0.3, 1, 0.1], [0.2, 0.1, 1]], n: 100 }, { label: 'Older', S: [[2, 0.4, 0.2], [0.4, 1.5, 0.3], [0.2, 0.3, 1]], n: 120 }];
  const data = { names: ['a1', 'b1', 'k1'], cols: [], moments: { ...groups[0], groups } };
  const cbs = { method: 'cbsem' as const, consistent: false, estimator: 'ML' as const, engine: 'r' as const };
  const issues = (model = m, d: Parameters<typeof validateModel>[1] = data, settings = cbs) => validateModel(model, d, settings);
  const errs = (...a: Parameters<typeof issues>) => issues(...a).filter((i) => i.level === 'error').map((i) => i.message);

  it('is valid with the groups of the matrices and no grouping column; a column or latent means are refused', () => {
    expect(errs()).toEqual([]);
    expect(errs({ ...m, multigroup: { ...m.multigroup!, column: 'g' } })).toContainEqual(expect.stringContaining('no grouping column applies'));
    expect(errs({ ...m, constant: { x: 0, y: 0 }, means: [{ id: 'mt', target: 'A' }] })).toContainEqual(expect.stringContaining('Latent means need raw data'));
    // One matrix without groups: still no multiple-group analysis.
    expect(errs(m, { names: data.names, cols: [], moments: { S: groups[0].S, n: 100 } })).toContainEqual(expect.stringContaining('one covariance matrix per group'));
  });
  it('checks the freed coefficients against the paths and warns when nothing holds them equal', () => {
    expect(errs({ ...m, paths: [m.paths[0]] })).toContainEqual(expect.stringContaining('freed across groups refers to a removed path'));
    const w = issues({ ...m, multigroup: { ...m.multigroup!, structural: [] } }).filter((i) => i.level === 'warning').map((i) => i.message);
    expect(w).toContainEqual(expect.stringContaining('the freeing has no effect'));
    expect(issues().filter((i) => i.level === 'warning').map((i) => i.message)).not.toContainEqual(expect.stringContaining('the freeing has no effect'));
  });
  it('the spec names the freed coefficient by construct names and carries the structural equalities', () => {
    const spec = toSpec(m);
    expect(spec.multigroup).toEqual({ column: '', invariance: 'configural', structural: ['regressions'], free: [{ kind: 'regression', from: 'Kappa', to: 'Beta' }] });
  });
  it('round-trips through a project file: the groups, their labels and Ns, the equalities and the freed coefficient', () => {
    const text = serializeProject(m, DEFAULT_SETTINGS, data, { fileName: 'm.csv', rows: 220, missingCells: 0, excluded: [], kind: 'matrix' });
    const p = parseProject(text);
    expect(p.data!.moments!.groups).toEqual(groups);
    expect(p.data!.moments!.n).toBe(220);
    // The pooled matrix is recomputed from the groups (weights N − 1).
    expect(p.data!.moments!.S[0][0]).toBeCloseTo((99 * 1 + 119 * 2) / 218, 12);
    expect(p.info!.rows).toBe(220);
    expect(p.model.multigroup).toEqual(m.multigroup);
    // Malformed groups are refused.
    const bad = JSON.parse(text);
    bad.data.moments.groups = [groups[0]];
    expect(() => parseProject(JSON.stringify(bad))).toThrow(/2 to 20 groups/);
    bad.data.moments.groups = [groups[0], { ...groups[1], label: 'Younger' }];
    expect(() => parseProject(JSON.stringify(bad))).toThrow(/labels must differ/);
    bad.data.moments.groups = [groups[0], { ...groups[1], S: [[1, 0], [0, 1]] }];
    expect(() => parseProject(JSON.stringify(bad))).toThrow(/3 × 3/);
    // An unknown structural equality or a freed coefficient of unknown constructs is dropped, not kept.
    const odd = JSON.parse(text);
    odd.model.multigroup.structural = ['regressions', 'means'];
    odd.model.multigroup.free.push({ kind: 'regression', from: 'nope', to: 'B' });
    expect(parseProject(JSON.stringify(odd)).model.multigroup).toEqual(m.multigroup);
  });
});

describe('non-recursive models (cycles in the structural model)', () => {
  const C2 = (id: string, name: string, ind: string[], covariate = false): Construct => ({ id, name, type: 'factor', mode: 'A', indicators: ind, x: 0, y: 0, side: 'left', ...(covariate ? { covariate } : {}) });
  // A <-> B reciprocal, each with its own instrument (x for A, z for B).
  const m: ModelState = {
    constructs: [C2('X', 'Ex', ['x1'], true), C2('Z', 'Zed', ['z1'], true), C2('A', 'Alpha', ['a1', 'a2']), C2('B', 'Beta', ['b1', 'b2'])],
    paths: [{ id: 'p1', from: 'X', to: 'A' }, { id: 'p2', from: 'Z', to: 'B' }, { id: 'p3', from: 'A', to: 'B' }, { id: 'p4', from: 'B', to: 'A' }], moderations: [],
  };
  const issues = (method: 'pls' | 'cbsem' | 'process') => validateModel(m, null, { method, consistent: false, estimator: 'ML' });
  it('is an error for PLS-SEM and conditional process analysis, a warning about identification for CB-SEM', () => {
    expect(issues('pls').filter((i) => i.level === 'error').map((i) => i.message)).toContainEqual(expect.stringMatching(/contains a cycle \(Beta → Alpha\)\. PLS-SEM requires a recursive model; CB-SEM estimates non-recursive models/));
    expect(issues('process').filter((i) => i.level === 'error').map((i) => i.message)).toContainEqual(expect.stringContaining('Conditional process analysis requires a recursive model'));
    const cb = issues('cbsem');
    expect(cb.filter((i) => i.level === 'error' && i.message !== 'Import a dataset first.')).toEqual([]);
    expect(cb.filter((i) => i.level === 'warning').map((i) => i.message)).toContainEqual(expect.stringMatching(/^Non-recursive model \(Beta → Alpha closes a loop\)\. Each construct in a loop needs a predictor the other lacks/));
  });
  it('the spec carries both directions', () => {
    const spec = toSpec(m);
    expect(spec.paths.filter((p) => (p.from === 'Alpha' && p.to === 'Beta') || (p.from === 'Beta' && p.to === 'Alpha')).length).toBe(2);
  });
});
