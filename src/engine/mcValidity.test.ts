import { describe, expect, it } from 'vitest';
import { failsCutoff, validityValues } from './mcValidity';
import { buildPopulation, populationValidityInputs } from './population';

describe('PLS measurement checks in a simulation', () => {
  const population = buildPopulation({
    constructs: [
      { name: 'A', type: 'factor', indicators: ['a1', 'a2', 'a3'], loadings: [0.8, 0.7, 0.6] },
      { name: 'B', type: 'factor', indicators: ['b1', 'b2', 'b3'], loadings: [0.7, 0.7, 0.7] },
      { name: 'S', type: 'factor', indicators: ['s1'], loadings: [0.9] },
    ],
    paths: [
      { from: 'A', to: 'B', value: 0.6 },
      { from: 'B', to: 'S', value: 0.3 },
    ],
    exoCor: [],
  });
  const v = validityValues(populationValidityInputs(population));

  it('computes ρc, AVE, the Fornell–Larcker margin, HTMT and GoF of the population', () => {
    const l = [0.8, 0.7, 0.6];
    const sum = l.reduce((s, x) => s + x, 0);
    expect(v.get('cr:A')).toBeCloseTo((sum * sum) / (sum * sum + (3 - 1.49)), 12);
    expect(v.get('ave:A')).toBeCloseTo(1.49 / 3, 12);
    expect(v.get('fl:A')).toBeCloseTo(Math.sqrt(1.49 / 3) - 0.6, 12);
    // HTMT of common factors is their correlation when each block's loadings are equal (tau-equivalence).
    // Here only B's are: mean |λ_a λ_b| ρ / √(mean λ_a λ_a' · 0.49).
    const hetero = (sum / 3) * 0.7 * 0.6;
    const monoA = (0.8 * 0.7 + 0.8 * 0.6 + 0.7 * 0.6) / 3;
    expect(v.get('htmt:A:B')).toBeCloseTo(hetero / Math.sqrt(monoA * 0.49), 12);
    // (single-indicator constructs are not checked; GoF averages the checked AVEs and every R²)
    expect(v.has('cr:S')).toBe(false);
    const r2 = (0.36 + 0.09) / 2;
    expect(v.get('gof')).toBeCloseTo(Math.sqrt(((1.49 / 3 + 0.49) / 2) * r2), 12);
  });

  it('fails a check below (or for HTMT above) its cutoff', () => {
    expect(failsCutoff('ave', 0.49)).toBe(1);
    expect(failsCutoff('ave', 0.5)).toBe(0);
    expect(failsCutoff('fl', -0.01)).toBe(1);
    expect(failsCutoff('htmt', 0.9)).toBe(1);
    expect(failsCutoff('htmt', 0.8)).toBe(0);
    expect(failsCutoff('cr', NaN)).toBeNaN();
  });
});
