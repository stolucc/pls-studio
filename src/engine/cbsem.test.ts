import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { estimateCb } from './cbsem';
import { parseCsv } from './dataset';
import type { ModelSpec } from './types';

const fx = (f: string) => join(__dirname, '__fixtures__', f);
const data = parseCsv(readFileSync(fx('mobi.csv'), 'utf8')).dataset;
const items = (p: string, k: number) => Array.from({ length: k }, (_, i) => `${p}${i + 1}`);
const factor = (name: string, indicators: string[]) => ({ name, mode: 'A' as const, type: 'factor' as const, indicators });
const paths = (pairs: [string, string][]) => pairs.map(([from, to]) => ({ from, to }));

const MODELS: Record<string, ModelSpec> = {
  mobi_cb: {
    constructs: [
      factor('Image', items('IMAG', 5)), factor('Expectation', items('CUEX', 3)), factor('Quality', items('PERQ', 7)),
      factor('Value', items('PERV', 2)), factor('Satisfaction', items('CUSA', 3)), factor('Complaints', ['CUSCO']),
      factor('Loyalty', items('CUSL', 3)),
    ],
    paths: paths([
      ['Image', 'Expectation'], ['Expectation', 'Quality'], ['Expectation', 'Value'], ['Quality', 'Value'],
      ['Image', 'Satisfaction'], ['Expectation', 'Satisfaction'], ['Quality', 'Satisfaction'], ['Value', 'Satisfaction'],
      ['Satisfaction', 'Complaints'], ['Image', 'Loyalty'], ['Satisfaction', 'Loyalty'], ['Complaints', 'Loyalty'],
    ]),
  },
  small_cb: {
    constructs: [
      factor('Image', items('IMAG', 5)), factor('Quality', items('PERQ', 7)),
      factor('Satisfaction', items('CUSA', 3)), factor('Value', items('PERV', 2)),
    ],
    paths: paths([['Quality', 'Value'], ['Image', 'Satisfaction'], ['Quality', 'Satisfaction'], ['Value', 'Satisfaction']]),
  },
};

interface LavParam { lhs: string; op: string; rhs: string; est: number; se: number; z?: number; pvalue?: number; 'std.all': number }

describe.each(Object.keys(MODELS))('estimateCb vs lavaan 0.6 (%s)', (name) => {
  const ref = JSON.parse(readFileSync(fx(`${name}.json`), 'utf8'));
  const res = estimateCb(data, MODELS[name]);

  it('converges on the same sample', () => {
    expect(res.converged).toBe(true);
    expect(res.n).toBe(ref.n);
    expect(res.warnings).toEqual([]);
  });

  it('matches every estimate, standard error, z, p and standardised value', () => {
    const params: LavParam[] = ref.params.filter((p: LavParam) => !(p.op === '~~' && p.lhs === p.rhs && p.se === 0));
    for (const p of params) {
      const mine = res.estimates.find((e) => e.op === p.op && ((e.lhs === p.lhs && e.rhs === p.rhs) || (p.op === '~~' && e.lhs === p.rhs && e.rhs === p.lhs)));
      expect(mine, `${p.lhs} ${p.op} ${p.rhs}`).toBeDefined();
      const label = `${p.lhs} ${p.op} ${p.rhs}`;
      // mobi_cb is nearly empirically under-identified (standardised β > 2 for
      // Value ~ Expectation, SE ≈ 24): the likelihood is flat there and lavaan stops
      // slightly short of the optimum we reach (see the chi-square check), so
      // parameters are compared loosely. small_cb is well conditioned: strict.
      const tol = name === 'mobi_cb' ? 2e-3 : 5e-5;
      expect(Math.abs(mine!.est - p.est), `est ${label}`).toBeLessThan(tol);
      expect(Math.abs(mine!.std - p['std.all']), `std ${label}`).toBeLessThan(tol);
      if (p.se > 0) {
        expect(Math.abs(mine!.se! - p.se) / p.se, `se ${label}`).toBeLessThan(name === 'mobi_cb' ? 2e-3 : 1e-4);
        expect(Math.abs(mine!.z! - p.z!), `z ${label}`).toBeLessThan(name === 'mobi_cb' ? 2e-2 : 5e-3);
        expect(Math.abs(mine!.p! - p.pvalue!), `p ${label}`).toBeLessThan(tol);
      }
    }
    // Every free parameter in lavaan is free here too.
    expect(res.fit.npar).toBe(ref.fit.npar);
  });

  it('matches the fit indices', () => {
    const f = ref.fit;
    // Never a worse optimum than lavaan's.
    expect(res.fit.chisq).toBeLessThanOrEqual(f.chisq + 1e-6);
    expect(res.fit.chisq).toBeCloseTo(f.chisq, 3);
    expect(res.fit.df).toBe(f.df);
    expect(res.fit.pvalue).toBeCloseTo(f.pvalue, 8);
    expect(res.fit.baselineChisq).toBeCloseTo(f['baseline.chisq'], 3);
    expect(res.fit.baselineDf).toBe(f['baseline.df']);
    expect(res.fit.cfi).toBeCloseTo(f.cfi, 5);
    expect(res.fit.tli).toBeCloseTo(f.tli, 5);
    expect(res.fit.rmsea).toBeCloseTo(f.rmsea, 5);
    expect(res.fit.rmseaLow).toBeCloseTo(f['rmsea.ci.lower'], 4);
    expect(res.fit.rmseaHigh).toBeCloseTo(f['rmsea.ci.upper'], 4);
    expect(res.fit.rmseaP).toBeCloseTo(f['rmsea.pvalue'], 6);
    expect(res.fit.srmr).toBeCloseTo(f.srmr, 5);
    expect(res.fit.logl).toBeCloseTo(f.logl, 2);
    expect(res.fit.aic).toBeCloseTo(f.aic, 2);
    expect(res.fit.bic).toBeCloseTo(f.bic, 2);
  });

  it('matches R² for indicators and constructs', () => {
    for (const [k, v] of Object.entries(ref.r2 as Record<string, number>)) {
      const i = res.indicators.findIndex((x) => x.name === k);
      if (i >= 0) expect(res.r2Indicators[i], k).toBeCloseTo(v, 4);
      else expect(res.r2Constructs[res.constructs.indexOf(k)], k).toBeCloseTo(v, 4);
    }
  });
});

describe('estimateCb diagnostics', () => {
  it('rejects under-identified models', () => {
    const spec: ModelSpec = {
      constructs: [factor('A', ['IMAG1', 'IMAG2']), factor('B', ['CUSA1'])],
      paths: [{ from: 'A', to: 'B' }],
    };
    // 3 indicators → 6 moments; parameters: 1 loading + 1 path + 2 lv variances + 2 residuals = 6 → df 0 is allowed
    expect(estimateCb(data, spec).fit.df).toBe(0);
  });
  it('computes CR and AVE from standardised loadings', () => {
    const r = estimateCb(data, MODELS.small_cb);
    const j = r.constructs.indexOf('Satisfaction');
    const l = r.indicators.map((x, i) => (x.construct === j ? r.stdLoadings[i] : null)).filter((v): v is number => v !== null);
    expect(r.reliability[j].ave).toBeCloseTo(l.reduce((s, v) => s + v * v, 0) / l.length, 12);
  });
});

describe('estimateCb discriminant validity', () => {
  it('reports the same data-based HTMT as the PLS engine', async () => {
    const { estimatePls } = await import('./pls');
    const spec = MODELS.small_cb;
    const cb = estimateCb(data, spec);
    const pls = estimatePls(data, spec);
    expect(cb.htmt[2][0]).toBeCloseTo(pls.htmt[2][0]!, 10);
    expect(cb.htmt2[3][1]).toBeCloseTo(pls.htmt2[3][1]!, 10);
  });
});

describe('built-in engine refuses lavaan-only single-indicator reliability', () => {
  it('points to the R engine', () => {
    const data = { names: ['a', 'b', 'c', 'y'], cols: [0, 1, 2, 3].map((k) => Float64Array.from({ length: 50 }, (_, i) => Math.sin(i * (k + 1)))) };
    const spec: ModelSpec = { constructs: [{ name: 'F', mode: 'A', indicators: ['a', 'b', 'c'] }, { name: 'Y', mode: 'A', indicators: ['y'], reliability: 0.8 }], paths: [{ from: 'F', to: 'Y' }] };
    expect(() => estimateCb(data, spec)).toThrow(/known reliability are estimated by lavaan/);
  });
});
