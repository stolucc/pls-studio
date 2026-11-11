// Necessary condition analysis (R/nca.R), computed as the NCA package does.

import type { Dataset } from '../engine/types';
import { rCall, rScript, rStrings } from './bridge';
import { rColumns, rList, rNum } from './rjson';
import type { REngineInfo } from './lavaan';

export interface NcaCondition {
  x: string;
  n: number;
  /** Empirical scope: x min, x max, y min, y max. */
  scope: [number, number, number, number];
  ceFdh: number;
  crFdh: number;
  intercept: number | null;
  slope: number | null;
  accuracy: number | null;
  p: { ce_fdh: number; cr_fdh: number } | null;
  peers: { x: number[]; y: number[] };
  points: { x: number[]; y: number[] };
  /** X needed (percentage of its range) for Y at 0, 10, ..., 100 % of its range; null: not reachable. */
  bottleneck: { y: number; ceFdh: number | null; crFdh: number | null }[];
  /** Robustness checks; absent when not requested. */
  robustness?: NcaRobustness;
}

/** A potential outlier (NCA's nca_outliers, one case at a time). */
export interface NcaOutlier {
  /** Row number in the data (1-based). */
  case: number;
  /** Effect size without this case; null when the ceiling is undefined. */
  d: number | null;
  change: number;
  /** Change as a percentage of the effect size with all cases; null: infinite. */
  percent: number | null;
  /** The case is a corner point of the ceiling. */
  ceiling: boolean;
  /** Removing the case changes the scope. */
  scope: boolean;
}

/** Effect sizes and p-values of both ceilings with one case removed. */
export interface NcaWithout {
  case: number;
  n: number;
  ceFdh: number | null;
  crFdh: number | null;
  p: { ce_fdh: number; cr_fdh: number } | null;
}

/** Potential outliers per ceiling, and the analysis without the most influential one of each. */
export interface NcaRobustness {
  outliers: { ceFdh: NcaOutlier[]; crFdh: NcaOutlier[] };
  without: NcaWithout[];
}
export interface NcaResult {
  y: string;
  permutations: number;
  conditions: NcaCondition[];
  warnings: string[];
  engine: REngineInfo;
}

/** NCA's bottleneck notation: NN (not necessary: X may be at its minimum), NA (not reachable), else the percentage. */
export const bottleneckText = (v: number | null) =>
  v === null ? 'NA' : v <= 1e-9 ? 'NN' : v > 100 + 1e-9 ? 'NA' : v.toFixed(1);

export function ncaRequest(
  data: Dataset,
  x: string[],
  y: string,
  permutations: number,
  outliers = false,
) {
  if (data.moments && data.cols.length === 0)
    throw new Error('NCA needs raw data; this dataset is a covariance matrix.');
  return { x, y, permutations, outliers, data: rColumns(data, [...x, y]) };
}

function parseOutliers(raw: unknown): NcaOutlier[] {
  return rList<any>(raw).map((o) => ({
    case: o.case,
    d: rNum(o.d),
    change: o.change,
    percent: rNum(o.percent),
    ceiling: o.ceiling === true,
    scope: o.scope === true,
  }));
}

function parseRobustness(raw: any): NcaRobustness | undefined {
  if (!raw) return undefined;
  return {
    outliers: {
      ceFdh: parseOutliers(raw.outliers?.ceFdh),
      crFdh: parseOutliers(raw.outliers?.crFdh),
    },
    without: rList<any>(raw.without).map((w) => ({
      case: w.case,
      n: w.n,
      ceFdh: rNum(w.ceFdh),
      crFdh: rNum(w.crFdh),
      p: w.p ?? null,
    })),
  };
}

/** Run NCA in R; `outliers` adds the robustness checks (potential outliers and their influence). */
export async function ncaR(
  data: Dataset,
  x: string[],
  y: string,
  permutations: number,
  outliers = false,
): Promise<NcaResult> {
  const req = ncaRequest(data, x, y, permutations, outliers);
  const raw = await rCall<Record<string, any>>('ps_nca', req, 'nca');
  return {
    y: raw.y,
    permutations: raw.permutations,
    warnings: rStrings(raw.warnings),
    engine: raw.engine,
    conditions: rList<any>(raw.conditions).map((c) => ({
      ...c,
      scope: rList<number>(c.scope),
      intercept: rNum(c.intercept),
      slope: rNum(c.slope),
      accuracy: rNum(c.accuracy),
      p: c.p ?? null,
      peers: { x: rList<number>(c.peers?.x), y: rList<number>(c.peers?.y) },
      points: { x: rList<number>(c.points?.x), y: rList<number>(c.points?.y) },
      bottleneck: rList<any>(c.bottleneck).map((b) => ({
        y: b.y,
        ceFdh: rNum(b.ceFdh),
        crFdh: rNum(b.crFdh),
      })),
      robustness: parseRobustness(c.robustness),
    })),
  };
}
/** The self-contained R script of an NCA run. */
export function ncaScriptR(
  data: Dataset,
  x: string[],
  y: string,
  permutations: number,
  outliers = false,
) {
  return rScript('ps_nca', ncaRequest(data, x, y, permutations, outliers), 'nca');
}
