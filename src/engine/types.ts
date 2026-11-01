/** PLS outer weighting: Mode A (correlation), Mode B (regression), or sum scores (unit weights; Henseler 2021, ADANCO). */
export type Mode = 'A' | 'B' | 'unit';
/** Common factor (latent variable, reflective) or composite (emergent variable). */
export type ConstructType = 'factor' | 'composite';
export type WeightingScheme = 'path' | 'factor' | 'centroid';
/**
 * 'fiml': full-information maximum likelihood; 'pairwise': pairwise deletion;
 * 'twostage' / 'robusttwostage': the two-stage approach (Savalei & Bentler 2009)
 * — CB-SEM through lavaan only. 'mi': multiple imputation (mice), pooled.
 */
export type MissingTreatment = 'mean' | 'casewise' | 'fiml' | 'mi' | 'pairwise' | 'twostage' | 'robusttwostage';
/** Missing-value treatments that lavaan applies itself (CB-SEM, R engine). */
export const LAVAAN_MISSING: readonly MissingTreatment[] = ['fiml', 'pairwise', 'twostage', 'robusttwostage'];

export interface ConstructSpec {
  name: string;
  /** Outer weighting mode used by PLS. */
  mode: Mode;
  /** Defaults to 'composite' for Mode B and 'factor' for Mode A. */
  type?: ConstructType;
  indicators: string[];
  /** Higher-order construct (CB-SEM): measured by these first-order constructs instead of indicators. */
  components?: string[];
  /** CB-SEM: loadings held at given values (by indicator name) instead of estimated; the marker's 1 can be replaced too. */
  fixedLoadings?: Record<string, number>;
  /** CB-SEM (lavaan): parameter labels of loadings (by indicator name); equal labels = equal values. */
  loadingLabels?: Record<string, string>;
  /** PLS: a categorical exogenous variable: its single column becomes k − 1 dummies forming a Mode B composite (engine/categorical.ts). */
  categorical?: boolean;
  /** PLS: the dominant indicator, which fixes the sign of the construct (its loading made positive; cSEM's .dominant_indicators). */
  dominant?: string;
  /** Observed exogenous covariate (single indicator, CB-SEM): variances/covariances fixed at sample values (lavaan fixed.x). */
  covariate?: boolean;
  /** CB-SEM (lavaan): a single indicator's known reliability; its error variance is fixed at (1 − reliability) × its variance. */
  reliability?: number;
  /** CB-SEM (lavaan): known reliabilities of some indicators of a multi-indicator factor (by indicator name), fixing their error variances likewise. */
  reliabilities?: Record<string, number>;
}

export interface PathSpec {
  from: string;
  to: string;
  /** CB-SEM: the coefficient is held at this value instead of estimated. */
  fixed?: number;
  /** CB-SEM (lavaan): parameter label; equal labels = equal values. */
  label?: string;
}

/** A moderator acting on the path from → to (two-stage interaction term). */
export interface ModerationSpec {
  from: string;
  moderator: string;
  to: string;
  /** PLS-SEM, seminr: interaction_term(method = …); absent = two_stage (results report two_stage explicitly). */
  method?: 'two_stage' | 'orthogonal' | 'product_indicator';
}

/**
 * A free covariance (CB-SEM double-headed arrow). Between constructs: the
 * covariance of their disturbances (exogenous constructs covary anyway).
 * Between indicators: correlated measurement errors.
 */
export interface CovarianceSpec {
  a: string;
  b: string;
  kind: 'construct' | 'indicator';
  /** Fixed at zero: two exogenous constructs that do not covary (otherwise they covary freely). */
  zero?: boolean;
  /** CB-SEM: a drawn covariance held at this value instead of estimated. */
  fixed?: number;
  /** CB-SEM (lavaan): parameter label; equal labels = equal values. */
  label?: string;
}

/** Name of an interaction term; a construct times itself is its quadratic term (X²). */
export const interactionName = (from: string, moderator: string) => (from === moderator ? `${from}²` : `${from} × ${moderator}`);

export type EsemRotation = 'geomin' | 'oblimin' | 'quartimin' | 'varimax' | 'target';
export type InvarianceLevel = 'configural' | 'metric' | 'scalar' | 'strict';
/** Parameters freed across groups despite the invariance level (partial invariance). */
export type FreedParameter = { kind: 'loading'; construct: string; indicator: string } | { kind: 'intercept'; indicator: string }
  | { kind: 'regression'; from: string; to: string } | { kind: 'mean'; construct: string };
/** Structural parameters held equal across groups (lavaan's group.equal): the paths, the constructs' variances, covariances, and means / intercepts (the constant drawn). */
export type StructuralEquality = 'regressions' | 'lv.variances' | 'lv.covariances' | 'means';
/**
 * Multiple groups: by a data column, or (column '') the groups of a dataset of
 * several covariance matrices (a stacked model). `invariance` is the measurement
 * level; `structural` what else is held equal; `free` the exceptions.
 */
export interface MultigroupSpec { column: string; invariance: InvarianceLevel; free: FreedParameter[]; structural?: StructuralEquality[] }

export interface ModelSpec {
  constructs: ConstructSpec[];
  paths: PathSpec[];
  moderations?: ModerationSpec[];
  covariances?: CovarianceSpec[];
  /** CB-SEM (lavaan): indicators treated as ordered categorical (thresholds, polychoric correlations, WLSMV). */
  ordered?: string[];
  /** CB-SEM (lavaan): defined parameters, name := expression (R syntax printed from a parsed expression). */
  defined?: { name: string; expr: string }[];
  /** CB-SEM (lavaan): Wald tests, each a set of hypotheses "left == right" (R syntax printed from parsed expressions). */
  waldTests?: { name: string; constraints: string[] }[];
  /** CB-SEM (lavaan): inequality constraints "left < right" / "left > right" (R syntax printed from parsed expressions). */
  inequalities?: string[];
  /** CB-SEM (lavaan): keep variances non-negative (bounds = "pos.var"). */
  positiveVariances?: boolean;
  /** CB-SEM (lavaan): multiple-group analysis by a grouping column, with a level of measurement invariance. */
  multigroup?: MultigroupSpec;
  /** CB-SEM (lavaan): sampling (survey) weights from this column (lavaan's sampling.weights; robust standard errors). */
  weights?: string;
  /** CB-SEM: sampling clusters in a single-level model (lavaan cluster =; cluster-robust standard errors). */
  cluster?: string;
  /** CB-SEM (lavaan): two-level model by a cluster column; between level saturated or with the same structure. */
  multilevel?: { column: string; between: 'same' | 'saturated' };
  /** CB-SEM (lavaan): exploratory SEM blocks (construct names), whose factors load on all the block's indicators, rotated. */
  esem?: { blocks: string[][]; rotation: EsemRotation };
  /** CB-SEM (lavaan): estimate the mean structure (meanstructure = TRUE: every indicator intercept free). */
  meanStructure?: boolean;
  /** CB-SEM (lavaan): latent means (or observed variables' intercepts) to estimate, fix or label. */
  /** `bias`: the marker indicator's intercept fixed at this value instead of 0 (a known measurement bias, Hayduk 1987); with groups one value per group. */
  means?: { construct: string; fixed?: number; label?: string; bias?: number | number[] }[];
}

/** Column-oriented numeric data; NaN marks a missing value. */
/** Summary-statistics input: unbiased covariance matrix (in `names` order), N, optional NACOV (Γ, vech order). */
export interface MomentData {
  S: number[][];
  n: number;
  nacov?: number[][];
  /** The variables' means (in `names` order): a mean structure can then be estimated from the matrix. */
  means?: number[];
  /** Several groups (a stacked model): each group's own covariance matrix and N; S and n are then the pooled matrix and the total. */
  groups?: MomentGroup[];
}
/** One group's summary statistics of a multiple-group (stacked) dataset. */
export interface MomentGroup { label: string; S: number[][]; n: number; means?: number[] }

export interface Dataset {
  names: string[];
  /** Raw data columns; empty when the dataset is a covariance matrix. */
  cols: Float64Array[];
  moments?: MomentData;
  /** Text (categorical) columns, coded 1, 2, ...: the category of each code (code k = labels[k - 1]). */
  categories?: Record<string, string[]>;
}

export interface PlsOptions {
  scheme: WeightingScheme;
  maxIter: number;
  /** Convergence threshold on the sum of absolute outer-weight changes. */
  tolerance: number;
  missing: MissingTreatment;
  /** Consistent PLS (PLSc): correct common factors for attenuation. */
  consistent: boolean;
  /** Multiple imputation (missing = 'mi', R engine): number of imputed data sets and seed. */
  mi?: { m: number; seed: number };
  /** Weighting approach (cSEM): PLS path modeling, or generalized structured component analysis (GSCA; Hwang & Takane 2004). */
  approach?: 'PLS-PM' | 'GSCA' | 'PCA' | 'unit';
  /** Second-order constructs: (disjoint) two-stage, embedded two-stage (cSEM "mixed") or repeated indicators. */
  hocApproach?: 'two_stage' | 'embedded' | 'repeated';
}

export const DEFAULT_OPTIONS: PlsOptions = {
  scheme: 'path',
  maxIter: 300,
  tolerance: 1e-7,
  missing: 'mean',
  consistent: false,
};

export interface Discrepancies {
  srmr: number;
  /** Unweighted least squares distance ½‖S − Σ̂‖². */
  dULS: number;
  /** Geodesic distance ½ Σ (ln φ)², φ the eigenvalues of S⁻¹Σ̂. */
  dG: number;
}

/** Overall model fit after Dijkstra & Henseler (2015). */
export interface ModelFit {
  saturated: Discrepancies;
  estimated: Discrepancies;
}

export interface ConstructQuality {
  alpha: number;
  rhoC: number;
  rhoA: number;
  ave: number;
}

/** All results are index-aligned with `constructs` / `indicators`. */
export interface PlsResult {
  n: number;
  iterations: number;
  converged: boolean;
  constructs: string[];
  indicators: { name: string; construct: number }[];
  weights: number[];
  loadings: number[];
  /** pathCoef[from][to]; 0 where no path is specified. */
  pathCoef: number[][];
  hasPath: boolean[][];
  totalEffects: number[][];
  indirectEffects: number[][];
  /** null for exogenous constructs. */
  rSquared: (number | null)[];
  adjRSquared: (number | null)[];
  constructCor: number[][];
  quality: ConstructQuality[];
  /** cSEM's redundancy analysis: Mode B composite correlated with a Mode A version of its indicators (by construct name). */
  redundancy?: Record<string, number>;
  /** htmt[i][j] for i > j; null elsewhere. */
  htmt: (number | null)[][];
  htmt2: (number | null)[][];
  fit: ModelFit;
  consistent: boolean;
  types: ConstructType[];
  /** Moderations with the index of their interaction construct in `constructs`. */
  /** `method`: how the interaction term was built (seminr: two_stage, orthogonal, product_indicator; cSEM: two_stage). */
  moderations: (ModerationSpec & { construct: number })[];
  /** cSEM's weighting approach: PLS-PM (each construct's mode) or GSCA, PCA, unit (sum scores) for every construct. */
  approach?: 'PLS-PM' | 'GSCA' | 'PCA' | 'unit';
  /** With second-order constructs: how they were estimated. */
  hocApproach?: 'two_stage' | 'embedded' | 'repeated';
  /** fSquare[from][to]; null where no path. */
  fSquare: (number | null)[][];
  /** vifInner[from][to]; null where no path. */
  vifInner: (number | null)[][];
  vifOuter: number[];
  /** Standardised construct scores, one column per construct. */
  scores: Float64Array[];
  /** The R bridge's explanations of the result (blank cells, conventions), shown with the tables they concern. */
  notes?: string[];
  droppedRows: number;
  /** Multiple imputation: the number of imputed data sets the estimates are averaged over. */
  imputations?: number;
  /** Second-order constructs (cSEM two-stage): loading and weight of each component, by index in `constructs`. */
  higherOrder?: { construct: number; component: number; loading: number; weight: number }[];
}

export interface BootstrapOptions {
  samples: number;
  seed: number;
  /** Confidence level of the intervals, e.g. 0.95. */
  confidence: number;
  /** One-tailed tests: p for the direction of the estimate, intervals [α, 1 − α] (default two-tailed). */
  tails?: 1 | 2;
  /** Percentile intervals (default) or bias-corrected and accelerated (BCa: needs a jackknife). */
  interval?: 'percentile' | 'bca';
}

export interface BootstrapStat {
  key: string;
  group: 'path' | 'total' | 'indirect' | 'loading' | 'weight' | 'r2';
  label: string;
  original: number;
  mean: number;
  sd: number;
  t: number;
  p: number;
  ciLow: number;
  ciHigh: number;
}

export interface BootstrapResult {
  samples: number;
  failed: number;
  confidence: number;
  stats: BootstrapStat[];
  /** One-tailed tests (absent: two-tailed). */
  tails?: 1 | 2;
  /** BCa intervals (absent: percentile). */
  interval?: 'percentile' | 'bca';
  /** Several groups or levels: every block's statistics (stats holds the block shown). */
  byBlock?: BootstrapStat[][];
  /** Multiple imputation: bootstraps in this many imputed data sets, pooled by Rubin's rules. */
  imputations?: number;
  /** The R package that resampled (absent for the built-in engine). */
  engine?: { package: string; version: string };
}
