import { DEFAULT_FIGURE_STYLE, parseFigureStyle, type FigureStyle } from '../figure/style';
import { DEFAULT_CHART_STYLE, parseChartStyle, type ChartStyle } from '../figure/chartStyle';
import type { CbEstimator } from '../engine/cbsem';
import type { McDesign } from '../engine/montecarlo';
import { parseDesign } from './simulation';
import { processGraph } from '../process/fromModel';
import { exprToR, nameError, namesIn, parseConstraint, parseExpr } from './expr';
import type { ConstructType, Dataset, EsemRotation, FreedParameter, InvarianceLevel, MissingTreatment, Mode, ModelSpec, MultigroupSpec, WeightingScheme } from '../engine/types';
import { MAX_CATEGORIES } from '../engine/dataset';

/** PLS-SEM, CB-SEM, or conditional process analysis (Hayes's PROCESS models, by OLS regression). */
export type Method = 'pls' | 'cbsem' | 'process';

export type Side = 'left' | 'right' | 'top' | 'bottom';

export interface Construct {
  id: string;
  name: string;
  /** Common factor (latent) or composite (emergent). */
  type: ConstructType;
  /** PLS outer weighting mode. */
  mode: Mode;
  indicators: string[];
  x: number;
  y: number;
  side: Side;
  /** CB-SEM higher-order construct: ids of the first-order constructs it is measured by. */
  components?: string[];
  /** CB-SEM observed covariate (single indicator): lavaan fixed.x semantics. */
  covariate?: boolean;
  /** Conditional process analysis: model this scale as a latent variable (lavaan::sam) instead of its mean score. */
  latent?: boolean;
  /** CB-SEM: loadings held at a value (by indicator name); a value for the first indicator replaces the marker's 1. */
  fixedLoadings?: Record<string, number>;
  /** CB-SEM: labels of loadings (by indicator name); equal labels = equal loadings. */
  loadingLabels?: Record<string, string>;
  /** Conditional process analysis: X is multicategorical, coded this way (PROCESS mcx). */
  categorical?: 'indicator' | 'sequential' | 'helmert' | 'effect';
}

export interface Path {
  id: string;
  from: string;
  to: string;
  /** CB-SEM: coefficient held at this value instead of estimated. */
  fixed?: number;
  /** CB-SEM: parameter label; parameters with the same label are equal. */
  label?: string;
}

export interface Settings {
  method: Method;
  /** Consistent PLS: correct common factors for attenuation (Dijkstra & Henseler 2015). */
  consistent: boolean;
  /** CB-SEM estimator; '2SLS' is Bollen's MIIV-2SLS (equation by equation, no global fit). */
  estimator: CbEstimator | '2SLS';
  /** Who calculates: the reference R packages (in the browser via webR) or the built-in engine. */
  engine: Engine;
  /** R package for PLS-SEM when engine is 'r'. */
  plsPackage: 'cSEM' | 'seminr';
  /** Weighting approach with cSEM: PLS path modeling or GSCA. */
  plsApproach: 'PLS-PM' | 'GSCA';
  /** Look of the diagram and exported figures. */
  figure: FigureStyle;
  /** Text style and axis titles of the result charts. */
  charts: ChartStyle;
  scheme: WeightingScheme;
  maxIter: number;
  /** Stop criterion exponent: tolerance = 10^-stopExp. */
  stopExp: number;
  missing: MissingTreatment;
  bootSamples: number;
  seed: number;
  confidence: number;
  /** Conditional process analysis: moderator values at which effects are probed. */
  probe: 'percentiles' | 'meansd';
  /** Conditional process analysis with X moderating M → Y (model 74): values of X compared (null: automatic). */
  counterfactual: { xref: number; xcf: number } | null;
  /** CB-SEM latent interactions: product indicators (lavaan), LMS or QML (modsem). */
  interaction: 'product' | 'lms' | 'qml';
  /** Conditional process analysis: heteroskedasticity-consistent standard errors (PROCESS's hc option). */
  hc: 'none' | 'HC0' | 'HC1' | 'HC2' | 'HC3' | 'HC4';
}

export interface DataInfo {
  fileName: string;
  rows: number;
  missingCells: number;
  excluded: { name: string; reason: string }[];
  /** 'matrix' for covariance-matrix (summary statistics) datasets. */
  kind?: 'raw' | 'matrix';
  hasNacov?: boolean;
  /** Columns reverse-coded in the app (x -> min + max - x), with their scale. */
  reversed?: { name: string; min: number; max: number }[];
}

/** A construct moderating a structural path (drawn as an arrow onto that arrow). */
export interface Moderation {
  id: string;
  moderator: string;
  path: string;
}

/**
 * CB-SEM double-headed arrow. kind 'construct': a and b are construct ids
 * (covariance of their disturbances when endogenous). kind 'indicator': a and
 * b are indicator names (correlated measurement errors).
 */
export interface Correlation {
  id: string;
  kind: 'construct' | 'indicator';
  a: string;
  b: string;
  /** Two exogenous constructs fixed as uncorrelated (covariance 0) instead of the default free covariance. */
  zero?: boolean;
  /** CB-SEM: a drawn covariance held at this value instead of estimated. */
  fixed?: number;
  /** CB-SEM: parameter label; parameters with the same label are equal. */
  label?: string;
}

/** CB-SEM: a defined parameter, name := expression over labels (e.g. an indirect effect a*b). */
export interface DefinedParameter { id: string; name: string; expr: string }
/** CB-SEM: a Wald test of one or more hypotheses "left == right" (one per line). */
export interface WaldTest { id: string; name: string; constraints: string }

/**
 * Moderated moderation (conditional process analysis): a construct moderating
 * a moderation, i.e. the three-way interaction path × W × Z. Drawn as an arrow
 * onto the moderation's arrow; the two-way terms below it are implied.
 */
export interface ThreeWay {
  id: string;
  /** The moderation (path × W) being moderated. */
  moderation: string;
  /** Z. */
  moderator: string;
}

export interface ModelState {
  constructs: Construct[];
  paths: Path[];
  moderations: Moderation[];
  correlations?: Correlation[];
  threeWay?: ThreeWay[];
  /** Indicators (data columns) treated as ordered categorical in CB-SEM (WLSMV). */
  ordered?: string[];
  defined?: DefinedParameter[];
  waldTests?: WaldTest[];
  /** CB-SEM: multiple groups by a data column, with measurement invariance (constructs by id in `free`). */
  multigroup?: MultigroupSpec;
  /** CB-SEM: two-level model by a cluster column. */
  multilevel?: { column: string; between: 'same' | 'saturated' };
  /** CB-SEM: exploratory SEM blocks (construct ids) and their rotation. */
  esem?: { blocks: { id: string; constructs: string[] }[]; rotation: EsemRotation };
}

/** Drop fixed loadings and loading labels of indicators that left their construct. */
export function pruneFixedLoadings(model: ModelState): ModelState {
  const stale = (r: Record<string, unknown> | undefined, c: Construct) => !!r && Object.keys(r).some((i) => !c.indicators.includes(i));
  if (!model.constructs.some((c) => stale(c.fixedLoadings, c) || stale(c.loadingLabels, c))) return model;
  const keep = <T,>(r: Record<string, T> | undefined, c: Construct) => (r ? Object.fromEntries(Object.entries(r).filter(([i]) => c.indicators.includes(i))) : {});
  return {
    ...model,
    constructs: model.constructs.map((c) => {
      const fixedLoadings = keep(c.fixedLoadings, c), loadingLabels = keep(c.loadingLabels, c);
      const { fixedLoadings: _f, loadingLabels: _l, ...rest } = c;
      return { ...rest, ...(Object.keys(fixedLoadings).length ? { fixedLoadings } : {}), ...(Object.keys(loadingLabels).length ? { loadingLabels } : {}) };
    }),
  };
}

/** Drop correlations whose constructs were deleted or whose indicators are no longer assigned. */
export function pruneCorrelations(model: ModelState): ModelState {
  if (!model.correlations?.length) return model;
  const ids = new Set(model.constructs.map((c) => c.id));
  const assigned = new Set(model.constructs.flatMap((c) => c.indicators));
  const ok = (k: Correlation) => k.a !== k.b && (k.kind === 'construct' ? ids.has(k.a) && ids.has(k.b) : assigned.has(k.a) && assigned.has(k.b));
  const kept = model.correlations.filter(ok);
  return kept.length === model.correlations.length ? model : { ...model, correlations: kept };
}

/**
 * Covariances CB-SEM estimates without being drawn: every pair of exogenous
 * latent constructs, and every pair of observed covariates (fixed.x). Pairs
 * the user already drew are left out. Ids are stable: `auto:<a>:<b>`.
 */
export function impliedCorrelations(model: ModelState): Correlation[] {
  const endo = endogenousIds(model);
  const exo = model.constructs.filter((c) => !endo.has(c.id) && (c.indicators.length > 0 || (c.components?.length ?? 0) > 0));
  const drawn = new Set((model.correlations ?? []).filter((k) => k.kind === 'construct').flatMap((k) => [`${k.a}|${k.b}`, `${k.b}|${k.a}`]));
  const out: Correlation[] = [];
  for (let i = 0; i < exo.length; i++) for (let j = i + 1; j < exo.length; j++) {
    const a = exo[i], b = exo[j];
    if (!!a.covariate !== !!b.covariate || drawn.has(`${a.id}|${b.id}`)) continue;
    out.push({ id: `auto:${a.id}:${b.id}`, kind: 'construct', a: a.id, b: b.id });
  }
  return out;
}

/** One end of a correlation being drawn: a construct's shape, its disturbance (ζ) circle, or an indicator error. */
export interface CorrelationEnd { kind: Correlation['kind']; id: string; via?: 'disturbance' }

/**
 * SEM rules for drawing a correlation (LISREL / lavaan): an endogenous
 * construct is explained by its predictors plus a disturbance ζ, so only the
 * disturbance can covary; exogenous constructs covary with each other; and
 * exogenous constructs are uncorrelated with disturbances by assumption.
 * Returns why the end (or pair) is not allowed, or null.
 */
export function correlationEndError(model: ModelState, end: CorrelationEnd): string | null {
  if (end.kind !== 'construct' || end.via === 'disturbance') return null;
  const c = model.constructs.find((k) => k.id === end.id);
  if (c && endogenousIds(model).has(c.id)) {
    return `${c.name} is endogenous: its variance is explained by its predictors, so the construct itself cannot be correlated. Click its disturbance (ζ) to let the unexplained parts covary.`;
  }
  return null;
}

export function correlationPairError(model: ModelState, a: CorrelationEnd, b: CorrelationEnd): string | null {
  if (a.kind !== b.kind) return 'Correlate two constructs (or disturbances), or two indicator errors.';
  if (a.kind === 'construct' && (a.via === 'disturbance') !== (b.via === 'disturbance')) {
    return 'An exogenous construct and a disturbance (ζ) are uncorrelated by assumption in SEM. Correlate two exogenous constructs, or two disturbances.';
  }
  return correlationEndError(model, a) ?? correlationEndError(model, b);
}

/** Constructs with a disturbance: structural predictors, or components of a higher-order construct. */
export function endogenousIds(model: ModelState): Set<string> {
  return new Set([...model.paths.map((p) => p.to), ...model.constructs.flatMap((c) => c.components ?? [])]);
}

export type Engine = 'r' | 'builtin';

export const DEFAULT_SETTINGS: Settings = {
  method: 'pls',
  consistent: false,
  estimator: 'ML',
  engine: 'r',
  plsPackage: 'cSEM',
  plsApproach: 'PLS-PM',
  figure: DEFAULT_FIGURE_STYLE,
  charts: DEFAULT_CHART_STYLE,
  scheme: 'path',
  maxIter: 300,
  stopExp: 7,
  missing: 'mean',
  bootSamples: 1000,
  seed: 1234,
  confidence: 0.95,
  probe: 'percentiles',
  hc: 'none',
  interaction: 'product',
  counterfactual: null,
};

let counter = 0;
export const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}`;

export function toSpec(model: ModelState): ModelSpec {
  const name = new Map(model.constructs.map((c) => [c.id, c.name]));
  return {
    constructs: model.constructs.map((c) => ({
      name: c.name, type: c.type, mode: c.mode, indicators: c.indicators,
      ...(c.components?.length ? { components: c.components.map((id) => name.get(id) ?? id) } : {}),
      ...(c.covariate ? { covariate: true } : {}),
      ...(c.fixedLoadings && Object.keys(c.fixedLoadings).length ? { fixedLoadings: c.fixedLoadings } : {}),
      ...(c.loadingLabels && Object.keys(c.loadingLabels).length ? { loadingLabels: c.loadingLabels } : {}),
    })),
    paths: model.paths.map((p) => ({ from: name.get(p.from)!, to: name.get(p.to)!, ...(p.fixed !== undefined ? { fixed: p.fixed } : p.label ? { label: p.label } : {}) })),
    ...constraintSpec(model),
    ...(model.multilevel ? { multilevel: model.multilevel } : {}),
    ...(model.esem?.blocks.length ? { esem: { rotation: model.esem.rotation, blocks: model.esem.blocks.map((b) => b.constructs.map((id) => name.get(id) ?? id)) } } : {}),
    ...(model.multigroup ? {
      multigroup: {
        ...model.multigroup,
        free: model.multigroup.free.map((f) => (f.kind === 'loading' ? { ...f, construct: name.get(f.construct) ?? f.construct } : f)),
      },
    } : {}),
    moderations: (model.moderations ?? []).flatMap((mo) => {
      const p = model.paths.find((q) => q.id === mo.path);
      return p ? [{ from: name.get(p.from)!, moderator: name.get(mo.moderator)!, to: name.get(p.to)! }] : [];
    }),
    ...(model.ordered?.length ? { ordered: model.ordered.filter((i) => model.constructs.some((c) => c.indicators.includes(i))) } : {}),
    ...(model.correlations?.length ? {
      covariances: pruneCorrelations(model).correlations!.map((k) => (k.kind === 'construct'
        ? { a: name.get(k.a)!, b: name.get(k.b)!, kind: 'construct' as const, ...(k.zero ? { zero: true } : {}), ...(k.fixed !== undefined ? { fixed: k.fixed } : k.label ? { label: k.label } : {}) }
        : { a: k.a, b: k.b, kind: 'indicator' as const, ...(k.fixed !== undefined ? { fixed: k.fixed } : k.label ? { label: k.label } : {}) })),
    } : {}),
  };
}

/** Every label in use, with the parameters carrying it. */
export function labelUses(model: ModelState): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const add = (l: string | undefined, what: string) => { if (l) out.set(l, [...(out.get(l) ?? []), what]); };
  const name = (id: string) => model.constructs.find((c) => c.id === id)?.name ?? id;
  for (const p of model.paths) if (p.fixed === undefined) add(p.label, `${name(p.from)} → ${name(p.to)}`);
  for (const c of model.constructs) for (const [ind, l] of Object.entries(c.loadingLabels ?? {})) if (c.fixedLoadings?.[ind] === undefined) add(l, `${c.name} → ${ind}`);
  for (const k of model.correlations ?? []) if (k.fixed === undefined && !k.zero) add(k.label, `${k.kind === 'construct' ? name(k.a) : k.a} ↔ ${k.kind === 'construct' ? name(k.b) : k.b}`);
  return out;
}

const hypotheses = (t: WaldTest) => t.constraints.split('\n').map((x) => x.trim()).filter(Boolean);

/** Problems with labels, defined parameters and Wald tests. */
export function constraintErrors(model: ModelState): string[] {
  const errs: string[] = [];
  const labels = labelUses(model);
  const variables = new Set([...model.constructs.map((c) => c.name), ...model.constructs.flatMap((c) => c.indicators)]);
  for (const l of labels.keys()) {
    const e = nameError(l);
    if (e) errs.push(`Label ${e}`);
    else if (variables.has(l)) errs.push(`The label “${l}” is also the name of a construct or variable; lavaan needs labels that differ from variable names.`);
  }
  const known = new Set(labels.keys());
  for (const d of model.defined ?? []) {
    const e = nameError(d.name);
    if (e) { errs.push(`Defined parameter: ${e}`); continue; }
    if (known.has(d.name) || variables.has(d.name)) { errs.push(`The defined parameter “${d.name}” has the name of a label, construct or variable; choose another.`); continue; }
    try {
      const unknown = namesIn(parseExpr(d.expr)).filter((n) => !known.has(n));
      if (unknown.length) errs.push(`${d.name} := ${d.expr}: ${unknown.join(', ')} ${unknown.length === 1 ? 'is' : 'are'} not a parameter label (right-click a path, loading or covariance → Label…).`);
    } catch (x) { errs.push(`${d.name} := ${d.expr}: ${(x as Error).message}`); }
    known.add(d.name);
  }
  for (const t of model.waldTests ?? []) {
    if (!hypotheses(t).length) errs.push(`Wald test “${t.name}” has no hypothesis.`);
    for (const line of hypotheses(t)) {
      try {
        const c = parseConstraint(line);
        const unknown = [...namesIn(c.left), ...namesIn(c.right)].filter((n) => !known.has(n));
        if (unknown.length) errs.push(`Wald test “${t.name}”: ${unknown.join(', ')} ${unknown.length === 1 ? 'is' : 'are'} not a label or defined parameter.`);
      } catch (x) { errs.push(`Wald test “${t.name}”, “${line}”: ${(x as Error).message}`); }
    }
  }
  return errs;
}

/** Defined parameters and Wald tests for the request, printed from their parsed form (only when all are valid). */
function constraintSpec(model: ModelState): Pick<ModelSpec, 'defined' | 'waldTests'> {
  if (!(model.defined?.length || model.waldTests?.length) || constraintErrors(model).length) return {};
  return {
    ...(model.defined?.length ? { defined: model.defined.map((d) => ({ name: d.name, expr: exprToR(parseExpr(d.expr)) })) } : {}),
    ...(model.waldTests?.length ? {
      waldTests: model.waldTests.map((t) => ({
        name: t.name,
        constraints: hypotheses(t).map((line) => { const c = parseConstraint(line); return `${exprToR(c.left)} == ${exprToR(c.right)}`; }),
      })),
    } : {}),
  };
}

/** Does the model use labels, defined parameters or Wald tests (lavaan only)? */
export const usesConstraints = (model: ModelState) => labelUses(model).size > 0 || !!model.defined?.length || !!model.waldTests?.length;

export interface Issue {
  level: 'error' | 'warning';
  message: string;
  constructId?: string;
}

/** Does adding from→to create a cycle? (PLS-SEM requires a recursive model.) */
export function createsCycle(paths: Path[], from: string, to: string): boolean {
  if (from === to) return true;
  const out = new Map<string, string[]>();
  for (const p of paths) out.set(p.from, [...(out.get(p.from) ?? []), p.to]);
  const stack = [to];
  const seen = new Set<string>();
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === from) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    stack.push(...(out.get(cur) ?? []));
  }
  return false;
}

export function validateModel(
  model: ModelState,
  data: Dataset | null,
  method: Pick<Settings, 'method' | 'consistent'> & Partial<Pick<Settings, 'estimator' | 'engine' | 'missing' | 'interaction' | 'hc' | 'plsPackage' | 'plsApproach'>> = DEFAULT_SETTINGS,
): Issue[] {
  const issues: Issue[] = [];
  const err = (message: string, constructId?: string) => issues.push({ level: 'error', message, constructId });
  const warn = (message: string, constructId?: string) => issues.push({ level: 'warning', message, constructId });

  if (!data) err('Import a dataset first.');
  if (data?.moments && method.method === 'pls') err('This dataset is a covariance matrix: PLS needs raw data. Switch to CB-SEM.');
  if (data?.moments && method.method === 'process') err('This dataset is a covariance matrix: conditional process analysis needs raw data.');
  if (model.constructs.length < (method.method === 'pls' ? 2 : 1)) err(method.method === 'pls' ? 'Add at least two constructs and connect them with a path.' : 'Add at least one factor.');

  const names = new Map<string, number>();
  for (const c of model.constructs) names.set(c.name.trim().toLowerCase(), (names.get(c.name.trim().toLowerCase()) ?? 0) + 1);

  const owner = new Map<string, string>();
  const available = new Set(data?.names ?? []);
  for (const c of model.constructs) {
    if (!c.name.trim()) err('A construct has an empty name.', c.id);
    else if ((names.get(c.name.trim().toLowerCase()) ?? 0) > 1) err(`Construct name "${c.name}" is used more than once.`, c.id);
    const higher = (c.components?.length ?? 0) > 0;
    if (higher) {
      if (method.method === 'pls') err(`"${c.name}" is a higher-order construct; these are supported in CB-SEM only.`, c.id);
      if (c.indicators.length) err(`"${c.name}" has both indicators and component constructs; remove one.`, c.id);
      if (c.components!.length < 2) warn(`"${c.name}" has a single component; a higher-order factor needs at least two (three for local identification).`, c.id);
      for (const id of c.components!) {
        const comp = model.constructs.find((k) => k.id === id);
        if (!comp) err(`"${c.name}" refers to a removed component.`, c.id);
        else if (model.paths.some((q) => q.to === id)) err(`"${comp.name}" is a component of "${c.name}" and cannot also have incoming paths.`, comp.id);
      }
    } else if (c.indicators.length === 0) err(method.method === 'process'
      ? `"${c.name}" has no variable yet. Drag a column (or a scale's items) from the data panel onto it.`
      : `"${c.name}" has no indicators. Drag variables from the data panel onto it.`, c.id);
    if (higher && method.method === 'process') err(`"${c.name}" is a higher-order construct; these are supported in CB-SEM only.`, c.id);
    if (c.covariate && method.method === 'cbsem') {
      if (c.indicators.length !== 1) err(`Covariate "${c.name}" must have exactly one indicator.`, c.id);
      if (model.paths.some((q) => q.to === c.id)) err(`Covariate "${c.name}" cannot have incoming paths.`, c.id);
    }
    if (c.mode === 'B' && c.indicators.length === 1 && method.method === 'pls') warn(`"${c.name}" uses Mode B with a single indicator; the weighting mode has no effect.`, c.id);
    if (method.method === 'cbsem' && c.type === 'composite') {
      err(`"${c.name}" is a composite. CB-SEM here estimates common factors only; switch it to a common factor or use PLS-SEM.`, c.id);
    }
    if (method.method === 'cbsem' && c.type === 'factor' && c.indicators.length === 2) {
      warn(`"${c.name}" has two indicators; it is only identified through its relations with other factors.`, c.id);
    }
    if (method.method === 'pls' && method.consistent && c.type === 'factor' && c.mode === 'B') {
      warn(`"${c.name}" is a common factor estimated with Mode B; PLSc corrects Mode A factors only.`, c.id);
    }
    for (const ind of c.indicators) {
      const o = owner.get(ind);
      if (o) err(`Indicator "${ind}" is assigned to both "${o}" and "${c.name}".`, c.id);
      owner.set(ind, c.name);
      if (data && !available.has(ind)) err(`Indicator "${ind}" (in "${c.name}") is not in the current dataset.`, c.id);
    }
    // PLS needs every construct in the structural model; CB-SEM also handles pure CFA.
    const isComponent = model.constructs.some((k) => k.components?.includes(c.id));
    if (method.method === 'pls' && !isComponent && !model.paths.some((p) => p.from === c.id || p.to === c.id)) err(`"${c.name}" is not connected to any other construct.`, c.id);
  }

  const cname = new Map(model.constructs.map((c) => [c.id, c.name]));
  const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
  for (const mo of model.moderations ?? []) {
    const p = model.paths.find((q) => q.id === mo.path);
    if (!p) { err('A moderation refers to a path that no longer exists.'); continue; }
    // Conditional process models imply each moderator's main effect (src/process/fromModel.ts).
    if (method.method === 'process') continue;
    const quadratic = mo.moderator === p.from;
    const label = quadratic ? `the quadratic effect of ${cname.get(p.from)} on ${cname.get(p.to)}` : `${cname.get(mo.moderator)} moderating ${cname.get(p.from)} → ${cname.get(p.to)}`;
    if (method.method === 'cbsem' && method.estimator === '2SLS') {
      err(`${quadratic ? 'Quadratic effects' : 'Moderation'} (${label}) ${quadratic ? 'are' : 'is'} not available with MIIV-2SLS; choose a maximum-likelihood estimator.`, mo.moderator);
    } else if (method.method === 'cbsem') {
      // Latent interaction via product indicators needs exogenous predictor and moderator.
      for (const id of new Set([p.from, mo.moderator])) {
        if (model.paths.some((q) => q.to === id)) err(`${cap(label)}: in CB-SEM ${quadratic ? "the predictor" : "the predictor and moderator"} must be exogenous, but ${cname.get(id)} has incoming paths.`, id);
      }
    } else if (method.consistent && !((method.engine ?? 'r') === 'r' && (method.plsPackage ?? 'cSEM') === 'cSEM')) {
      // cSEM estimates nonlinear models with PLSc (Dijkstra & Schermelleh-Engel 2014); seminr and the built-in engine do not.
      err(`${quadratic ? 'Quadratic effects' : 'Moderation'} (${label}) with PLSc ${quadratic ? 'need' : 'needs'} cSEM: choose R packages → cSEM, or switch consistent PLS off.`, mo.moderator);
    }
    if (!model.paths.some((q) => q.from === mo.moderator && q.to === p.to)) {
      err(`${cap(label)}: the moderator also needs a direct path to ${cname.get(p.to)}.`, mo.moderator);
    }
  }

  // Ordinal indicators, WLSMV and FIML: lavaan only, raw data, compatible estimator and missing-data choice.
  const assignedSet = new Set(model.constructs.flatMap((c) => c.indicators));
  const ordered = (model.ordered ?? []).filter((i) => assignedSet.has(i));
  const engine = method.engine ?? 'r';
  const missingChoice = method.missing ?? 'mean';
  if (method.method === 'cbsem') {
    const lavaanOnly = [ordered.length && 'ordinal indicators', method.estimator === 'WLSMV' && 'WLSMV', missingChoice === 'fiml' && 'FIML'].filter(Boolean);
    if (lavaanOnly.length && engine === 'builtin') err(`${lavaanOnly.join(', ')} ${lavaanOnly.length === 1 ? 'is' : 'are'} estimated by lavaan: choose “R packages” under Calculated by.`);
    if (ordered.length && method.estimator !== 'WLSMV') err(`${ordered.join(', ')} ${ordered.length === 1 ? 'is' : 'are'} ordinal: choose the WLSMV estimator (thresholds and polychoric correlations), or treat ${ordered.length === 1 ? 'it' : 'them'} as continuous.`);
    if (ordered.length && missingChoice === 'mean') err('Mean replacement would put non-category values into ordinal indicators; choose casewise deletion.');
    if (missingChoice === 'fiml' && method.estimator !== 'ML' && method.estimator !== 'MLR') err('FIML needs the ML or MLR estimator (MLR adds robust standard errors and test statistic).');
    if ((ordered.length || missingChoice === 'fiml') && data?.moments) err('Ordinal indicators and FIML need raw data, not a covariance matrix.');
    if (data && !data.moments && !ordered.length) {
      const few = [...assignedSet].filter((name) => {
        const col = data.cols[data.names.indexOf(name)];
        if (!col) return false;
        const vals = new Set<number>();
        for (const v of col) { if (Number.isNaN(v)) continue; if (!Number.isInteger(v)) return false; vals.add(v); if (vals.size > 4) return false; }
        return vals.size >= 2;
      });
      if (few.length) warn(`${few.join(', ')} ${few.length === 1 ? 'has' : 'have'} four or fewer categories; consider treating ${few.length === 1 ? 'it' : 'them'} as ordinal (right-click an indicator) with WLSMV (Rhemtulla, Brosseau-Liard & Savalei, 2012).`);
    }
  } else {
    if (missingChoice === 'fiml' && method.method === 'pls') err('FIML is a CB-SEM option; PLS-SEM uses mean replacement or casewise deletion.');
    if (ordered.length && method.method === 'pls') warn(`PLS-SEM treats the ordinal indicators (${ordered.join(', ')}) as continuous.`);
  }

  if (method.method === 'pls' && method.plsApproach === 'GSCA' && !((method.engine ?? 'r') === 'r' && (method.plsPackage ?? 'cSEM') === 'cSEM')) {
    err('GSCA is estimated with cSEM: choose R packages → cSEM, or PLS path modeling.');
  }

  // Text columns coded 1, 2, ... (alphabetical): fine for groups and clusters, rarely as indicators.
  const textInds = data?.categories ? [...assignedSet].filter((i) => data.categories![i]) : [];
  if (textInds.length) {
    warn(`${textInds.join(', ')} ${textInds.length > 1 ? 'are text columns' : 'is a text column'}, used through ${textInds.length > 1 ? 'their' : 'its'} codes 1, 2, … in alphabetical order (${data!.categories![textInds[0]].slice(0, 3).join(', ')}${data!.categories![textInds[0]].length > 3 ? ', …' : ''}). Recode it as numbers if the categories have another order.`);
  }

  const ml = model.multilevel;
  if (ml) {
    if (method.method !== 'cbsem') warn(`The two-level model (clusters by ${ml.column}) is estimated in CB-SEM only; ${method.method === 'pls' ? 'PLS-SEM' : 'regression'} ignores the clustering.`);
    else {
      if (engine === 'builtin') err('Two-level models are estimated by lavaan: choose “R packages” under Calculated by.');
      if (method.estimator !== 'ML' && method.estimator !== 'MLR') err('Two-level models use the ML or MLR estimator.');
      if (model.esem?.blocks.length || ordered.length || model.moderations.length) {
        err('Two-level models cannot be combined with ESEM blocks, ordinal indicators or latent interactions (lavaan estimates two-level models by ML only).');
      }
      if (model.multigroup?.column === ml.column) err(`“${ml.column}” cannot define both the groups and the clusters.`);
      if (ml.between === 'same' && labelUses(model).size > 0) {
        warn('Labels apply at both levels: parameters with the same label are equal within and between clusters (cross-level invariance).');
      }
      if (data?.moments) err('Two-level models need raw data with a cluster column.');
      else if (data) {
        const col = data.cols[data.names.indexOf(ml.column)];
        if (!col) err(`The cluster column “${ml.column}” is not in the dataset.`);
        else {
          if (assignedSet.has(ml.column)) err(`“${ml.column}” is an indicator and cannot also define the clusters.`);
          const k = new Set([...col].filter((v) => !Number.isNaN(v))).size;
          if (k < 2) err(`The cluster column “${ml.column}” has fewer than two clusters.`);
          else if (k < 30) warn(`Only ${k} clusters: between-level estimates and standard errors are unreliable with fewer than about 30–50 clusters (Maas & Hox, 2005).`);
        }
      }
    }
  }

  const mg = model.multigroup;
  if (mg) {
    if (method.method !== 'cbsem') warn(`Multiple groups (${mg.column}) are analysed in CB-SEM only; ${method.method === 'pls' ? 'PLS-SEM' : 'regression'} pools the groups.`);
    else {
      if (engine === 'builtin') err('Multiple-group analysis is estimated by lavaan: choose “R packages” under Calculated by.');
      if (method.estimator === '2SLS') err('Multiple-group analysis is not available with MIIV-2SLS.');
      if (data?.moments) err('Multiple-group analysis needs raw data with a grouping column.');
      else if (data) {
        const col = data.cols[data.names.indexOf(mg.column)];
        if (!col) err(`The grouping column “${mg.column}” is not in the dataset.`);
        else {
          if (assignedSet.has(mg.column)) err(`“${mg.column}” is an indicator and cannot also define the groups.`);
          const counts = new Map<number, number>();
          for (const v of col) if (!Number.isNaN(v)) counts.set(v, (counts.get(v) ?? 0) + 1);
          if (counts.size < 2) err(`The grouping column “${mg.column}” has fewer than two groups.`);
          else if (counts.size > 20) err(`The grouping column “${mg.column}” has ${counts.size} distinct values; choose a column with a few groups (at most 20).`);
          else {
            const small = [...counts].filter(([, k]) => k < 30).map(([v]) => v);
            if (small.length) warn(`Group${small.length === 1 ? '' : 's'} ${small.join(', ')} of “${mg.column}” ${small.length === 1 ? 'has' : 'have'} fewer than 30 cases; estimates may be unstable.`);
          }
        }
      }
      const ids = new Set(model.constructs.map((c) => c.id));
      for (const f of mg.free) if (f.kind === 'loading' && !ids.has(f.construct)) err('A loading freed across groups refers to a removed construct.');
    }
  }

  // Latent interactions by LMS / QML (modsem).
  const lms = method.method === 'cbsem' && (method.interaction ?? 'product') !== 'product' && model.moderations.length > 0;
  if (lms) {
    const what = method.interaction === 'lms' ? 'LMS' : 'QML';
    if (engine === 'builtin') err(`${what} latent interactions are estimated by modsem: choose “R packages” under Calculated by.`);
    if (method.estimator !== 'ML') err(`${what} is a maximum-likelihood method: choose the ML estimator.`);
    if (missingChoice === 'fiml') err(`${what} needs complete data here: choose casewise deletion or mean replacement.`);
    if (model.multigroup || model.esem?.blocks.length || ordered.length || data?.moments) err(`${what} needs raw data and a single-group model without ESEM blocks or ordinal indicators.`);
  }

  const blocks = model.esem?.blocks ?? [];
  if (blocks.length) {
    if (method.method !== 'cbsem') warn(`ESEM blocks are estimated in CB-SEM only; ${method.method === 'pls' ? 'PLS-SEM' : 'regression'} treats their constructs as ordinary ones.`);
    else {
      if (engine === 'builtin') err('Exploratory SEM (ESEM) is estimated by lavaan: choose “R packages” under Calculated by.');
      if (method.estimator === '2SLS') err('ESEM blocks are not available with MIIV-2SLS.');
      const seen = new Set<string>();
      const byId = new Map(model.constructs.map((c) => [c.id, c]));
      for (const b of blocks) {
        if (b.constructs.length < 2) err('An ESEM block needs at least two factors.');
        for (const id of b.constructs) {
          const c = byId.get(id);
          if (!c) continue;
          if (seen.has(id)) err(`"${c.name}" is in two ESEM blocks.`, id);
          seen.add(id);
          if (c.covariate || c.components?.length) err(`"${c.name}" is a covariate or higher-order factor and cannot be in an ESEM block.`, id);
          if (Object.keys(c.fixedLoadings ?? {}).length || Object.keys(c.loadingLabels ?? {}).length) err(`"${c.name}" is in an ESEM block, whose loadings are rotated: remove its fixed loadings and loading labels.`, id);
          if (model.moderations.some((mo) => mo.moderator === id || model.paths.find((p) => p.id === mo.path)?.from === id)) err(`"${c.name}" is in an ESEM block and cannot take part in a latent interaction.`, id);
        }
      }
      if (model.esem!.rotation === 'target' && blocks.length > 1) err('Target rotation is available for a single ESEM block.');
    }
  }

  if (usesConstraints(model)) {
    if (method.method !== 'cbsem') warn(`Parameter labels, defined parameters and Wald tests are used by CB-SEM only; ${method.method === 'pls' ? 'PLS-SEM' : 'regression'} ignores them.`);
    else {
      for (const e of constraintErrors(model)) err(e);
      if (engine === 'builtin') err('Parameter labels (equality constraints), defined parameters and Wald tests are estimated by lavaan: choose “R packages” under Calculated by.');
      if (method.estimator === '2SLS') err('Parameter labels, defined parameters and Wald tests are not available with MIIV-2SLS.');
    }
  }

  const nFixed = model.paths.filter((p) => p.fixed !== undefined).length + (model.correlations ?? []).filter((k) => k.fixed !== undefined).length
    + model.constructs.reduce((s, c) => s + Object.keys(c.fixedLoadings ?? {}).length, 0);
  if (nFixed && method.method !== 'cbsem') warn(`${nFixed} parameter${nFixed === 1 ? ' is' : 's are'} fixed at a value; only CB-SEM uses fixed values, ${method.method === 'pls' ? 'PLS-SEM' : 'regression'} estimates ${nFixed === 1 ? 'it' : 'them'} freely.`);
  else if (nFixed && method.estimator === '2SLS') err('Fixed parameter values are not available with MIIV-2SLS; choose a maximum-likelihood estimator or free them.');
  if (model.threeWay?.length && method.method !== 'process') {
    err('Moderated moderation (a moderator acting on a moderation) is available in conditional process analysis only.');
  }
  if (method.method === 'process') {
    for (const e of processGraph(model).errors) err(e.message, e.constructId);
    const latent = model.constructs.filter((c) => c.latent && !c.covariate);
    for (const c of latent) {
      if (c.indicators.length < 2) err(`"${c.name}" is set as a latent variable but has ${c.indicators.length} item${c.indicators.length === 1 ? '' : 's'}; a latent variable needs at least two (three for a stable measurement model).`, c.id);
      else if (c.indicators.length === 2) warn(`"${c.name}" is a latent variable with two items; it is identified only through its relations with other latent variables.`, c.id);
    }
    const g = processGraph(model).graph;
    for (const c of model.constructs.filter((k) => k.categorical)) {
      if (!g || c.name !== g.x) err(`"${c.name}" is marked as categorical, which applies to X only.`, c.id);
      else if (c.indicators.length !== 1 || c.latent) err(`The categorical X "${c.name}" must be a single observed column.`, c.id);
      else if (data && !data.moments) {
        const col = data.cols[data.names.indexOf(c.indicators[0])];
        const k = col ? new Set([...col].filter((v) => !Number.isNaN(v))).size : 0;
        if (k < 2 || k > 10) err(`The categorical X "${c.name}" needs 2 to 10 groups (it has ${k}).`, c.id);
      }
    }
    // Dichotomous Y (logistic) and counterfactual (X by M) effects use the lm / glm bootstrap engine.
    const gy = g && model.constructs.find((c) => c.name === g.y);
    const ycol = gy && gy.indicators.length === 1 && data && !data.moments ? data.cols[data.names.indexOf(gy.indicators[0])] : undefined;
    const binaryY = !!ycol && new Set([...ycol].filter((v) => !Number.isNaN(v))).size === 2;
    const xmint = !!g && g.moderations.some((m) => m.by === g.x && m.path[1] === g.y);
    if (binaryY && (latent.length || (method.hc ?? 'none') !== 'none')) {
      err('A dichotomous Y is analysed by logistic regression, which is not combined with latent variables or HC standard errors here.');
    }
    if (xmint && (binaryY || latent.length || model.constructs.some((c) => c.categorical))) {
      err('X moderating its own M → Y paths (counterfactual effects, model 74) needs a continuous Y, observed variables and a non-categorical X (as PROCESS).');
    }
    if (latent.length && model.threeWay?.length) {
      err('Moderated moderation (three-way interaction) is not available with latent variables (lavaan’s SAM syntax has no three-way products). Use mean scores, or remove the three-way term.', latent[0].id);
    }
  }

  const corrs = model.correlations ?? [];
  if (corrs.length && method.method !== 'cbsem') {
    warn(`The model has ${corrs.length} correlation${corrs.length === 1 ? '' : 's'} (double-headed arrows); ${method.method === 'pls' ? 'PLS-SEM' : 'regression'} ignores them. They are estimated in CB-SEM.`);
  } else if (corrs.length) {
    const endo = endogenousIds(model);
    const byId = new Map(model.constructs.map((c) => [c.id, c]));
    const ownerOf = new Map(model.constructs.flatMap((c) => c.indicators.map((i) => [i, c] as const)));
    for (const k of corrs) {
      if (k.kind === 'construct') {
        const a = byId.get(k.a), b = byId.get(k.b);
        if (!a || !b) continue;
        const label = `Correlation ${a.name} ↔ ${b.name}`;
        if (k.zero) {
          if (a.covariate || b.covariate || endo.has(a.id) || endo.has(b.id)) err(`${a.name} and ${b.name} are fixed as uncorrelated, which applies to two exogenous constructs only. Delete the fixed zero.`, (endo.has(a.id) || a.covariate ? a : b).id);
          else if (method.method === 'cbsem' && method.estimator === '2SLS') warn(`MIIV-2SLS does not use the fixed zero between ${a.name} and ${b.name}; it estimates their covariance.`);
          continue;
        }
        if (a.covariate || b.covariate) err(`${label}: covariates are observed and fixed (fixed.x); they cannot get extra covariances.`, (a.covariate ? a : b).id);
        else if (endo.has(a.id) !== endo.has(b.id)) {
          err(`${label} joins an exogenous construct with an endogenous one. Correlate exogenous constructs with each other, or the disturbances of endogenous constructs.`, (endo.has(a.id) ? b : a).id);
        }
        else if (endo.has(a.id) && model.paths.some((q) => (q.from === a.id && q.to === b.id) || (q.from === b.id && q.to === a.id))) {
          warn(`Disturbances of ${a.name} and ${b.name} covary while one predicts the other: the model is non-recursive and usually not identified unless both have instruments (predictors the other lacks).`, a.id);
        }
      } else {
        const ca = ownerOf.get(k.a), cb = ownerOf.get(k.b);
        if (!ca || !cb) continue;
        if (ca.indicators.length === 1 || cb.indicators.length === 1 || ca.covariate || cb.covariate) {
          err(`Error correlation ${k.a} ↔ ${k.b}: single-indicator constructs have no measurement error to correlate.`, (ca.indicators.length === 1 || ca.covariate ? ca : cb).id);
        }
      }
    }
  }

  const seen: Path[] = [];
  for (const p of model.paths) {
    if (createsCycle(seen, p.from, p.to)) err('The structural model contains a cycle. PLS-SEM requires a recursive model.');
    seen.push(p);
  }

  if (data && model.constructs.length > 0 && method.method !== 'process') {
    const n = data.moments ? data.moments.n : data.cols[0]?.length ?? 0;
    const maxArrows = Math.max(
      ...model.constructs.map((c) => Math.max(c.mode === 'B' ? c.indicators.length : 0, model.paths.filter((p) => p.to === c.id).length)),
    );
    if (maxArrows > 0 && n < 10 * maxArrows) warn(`Sample size (${n}) is below the 10-times rule minimum (${10 * maxArrows}).`);
  }
  return issues;
}


/** JSON-ready data section (NaN → null). Used in project files and for server datasets. */
export function serializeDataSection(data: Dataset, info: DataInfo) {
  return {
    info, names: data.names, columns: data.cols.map((c) => Array.from(c, (v) => (Number.isNaN(v) ? null : v))),
    ...(data.moments ? { moments: data.moments } : {}),
    ...(data.categories ? { categories: data.categories } : {}),
  };
}

/** Category labels of coded text columns, for columns that exist (labels are plain text). */
function parseCategories(raw: unknown, names: string[]): { categories?: Record<string, string[]> } {
  if (!isObj(raw)) return {};
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!names.includes(k) || !Array.isArray(v) || v.length > MAX_CATEGORIES) continue;
    out[k] = v.map((x: unknown) => str(x, 200));
  }
  return Object.keys(out).length ? { categories: out } : {};
}

/** Reverse-coded columns of a project file (columns that exist, finite scales). */
function parseReversed(raw: unknown, names: string[]): { reversed?: { name: string; min: number; max: number }[] } {
  if (!Array.isArray(raw)) return {};
  const out = raw.filter((r): r is Record<string, unknown> => isObj(r)).map((r) => ({ name: str(r.name), min: Number(r.min), max: Number(r.max) }))
    .filter((r) => names.includes(r.name) && Number.isFinite(r.min) && Number.isFinite(r.max) && r.min < r.max);
  return out.length ? { reversed: out } : {};
}

/** Validate the data section of a project file (also used for datasets stored on the server). */
export function parseDataSection(d: Record<string, unknown>): { data: Dataset; info: DataInfo } {
  let data: Dataset;
  let info: DataInfo;
  const matrixData = d.moments !== undefined && Array.isArray(d.columns) && d.columns.length === 0;
  if (!Array.isArray(d.names) || !Array.isArray(d.columns) || (!matrixData && d.names.length !== d.columns.length) || !isObj(d.info)) {
    throw new Error('Invalid project file: data section is malformed.');
  }
  const names = d.names.map((n: unknown) => str(n));
  const cols = d.columns.map((col: unknown) => {
    if (!Array.isArray(col)) throw new Error('Invalid project file: data column is malformed.');
    return Float64Array.from(col, (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN));
  });
  if (cols.some((c: Float64Array) => c.length !== cols[0].length)) throw new Error('Invalid project file: columns differ in length.');
  data = { names, cols, ...parseCategories(d.categories, names) };
  info = {
    fileName: str(d.info.fileName ?? 'data.csv'),
    rows: cols[0]?.length ?? 0,
    missingCells: cols.reduce((s: number, c: Float64Array) => s + c.filter(Number.isNaN).length, 0),
    excluded: [],
    ...parseReversed(d.info.reversed, names),
  };
  if (d.moments !== undefined) {
    const moments = parseMoments(d.moments, names.length);
    data = { names, cols: [], moments };
    info = { ...info, rows: moments.n, missingCells: 0, kind: 'matrix', hasNacov: !!moments.nacov };
  }
  return { data: data!, info: info! };
}

// ---------- persistence ----------

/** Validate summary statistics: a finite symmetric positive-diagonal p × p matrix, N > 2, optional p* × p* NACOV. */
export function parseMoments(raw: unknown, p: number): { S: number[][]; n: number; nacov?: number[][] } {
  if (typeof raw !== 'object' || raw === null) throw new Error('Invalid covariance-matrix data.');
  const r = raw as Record<string, unknown>;
  const square = (m: unknown, k: number, what: string): number[][] => {
    if (!Array.isArray(m) || m.length !== k || k > 20000) throw new Error(`Invalid ${what}: expected a ${k} × ${k} matrix.`);
    return m.map((row) => {
      if (!Array.isArray(row) || row.length !== k) throw new Error(`Invalid ${what}: expected a ${k} × ${k} matrix.`);
      return row.map((v) => { if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`Invalid ${what}: non-numeric entry.`); return v; });
    });
  };
  if (p > 300) throw new Error('Covariance matrices are limited to 300 variables.');
  const S = square(r.S, p, 'covariance matrix');
  for (let i = 0; i < p; i++) {
    if (!(S[i][i] > 0)) throw new Error('Invalid covariance matrix: variances must be positive.');
    for (let j = 0; j < i; j++) if (Math.abs(S[i][j] - S[j][i]) > 1e-8 * Math.max(1, Math.abs(S[i][j]))) throw new Error('Invalid covariance matrix: not symmetric.');
  }
  const n = typeof r.n === 'number' && Number.isInteger(r.n) && r.n > 2 && r.n < 1e9 ? r.n : NaN;
  if (Number.isNaN(n)) throw new Error('Invalid covariance-matrix data: N must be an integer above 2.');
  const nacov = r.nacov === undefined || r.nacov === null ? undefined : square(r.nacov, (p * (p + 1)) / 2, 'NACOV matrix');
  return { S, n, ...(nacov ? { nacov } : {}) };
}

export interface ProjectFile {
  format: 'pls-studio';
  version: 1;
  model: ModelState;
  settings: Settings;
  data: { info: DataInfo; names: string[]; columns: (number | null)[][]; moments?: { S: number[][]; n: number; nacov?: number[][] } } | null;
  simulation?: McDesign | null;
}

export function serializeProject(model: ModelState, settings: Settings, data: Dataset | null, info: DataInfo | null, simulation: McDesign | null = null): string {
  const file: ProjectFile = {
    format: 'pls-studio',
    version: 1,
    model,
    settings,
    data: data && info ? serializeDataSection(data, info) : null,
    simulation,
  };
  return JSON.stringify(file);
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 200): string => {
  if (typeof v !== 'string') throw new Error('Invalid project file.');
  return v.slice(0, max);
};
/** A fixed parameter value from a file: a finite number of sensible size. */
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e6;
const LEVELS: InvarianceLevel[] = ['configural', 'metric', 'scalar', 'strict'];
function parseMultigroup(r: Record<string, unknown>, ids: Set<string>): MultigroupSpec {
  const free = (Array.isArray(r.free) ? r.free.slice(0, 1000) : []).filter(isObj).flatMap((f: Record<string, unknown>): FreedParameter[] => {
    if (f.kind === 'loading' && typeof f.construct === 'string' && ids.has(f.construct) && typeof f.indicator === 'string') return [{ kind: 'loading' as const, construct: f.construct, indicator: str(f.indicator) }];
    if (f.kind === 'intercept' && typeof f.indicator === 'string') return [{ kind: 'intercept' as const, indicator: str(f.indicator) }];
    return [];
  });
  return { column: str(r.column), invariance: LEVELS.find((l) => l === r.invariance) ?? 'configural', free };
}

/** A parameter label from a file (validated again before use). */
const labelOf = (v: unknown): { label?: string } => (typeof v === 'string' && v.trim() ? { label: v.trim().slice(0, 31) } : {});
function loadingLabelsOf(raw: unknown, indicators: unknown[]): { loadingLabels?: Record<string, string> } {
  if (!isObj(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) if (indicators.includes(k) && typeof v === 'string' && v.trim()) out[k] = v.trim().slice(0, 31);
  return Object.keys(out).length ? { loadingLabels: out } : {};
}
function fixedLoadingsOf(raw: unknown, indicators: unknown[]): { fixedLoadings?: Record<string, number> } {
  if (!isObj(raw)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw)) if (indicators.includes(k) && finite(v)) out[k] = v;
  return Object.keys(out).length ? { fixedLoadings: out } : {};
}
const num = (v: unknown, lo: number, hi: number, dflt: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt;

/** Parse and strictly validate an untrusted project file. */
export function parseProject(text: string): { model: ModelState; settings: Settings; data: Dataset | null; info: DataInfo | null; simulation: McDesign | null } {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error('The file is not valid JSON.'); }
  if (!isObj(raw) || raw.format !== 'pls-studio' || raw.version !== 1) throw new Error('Not a PLS Studio project file (or an unsupported version).');
  const m = raw.model;
  if (!isObj(m) || !Array.isArray(m.constructs) || !Array.isArray(m.paths)) throw new Error('Invalid project file: model missing.');
  if (m.constructs.length > 500 || m.paths.length > 5000) throw new Error('Project is too large.');
  const sides: Side[] = ['left', 'right', 'top', 'bottom'];
  const constructs: Construct[] = m.constructs.map((c: unknown) => {
    if (!isObj(c) || !Array.isArray(c.indicators)) throw new Error('Invalid construct in project file.');
    const mode: Mode = c.mode === 'B' ? 'B' : 'A';
    return {
      id: str(c.id, 64),
      name: str(c.name, 100),
      // Files from before construct types existed: Mode B meant formative/composite.
      type: c.type === 'composite' || c.type === 'factor' ? c.type : mode === 'B' ? 'composite' : 'factor',
      mode,
      indicators: c.indicators.slice(0, 1000).map((i: unknown) => str(i)),
      x: num(c.x, -1e6, 1e6, 0),
      y: num(c.y, -1e6, 1e6, 0),
      side: sides.includes(c.side as Side) ? (c.side as Side) : 'left',
      ...(Array.isArray(c.components) && c.components.length ? { components: c.components.slice(0, 100).map((x: unknown) => str(x, 64)) } : {}),
      ...(c.covariate === true ? { covariate: true } : {}),
      ...(c.latent === true ? { latent: true } : {}),
      ...((['indicator', 'sequential', 'helmert', 'effect'] as const).includes(c.categorical as 'indicator') ? { categorical: c.categorical as 'indicator' } : {}),
      ...(fixedLoadingsOf(c.fixedLoadings, c.indicators as unknown[])),
      ...(loadingLabelsOf(c.loadingLabels, c.indicators as unknown[])),
    };
  });
  const ids = new Set(constructs.map((c) => c.id));
  if (ids.size !== constructs.length) throw new Error('Invalid project file: duplicate construct ids.');
  for (const c of constructs) if (c.components?.some((x) => !ids.has(x) || x === c.id)) throw new Error('Invalid project file: higher-order construct refers to an unknown component.');
  const paths: Path[] = m.paths.map((p: unknown) => {
    if (!isObj(p)) throw new Error('Invalid path in project file.');
    const path = { id: str(p.id, 64), from: str(p.from, 64), to: str(p.to, 64), ...(finite(p.fixed) ? { fixed: p.fixed } : {}), ...(labelOf(p.label)) };
    if (!ids.has(path.from) || !ids.has(path.to)) throw new Error('Invalid project file: path references unknown construct.');
    return path;
  });

  const s = isObj(raw.settings) ? raw.settings : {};
  const settings: Settings = {
    method: s.method === 'cbsem' || s.method === 'process' ? s.method : 'pls',
    consistent: s.consistent === true,
    estimator: (['ML', 'MLM', 'MLMV', 'MLR', 'GLS', 'ULS', 'WLSMV', '2SLS'] as const).find((e) => e === s.estimator) ?? 'ML',
    engine: s.engine === 'builtin' ? 'builtin' : 'r',
    plsPackage: s.plsPackage === 'seminr' ? 'seminr' : 'cSEM',
    plsApproach: s.plsApproach === 'GSCA' ? 'GSCA' : 'PLS-PM',
    figure: parseFigureStyle(s.figure),
    charts: parseChartStyle(s.charts),
    scheme: s.scheme === 'factor' || s.scheme === 'centroid' ? s.scheme : 'path',
    maxIter: Math.round(num(s.maxIter, 10, 10000, DEFAULT_SETTINGS.maxIter)),
    stopExp: Math.round(num(s.stopExp, 3, 12, DEFAULT_SETTINGS.stopExp)),
    missing: s.missing === 'casewise' || s.missing === 'fiml' ? s.missing : 'mean',
    bootSamples: Math.round(num(s.bootSamples, 10, 100000, DEFAULT_SETTINGS.bootSamples)),
    seed: Math.round(num(s.seed, 0, 2 ** 31, DEFAULT_SETTINGS.seed)),
    confidence: num(s.confidence, 0.5, 0.999, DEFAULT_SETTINGS.confidence),
    probe: s.probe === 'meansd' ? 'meansd' : 'percentiles',
    hc: (['HC0', 'HC1', 'HC2', 'HC3', 'HC4'] as const).find((h) => h === s.hc) ?? 'none',
    interaction: s.interaction === 'lms' || s.interaction === 'qml' ? s.interaction : 'product',
    counterfactual: isObj(s.counterfactual) && finite(s.counterfactual.xref) && finite(s.counterfactual.xcf) ? { xref: s.counterfactual.xref, xcf: s.counterfactual.xcf } : null,
  };

  const { data, info } = isObj(raw.data) ? parseDataSection(raw.data) : { data: null, info: null };
  const pathIds = new Set(paths.map((p) => p.id));
  const rawMods = Array.isArray(m.moderations) ? m.moderations.slice(0, 1000) : [];
  const moderations: Moderation[] = rawMods.map((mo: unknown) => {
    if (!isObj(mo)) throw new Error('Invalid moderation in project file.');
    const out = { id: str(mo.id, 64), moderator: str(mo.moderator, 64), path: str(mo.path, 64) };
    if (!ids.has(out.moderator) || !pathIds.has(out.path)) throw new Error('Invalid project file: moderation references unknown construct or path.');
    return out;
  });
  const modIds = new Set(moderations.map((mo) => mo.id));
  const rawThree = Array.isArray(m.threeWay) ? m.threeWay.slice(0, 1000) : [];
  const threeWay: ThreeWay[] = rawThree.map((t: unknown) => {
    if (!isObj(t)) throw new Error('Invalid moderated moderation in project file.');
    const out = { id: str(t.id, 64), moderation: str(t.moderation, 64), moderator: str(t.moderator, 64) };
    if (!ids.has(out.moderator) || !modIds.has(out.moderation)) throw new Error('Invalid project file: moderated moderation references an unknown construct or moderation.');
    return out;
  });
  const indicatorNames = new Set(constructs.flatMap((c) => c.indicators));
  const rawCorrs = Array.isArray(m.correlations) ? m.correlations.slice(0, 5000) : [];
  const correlations: Correlation[] = rawCorrs.map((k: unknown) => {
    if (!isObj(k) || (k.kind !== 'construct' && k.kind !== 'indicator')) throw new Error('Invalid correlation in project file.');
    const out: Correlation = { id: str(k.id, 64), kind: k.kind, a: str(k.a), b: str(k.b), ...(k.zero === true && k.kind === 'construct' ? { zero: true } : {}), ...(finite(k.fixed) ? { fixed: k.fixed } : {}), ...(labelOf(k.label)) };
    const known = out.kind === 'construct' ? ids : indicatorNames;
    if (!known.has(out.a) || !known.has(out.b) || out.a === out.b) throw new Error('Invalid project file: correlation references an unknown construct or indicator.');
    return out;
  });
  return {
    model: {
      constructs, paths, moderations, ...(correlations.length ? { correlations } : {}), ...(threeWay.length ? { threeWay } : {}),
      ...(Array.isArray(m.ordered) && m.ordered.length ? { ordered: [...new Set(m.ordered.slice(0, 5000).map((x: unknown) => str(x)))] } : {}),
      ...(Array.isArray(m.defined) && m.defined.length ? { defined: m.defined.slice(0, 200).filter(isObj).map((d: Record<string, unknown>) => ({ id: str(d.id, 64), name: str(d.name, 31), expr: str(d.expr, 500) })) } : {}),
      ...(isObj(m.multigroup) && typeof m.multigroup.column === 'string' ? { multigroup: parseMultigroup(m.multigroup, ids) } : {}),
      ...(isObj(m.multilevel) && typeof m.multilevel.column === 'string' ? { multilevel: { column: str(m.multilevel.column), between: m.multilevel.between === 'same' ? 'same' as const : 'saturated' as const } } : {}),
      ...(isObj(m.esem) && Array.isArray(m.esem.blocks) ? { esem: {
        rotation: (['geomin', 'oblimin', 'quartimin', 'varimax', 'target'] as const).find((r) => r === (m.esem as Record<string, unknown>).rotation) ?? 'geomin',
        blocks: m.esem.blocks.slice(0, 50).filter(isObj).map((b: Record<string, unknown>) => ({ id: str(b.id, 64), constructs: (Array.isArray(b.constructs) ? b.constructs : []).map((x: unknown) => str(x, 64)).filter((x: string) => ids.has(x)) })),
      } } : {}),
      ...(Array.isArray(m.waldTests) && m.waldTests.length ? { waldTests: m.waldTests.slice(0, 100).filter(isObj).map((t: Record<string, unknown>) => ({ id: str(t.id, 64), name: str(t.name, 100), constraints: str(t.constraints, 2000) })) } : {}),
    },
    settings, data, info, simulation: raw.simulation ? parseDesign(raw.simulation) : null,
  };
}
