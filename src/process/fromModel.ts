// The drawn model as a conditional process graph. Paths form a DAG from one
// X (the only variable without incoming paths) to one Y (the only one without
// outgoing paths); everything between is a mediator. Moderators sit off the
// paths: their main effects and, for a moderated moderation, the two-way
// terms below the three-way one are implied, as in Hayes's conceptual
// diagrams. A path from a moderator to the outcome of a path it moderates is
// that implied main effect (SEM models draw it), not a structural path, unless
// the moderator is also on other paths.

import type { ModelState } from '../model/project';
import { recognise, type Edge, type ProcessGraph, type Recognised } from './templates';

export interface FromModel {
  graph: ProcessGraph | null;
  /** Names of the covariates (entered in every equation). */
  covariates: string[];
  /** Why the model is not a conditional process model. */
  errors: { message: string; constructId?: string }[];
  recognised: Recognised | null;
}

export function processGraph(model: ModelState): FromModel {
  const errors: FromModel['errors'] = [];
  const byId = new Map(model.constructs.map((c) => [c.id, c]));
  const name = (id: string) => byId.get(id)?.name ?? id;
  const pathOf = new Map(model.paths.map((p) => [p.id, p]));
  const covariates = model.constructs.filter((c) => c.covariate).map((c) => c.name);

  // Moderations as (path, moderator) pairs; a three-way term moderates a moderation.
  const two = model.moderations.flatMap((mo) => {
    const p = pathOf.get(mo.path);
    return p ? [{ path: p, by: mo.moderator, id: mo.id }] : [];
  });
  const three = (model.threeWay ?? []).flatMap((t) => {
    const mo = two.find((m) => m.id === t.moderation);
    return mo ? [{ path: mo.path, by: [mo.by, t.moderator] as [string, string] }] : [];
  });
  const moderatorIds = new Set([...two.map((m) => m.by), ...three.flatMap((t) => t.by)]);
  const moderatedInto = (m: string, to: string) =>
    two.some((x) => x.by === m && x.path.to === to) ||
    three.some((x) => x.by.includes(m) && x.path.to === to);
  // A pure moderator (no incoming paths, outgoing paths only to outcomes it moderates) has only
  // implied main effects; a variable that is also on other paths keeps them (X in model 74).
  const pure = (m: string) =>
    !model.paths.some((p) => p.to === m) &&
    model.paths.every((p) => p.from !== m || moderatedInto(m, p.to));
  const structural = model.paths.filter((p) => !(moderatorIds.has(p.from) && pure(p.from)));

  for (const c of model.constructs) {
    if (!c.covariate) continue;
    if (model.paths.some((p) => p.from === c.id || p.to === c.id) || moderatorIds.has(c.id)) {
      errors.push({
        message: `Covariate "${c.name}" enters every equation by itself; remove its paths and moderations.`,
        constructId: c.id,
      });
    }
  }
  for (const m of two)
    if (m.by === m.path.from) {
      errors.push({
        message: `Quadratic effects (${name(m.by)}²) are not available in conditional process analysis; use PLS-SEM or CB-SEM.`,
        constructId: m.by,
      });
    }

  const nodes = [...new Set(structural.flatMap((p) => [p.from, p.to]))];
  const sources = nodes.filter((id) => !structural.some((p) => p.to === id));
  const sinks = nodes.filter((id) => !structural.some((p) => p.from === id));
  if (!structural.length)
    errors.push({ message: 'Draw a path from X to Y (or pick a PROCESS model template).' });
  else {
    if (sources.length !== 1)
      errors.push({
        message: `A conditional process model has one antecedent X, but ${sources.map(name).join(', ')} have no incoming paths. Make the others mediators or moderators, or mark them as covariates.`,
        constructId: sources[1],
      });
    if (sinks.length !== 1)
      errors.push({
        message: `A conditional process model has one outcome Y, but ${sinks.map(name).join(', ')} have no outgoing paths.`,
        constructId: sinks[1],
      });
  }
  const [x, y] = [sources[0], sinks[0]];
  for (const m of moderatorIds) {
    if (nodes.includes(m) && m !== x)
      errors.push({
        message: `${name(m)} lies on a path and cannot also be a moderator.`,
        constructId: m,
      });
  }
  for (const c of model.constructs) {
    if (!c.covariate && !nodes.includes(c.id) && !moderatorIds.has(c.id)) {
      errors.push({
        message: `"${c.name}" is not in the model: connect it, use it as a moderator, or mark it as a covariate.`,
        constructId: c.id,
      });
    }
  }
  if (errors.length || !x || !y) return { graph: null, covariates, errors, recognised: null };

  const e = (p: { from: string; to: string }): Edge => [name(p.from), name(p.to)];
  const graph: ProcessGraph = {
    x: name(x),
    y: name(y),
    mediators: nodes.filter((id) => id !== x && id !== y).map(name),
    paths: structural.map(e),
    moderations: [],
    threeWay: three.map((t) => ({
      path: e(t.path),
      by: [name(t.by[0]), name(t.by[1])] as [string, string],
    })),
  };
  const seen = new Set<string>();
  const addTwo = (path: Edge, by: string) => {
    const k = `${path.join('>')}|${by}`;
    if (!seen.has(k)) {
      seen.add(k);
      graph.moderations.push({ path, by });
    }
  };
  for (const m of two) addTwo(e(m.path), name(m.by));
  for (const t of graph.threeWay) {
    addTwo(t.path, t.by[0]);
    addTwo(t.path, t.by[1]);
  }
  return { graph, covariates, errors, recognised: recognise(graph) };
}
