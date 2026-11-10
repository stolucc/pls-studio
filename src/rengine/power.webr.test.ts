// The power analysis card equals semPower called directly in desktop R (scripts/validation/sempower.R): the help pages'
// a priori, post hoc and compromise examples, the power to detect a parameter of the canvas model against
// semPower.powerLav, and the RMSEA equivalence test against dynamic::equivTest and lavaan's RMSEA interval.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Dataset } from '../engine/types';
import { toSpec, type ModelState } from '../model/project';
import { rCall } from './bridge';
import { powerR, powerScriptR, type PowerModel } from './power';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const ref = JSON.parse(readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'power', 'reference.json'), 'utf8'));
const F = (name: string, indicators: string[]) => ({ id: name, name, type: 'factor' as const, mode: 'A' as const, indicators, x: 0, y: 0, side: 'left' as const });
const HS: ModelState = {
  constructs: [F('visual', ['x1', 'x2', 'x3']), F('textual', ['x4', 'x5', 'x6']), F('speed', ['x7', 'x8', 'x9'])], paths: [], moderations: [],
  correlations: [{ id: 'k1', kind: 'construct', a: 'visual', b: 'textual' }, { id: 'k2', kind: 'construct', a: 'visual', b: 'speed' }, { id: 'k3', kind: 'construct', a: 'textual', b: 'speed' }],
};
let model: PowerModel;
beforeAll(async () => {
  const raw = await rCall<{ names: string[]; cols: (number | null)[][] }>('ps_dataset', { package: 'lavaan', name: 'HolzingerSwineford1939', na: [] }, 'lavaan');
  const data: Dataset = { names: raw.names, cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))) };
  model = { data, spec: toSpec(HS), missing: 'casewise', estimator: 'ML' };
}, 600_000);

describe('power analysis (semPower)', () => {
  it('a priori, post hoc and compromise power equal the help pages’ examples run natively', async () => {
    const a = await powerR({ analysis: 'apriori', alpha: 0.05, measure: 'RMSEA', effect: 0.05, df: 200, power: 0.95 }, null);
    expect(a.n).toBe(ref.apriori.requiredN);
    expect(a.power).toBeCloseTo(ref.apriori.impliedPower, 10);
    expect(a.ncp).toBeCloseTo(ref.apriori.impliedNCP, 10);
    expect(a.chiCrit).toBeCloseTo(ref.apriori.chiCrit, 8);
    expect(a.mc).toBeCloseTo(ref.apriori.mc, 10);
    // The power curve passes through the required N with its implied power.
    expect(a.curve!.n.length).toBeGreaterThan(10);
    const p = await powerR({ analysis: 'posthoc', alpha: 0.05, measure: 'RMSEA', effect: 0.05, df: 200, n: 250 }, null);
    expect(p.power).toBeCloseTo(ref.posthoc.power, 10);
    expect(p.ncp).toBeCloseTo(ref.posthoc.ncp, 10);
    const at = p.curve!.n.indexOf(250);
    if (at >= 0) expect(p.curve!.power[at]).toBeCloseTo(ref.posthoc.power, 10);
    const c = await powerR({ analysis: 'compromise', alpha: 0.05, measure: 'RMSEA', effect: 0.08, df: 200, n: 250, abratio: 1 }, null);
    expect(c.chiCrit).toBeCloseTo(ref.compromise.chiCrit, 6);
    expect(c.alpha! / ref.compromise.impliedAlpha).toBeCloseTo(1, 6);
    expect(c.curve).toBeUndefined();
    const g = await powerR({ analysis: 'apriori', alpha: 0.05, measure: 'AGFI', effect: 0.95, df: 100, p: 20, power: 0.8 }, null);
    expect(g.n).toBe(ref.agfi.requiredN);
    expect(g.fmin).toBeCloseTo(ref.agfi.fmin, 10);
    const script = await powerScriptR({ analysis: 'apriori', alpha: 0.05, measure: 'RMSEA', effect: 0.05, df: 200, power: 0.95 }, null);
    expect(script).toContain('pw <- semPower.aPriori(effect = 0.05, effect.measure = "RMSEA", alpha = 0.05, power = 0.95, df = 200)');
  }, 600_000);

  it('the power to detect a covariance of the canvas model equals semPower.powerLav', async () => {
    const param = { lhs: 'visual', op: '~~' as const, rhs: 'textual', value: 0 };
    const a = await powerR({ analysis: 'parameter', alpha: 0.05, type: 'apriori', power: 0.8, param }, model);
    expect(a.estimate).toBeCloseTo(ref.parameter.estimate, 6);
    expect(a.n).toBe(ref.parameter.apriori.requiredN);
    expect(a.fmin).toBeCloseTo(ref.parameter.apriori.fmin, 8);
    expect(a.power).toBeCloseTo(ref.parameter.apriori.impliedPower, 8);
    expect(a.df).toBe(1);
    expect(a.sampleN).toBe(301);
    const p = await powerR({ analysis: 'parameter', alpha: 0.05, type: 'posthoc', n: 100, param }, model);
    expect(p.power).toBeCloseTo(ref.parameter.posthoc.power, 8);
    expect(p.ncp).toBeCloseTo(ref.parameter.posthoc.ncp, 6);
    await expect(powerR({ analysis: 'parameter', alpha: 0.05, type: 'posthoc', n: 100, param: { ...param, rhs: 'nope' } }, model)).rejects.toThrow(/not in the model/);
    await expect(powerR({ analysis: 'parameter', alpha: 0.05, type: 'posthoc', n: 100, param: { lhs: 'visual', op: '~', rhs: 'textual', value: 0 } }, model)).rejects.toThrow(/not a free parameter/);
    expect(await powerScriptR({ analysis: 'parameter', alpha: 0.05, type: 'apriori', power: 0.8, param }, model)).toContain('fit0 <- lavaan(pt0, sample.cov = Sigma');
  }, 600_000);

  it('the RMSEA equivalence test: the T-size RMSEA is lavaan’s 90% upper limit; the cutoffs dynamic::equivTest’s', async () => {
    const e = ref.equivalence;
    const m = await powerR({ analysis: 'equivalence', alpha: 0.05, source: 'model' }, model);
    expect(m.chisq).toBeCloseTo(e.chisq, 6);
    expect(m.rmsea).toBeCloseTo(e.rmsea, 8);
    expect(m.rmseaT).toBeCloseTo(e.rmseaUpper90, 6);
    expect(Number(m.rmseaT!.toFixed(3))).toBe(e.dynamicRmseaT);
    expect(m.cutoffs!.map((x) => Number(x.toFixed(3)))).toEqual(e.dynamicCutoffs);
    expect(m.verdict).toBe('mediocre');
    const manual = await powerR({ analysis: 'equivalence', alpha: 0.05, source: 'manual', chisq: e.chisq, df: e.df, n: e.n }, null);
    expect(manual.rmseaT).toBeCloseTo(m.rmseaT!, 10);
    // T below its df's alpha-quantile: no noncentrality, a T-size RMSEA of zero.
    expect((await powerR({ analysis: 'equivalence', alpha: 0.05, source: 'manual', chisq: 5, df: 24, n: 301 }, null)).rmseaT).toBe(0);
  }, 600_000);
});
