import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, toSpec, validateModel, type ModelState } from './project';
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
    expect(warnings).toEqual(expect.arrayContaining([expect.stringMatching(/main effect of F1 was added/), expect.stringMatching(/variance of Y/), expect.stringMatching(/Thresholds/), expect.stringMatching(/Constraint/)]));
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
    expect(inp).toContain('textual BY x4 x5* (a) x6*;');
    expect(inp).toContain('textual ON visual (b) ageyr;');
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
    const taken = new Map<string, string>();
    expect([mplusName('my var', taken), mplusName('1st', taken), mplusName('my_var', taken), mplusName('my var', taken)]).toEqual(['my_var', 'v1st', 'my_var_2', 'my_var']);
  });
});
