// The independencies a recursive path model implies (d-separation; Pearl 2009, Shipley 2000): the basis set of
// claims "x and y are independent given the parents of both" for every pair of variables not joined by an arrow, as
// Thoemmes, Rosseel & Textor (2018) test them for a lavaan model. Exogenous variables covary freely unless drawn as
// uncorrelated (lavaan's default), so a pair of them makes a claim only when fixed at zero. Pure, unit tested
// (dsep.test.ts); the tests themselves run in R (R/partial.R, ps_dsep).

import type { ModelState } from './project';

/** y ⫫ x | given, by data column; y comes after x in the model's causal order. */
export interface DsepClaim {
  x: string;
  y: string;
  given: string[];
}

/**
 * Why the model has no basis set of this kind, or null: every construct one observed variable, the arrows acyclic,
 * no correlated disturbances (they need m-separation), moderation or groups.
 */
export function dsepProblem(model: ModelState): string | null {
  if (model.constructs.some((c) => c.indicators.length !== 1 || c.components?.length))
    return 'every construct must be a single observed variable (a path model): implied independencies among latent variables are not tested here.';
  if (model.moderations?.length) return 'the model has a moderation.';
  if (model.multigroup) return 'the model has groups.';
  const parents = parentsOf(model);
  const endogenous = (id: string) => (parents.get(id)?.length ?? 0) > 0;
  const byIndicator = new Map(model.constructs.map((c) => [c.indicators[0], c.id]));
  for (const r of model.correlations ?? []) {
    const a = r.kind === 'indicator' ? byIndicator.get(r.a) : r.a;
    const b = r.kind === 'indicator' ? byIndicator.get(r.b) : r.b;
    if ((a && endogenous(a)) || (b && endogenous(b)))
      return 'the model has correlated disturbances: the basis set of a directed acyclic graph does not apply to them.';
  }
  if (!topologicalOrder(model)) return 'the arrows form a cycle (a non-recursive model).';
  return null;
}

function parentsOf(model: ModelState): Map<string, string[]> {
  const parents = new Map(model.constructs.map((c) => [c.id, [] as string[]]));
  for (const p of model.paths) parents.get(p.to)?.push(p.from);
  return parents;
}

/** The constructs in an order where every arrow points forward (the drawing's order where free), or null on a cycle. */
function topologicalOrder(model: ModelState): string[] | null {
  const parents = parentsOf(model);
  const done = new Set<string>();
  const order: string[] = [];
  while (order.length < model.constructs.length) {
    const next = model.constructs.find(
      (c) => !done.has(c.id) && parents.get(c.id)!.every((p) => done.has(p)),
    );
    if (!next) return null;
    done.add(next.id);
    order.push(next.id);
  }
  return order;
}

/** The basis set: one claim per pair not joined by an arrow (nor a free exogenous covariance). */
export function basisSet(model: ModelState): DsepClaim[] {
  const order = topologicalOrder(model);
  if (!order) return [];
  const parents = parentsOf(model);
  const column = new Map(model.constructs.map((c) => [c.id, c.indicators[0]]));
  const adjacent = new Set(model.paths.flatMap((p) => [`${p.from}|${p.to}`, `${p.to}|${p.from}`]));
  const exogenous = (id: string) => parents.get(id)!.length === 0;
  const zero = new Set(
    (model.correlations ?? [])
      .filter((r) => r.kind === 'construct' && (r.zero || r.fixed === 0))
      .flatMap((r) => [`${r.a}|${r.b}`, `${r.b}|${r.a}`]),
  );
  const claims: DsepClaim[] = [];
  order.forEach((x, i) =>
    order.slice(i + 1).forEach((y) => {
      if (adjacent.has(`${x}|${y}`)) return;
      // (two exogenous variables covary unless the model fixes their covariance at zero)
      if (exogenous(x) && exogenous(y) && !zero.has(`${x}|${y}`)) return;
      const given = order.filter(
        (z) => z !== x && (parents.get(x)!.includes(z) || parents.get(y)!.includes(z)),
      );
      claims.push({
        x: column.get(x)!,
        y: column.get(y)!,
        given: given.map((z) => column.get(z)!),
      });
    }),
  );
  return claims;
}
