// The textbook matrix examples (Wheaton et al. 1977; Thurstone's mental tests;
// Kerckhoff 1974) are valid CB-SEM projects and the built-in estimator
// reproduces the published solutions (numbers from native lavaan on the same
// matrices, which agree with the sem package's and the manuals' output).

import { describe, expect, it } from 'vitest';
import { estimateCb } from '../engine/cbsem';
import { DEFAULT_SETTINGS, toSpec, validateModel } from '../model/project';
import { fromLowerTriangle, HAYDUK_NAMES, HAYDUK_OLDER_S, HAYDUK_RELIABILITY, HAYDUK_S, HAYDUK_STACKED_NAMES, HAYDUK_YOUNGER_S, KERCKHOFF_R, makeHaydukExample, makeHaydukStackedExample, makeKerckhoffExample, makeThurstoneExample, makeWheatonExample, THURSTONE_R, WHEATON_S } from './textbook';

const est = (cb: ReturnType<typeof estimateCb>, op: string, lhs: string, rhs: string) => cb.estimates.find((e) => e.op === op && e.lhs === lhs && e.rhs === rhs)!;

describe('matrices from the lower triangle', () => {
  it('fills a symmetric matrix with or without the diagonal', () => {
    expect(fromLowerTriangle(['a', 'b'], [1, 0.5, 2], true)).toEqual([[1, 0.5], [0.5, 2]]);
    expect(fromLowerTriangle(['a', 'b', 'c'], [0.1, 0.2, 0.3], false)).toEqual([[1, 0.1, 0.2], [0.1, 1, 0.3], [0.2, 0.3, 1]]);
    expect(() => fromLowerTriangle(['a', 'b'], [1, 2], true)).toThrow(/Expected 3 values/);
  });
  it('the published matrices are symmetric with the right dimensions', () => {
    for (const [S, p] of [[WHEATON_S, 6], [THURSTONE_R, 9], [KERCKHOFF_R, 7]] as const) {
      expect(S.length).toBe(p);
      for (let i = 0; i < p; i++) for (let j = 0; j < p; j++) expect(S[i][j]).toBe(S[j][i]);
    }
    expect(WHEATON_S[5][5]).toBe(450.288);
    expect(THURSTONE_R[8][6]).toBe(0.598);
    expect(KERCKHOFF_R[6][5]).toBe(0.651);
  });
});

describe('stability of alienation (Wheaton et al. 1977)', () => {
  const ex = makeWheatonExample(DEFAULT_SETTINGS);
  it('is a valid CB-SEM project on a covariance matrix with two correlated errors', () => {
    expect(ex.settings).toMatchObject({ method: 'cbsem', estimator: 'ML' });
    expect(validateModel(ex.model, ex.data, ex.settings).filter((i) => i.level === 'error')).toEqual([]);
    expect(ex.model.correlations!.filter((k) => k.kind === 'indicator').map((k) => [k.a, k.b])).toEqual([['Anomia67', 'Anomia71'], ['Powerless67', 'Powerless71']]);
    expect(ex.data.moments!.n).toBe(932);
    expect(ex.info.kind).toBe('matrix');
  });
  it('reproduces Bollen (1989): chi-square 4.73 on 4 df and the structural coefficients', () => {
    const cb = estimateCb(ex.data, toSpec(ex.model), 'casewise', 'ML');
    expect(cb.fit.chisq).toBeCloseTo(4.735, 2);
    expect(cb.fit.df).toBe(4);
    expect(est(cb, '~', 'Alienation 1967', 'SES').est).toBeCloseTo(-0.575, 3);
    expect(est(cb, '~', 'Alienation 1971', 'SES').est).toBeCloseTo(-0.227, 3);
    expect(est(cb, '~', 'Alienation 1971', 'Alienation 1967').est).toBeCloseTo(0.607, 3);
    expect(est(cb, '~', 'Alienation 1971', 'Alienation 1967').se).toBeCloseTo(0.051, 3);
    expect(est(cb, '=~', 'SES', 'SEI').est).toBeCloseTo(5.219, 2);
    expect(est(cb, '=~', 'Alienation 1967', 'Powerless67').est).toBeCloseTo(0.979, 3);
    expect(est(cb, '~~', 'Anomia67', 'Anomia71').est).toBeCloseTo(1.623, 3);
    expect(est(cb, '~~', 'Powerless67', 'Powerless71').est).toBeCloseTo(0.339, 3);
  });
});

describe('Thurstone mental tests: second-order CFA (SAS/STAT PROC CALIS manual)', () => {
  const ex = makeThurstoneExample(DEFAULT_SETTINGS);
  it('is a valid CB-SEM project with a second-order factor over three first-order factors', () => {
    expect(validateModel(ex.model, ex.data, ex.settings).filter((i) => i.level === 'error')).toEqual([]);
    const general = ex.model.constructs.find((c) => c.name === 'General ability')!;
    expect(general.components!.length).toBe(3);
    expect(general.indicators).toEqual([]);
    expect(ex.data.moments!.n).toBe(213);
  });
  it('reproduces the manual: chi-square 38.38 on 24 df and the standardised loadings', () => {
    const cb = estimateCb(ex.data, toSpec(ex.model), 'casewise', 'ML');
    expect(cb.fit.chisq).toBeCloseTo(38.376, 2);
    expect(cb.fit.df).toBe(24);
    expect(cb.fit.rmsea).toBeCloseTo(0.053, 3);
    expect(est(cb, '=~', 'Verbal', 'Sentences').std).toBeCloseTo(0.905, 3);
    expect(est(cb, '=~', 'Verbal', 'Vocabulary').std).toBeCloseTo(0.914, 3);
    expect(est(cb, '=~', 'Word fluency', 'Suffixes').std).toBeCloseTo(0.703, 3);
    expect(est(cb, '=~', 'General ability', 'Verbal').std).toBeCloseTo(0.822, 3);
    expect(est(cb, '=~', 'General ability', 'Word fluency').std).toBeCloseTo(0.782, 3);
    expect(est(cb, '=~', 'General ability', 'Reasoning').std).toBeCloseTo(0.815, 3);
  });
});

describe('ambition and attainment (Kerckhoff 1974; LISREL manual)', () => {
  const ex = makeKerckhoffExample(DEFAULT_SETTINGS);
  it('is a valid observed-variable path model with four fixed exogenous variables', () => {
    expect(validateModel(ex.model, ex.data, ex.settings).filter((i) => i.level === 'error')).toEqual([]);
    expect(ex.model.constructs.filter((c) => c.covariate).map((c) => c.name)).toEqual(['Intelligence', 'Siblings', 'FatherEd', 'FatherOcc']);
    expect(ex.model.constructs.every((c) => c.indicators.length === 1)).toBe(true);
    expect(ex.model.paths.length).toBe(15);
    expect(ex.data.moments!.n).toBe(737);
  });
  it('reproduces the manual: a just-identified model with the published coefficients and R²', () => {
    const cb = estimateCb(ex.data, toSpec(ex.model), 'casewise', 'ML');
    expect(cb.fit.df).toBe(0);
    expect(Math.abs(cb.fit.chisq)).toBeLessThan(1e-6);
    expect(est(cb, '~', 'Grades', 'Intelligence').est).toBeCloseTo(0.526, 3);
    expect(est(cb, '~', 'Grades', 'Intelligence').se).toBeCloseTo(0.031, 3);
    expect(est(cb, '~', 'EducExp', 'Grades').est).toBeCloseTo(0.405, 3);
    expect(est(cb, '~', 'OccupAsp', 'EducExp').est).toBeCloseTo(0.550, 3);
    expect(est(cb, '~', 'OccupAsp', 'Intelligence').est).toBeCloseTo(-0.039, 3);
    const r2 = (name: string) => cb.r2Constructs[cb.constructs.indexOf(name)];
    expect(r2('Grades')).toBeCloseTo(0.349, 3);
    expect(r2('EducExp')).toBeCloseTo(0.483, 3);
    expect(r2('OccupAsp')).toBeCloseTo(0.443, 3);
  });
});

describe('smoking behaviour and antismoking acts (Hayduk 1987, ch. 4)', () => {
  const ex = makeHaydukExample(DEFAULT_SETTINGS);
  it('the transcribed covariances agree with the correlations printed above them (Figure 4.5)', () => {
    // The printed correlations, lower triangle by rows: a check on the transcription of the covariances.
    const printed = fromLowerTriangle(HAYDUK_NAMES, [
      0.021,
      0.012, -0.176,
      0.129, 0.213, 0.041,
      -0.043, -0.173, -0.021, -0.473,
      0.142, 0.268, -0.042, 0.641, -0.532,
      0.120, 0.047, -0.152, 0.381, -0.175, 0.396,
      -0.039, -0.116, -0.163, -0.176, 0.145, -0.072, -0.035,
      -0.026, -0.107, -0.199, -0.186, 0.119, -0.076, -0.030, 0.912,
      -0.089, -0.119, -0.120, -0.192, 0.178, -0.094, -0.039, 0.885, 0.807,
      -0.059, -0.116, -0.179, -0.198, 0.146, -0.090, -0.032, 0.900, 0.965, 0.916,
      0.168, 0.170, 0.078, 0.141, -0.086, 0.134, 0.150, -0.259, -0.288, -0.247, -0.288,
      0.078, -0.076, 0.118, -0.062, 0.003, -0.029, 0.084, -0.148, -0.150, -0.096, -0.126, 0.140,
    ], false);
    const sd = HAYDUK_S.map((r, i) => Math.sqrt(r[i]));
    for (let i = 0; i < 13; i++) for (let j = 0; j < i; j++) expect(Math.abs(HAYDUK_S[i][j] / (sd[i] * sd[j]) - printed[i][j]), `${HAYDUK_NAMES[i]} / ${HAYDUK_NAMES[j]}`).toBeLessThan(0.0025);
    // Standard deviations as printed (sex .500, age 15.7, antismoking acts 1.14).
    expect(sd[0]).toBeCloseTo(0.5, 3); expect(sd[1]).toBeCloseTo(15.7, 1); expect(sd[12]).toBeCloseTo(1.14, 2);
  });
  it('is a valid CB-SEM project for the R engine: seven single indicators with known reliabilities, gamma 32 fixed at zero', () => {
    expect(ex.settings).toMatchObject({ method: 'cbsem', estimator: 'ML', engine: 'r' });
    expect(validateModel(ex.model, ex.data, ex.settings).filter((i) => i.level === 'error')).toEqual([]);
    // The built-in engine cannot fix error variances: the validator says so, so the example pins the R engine.
    expect(validateModel(ex.model, ex.data, { ...ex.settings, engine: 'builtin' }).some((i) => i.level === 'error' && /known reliability/.test(i.message))).toBe(true);
    expect(ex.model.constructs.map((c) => [c.indicators[0], c.reliability])).toEqual(Object.entries(HAYDUK_RELIABILITY));
    expect(ex.model.constructs.some((c) => c.covariate)).toBe(false);
    const name = new Map(ex.model.constructs.map((c) => [c.id, c.name]));
    const into = (to: string) => ex.model.paths.filter((p) => name.get(p.to) === to).map((p) => name.get(p.from));
    expect(into('Smoking')).toEqual(['Sex', 'Age', 'Education', 'Strength of religion']);
    expect(into('Antismoking views')).toEqual(['Smoking', 'Sex', 'Age', 'Education', 'Strength of religion']);
    expect(into('Antismoking acts')).toEqual(['Smoking', 'Antismoking views', 'Sex', 'Education', 'Strength of religion']);
    // The spec carries the reliabilities for lavaan.R (error variance = (1 - r) x the indicator's variance in the matrix).
    expect(toSpec(ex.model).constructs.map((c) => c.reliability)).toEqual([0.99, 0.95, 0.9, 0.9, 0.9, 0.95, 0.95]);
    expect(ex.data.moments!.n).toBe(432);
    expect(ex.data.names.length).toBe(13);
  });
});

describe('stacked smoking model, younger and older respondents (Hayduk 1987, ch. 9)', () => {
  const ex = makeHaydukStackedExample(DEFAULT_SETTINGS);
  it('both transcribed matrices agree with the correlations printed with them (Figure 9.2)', () => {
    // Younger: the upper-right correlations; older: the lower-left ones (lower triangles by rows, in the matrices' variable order).
    const younger = fromLowerTriangle(HAYDUK_STACKED_NAMES, [
      0.904,
      -0.328, -0.394,
      -0.271, -0.245, 0.224,
      -0.036, -0.050, 0.191, 0.156,
      -0.076, -0.105, 0.014, 0.059, 0.021,
      -0.271, -0.312, 0.150, 0.217, 0.048, 0.260,
      -0.160, -0.215, 0.082, -0.075, 0.105, 0.067, 0.096,
      -0.023, -0.058, 0.042, -0.101, 0.050, 0.099, 0.033, 0.606,
    ], false);
    const older = fromLowerTriangle(HAYDUK_STACKED_NAMES, [
      0.895,
      -0.153, -0.142,
      -0.029, -0.015, 0.063,
      -0.038, -0.062, 0.130, 0.003,
      -0.126, -0.109, -0.003, -0.109, -0.034,
      -0.098, -0.098, 0.062, 0.038, -0.007, -0.269,
      -0.170, -0.162, 0.123, -0.032, 0.139, 0.088, 0.041,
      -0.099, -0.096, 0.170, 0.073, 0.228, 0.235, -0.069, 0.647,
    ], false);
    for (const [S, R, who] of [[HAYDUK_YOUNGER_S, younger, 'younger'], [HAYDUK_OLDER_S, older, 'older']] as const) {
      const sd = S.map((r, i) => Math.sqrt(r[i]));
      for (let i = 0; i < 9; i++) for (let j = 0; j < i; j++) expect(Math.abs(S[i][j] / (sd[i] * sd[j]) - R[i][j]), `${who}: ${HAYDUK_STACKED_NAMES[i]} / ${HAYDUK_STACKED_NAMES[j]}`).toBeLessThan(0.004);
    }
  });
  it('is a valid two-group CB-SEM project: the matrices as groups, coefficients equal except the heavy arrows, age -> acts back in', () => {
    expect(ex.settings).toMatchObject({ method: 'cbsem', estimator: 'ML', engine: 'r' });
    expect(validateModel(ex.model, ex.data, ex.settings).filter((i) => i.level === 'error')).toEqual([]);
    expect(ex.data.moments!.groups!.map((g) => [g.label, g.n])).toEqual([['Younger', 213], ['Older', 219]]);
    expect(ex.data.moments!.n).toBe(432);
    expect(ex.info.rows).toBe(432);
    const mg = ex.model.multigroup!;
    expect(mg.column).toBe('');
    expect(mg.structural).toEqual(['regressions']);
    expect(ex.model.paths.length).toBe(15);
    const name = new Map(ex.model.constructs.map((c) => [c.id, c.name]));
    const freed = mg.free.map((f) => (f.kind === 'regression' ? `${name.get(f.from)} → ${name.get(f.to)}` : f.kind));
    expect(freed).toEqual(['Sex → Antismoking acts', 'Age → Smoking', 'Age → Antismoking views', 'Age → Antismoking acts', 'Education → Smoking', 'Education → Antismoking views', 'Education → Antismoking acts', 'Smoking → Antismoking views', 'Smoking → Antismoking acts']);
    const spec = toSpec(ex.model);
    expect(spec.multigroup!.free[0]).toEqual({ kind: 'regression', from: 'Sex', to: 'Antismoking acts' });
    expect(spec.constructs.every((c) => c.reliability !== undefined)).toBe(true);
  });
});
