// The EFA request and result (R/efa.R): the lavaan extraction's options travel only with it, and its
// standard errors and fit by number of factors are read back.

import { describe, expect, it } from 'vitest';
import { DEFAULT_EFA } from '../model/efa';
import { efaRequest, parseEfa } from './efa';

const data = { names: ['a', 'b', 'c'], cols: [Float64Array.from([1, 2, NaN]), Float64Array.from([2, 3, 4]), Float64Array.from([0, 1, 1])] };

describe('EFA request', () => {
  it('sends ε, the information matrix and the smallest number of factors with the lavaan extraction only', () => {
    const d = { ...DEFAULT_EFA, vars: ['a', 'b', 'c'], epsilon: 0.01, information: 'observed' as const, from: 2 };
    expect(efaRequest(data, { ...d, method: 'lavaan' }, 1)).toMatchObject({ method: 'lavaan', epsilon: 0.01, information: 'observed', from: 2 });
    const psych = efaRequest(data, { ...d, method: 'ml' }, 1);
    expect(['epsilon', 'information', 'from'].filter((k) => k in psych)).toEqual([]);
    expect(psych.data.cols[0]).toEqual([1, 2, null]);
  });
  it('sends the WLSMV options (lavaan 0.7’s standard errors, Mplus’s test statistic) with polychoric correlations only', () => {
    const d = { ...DEFAULT_EFA, vars: ['a', 'b', 'c'], method: 'lavaan' as const, wlsmvSe: 'lavaan' as const, mimic: 'Mplus' as const };
    expect(efaRequest(data, { ...d, correlation: 'polychoric' }, 1)).toMatchObject({ wlsmvSe: 'lavaan', mimic: 'Mplus' });
    const pearson = efaRequest(data, d, 1);
    expect(['wlsmvSe', 'mimic'].filter((k) => k in pearson)).toEqual([]);
    // (the default, Mplus's standard errors, sends nothing)
    expect('wlsmvSe' in efaRequest(data, { ...d, wlsmvSe: undefined, correlation: 'polychoric' }, 1)).toBe(false);
  });
});

describe('EFA congruence comparison', () => {
  it('sends the second solution with a psych extraction only', () => {
    const d = { ...DEFAULT_EFA, vars: ['a', 'b', 'c'], compare: { method: 'ml' as const, rotation: 'varimax' as const } };
    expect(efaRequest(data, d, 1)).toMatchObject({ compare: { method: 'ml', rotation: 'varimax' } });
    expect('compare' in efaRequest(data, { ...d, method: 'lavaan' }, 1)).toBe(false);
    expect('compare' in efaRequest(data, DEFAULT_EFA, 1)).toBe(false);
  });

  it('reads the coefficients and the second solution’s loadings back', () => {
    const r = parseEfa({
      method: 'minres', rotation: 'oblimin', oblique: true, n: 3, k: 2,
      variables: ['a', 'b', 'c'], factors: ['MR1', 'MR2'], loadings: [[0.7, 0], [0.6, 0.1], [0, 0.8]],
      congruence: {
        method: 'pca', rotation: 'varimax', factors: ['RC1', 'RC2'],
        coefficients: [[0.99, 0.1], [-0.2, 0.9]], loadings: [[0.8, 0], [0.7, 0.1], [0.1, 0.9]],
      },
      fit: {}, engine: { package: 'psych', version: '2.6.9' },
    });
    expect(r.congruence).toEqual({
      method: 'pca', rotation: 'varimax', factors: ['RC1', 'RC2'],
      coefficients: [[0.99, 0.1], [-0.2, 0.9]], loadings: [[0.8, 0], [0.7, 0.1], [0.1, 0.9]],
    });
    expect(parseEfa({ ...r, congruence: undefined }).congruence).toBeUndefined();
  });
});

describe('EFA result', () => {
  const raw = { method: 'lavaan', rotation: 'geominQ', oblique: true, n: 3, k: 2, variables: ['a', 'b', 'c'], factors: ['f1', 'f2'], estimator: 'ML',
    loadings: [[0.7, 0], [0.6, 0.1], [0, 0.8]], se: { loadings: [[0.05, 0.02], [0.04, 0.03], [0.01, 0.06]], phi: [[0, 0.07], [0.07, 0]], uniqueness: [0.1, 0.1, 0.2] },
    comparison: [{ k: 1, npar: 6, chisq: 10, df: 0 }, { k: 2, npar: 7, chisq: 1, df: 0 }], fit: { chisq: 1, logl: -10 }, engine: { package: 'lavaan', version: '0.7.3' } };
  it('reads the standard errors and the fit by number of factors of the lavaan extraction', () => {
    const r = parseEfa(raw);
    expect(r.estimator).toBe('ML');
    expect(r.se?.loadings[2]).toEqual([0.01, 0.06]);
    expect(r.se?.phi?.[1][0]).toBe(0.07);
    expect(r.comparison?.map((x) => x.k)).toEqual([1, 2]);
    expect(r.fit.logl).toBe(-10);
  });
  it('a psych solution has neither', () => {
    const { se: _s, comparison: _c, estimator: _e, ...psych } = raw;
    const r = parseEfa({ ...psych, method: 'minres' });
    expect([r.se, r.comparison, r.estimator]).toEqual([undefined, undefined, undefined]);
  });
});
