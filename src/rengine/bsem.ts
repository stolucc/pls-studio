// Bayesian SEM (R/bayes.R ps_bsem): the CB-SEM model of the diagram by blavaan
// (Stan). Desktop R only: the bridge refuses it in the browser (DESKTOP_ONLY).

import type { CbEstimator } from '../engine/cbsem';
import type { Dataset, MissingTreatment, ModelSpec } from '../engine/types';
import { rCall, rScript, rStrings } from './bridge';
import { cbRequest, type REngineInfo } from './lavaan';

export interface BsemOptions { identification: 'unit' | 'marker'; chains: number; burnin: number; sample: number }
export interface BsemParameter { lhs: string; op: string; rhs: string; mean: number; sd: number; low: number; high: number; rhat: number | null; neff: number | null }
export interface BsemResult {
  identification: BsemOptions['identification']; chains: number; burnin: number; sample: number; seed: number; confidence: number; n: number;
  parameters: BsemParameter[]; maxRhat: number; minNeff: number; converged: boolean;
  fit: { ppp?: number; dic?: number; pDic?: number; waic?: number; looic?: number; seLooic?: number; margLogLik?: number; bic?: number };
  warnings: string[]; engine: REngineInfo & { desktop?: string };
}

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? v : v == null ? [] : [v]) as T[];

export const bsemRequest = (data: Dataset, spec: ModelSpec, missing: MissingTreatment, o: BsemOptions, seed: number, confidence: number) =>
  ({ ...cbRequest(data, spec, missing, 'ML' as CbEstimator), ...o, seed, confidence });

export async function bsemR(data: Dataset, spec: ModelSpec, missing: MissingTreatment, o: BsemOptions, seed: number, confidence: number): Promise<BsemResult> {
  const r = await rCall<Record<string, any>>('ps_bsem', bsemRequest(data, spec, missing, o, seed, confidence), 'blavaan');
  return { ...r, parameters: arr(r.parameters), fit: r.fit && !Array.isArray(r.fit) ? r.fit : {}, warnings: rStrings(r.warnings) } as BsemResult;
}
export const bsemScriptR = (data: Dataset, spec: ModelSpec, missing: MissingTreatment, o: BsemOptions, seed: number, confidence: number) =>
  rScript('ps_bsem', bsemRequest(data, spec, missing, o, seed, confidence), 'blavaan');
