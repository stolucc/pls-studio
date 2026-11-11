// PROCESS templates on the canvas: a template becomes constructs (empty slots
// named by role, to drag variables onto), paths, moderations and moderated
// moderations, laid out like Hayes's conceptual diagrams: X left, Y right,
// mediators above, moderators below.

import { newId, type Construct, type ModelState } from '../model/project';
import {
  materialise,
  mediatorRange,
  type ProcessGraph,
  type Roles,
  type Template,
} from './templates';

const DX = 230;
const DY = 150;

/** Slot names: X, Y, W, Z, and M (one mediator) or M1…Mk. */
export function slotRoles(tp: Template, k: number): Roles {
  const [lo] = mediatorRange(tp);
  const n = Math.max(lo, k);
  const m = n === 1 ? ['M'] : Array.from({ length: n }, (_, i) => `M${i + 1}`);
  const uses = (r: string) => [tp.xm, tp.my, tp.xy, tp.mm].some((v) => v?.includes(r));
  return {
    x: 'X',
    y: 'Y',
    m: tp.structure === 'moderation' ? [] : m,
    w: uses('W') ? 'W' : undefined,
    z: uses('Z') ? 'Z' : undefined,
  };
}

/** Positions (top-left of each node) for the variables of a template graph. */
export function templatePositions(
  tp: Template,
  roles: Roles,
): Map<string, { x: number; y: number }> {
  const pos = new Map<string, { x: number; y: number }>();
  const k = roles.m.length;
  // Columns from X to Y: a serial chain needs one per mediator.
  let width: number;
  if (tp.structure === 'serial') width = Math.max(2, k + 1);
  else if (tp.structure === 'moderation' || tp.structure === 'parallel') width = 2;
  else width = 3;
  pos.set(roles.x, { x: 0, y: 0 });
  pos.set(roles.y, { x: width * DX, y: 0 });
  const above = (i: number, of: number) => -DY * (of - i);
  switch (tp.structure) {
    case 'parallel':
      roles.m.forEach((m, i) => pos.set(m, { x: DX, y: above(i, k) }));
      break;
    case 'serial':
      // An arch: middle mediators highest, so every forward path stays visible.
      roles.m.forEach((m, i) =>
        pos.set(m, {
          x: (i + 1) * DX * (width / (k + 1)),
          y: -DY * (1 + Math.min(i, k - 1 - i) * 0.6),
        }),
      );
      break;
    case 'converge':
      roles.m.slice(0, -1).forEach((m, i) => pos.set(m, { x: DX, y: above(i, k - 1) }));
      pos.set(roles.m[k - 1], { x: 2 * DX, y: -DY * 0.8 });
      break;
    case 'diverge':
      pos.set(roles.m[0], { x: DX, y: -DY * 0.8 });
      roles.m.slice(1).forEach((m, i) => pos.set(m, { x: 2 * DX, y: above(i, k - 1) }));
      break;
    case 'chains':
      pos.set(roles.m[0], { x: DX, y: -DY * 1.6 });
      pos.set(roles.m[1], { x: 2 * DX, y: -DY * 1.6 });
      pos.set(roles.m[2], { x: DX, y: -DY * 0.7 });
      pos.set(roles.m[3], { x: 2 * DX, y: -DY * 0.7 });
      break;
    case 'moderation':
      break;
  }
  if (roles.w) pos.set(roles.w, { x: width * DX * (roles.z ? 0.3 : 0.5), y: DY * 1.1 });
  if (roles.z) pos.set(roles.z, { x: width * DX * 0.7, y: DY * 1.1 });
  return pos;
}

/**
 * The model for a template graph, reusing constructs of `prev` with the same
 * names (their variables and covariate flags stay) and dropping other
 * non-covariate constructs. Z's two-way moderation is implied by a three-way
 * term and not drawn separately.
 */
export function graphToModel(
  g: ProcessGraph,
  prev: ModelState,
  pos: Map<string, { x: number; y: number }>,
): ModelState {
  const byName = new Map(prev.constructs.map((c) => [c.name, c]));
  const names = [
    g.x,
    ...g.mediators,
    g.y,
    ...new Set([...g.moderations.map((m) => m.by), ...g.threeWay.flatMap((t) => t.by)]),
  ];
  const constructs: Construct[] = [...new Set(names)].map((name) => {
    const old = byName.get(name);
    const at = pos.get(name) ?? (old ? { x: old.x, y: old.y } : { x: 0, y: 0 });
    return old
      ? { ...old, ...at, covariate: undefined }
      : { id: newId('c'), name, type: 'factor', mode: 'A', indicators: [], side: 'left', ...at };
  });
  // Covariates keep their place in the model (they enter every equation).
  const covariates = prev.constructs.filter((c) => c.covariate && !names.includes(c.name));
  const id = new Map(constructs.map((c) => [c.name, c.id]));
  const paths = g.paths.map(([from, to]) => {
    const old = prev.paths.find((p) => p.from === id.get(from) && p.to === id.get(to));
    return { id: old?.id ?? newId('p'), from: id.get(from)!, to: id.get(to)! };
  });
  const pathId = (from: string, to: string) =>
    paths.find((p) => p.from === id.get(from) && p.to === id.get(to))!.id;
  const implied = (path: [string, string], by: string) =>
    g.threeWay.some((t) => t.path[0] === path[0] && t.path[1] === path[1] && t.by[1] === by);
  const moderations = g.moderations
    .filter((m) => !implied(m.path, m.by))
    .map((m) => ({ id: newId('m'), moderator: id.get(m.by)!, path: pathId(...m.path) }));
  const threeWay = g.threeWay.map((t) => ({
    id: newId('t'),
    moderation: moderations.find(
      (m) => m.path === pathId(...t.path) && m.moderator === id.get(t.by[0]),
    )!.id,
    moderator: id.get(t.by[1])!,
  }));
  return {
    constructs: [...constructs, ...covariates],
    paths,
    moderations,
    ...(threeWay.length ? { threeWay } : {}),
  };
}

/** A fresh model of PROCESS template `tp` with `k` mediators (empty slots), keeping `prev`'s covariates. */
export function templateModel(
  tp: Template,
  k: number,
  prev: ModelState = { constructs: [], paths: [], moderations: [] },
): ModelState {
  const roles = slotRoles(tp, k);
  const g = materialise(tp, roles);
  const keep = { ...prev, constructs: prev.constructs.filter((c) => c.covariate) };
  return graphToModel(g, keep, templatePositions(tp, roles));
}

/** Is `name` an unfilled slot's placeholder (renamed after the first variable dropped on it)? */
export const isSlotName = (name: string) => /^(X|Y|W|Z|M\d*)$/.test(name);
