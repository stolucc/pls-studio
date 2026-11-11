// Exploratory factor analysis / PCA with psych (R/efa.R): suitability, number
// of factors, and the solution.

import type { Dataset } from '../engine/types';
import type { EfaComparison, EfaDesign } from '../model/efa';
import { rCall, rScript, rStrings } from './bridge';
import { rColumns, rList } from './rjson';
import type { REngineInfo } from './lavaan';

export interface EfaResult {
  method: EfaDesign['method'];
  rotation: EfaDesign['rotation'];
  oblique: boolean;
  n: number;
  k: number;
  criterion: EfaDesign['criterion'];
  /** The correlations analysed; with polychoric, the variables treated as ordinal (at most 8 categories). */
  correlation: EfaDesign['correlation'];
  ordinal?: string[];
  variables: string[];
  factors: string[];
  loadings: number[][];
  structure: number[][] | null;
  communality: number[];
  uniqueness: number[];
  complexity: number[];
  ssLoadings: number[];
  proportion: number[];
  cumulative: number[];
  phi: number[][] | null;
  /** Item x item: observed correlations, and residual correlations (diagonal 0). */
  correlations: number[][];
  residuals: number[][];
  kmo: { overall: number; items: number[] };
  bartlett: { chisq: number; df: number; p: number };
  eigenvalues: number[];
  parallel: {
    observed: number[];
    simulated: number[];
    suggested: number | null;
    iterations: number;
  } | null;
  map: { values: number[]; suggested: number };
  kaiser: number;
  fit: EfaFit;
  /** lavaan extraction: ML, or WLSMV with polychoric correlations. */
  estimator?: 'ML' | 'WLSMV';
  /** lavaan extraction: standard errors of the standardised loadings, factor correlations and uniquenesses (delta method). */
  se?: { loadings: number[][]; phi: number[][] | null; uniqueness: number[] };
  /** lavaan extraction: the fit of each number of factors up to the solution's (Mplus: SUMMARY OF MODEL FIT INFORMATION). */
  comparison?: ({ k: number } & EfaFit)[];
  /** A second solution and Tucker's congruence coefficients with it (rows: this solution's factors). */
  congruence?: EfaCongruence;
  /** Schmid–Leiman: the second-order solution and the omegas (available false: fewer than three factors retained). */
  schmid?: EfaSchmid;
  warnings: string[];
  engine: REngineInfo;
}

/** The congruence comparison (psych::factor.congruence): the second solution, its loadings and the coefficients. */
export interface EfaCongruence {
  method: EfaComparison['method'];
  rotation: EfaComparison['rotation'];
  /** The second solution's factors (the coefficients' columns). */
  factors: string[];
  /** Rows: the solution's factors; columns: the second solution's. */
  coefficients: number[][];
  /** The second solution's loadings (rows: the variables). */
  loadings: number[][];
}

/** The Schmid–Leiman solution (psych::omega). */
export type EfaSchmid =
  | { available: false }
  | {
      available: true;
      /** The oblique solution's factors, as omega names them (F1…), and their loadings on the general factor. */
      firstOrder: string[];
      secondOrder: number[];
      /** The orthogonalised group factors (F1*…). */
      groups: string[];
      /** Per variable (the solution's order): general and group loadings, communality, uniqueness, and g²/h². */
      general: number[];
      group: number[][];
      h2: number[];
      u2: number[];
      p2: number[];
      /** Explained common variance of the general factor. */
      ecv: number;
      omegaH: number;
      omegaTotal: number;
      /** ω limit: ω hierarchical over ω total's limit for infinitely many items (psych's omega.lim). */
      omegaLimit: number;
      alpha: number;
      /** Per factor (g, then F1*…): ω total, the part due to the general factor, and the part due to the group factor. */
      omegaGroup: { name: string; total: number; general: number; group: number }[];
      /** Items omega reversed because they load negatively on the general factor. */
      reversed: string[];
    };

export interface EfaFit {
  offDiagonal?: number | null;
  chisq?: number | null;
  df?: number | null;
  p?: number | null;
  rmsea?: number | null;
  rmseaLow?: number | null;
  rmseaHigh?: number | null;
  tli?: number | null;
  bic?: number | null;
  rms?: number | null;
  /** lavaan extraction. */
  npar?: number | null;
  cfi?: number | null;
  srmr?: number | null;
  logl?: number | null;
  aic?: number | null;
}

const nums = (v: unknown) => rList<unknown>(v).map((x) => (typeof x === 'number' ? x : NaN));
/** A matrix from R's JSON (rows; a single column arrives as a vector of one-element rows or of numbers). */
const mat = (v: unknown, cols: number): number[][] =>
  rList<unknown>(v).map((r) => (Array.isArray(r) ? nums(r) : cols === 1 ? nums([r]) : nums(r)));

export function efaRequest(data: Dataset, d: EfaDesign, seed: number) {
  if (data.moments && data.cols.length === 0)
    throw new Error(
      'Exploratory factor analysis here needs raw data; this dataset is a covariance matrix.',
    );
  return {
    vars: d.vars,
    method: d.method,
    criterion: d.criterion,
    nfactors: d.nfactors,
    rotation: d.rotation,
    deletion: d.missing,
    parallel: d.parallel,
    seed,
    ...(d.correlation === 'polychoric' ? { correlation: 'polychoric' } : {}),
    ...(d.method === 'lavaan'
      ? {
          ...(d.epsilon !== undefined ? { epsilon: d.epsilon } : {}),
          ...(d.information ? { information: d.information } : {}),
          ...(d.wlsmvSe && d.correlation === 'polychoric' ? { wlsmvSe: d.wlsmvSe } : {}),
          ...(d.mimic && d.correlation === 'polychoric' ? { mimic: d.mimic } : {}),
          ...(d.from !== undefined ? { from: d.from } : {}),
        }
      : {}),
    ...(d.compare && d.method !== 'lavaan' ? { compare: d.compare } : {}),
    ...(d.schmid ? { schmid: true } : {}),
    data: rColumns(data, d.vars),
  };
}

/** The Schmid–Leiman solution from R's JSON (absent when none was asked for). */
function parseSchmid(raw: unknown): EfaSchmid | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  if (r.available !== true) return { available: false };
  const groups = rStrings(r.groups);
  return {
    available: true,
    firstOrder: rStrings(r.firstOrder),
    secondOrder: nums(r.secondOrder),
    groups,
    general: nums(r.general),
    group: mat(r.group, groups.length),
    h2: nums(r.h2),
    u2: nums(r.u2),
    p2: nums(r.p2),
    ecv: Number(r.ecv),
    omegaH: Number(r.omegaH),
    omegaTotal: Number(r.omegaTotal),
    omegaLimit: Number(r.omegaLimit),
    alpha: Number(r.alpha),
    omegaGroup: rList<Record<string, unknown>>(r.omegaGroup).map((x) => ({
      name: String(x.name),
      total: Number(x.total),
      general: Number(x.general),
      group: Number(x.group),
    })),
    reversed: rStrings(r.reversed),
  };
}

/** The congruence comparison from R's JSON (absent when none was asked for). */
function parseCongruence(raw: unknown): EfaCongruence | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  const factors = rStrings(r.factors);
  return {
    method: r.method as EfaComparison['method'],
    rotation: r.rotation as EfaComparison['rotation'],
    factors,
    coefficients: mat(r.coefficients, factors.length),
    loadings: mat(r.loadings, factors.length),
  };
}

export function parseEfa(raw: Record<string, any>): EfaResult {
  const k = Number(raw.k) || 1;
  const parallel = raw.parallel
    ? {
        observed: nums(raw.parallel.observed),
        simulated: nums(raw.parallel.simulated),
        suggested: typeof raw.parallel.suggested === 'number' ? raw.parallel.suggested : null,
        iterations: raw.parallel.iterations,
      }
    : null;
  return {
    method: raw.method,
    rotation: raw.rotation,
    oblique: !!raw.oblique,
    n: raw.n,
    k,
    correlation: raw.correlation === 'polychoric' ? 'polychoric' : 'pearson',
    ...(raw.correlation === 'polychoric' ? { ordinal: rStrings(raw.ordinal) } : {}),
    criterion: (['parallel', 'kaiser', 'map'] as const).find((x) => x === raw.criterion) ?? 'fixed',
    variables: rStrings(raw.variables),
    factors: rStrings(raw.factors),
    loadings: mat(raw.loadings, k),
    structure: raw.structure ? mat(raw.structure, k) : null,
    communality: nums(raw.communality),
    uniqueness: nums(raw.uniqueness),
    complexity: nums(raw.complexity),
    ssLoadings: nums(raw.ssLoadings),
    proportion: nums(raw.proportion),
    cumulative: nums(raw.cumulative),
    phi: raw.phi ? mat(raw.phi, k) : null,
    correlations: mat(raw.correlations, 2),
    residuals: mat(raw.residuals, 2),
    kmo: { overall: Number(raw.kmo?.overall), items: nums(raw.kmo?.items) },
    bartlett: {
      chisq: Number(raw.bartlett?.chisq),
      df: Number(raw.bartlett?.df),
      p: Number(raw.bartlett?.p),
    },
    eigenvalues: nums(raw.eigenvalues),
    parallel,
    map: { values: nums(raw.map?.values), suggested: Number(raw.map?.suggested) },
    kaiser: Number(raw.kaiser),
    fit: raw.fit ?? {},
    warnings: rStrings(raw.warnings),
    engine: raw.engine,
    ...(raw.estimator === 'ML' || raw.estimator === 'WLSMV' ? { estimator: raw.estimator } : {}),
    ...(raw.se
      ? {
          se: {
            loadings: mat(raw.se.loadings, k),
            phi: raw.se.phi ? mat(raw.se.phi, k) : null,
            uniqueness: nums(raw.se.uniqueness),
          },
        }
      : {}),
    ...(raw.congruence ? { congruence: parseCongruence(raw.congruence) } : {}),
    ...(raw.schmid ? { schmid: parseSchmid(raw.schmid) } : {}),
    ...(raw.comparison
      ? {
          comparison: rList<Record<string, any>>(raw.comparison).map((x) => ({
            ...x,
            k: Number(x.k),
          })),
        }
      : {}),
  };
}

/** The R packages: psych, and lavaan for its extraction. */
const efaPackage = (d: EfaDesign) =>
  d.method === 'lavaan' ? ('psychLavaan' as const) : ('psych' as const);
export async function efaR(data: Dataset, d: EfaDesign, seed: number): Promise<EfaResult> {
  return parseEfa(
    await rCall<Record<string, any>>('ps_efa', efaRequest(data, d, seed), efaPackage(d)),
  );
}
export const efaScriptR = (data: Dataset, d: EfaDesign, seed: number) =>
  rScript('ps_efa', efaRequest(data, d, seed), efaPackage(d));
