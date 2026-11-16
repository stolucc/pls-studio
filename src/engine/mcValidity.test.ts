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
    expect(failsCutoff('htmt90', 0.88)).toBe(0);
    expect(failsCutoff('htmt90', 0.91)).toBe(1);
    expect(failsCutoff('htmtci', 1.02)).toBe(1);
    expect(failsCutoff('xl', -0.02)).toBe(1);
  });

  it('cross-loadings margin: own correlation less the largest with another construct, per indicator', () => {
    // A's indicators correlate λ with A and λ · .6 with B; the weakest (.6) sets the margin .6 − .36.
    expect(v.get('xl:A')).toBeCloseTo(0.6 - 0.6 * 0.6, 12);
    // (HTMT at .90 has the same value; its true inference value is the population HTMT)
    expect(v.get('htmt90:A:B')).toBe(v.get('htmt:A:B'));
    expect(v.get('htmtci:A:B')).toBe(v.get('htmt:A:B'));
  });

  it('HTMT inference: one factor split in two blocks is flagged, two distinct factors are not', async () => {
    const { generateData } = await import('./population');
    const { standardize } = await import('./stats');
    const { htmtUpper } = await import('./mcValidity');
    const two = (rho: number) =>
      buildPopulation({
        constructs: [
          { name: 'A', type: 'factor', indicators: ['a1', 'a2', 'a3'], loadings: [0.7, 0.7, 0.7] },
          { name: 'B', type: 'factor', indicators: ['b1', 'b2', 'b3'], loadings: [0.7, 0.7, 0.7] },
        ],
        paths: [],
        exoCor: [{ a: 'A', b: 'B', value: rho }],
      });
    const upper = (rho: number, seed: number) => {
      const cols = generateData(two(rho), 250, seed).cols.map((c) => standardize(c));
      return htmtUpper(cols, [0, 1, 2], [3, 4, 5], 200, seed + 1);
    };
    // φ = 1: the upper bound reaches 1 in about 95% of samples (Henseler et al. 2015, Table 3: 95.7%)
    const flagged = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].filter((s) => upper(1, s) >= 1).length;
    expect(flagged).toBeGreaterThanOrEqual(8);
    // φ = .5: never near 1
    for (const s of [1, 2, 3]) expect(upper(0.5, s)).toBeLessThan(0.85);
  });
});
