// Polynomial regression with response surface analysis (R/rsa.R).

import type { Dataset } from '../engine/types';
import { rCall, rScript, rStrings } from './bridge';
import { rColumns, rList, rNum } from './rjson';
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

const param = (x: any) => ({ ...x, se: rNum(x.se), stat: rNum(x.stat), p: rNum(x.p), ciLow: rNum(x.ciLow), ciHigh: rNum(x.ciHigh) });

export function rsaRequest(data: Dataset, i: RsaInput) {
  if (data.moments && data.cols.length === 0) throw new Error('Polynomial regression needs raw data; this dataset is a covariance matrix.');
  const names = [i.outcome, i.x, i.y, ...i.controls];
  return { ...i, data: rColumns(data, names) };
}

export async function rsaR(data: Dataset, input: RsaInput): Promise<RsaResult> {
  const raw = await rCall<Record<string, any>>('ps_rsa', rsaRequest(data, input), 'polynomial');
  return {
    estimation: raw.estimation, coefficients: rList<any>(raw.coefficients).map(param), surface: rList<any>(raw.surface).map(param),
    steps: rList(raw.steps), fit: raw.fit, grid: rList<number>(raw.grid), z: rList<unknown>(raw.z).map((r) => rList<number>(r)),
    points: { x: rList<number>(raw.points?.x), y: rList<number>(raw.points?.y) }, block: rList<number>(raw.block), rows: rList<number>(raw.rows),
    nTotal: raw.nTotal, warnings: rStrings(raw.warnings), engine: raw.engine,
  };
}
export const rsaScriptR = (data: Dataset, input: RsaInput) => rScript('ps_rsa', rsaRequest(data, input), 'polynomial');
