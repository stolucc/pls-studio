// Free covariances in CB-SEM (correlated errors and disturbances). Numerical
// agreement with lavaan / MIIVsem is in validation.test.ts (cov_* cases); these
// tests cover the model rules and the instrument logic.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { estimateCb } from './cbsem';
import { parseCsv } from './dataset';
import { estimateMiiv } from './miiv';
import type { CovarianceSpec, ModelSpec } from './types';
import { cases, loadData, toSpec } from './validationHarness';

const data = parseCsv(readFileSync(join(__dirname, '__fixtures__', 'validation', 'data', 'political_democracy.csv'), 'utf8')).dataset;
const f = (name: string, indicators: string[]) => ({ name, mode: 'A' as const, type: 'factor' as const, indicators });
const base: ModelSpec = {
  constructs: [f('ind60', ['x1', 'x2', 'x3']), f('dem60', ['y1', 'y2', 'y3', 'y4']), f('dem65', ['y5', 'y6', 'y7', 'y8'])],
  paths: [{ from: 'ind60', to: 'dem60' }, { from: 'ind60', to: 'dem65' }, { from: 'dem60', to: 'dem65' }],
};
const withCov = (covariances: CovarianceSpec[], spec = base): ModelSpec => ({ ...spec, covariances });
const ind = (a: string, b: string): CovarianceSpec => ({ a, b, kind: 'indicator' });

describe('CB-SEM covariances', () => {
  it('each error covariance costs one degree of freedom and lowers χ²', () => {
    const r0 = estimateCb(data, base);
    const r1 = estimateCb(data, withCov([ind('y1', 'y5')]));
    expect(r1.fit.df).toBe(r0.fit.df - 1);
    expect(r1.fit.chisq).toBeLessThan(r0.fit.chisq);
    const e = r1.estimates.find((x) => x.kind === 'rescov')!;
    expect([e.lhs, e.rhs]).toEqual(['y1', 'y5']);
    // Standardised = error correlation, within (−1, 1).
    expect(Math.abs(e.std)).toBeLessThan(1);
  });

  it('ignores duplicates in either order', () => {
    const r1 = estimateCb(data, withCov([ind('y1', 'y5')]));
    const r2 = estimateCb(data, withCov([ind('y1', 'y5'), ind('y5', 'y1')]));
    expect(r2.fit.npar).toBe(r1.fit.npar);
  });

  it('exogenous constructs already covary: an explicit arrow adds nothing', () => {
    const cfa: ModelSpec = { constructs: base.constructs, paths: [] };
    const r0 = estimateCb(data, cfa);
    const r1 = estimateCb(data, withCov([{ a: 'ind60', b: 'dem60', kind: 'construct' }], cfa));
    expect(r1.fit.npar).toBe(r0.fit.npar);
  });

  it('rejects ill-posed covariances', () => {
    expect(() => estimateCb(data, withCov([{ a: 'ind60', b: 'dem60', kind: 'construct' }]))).toThrow(/exogenous construct with the disturbance/);
    expect(() => estimateCb(data, withCov([ind('y1', 'y1')]))).toThrow(/itself/);
    expect(() => estimateCb(data, withCov([ind('y1', 'nope')]))).toThrow(/not in the model/);
    const single: ModelSpec = { ...base, constructs: [...base.constructs, f('solo', ['x4'])], paths: [...base.paths] };
    expect(() => estimateCb({ ...data, names: [...data.names, 'x4'], cols: [...data.cols, data.cols[0]] }, withCov([ind('y1', 'x4')], single))).toThrow(/single-indicator/);
  });

  it('MIIV-2SLS drops instruments whose errors correlate with the equation error', () => {
    const plain = estimateMiiv(data, base).equations.find((q) => q.dv === 'y2')!;
    const corr = estimateMiiv(data, withCov([ind('y1', 'y5')])).equations.find((q) => q.dv === 'y2')!;
    // y2 = λ y1 + (ε2 − λ ε1): with ε1 ~~ ε5, y5 is no longer a valid instrument.
    expect(plain.instruments).toContain('y5');
    expect(corr.instruments).not.toContain('y5');
  });
});

describe('unidentified models', () => {
  // EMSE model: Engagement predicts Job satisfaction; correlating their disturbances is not identified.
  const c = cases.find((k) => k.name === 'emse_sem_mlm')!;
  const spec = { ...toSpec(c), covariances: [{ a: 'engag', b: 'js', kind: 'construct' as const }] };
  it.each(['ML', 'MLM'] as const)('%s: estimates with a warning instead of failing', (est) => {
    const r = estimateCb(loadData(c), spec, 'casewise', est);
    expect(r.warnings.some((w) => /standard errors are unavailable/i.test(w))).toBe(true);
    expect(Number.isFinite(r.fit.chisq)).toBe(true);
  });
});
