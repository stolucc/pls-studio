import { clampStrict, isObj } from '../parse';
import { parseDroppedRows, type RowExclusion } from './rows';
import { DEFAULT_FIGURE_STYLE, parseFigureStyle, type FigureStyle } from '../figure/style';
import { parseEfaDesign, type EfaDesign } from './efa';
import { DEFAULT_CHART_STYLE, parseChartStyle, type ChartStyle } from '../figure/chartStyle';
import type { CbEstimator } from '../engine/cbsem';
import type { McDesign } from '../engine/montecarlo';
import { parseDesign } from './simulation';
import { exprToR, nameError, namesIn, parseConstraint, parseExpr, parseInequality } from './expr';
import { BIFACTOR_ROTATIONS, ORTHOGONALISABLE_ROTATIONS, type ConstructType, type Dataset, type EsemRotation, type FreedParameter, type GroupValue, type InvarianceLevel, type MissingTreatment, type Mode, type ModelSpec, type MomentData, type MomentGroup, type MultigroupSpec, type StructuralEquality, type WeightingScheme } from '../engine/types';
import { pooledMoments } from '../data/moments';
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
  /** CB-SEM: loadings on components held at values (by component id); a value for the first component replaces the marker's 1 (a latent curve: 1, 1, 1 and 0, 1, 2). */
  componentLoadings?: Record<string, number>;
  /** CB-SEM higher-order factor: the first component's loading is estimated too; the scale comes from a path into this factor held at a value (Brown 2015, Table 8.12: STRESS BY SATIS* OPTIM; STRESS ON X1@1). */
  markerFree?: boolean;
  /** CB-SEM observed covariate (single indicator): lavaan fixed.x semantics. */
  covariate?: boolean;
  /** CB-SEM single indicator: known reliability (error variance fixed at (1 − r) × variance; otherwise 0). */
  reliability?: number;
  /** CB-SEM single indicator: its error variance estimated instead of 0, when the model identifies it (Bollen 1989, Figure 5.4: reciprocal effects with an instrument for each). R engine. */
  freeError?: boolean;
  /** CB-SEM multi-indicator factor: known reliabilities of some indicators (by name), fixing their error variances likewise (Hayduk 1987). */
  reliabilities?: Record<string, number>;
  /** Conditional process analysis: model this scale as a latent variable (lavaan::sam) instead of its mean score. */
  latent?: boolean;
  /** CB-SEM: loadings held at a value (by indicator name); a value for the first indicator replaces the marker's 1. */
  fixedLoadings?: Record<string, number>;
  /** How it is drawn: another shape than its type's, and a colour of its own (with its indicators). */
  shape?: 'rectangle' | 'octagon';
  color?: string;
  /** PLS-SEM: pre-defined outer weights, by indicator. */
  predefinedWeights?: Record<string, number>;
  /** PLS: dominant indicator (fixes the construct's sign). */
  dominant?: string;
  /** CB-SEM: labels of loadings (by indicator name); equal labels = equal loadings. */
  loadingLabels?: Record<string, string>;
  /** CB-SEM factor: its scale from a variance fixed at 1, every loading estimated (lavaan NA*y1 + …; f ~~ 1*f; Mplus f BY y1* …; f@1); absent: the first loading fixed at 1 (marker). */
  scaling?: 'variance';
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
  /** How it is drawn. */
  line?: 'dashed' | 'dotted';
  curved?: boolean;
  /** CB-SEM specification search (as Amos): the arrow may be dropped; the search fits the model with and without it. */
  optional?: true;
}

export interface Settings {
  /** Recalculate by itself after a change to the model. */
  autoCalculate: boolean;
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
  plsApproach: 'PLS-PM' | 'GSCA' | 'PCA' | 'unit';
  /**
   * PLS-SEM second-order constructs: the (disjoint) two-stage approach (cSEM "2stage", seminr two_stage),
   * the embedded two-stage approach (cSEM "mixed": repeated indicators in stage 1), or repeated
   * indicators (the dimensions' indicators measure the construct too; Becker et al. 2012; written out for
   * cSEM as its help page does, and for seminr as a composite of the repeated items).
   */
  hocApproach: HocApproach;
  /** Look of the diagram and exported figures. */
  figure: FigureStyle;
  /** The exploratory factor analysis panel's design, kept with the project. */
  efa?: EfaDesign;
  /** Text style and axis titles of the result charts. */
  charts: ChartStyle;
  scheme: WeightingScheme;
  maxIter: number;
  /** Stop criterion exponent: tolerance = 10^-stopExp. */
  stopExp: number;
  missing: MissingTreatment;
  /** Multiple imputation: number of imputed data sets. */
  miImputations: number;
  /** CB-SEM multiple imputation: mice (chained equations) or Amelia (EM with bootstrap; Honaker, King & Blackwell). */
  /** mice: predictive mean matching; micenorm: mice's Bayesian normal regression (logistic for nominal columns); amelia; joint: data augmentation
   *  under the unrestricted multivariate normal model, categorical columns through latent responses (Mplus's H1 imputation). */
  miMethod: 'mice' | 'amelia' | 'micenorm' | 'joint';
  /** Multiple imputation, CB-SEM: further columns that inform the imputation without being in the model (auxiliary variables). */
  miAuxiliary: string[];
  /** Amelia: nominal (unordered categorical) columns among the imputation's variables (Amelia's noms). */
  miNominal: string[];
  bootSamples: number;
  /** Bootstrap tests one-tailed (p in the direction of the estimate, intervals [α, 1 − α]) or two-tailed. */
  bootTails: 'two' | 'one';
  /** Bootstrap intervals: percentile, or bias-corrected and accelerated (BCa; adds a jackknife). */
  bootInterval: 'percentile' | 'bca' | 'studentized';
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
  /** Columns computed from a formula over other columns (data/compute.ts), in the order they were added. */
  computed?: { name: string; expr: string }[];
  /** Cases excluded in the app (e.g. outliers), kept so they can be restored (model/rows.ts). */
  droppedRows?: RowExclusion[];
}

/** PLS-SEM (seminr): how an interaction term is built; absent = the two-stage approach (products of construct scores). */
export type InteractionMethod = 'orthogonal' | 'product_indicator';
export const INTERACTION_METHOD_NAMES: Record<InteractionMethod, string> = { orthogonal: 'orthogonalising', product_indicator: 'product indicators' };

/** A construct moderating a structural path (drawn as an arrow onto that arrow). */
export interface Moderation {
  id: string;
  moderator: string;
  path: string;
  /** PLS-SEM, seminr: interaction_term(method = …); absent = two_stage. cSEM and CB-SEM have their own single approach. */
  method?: InteractionMethod;
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
  /** CB-SEM, several groups: a value or label per group (lavaan c(...)) instead of `fixed` / `label`. */
  byGroup?: GroupValue[];
  /** CB-SEM specification search (as Amos): the covariance may be dropped (fixed at zero). */
  optional?: true;
}

/**
 * CB-SEM: a variance, an indicator's intercept or a threshold held at a value or labelled (lavaan f1 ~~ 1*f1,
 * y1 ~~ ve1*y1, y1 ~ i*1, u1 | t*t1; Mplus f1@1, y1 (ve1), [y1] (i), [u1$1] (t)). `target`: a construct id
 * (its variance, or its disturbance's) or, with `indicator`, an indicator's name.
 */
/**
 * `kind: 'scale'`: an ordinal indicator's scale factor (delta parameterisation; lavaan ~*~, Mplus {u1}). `free`: written
 * out without a value or label, which frees a parameter lavaan fixes by default (an ordinal indicator's scale factor, or
 * its residual variance in the theta parameterisation; lavaan NA*, Mplus {u2} or u2).
 */
export interface ParameterTerm { id: string; kind: 'variance' | 'intercept' | 'threshold' | 'scale'; target: string; indicator?: boolean; threshold?: number; fixed?: number; label?: string; byGroup?: GroupValue[]; free?: true }

/**
 * CB-SEM: a direct effect on an indicator (lavaan y1 ~ x1; Mplus y1 ON x1), beside its loading: from a construct
 * or covariate (`from`, a construct id) to an indicator (`to`, its name), as in MIMIC models with direct effects.
 */
export interface IndicatorPath { id: string; from: string; to: string; fixed?: number; label?: string }

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

/**
 * One statement of a two-level model's between level as written in syntax (lavaan's level: 2 block): `lhs op rhs`,
 * each right-hand term a data column or a between-level factor, fixed at a value or labelled. `~1` is an intercept
 * or mean (its one term is named "1"). Names are column or factor names, not construct ids.
 */
export interface BetweenStatement { lhs: string; op: '=~' | '~' | '~~' | '~1'; rhs: { name: string; fixed?: number; label?: string }[] }

/** PLS-SEM: a Gaussian copula term for this path's predictor in its outcome's equation. */
export interface Copula { id: string; path: string }

/** A comment on the diagram; not part of the model. */
export interface Note { id: string; x: number; y: number; text: string }

export interface ModelState {
  notes?: Note[];
  constructs: Construct[];
  paths: Path[];
  moderations: Moderation[];
  copulas?: Copula[];
  correlations?: Correlation[];
  threeWay?: ThreeWay[];
  /** Indicators (data columns) treated as ordered categorical in CB-SEM (WLSMV). */
  ordered?: string[];
  defined?: DefinedParameter[];
  waldTests?: WaldTest[];
  /** CB-SEM (lavaan): inequality constraints on labelled parameters, one per line ("a > 0", "a < b"). */
  inequalities?: string;
  /** CB-SEM (lavaan): keep (residual) variances non-negative (bounds = "pos.var"). */
  positiveVariances?: boolean;
  /** CB-SEM (lavaan): standard errors from the observed information (Mplus's ML default); absent = lavaan's expected information. */
  information?: 'observed';
  /** CB-SEM (lavaan), WLSMV with ordinal indicators: 'lavaan': lavaan 0.7's standard errors (the observed information in the sandwich); absent: Mplus's (classic WLSMV, the expected information; the default, also for projects saved before the option). */
  wlsmvSe?: 'lavaan';
  /** CB-SEM (lavaan), WLSMV with ordinal indicators: the test statistic as Mplus's (lavaan mimic = "Mplus"; with groups its test-statistic options, the equalities unchanged). */
  mimic?: 'Mplus';
  /** CB-SEM (lavaan): the baseline of CFI and TLI. Absent: the covariances among exogenous observed variables stay free (Mplus; lavaan with fixed.x); 'independence': every variable uncorrelated (LISREL; lavaan when the syntax writes those covariances out). */
  baseline?: 'independence';
  /** CB-SEM (lavaan): 'wishart': χ² and standard errors with N − 1 and the covariance matrix as given (LISREL, EQS, Amos, CALIS, the sem package); absent: lavaan's normal likelihood with N. */
  likelihood?: 'wishart';
  /** CB-SEM (lavaan), covariance-matrix input: false fits the matrix as given instead of rescaling it by (N − 1)/N (lavaan's sample.cov.rescale = FALSE; Kline's scripts). */
  sampleCovRescale?: false;
  /** CB-SEM: multiple groups by a data column, with measurement invariance (constructs by id in `free`). */
  multigroup?: MultigroupSpec;
  /** CB-SEM: two-level model by a cluster column. */
  /** between: 'factors': each factor measured by the same indicators between clusters, regressed on `betweenCovariates` (cluster-level variables), as lavaan's tutorial model. */
  /** between: 'model': the between-level model as written in syntax (lavaan's level: 2 block, Mplus %BETWEEN%), `betweenModel`. */
  multilevel?: { column: string; between: 'same' | 'saturated' | 'factors' | 'model'; betweenCovariates?: string[]; betweenModel?: BetweenStatement[] };
  /** CB-SEM: sampling (survey) weights column. */
  weights?: string;
  /**
   * CB-SEM: sampling clusters of a complex design (lavaan's cluster = in a single-level model: cluster-robust
   * standard errors and, with MLR, a Yuan-Bentler scaled test, as Mplus TYPE = COMPLEX). Not a two-level model.
   */
  cluster?: string;
  /** CB-SEM: exploratory SEM blocks (construct ids) and their rotation. */
  /** `epsilon`: geomin's ε (lavaan's default 0.001; Mplus uses 0.0001 for two factors). */
  /** `orthogonal`: the rotation kept orthogonal (uncorrelated factors). A bifactor rotation's general factor is the block's first. */
  /** `invariant`: the blocks' loadings equal (the k-th indicators of the blocks alike), rotated jointly (geomin; Mplus ex. 5.26). */
  esem?: { blocks: { id: string; constructs: string[] }[]; rotation: EsemRotation; epsilon?: number; orthogonal?: boolean; invariant?: boolean };
  /**
   * CB-SEM (lavaan): the mean structure. `constant` is the triangle ("1") on the canvas; its
   * presence turns the mean structure on (every indicator intercept is estimated, lavaan's
   * default). `means` are its arrows: the latent mean of a construct, or the intercept of an
   * observed variable; free, fixed at a value, or labelled.
   */
  constant?: { x: number; y: number };
  means?: MeanTerm[];
  /** CB-SEM (lavaan): variances, indicator intercepts and thresholds held at values or labelled. */
  parameters?: ParameterTerm[];
  /** CB-SEM (lavaan), ordinal indicators: the theta parameterisation instead of delta (Mplus PARAMETERIZATION = THETA). */
  parameterization?: 'theta';
  /** CB-SEM: direct effects of constructs or covariates on indicators. */
  indicatorPaths?: IndicatorPath[];
}

/** An arrow from the constant: a latent mean (or an observed variable's intercept) of construct `target`. */
/** `bias`: the marker indicator's intercept fixed at this value instead of 0 (a known measurement bias; one value per group with groups). */
export interface MeanTerm { id: string; target: string; fixed?: number; label?: string; bias?: number | number[]; /** Values per group (lavaan c(...)): a number holds the mean in that group, null leaves it free. */ byGroup?: GroupValue[] }

/** Drop mean arrows whose construct is gone, and all of them without the constant. */
export function pruneMeans(model: ModelState): ModelState {
  if (!model.means?.length) return model;
  if (!model.constant) { const { means: _m, ...rest } = model; return rest; }
  const ids = new Set(model.constructs.map((c) => c.id));
  const means = model.means.filter((t) => ids.has(t.target));
  return means.length === model.means.length ? model : { ...model, means };
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
 * Pairs of exogenous constructs whose correlation is a modelling choice: two
 * latent constructs (not covariates), except factors of one ESEM block, which
 * the rotation correlates. Undrawn, such a pair is uncorrelated (CB-SEM: the
 * diagram is the model, as in AMOS).
 */
export function exogenousPairs(model: ModelState): [Construct, Construct][] {
  const endo = endogenousIds(model);
  const exo = model.constructs.filter((c) => !endo.has(c.id) && !c.covariate && (c.indicators.length > 0 || (c.components?.length ?? 0) > 0 || isBifactorGeneral(model, c.id)));
  const block = new Map((model.esem?.blocks ?? []).flatMap((b) => b.constructs.map((id) => [id, b.id] as const)));
  const out: [Construct, Construct][] = [];
  for (let i = 0; i < exo.length; i++) for (let j = i + 1; j < exo.length; j++) {
    const a = exo[i], b = exo[j];
    if (block.has(a.id) && block.get(a.id) === block.get(b.id)) continue;
    out.push([a, b]);
  }
  return out;
}

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
/** Construct pairs with a correlation record (drawn, or fixed at zero = confirmed uncorrelated). */
const recorded = (model: ModelState) => new Set((model.correlations ?? []).filter((k) => k.kind === 'construct').map((k) => pairKey(k.a, k.b)));

/** Exogenous pairs with no correlation drawn and not confirmed as uncorrelated. */
export function unconfirmedUncorrelated(model: ModelState): [Construct, Construct][] {
  const has = recorded(model);
  return exogenousPairs(model).filter(([a, b]) => !has.has(pairKey(a.id, b.id)));
}

/**
 * Projects from before correlations were explicit (file format 1): CB-SEM
 * estimated every undrawn exogenous pair, so draw them, keeping the results.
 */
export function makeCovariancesExplicit(model: ModelState): ModelState {
  const missing = unconfirmedUncorrelated(model);
  if (!missing.length) return model;
  return { ...model, correlations: [...(model.correlations ?? []), ...missing.map(([a, b]): Correlation => ({ id: newId('k'), kind: 'construct', a: a.id, b: b.id }))] };
}

/**
 * Covariances CB-SEM estimates or fixes without them being a choice: pairs of
 * observed covariates (fixed at their sample covariance, fixed.x) and factors
 * of one ESEM block (correlated by the rotation). Ids: `auto:<a>:<b>`.
 */
export function impliedCorrelations(model: ModelState): Correlation[] {
  const endo = endogenousIds(model);
  const exo = model.constructs.filter((c) => !endo.has(c.id) && (c.indicators.length > 0 || (c.components?.length ?? 0) > 0 || isBifactorGeneral(model, c.id)));
  const has = recorded(model);
  const block = new Map((model.esem?.blocks ?? []).flatMap((b) => b.constructs.map((id) => [id, b.id] as const)));
  const out: Correlation[] = [];
  for (let i = 0; i < exo.length; i++) for (let j = i + 1; j < exo.length; j++) {
    const a = exo[i], b = exo[j];
    const covariates = !!a.covariate && !!b.covariate;
    const rotated = !a.covariate && !b.covariate && block.has(a.id) && block.get(a.id) === block.get(b.id) && rotationCorrelates(model.esem!, a.id, b.id);
    if ((covariates || rotated) && !has.has(pairKey(a.id, b.id))) out.push({ id: `auto:${a.id}:${b.id}`, kind: 'construct', a: a.id, b: b.id });
  }
  return out;
}

/**
 * Whether an ESEM rotation correlates two factors of one block: not an orthogonal one, and a bifactor
 * rotation keeps its general factor (the block's first) uncorrelated with the specific factors.
 */
/** The general factor of a bifactor ESEM block (its first): it loads on every indicator of the block and needs none of its own. */
export function isBifactorGeneral(model: ModelState, id: string): boolean {
  return !!model.esem && BIFACTOR_ROTATIONS.includes(model.esem.rotation) && model.esem.blocks.some((b) => b.constructs[0] === id);
}

export function rotationCorrelates(esem: NonNullable<ModelState['esem']>, a: string, b: string): boolean {
  if (esem.rotation === 'varimax' || (esem.orthogonal && ORTHOGONALISABLE_ROTATIONS.includes(esem.rotation))) return false;
  if (!BIFACTOR_ROTATIONS.includes(esem.rotation)) return true;
  const general = esem.blocks.find((bl) => bl.constructs.includes(a))?.constructs[0];
  return a !== general && b !== general;
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
export type HocApproach = 'two_stage' | 'embedded' | 'repeated';
export const HOC_APPROACH_NAMES: Record<HocApproach, string> = { two_stage: 'two-stage (disjoint)', embedded: 'embedded two-stage', repeated: 'repeated indicators' };

export const DEFAULT_SETTINGS: Settings = {
  autoCalculate: false,
  method: 'pls',
  consistent: false,
  estimator: 'ML',
  engine: 'r',
  plsPackage: 'cSEM',
  plsApproach: 'PLS-PM',
  hocApproach: 'two_stage',
  figure: DEFAULT_FIGURE_STYLE,
  charts: DEFAULT_CHART_STYLE,
  scheme: 'path',
  maxIter: 300,
  stopExp: 7,
  missing: 'mean',
  miImputations: 20,
  miMethod: 'mice',
  miAuxiliary: [],
  miNominal: [],
  bootSamples: 1000,
  bootTails: 'two',
  bootInterval: 'percentile',
  seed: 1234,
  confidence: 0.95,
  probe: 'percentiles',
  hc: 'none',
  interaction: 'product',
  counterfactual: null,
};

let counter = 0;
export const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}`;

/**
 * The moderators' main effects on their outcomes that the diagram does not
 * draw (one per moderator and outcome); a quadratic term's main effect is the
 * moderated path itself.
 */
export function impliedMainEffects(model: ModelState): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = [];
  for (const mo of model.moderations ?? []) {
    const p = model.paths.find((q) => q.id === mo.path);
    if (!p || mo.moderator === p.from) continue;
    if (model.paths.some((q) => q.from === mo.moderator && q.to === p.to) || out.some((e) => e.from === mo.moderator && e.to === p.to)) continue;
    out.push({ from: mo.moderator, to: p.to });
  }
  return out;
}

/**
 * The intercepts the constant implies (estimated, not drawn): every indicator's,
 * except the marker of a construct whose latent mean is drawn free (its
 * intercept is fixed at 0 to identify the mean), as lavaan.R writes the model.
 * Observed covariates have no indicator boxes (their intercept is the sample
 * mean unless an arrow is drawn).
 */
export function impliedIntercepts(model: ModelState): { construct: string; indicator: string }[] {
  if (!model.constant) return [];
  const out: { construct: string; indicator: string }[] = [];
  const elsewhere = indicatorsDrawnElsewhere(model);
  for (const c of model.constructs) {
    if (c.covariate || c.components?.length) continue;
    const freeMean = (model.means ?? []).some((t) => t.target === c.id && t.fixed === undefined);
    // (one arrow per indicator, to the box that draws it)
    c.indicators.forEach((indicator, i) => { if (!(freeMean && i === 0) && !elsewhere.get(c.name)?.has(indicator)) out.push({ construct: c.id, indicator }); });
  }
  return out;
}

/**
 * The covariances to estimate (drawn correlations) or fix: confirmed and
 * undrawn pairs of exogenous latent constructs are uncorrelated (fixed at 0;
 * the diagram is the model).
 */
function covarianceSpec(model: ModelState, name: Map<string, string>): Pick<ModelSpec, 'covariances'> {
  const drawn = (model.correlations?.length ? pruneCorrelations(model).correlations! : []).map((k) => (k.kind === 'construct'
      ? { a: name.get(k.a)!, b: name.get(k.b)!, kind: 'construct' as const, ...(k.zero ? { zero: true } : {}), ...(k.fixed !== undefined ? { fixed: k.fixed } : k.label ? { label: k.label } : {}), ...(k.byGroup?.length && !k.zero ? { byGroup: k.byGroup } : {}) }
      : { a: k.a, b: k.b, kind: 'indicator' as const, ...(k.fixed !== undefined ? { fixed: k.fixed } : k.label ? { label: k.label } : {}), ...(k.byGroup?.length ? { byGroup: k.byGroup } : {}) }));
  const zeros = unconfirmedUncorrelated(model).map(([a, b]) => ({ a: name.get(a.id)!, b: name.get(b.id)!, kind: 'construct' as const, zero: true }));
  const all = [...drawn, ...zeros];
  return all.length ? { covariances: all } : {};
}

/**
 * An indicator of several factors is one variable, so it is drawn once: with the factor of fewest indicators (a bifactor
 * model's specific factor; the first of equals), and the others reach its box by an arrow. By construct name: the boxes
 * each construct leaves to another.
 */
export function indicatorsDrawnElsewhere(model: Pick<ModelState, 'constructs'>): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const eligible = model.constructs.filter((c) => c.type === 'factor' && !c.covariate && !c.components?.length);
  for (const name of sharedIndicators(model)) {
    const having = eligible.filter((c) => c.indicators.includes(name));
    const owner = having.reduce((a, b) => (b.indicators.length < a.indicators.length ? b : a));
    for (const c of having) if (c !== owner) out.set(c.name, (out.get(c.name) ?? new Set<string>()).add(name));
  }
  return out;
}

/** Why an indicator typed by name cannot be added to this construct (null: it can). Names need no data yet. */
export function indicatorNameError(name: string, c: Pick<Construct, 'indicators'>): string | null {
  const n = name.trim();
  if (!n) return 'Type the name of the data column.';
  if (n.length > 64) return 'A column name has at most 64 characters.';
  if (c.indicators.includes(n)) return `${n} is already an indicator of this construct.`;
  return null;
}

/** CB-SEM: indicators that load on several factors (outside ESEM blocks too: the A, C and E factors of a twin model). */
export function sharedIndicators(model: Pick<ModelState, 'constructs'>): Set<string> {
  const seen = new Set<string>(), shared = new Set<string>();
  for (const c of model.constructs) if (c.type === 'factor' && !c.covariate && !c.components?.length) for (const i of c.indicators) (seen.has(i) ? shared : seen).add(i);
  return shared;
}

export function toSpec(model: ModelState): ModelSpec {
  const name = new Map(model.constructs.map((c) => [c.id, c.name]));
  // (a factor of one indicator it shares with other factors is a factor, not the variable: it may be scaled by its variance)
  const shared = sharedIndicators(model);
  return {
    constructs: model.constructs.map((c) => ({
      name: c.name, type: c.type, mode: c.mode, indicators: c.indicators,
      ...(c.components?.length ? { components: c.components.map((id) => name.get(id) ?? id) } : {}),
      ...(c.components?.length && c.componentLoadings && Object.keys(c.componentLoadings).some((id) => c.components!.includes(id))
        ? { componentLoadings: Object.fromEntries(Object.entries(c.componentLoadings).filter(([id]) => c.components!.includes(id)).map(([id, v]) => [name.get(id) ?? id, v])) } : {}),
      ...(c.components?.length && c.markerFree ? { markerFree: true } : {}),
      ...(c.covariate ? { covariate: true } : {}),
      ...(c.reliability !== undefined && c.indicators.length === 1 && !c.covariate ? { reliability: c.reliability } : {}),
      ...(c.freeError && c.reliability === undefined && c.indicators.length === 1 && !c.covariate ? { freeError: true } : {}),
      ...(c.reliabilities && c.indicators.length > 1 && !c.covariate && Object.keys(c.reliabilities).some((k) => c.indicators.includes(k))
        ? { reliabilities: Object.fromEntries(Object.entries(c.reliabilities).filter(([k]) => c.indicators.includes(k))) } : {}),
      ...(c.dominant && c.indicators.includes(c.dominant) ? { dominant: c.dominant } : {}),
      ...(c.predefinedWeights ? { predefinedWeights: Object.fromEntries(c.indicators.map((i) => [i, c.predefinedWeights![i] ?? 0])) } : {}),
      ...(c.categorical && c.indicators.length === 1 ? { categorical: true } : {}),
      ...(c.fixedLoadings && Object.keys(c.fixedLoadings).length ? { fixedLoadings: c.fixedLoadings } : {}),
      ...(c.loadingLabels && Object.keys(c.loadingLabels).length ? { loadingLabels: c.loadingLabels } : {}),
      ...(c.scaling === 'variance' && (c.indicators.length > 1 || shared.has(c.indicators[0])) && !c.covariate && !c.components?.length ? { scaling: 'variance' as const } : {}),
    })),
    paths: [
      ...model.paths.map((p) => ({ from: name.get(p.from)!, to: name.get(p.to)!, ...(p.fixed !== undefined ? { fixed: p.fixed } : p.label ? { label: p.label } : {}) })),
      // A moderation implies the moderator's main effect on the outcome (the convention, as in PROCESS):
      // estimated with the model even when it is not drawn.
      ...impliedMainEffects(model).map((e) => ({ from: name.get(e.from)!, to: name.get(e.to)! })),
    ],
    ...constraintSpec(model),
    ...(model.multilevel ? { multilevel: model.multilevel } : {}),
    ...(model.weights ? { weights: model.weights } : {}),
    ...(model.cluster ? { cluster: model.cluster } : {}),
    ...(model.esem?.blocks.length ? { esem: { rotation: model.esem.rotation, blocks: model.esem.blocks.map((b) => b.constructs.map((id) => name.get(id) ?? id)), ...(model.esem.epsilon !== undefined ? { epsilon: model.esem.epsilon } : {}), ...(model.esem.orthogonal && ORTHOGONALISABLE_ROTATIONS.includes(model.esem.rotation) ? { orthogonal: true } : {}), ...(model.esem.invariant ? { invariant: true } : {}) } } : {}),
    ...(model.information ? { information: model.information } : {}),
    ...(model.wlsmvSe ? { wlsmvSe: model.wlsmvSe } : {}),
    ...(model.mimic ? { mimic: model.mimic } : {}),
    ...(model.baseline ? { baseline: model.baseline } : {}),
    ...(model.likelihood ? { likelihood: model.likelihood } : {}),
    ...(model.sampleCovRescale === false ? { sampleCovRescale: false as const } : {}),
    ...(model.multigroup ? {
      multigroup: {
        ...model.multigroup,
        free: model.multigroup.free.map((f) => (f.kind === 'loading' || f.kind === 'mean' ? { ...f, construct: name.get(f.construct) ?? f.construct }
          : f.kind === 'regression' ? { ...f, from: name.get(f.from) ?? f.from, to: name.get(f.to) ?? f.to } : f)),
      },
    } : {}),
    ...(model.constant ? {
      meanStructure: true,
      means: (model.means ?? []).flatMap((t) => (name.has(t.target) ? [{ construct: name.get(t.target)!, ...(t.byGroup?.length ? { byGroup: t.byGroup } : t.fixed !== undefined ? { fixed: t.fixed } : t.label ? { label: t.label } : {}), ...(t.bias !== undefined ? { bias: t.bias } : {}) }] : [])),
    } : {}),
    moderations: (model.moderations ?? []).flatMap((mo) => {
      const p = model.paths.find((q) => q.id === mo.path);
      return p ? [{ from: name.get(p.from)!, moderator: name.get(mo.moderator)!, to: name.get(p.to)!, ...(mo.method ? { method: mo.method } : {}) }] : [];
    }),
    ...(model.threeWay?.length ? {
      threeWay: model.threeWay.flatMap((t) => {
        const mo = model.moderations.find((x) => x.id === t.moderation);
        const p = mo && model.paths.find((q) => q.id === mo.path);
        return mo && p ? [{ from: name.get(p.from)!, moderator: name.get(mo.moderator)!, moderator2: name.get(t.moderator)!, to: name.get(p.to)! }] : [];
      }),
    } : {}),
    ...(model.copulas?.length ? {
      copulas: model.copulas.flatMap((k) => {
        const p = model.paths.find((q) => q.id === k.path);
        return p ? [{ from: name.get(p.from)!, to: name.get(p.to)! }] : [];
      }),
    } : {}),
    ...(model.ordered?.length ? { ordered: model.ordered.filter((i) => model.constructs.some((c) => c.indicators.includes(i))) } : {}),
    ...covarianceSpec(model, name),
    ...parameterSpec(model, name),
    ...(model.indicatorPaths?.some((p) => name.has(p.from) && model.constructs.some((c) => c.indicators.includes(p.to)))
      ? { indicatorPaths: model.indicatorPaths.filter((p) => name.has(p.from) && model.constructs.some((c) => c.indicators.includes(p.to)))
        .map((p) => ({ from: name.get(p.from)!, to: p.to, ...(p.fixed !== undefined ? { fixed: p.fixed } : p.label ? { label: p.label } : {}) })) } : {}),
    ...(model.parameterization ? { parameterization: model.parameterization } : {}),
  };
}

/** Variances, intercepts and thresholds held or labelled, by construct name (terms whose construct or indicator is gone are dropped). */
function parameterSpec(model: ModelState, name: Map<string, string>): Pick<ModelSpec, 'parameters'> {
  const assigned = new Set(model.constructs.flatMap((c) => c.indicators));
  const parameters = (model.parameters ?? []).flatMap((t) => {
    if (t.indicator ? !assigned.has(t.target) : (t.kind !== 'variance' || !name.has(t.target))) return [];
    return [{ kind: t.kind, target: t.indicator ? t.target : name.get(t.target)!, ...(t.indicator ? { indicator: true } : {}), ...(t.threshold !== undefined ? { threshold: t.threshold } : {}),
      ...(t.byGroup?.length ? { byGroup: t.byGroup } : t.fixed !== undefined ? { fixed: t.fixed } : t.label ? { label: t.label } : t.free ? { free: true as const } : {}) }];
  });
  return parameters.length ? { parameters } : {};
}

/** Every label in use, with the parameters carrying it. */
export function labelUses(model: ModelState): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const add = (l: string | undefined, what: string) => { if (l) out.set(l, [...(out.get(l) ?? []), what]); };
  const name = (id: string) => model.constructs.find((c) => c.id === id)?.name ?? id;
  for (const p of model.paths) if (p.fixed === undefined) add(p.label, `${name(p.from)} → ${name(p.to)}`);
  for (const c of model.constructs) for (const [ind, l] of Object.entries(c.loadingLabels ?? {})) if (c.fixedLoadings?.[ind] === undefined) add(l, `${c.name} → ${ind}`);
  for (const k of model.correlations ?? []) if (k.fixed === undefined && !k.zero) add(k.label, `${k.kind === 'construct' ? name(k.a) : k.a} ↔ ${k.kind === 'construct' ? name(k.b) : k.b}`);
  for (const k of model.correlations ?? []) if (!k.zero) for (const v of k.byGroup ?? []) if (typeof v === 'string') add(v, `${k.kind === 'construct' ? name(k.a) : k.a} ↔ ${k.kind === 'construct' ? name(k.b) : k.b}`);
  for (const p of model.indicatorPaths ?? []) if (p.fixed === undefined) add(p.label, `${name(p.from)} → ${p.to}`);
  for (const t of model.parameters ?? []) {
    const what = t.kind === 'variance' ? `variance of ${t.indicator ? t.target : name(t.target)}` : t.kind === 'intercept' ? `intercept of ${t.target}` : t.kind === 'scale' ? `scale factor of ${t.target}` : `threshold ${t.threshold ?? 1} of ${t.target}`;
    if (t.byGroup?.length) { for (const v of t.byGroup) if (typeof v === 'string') add(v, what); } else if (t.fixed === undefined) add(t.label, what);
  }
  // (a between level as written: its labelled parameters, between clusters)
  if (model.multilevel?.between === 'model') for (const st of model.multilevel.betweenModel ?? []) for (const t of st.rhs) if (t.fixed === undefined) add(t.label, `${st.lhs} ${st.op === '~1' ? '~ 1' : `${st.op} ${t.name}`} (between)`);
  return out;
}

const hypotheses = (t: WaldTest) => t.constraints.split('\n').map((x) => x.trim()).filter(Boolean);
const inequalityLines = (model: ModelState) => (model.inequalities ?? '').split('\n').map((x) => x.trim()).filter(Boolean);

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
  for (const line of inequalityLines(model)) {
    try {
      // (an equality constraint, left == right, is written on the same list: lavaan's ==)
      const c = line.includes('==') ? parseConstraint(line) : parseInequality(line);
      const unknown = [...namesIn(c.left), ...namesIn(c.right)].filter((n) => !known.has(n));
      if (unknown.length) errs.push(`${line.includes('==') ? 'Constraint' : 'Inequality'} “${line}”: ${unknown.join(', ')} ${unknown.length === 1 ? 'is' : 'are'} not a label or defined parameter.`);
    } catch (x) { errs.push(`${line.includes('==') ? 'Constraint' : 'Inequality'} “${line}”: ${(x as Error).message}`); }
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
function constraintSpec(model: ModelState): Pick<ModelSpec, 'defined' | 'waldTests' | 'inequalities' | 'equalities' | 'positiveVariances'> {
  const bounds = model.positiveVariances ? { positiveVariances: true } : {};
  if (!(model.defined?.length || model.waldTests?.length || inequalityLines(model).length) || constraintErrors(model).length) return bounds;
  return {
    ...bounds,
    ...(inequalityLines(model).some((l) => !l.includes('==')) ? { inequalities: inequalityLines(model).filter((l) => !l.includes('==')).map((line) => { const c = parseInequality(line); return `${exprToR(c.left)} ${c.op} ${exprToR(c.right)}`; }) } : {}),
    ...(inequalityLines(model).some((l) => l.includes('==')) ? { equalities: inequalityLines(model).filter((l) => l.includes('==')).map((line) => { const c = parseConstraint(line); return `${exprToR(c.left)} == ${exprToR(c.right)}`; }) } : {}),
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
export const usesConstraints = (model: ModelState) => labelUses(model).size > 0 || !!model.defined?.length || !!model.waldTests?.length || inequalityLines(model).length > 0 || !!model.positiveVariances;

export interface Issue {
  level: 'error' | 'warning';
  message: string;
  constructId?: string;
  /** Exogenous constructs left uncorrelated (no correlation drawn): offer to correlate them or confirm. */
  action?: 'exogenous-correlations';
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

/** The checks run before anything is estimated (validate.ts). */
export { validateModel, type ValidateSettings } from './validate';


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
function parseComputed(raw: unknown, names: string[]): { computed?: { name: string; expr: string }[] } {
  if (!Array.isArray(raw)) return {};
  const out = raw.filter((r): r is Record<string, unknown> => isObj(r)).map((r) => ({ name: str(r.name, 64), expr: str(r.expr, 500) }))
    .filter((r) => r.name && r.expr && names.includes(r.name));
  return out.length ? { computed: out } : {};
}

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
    ...parseComputed(d.info.computed, names),
    ...(parseDroppedRows(d.info.droppedRows, names) ? { droppedRows: parseDroppedRows(d.info.droppedRows, names) } : {}),
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
export function parseMoments(raw: unknown, p: number): MomentData {
  if (typeof raw !== 'object' || raw === null) throw new Error('Invalid covariance-matrix data.');
  const r = raw as Record<string, unknown>;
  // Several groups (a stacked model): each its own matrix and N; S and n are recomputed from them (pooled, total).
  if (r.groups !== undefined && r.groups !== null) {
    if (!Array.isArray(r.groups) || r.groups.length < 2 || r.groups.length > 20) throw new Error('Invalid covariance-matrix data: expected 2 to 20 groups.');
    const groups: MomentGroup[] = r.groups.map((g: unknown, i: number) => {
      if (!isObj(g)) throw new Error('Invalid covariance-matrix data: malformed group.');
      const { S, n, means } = parseMoments({ S: g.S, n: g.n, means: g.means }, p);
      const label = typeof g.label === 'string' && g.label.trim() ? g.label.trim().slice(0, 60) : `Group ${i + 1}`;
      return { label, S, n, ...(means ? { means } : {}) };
    });
    if (new Set(groups.map((g) => g.label)).size !== groups.length) throw new Error('Invalid covariance-matrix data: group labels must differ.');
    if (groups.some((g) => g.means) && !groups.every((g) => g.means)) throw new Error('Invalid covariance-matrix data: either every group has means or none.');
    return { ...pooledMoments(groups), groups };
  }
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
  let means: number[] | undefined;
  if (r.means !== undefined && r.means !== null) {
    if (!Array.isArray(r.means) || r.means.length !== p || r.means.some((v) => typeof v !== 'number' || !Number.isFinite(v))) throw new Error(`Invalid means: expected ${p} numbers.`);
    means = r.means as number[];
  }
  return { S, n, ...(nacov ? { nacov } : {}), ...(means ? { means } : {}) };
}

/**
 * Project file format. 2: a correlation between exogenous constructs is
 * estimated only when drawn (1: CB-SEM estimated undrawn pairs too).
 */
export const FORMAT_VERSION = 2;

export interface ProjectFile {
  format: 'pls-studio';
  version: typeof FORMAT_VERSION;
  model: ModelState;
  settings: Settings;
  data: { info: DataInfo; names: string[]; columns: (number | null)[][]; moments?: MomentData } | null;
  simulation?: McDesign | null;
  /** The Analyses tab: cards in order (validated by analyses/persist.ts). */
  analyses?: unknown[];
}

export function serializeProject(model: ModelState, settings: Settings, data: Dataset | null, info: DataInfo | null, simulation: McDesign | null = null, analyses: unknown[] = []): string {
  const file: ProjectFile = {
    format: 'pls-studio',
    version: FORMAT_VERSION,
    model,
    settings,
    data: data && info ? serializeDataSection(data, info) : null,
    simulation,
    ...(analyses.length ? { analyses } : {}),
  };
  return JSON.stringify(file);
}

const str = (v: unknown, max = 200): string => {
  if (typeof v !== 'string') throw new Error('Invalid project file.');
  return v.slice(0, max);
};
/** A fixed parameter value from a file: a finite number of sensible size. */
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e6;
const LEVELS: InvarianceLevel[] = ['configural', 'metric', 'scalar', 'strict'];
/** A saved between-level model (two-level syntax): well-formed statements only, names as plain identifiers. */
export function parseBetweenModel(v: unknown): BetweenStatement[] {
  if (!Array.isArray(v)) return [];
  const ident = (x: unknown): x is string => typeof x === 'string' && /^[A-Za-z_.][A-Za-z0-9_.]{0,199}$/.test(x);
  const ops: BetweenStatement['op'][] = ['=~', '~', '~~', '~1'];
  const obj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
  return v.slice(0, 500).filter(obj)
    .filter((st) => ident(st.lhs) && ops.includes(st.op as BetweenStatement['op']) && Array.isArray(st.rhs))
    .map((st) => ({
      lhs: st.lhs as string, op: st.op as BetweenStatement['op'],
      rhs: (st.rhs as unknown[]).slice(0, 200).filter(obj).filter((t) => (st.op === '~1' ? t.name === '1' : ident(t.name)))
        .map((t) => ({ name: t.name as string, ...(typeof t.fixed === 'number' && Number.isFinite(t.fixed) ? { fixed: t.fixed } : {}), ...(ident(t.label) ? { label: t.label } : {}) })),
    }))
    .filter((st) => st.rhs.length > 0);
}

function parseMultigroup(r: Record<string, unknown>, ids: Set<string>): MultigroupSpec {
  const free = (Array.isArray(r.free) ? r.free.slice(0, 1000) : []).filter(isObj).flatMap((f: Record<string, unknown>): FreedParameter[] => {
    if (f.kind === 'loading' && typeof f.construct === 'string' && ids.has(f.construct) && typeof f.indicator === 'string') return [{ kind: 'loading' as const, construct: f.construct, indicator: str(f.indicator) }];
    if (f.kind === 'intercept' && typeof f.indicator === 'string') return [{ kind: 'intercept' as const, indicator: str(f.indicator) }];
    if (f.kind === 'regression' && typeof f.from === 'string' && typeof f.to === 'string' && ids.has(f.from) && ids.has(f.to)) return [{ kind: 'regression' as const, from: f.from, to: f.to }];
    if (f.kind === 'mean' && typeof f.construct === 'string' && ids.has(f.construct)) return [{ kind: 'mean' as const, construct: f.construct }];
    return [];
  });
  const STRUCTURAL: StructuralEquality[] = ['regressions', 'lv.variances', 'lv.covariances', 'means'];
  const structural = Array.isArray(r.structural) ? STRUCTURAL.filter((k) => (r.structural as unknown[]).includes(k)) : [];
  return { column: str(r.column), invariance: LEVELS.find((l) => l === r.invariance) ?? 'configural', free, ...(structural.length ? { structural } : {}), ...(r.meanStructure === false ? { meanStructure: false as const } : {}), ...(r.ordinalScales === 'free' ? { ordinalScales: 'free' as const } : {}) };
}

/** A parameter label from a file (validated again before use). */
const labelOf = (v: unknown): { label?: string } => (typeof v === 'string' && v.trim() ? { label: v.trim().slice(0, 31) } : {});
/** Values per group from a file: numbers, labels (validated again before use) or null (free). */
const byGroupOf = (v: unknown): { byGroup?: GroupValue[] } => (Array.isArray(v) && v.length >= 1 && v.length <= 50 && v.every((x) => x === null || finite(x) || (typeof x === 'string' && x.trim()))
  ? { byGroup: v.map((x) => (typeof x === 'string' ? x.trim().slice(0, 31) : x as number | null)) } : {});
function componentLoadingsOf(raw: unknown, components: unknown[]): { componentLoadings?: Record<string, number> } {
  if (!isObj(raw)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw)) if (components.includes(k) && typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  return Object.keys(out).length ? { componentLoadings: out } : {};
}
function reliabilitiesOf(raw: unknown, indicators: unknown[]): { reliabilities?: Record<string, number> } {
  if (!isObj(raw)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw)) if (indicators.includes(k) && typeof v === 'number' && v > 0 && v <= 1) out[k] = v;
  return Object.keys(out).length ? { reliabilities: out } : {};
}
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

/** Parse and strictly validate an untrusted project file. */
export function parseProject(text: string): { model: ModelState; settings: Settings; data: Dataset | null; info: DataInfo | null; simulation: McDesign | null; analyses: unknown[] } {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error('The file is not valid JSON.'); }
  if (!isObj(raw) || raw.format !== 'pls-studio' || (raw.version !== 1 && raw.version !== FORMAT_VERSION)) throw new Error('Not a PLS Studio project file (or an unsupported version).');
  const model = parseModelState(raw.model);
  const settings = parseSettings(raw.settings);
  const { data, info } = isObj(raw.data) ? parseDataSection(raw.data) : { data: null, info: null };
  return {
    // Format 1 estimated every undrawn exogenous pair in CB-SEM: draw those correlations (same results).
    model: raw.version === 1 ? makeCovariancesExplicit(model) : model,
    settings, data, info, simulation: raw.simulation ? parseDesign(raw.simulation) : null,
    analyses: Array.isArray(raw.analyses) ? raw.analyses.slice(0, 200) : [],
  };
}

/** Parse and strictly validate an untrusted model (a project file's, or one kept in a model-run card). */
export function parseModelState(m: unknown): ModelState {
  if (!isObj(m) || !Array.isArray(m.constructs) || !Array.isArray(m.paths)) throw new Error('Invalid project file: model missing.');
  if (m.constructs.length > 500 || m.paths.length > 5000) throw new Error('Project is too large.');
  const sides: Side[] = ['left', 'right', 'top', 'bottom'];
  const constructs: Construct[] = m.constructs.map((c: unknown) => {
    if (!isObj(c) || !Array.isArray(c.indicators)) throw new Error('Invalid construct in project file.');
    const mode: Mode = c.mode === 'B' || c.mode === 'unit' ? c.mode : 'A';
    return {
      id: str(c.id, 64),
      name: str(c.name, 100),
      // Files from before construct types existed: Mode B meant formative/composite.
      type: c.type === 'composite' || c.type === 'factor' ? c.type : mode === 'B' ? 'composite' : 'factor',
      mode,
      indicators: c.indicators.slice(0, 1000).map((i: unknown) => str(i)),
      x: clampStrict(c.x, -1e6, 1e6, 0),
      y: clampStrict(c.y, -1e6, 1e6, 0),
      side: sides.includes(c.side as Side) ? (c.side as Side) : 'left',
      ...(Array.isArray(c.components) && c.components.length ? { components: c.components.slice(0, 100).map((x: unknown) => str(x, 64)) } : {}),
      ...(componentLoadingsOf(c.componentLoadings, Array.isArray(c.components) ? c.components : [])),
      ...(c.markerFree === true && Array.isArray(c.components) && c.components.length ? { markerFree: true } : {}),
      ...(c.covariate === true ? { covariate: true } : {}),
      ...(typeof c.reliability === 'number' && c.reliability > 0 && c.reliability <= 1 ? { reliability: c.reliability } : {}),
      ...(c.freeError === true ? { freeError: true } : {}),
      ...(reliabilitiesOf(c.reliabilities, c.indicators as unknown[])),
      ...(typeof c.dominant === 'string' && (c.indicators as unknown[]).includes(c.dominant) ? { dominant: c.dominant } : {}),
      ...(c.shape === 'rectangle' || c.shape === 'octagon' ? { shape: c.shape } : {}),
      ...(typeof c.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(c.color) ? { color: c.color } : {}),
      ...(isObj(c.predefinedWeights) ? { predefinedWeights: Object.fromEntries((c.indicators as string[]).map((i) => { const v = (c.predefinedWeights as Record<string, unknown>)[i]; return [i, typeof v === 'number' && Number.isFinite(v) ? v : 0]; })) } : {}),
      ...(c.latent === true ? { latent: true } : {}),
      ...((['indicator', 'sequential', 'helmert', 'effect'] as const).includes(c.categorical as 'indicator') ? { categorical: c.categorical as 'indicator' } : {}),
      ...(fixedLoadingsOf(c.fixedLoadings, c.indicators as unknown[])),
      ...(loadingLabelsOf(c.loadingLabels, c.indicators as unknown[])),
      ...(c.scaling === 'variance' ? { scaling: 'variance' as const } : {}),
    };
  });
  const ids = new Set(constructs.map((c) => c.id));
  if (ids.size !== constructs.length) throw new Error('Invalid project file: duplicate construct ids.');
  for (const c of constructs) if (c.components?.some((x) => !ids.has(x) || x === c.id)) throw new Error('Invalid project file: higher-order construct refers to an unknown component.');
  const paths: Path[] = m.paths.map((p: unknown) => {
    if (!isObj(p)) throw new Error('Invalid path in project file.');
    const path = { id: str(p.id, 64), from: str(p.from, 64), to: str(p.to, 64), ...(finite(p.fixed) ? { fixed: p.fixed } : {}), ...(labelOf(p.label)), ...(p.line === 'dashed' || p.line === 'dotted' ? { line: p.line as 'dashed' | 'dotted' } : {}), ...(p.curved === true ? { curved: true } : {}), ...(p.optional === true ? { optional: true as const } : {}) };
    if (!ids.has(path.from) || !ids.has(path.to)) throw new Error('Invalid project file: path references unknown construct.');
    return path;
  });

  const pathIds = new Set(paths.map((p) => p.id));
  const rawMods = Array.isArray(m.moderations) ? m.moderations.slice(0, 1000) : [];
  const moderations: Moderation[] = rawMods.map((mo: unknown) => {
    if (!isObj(mo)) throw new Error('Invalid moderation in project file.');
    const out: Moderation = { id: str(mo.id, 64), moderator: str(mo.moderator, 64), path: str(mo.path, 64), ...(mo.method === 'orthogonal' || mo.method === 'product_indicator' ? { method: mo.method } : {}) };
    if (!ids.has(out.moderator) || !pathIds.has(out.path)) throw new Error('Invalid project file: moderation references unknown construct or path.');
    return out;
  });
  const modIds = new Set(moderations.map((mo) => mo.id));
  const notes: Note[] = (Array.isArray(m.notes) ? m.notes.slice(0, 1000) : []).flatMap((k: unknown) => (isObj(k) && finite(k.x) && finite(k.y) && typeof k.text === 'string' ? [{ id: str(k.id, 64), x: k.x, y: k.y, text: k.text.slice(0, 5000) }] : []));
  const rawCopulas = Array.isArray(m.copulas) ? m.copulas.slice(0, 1000) : [];
  const copulas: Copula[] = rawCopulas.map((k: unknown) => {
    if (!isObj(k)) throw new Error('Invalid Gaussian copula in project file.');
    const out: Copula = { id: str(k.id, 64), path: str(k.path, 64) };
    if (!pathIds.has(out.path)) throw new Error('Invalid project file: Gaussian copula references an unknown path.');
    return out;
  });
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
    const out: Correlation = { id: str(k.id, 64), kind: k.kind, a: str(k.a), b: str(k.b), ...(k.zero === true && k.kind === 'construct' ? { zero: true } : {}), ...(finite(k.fixed) ? { fixed: k.fixed } : {}), ...(labelOf(k.label)), ...(byGroupOf(k.byGroup)), ...(k.optional === true && k.zero !== true ? { optional: true as const } : {}) };
    const known = out.kind === 'construct' ? ids : indicatorNames;
    if (!known.has(out.a) || !known.has(out.b) || out.a === out.b) throw new Error('Invalid project file: correlation references an unknown construct or indicator.');
    return out;
  });
  return {
      constructs, paths, moderations, ...(notes.length ? { notes } : {}), ...(copulas.length ? { copulas } : {}), ...(correlations.length ? { correlations } : {}), ...(threeWay.length ? { threeWay } : {}),
      ...(Array.isArray(m.ordered) && m.ordered.length ? { ordered: [...new Set(m.ordered.slice(0, 5000).map((x: unknown) => str(x)))] } : {}),
      ...(Array.isArray(m.defined) && m.defined.length ? { defined: m.defined.slice(0, 200).filter(isObj).map((d: Record<string, unknown>) => ({ id: str(d.id, 64), name: str(d.name, 31), expr: str(d.expr, 500) })) } : {}),
      ...(isObj(m.multigroup) && typeof m.multigroup.column === 'string' ? { multigroup: parseMultigroup(m.multigroup, ids) } : {}),
      ...(typeof m.weights === 'string' && m.weights ? { weights: str(m.weights) } : {}),
      ...(typeof m.cluster === 'string' && m.cluster ? { cluster: str(m.cluster) } : {}),
      ...(isObj(m.multilevel) && typeof m.multilevel.column === 'string' ? { multilevel: {
        column: str(m.multilevel.column), between: m.multilevel.between === 'same' ? 'same' as const : m.multilevel.between === 'factors' ? 'factors' as const
          : m.multilevel.between === 'model' && parseBetweenModel(m.multilevel.betweenModel).length ? 'model' as const : 'saturated' as const,
        ...(m.multilevel.between === 'factors' && Array.isArray(m.multilevel.betweenCovariates) && m.multilevel.betweenCovariates.length
          ? { betweenCovariates: [...new Set((m.multilevel.betweenCovariates as unknown[]).slice(0, 100).filter((x): x is string => typeof x === 'string').map((x) => x.slice(0, 200)))] } : {}),
        ...(m.multilevel.between === 'model' && parseBetweenModel(m.multilevel.betweenModel).length ? { betweenModel: parseBetweenModel(m.multilevel.betweenModel) } : {}),
      } } : {}),
      ...(isObj(m.esem) && Array.isArray(m.esem.blocks) ? { esem: {
        rotation: (['geomin', 'oblimin', 'quartimin', 'varimax', 'target', 'bigeomin', 'biquartimin'] as const).find((r) => r === (m.esem as Record<string, unknown>).rotation) ?? 'geomin',
        blocks: m.esem.blocks.slice(0, 50).filter(isObj).map((b: Record<string, unknown>) => ({ id: str(b.id, 64), constructs: (Array.isArray(b.constructs) ? b.constructs : []).map((x: unknown) => str(x, 64)).filter((x: string) => ids.has(x)) })),
        ...(typeof m.esem.epsilon === 'number' && m.esem.epsilon > 0 && m.esem.epsilon <= 1 ? { epsilon: m.esem.epsilon } : {}),
        ...(m.esem.orthogonal === true ? { orthogonal: true } : {}),
        ...(m.esem.invariant === true ? { invariant: true } : {}),
      } } : {}),
      ...(m.information === 'observed' ? { information: 'observed' as const } : {}),
      ...(m.wlsmvSe === 'lavaan' ? { wlsmvSe: 'lavaan' as const } : {}),
      ...(m.mimic === 'Mplus' ? { mimic: 'Mplus' as const } : {}),
      ...(m.baseline === 'independence' ? { baseline: 'independence' as const } : {}),
      ...(m.likelihood === 'wishart' ? { likelihood: 'wishart' as const } : {}),
      ...(m.sampleCovRescale === false ? { sampleCovRescale: false as const } : {}),
      ...(typeof m.inequalities === 'string' && m.inequalities.trim() ? { inequalities: str(m.inequalities, 2000) } : {}),
      ...(m.positiveVariances === true ? { positiveVariances: true } : {}),
      ...(m.parameterization === 'theta' ? { parameterization: 'theta' as const } : {}),
      ...(Array.isArray(m.indicatorPaths) && m.indicatorPaths.length ? { indicatorPaths: m.indicatorPaths.slice(0, 2000).filter(isObj).flatMap((p: Record<string, unknown>): IndicatorPath[] => {
        const from = str(p.from, 64), to = str(p.to, 200);
        return ids.has(from) && indicatorNames.has(to) ? [{ id: str(p.id, 64), from, to, ...(finite(p.fixed) ? { fixed: p.fixed } : {}), ...(labelOf(p.label)) }] : [];
      }) } : {}),
      ...(Array.isArray(m.parameters) && m.parameters.length ? { parameters: m.parameters.slice(0, 2000).filter(isObj).flatMap((t: Record<string, unknown>): ParameterTerm[] => {
        if (t.kind !== 'variance' && t.kind !== 'intercept' && t.kind !== 'threshold' && t.kind !== 'scale') return [];
        const indicator = t.indicator === true || t.kind !== 'variance';
        const target = str(t.target, 200);
        if (indicator ? !indicatorNames.has(target) : !ids.has(target)) return [];
        return [{ id: str(t.id, 64), kind: t.kind, target, ...(indicator ? { indicator: true } : {}), ...(t.kind === 'threshold' && finite(t.threshold) && t.threshold >= 1 && t.threshold <= 50 ? { threshold: Math.round(t.threshold) } : {}),
          ...(finite(t.fixed) ? { fixed: t.fixed } : {}), ...(labelOf(t.label)), ...(byGroupOf(t.byGroup)), ...(t.free === true ? { free: true as const } : {}) }];
      }) } : {}),
      ...(Array.isArray(m.waldTests) && m.waldTests.length ? { waldTests: m.waldTests.slice(0, 100).filter(isObj).map((t: Record<string, unknown>) => ({ id: str(t.id, 64), name: str(t.name, 100), constraints: str(t.constraints, 2000) })) } : {}),
      ...(isObj(m.constant) ? { constant: { x: clampStrict(m.constant.x, -1e6, 1e6, 0), y: clampStrict(m.constant.y, -1e6, 1e6, 0) } } : {}),
      ...(isObj(m.constant) && Array.isArray(m.means) && m.means.length ? { means: (() => {
        const seen = new Set<string>();
        return m.means!.slice(0, 500).filter(isObj).flatMap((t: Record<string, unknown>): MeanTerm[] => {
          const target = str(t.target, 64);
          if (!ids.has(target) || seen.has(target)) return [];
          seen.add(target);
          const bias = finite(t.bias) ? { bias: t.bias } : Array.isArray(t.bias) && t.bias.length >= 1 && t.bias.length <= 20 && t.bias.every(finite) ? { bias: t.bias as number[] } : {};
          return [{ id: str(t.id, 64), target, ...(finite(t.fixed) ? { fixed: t.fixed } : {}), ...(labelOf(t.label)), ...bias }];
        });
      })() } : {}),
  };
}

/** Parse and strictly validate untrusted settings (a project file's, or those kept in a model-run card); anything missing takes its default. */
export function parseSettings(raw: unknown): Settings {
  const s = isObj(raw) ? raw : {};
  return {
    method: s.method === 'cbsem' || s.method === 'process' ? s.method : 'pls',
    consistent: s.consistent === true,
    estimator: (['ML', 'MLM', 'MLMV', 'MLR', 'GLS', 'ULS', 'WLS', 'WLSMV', '2SLS', 'RML'] as const).find((e) => e === s.estimator) ?? 'ML',
    engine: s.engine === 'builtin' ? 'builtin' : 'r',
    plsPackage: s.plsPackage === 'seminr' ? 'seminr' : 'cSEM',
    plsApproach: (['GSCA', 'PCA', 'unit'] as const).find((x) => x === s.plsApproach) ?? 'PLS-PM',
    hocApproach: (['embedded', 'repeated'] as const).find((x) => x === s.hocApproach) ?? 'two_stage',
    figure: parseFigureStyle(s.figure),
    ...(parseEfaDesign(s.efa) ? { efa: parseEfaDesign(s.efa) } : {}),
    charts: parseChartStyle(s.charts),
    scheme: s.scheme === 'factor' || s.scheme === 'centroid' ? s.scheme : 'path',
    maxIter: Math.round(clampStrict(s.maxIter, 10, 10000, DEFAULT_SETTINGS.maxIter)),
    stopExp: Math.round(clampStrict(s.stopExp, 3, 12, DEFAULT_SETTINGS.stopExp)),
    missing: (['casewise', 'fiml', 'mi', 'pairwise', 'twostage', 'robusttwostage'] as const).find((m) => m === s.missing) ?? 'mean',
    miImputations: Math.round(clampStrict(s.miImputations, 2, 200, DEFAULT_SETTINGS.miImputations)),
    miMethod: s.miMethod === 'amelia' || s.miMethod === 'micenorm' || s.miMethod === 'joint' ? s.miMethod : 'mice',
    miAuxiliary: Array.isArray(s.miAuxiliary) ? [...new Set(s.miAuxiliary.slice(0, 500).filter((x: unknown): x is string => typeof x === 'string').map((x: string) => x.slice(0, 200)))] : [],
    miNominal: Array.isArray(s.miNominal) ? [...new Set(s.miNominal.slice(0, 500).filter((x: unknown): x is string => typeof x === 'string').map((x: string) => x.slice(0, 200)))] : [],
    bootSamples: Math.round(clampStrict(s.bootSamples, 10, 100000, DEFAULT_SETTINGS.bootSamples)),
    autoCalculate: s.autoCalculate === true,
    bootTails: s.bootTails === 'one' ? 'one' : 'two',
    bootInterval: s.bootInterval === 'bca' || s.bootInterval === 'studentized' ? s.bootInterval : 'percentile',
    seed: Math.round(clampStrict(s.seed, 0, 2 ** 31, DEFAULT_SETTINGS.seed)),
    confidence: clampStrict(s.confidence, 0.5, 0.999, DEFAULT_SETTINGS.confidence),
    probe: s.probe === 'meansd' ? 'meansd' : 'percentiles',
    hc: (['HC0', 'HC1', 'HC2', 'HC3', 'HC4'] as const).find((h) => h === s.hc) ?? 'none',
    interaction: s.interaction === 'lms' || s.interaction === 'qml' ? s.interaction : 'product',
    counterfactual: isObj(s.counterfactual) && finite(s.counterfactual.xref) && finite(s.counterfactual.xcf) ? { xref: s.counterfactual.xref, xcf: s.counterfactual.xcf } : null,
  };
}
