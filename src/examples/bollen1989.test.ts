// The Bollen (1989) examples: valid CB-SEM projects on the book's matrices
// (their fit is checked against native lavaan and the book in the webR test),
// and the single-indicator option they need: an estimated error variance.

import { describe, expect, it } from 'vitest';
import { estimateCb } from '../engine/cbsem';
import { DEFAULT_SETTINGS, parseProject, serializeProject, toSpec, validateModel, type ModelState } from '../model/project';
import { AIR_S, DEM_S, lowerToFull, makeAirQualityExample, makeDemocracyCfaExample, makeMoraleExample, makeSesErrorExample, makeSesExample, makeSesGroupsExample, MORALE_GROUPS, SES_WHITES } from './bollen1989';

const every = {
  ses: makeSesExample(DEFAULT_SETTINGS), sesError: makeSesErrorExample(DEFAULT_SETTINGS), sesGroups: makeSesGroupsExample(DEFAULT_SETTINGS), morale: makeMoraleExample(DEFAULT_SETTINGS),
  demUncorrelated: makeDemocracyCfaExample(DEFAULT_SETTINGS, 'uncorrelated'), demCorrelated: makeDemocracyCfaExample(DEFAULT_SETTINGS, 'correlated'), air: makeAirQualityExample(DEFAULT_SETTINGS),
};

describe('Bollen (1989) examples', () => {
  it('reads lower triangles as the book prints them', () => {
    expect(lowerToFull([1, 2, 3], 2)).toEqual([[1, 2], [2, 3]]);
    expect(() => lowerToFull([1, 2], 2)).toThrow(/Expected 3/);
    expect(SES_WHITES[4][4]).toBe(452.711);
    expect(SES_WHITES[1][4]).toBe(3.840);
    expect(MORALE_GROUPS.map((g) => g.n)).toEqual([49, 57]);
    expect(MORALE_GROUPS[1].S[6][5]).toBe(4.146);
    expect(DEM_S[7][7]).toBeCloseTo(3.246 ** 2, 9);
    expect(AIR_S[3][2]).toBe(0.312);
  });
  it('every example is a valid CB-SEM project on a matrix, laid out, fitted with N − 1 by lavaan as the book', () => {
    for (const [k, ex] of Object.entries(every)) {
      expect(validateModel(ex.model, ex.data, ex.settings).filter((i) => i.level === 'error'), k).toEqual([]);
      expect(ex.settings, k).toMatchObject({ method: 'cbsem', estimator: 'ML', engine: 'r' });
      expect(ex.model.likelihood, k).toBe('wishart');
      expect(ex.info.kind).toBe('matrix');
      expect(new Set(ex.model.constructs.map((c) => `${c.x},${c.y}`)).size, `${k}: constructs overlap`).toBe(ex.model.constructs.length);
    }
    expect(every.sesGroups.data.moments!.groups!.map((g) => [g.label, g.n])).toEqual([['Blacks', 368], ['Whites', 432]]);
    expect(every.sesGroups.model.multigroup).toMatchObject({ structural: ['regressions'], meanStructure: false });
    expect(every.morale.model.multigroup).toMatchObject({ invariance: 'scalar' });
    expect(every.morale.data.moments!.groups!.every((g) => g.means?.length === 7)).toBe(true);
    // Loadings equal over the waves: the same three labels in both years.
    const labels = toSpec(every.demCorrelated.model).constructs.map((c) => Object.values(c.loadingLabels ?? {}).sort());
    expect(labels).toEqual([['l2', 'l3', 'l4'], ['l2', 'l3', 'l4']]);
    expect(every.demCorrelated.model.correlations!.filter((k) => k.kind === 'indicator')).toHaveLength(6);
    expect((every.demUncorrelated.model.correlations ?? []).filter((k) => k.kind === 'indicator')).toHaveLength(0);
  });
  it('the exactly identified status model has its three disturbance covariances; the measurement-error one none; income and prestige covary', () => {
    const pairs = (ex: typeof every.ses) => { const nm = new Map(ex.model.constructs.map((c) => [c.id, c.name]));
      return ex.model.correlations!.filter((k) => k.kind === 'construct' && !k.zero).map((k) => [nm.get(k.a), nm.get(k.b)].sort().join(' ~~ ')).sort(); };
    expect(pairs(every.ses)).toEqual(['income ~~ prestige', 'subjIncome ~~ subjPrestige', 'subjIncome ~~ subjStatus', 'subjPrestige ~~ subjStatus']);
    expect(pairs(every.sesError)).toEqual(['income ~~ prestige']);
  });
  it('the built-in engine reproduces the air-quality fit (one factor, no lavaan options)', () => {
    const cb = estimateCb(every.air.data, toSpec(every.air.model), 'casewise', 'ML');
    expect(cb.fit.df).toBe(2);
    // (normal likelihood with N: 16.039 × 57 / 56)
    expect(cb.fit.chisq).toBeCloseTo(16.039 * 57 / 56, 1);
  });
});

describe('a single indicator with an estimated error variance', () => {
  const sesError = every.sesError;
  const withError = (m: ModelState) => m.constructs.filter((c) => c.freeError).map((c) => c.name);
  it('reaches lavaan, survives a save, and only where it applies', () => {
    expect(withError(sesError.model)).toEqual(['Subjective income', 'Subjective prestige']);
    expect(toSpec(sesError.model).constructs.filter((c) => c.freeError).map((c) => c.indicators[0])).toEqual(['subjIncome', 'subjPrestige']);
    const back = parseProject(serializeProject(sesError.model, sesError.settings, null, null));
    expect(withError(back.model)).toEqual(['Subjective income', 'Subjective prestige']);
    // A known reliability wins in the spec; validation asks to choose.
    const both = { ...sesError.model, constructs: sesError.model.constructs.map((c) => (c.freeError ? { ...c, reliability: 0.8 } : c)) };
    expect(toSpec(both).constructs.some((c) => c.freeError)).toBe(false);
    expect(validateModel(both, sesError.data, sesError.settings).some((i) => i.level === 'error' && /choose one/.test(i.message))).toBe(true);
  });
  it('is refused by the built-in engine, MIIV-2SLS and multi-indicator factors', () => {
    const errs = (s: typeof sesError.settings, m = sesError.model) => validateModel(m, sesError.data, s).filter((i) => i.level === 'error').map((i) => i.message).join(' | ');
    expect(errs({ ...sesError.settings, engine: 'builtin' })).toMatch(/estimated by lavaan/);
    expect(errs({ ...sesError.settings, estimator: '2SLS' })).toMatch(/not available with MIIV-2SLS/);
    const multi = { ...sesError.model, constructs: sesError.model.constructs.map((c) => (c.name === 'Subjective income' ? { ...c, indicators: ['subjIncome', 'income'] } : c)) };
    expect(errs(sesError.settings, multi)).toMatch(/single-indicator factor only/);
    expect(() => estimateCb(sesError.data, toSpec(sesError.model), 'casewise', 'ML')).toThrow(/estimated error variance/);
  });
});
