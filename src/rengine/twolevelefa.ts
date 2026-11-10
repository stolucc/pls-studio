// Two-level exploratory factor analysis (R/twolevelefa.R): factors at each level (or a level unrestricted), each
// level's loadings standardised and geomin-rotated, delta-method standard errors (Mplus TYPE = TWOLEVEL EFA).

import type { Dataset } from '../engine/types';
import { rCall, rScript, rStrings } from './bridge';
import { rList } from './rjson';
import type { REngineInfo } from './lavaan';

export type LevelFactors = number | 'U';
export interface TwoLevelEfaInput { items: string[]; cluster: string; within: LevelFactors[]; between: LevelFactors[] }
export interface Efa2Level {
  factors: string[];
  loadings: { item: string; est: number[]; se: number[] }[];
  correlations: { a: number; b: number; est: number; se: number }[];
  residuals: { item: string; est: number; se: number }[];
  criterion: number | null;
}
export interface Efa2Solution {
  within: LevelFactors; between: LevelFactors; converged: boolean;
  fit: { npar: number; nparMplus: number; logl: number; chisq: number; df: number; pvalue: number; aic: number; bic: number; rmsea: number; cfi: number; tli: number; srmr_within?: number; srmr_between?: number };
  withinLevel: Efa2Level | null; betweenLevel: Efa2Level | null;
}
export interface TwoLevelEfaResult { items: string[]; cluster: string; n: number; clusters: number; solutions: Efa2Solution[]; warnings: string[]; engine: REngineInfo }

export function twoLevelEfaRequest(data: Dataset, o: TwoLevelEfaInput) {
  if (data.moments && data.cols.length === 0) throw new Error('A two-level EFA needs raw data.');
  const cols = [...o.items, o.cluster];
  const at = cols.map((n) => data.names.indexOf(n));
  if (at.some((k) => k < 0)) throw new Error('A column of the analysis is not in the data.');
  return { ...o, data: { names: cols, cols: at.map((k) => Array.from(data.cols[k], (v) => (Number.isNaN(v) ? null : v))) } };
}
const level = (l: any): Efa2Level | null => (l ? {
  factors: rList<string>(l.factors), criterion: typeof l.criterion === 'number' ? l.criterion : null,
  loadings: rList<any>(l.loadings).map((x) => ({ item: x.item, est: rList<number>(x.est), se: rList<number>(x.se) })),
  correlations: rList<any>(l.correlations), residuals: rList<any>(l.residuals),
} : null);
export async function twoLevelEfaR(data: Dataset, o: TwoLevelEfaInput): Promise<TwoLevelEfaResult> {
  const raw = await rCall<Record<string, any>>('ps_efa_twolevel', twoLevelEfaRequest(data, o), 'efa2');
  return {
    items: rList<string>(raw.items), cluster: raw.cluster, n: raw.n, clusters: raw.clusters, warnings: rStrings(raw.warnings), engine: raw.engine,
    solutions: rList<any>(raw.solutions).map((s) => ({ within: s.within, between: s.between, converged: !!s.converged, fit: s.fit, withinLevel: level(s.withinLevel), betweenLevel: level(s.betweenLevel) })),
  };
}
export const twoLevelEfaScriptR = (data: Dataset, o: TwoLevelEfaInput) => rScript('ps_efa_twolevel', twoLevelEfaRequest(data, o), 'efa2');
