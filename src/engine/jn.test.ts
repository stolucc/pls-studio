import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { estimateCb } from './cbsem';
import { parseCsv } from './dataset';
import { johnsonNeyman, zCrit } from './jn';

const data = parseCsv(
  readFileSync(
    join(__dirname, '__fixtures__', 'validation', 'data', 'holzinger_swineford.csv'),
    'utf8',
  ),
).dataset;
const f = (name: string, indicators: string[]) => ({
  name,
  mode: 'A' as const,
  type: 'factor' as const,
  indicators,
});
const spec = {
  constructs: [
    f('visual', ['x1', 'x2', 'x3']),
    f('textual', ['x4', 'x5', 'x6']),
    f('speed', ['x7', 'x8', 'x9']),
  ],
  paths: [
    { from: 'visual', to: 'speed' },
    { from: 'textual', to: 'speed' },
  ],
  moderations: [{ from: 'visual', moderator: 'textual', to: 'speed' }],
};

describe('Johnson–Neyman', () => {
  const cb = estimateCb(data, spec);
  const jn = johnsonNeyman(cb, cb.moderations[0]);

  it('uses the two-sided normal critical value', () => {
    expect(zCrit(0.05)).toBeCloseTo(1.959964, 5);
    expect(zCrit(0.01)).toBeCloseTo(2.575829, 5);
  });

  it('boundaries are exactly where |θ(m)| / SE(m) equals the critical value', () => {
    expect(jn.boundaries.length).toBeGreaterThan(0);
    for (const b of jn.boundaries)
      expect(Math.abs(jn.effect(b)) / jn.se(b)).toBeCloseTo(jn.crit, 8);
  });

  it('classifies significance consistently around a boundary', () => {
    const b = jn.boundaries[0];
    expect(jn.significantAt(b - 0.01)).not.toBe(jn.significantAt(b + 0.01));
    expect(jn.significantAt(0)).toBe(Math.abs(jn.bx) / jn.se(0) >= jn.crit);
  });

  it('reports the moderator standard deviation from its latent variance', () => {
    const v = cb.estimates.find(
      (e) => e.op === '~~' && e.lhs === 'textual' && e.rhs === 'textual',
    )!;
    expect(jn.sdM).toBeCloseTo(Math.sqrt(v.est), 12);
  });

  it('rejects interactions whose predictor is endogenous', () => {
    const bad = { ...spec, paths: [...spec.paths, { from: 'textual', to: 'visual' }] };
    expect(() => estimateCb(data, bad)).toThrow(/exogenous/);
  });
});
