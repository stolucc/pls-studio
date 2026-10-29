import { DEFAULT_FIGURE_STYLE, parseFigureStyle, type FigureStyle } from '../figure/style';
import { DEFAULT_CHART_STYLE, parseChartStyle, type ChartStyle } from '../figure/chartStyle';
import type { CbEstimator } from '../engine/cbsem';
import type { McDesign } from '../engine/montecarlo';
import { parseDesign } from './simulation';
import { processGraph } from '../process/fromModel';
import type { ConstructType, Dataset, MissingTreatment, Mode, ModelSpec, WeightingScheme } from '../engine/types';

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
}

export interface Path {
  id: string;
  from: string;
  to: string;
  /** CB-SEM: coefficient held at this value instead of estimated. */
  fixed?: number;
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
}

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
}

/** Drop fixed loadings of indicators that left their construct. */
export function pruneFixedLoadings(model: ModelState): ModelState {
  if (!model.constructs.some((c) => c.fixedLoadings && Object.keys(c.fixedLoadings).some((i) => !c.indicators.includes(i)))) return model;
  return {
    ...model,
    constructs: model.constructs.map((c) => {
      if (!c.fixedLoadings) return c;
      const kept = Object.fromEntries(Object.entries(c.fixedLoadings).filter(([i]) => c.indicators.includes(i)));
      const { fixedLoadings: _f, ...rest } = c;
      return Object.keys(kept).length ? { ...rest, fixedLoadings: kept } : rest;
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
    })),
    paths: model.paths.map((p) => ({ from: name.get(p.from)!, to: name.get(p.to)!, ...(p.fixed !== undefined ? { fixed: p.fixed } : {}) })),
    moderations: (model.moderations ?? []).flatMap((mo) => {
      const p = model.paths.find((q) => q.id === mo.path);
      return p ? [{ from: name.get(p.from)!, moderator: name.get(mo.moderator)!, to: name.get(p.to)! }] : [];
    }),
    ...(model.correlations?.length ? {
      covariances: pruneCorrelations(model).correlations!.map((k) => (k.kind === 'construct'
        ? { a: name.get(k.a)!, b: name.get(k.b)!, kind: 'construct' as const, ...(k.zero ? { zero: true } : {}), ...(k.fixed !== undefined ? { fixed: k.fixed } : {}) }
        : { a: k.a, b: k.b, kind: 'indicator' as const, ...(k.fixed !== undefined ? { fixed: k.fixed } : {}) })),
    } : {}),
  };
}

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
  method: Pick<Settings, 'method' | 'consistent'> & Partial<Pick<Settings, 'estimator'>> = DEFAULT_SETTINGS,
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
    } else if (method.consistent) err(`${quadratic ? 'Quadratic effects' : 'Moderation'} (${label}) ${quadratic ? 'are' : 'is'} not yet supported with PLSc. Switch consistent PLS off.`, mo.moderator);
    if (!model.paths.some((q) => q.from === mo.moderator && q.to === p.to)) {
      err(`${cap(label)}: the moderator also needs a direct path to ${cname.get(p.to)}.`, mo.moderator);
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
  };
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
  data = { names, cols };
  info = {
    fileName: str(d.info.fileName ?? 'data.csv'),
    rows: cols[0]?.length ?? 0,
    missingCells: cols.reduce((s: number, c: Float64Array) => s + c.filter(Number.isNaN).length, 0),
    excluded: [],
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
      ...(fixedLoadingsOf(c.fixedLoadings, c.indicators as unknown[])),
    };
  });
  const ids = new Set(constructs.map((c) => c.id));
  if (ids.size !== constructs.length) throw new Error('Invalid project file: duplicate construct ids.');
  for (const c of constructs) if (c.components?.some((x) => !ids.has(x) || x === c.id)) throw new Error('Invalid project file: higher-order construct refers to an unknown component.');
  const paths: Path[] = m.paths.map((p: unknown) => {
    if (!isObj(p)) throw new Error('Invalid path in project file.');
    const path = { id: str(p.id, 64), from: str(p.from, 64), to: str(p.to, 64), ...(finite(p.fixed) ? { fixed: p.fixed } : {}) };
    if (!ids.has(path.from) || !ids.has(path.to)) throw new Error('Invalid project file: path references unknown construct.');
    return path;
  });

  const s = isObj(raw.settings) ? raw.settings : {};
  const settings: Settings = {
    method: s.method === 'cbsem' || s.method === 'process' ? s.method : 'pls',
    consistent: s.consistent === true,
    estimator: (['ML', 'MLM', 'MLMV', 'MLR', 'GLS', 'ULS', '2SLS'] as const).find((e) => e === s.estimator) ?? 'ML',
    engine: s.engine === 'builtin' ? 'builtin' : 'r',
    plsPackage: s.plsPackage === 'seminr' ? 'seminr' : 'cSEM',
    figure: parseFigureStyle(s.figure),
    charts: parseChartStyle(s.charts),
    scheme: s.scheme === 'factor' || s.scheme === 'centroid' ? s.scheme : 'path',
    maxIter: Math.round(num(s.maxIter, 10, 10000, DEFAULT_SETTINGS.maxIter)),
    stopExp: Math.round(num(s.stopExp, 3, 12, DEFAULT_SETTINGS.stopExp)),
    missing: s.missing === 'casewise' ? 'casewise' : 'mean',
    bootSamples: Math.round(num(s.bootSamples, 10, 100000, DEFAULT_SETTINGS.bootSamples)),
    seed: Math.round(num(s.seed, 0, 2 ** 31, DEFAULT_SETTINGS.seed)),
    confidence: num(s.confidence, 0.5, 0.999, DEFAULT_SETTINGS.confidence),
    probe: s.probe === 'meansd' ? 'meansd' : 'percentiles',
    hc: (['HC0', 'HC1', 'HC2', 'HC3', 'HC4'] as const).find((h) => h === s.hc) ?? 'none',
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
    const out: Correlation = { id: str(k.id, 64), kind: k.kind, a: str(k.a), b: str(k.b), ...(k.zero === true && k.kind === 'construct' ? { zero: true } : {}), ...(finite(k.fixed) ? { fixed: k.fixed } : {}) };
    const known = out.kind === 'construct' ? ids : indicatorNames;
    if (!known.has(out.a) || !known.has(out.b) || out.a === out.b) throw new Error('Invalid project file: correlation references an unknown construct or indicator.');
    return out;
  });
  return {
    model: { constructs, paths, moderations, ...(correlations.length ? { correlations } : {}), ...(threeWay.length ? { threeWay } : {}) },
    settings, data, info, simulation: raw.simulation ? parseDesign(raw.simulation) : null,
  };
}
