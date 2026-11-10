// Analytic power analysis (R/power.R, semPower): a priori, post hoc and compromise power for misfit given as an
// effect, the power to detect one parameter of the CB-SEM model on the canvas, and the RMSEA equivalence test
// (Yuan et al. 2016's T-size RMSEA and adjusted cutoffs, computed from the formulas).

import type { CbEstimator } from '../engine/cbsem';
import type { Dataset, MissingTreatment, ModelSpec } from '../engine/types';
import { rCall, rScript, rStrings } from './bridge';
import { rList } from './rjson';
import { cbRequest, type REngineInfo } from './lavaan';

export type PowerAnalysis = 'apriori' | 'posthoc' | 'compromise' | 'parameter' | 'equivalence';
export type EffectMeasure = 'RMSEA' | 'F0' | 'Mc' | 'GFI' | 'AGFI';
/** A parameter of the model by its app names (constructs, indicators), lavaan's operator, and its value under H0. */
export interface PowerParam { lhs: string; op: '=~' | '~' | '~~'; rhs: string; value: number }
/** What the bridge needs: the numbers of the chosen analysis (the model travels separately when it is fitted). */
export interface PowerInput {
  analysis: PowerAnalysis; alpha: number;
  measure?: EffectMeasure; effect?: number; df?: number; p?: number; power?: number; n?: number; abratio?: number;
  param?: PowerParam; type?: 'apriori' | 'posthoc';
  source?: 'model' | 'manual'; chisq?: number;
}
export interface PowerResult {
  analysis: PowerAnalysis;
  type?: 'apriori' | 'posthoc' | 'compromise';
  alpha?: number; beta?: number; power?: number; n?: number; df?: number; ncp?: number; chiCrit?: number; fmin?: number;
  rmsea?: number; mc?: number; gfi?: number; agfi?: number; abratio?: number;
  curve?: { n: number[]; power: number[] };
  /** A parameter: its estimate in the fitted model (the population value) and the sample's N. */
  estimate?: number; sampleN?: number; param?: PowerParam;
  /** The RMSEA equivalence test. */
  chisq?: number; rmseaT?: number; ncpT?: number; cutoffs?: number[]; verdict?: 'excellent' | 'close' | 'fair' | 'mediocre' | 'poor';
  warnings: string[]; engine: REngineInfo & { desktop?: string };
}
/** The model on the canvas, for the analyses that fit it. */
export interface PowerModel { data: Dataset; spec: ModelSpec; missing: MissingTreatment; estimator: CbEstimator }

const fitsModel = (o: PowerInput) => o.analysis === 'parameter' || (o.analysis === 'equivalence' && o.source === 'model');
export const powerRequest = (o: PowerInput, m: PowerModel | null) => {
  if (fitsModel(o) && !m) throw new Error('This power analysis needs the CB-SEM model on the canvas.');
  return { ...(fitsModel(o) && m ? cbRequest(m.data, m.spec, m.missing, m.estimator) : {}), power: o };
};

const nums = (v: unknown): number[] => rList<unknown>(v).map(Number);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
/** The reply as the card reads it (R's single values and empty lists normalised). */
export function powerResult(r: Record<string, any>): PowerResult {
  const out: PowerResult = { analysis: r.analysis, warnings: rStrings(r.warnings), engine: r.engine };
  for (const k of ['alpha', 'beta', 'power', 'n', 'df', 'ncp', 'chiCrit', 'fmin', 'rmsea', 'mc', 'gfi', 'agfi', 'abratio', 'estimate', 'sampleN', 'chisq', 'rmseaT', 'ncpT'] as const) {
    const v = num(r[k]);
    if (v !== undefined) out[k] = v;
  }
  if (r.type) out.type = r.type;
  if (r.curve && !Array.isArray(r.curve)) out.curve = { n: nums(r.curve.n), power: nums(r.curve.power) };
  if (r.param && !Array.isArray(r.param)) out.param = { lhs: String(r.param.lhs), op: r.param.op, rhs: String(r.param.rhs), value: Number(r.param.value) };
  if (r.cutoffs) out.cutoffs = nums(r.cutoffs);
  if (r.verdict) out.verdict = r.verdict;
  return out;
}

export async function powerR(o: PowerInput, m: PowerModel | null): Promise<PowerResult> {
  return powerResult(await rCall<Record<string, any>>('ps_power', powerRequest(o, m), 'semPower'));
}
export const powerScriptR = (o: PowerInput, m: PowerModel | null) => rScript('ps_power', powerRequest(o, m), 'semPower');
