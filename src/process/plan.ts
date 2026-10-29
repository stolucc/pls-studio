// What a conditional process analysis estimates for a model graph: the
// equations, every indirect path from X to Y with the moderators acting on it,
// which index of moderated mediation applies to each path, and the edges
// Johnson–Neyman probing is defined for. The R bridge (src/rengine/R/cpa.R)
// only runs this plan.

import { equations, type Edge, type ProcessGraph, type Term } from './templates';

export type IndexSpec =
  /** One moderator, entering the indirect effect linearly (index of moderated mediation). */
  | { kind: 'mm'; w: string }
  /** W and Z additively on the same path (indices of partial moderated mediation). */
  | { kind: 'partial'; w: string; z: string }
  /** W × Z in the indirect effect (index of moderated moderated mediation, and conditional indices by W at values of Z). */
  | { kind: 'mmm'; w: string; z: string };

export interface IndirectSpec { vars: string[]; moderators: string[]; index: IndexSpec | null }

export interface ProcessPlan {
  equations: { outcome: string; terms: Term[] }[];
  /** Moderators to probe (X too, where it moderates its own M → Y paths: model 74). */
  moderators: string[];
  direct: { moderators: string[] } | null;
  indirect: IndirectSpec[];
  jn: { from: string; to: string; moderator: string }[];
}

const same = (a: Edge, b: Edge) => a[0] === b[0] && a[1] === b[1];

/** Every directed path from X to Y through at least one mediator, in a stable order (shorter first). */
export function indirectPaths(g: ProcessGraph): string[][] {
  const out: string[][] = [];
  const walk = (at: string, seen: string[]) => {
    for (const [from, to] of g.paths) {
      if (from !== at || seen.includes(to)) continue;
      if (to === g.y) { if (seen.length > 1) out.push([...seen, to]); continue; }
      if (g.mediators.includes(to)) walk(to, [...seen, to]);
    }
  };
  walk(g.x, [g.x]);
  return out.sort((a, b) => a.length - b.length);
}

/** The moderators of one edge: two-way moderators, and both moderators of a three-way term. */
function edgeModerators(g: ProcessGraph, e: Edge) {
  const by = new Set<string>();
  for (const m of g.moderations) if (same(m.path, e)) by.add(m.by);
  const threeWay = g.threeWay.filter((m) => same(m.path, e));
  for (const m of threeWay) m.by.forEach((v) => by.add(v));
  return { by, threeWay: threeWay.length > 0 };
}

/**
 * The index for a path, if the indirect effect is linear in each of its
 * moderators (each moderates one edge of the path). `order` decides which of
 * two moderators is W (PROCESS's roles, when known).
 */
export function indexFor(g: ProcessGraph, path: string[], order: string[] = []): IndexSpec | null {
  const edges: Edge[] = path.slice(1).map((v, i) => [path[i], v]);
  const per = edges.map((e) => edgeModerators(g, e));
  const degree = new Map<string, number>();
  for (const p of per) for (const m of p.by) degree.set(m, (degree.get(m) ?? 0) + 1);
  const mods = [...degree.keys()].sort((a, b) => rank(order, a) - rank(order, b));
  // X moderating its own M → Y path (model 74) has no index: PROCESS reports counterfactual effects instead.
  if (mods.some((m) => path.includes(m))) return null;
  if (!mods.length || mods.length > 2 || [...degree.values()].some((d) => d > 1)) return null;
  if (mods.length === 1) return { kind: 'mm', w: mods[0] };
  const [w, z] = mods;
  const together = per.find((p) => p.by.has(w) && p.by.has(z));
  return { kind: together && !together.threeWay ? 'partial' : 'mmm', w, z };
}

const rank = (order: string[], v: string) => { const i = order.indexOf(v); return i < 0 ? order.length : i; };

export function planFor(g: ProcessGraph, covariates: string[] = [], order: string[] = []): ProcessPlan {
  const allMods = [...new Set([...g.moderations.map((m) => m.by), ...g.threeWay.flatMap((m) => m.by)])];
  const sortMods = (ms: Iterable<string>) => [...ms].sort((a, b) => rank(order, a) - rank(order, b) || allMods.indexOf(a) - allMods.indexOf(b));
  const xy: Edge = [g.x, g.y];
  const hasDirect = g.paths.some((e) => same(e, xy));
  const indirect = indirectPaths(g).map((vars) => {
    const by = new Set<string>();
    vars.slice(1).forEach((v, i) => edgeModerators(g, [vars[i], v]).by.forEach((m) => by.add(m)));
    return { vars, moderators: sortMods(by), index: indexFor(g, vars, order) };
  });
  const jn = g.paths.flatMap(([from, to]) => {
    const { by, threeWay } = edgeModerators(g, [from, to]);
    return by.size === 1 && !threeWay && !by.has(from) ? [{ from, to, moderator: [...by][0] }] : [];
  });
  return {
    equations: [...equations(g, covariates)].map(([outcome, terms]) => ({ outcome, terms })),
    moderators: sortMods(allMods),
    direct: hasDirect ? { moderators: sortMods(edgeModerators(g, xy).by) } : null,
    indirect,
    jn,
  };
}
