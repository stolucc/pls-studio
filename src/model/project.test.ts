import { describe, expect, it } from 'vitest';
import { correlationEndError, correlationPairError, createsCycle, DEFAULT_SETTINGS, exogenousPairs, impliedCorrelations, type ModelState, parseProject, pruneCorrelations, serializeProject, toSpec, validateModel } from './project';

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
  it('CB-SEM rejects composites; PLS accepts them', () => {
    expect(errors(composite)).toEqual([]);
    const cb = validateModel(composite, data, { method: 'cbsem', consistent: false }).filter((i) => i.level === 'error');
    expect(cb.some((i) => i.message.includes('composite') && i.message.includes('CB-SEM'))).toBe(true);
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
  const d = { names: ['a1', 'a2', 'b1', 'b2', 'c1', 'c2', 'x1'], cols: Array.from({ length: 7 }, (_, k) => Float64Array.from({ length: 100 }, (_, i) => (i * (k + 2)) % 7)) };
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
    const d = { names: ['a1', 'a2', 'b1', 'b2', 'c1', 'c2'], cols: Array.from({ length: 6 }, (_, k) => Float64Array.from({ length: 100 }, (_, i) => (i * (k + 2)) % 7)) };
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
