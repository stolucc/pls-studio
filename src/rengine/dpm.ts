// Dynamic panel models with fixed effects by maximum likelihood (R/longitudinal.R, ps_dpm; lavaan), written as the
// dpm package writes them (Allison, Williams & Moral-Benito 2017).

import type { CbFit } from '../engine/cbsem';
import type { Dataset, MissingTreatment } from '../engine/types';
import { rCall, rScript, rStrings } from './bridge';
import { LAVAAN_FIT, type REngineInfo } from './lavaan';
import { rColumns, rList } from './rjson';

/** A time-varying predictor at the outcome's waves; predetermined: it may respond to earlier outcomes. */
export interface DpmPredictor {
  waves: string[];
  predetermined: boolean;
}

export interface DpmInput {
  y: string[];
  x: DpmPredictor[];
  /** Time-invariant predictors. */
  constant: string[];
  /** One error variance for every wave (dpm's error.inv). */
  equalErrors: boolean;
  estimator: 'ML' | 'MLR';
  missing: MissingTreatment;
  information?: 'observed';
}

export interface DpmCoefficient {
  name: string;
  est: number;
  se: number;
  z: number;
  p: number;
}

export interface DpmResult {
  n: number;
  waves: number;
  fit: Partial<CbFit>;
  /** The lagged outcome, each lagged predictor, each time-invariant predictor. */
  coefficients: DpmCoefficient[];
  alphaVariance: { est: number; se: number };
  errorVariance?: DpmCoefficient;
  warnings: string[];
  engine: REngineInfo;
}

export const dpmColumns = (i: Pick<DpmInput, 'y' | 'x' | 'constant'>) => [
  ...i.y,
  ...i.x.flatMap((p) => p.waves),
  ...i.constant,
];

export const dpmRequest = (data: Dataset, i: DpmInput) => ({
  ...i,
  data: rColumns(data, dpmColumns(i)),
});

const coefficient = (c: Record<string, any>): DpmCoefficient => ({
  name: String(c.name),
  est: Number(c.est),
  se: Number(c.se),
  z: Number(c.z),
  p: Number(c.p),
});

export function dpmResult(r: Record<string, any>): DpmResult {
  const fit: Partial<CbFit> = {};
  for (const [name, key] of Object.entries(LAVAAN_FIT))
    if (typeof r.fit?.[name] === 'number') (fit as Record<string, number>)[key] = r.fit[name];
  return {
    n: Number(r.n),
    waves: Number(r.waves),
    fit,
    coefficients: rList<Record<string, any>>(r.coefficients).map(coefficient),
    alphaVariance: { est: Number(r.alphaVariance.est), se: Number(r.alphaVariance.se) },
    ...(r.errorVariance ? { errorVariance: coefficient(r.errorVariance) } : {}),
    warnings: rStrings(r.warnings),
    engine: r.engine,
  };
}

export async function dpmR(data: Dataset, i: DpmInput): Promise<DpmResult> {
  return dpmResult(await rCall<Record<string, any>>('ps_dpm', dpmRequest(data, i), 'lavaan'));
}

export const dpmScriptR = (data: Dataset, i: DpmInput) =>
  rScript('ps_dpm', dpmRequest(data, i), 'lavaan');
