export type Mode = 'A' | 'B';
/** Common factor (latent variable, reflective) or composite (emergent variable). */
export type ConstructType = 'factor' | 'composite';
export type WeightingScheme = 'path' | 'factor' | 'centroid';
export type MissingTreatment = 'mean' | 'casewise';

export interface ConstructSpec {
  name: string;
  /** Outer weighting mode used by PLS. */
  mode: Mode;
  /** Defaults to 'composite' for Mode B and 'factor' for Mode A. */
  type?: ConstructType;
  indicators: string[];
  /** Higher-order construct (CB-SEM): measured by these first-order constructs instead of indicators. */
  components?: string[];
  /** Observed exogenous covariate (single indicator, CB-SEM): variances/covariances fixed at sample values (lavaan fixed.x). */
  covariate?: boolean;
}

export interface PathSpec {
  from: string;
  to: string;
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
}

export interface ModelSpec {
  constructs: ConstructSpec[];
  paths: PathSpec[];
  moderations?: ModerationSpec[];
  covariances?: CovarianceSpec[];
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
}

export interface PlsOptions {
  scheme: WeightingScheme;
  maxIter: number;
  /** Convergence threshold on the sum of absolute outer-weight changes. */
  tolerance: number;
  missing: MissingTreatment;
  /** Consistent PLS (PLSc): correct common factors for attenuation. */
  consistent: boolean;
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
  /** The R package that resampled (absent for the built-in engine). */
  engine?: { package: string; version: string };
}
