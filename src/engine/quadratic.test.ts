// Quadratic effects (X² → Y): the predictor moderating its own path. Data with
// a known curvilinear effect; both engines must find it and the Johnson–Neyman
// slope must be γ_X + 2γ_q·x.

import { describe, expect, it } from 'vitest';
import { estimateCb } from './cbsem';
import { johnsonNeyman } from './jn';
import { estimatePls } from './pls';
import { interactionName } from './types';
import { simulateQuadratic as simulate } from './__fixtures__/quadratic';

const f = (name: string, indicators: string[]) => ({
  name,
  mode: 'A' as const,
  type: 'factor' as const,
  indicators,
});
const spec = {
  constructs: [f('X', ['x1', 'x2', 'x3']), f('Y', ['y1', 'y2', 'y3'])],
  paths: [{ from: 'X', to: 'Y' }],
  moderations: [{ from: 'X', moderator: 'X', to: 'Y' }],
};
const data = simulate(3000, 7);

describe('quadratic effects', () => {
  it('names the term X²', () => {
    expect(interactionName('X', 'X')).toBe('X²');
    expect(interactionName('X', 'M')).toBe('X × M');
  });

  it('CB-SEM (squared centred indicators) recovers the curvature', () => {
    const cb = estimateCb(data, spec);
    expect(cb.constructs).toContain('X²');
    const q = cb.estimates.find((e) => e.op === '~' && e.lhs === 'Y' && e.rhs === 'X²')!;
    const lin = cb.estimates.find((e) => e.op === '~' && e.lhs === 'Y' && e.rhs === 'X')!;
    // In marker units (loadings 0.8): Y = 0.4·X + 0.375·X².
    expect(lin.est).toBeCloseTo(0.4, 1);
    expect(q.est).toBeGreaterThan(0.25);
    expect(q.est).toBeLessThan(0.5);
    expect(q.p!).toBeLessThan(0.001);
    // Without the quadratic term there is nothing of the sort.
    const linear = estimateCb(data, { ...spec, moderations: [] });
    expect(linear.constructs).not.toContain('X²');
  });

  it('Johnson–Neyman uses the slope γ_X + 2γ_q·x', () => {
    const cb = estimateCb(data, spec);
    const jn = johnsonNeyman(cb, cb.moderations[0]);
    expect(jn.quadratic).toBe(true);
    for (const x of [-1.5, 0, 0.7]) expect(jn.effect(x)).toBeCloseTo(jn.bx + 2 * jn.bint * x, 12);
    // The slope turns negative at low X: a lower region of significance with the opposite sign.
    expect(jn.boundaries.length).toBe(2);
    for (const b of jn.boundaries)
      expect(Math.abs(jn.effect(b)) / jn.se(b)).toBeCloseTo(jn.crit, 8);
    expect(jn.effect(-3 * jn.sdM)).toBeLessThan(0);
    expect(jn.significantAt(-3 * jn.sdM)).toBe(true);
    expect(jn.significantAt(3 * jn.sdM)).toBe(true);
  });

  it('PLS (two-stage, squared standardised scores) recovers the curvature', () => {
    const pls = estimatePls(data, spec);
    const k = pls.constructs.indexOf('X²'),
      y = pls.constructs.indexOf('Y'),
      x = pls.constructs.indexOf('X');
    expect(k).toBeGreaterThan(0);
    expect(pls.pathCoef[x][y]).toBeGreaterThan(0.25);
    expect(pls.pathCoef[k][y]).toBeGreaterThan(0.12);
    expect(pls.moderations).toEqual([
      expect.objectContaining({ from: 'X', moderator: 'X', to: 'Y', construct: k }),
    ]);
  });
});

describe('quadratic curve helpers', () => {
  it('value, slope and turning point of ŷ = β·x + β_q·x²', async () => {
    const { quadraticSlope, quadraticValue, turningPoint } = await import('./quadratic');
    expect(quadraticValue(0.4, 0.3, 2)).toBeCloseTo(2, 12);
    expect(quadraticSlope(0.4, 0.3, -1)).toBeCloseTo(-0.2, 12);
    expect(turningPoint(0.4, 0.3)).toBeCloseTo(-2 / 3, 12);
    expect(quadraticSlope(0.4, 0.3, turningPoint(0.4, 0.3)!)).toBeCloseTo(0, 12);
    expect(turningPoint(0.4, 0)).toBeNull();
  });
});
