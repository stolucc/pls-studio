// A hand-made PLS result with one higher-order construct, for the tests of the
// guided HOC check (reporting/hoc.test.ts) and its tab (results/hocTab.test.tsx):
// X → H → Y, H a HOC of the dimensions L1 and L2, of any type and approach.

import type { PlsResult } from '../engine/types';
import type { Construct, HocApproach, ModelState } from '../model/project';
import type { Measurement } from './hoc';

const block = (m: Measurement): Pick<Construct, 'type' | 'mode'> =>
  m === 'reflective' ? { type: 'factor', mode: 'A' } : { type: 'composite', mode: 'B' };

const k = (id: string, indicators: string[], extra: Partial<Construct> = {}): Construct => ({
  id,
  name: id,
  type: 'factor',
  mode: 'A',
  indicators,
  x: 0,
  y: 0,
  side: 'left',
  ...extra,
});

/** A deterministic stream of standard-normal-ish numbers (sum of uniforms). */
function noise(seed: number) {
  let s = seed;
  const u = () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
  return () => u() + u() + u() + u() - 2;
}

export interface HocFixture {
  lower: Measurement;
  higher: Measurement;
  approach: HocApproach;
  /** Add a single-item construct Z predicted by H alone (a possible global item). */
  global?: boolean;
}

/** X → H → Y with H a HOC of L1 and L2 (indices X 0, L1 1, L2 2, H 3, Y 4, Z 5). */
export function hocFixture(f: HocFixture): { model: ModelState; pls: PlsResult } {
  const items = (p: string) => [`${p}1`, `${p}2`, `${p}3`];
  const constructs = [
    k('X', items('x')),
    k('L1', items('a'), block(f.lower)),
    k('L2', items('b'), block(f.lower)),
    k('H', [], { ...block(f.higher), components: ['L1', 'L2'] }),
    k('Y', items('y')),
    ...(f.global ? [k('Z', ['z1'])] : []),
  ];
  const paths: [string, string][] = [
    ['X', 'H'],
    ['H', 'Y'],
    ...(f.global ? [['H', 'Z'] as [string, string]] : []),
  ];
  const model: ModelState = {
    constructs,
    paths: paths.map(([from, to], i) => ({ id: `p${i}`, from, to })),
    moderations: [],
  };
  const names = constructs.map((c) => c.name);
  const K = names.length;
  const indicators = constructs.flatMap((c, j) =>
    c.indicators.map((name) => ({ name, construct: j })),
  );
  const sq = <T>(fill: (i: number, j: number) => T) =>
    Array.from({ length: K }, (_, i) => Array.from({ length: K }, (_, j) => fill(i, j)));
  const at = (n: string) => names.indexOf(n);
  const has = sq(() => false);
  for (const [a, b] of paths) has[at(a)][at(b)] = true;
  if (f.approach === 'repeated') {
    has[at('L1')][at('H')] = true;
    has[at('L2')][at('H')] = true;
  }
  const B = sq((i, j) => (has[i][j] ? 0.4 : 0));
  // Scores: L1 and L2 share a common part (r ≈ .5), H is their sum.
  const n = 300;
  const z = noise(7);
  const common = Array.from({ length: n }, z);
  const col = (g: () => number) => Float64Array.from({ length: n }, g);
  const L1 = col(() => 0);
  const L2 = col(() => 0);
  for (let i = 0; i < n; i++) {
    L1[i] = common[i] + z();
    L2[i] = common[i] + z();
  }
  const H = Float64Array.from(L1, (v, i) => v + L2[i]);
  const scores = [col(z), L1, L2, H, col(z), ...(f.global ? [col(z)] : [])];
  const q = (rhoC: number, ave: number) => ({ alpha: rhoC - 0.02, rhoC, rhoA: rhoC + 0.01, ave });
  const quality = names.map((name) => {
    if (name === 'H') return f.approach === 'repeated' ? q(0.83, 0.27) : q(0.84, 0.72);
    return q(0.86, 0.62);
  });
  const htmt: (number | null)[][] = sq(() => null);
  const setH = (a: string, b: string, v: number) => {
    const [i, j] = [at(a), at(b)].sort((x, y) => y - x);
    htmt[i][j] = v;
  };
  setH('L1', 'X', 0.4);
  setH('L2', 'L1', 0.7);
  setH('H', 'L1', 1.1); // with its own dimension: no criterion
  setH('H', 'X', 0.5);
  setH('Y', 'H', 0.6);
  const pls: PlsResult = {
    n,
    iterations: 5,
    converged: true,
    constructs: names,
    indicators,
    weights: indicators.map(() => 0.4),
    loadings: indicators.map((x) => (x.name === 'a3' ? 0.65 : 0.8)),
    pathCoef: B,
    hasPath: has,
    totalEffects: sq(() => 0),
    indirectEffects: sq(() => 0),
    rSquared: names.map((name) => {
      if (name === 'H') return f.approach === 'repeated' ? 0.999 : 0.3;
      if (name === 'Y' || name === 'Z') return 0.2;
      return null;
    }),
    adjRSquared: names.map(() => null),
    constructCor: sq((i, j) => (i === j ? 1 : 0.4)),
    quality,
    htmt,
    htmt2: sq(() => null),
    fit: {
      estimated: { srmr: NaN, dULS: NaN, dG: NaN },
      saturated: { srmr: NaN, dULS: NaN, dG: NaN },
    },
    consistent: false,
    types: constructs.map((c) => c.type),
    moderations: [],
    hocApproach: f.approach,
    fSquare: sq(() => null),
    vifInner: sq(() => null),
    vifOuter: indicators.map(() => 1.6),
    scores,
    droppedRows: 0,
    higherOrder: [
      { construct: at('H'), component: at('L1'), loading: 0.9, weight: 0.6 },
      { construct: at('H'), component: at('L2'), loading: 0.85, weight: 0.5 },
    ],
  };
  return { model, pls };
}
