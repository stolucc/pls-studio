// Nonlinear paths against lm() on seminr's construct scores (scripts/validation/nonlinear_paths.R), and Kock's
// causality assessment indices on hand-computed cases.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { causalityIndices, nonlinearPaths, pathCurve, type PathShape } from './nonlinear';

const ref = JSON.parse(
  readFileSync(join(__dirname, '__fixtures__', 'nonlinear', 'reference.json'), 'utf8'),
);
const constructs = ['Image', 'Expectation', 'Value', 'Satisfaction', 'Loyalty'];
const scores = constructs.map((c) => Float64Array.from(ref.scores[c] as number[]));
const has = constructs.map(() => constructs.map(() => false));
for (const [f, t] of [
  ['Image', 'Satisfaction'],
  ['Expectation', 'Satisfaction'],
  ['Value', 'Satisfaction'],
  ['Satisfaction', 'Loyalty'],
  ['Image', 'Loyalty'],
])
  has[constructs.indexOf(f)][constructs.indexOf(t)] = true;
const shapes: Record<string, PathShape> = {
  'Image→Satisfaction': 'quadratic',
  'Value→Satisfaction': 'cubic',
  'Satisfaction→Loyalty': 'quadratic',
};
const shape = (f: string, t: string) => shapes[`${f}→${t}`] ?? 'linear';
// lm's term label of a predictor and power
const label = (from: string, power: number) => (power === 1 ? from : `I(${from}^${power})`);

describe('nonlinear (polynomial) paths', () => {
  const eqs = nonlinearPaths(scores, constructs, has, shape);
  it('equal lm() on the same scores: coefficients, standard errors, p values, R²', () => {
    expect(eqs.map((e) => e.to)).toEqual(['Satisfaction', 'Loyalty']);
    for (const r of ref.equations) {
      const e = eqs.find((x) => x.to === r.to)!;
      expect(e.terms).toHaveLength(r.terms.length - 1);
      expect(e.intercept).toBeCloseTo(r.b[0], 10);
      for (const t of e.terms) {
        const k = (r.terms as string[]).indexOf(label(t.from, t.power));
        expect(k, label(t.from, t.power)).toBeGreaterThan(0);
        expect(t.b).toBeCloseTo(r.b[k], 10);
        expect(t.se).toBeCloseTo(r.se[k], 10);
        expect(t.p).toBeCloseTo(r.p[k], 6);
      }
      expect(e.r2).toBeCloseTo(r.r2, 10);
      expect(e.r2Linear).toBeCloseTo(r.r2Linear, 10);
    }
  });
  it('draws the curve of one predictor with the others at 0', () => {
    const e = eqs[0];
    const b = (f: string, p: number) => e.terms.find((t) => t.from === f && t.power === p)!.b;
    const pts = pathCurve(e, 'Value', -2, 2, 4);
    expect(pts.map((p) => p[0])).toEqual([-2, -1, 0, 1, 2]);
    expect(pts[4][1]).toBeCloseTo(
      e.intercept + 2 * b('Value', 1) + 4 * b('Value', 2) + 8 * b('Value', 3),
      12,
    );
  });
});

describe('causality assessment indices (Kock)', () => {
  it('count Simpson’s paradox, suppression and negative R² contributions (hand-computed)', () => {
    // Three paths into Y: β = 0.5, −0.2, 0.3 with correlations r = 0.4, 0.1, 0.2.
    const C = ['A', 'B', 'D', 'Y'];
    const h = C.map((_, i) => C.map((_, j) => j === 3 && i < 3));
    const B = C.map((_, i) => C.map((_, j) => (j === 3 ? [0.5, -0.2, 0.3, 0][i] : 0)));
    const R = C.map((_, i) => C.map((_, j) => (j === 3 ? [0.4, 0.1, 0.2, 1][i] : i === j ? 1 : 0)));
    const k = causalityIndices(C, h, B, R);
    // B → Y: −0.2 vs 0.1, opposite signs (Simpson's paradox); |β/r| = 0.5/0.4 = 1.25 ≤ 1.3, 0.2/0.1 = 2 > 1.3, 0.3/0.2 = 1.5 > 1.3.
    expect(k.paths.map((p) => p.simpson)).toEqual([false, true, false]);
    expect(k.paths.map((p) => p.suppression)).toEqual([false, true, true]);
    expect(k.spr).toBeCloseTo(2 / 3, 12);
    expect(k.ssr).toBeCloseTo(1 / 3, 12);
    // contributions 0.2, −0.02, 0.06: RSCR = 0.26 / 0.28
    expect(k.paths.map((p) => p.contribution)).toEqual([0.2, -0.2 * 0.1, 0.3 * 0.2]);
    expect(k.rscr).toBeCloseTo(0.26 / 0.28, 12);
  });
  it('are 1 for a single positive path', () => {
    const k = causalityIndices(
      ['X', 'Y'],
      [
        [false, true],
        [false, false],
      ],
      [
        [0, 0.6],
        [0, 0],
      ],
      [
        [1, 0.6],
        [0.6, 1],
      ],
    );
    expect([k.spr, k.rscr, k.ssr]).toEqual([1, 1, 1]);
  });
});
