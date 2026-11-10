// Difference-in-differences (R/did.R): fixest two-way fixed effects with an
// event study, or did's Callaway & Sant'Anna estimator for staggered adoption.

import type { Dataset } from '../engine/types';
import { rCall, rScript, rStrings } from './bridge';
import { rColumns, rList } from './rjson';
import type { REngineInfo } from './lavaan';

export interface DidInput {
  design: 'twfe' | 'staggered';
  outcome: string; unit: string; time: string;
  /** twfe: the treated-group indicator; staggered: the first treated period per unit (0 = never). */
  treated: string;
  /** twfe: the post-period indicator column (or none, with firstPeriod). */
  post: string;
  firstPeriod: number | null;
  covariates: string[];
  control: 'nevertreated' | 'notyettreated';
  eventStudy: boolean;
  seed: number; confidence: number;
}
export interface DidEffect { est: number; se: number; t: number; p: number; ciLow: number; ciHigh: number }
export interface DidResult {
  design: 'twfe' | 'staggered';
  att: DidEffect;
  /** Event study: the effect by time (twfe: period; staggered: periods since treatment `rel`). */
  event: { time: number | null; rel: number; est: number; se: number; ciLow: number; ciHigh: number }[];
  groupTime?: { group: number; time: number; est: number; se: number }[];
  preTrend: { stat: number; p: number; df1?: number; df2?: number } | null;
  n: number; units: number; periods: number; treatedUnits: number; control?: string;
  warnings: string[]; engine: REngineInfo;
}


export function didRequest(data: Dataset, i: DidInput) {
  if (data.moments && data.cols.length === 0) throw new Error('Difference-in-differences needs raw panel data; this dataset is a covariance matrix.');
  const post = i.design === 'twfe' ? i.post : '';  // (the post column belongs to the two-way design only)
  const names = [...new Set([i.outcome, i.unit, i.time, i.treated, ...(post ? [post] : []), ...i.covariates])];
  return { kind: 'did', ...i, post, firstPeriod: i.firstPeriod ?? undefined, data: rColumns(data, names) };
}

export async function didR(data: Dataset, input: DidInput): Promise<DidResult> {
  const raw = await rCall<Record<string, any>>('ps_did', didRequest(data, input), 'did');
  return { ...raw, event: rList(raw.event), ...(raw.groupTime ? { groupTime: rList(raw.groupTime) } : {}), preTrend: raw.preTrend ?? null, warnings: rStrings(raw.warnings) } as DidResult;
}
export const didScriptR = (data: Dataset, input: DidInput) => rScript('ps_did', didRequest(data, input), 'did');
