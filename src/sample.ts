// Synthetic example: a customer-experience survey with a known population
// model, 7-point Likert items and a sprinkling of missing answers.

import { mulberry32 } from './engine/stats';
import type { Dataset } from './engine/types';
import { newId, type DataInfo, type ModelState, type Side } from './model/project';

const BLOCKS: { name: string; prefix: string; loadings: number[]; mode?: 'B' }[] = [
  { name: 'Service Quality', prefix: 'SQ', loadings: [0.82, 0.78, 0.85, 0.74] },
  { name: 'Price Fairness', prefix: 'PF', loadings: [0.8, 0.86, 0.7] },
  { name: 'Trust', prefix: 'TR', loadings: [0.84, 0.81, 0.77] },
  { name: 'Satisfaction', prefix: 'SAT', loadings: [0.88, 0.83, 0.86] },
  { name: 'Loyalty', prefix: 'LOY', loadings: [0.85, 0.8, 0.72] },
];

const EXAMPLE_LAYOUT: { x: number; y: number; side: Side }[] = [
  { x: 0, y: -110, side: 'left' },
  { x: 0, y: 230, side: 'left' },
  { x: 400, y: -270, side: 'top' },
  { x: 560, y: 110, side: 'bottom' },
  { x: 940, y: -40, side: 'right' },
];

/** Population paths [from, to, beta] over BLOCKS indices. */
const PATHS: [number, number, number][] = [
  [0, 2, 0.5], [0, 3, 0.4], [1, 3, 0.25], [2, 3, 0.2], [3, 4, 0.55], [2, 4, 0.2],
];

export function makeSample(n = 300, seed = 2026): { data: Dataset; info: DataInfo; model: ModelState } {
  const rand = mulberry32(seed);
  const normal = () => {
    const u = 1 - rand(), v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const eta = BLOCKS.map(() => new Float64Array(n));
  // Constructs are listed in causal order, so one pass generates them.
  for (let j = 0; j < BLOCKS.length; j++) {
    const incoming = PATHS.filter(([, t]) => t === j);
    for (let r = 0; r < n; r++) {
      let v = 0;
      for (const [f, , b] of incoming) v += b * eta[f][r];
      eta[j][r] = v + normal() * (incoming.length ? 0.75 : 1);
    }
  }
  const names: string[] = [];
  const cols: Float64Array[] = [];
  let missing = 0;
  BLOCKS.forEach((b, j) => {
    b.loadings.forEach((l, k) => {
      names.push(`${b.prefix}${k + 1}`);
      cols.push(Float64Array.from({ length: n }, (_, r) => {
        if (rand() < 0.004) { missing++; return NaN; }
        const x = l * eta[j][r] + Math.sqrt(1 - l * l) * normal();
        return Math.min(7, Math.max(1, Math.round(4.6 + 1.25 * x)));
      }));
    });
  });

  const constructs = BLOCKS.map((b) => ({
    id: newId('c'),
    name: b.name,
    type: b.mode === 'B' ? ('composite' as const) : ('factor' as const),
    mode: b.mode ?? ('A' as const),
    indicators: b.loadings.map((_, k) => `${b.prefix}${k + 1}`),
    x: 0, y: 0, side: 'left' as const,
  }));
  const paths = PATHS.map(([f, t]) => ({ id: newId('p'), from: constructs[f].id, to: constructs[t].id }));
  const model = { constructs, paths, moderations: [] };
  return {
    data: { names, cols },
    info: { fileName: 'example-customer-survey.csv', rows: n, missingCells: missing, excluded: [] },
    model: { ...model, constructs: model.constructs.map((c, i) => ({ ...c, ...EXAMPLE_LAYOUT[i] })) },
  };
}
