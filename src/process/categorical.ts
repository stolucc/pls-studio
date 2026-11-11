// A multicategorical X in conditional process analysis (PROCESS's mcx): the
// k groups become k - 1 codes, and every effect of X becomes k - 1 relative
// effects (Hayes & Preacher, 2014). Codes as PROCESS defines them.

import type { ProcessPlan } from './plan';
import type { Term } from './templates';

export type XCoding = 'indicator' | 'sequential' | 'helmert' | 'effect';

/** Value of code j (0-based) for group g (0-based) of k groups. */
export function codeValue(coding: XCoding, k: number, g: number, j: number): number {
  switch (coding) {
    case 'indicator':
      return g === j + 1 ? 1 : 0;
    case 'sequential':
      return g >= j + 1 ? 1 : 0;
    case 'effect':
      // (the first group is the reference, coded -1 on every code)
      if (g === 0) return -1;
      return g === j + 1 ? 1 : 0;
    case 'helmert':
      if (g < j) return 0;
      if (g === j) return -(k - 1 - j) / (k - j);
      return 1 / (k - j);
  }
}

export interface Dummies {
  x: string;
  coding: XCoding;
  /** Group values in ascending order (the first is the reference for indicator coding). */
  levels: number[];
  /** Names of the k - 1 codes: "X D1", "X D2", … */
  names: string[];
  /** codes[j][i]: code j for case i (NaN where X is missing). */
  codes: Float64Array[];
}

/** The k - 1 codes of a categorical column. */
export function dummies(x: string, col: Float64Array, coding: XCoding): Dummies {
  const levels = [...new Set([...col].filter((v) => !Number.isNaN(v)))].sort((a, b) => a - b);
  const k = levels.length;
  if (k < 2) throw new Error(`${x} has fewer than two groups.`);
  if (k > 10)
    throw new Error(`${x} has ${k} distinct values; a categorical X can have at most 10 groups.`);
  const index = new Map(levels.map((v, g) => [v, g]));
  const names = Array.from({ length: k - 1 }, (_, j) => `${x} D${j + 1}`);
  const codes = names.map((_, j) =>
    Float64Array.from(col, (v) => (Number.isNaN(v) ? NaN : codeValue(coding, k, index.get(v)!, j))),
  );
  return { x, coding, levels, names, codes };
}

/** The plan with X replaced by its codes: every term, path and test involving X once per code. */
export function expandPlan(
  plan: ProcessPlan,
  x: string,
  names: string[],
): ProcessPlan & { directs?: { x: string; moderators: string[] }[] } {
  const swap = (t: Term, d: string) => t.map((v) => (v === x ? d : v));
  const expand = (terms: Term[]) =>
    terms.flatMap((t) => (t.includes(x) ? names.map((d) => swap(t, d)) : [t]));
  return {
    ...plan,
    equations: plan.equations.map((e) => ({ ...e, terms: expand(e.terms) })),
    indirect: plan.indirect.flatMap((p) =>
      names.map((d) => ({ ...p, vars: [d, ...p.vars.slice(1)] })),
    ),
    direct: null,
    directs: plan.direct ? names.map((d) => ({ x: d, moderators: plan.direct!.moderators })) : [],
    jn: plan.jn.flatMap((j) => (j.from === x ? names.map((d) => ({ ...j, from: d })) : [j])),
    interactions: plan.interactions.map((i) => ({
      ...i,
      focal: i.focal === x ? names[0] : i.focal,
      terms: expand(i.terms),
    })),
  };
}
