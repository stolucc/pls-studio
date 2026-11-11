// Equivalent structural models: alternatives with the same implied covariance matrix for any data, hence the same
// χ² and df (Stelzl 1986; Lee & Hershberger 1990; MacCallum, Wegener, Uchino & Fabrigar 1993; Hershberger 2006;
// Kline 2016, ch. 11). Two replacing rules of Lee & Hershberger, applied to the structural model among the
// constructs, and repeated on what they give until no new structure appears:
//
//  Rule 1 (a just-identified preceding block; Kline's Rule 11.1): within a block of variables that receives no
//  arrow from outside it (its members' predictors and covariance partners all lie inside it) and is saturated (every
//  pair joined by exactly one path or covariance), any path or covariance may be replaced by another: X → Y,
//  Y → X or X ↔ Y. Every saturated recursive block reproduces its covariances exactly, and the variables after it
//  depend on it only through those covariances.
//
//  Rule 2 (the replacing rule elsewhere; Kline's Rule 11.2): where X and Y have the same predictors (besides each
//  other) and are joined by one unidirectional relation, X → Y, Y → X and ζX ↔ ζY (a covariance of their
//  disturbances, or of the variables when both are exogenous) are interchangeable. The rule is applied only when
//  neither X nor Y has a covariance with a third variable (Lee & Hershberger's setting).
//
// A replacement must leave a model the diagram can draw: no cycles, covariances only between two exogenous
// constructs or two disturbances (exogenous constructs are uncorrelated with disturbances). Equality-constrained
// reciprocal effects (the rules' fourth alternative) are not generated. Constructs that are observed covariates,
// higher-order constructs and their components, ESEM factors and moderation terms keep their relations, as do
// fixed or labelled arrows; measurement models are left as they are. The card confirms each alternative by fitting it.

import type { Correlation, ModelState, Path } from './project';

/** A structure among constructs (by id): directed paths and covariances (pairs a < b); `locked`: pairs that keep their relation. */
/** `hidden`: higher-order loadings [construct, component], arrows that are not paths but explain the component. */
export interface Structure {
  paths: [string, string][];
  covs: [string, string][];
  locked: Set<string>;
  lockedNodes: Set<string>;
  hidden: [string, string][];
}
/** How an alternative differs from the model: one entry per pair whose relation changed. */
export interface Change {
  a: string;
  b: string;
  from: Relation;
  to: Relation;
}
export type Relation = 'a→b' | 'b→a' | 'a↔b';
export interface EquivalentModel {
  structure: Structure;
  changes: Change[];
  rules: (1 | 2)[];
}

export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const sortPair = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a]);

/** The structural model of the diagram, with what may not change. */
export function structureOf(model: ModelState): Structure {
  const lockedNodes = new Set<string>();
  for (const c of model.constructs) {
    if (c.covariate || c.components?.length) {
      lockedNodes.add(c.id);
      for (const k of c.components ?? []) lockedNodes.add(k);
    }
  }
  for (const b of model.esem?.blocks ?? []) for (const id of b.constructs) lockedNodes.add(id);
  for (const mo of model.moderations) {
    const p = model.paths.find((q) => q.id === mo.path);
    lockedNodes.add(mo.moderator);
    if (p) {
      lockedNodes.add(p.from);
      lockedNodes.add(p.to);
    }
  }
  const ids = new Set(model.constructs.map((c) => c.id));
  const paths = model.paths
    .filter((p) => ids.has(p.from) && ids.has(p.to))
    .map((p): [string, string] => [p.from, p.to]);
  const corrs = (model.correlations ?? []).filter(
    (k) => k.kind === 'construct' && !k.zero && ids.has(k.a) && ids.has(k.b),
  );
  const covs = corrs.map((k) => sortPair(k.a, k.b));
  const locked = new Set<string>([
    ...model.paths
      .filter((p) => p.fixed !== undefined || p.label)
      .map((p) => pairKey(p.from, p.to)),
    ...corrs
      .filter((k) => k.fixed !== undefined || k.label || k.byGroup?.length)
      .map((k) => pairKey(k.a, k.b)),
  ]);
  // (components of a higher-order construct are explained by it: endogenous though no path points at them)
  const hidden = model.constructs.flatMap((c) =>
    (c.components ?? []).map((k): [string, string] => [c.id, k]),
  );
  return { paths, covs, locked, lockedNodes, hidden };
}

const keyOf = (s: Structure) =>
  `${s.paths
    .map(([a, b]) => `${a}>${b}`)
    .sort()
    .join(',')};${s.covs
    .map(([a, b]) => `${a}~${b}`)
    .sort()
    .join(',')}`;
const parentsOf = (s: Structure, x: string) =>
  new Set([...s.paths, ...s.hidden].filter(([, t]) => t === x).map(([f]) => f));
/** The variables x covaries with. */
const partnersOf = (s: Structure, x: string) =>
  s.covs.flatMap(([a, b]) => {
    if (a === x) return [b];
    if (b === x) return [a];
    return [];
  });
const endogenous = (s: Structure, x: string) => [...s.paths, ...s.hidden].some(([, t]) => t === x);
const sameSet = (a: Set<string>, b: Set<string>) =>
  a.size === b.size && [...a].every((x) => b.has(x));

/** The relation of a pair, as seen from (a, b). */
function relationOf(s: Structure, a: string, b: string): Relation | null {
  if (s.paths.some(([f, t]) => f === a && t === b)) return 'a→b';
  if (s.paths.some(([f, t]) => f === b && t === a)) return 'b→a';
  return s.covs.some(([x, y]) => (x === a && y === b) || (x === b && y === a)) ? 'a↔b' : null;
}
/** How many relations join a pair (a bow, a path and a covariance, counts two). */
const relations = (s: Structure, a: string, b: string) =>
  s.paths.filter(([f, t]) => (f === a && t === b) || (f === b && t === a)).length +
  s.covs.filter(([x, y]) => pairKey(x, y) === pairKey(a, b)).length;

/** The structure with pair (a, b)'s relation replaced by `to`. */
function replace(s: Structure, a: string, b: string, to: Relation): Structure {
  const k = pairKey(a, b);
  const paths = s.paths.filter(([f, t]) => pairKey(f, t) !== k);
  const covs = s.covs.filter(([x, y]) => pairKey(x, y) !== k);
  if (to === 'a→b') paths.push([a, b]);
  else if (to === 'b→a') paths.push([b, a]);
  else covs.push(sortPair(a, b));
  return { ...s, paths, covs };
}

/** No directed cycle. */
export function acyclic(s: Structure): boolean {
  const arrows = [...s.paths, ...s.hidden];
  const nodes = [...new Set(arrows.flat())];
  const indeg = new Map(nodes.map((n) => [n, 0]));
  for (const [, t] of arrows) indeg.set(t, indeg.get(t)! + 1);
  const queue = nodes.filter((n) => indeg.get(n) === 0);
  let seen = 0;
  while (queue.length) {
    const n = queue.pop()!;
    seen++;
    for (const [f, t] of arrows)
      if (f === n) {
        indeg.set(t, indeg.get(t)! - 1);
        if (indeg.get(t) === 0) queue.push(t);
      }
  }
  return seen === nodes.length;
}

/** Drawable: acyclic, and every covariance between two exogenous constructs or two disturbances. */
export function drawable(s: Structure): boolean {
  return acyclic(s) && s.covs.every(([a, b]) => endogenous(s, a) === endogenous(s, b));
}

/** The smallest set holding a and b that receives no arrow from outside: closed under predictors and covariance partners. */
function closure(s: Structure, a: string, b: string): Set<string> {
  const out = new Set([a, b]);
  const todo = [a, b];
  while (todo.length) {
    const x = todo.pop()!;
    for (const y of [...parentsOf(s, x), ...partnersOf(s, x)])
      if (!out.has(y)) {
        out.add(y);
        todo.push(y);
      }
  }
  return out;
}

const ALL: Relation[] = ['a→b', 'b→a', 'a↔b'];

/** Rule 1 enumerates every configuration of a saturated block's free pairs when there are at most this many (3^8). */
const MAX_BLOCK_PAIRS = 8;

/**
 * The structures one replacement away, each with the rule that allows it. Rule 1 gives every configuration of the
 * saturated block at once (some can only be reached through configurations the diagram cannot draw, e.g. three
 * exogenous variables correlated in pairs), or single replacements in a block of more than MAX_BLOCK_PAIRS free pairs.
 */
function moves(s: Structure): { next: Structure; rule: 1 | 2 }[] {
  const out: { next: Structure; rule: 1 | 2 }[] = [];
  const pairs = new Map<string, [string, string]>();
  for (const [f, t] of s.paths) pairs.set(pairKey(f, t), sortPair(f, t));
  for (const [x, y] of s.covs) pairs.set(pairKey(x, y), [x, y]);
  const free = (a: string, b: string) =>
    !s.locked.has(pairKey(a, b)) && !s.lockedNodes.has(a) && !s.lockedNodes.has(b);
  const blocksDone = new Set<string>();
  for (const [a, b] of pairs.values()) {
    if (!free(a, b) || relations(s, a, b) !== 1) continue;
    const cur = relationOf(s, a, b)!;
    // Rule 1: a saturated block that receives nothing from outside
    const block = [...closure(s, a, b)].sort();
    const saturated = block.every((x, i) =>
      block.slice(i + 1).every((y) => relations(s, x, y) === 1),
    );
    if (saturated) {
      const inBlock = block.flatMap((x, i) =>
        block
          .slice(i + 1)
          .filter((y) => free(x, y))
          .map((y): [string, string] => [x, y]),
      );
      if (inBlock.length <= MAX_BLOCK_PAIRS) {
        if (blocksDone.has(block.join('|'))) continue;
        blocksDone.add(block.join('|'));
        for (let code = 0; code < 3 ** inBlock.length; code++) {
          let next = s;
          inBlock.forEach(([x, y], i) => {
            next = replace(next, x, y, ALL[Math.floor(code / 3 ** i) % 3]);
          });
          out.push({ next, rule: 1 });
        }
      } else
        for (const to of ALL) if (to !== cur) out.push({ next: replace(s, a, b, to), rule: 1 });
      continue;
    }
    // Rule 2: the same predictors besides each other, no covariance with a third variable
    const pa = parentsOf(s, a),
      pb = parentsOf(s, b);
    pa.delete(b);
    pb.delete(a);
    const own =
      partnersOf(s, a).filter((x) => x !== b).length +
      partnersOf(s, b).filter((x) => x !== a).length;
    if (sameSet(pa, pb) && own === 0)
      for (const to of ALL) if (to !== cur) out.push({ next: replace(s, a, b, to), rule: 2 });
  }
  return out;
}

/** What changed from `base` to `s`, pair by pair. */
function changes(base: Structure, s: Structure): Change[] {
  const pairs = new Map<string, [string, string]>();
  for (const st of [base, s]) {
    for (const [f, t] of st.paths) pairs.set(pairKey(f, t), sortPair(f, t));
    for (const [x, y] of st.covs) pairs.set(pairKey(x, y), [x, y]);
  }
  const out: Change[] = [];
  for (const [a, b] of pairs.values()) {
    const from = relationOf(base, a, b),
      to = relationOf(s, a, b);
    if (from && to && from !== to) out.push({ a, b, from, to });
  }
  return out;
}

/**
 * The equivalent alternatives of the diagram's structural model by the replacing rules (breadth first, nearest
 * first, at most `max`); the model itself is not among them. `truncated`: more were reachable.
 */
export function equivalentModels(
  model: ModelState,
  max = 24,
): { models: EquivalentModel[]; truncated: boolean } {
  const start = structureOf(model);
  const seen = new Set([keyOf(start)]);
  const queue: EquivalentModel[] = [{ structure: start, changes: [], rules: [] }];
  const out: EquivalentModel[] = [];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const m of moves(cur.structure)) {
      const next = m.next;
      const k = keyOf(next);
      if (seen.has(k) || !drawable(next)) continue;
      seen.add(k);
      if (out.length >= max) return { models: out, truncated: true };
      const e = {
        structure: next,
        changes: changes(start, next),
        rules: [...new Set([...cur.rules, m.rule])].sort() as (1 | 2)[],
      };
      out.push(e);
      queue.push(e);
    }
  }
  return { models: out, truncated: false };
}

/**
 * The diagram with an alternative's structure: paths kept (their ids and drawing), reversed or new; drawn
 * covariances kept, new ones added; a zero record of a pair that is now joined dropped. Positions unchanged.
 */
export function applyStructure(model: ModelState, s: Structure): ModelState {
  const paths: Path[] = s.paths.map(([f, t]) => {
    const same = model.paths.find((p) => p.from === f && p.to === t);
    if (same) return same;
    const rev = model.paths.find((p) => p.from === t && p.to === f);
    return rev ? { ...rev, from: f, to: t } : { id: `eq-p-${f}-${t}`, from: f, to: t };
  });
  const joined = new Set([
    ...s.paths.map(([f, t]) => pairKey(f, t)),
    ...s.covs.map(([a, b]) => pairKey(a, b)),
  ]);
  const covKeys = new Set(s.covs.map(([a, b]) => pairKey(a, b)));
  const correlations: Correlation[] = [
    ...(model.correlations ?? []).filter(
      (k) =>
        k.kind !== 'construct' ||
        (k.zero ? !joined.has(pairKey(k.a, k.b)) : covKeys.has(pairKey(k.a, k.b))),
    ),
    ...s.covs
      .filter(
        ([a, b]) =>
          !(model.correlations ?? []).some(
            (k) => k.kind === 'construct' && !k.zero && pairKey(k.a, k.b) === pairKey(a, b),
          ),
      )
      .map(([a, b]): Correlation => ({ id: `eq-k-${a}-${b}`, kind: 'construct', a, b })),
  ];
  return { ...model, paths, correlations };
}

/** A change in words, with the constructs' names: "A → B reversed", "A → B replaced by ζA ↔ ζB" (base: the model, s: the alternative). */
export function describeChange(
  c: Change,
  name: (id: string) => string,
  base: Structure,
  s: Structure,
): string {
  const rel = (r: Relation, st: Structure) => {
    const [x, y] = r === 'b→a' ? [c.b, c.a] : [c.a, c.b];
    if (r !== 'a↔b') return `${name(x)} → ${name(y)}`;
    return endogenous(st, c.a) ? `ζ${name(c.a)} ↔ ζ${name(c.b)}` : `${name(c.a)} ↔ ${name(c.b)}`;
  };
  return c.from !== 'a↔b' && c.to !== 'a↔b'
    ? `${rel(c.from, base)} reversed`
    : `${rel(c.from, base)} replaced by ${rel(c.to, s)}`;
}
