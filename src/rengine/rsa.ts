// Polynomial regression with response surface analysis (R/rsa.R).

import type { Dataset } from '../engine/types';
import { rCall, rScript, rStrings } from './bridge';
import type { REngineInfo } from './lavaan';

export interface RsaInput {
  outcome: string; x: string; y: string; controls: string[];
  estimation: 'OLS' | 'ML' | 'MLR';
  center: 'none' | 'mean' | 'midpoint'; midpoint: number; confidence: number;
}
export interface RsaParam { name: string; est: number; se: number | null; stat: number | null; p: number | null; ciLow: number | null; ciHigh: number | null }
export interface RsaResult {
  estimation: RsaInput['estimation'];
  coefficients: (RsaParam & { term: string })[];
  /** a1-a5 (and with lavaan the stationary point X0, Y0 and the principal axes p10, p11, p20, p21). */
  surface: RsaParam[];
  steps: { step: string; r2: number; dr2?: number; f?: number; df1?: number; p?: number }[];
  fit: { r2: number; adjR2?: number; n: number };
  /** Predicted outcome over a 21 x 21 grid of (centred) X and Y: z[i][j] at x = grid[i], y = grid[j]. */
  grid: number[]; z: number[][];
  points: { x: number[]; y: number[] };
  /** The block variable for each analysed row (rows: 1-based positions in the data). */
  block: number[]; rows: number[]; nTotal: number;
  warnings: string[]; engine: REngineInfo;
}

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? v : v == null ? [] : [v]) as T[];
const n0 = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const param = (x: any) => ({ ...x, se: n0(x.se), stat: n0(x.stat), p: n0(x.p), ciLow: n0(x.ciLow), ciHigh: n0(x.ciHigh) });

export function rsaRequest(data: Dataset, i: RsaInput) {
  if (data.moments && data.cols.length === 0) throw new Error('Polynomial regression needs raw data; this dataset is a covariance matrix.');
  const names = [i.outcome, i.x, i.y, ...i.controls];
  const keep = data.names.map((n, k) => [n, k] as const).filter(([n]) => names.includes(n));
  return { ...i, data: { names: keep.map(([n]) => n), cols: keep.map(([, k]) => Array.from(data.cols[k], (v) => (Number.isNaN(v) ? null : v))) } };
}

export async function rsaR(data: Dataset, input: RsaInput): Promise<RsaResult> {
  const raw = await rCall<Record<string, any>>('ps_rsa', rsaRequest(data, input), 'polynomial');
  return {
    estimation: raw.estimation, coefficients: arr<any>(raw.coefficients).map(param), surface: arr<any>(raw.surface).map(param),
    steps: arr(raw.steps), fit: raw.fit, grid: arr<number>(raw.grid), z: arr<unknown>(raw.z).map((r) => arr<number>(r)),
    points: { x: arr<number>(raw.points?.x), y: arr<number>(raw.points?.y) }, block: arr<number>(raw.block), rows: arr<number>(raw.rows),
    nTotal: raw.nTotal, warnings: rStrings(raw.warnings), engine: raw.engine,
  };
}
export const rsaScriptR = (data: Dataset, input: RsaInput) => rScript('ps_rsa', rsaRequest(data, input), 'polynomial');
