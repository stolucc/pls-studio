import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parseProject, serializeProject, toSpec, validateModel, type ModelState } from './project';
import { formulas, looksLikeMplus, mplusName, parseLavaanSyntax, toMplus } from './syntax';

const name = (m: ModelState, id: string) => m.constructs.find((c) => c.id === id)!.name;

describe('lavaan syntax in', () => {
  it('builds the Holzinger & Swineford CFA', () => {
    const { model, warnings } = parseLavaanSyntax('# three factors\nvisual =~ x1 + x2 + x3\ntextual =~ x4 + x5 + x6\nspeed =~ x7 + x8 + x9');
    expect(warnings).toEqual([]);
    expect(model.constructs.map((c) => [c.name, c.indicators])).toEqual([['visual', ['x1', 'x2', 'x3']], ['textual', ['x4', 'x5', 'x6']], ['speed', ['x7', 'x8', 'x9']]]);
    expect(model.paths).toEqual([]);
    expect(new Set(model.constructs.map((c) => `${c.x},${c.y}`)).size).toBe(3);  // laid out
  });
  it('builds the political democracy model with labels, fixed values and correlated errors', () => {
    const text = `ind60 =~ x1 + x2 + x3
      dem60 =~ y1 + a*y2 + b*y3 + c*y4
      dem65 =~ y5 + a*y6 + b*y7 + c*y8
      dem60 ~ ind60
      dem65 ~ ind60 + 0.5*dem60
      y1 ~~ y5; y2 ~~ y4 + y6
      y3 ~~ y7
      ind60 ~~ ind60`;
    const { model, warnings } = parseLavaanSyntax(text);
    expect(warnings).toEqual([]);
    const dem60 = model.constructs.find((c) => c.name === 'dem60')!;
    expect(dem60.loadingLabels).toEqual({ y2: 'a', y3: 'b', y4: 'c' });
    expect(model.paths.map((p) => [name(model, p.from), name(model, p.to), p.fixed])).toEqual([['ind60', 'dem60', undefined], ['ind60', 'dem65', undefined], ['dem60', 'dem65', 0.5]]);
    expect(model.correlations!.map((k) => [k.kind, k.a, k.b])).toEqual([['indicator', 'y1', 'y5'], ['indicator', 'y2', 'y4'], ['indicator', 'y2', 'y6'], ['indicator', 'y3', 'y7']]);
    const names = ['x1', 'x2', 'x3', 'y1', 'y2', 'y3', 'y4', 'y5', 'y6', 'y7', 'y8'];
    const d = { names, cols: names.map((_, k) => Float64Array.from({ length: 75 }, (_, i) => Math.sin(i * (k + 1.3)) + (i % (k + 2)))) };
    expect(validateModel(model, d, { ...DEFAULT_SETTINGS, method: 'cbsem' }).filter((i) => i.level === 'error')).toEqual([]);
    expect(toSpec(model).paths).toHaveLength(3);
  });
  it('makes observed regressors covariates, X:Z a moderation, ~ 1 the constant, := a defined parameter', () => {
    const text = 'Y =~ y1 + y2 + y3\nX =~ x1 + x2\nY ~ b1*X + Z + X:Z + age\nY ~ 1\nx1 ~ 0*1\nX ~ 1\nind := b1*2\nX ~~ 0*Z';
    const { model, warnings } = parseLavaanSyntax(text);
    const by = Object.fromEntries(model.constructs.map((c) => [c.name, c]));
    expect(by.Z.covariate).toBe(true); expect(by.age.covariate).toBe(true); expect(by.Z.indicators).toEqual(['Z']);
    expect(model.paths.map((p) => [name(model, p.from), name(model, p.to), p.label])).toEqual([['X', 'Y', 'b1'], ['Z', 'Y', undefined], ['age', 'Y', undefined]]);
    expect(model.moderations).toHaveLength(1);
    expect(name(model, model.moderations[0].moderator)).toBe('Z');
    expect(model.constant).toBeTruthy();
    expect(model.means!.map((m) => name(model, m.target))).toEqual(['Y', 'X']);
    expect(model.defined).toEqual([expect.objectContaining({ name: 'ind', expr: 'b1*2' })]);
    expect(warnings).toEqual([expect.stringMatching(/covariates are fixed/)]);
  });
  it('adds a missing main effect for an interaction, keeps second-order factors, and reports what it drops', () => {
    const { model, warnings } = parseLavaanSyntax('F1 =~ a1 + a2\nF2 =~ b1 + b2\nG =~ F1 + F2\nY =~ y1 + y2\nY ~ G + F1:M\nY ~~ 0.3*Y\na1 | t1\nF1 == 0');
    const by = Object.fromEntries(model.constructs.map((c) => [c.name, c]));
    expect(by.G.components!.map((id) => name(model, id))).toEqual(['F1', 'F2']);
    expect(by.G.indicators).toEqual([]);
    expect(model.paths.map((p) => [name(model, p.from), name(model, p.to)])).toEqual([['G', 'Y'], ['F1', 'Y'], ['M', 'Y']]);
    expect(warnings).toEqual([expect.stringMatching(/main effect of F1 was added/)]);
    // A held variance, a threshold (the indicator becomes ordinal) and a constraint are kept (checked against the labels under Constraints).
    expect(model.parameters).toEqual([expect.objectContaining({ kind: 'variance', target: by.Y.id, fixed: 0.3 })]);
    expect(model.ordered).toEqual(['a1']);
    expect(model.inequalities).toBe('F1 == 0');
  });
  it('keeps variances, intercepts and thresholds held or labelled, values per group, and constraints (Mplus examples 5.9, 5.10, 5.20, 5.21, 5.22)', () => {
    // Observed variables only in variances, covariances and intercepts: single-indicator constructs.
    const twin = parseLavaanSyntax('y1 ~ i*1\ny2 ~ i*1\ny1 ~~ v*y1\ny2 ~~ v*y2\ny1 ~~ c(covmz, covdz)*y2\na := (2*(covmz - covdz))^0.5');
    expect(twin.warnings).toEqual([]);
    const by = Object.fromEntries(twin.model.constructs.map((c) => [c.name, c]));
    expect(by.y1.indicators).toEqual(['y1']); expect(by.y1.covariate).toBeUndefined();
    expect(twin.model.means!.map((m) => [name(twin.model, m.target), m.label])).toEqual([['y1', 'i'], ['y2', 'i']]);
    expect(twin.model.parameters!.map((p) => [p.kind, name(twin.model, p.target), p.label])).toEqual([['variance', 'y1', 'v'], ['variance', 'y2', 'v']]);
    expect(twin.model.correlations).toEqual([expect.objectContaining({ kind: 'construct', a: by.y1.id, b: by.y2.id, byGroup: ['covmz', 'covdz'] })]);
    // Indicator intercepts and thresholds labelled, residual and factor variances labelled, == and > kept.
    const cfa = parseLavaanSyntax('f1 =~ y1 + lam2*y2 + 1*y3\nf1 ~~ vf1*f1\ny2 ~~ ve2*y2\ny1 ~ a*1\ny2 ~ c(a, NA)*1\nu1 | t*t1 + 0.5*t2\nf2 =~ u1 + u2\nrel := lam2^2*vf1\nrel == 0.5\nve2 > 0');
    expect(cfa.warnings).toEqual([]);
    const f1 = cfa.model.constructs.find((c) => c.name === 'f1')!;
    expect(cfa.model.parameters).toEqual([
      expect.objectContaining({ kind: 'variance', target: f1.id, label: 'vf1' }),
      expect.objectContaining({ kind: 'variance', target: 'y2', indicator: true, label: 've2' }),
      expect.objectContaining({ kind: 'intercept', target: 'y1', indicator: true, label: 'a' }),
      expect.objectContaining({ kind: 'intercept', target: 'y2', indicator: true, byGroup: ['a', null] }),
      expect.objectContaining({ kind: 'threshold', target: 'u1', indicator: true, label: 't' }),
      expect.objectContaining({ kind: 'threshold', target: 'u1', indicator: true, threshold: 2, fixed: 0.5 }),
    ]);
    expect(cfa.model.ordered).toEqual(['u1']);
    expect(cfa.model.inequalities).toBe('rel == 0.5\nve2 > 0');
    // An ordinal variable on its own (thresholds and a covariance): an observed construct, the variable ordinal.
    const ord = parseLavaanSyntax('u1 | t*t1\nu2 | t*t1\nu1 ~~ c(cm, cd)*u2');
    expect(ord.warnings).toEqual([]);
    expect(ord.model.constructs.map((c) => [c.name, c.indicators])).toEqual([['u1', ['u1']], ['u2', ['u2']]]);
    expect(ord.model.ordered).toEqual(['u1', 'u2']);
    expect(ord.model.parameters!.map((p) => [p.kind, p.target, p.label])).toEqual([['threshold', 'u1', 't'], ['threshold', 'u2', 't']]);
  });
  it('refuses empty or oversized syntax and formulas without an operator', () => {
    expect(() => parseLavaanSyntax('')).toThrow(/No model syntax/);
    expect(() => parseLavaanSyntax('x'.repeat(30000))).toThrow(/too long/);
    expect(parseLavaanSyntax('visual =~ x1 + x2\nhello world').warnings[0]).toMatch(/not a lavaan formula/);
    expect(() => parseLavaanSyntax('a == b')).toThrow(/defines no variables/);
    expect(formulas('a =~ b # c\n ! comment\n d ~ e; f ~ g')).toEqual(['a =~ b', 'd ~ e', 'f ~ g']);
    expect(looksLikeMplus('f BY x1 x2 x3;\ny ON f;')).toBe(true);
    expect(looksLikeMplus('f =~ x1 + x2')).toBe(false);
  });
});

describe('Mplus input out', () => {
  const { model } = parseLavaanSyntax('visual =~ x1 + x2 + x3\ntextual =~ x4 + a*x5 + x6\ntextual ~ b*visual + ageyr\nx1 ~~ x4\nvisual ~~ textual\ntextual ~ 1\nvisual ~ 1\nind := a*b');
  const data = { names: ['x1', 'x2', 'x3', 'x4', 'x5', 'x6', 'ageyr', 'my var'], cols: Array.from({ length: 8 }, (_, k) => Float64Array.from([k, k === 2 ? NaN : k + 1])) };
  it('writes TITLE, DATA, VARIABLE, ANALYSIS, MODEL and MODEL CONSTRAINT, and the data with -999 for missing', () => {
    const { inp, dat, warnings } = toMplus(model, { ...DEFAULT_SETTINGS, method: 'cbsem', estimator: 'MLR', missing: 'casewise' }, data, { fileName: 'd.csv', rows: 2, missingCells: 1, excluded: [] }, 'HS test');
    expect(inp).toContain('TITLE: HS test');
    expect(inp).toContain('DATA: FILE = "HS_test.dat";');
    expect(inp).toContain('VARIABLE: NAMES = x1 x2 x3 x4 x5 x6 ageyr my_var;');
    expect(inp).toContain('USEVARIABLES = x1 x2 x3 x4 x5 x6 ageyr;');
    expect(inp).toContain('MISSING = ALL (-999);');
    expect(inp).toContain('ANALYSIS: ESTIMATOR = MLR; LISTWISE = ON;');
    expect(inp).toContain('visual BY x1 x2* x3*;');
    expect(inp).toContain('textual BY\n    x4\n    x5* (a)\n    x6*;');  // a label applies to its whole Mplus line: one term per line
    expect(inp).toContain('textual ON\n    visual (b)\n    ageyr;');
    expect(inp).toContain('x1 WITH x4;');
    expect(inp).toContain('visual WITH textual;');
    expect(inp).toContain('[textual];'); expect(inp).toContain('[x4@0];'); expect(inp).toContain('[visual];'); expect(inp).toContain('[x1@0];');
    expect(inp).toContain('MODEL CONSTRAINT:\n  NEW(ind);\n  ind = a*b;');
    expect(inp).toContain('OUTPUT: STANDARDIZED;');
    expect(dat).toBe('0 1 2 3 4 5 6 7\n1 2 -999 4 5 6 7 8');
    expect(warnings).toEqual([]);
  });
  it('writes moderations as XWITH, clusters as TYPE = COMPLEX, and says what it cannot write', () => {
    const { model: m } = parseLavaanSyntax('Y =~ y1 + y2\nX =~ x1 + x2\nY ~ X + Z + X:Z');
    const { inp, warnings } = toMplus({ ...m, cluster: 'school', weights: 'w', ordered: ['y1'], multilevel: { column: 'school', between: 'same' } }, { ...DEFAULT_SETTINGS, method: 'cbsem', estimator: '2SLS' }, { names: ['y1', 'y2', 'x1', 'x2', 'Z', 'school', 'w'], cols: [] }, null, 'p');
    expect(inp).toContain('| X XWITH Z;');
    expect(inp).toMatch(/Y ON X Z \w+;/);
    expect(inp).toContain('CLUSTER = school;'); expect(inp).toContain('WEIGHT = w;'); expect(inp).toContain('CATEGORICAL = y1;');
    expect(inp).toContain('TYPE = COMPLEX;'); expect(inp).toContain('TYPE = RANDOM; ALGORITHM = INTEGRATION;');
    expect(inp).toContain('USEVARIABLES = y1 y2 x1 x2 Z school w;');
    expect(warnings).toEqual(expect.arrayContaining([expect.stringMatching(/Two-level/), expect.stringMatching(/no 2SLS/)]));
    // Without data the NAMES line lists observed variables only, never the factors.
    const noData = toMplus(m, { ...DEFAULT_SETTINGS, method: 'cbsem' }, null, null, 'p').inp;
    expect(noData).toContain('VARIABLE: NAMES = y1 y2 x1 x2 Z;');
    expect(noData).not.toMatch(/NAMES = .*\bY\b/);
    const taken = new Map<string, string>();
    expect([mplusName('my var', taken), mplusName('1st', taken), mplusName('my_var', taken), mplusName('my var', taken)]).toEqual(['my_var', 'v1st', 'my_var_2', 'my_var']);
  });
  it('writes held and labelled variances, intercepts and thresholds, and the theta parameterisation', () => {
    const { model: m } = parseLavaanSyntax('f =~ y1 + y2 + u1\ng =~ y3 + y4 + y5\ng ~ f');
    const id = (n: string) => m.constructs.find((c) => c.name === n)!.id;
    const held: ModelState = {
      ...m, ordered: ['u1'], parameterization: 'theta', parameters: [
        { id: 'a', kind: 'variance', target: id('f'), fixed: 1 },
        { id: 'b', kind: 'variance', target: id('g'), label: 'dg' },
        { id: 'c', kind: 'variance', target: 'y2', indicator: true, label: 've' },
        { id: 'd', kind: 'intercept', target: 'y3', indicator: true, fixed: 0 },
        { id: 'e', kind: 'threshold', target: 'u1', indicator: true, threshold: 2, label: 't' },
        { id: 'f', kind: 'variance', target: 'y4', indicator: true, byGroup: [1, null] },
      ],
    };
    const { inp, warnings } = toMplus(held, { ...DEFAULT_SETTINGS, method: 'cbsem', estimator: 'WLSMV' }, null, null, 'p');
    for (const line of ['f@1;', 'g (dg);', 'y2 (ve);', '[y3@0];', '[u1$2] (t);']) expect(inp).toContain(`  ${line}`);
    expect(inp).toContain('PARAMETERIZATION = THETA;');
    expect(inp).not.toMatch(/^\s+y4/m);
    expect(warnings).toEqual([expect.stringMatching(/Values per group are not written/)]);
  });
});

describe('factors scaled by their variance, and direct effects on indicators (Mplus examples 5.30 and 5.24)', () => {
  const CB = { ...DEFAULT_SETTINGS, method: 'cbsem' as const };
  it('f =~ NA*y1 + … with f ~~ 1*f imports as the variance scaling: in the spec, the Mplus input and a saved project', () => {
    const { model, warnings } = parseLavaanSyntax('fg =~ NA*y1 + y2 + y3\nfg ~~ 1*fg\nf2 =~ y4 + y5 + y6');
    expect(warnings).toEqual([]);
    const fg = model.constructs.find((c) => c.name === 'fg')!;
    expect(fg.scaling).toBe('variance');
    expect(model.parameters).toBeUndefined();
    expect(model.constructs.find((c) => c.name === 'f2')!.scaling).toBeUndefined();
    expect(toSpec(model).constructs.find((c) => c.name === 'fg')).toMatchObject({ scaling: 'variance' });
    const inp = toMplus(model, CB, null, null, 'p').inp;
    expect(inp).toContain('fg BY y1* y2* y3*;');
    expect(inp).toContain('fg@1;');
    expect(inp).toContain('f2 BY y4 y5* y6*;');
    expect(parseProject(serializeProject(model, CB, null, null)).model.constructs.find((c) => c.name === 'fg')!.scaling).toBe('variance');
    // A labelled free first loading (NA*y1 + l1*y1) keeps its label; a bare NA* without a fixed variance still warns (unidentified).
    expect(parseLavaanSyntax('f =~ NA*y1 + l1*y1 + y2 + y3\nf ~~ 1*f').model.constructs[0]).toMatchObject({ scaling: 'variance', loadingLabels: { y1: 'l1' } });
    const bare = parseLavaanSyntax('f =~ NA*y1 + y2 + y3');
    expect(bare.model.constructs[0].scaling).toBeUndefined();
    expect(bare.warnings).toEqual([expect.stringMatching(/free first loading/)]);
    // Old projects (no scaling) load unchanged.
    expect(parseProject(serializeProject(bare.model, CB, null, null)).model.constructs[0].scaling).toBeUndefined();
  });
  it('y1 ~ x1, y1 an indicator of a factor, imports as a direct effect on the indicator: spec, Mplus input, project, validation', () => {
    const { model, warnings } = parseLavaanSyntax('f1 =~ y1 + y2 + y3\nf1 ~ x1 + x2\ny1 ~ d*x1\ny3 ~ 0.5*x2');
    expect(warnings).toEqual([]);
    const id = (n: string) => model.constructs.find((c) => c.name === n)!.id;
    expect(model.constructs.map((c) => c.name)).toEqual(['f1', 'x1', 'x2']);
    expect(model.indicatorPaths).toEqual([expect.objectContaining({ from: id('x1'), to: 'y1', label: 'd' }), expect.objectContaining({ from: id('x2'), to: 'y3', fixed: 0.5 })]);
    expect(toSpec(model).indicatorPaths).toEqual([{ from: 'x1', to: 'y1', label: 'd' }, { from: 'x2', to: 'y3', fixed: 0.5 }]);
    const inp = toMplus(model, CB, null, null, 'p').inp;
    expect(inp).toContain('y1 ON x1 (d);');
    expect(inp).toContain('y3 ON x2@0.5;');
    expect(parseProject(serializeProject(model, CB, null, null)).model.indicatorPaths).toEqual(model.indicatorPaths);
    const data = { names: ['y1', 'y2', 'y3', 'x1', 'x2'], cols: Array.from({ length: 5 }, (_, j) => Float64Array.from({ length: 10 }, (_, i) => ((i * (j + 3)) % 7) + i / 10)) };
    expect(validateModel(model, data, { method: 'cbsem', consistent: false }).filter((i) => i.level === 'error')).toEqual([]);
    expect(validateModel(model, data, { method: 'pls', consistent: false }).map((i) => i.message)).toContain('The direct effect x1 → y1 on an indicator is a CB-SEM parameter; switch to CB-SEM or remove it.');
    // The loading is not a direct effect.
    expect(parseLavaanSyntax('f1 =~ y1 + y2 + y3\ny1 ~ f1').warnings).toEqual([expect.stringMatching(/loading of y1/)]);
  });
  it('an indicator may belong to a factor outside an ESEM block and to the block (Mplus example 5.30)', () => {
    const { model } = parseLavaanSyntax('fg =~ NA*y1 + y2 + y3 + y4\nfg ~~ 1*fg\nf1 =~ y1 + y2\nf2 =~ y3 + y4\nfg ~~ 0*f1\nfg ~~ 0*f2');
    const ids = model.constructs.filter((c) => c.name !== 'fg').map((c) => c.id);
    const data = { names: ['y1', 'y2', 'y3', 'y4'], cols: Array.from({ length: 4 }, (_, j) => Float64Array.from({ length: 10 }, (_, i) => ((i * (j + 3)) % 7) + i / 10)) };
    const assigned = (m: ModelState) => validateModel(m, data, { method: 'cbsem', consistent: false }).filter((i) => /assigned to both/.test(i.message));
    expect(assigned(model)).not.toEqual([]);
    expect(assigned({ ...model, esem: { rotation: 'geomin', blocks: [{ id: 'b', constructs: ids }] } })).toEqual([]);
  });
});
