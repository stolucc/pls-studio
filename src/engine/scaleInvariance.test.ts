// CB-SEM results do not depend on the units the data are measured in: an
// indicator recorded in euros rather than thousands of euros (SD 2000 rather
// than 2) gives the same standardised estimates, z values and fit, with the
// unstandardised estimates and standard errors rescaled exactly. The
// information matrix scales as 1/variance², so this checks that the matrix
// inverse and the optimiser's convergence test are relative to the problem's
// own scale (Holzinger & Swineford 1939 data).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { estimateCb, type CbResult } from './cbsem';
import { parseCsv } from './dataset';
import { invert, matMul } from './linalg';
import type { Dataset, ModelSpec } from './types';

const data = parseCsv(
  readFileSync(
    join(__dirname, '__fixtures__', 'validation', 'data', 'holzinger_swineford.csv'),
    'utf8',
  ),
).dataset;

/** The data with the named columns multiplied by `factor`. */
function rescaled(names: string[], factor: number): Dataset {
  return {
    ...data,
    cols: data.cols.map((c, i) =>
      names.includes(data.names[i]) ? Float64Array.from(c, (v) => v * factor) : c,
    ),
  };
}

const single = (name: string) => ({ name, mode: 'A' as const, indicators: [name] });
const pathModel: ModelSpec = {
  constructs: [single('x1'), single('x4'), single('x7')],
  paths: [
    { from: 'x1', to: 'x4' },
    { from: 'x1', to: 'x7' },
    { from: 'x4', to: 'x7' },
  ],
};
const factor = (name: string, indicators: string[]) => ({
  name,
  type: 'factor' as const,
  mode: 'A' as const,
  indicators,
});
const cfa: ModelSpec = {
  constructs: [factor('visual', ['x1', 'x2', 'x3']), factor('textual', ['x4', 'x5', 'x6'])],
  paths: [{ from: 'visual', to: 'textual' }],
};

const regressions = (r: CbResult) => r.estimates.filter((e) => e.kind === 'regression');

describe('CB-SEM is invariant to the units of the data', () => {
  it('a path model with one variable at SD ≈ 1, 500, 2000 and 20000', () => {
    const base = estimateCb(data, pathModel);
    for (const s of [500, 2000, 20000]) {
      const r = estimateCb(rescaled(['x1'], s), pathModel);
      expect(r.converged).toBe(true);
      expect(r.warnings).toEqual(base.warnings);
      regressions(r).forEach((e, k) => {
        const b = regressions(base)[k];
        // A path out of x1 is per unit of x1, so it and its SE shrink by s.
        const unit = e.rhs === 'x1' ? 1 / s : 1;
        expect(e.std).toBeCloseTo(b.std, 8);
        expect(e.est / unit).toBeCloseTo(b.est, 8);
        expect(e.se).not.toBeNull();
        expect(e.se! / unit).toBeCloseTo(b.se!, 8);
      });
    }
  });

  it('a CFA with every indicator at SD × 1000 equals the unscaled one', () => {
    const items = ['x1', 'x2', 'x3', 'x4', 'x5', 'x6'];
    const base = estimateCb(data, cfa);
    for (const s of [1e-3, 1000, 1e5]) {
      const r = estimateCb(rescaled(items, s), cfa);
      expect(r.converged).toBe(true);
      expect(r.fit.chisq).toBeCloseTo(base.fit.chisq, 6);
      // Fisher scoring stops when F no longer improves in double precision,
      // which leaves the estimates accurate to about 1e-7 at any scale.
      r.estimates.forEach((e, k) => {
        expect(e.std).toBeCloseTo(base.estimates[k].std, 6);
        const z = base.estimates[k].z;
        if (z === null) expect(e.z).toBeNull();
        else expect(e.z).toBeCloseTo(z, 5);
      });
    }
  });
});

describe('invert', () => {
  it('inverts a regular matrix with tiny entries rather than calling it singular', () => {
    const m = [
      [4e-14, 1e-14],
      [1e-14, 3e-14],
    ];
    const product = matMul(m, invert(m));
    expect(product[0][0]).toBeCloseTo(1, 12);
    expect(product[0][1]).toBeCloseTo(0, 12);
    expect(product[1][1]).toBeCloseTo(1, 12);
  });

  it('still rejects a singular matrix, whatever its scale', () => {
    for (const s of [1e-14, 1, 1e14])
      expect(() =>
        invert([
          [1 * s, 2 * s],
          [2 * s, 4 * s],
        ]),
      ).toThrow(/singular/);
  });
});
