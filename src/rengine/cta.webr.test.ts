// CTA-PLS in webR (our implementation of Gudergan et al. 2008; no R package
// implements it): a simulated reflective block shows no significant tetrads,
// a block without a common factor does; the non-redundant sets have
// p(p-3)/2 tetrads; results are reproducible. Run with npm run test:webr.

import { afterAll, beforeAll, expect, it } from 'vitest';
import type { ModelSpec } from '../engine/types';
import { ctaR, ctaScriptR } from './plsx';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

// Deterministic simulated data (Box-Muller from a simple LCG).
function normals(n: number, seed: number) {
  let s = seed;
  const u = () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return (s + 1) / 2147483649;
  };
  return Array.from(
    { length: n },
    () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u()),
  );
}
const n = 500;
const f = normals(n, 1),
  e = Array.from({ length: 10 }, (_, k) => normals(n, 100 + k));
const lam = [0.8, 0.7, 0.75, 0.6, 0.65];
const refl = lam.map((l, k) => f.map((v, i) => l * v + Math.sqrt(1 - l * l) * e[k][i]));
const a = e[5],
  b = e[6];
const form = [
  a,
  b,
  a.map((v, i) => v + b[i] + 0.3 * e[7][i]),
  a.map((v, i) => v - b[i] + 0.3 * e[8][i]),
  a.map((v, i) => v + e[9][i]),
];
const data = {
  names: [...lam.map((_, k) => `r${k + 1}`), ...form.map((_, k) => `f${k + 1}`)],
  cols: [...refl, ...form].map((c) => Float64Array.from(c)),
};
const spec: ModelSpec = {
  constructs: [
    { name: 'R', type: 'factor', mode: 'A', indicators: ['r1', 'r2', 'r3', 'r4', 'r5'] },
    { name: 'F', type: 'factor', mode: 'A', indicators: ['f1', 'f2', 'f3', 'f4', 'f5'] },
  ],
  paths: [{ from: 'R', to: 'F' }],
};

it('tells a reflective block from one without a common factor', async () => {
  const r = await ctaR(data, spec, 'casewise', { samples: 500, seed: 1, alpha: 0.05 });
  const R = r.blocks.find((x) => x.construct === 'R')!,
    F = r.blocks.find((x) => x.construct === 'F')!;
  expect(R.tetrads).toHaveLength(5); // p(p - 3) / 2 with p = 5
  expect(R.tetrads.filter((t) => t.differs)).toHaveLength(0);
  expect(F.tetrads.filter((t) => t.differs).length).toBeGreaterThan(0);
  const again = await ctaR(data, spec, 'casewise', { samples: 500, seed: 1, alpha: 0.05 });
  expect(again.blocks[0].tetrads.map((t) => t.low)).toEqual(R.tetrads.map((t) => t.low));
  expect(
    await ctaScriptR(data, spec, 'casewise', { samples: 500, seed: 1, alpha: 0.05 }),
  ).toContain('cta_nonredundant <- function(p)');
}, 900_000);
