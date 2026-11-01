// The textbook matrix examples (Wheaton et al. 1977; Thurstone's mental tests;
// Kerckhoff 1974) are valid CB-SEM projects and the built-in estimator
// reproduces the published solutions (numbers from native lavaan on the same
// matrices, which agree with the sem package's and the manuals' output).

import { describe, expect, it } from 'vitest';
import { estimateCb } from '../engine/cbsem';
import { DEFAULT_SETTINGS, toSpec, validateModel } from '../model/project';
import { fromLowerTriangle, KERCKHOFF_R, makeKerckhoffExample, makeThurstoneExample, makeWheatonExample, THURSTONE_R, WHEATON_S } from './textbook';

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
