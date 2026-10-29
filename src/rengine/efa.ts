// Exploratory factor analysis / PCA with psych (R/efa.R): suitability, number
// of factors, and the solution.

import type { Dataset } from '../engine/types';
import type { EfaDesign } from '../model/efa';
import { rCall, rScript, rStrings } from './bridge';
import type { REngineInfo } from './lavaan';

export interface EfaResult {
  method: EfaDesign['method']; rotation: EfaDesign['rotation']; oblique: boolean; n: number; k: number; criterion: EfaDesign['criterion'];
  variables: string[]; factors: string[];
  loadings: number[][]; structure: number[][] | null;
  communality: number[]; uniqueness: number[]; complexity: number[];
  ssLoadings: number[]; proportion: number[]; cumulative: number[];
  phi: number[][] | null;
  /** Item x item: observed correlations, and residual correlations (diagonal 0). */
  correlations: number[][]; residuals: number[][];
  kmo: { overall: number; items: number[] };
  bartlett: { chisq: number; df: number; p: number };
  eigenvalues: number[];
  parallel: { observed: number[]; simulated: number[]; suggested: number | null; iterations: number } | null;
  map: { values: number[]; suggested: number };
  kaiser: number;
  fit: { offDiagonal?: number | null; chisq?: number | null; df?: number | null; p?: number | null; rmsea?: number | null; rmseaLow?: number | null; rmseaHigh?: number | null; tli?: number | null; bic?: number | null; rms?: number | null };
  warnings: string[]; engine: REngineInfo;
}

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? v : v == null ? [] : [v]) as T[];
const nums = (v: unknown) => arr<unknown>(v).map((x) => (typeof x === 'number' ? x : NaN));
/** A matrix from R's JSON (rows; a single column arrives as a vector of one-element rows or of numbers). */
const mat = (v: unknown, cols: number): number[][] => arr<unknown>(v).map((r) => (Array.isArray(r) ? nums(r) : cols === 1 ? nums([r]) : nums(r)));

export function efaRequest(data: Dataset, d: EfaDesign, seed: number) {
  if (data.moments && data.cols.length === 0) throw new Error('Exploratory factor analysis here needs raw data; this dataset is a covariance matrix.');
  const keep = data.names.map((n, k) => [n, k] as const).filter(([n]) => d.vars.includes(n));
  return {
    vars: d.vars, method: d.method, criterion: d.criterion, nfactors: d.nfactors, rotation: d.rotation, deletion: d.missing, parallel: d.parallel, seed,
    data: { names: keep.map(([n]) => n), cols: keep.map(([, k]) => Array.from(data.cols[k], (v) => (Number.isNaN(v) ? null : v))) },
  };
}

export function parseEfa(raw: Record<string, any>): EfaResult {
  const k = Number(raw.k) || 1;
  const parallel = raw.parallel ? { observed: nums(raw.parallel.observed), simulated: nums(raw.parallel.simulated), suggested: typeof raw.parallel.suggested === 'number' ? raw.parallel.suggested : null, iterations: raw.parallel.iterations } : null;
  return {
    method: raw.method, rotation: raw.rotation, oblique: !!raw.oblique, n: raw.n, k,
    criterion: (['parallel', 'kaiser', 'map'] as const).find((x) => x === raw.criterion) ?? 'fixed',
    variables: rStrings(raw.variables), factors: rStrings(raw.factors),
    loadings: mat(raw.loadings, k), structure: raw.structure ? mat(raw.structure, k) : null,
    communality: nums(raw.communality), uniqueness: nums(raw.uniqueness), complexity: nums(raw.complexity),
    ssLoadings: nums(raw.ssLoadings), proportion: nums(raw.proportion), cumulative: nums(raw.cumulative),
    phi: raw.phi ? mat(raw.phi, k) : null,
    correlations: mat(raw.correlations, 2), residuals: mat(raw.residuals, 2),
    kmo: { overall: Number(raw.kmo?.overall), items: nums(raw.kmo?.items) },
    bartlett: { chisq: Number(raw.bartlett?.chisq), df: Number(raw.bartlett?.df), p: Number(raw.bartlett?.p) },
    eigenvalues: nums(raw.eigenvalues), parallel,
    map: { values: nums(raw.map?.values), suggested: Number(raw.map?.suggested) },
    kaiser: Number(raw.kaiser), fit: raw.fit ?? {}, warnings: rStrings(raw.warnings), engine: raw.engine,
  };
}

export async function efaR(data: Dataset, d: EfaDesign, seed: number): Promise<EfaResult> {
  return parseEfa(await rCall<Record<string, any>>('ps_efa', efaRequest(data, d, seed), 'psych'));
}
export const efaScriptR = (data: Dataset, d: EfaDesign, seed: number) => rScript('ps_efa', efaRequest(data, d, seed), 'psych');
