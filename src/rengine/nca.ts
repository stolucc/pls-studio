// Necessary condition analysis (R/nca.R), computed as the NCA package does.

import type { Dataset } from '../engine/types';
import { rCall, rScript, rStrings } from './bridge';
import type { REngineInfo } from './lavaan';

export interface NcaCondition {
  x: string; n: number;
  /** Empirical scope: x min, x max, y min, y max. */
  scope: [number, number, number, number];
  ceFdh: number; crFdh: number; intercept: number | null; slope: number | null; accuracy: number | null;
  p: { ce_fdh: number; cr_fdh: number } | null;
  peers: { x: number[]; y: number[] }; points: { x: number[]; y: number[] };
  /** X needed (percentage of its range) for Y at 0, 10, ..., 100 % of its range; null: not reachable. */
  bottleneck: { y: number; ceFdh: number | null; crFdh: number | null }[];
}
export interface NcaResult { y: string; permutations: number; conditions: NcaCondition[]; warnings: string[]; engine: REngineInfo }

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? v : v == null ? [] : [v]) as T[];
const n0 = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** NCA's bottleneck notation: NN (not necessary: X may be at its minimum), NA (not reachable), else the percentage. */
export const bottleneckText = (v: number | null) => (v === null ? 'NA' : v <= 1e-9 ? 'NN' : v > 100 + 1e-9 ? 'NA' : v.toFixed(1));

export function ncaRequest(data: Dataset, x: string[], y: string, permutations: number) {
  if (data.moments && data.cols.length === 0) throw new Error('NCA needs raw data; this dataset is a covariance matrix.');
  const keep = data.names.map((n, k) => [n, k] as const).filter(([n]) => [...x, y].includes(n));
  return { x, y, permutations, data: { names: keep.map(([n]) => n), cols: keep.map(([, k]) => Array.from(data.cols[k], (v) => (Number.isNaN(v) ? null : v))) } };
}
export async function ncaR(data: Dataset, x: string[], y: string, permutations: number): Promise<NcaResult> {
  const raw = await rCall<Record<string, any>>('ps_nca', ncaRequest(data, x, y, permutations), 'nca');
  return {
    y: raw.y, permutations: raw.permutations, warnings: rStrings(raw.warnings), engine: raw.engine,
    conditions: arr<any>(raw.conditions).map((c) => ({
      ...c, scope: arr<number>(c.scope), intercept: n0(c.intercept), slope: n0(c.slope), accuracy: n0(c.accuracy), p: c.p ?? null,
      peers: { x: arr<number>(c.peers?.x), y: arr<number>(c.peers?.y) }, points: { x: arr<number>(c.points?.x), y: arr<number>(c.points?.y) },
      bottleneck: arr<any>(c.bottleneck).map((b) => ({ y: b.y, ceFdh: n0(b.ceFdh), crFdh: n0(b.crFdh) })),
    })),
  };
}
export const ncaScriptR = (data: Dataset, x: string[], y: string, permutations: number) => rScript('ps_nca', ncaRequest(data, x, y, permutations), 'nca');
