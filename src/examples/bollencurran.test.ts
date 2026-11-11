// Bollen & Curran (2004): the latent curve model drawn as a diagram reproduces
// native lavaan under the built-in engine; the ALT model is a valid R-engine project.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { estimateCb } from '../engine/cbsem';
import { DEFAULT_SETTINGS, toSpec, validateModel } from '../model/project';
import { BC_S, makeBollenCurranAltExample, makeBollenCurranLcmExample } from './bollencurran';

const ref = JSON.parse(
  readFileSync(
    join(__dirname, '..', 'engine', '__fixtures__', 'textbook', 'bollencurran.json'),
    'utf8',
  ),
) as Record<
  string,
  {
    chisq: number;
    df: number;
    estimates: { lhs: string; op: string; rhs: string; est: number; se: number }[];
  }
>;

describe('Bollen & Curran (2004) latent curve examples', () => {
  it('the latent curve model: held loadings, perfect fit on the generated matrix, intercept and slope (co)variances as lavaan', () => {
    const ex = makeBollenCurranLcmExample(DEFAULT_SETTINGS);
    expect(BC_S[4][0]).toBe(0.406);
    expect(
      validateModel(ex.model, ex.data, ex.settings).filter((i) => i.level === 'error'),
    ).toEqual([]);
    const spec = toSpec(ex.model);
    expect(spec.constructs.find((c) => c.name === 'Slope')!.componentLoadings).toEqual({
      t1: 0,
      t2: 1,
      t3: 2,
      t4: 3,
      t5: 4,
    });
    const cb = estimateCb(ex.data, spec, 'casewise', 'ML');
    expect(cb.fit.df).toBe(ref.lcm.df);
    expect(Math.abs(cb.fit.chisq - ref.lcm.chisq)).toBeLessThan(0.01);
    const want = (lhs: string, op: string, rhs: string) =>
      ref.lcm.estimates.find((e) => e.lhs === lhs && e.op === op && e.rhs === rhs)!.est;
    const got = (lhs: string, op: string, rhs: string) =>
      cb.estimates.find((e) => e.lhs === lhs && e.op === op && e.rhs === rhs)!.est;
    expect(got('Intercept', '~~', 'Intercept')).toBeCloseTo(
      want('Intercept', '~~', 'Intercept'),
      3,
    );
    expect(got('Slope', '~~', 'Slope')).toBeCloseTo(want('Slope', '~~', 'Slope'), 3);
    expect(
      Math.abs(got('Intercept', '~~', 'Slope') - want('Intercept', '~~', 'Slope')),
    ).toBeLessThan(0.001);
    expect(
      cb.estimates
        .filter((e) => e.kind === 'fixed-loading' && (e.lhs === 'Intercept' || e.lhs === 'Slope'))
        .map((e) => e.est),
    ).toEqual([1, 1, 1, 1, 1, 0, 1, 2, 3, 4]);
  });
  it('the ALT model: the first wave predetermined, waves predicting the next, on the R engine', () => {
    const ex = makeBollenCurranAltExample(DEFAULT_SETTINGS);
    expect(ex.settings.engine).toBe('r');
    expect(
      validateModel(ex.model, ex.data, ex.settings).filter((i) => i.level === 'error'),
    ).toEqual([]);
    expect(
      validateModel(ex.model, ex.data, { ...ex.settings, engine: 'builtin' }).some((i) =>
        /incoming paths with the built-in engine/.test(i.message),
      ),
    ).toBe(true);
    const name = new Map(ex.model.constructs.map((c) => [c.id, c.name]));
    expect(ex.model.paths.map((p) => `${name.get(p.from)}→${name.get(p.to)}`)).toEqual([
      't1→t2',
      't2→t3',
      't3→t4',
      't4→t5',
    ]);
    expect(toSpec(ex.model).constructs.find((c) => c.name === 'Slope')!.componentLoadings).toEqual({
      t2: 1,
      t3: 2,
      t4: 3,
      t5: 4,
    });
    expect(ref.alt.df).toBe(1);
  });
});
