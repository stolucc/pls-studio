/** PLS outer weighting: Mode A (correlation), Mode B (regression), or sum scores (unit weights; Henseler 2021, ADANCO). */
export type Mode = 'A' | 'B' | 'unit';
/** Common factor (latent variable, reflective) or composite (emergent variable). */
export type ConstructType = 'factor' | 'composite';
export type WeightingScheme = 'path' | 'factor' | 'centroid';
/** 'fiml': full-information maximum likelihood (CB-SEM through lavaan only). */
export type MissingTreatment = 'mean' | 'casewise' | 'fiml';

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
  /** Observed exogenous covariate (single indicator, CB-SEM): variances/covariances fixed at sample values (lavaan fixed.x). */
  covariate?: boolean;
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
export type FreedParameter = { kind: 'loading'; construct: string; indicator: string } | { kind: 'intercept'; indicator: string };
export interface MultigroupSpec { column: string; invariance: InvarianceLevel; free: FreedParameter[] }

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
  /** CB-SEM (lavaan): multiple-group analysis by a grouping column, with a level of measurement invariance. */
  multigroup?: MultigroupSpec;
  /** CB-SEM (lavaan): two-level model by a cluster column; between level saturated or with the same structure. */
  multilevel?: { column: string; between: 'same' | 'saturated' };
  /** CB-SEM (lavaan): exploratory SEM blocks (construct names), whose factors load on all the block's indicators, rotated. */
  esem?: { blocks: string[][]; rotation: EsemRotation };
}

/** Column-oriented numeric data; NaN marks a missing value. */
/** Summary-statistics input: unbiased covariance matrix (in `names` order), N, optional NACOV (Γ, vech order). */
export interface MomentData {
  S: number[][];
  n: number;
  nacov?: number[][];
}

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
  /** Weighting approach (cSEM): PLS path modeling, or generalized structured component analysis (GSCA; Hwang & Takane 2004). */
  approach?: 'PLS-PM' | 'GSCA' | 'PCA' | 'unit';
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
  moderations: (ModerationSpec & { construct: number })[];
  /** fSquare[from][to]; null where no path. */
  fSquare: (number | null)[][];
  /** vifInner[from][to]; null where no path. */
  vifInner: (number | null)[][];
  vifOuter: number[];
  /** Standardised construct scores, one column per construct. */
  scores: Float64Array[];
  droppedRows: number;
}

export interface BootstrapOptions {
  samples: number;
  seed: number;
  /** Two-sided confidence level for percentile intervals, e.g. 0.95. */
  confidence: number;
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
  /** Several groups or levels: every block's statistics (stats holds the block shown). */
  byBlock?: BootstrapStat[][];
  /** The R package that resampled (absent for the built-in engine). */
  engine?: { package: string; version: string };
}
