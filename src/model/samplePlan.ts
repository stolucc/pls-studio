// Planning a sample size by Monte Carlo simulation (Muthén & Muthén 2002): the guided flow on top of the
// Monte Carlo card. The researcher states expected effects and the hypotheses that must come out significant;
// the simulation runs over a coarse grid of sample sizes, then a finer one where power crosses the target, and
// the plan reports the smallest N reaching it for each hypothesis and for all of them together (joint power).

import type { CbResult } from '../engine/cbsem';
import {
  designParameters,
  JOINT_PARAM,
  type McDesign,
  type McParam,
  type McPlan,
  type McSummaryRow,
} from '../engine/montecarlo';
import { buildPopulation, type PopInteraction, type PopulationSpec } from '../engine/population';
import type { PlsResult } from '../engine/types';
import type { Method, ModelState } from './project';
import { defaultDesign, ESTIMATOR_CHOICES, populationFromModel } from './simulation';

/** Effect-size presets for standardised paths (Cohen 1988's r benchmarks, the usual reading of β). */
export const PATH_PRESETS = [
  { label: 'small', value: 0.1 },
  { label: 'medium', value: 0.3 },
  { label: 'large', value: 0.5 },
] as const;

/**
 * Presets for latent interactions (the coefficient of the centred product of standardised factors): interaction
 * effects in survey research are mostly small (Aguinis et al. 2005), hence the lower benchmarks.
 */
export const INTERACTION_PRESETS = [
  { label: 'small', value: 0.05 },
  { label: 'typical', value: 0.1 },
  { label: 'large', value: 0.15 },
] as const;

/** Estimators offered in the guided flow (the full card offers every one). */
export const PLAN_ESTIMATORS = ['PLS', 'PLSc', 'CB-ML', 'CB-MLR', 'Sum scores'] as const;

/** The guided flow's estimators that can estimate latent interactions (interactionError in simulation.tsx). */
export const INTERACTION_ESTIMATORS: readonly string[] = ['PLS', 'Sum scores'];

export const DEFAULT_PLAN: McPlan = {
  focal: [],
  target: 0.8,
  search: 'auto',
  minN: 50,
  maxN: 1000,
};

/** A moderation on the canvas that the population cannot simulate, and why. */
export interface SkippedModeration {
  label: string;
  reason: string;
}

/**
 * Latent interactions for the model's moderations: the moderated path's predictor times the moderator, acting on
 * the path's outcome. The population simulates them between exogenous common factors only, so moderations of a
 * path from an endogenous construct (second-stage moderation) or by an endogenous moderator are reported instead.
 */
export function interactionsFromModel(model: ModelState): {
  interactions: PopInteraction[];
  skipped: SkippedModeration[];
} {
  const byId = new Map(model.constructs.map((c) => [c.id, c]));
  const endogenous = new Set(model.paths.map((p) => p.to));
  const interactions: PopInteraction[] = [];
  const skipped: SkippedModeration[] = [];
  for (const mo of model.moderations ?? []) {
    const path = model.paths.find((p) => p.id === mo.path);
    const x = path && byId.get(path.from),
      w = byId.get(mo.moderator),
      y = path && byId.get(path.to);
    if (!x || !w || !y) continue;
    const label = `${w.name} moderating ${x.name} → ${y.name}`;
    const problem = [x, w].find((c) => endogenous.has(c.id));
    if (problem)
      skipped.push({
        label,
        reason: `${problem.name} is endogenous: interactions are simulated between exogenous constructs only (first-stage moderation).`,
      });
    else if (x.type !== 'factor' || w.type !== 'factor')
      skipped.push({ label, reason: 'interactions are simulated between common factors only.' });
    else interactions.push({ a: x.name, b: w.name, to: y.name, value: 0.1 });
  }
  return { interactions, skipped };
}

/** The design's parameters (null when the population is not valid). */
export function planParameters(design: McDesign): McParam[] | null {
  try {
    return designParameters(design, buildPopulation(design.population));
  } catch {
    return null;
  }
}

/** Parameters a hypothesis can name: structural paths (interactions included), indirect effects, group differences. */
export const hypothesisParams = (params: McParam[]) =>
  params.filter((p) => p.kind === 'path' || p.kind === 'indirect' || p.kind === 'difference');

/** The default hypotheses: every non-zero structural path, interactions included. */
export const defaultFocal = (params: McParam[], except: Set<string> = new Set()) =>
  params
    .filter((p) => p.kind === 'path' && Math.abs(p.value) > 1e-12 && !except.has(p.key))
    .map((p) => p.key);

/** A moderator's main effect the plan adds by itself starts at this value (as a drawn path does). */
export const MAIN_EFFECT_DEFAULT = 0.3;

/**
 * The population with every interaction's main effects: a latent interaction needs the paths of both its constructs
 * to the outcome (population.ts). A moderation on the canvas implies the moderator's main effect without its arrow
 * being drawn, so the plan adds the missing paths (at MAIN_EFFECT_DEFAULT; editable like any other effect).
 */
export function withMainEffects(pop: PopulationSpec): PopulationSpec {
  const has = new Set(pop.paths.map((p) => `${p.from}|${p.to}`));
  const added: PopulationSpec['paths'] = [];
  for (const x of pop.interactions ?? [])
    for (const from of [x.a, x.b])
      if (from !== x.to && !has.has(`${from}|${x.to}`)) {
        has.add(`${from}|${x.to}`);
        added.push({ from, to: x.to, value: MAIN_EFFECT_DEFAULT });
      }
  return added.length ? { ...pop, paths: [...pop.paths, ...added] } : pop;
}

/** Paths of the plan that are not drawn on the canvas (moderators' main effects): keys of their parameters. */
export function impliedPathKeys(pop: PopulationSpec, model: ModelState): Set<string> {
  const name = new Map(model.constructs.map((c) => [c.id, c.name]));
  const drawn = new Set(model.paths.map((p) => `${name.get(p.from)}|${name.get(p.to)}`));
  return new Set(
    pop.paths.filter((p) => !drawn.has(`${p.from}|${p.to}`)).map((p) => `path:${p.from}:${p.to}`),
  );
}

/** The guided flow's starting design: the model's population with its moderations, one estimator, a plan. */
export function planDesign(
  model: ModelState,
  pls: PlsResult | null,
  cb: CbResult | null,
  method: Method,
): McDesign {
  const base = populationFromModel(model, pls, cb);
  const { interactions } = interactionsFromModel(model);
  const population: PopulationSpec = interactions.length
    ? withMainEffects({ ...base, interactions })
    : base;
  const allFactors = population.constructs.every((c) => c.type === 'factor');
  // (latent interactions are estimated by PLS with product indicators or regression on sum scores only)
  const id = interactions.length
    ? 'PLS'
    : method === 'cbsem'
      ? 'CB-ML'
      : allFactors
        ? 'PLSc'
        : 'PLS';
  const design: McDesign = {
    ...defaultDesign(population),
    estimators: ESTIMATOR_CHOICES.filter((e) => e.id === id),
    replications: 500,
    plan: { ...DEFAULT_PLAN },
  };
  design.sampleSizes = coarseSizes(DEFAULT_PLAN.minN, DEFAULT_PLAN.maxN);
  const params = planParameters(design);
  // (a moderator's main effect is in the model either way, not a hypothesis unless ticked)
  design.plan!.focal = params ? defaultFocal(params, impliedPathKeys(population, model)) : [];
  return design;
}

const roundTo = (n: number, step: number) => Math.max(step, Math.round(n / step) * step);

/** The first stage's sample sizes: doubling from minN, ending at maxN (at most 7). */
export function coarseSizes(minN: number, maxN: number): number[] {
  const out: number[] = [];
  for (let n = minN; n < maxN && out.length < 6; n *= 2) out.push(roundTo(n, 10));
  out.push(maxN);
  return [...new Set(out)].sort((a, b) => a - b);
}

/** Where power crosses the target over a grid of sample sizes. */
export type Crossing =
  | { status: 'found'; n: number; lower: number; upper: number }
  | { status: 'atMin'; n: number }
  | { status: 'notReached'; maxN: number; power: number };

/**
 * The smallest N with power at or above the target, interpolated linearly between the largest N still below it
 * and the next one (conservative under Monte Carlo noise: a dip below the target after a crossing moves it up).
 */
export function crossing(points: { n: number; power: number }[], target: number): Crossing | null {
  const pts = points.filter((p) => Number.isFinite(p.power)).sort((a, b) => a.n - b.n);
  if (!pts.length) return null;
  let j = -1;
  pts.forEach((p, i) => {
    if (p.power < target) j = i;
  });
  if (j === -1) return { status: 'atMin', n: pts[0].n };
  if (j === pts.length - 1) return { status: 'notReached', maxN: pts[j].n, power: pts[j].power };
  const a = pts[j],
    b = pts[j + 1];
  // (less a hair: 300.0000001 from rounding error is 300)
  const n = Math.ceil(a.n + ((target - a.power) / (b.power - a.power)) * (b.n - a.n) - 1e-9);
  return { status: 'found', n: Math.min(b.n, Math.max(a.n + 1, n)), lower: a.n, upper: b.n };
}

/** Power of one parameter (by key) for one estimator, by sample size. */
export const powerPoints = (rows: McSummaryRow[], estimator: string, key: string) =>
  rows
    .filter((r) => r.estimator === estimator && r.param.key === key && r.rejection !== null)
    .map((r) => ({ n: r.n, power: r.rejection! }))
    .sort((a, b) => a.n - b.n);

/**
 * The second stage's sample sizes: three between the bracketing sizes of every crossing (joint power and each
 * hypothesis), rounded to 10 (5 in narrow brackets), without the sizes already run; at most 6.
 */
export function refineSizes(crossings: (Crossing | null)[], done: number[]): number[] {
  const out = new Set<number>();
  for (const c of crossings) {
    if (c?.status !== 'found' || c.upper - c.lower < 10) continue;
    const step = c.upper - c.lower <= 60 ? 5 : 10;
    for (const f of [0.25, 0.5, 0.75]) {
      const n = roundTo(c.lower + f * (c.upper - c.lower), step);
      if (n > c.lower && n < c.upper && !done.includes(n)) out.add(n);
    }
  }
  // (the joint crossing comes first, so its sizes survive the cap)
  return [...out].slice(0, 6).sort((a, b) => a - b);
}

/** One hypothesis in the plan's report. */
export interface PlanHypothesis {
  param: McParam;
  points: { n: number; power: number }[];
  crossing: Crossing | null;
}

/** The plan's answer for one estimator. */
export interface PlanReport {
  estimator: string;
  hypotheses: PlanHypothesis[];
  /** All focal hypotheses at once (null with a single hypothesis: its own crossing is the answer). */
  joint: PlanHypothesis | null;
  /** The recommendation: the joint crossing (or the single hypothesis's). */
  recommended: Crossing | null;
  /** Shares of failed and improper replications at the recommended N (or the largest N run). */
  failed: number;
  improper: number;
}

export function planReports(rows: McSummaryRow[], design: McDesign): PlanReport[] {
  const plan = design.plan;
  if (!plan) return [];
  const byKey = new Map(rows.map((r) => [r.param.key, r.param]));
  const focal = plan.focal.filter((k) => byKey.has(k));
  return design.estimators.map((e) => {
    const hypotheses = focal.map((key) => {
      const points = powerPoints(rows, e.id, key);
      return { param: byKey.get(key)!, points, crossing: crossing(points, plan.target) };
    });
    const jp = powerPoints(rows, e.id, JOINT_PARAM.key);
    const joint =
      focal.length > 1
        ? { param: JOINT_PARAM, points: jp, crossing: crossing(jp, plan.target) }
        : null;
    const recommended = (joint ?? hypotheses[0])?.crossing ?? null;
    const ns = [...new Set(rows.map((r) => r.n))].sort((a, b) => a - b);
    const at =
      recommended && recommended.status !== 'notReached'
        ? (ns.find((n) => n >= recommended.n) ?? ns[ns.length - 1])
        : ns[ns.length - 1];
    const here = rows.filter(
      (r) => r.estimator === e.id && r.n === at && focal.includes(r.param.key),
    );
    const share = (f: (r: McSummaryRow) => number) =>
      here.length ? Math.max(...here.map((r) => f(r) / Math.max(1, r.reps + r.failed))) : 0;
    return {
      estimator: e.id,
      hypotheses,
      joint,
      recommended,
      failed: share((r) => r.failed),
      improper: share((r) => r.improper),
    };
  });
}

/** A parameter as a hypothesis label. */
export function hypothesisLabel(p: McParam): string {
  if (p.kind === 'joint') return 'All hypotheses jointly';
  if (p.kind === 'indirect') return `${p.from} → … → ${p.to} (indirect)`;
  if (p.kind === 'difference') return `${p.from} → ${p.to} (group difference)`;
  return `${p.from} → ${p.to}`;
}

const f2 = (v: number) => v.toFixed(2).replace(/^(-?)0\./, '$1.');

/** "N = 240", or why there is no number. */
export function crossingText(c: Crossing | null, target: number): string {
  if (!c) return 'no power estimate';
  if (c.status === 'found') return `N = ${c.n}`;
  if (c.status === 'atMin') return `N ≤ ${c.n}`;
  return `above ${c.maxN} (power ${f2(c.power)} at N = ${c.maxN}; target ${f2(target)})`;
}

/** A methods paragraph for the plan, citing the approach (plain text, author–year). */
export function planMethodsText(design: McDesign, report: PlanReport): string {
  const plan = design.plan!;
  const pop = design.population;
  const factors = pop.constructs.filter((c) => c.type === 'factor');
  const loadings = factors.flatMap((c) => c.loadings ?? c.indicators.map(() => 0.75));
  const range = (xs: number[], f: (v: number) => string) => {
    const lo = Math.min(...xs),
      hi = Math.max(...xs);
    return lo === hi ? f(lo) : `${f(lo)}–${f(hi)}`;
  };
  const loadText = loadings.length
    ? ` Common factors were measured by ${range(
        factors.map((c) => c.indicators.length),
        String,
      )} indicators with standardised loadings of ${range(loadings, f2)}.`
    : '';
  const effects = report.hypotheses
    .map((h) => `${hypothesisLabel(h.param)} = ${f2(h.param.value)}`)
    .join(', ');
  const inter = pop.interactions?.length
    ? ` Moderation was specified as latent interactions of standardised, normally distributed factors.`
    : '';
  const nonnormal =
    pop.skew || pop.kurtosis
      ? ` Indicators were non-normal (skewness ${pop.skew ?? 0}, excess kurtosis ${pop.kurtosis ?? 0}).`
      : '';
  const missing =
    design.missing && design.missing.rate > 0
      ? ` ${Math.round(design.missing.rate * 100)}% of the values were set missing (${design.missing.mechanism}).`
      : '';
  const ns = [...new Set(design.sampleSizes)].sort((a, b) => a - b);
  const pls = design.estimators.find((e) => e.id === report.estimator)?.method === 'pls';
  const inference = pls ? ` with ${design.bootSamples} bootstrap samples per replication` : '';
  const target = f2(plan.target);
  const rec = report.recommended;
  const what = report.joint
    ? `all ${report.hypotheses.length} hypothesised effects to be significant in the same sample`
    : 'the hypothesised effect to be significant';
  const result =
    rec?.status === 'found' || rec?.status === 'atMin'
      ? ` The smallest sample giving a probability of at least ${target} for ${what} was ${crossingText(rec, plan.target)}.`
      : ` Even at N = ${rec?.status === 'notReached' ? rec.maxN : ns[ns.length - 1]}, the probability for ${what} stayed below ${target}.`;
  const each = report.joint
    ? ` For the individual hypotheses, power of ${target} required ${report.hypotheses
        .map((h) => `${crossingText(h.crossing, plan.target)} (${hypothesisLabel(h.param)})`)
        .join('; ')}.`
    : '';
  return (
    `The sample size was determined by an a priori Monte Carlo power analysis (Muthén & Muthén, 2002; Wolf et al., 2013). ` +
    `Data were generated from a population model with the hypothesised structure and expected standardised effects (${effects}).` +
    loadText +
    inter +
    nonnormal +
    missing +
    ` For each of ${ns.length} sample sizes between ${ns[0]} and ${ns[ns.length - 1]}, ${design.replications} samples were drawn and estimated by ${report.estimator}${inference}, testing each effect at α = ${design.alpha}.` +
    result +
    each
  );
}

/** The structure a plan's population takes from the model: constructs with their indicators, and paths. */
const structureOf = (p: PopulationSpec) =>
  JSON.stringify([
    p.constructs.map((c) => [c.name, c.type, c.indicators]),
    p.paths.map((x) => [x.from, x.to]),
  ]);
const interactionKey = (x: PopInteraction) => `${x.a}|${x.b}|${x.to}`;

/**
 * A plan kept in step with the model on the canvas: when constructs, indicators, paths or moderations changed since
 * the card was made, its population is rebuilt from the model, keeping every value the researcher set that still
 * applies (paths, interactions and correlations by their constructs; loadings by indicator, a new indicator taking
 * its construct's first loading). New paths become hypotheses; hypotheses that no longer exist are dropped. The same
 * design (by identity) when nothing changed.
 */
export function syncPlan(
  d: McDesign,
  model: ModelState,
  pls: PlsResult | null,
  cb: CbResult | null,
  method: Method,
): McDesign {
  if (!d.plan) return d;
  const fresh = planDesign(model, pls, cb, method);
  const old = d.population,
    next = fresh.population;
  const oldInter = new Set((old.interactions ?? []).map(interactionKey));
  const changed =
    structureOf(old) !== structureOf(next) ||
    (next.interactions ?? []).some((x) => !oldInter.has(interactionKey(x)));
  if (!changed) return d;
  const byName = new Map(old.constructs.map((c) => [c.name, c]));
  const constructs = next.constructs.map((c) => {
    const o = byName.get(c.name);
    if (!o || o.type !== c.type) return c;
    if (c.type === 'factor') {
      const first = o.loadings?.[0];
      const loadings = c.indicators.map((ind, i) => {
        const k = o.indicators.indexOf(ind);
        return k >= 0 && o.loadings ? o.loadings[k] : (first ?? c.loadings?.[i] ?? 0.75);
      });
      return { ...c, loadings };
    }
    const weights = c.indicators.map((ind, i) => {
      const k = o.indicators.indexOf(ind);
      return k >= 0 && o.weights ? o.weights[k] : (c.weights?.[i] ?? 1);
    });
    return {
      ...c,
      weights,
      ...(o.withinCor !== undefined ? { withinCor: o.withinCor } : {}),
      ...(o.withinMatrix && o.indicators.join('|') === c.indicators.join('|')
        ? { withinMatrix: o.withinMatrix }
        : {}),
    };
  });
  const pathValue = new Map(old.paths.map((p) => [`${p.from}|${p.to}`, p.value]));
  const paths = next.paths.map((p) => ({
    ...p,
    value: pathValue.get(`${p.from}|${p.to}`) ?? p.value,
  }));
  const corValue = new Map(
    old.exoCor.flatMap((r) => [
      [`${r.a}|${r.b}`, r.value],
      [`${r.b}|${r.a}`, r.value],
    ]),
  );
  const exoCor = next.exoCor.map((r) => ({
    ...r,
    value: corValue.get(`${r.a}|${r.b}`) ?? r.value,
  }));
  // Interactions: the model's (with the values set), and those added on the card that still fit the model.
  const names = new Set(constructs.map((c) => c.name));
  const explained = new Set(paths.map((p) => p.to));
  const interValue = new Map((old.interactions ?? []).map((x) => [interactionKey(x), x.value]));
  const fromModel = (next.interactions ?? []).map((x) => ({
    ...x,
    value: interValue.get(interactionKey(x)) ?? x.value,
  }));
  const kept = (old.interactions ?? []).filter(
    (x) =>
      !fromModel.some((y) => interactionKey(y) === interactionKey(x)) &&
      [x.a, x.b, x.to].every((n) => names.has(n)) &&
      !explained.has(x.a) &&
      !explained.has(x.b) &&
      explained.has(x.to),
  );
  const interactions = [...fromModel, ...kept];
  const indicators = new Set(constructs.flatMap((c) => c.indicators));
  const { interactions: _i, crossLoadings, errorCors, ...rest } = old;
  const population: PopulationSpec = {
    ...rest,
    constructs,
    paths,
    exoCor,
    ...(interactions.length ? { interactions } : {}),
    ...(crossLoadings?.some((x) => indicators.has(x.indicator) && names.has(x.construct))
      ? {
          crossLoadings: crossLoadings.filter(
            (x) => indicators.has(x.indicator) && names.has(x.construct),
          ),
        }
      : {}),
    ...(errorCors?.some((x) => indicators.has(x.a) && indicators.has(x.b))
      ? { errorCors: errorCors.filter((x) => indicators.has(x.a) && indicators.has(x.b)) }
      : {}),
  };
  // A moderated model needs an estimator of latent interactions.
  const estimators =
    interactions.length &&
    !d.estimators.every(
      (e) =>
        (e.method === 'pls' && !e.consistent && !e.approach) ||
        (e.method === 'regression' && !e.dr),
    )
      ? fresh.estimators
      : d.estimators;
  const synced: McDesign = { ...d, population: withMainEffects(population), estimators };
  const before = new Set((planParameters(d) ?? []).map((p) => p.key));
  const after = planParameters(synced) ?? [];
  const exists = new Set(after.map((p) => p.key));
  const focal = [
    ...d.plan.focal.filter((k) => exists.has(k)),
    ...defaultFocal(after, impliedPathKeys(synced.population, model)).filter(
      (k) => !before.has(k) && !d.plan!.focal.includes(k),
    ),
  ];
  return { ...synced, plan: { ...d.plan, focal } };
}
