// The dyadic actor-partner interdependence model (R/apim.R, lavaan): actor and partner effects, k and
// the omnibus test of distinguishability, for distinguishable or indistinguishable dyads.

import type { Dataset } from '../engine/types';
import { rCall, rScript, rStrings } from './bridge';
import type { REngineInfo } from './lavaan';
import { rColumns, rList, rNum } from './rjson';

export type Dyads = 'distinguishable' | 'indistinguishable';

export interface ApimInput {
  /** Each member's X and Y: one column (observed) or the items of a latent variable, in the same order. */
  x1: string[];
  x2: string[];
  y1: string[];
  y2: string[];
  dyads: Dyads;
  estimator: 'ML' | 'MLR';
  missing: 'casewise' | 'fiml';
  /** Percentile bootstrap intervals of the effects and k. */
  boot?: { samples: number; seed: number; level: number };
}

export interface ApimEstimate {
  label: string;
  est: number | null;
  se: number | null;
  z: number | null;
  p: number | null;
  low: number | null;
  high: number | null;
  std: number | null;
  bootLow: number | null;
  bootHigh: number | null;
}

export interface ApimFit {
  chisq: number | null;
  df: number | null;
  pvalue: number | null;
  cfi: number | null;
  rmsea: number | null;
  srmr: number | null;
}

export interface ApimResult {
  n: number;
  dyads: Dyads;
  latent: { x: boolean; y: boolean };
  /** a1, a2, p1, p2 (distinguishable) or a, p. */
  effects: ApimEstimate[];
  /** k1, k2 or k. */
  k: ApimEstimate[];
  xCor: { est: number | null; se: number | null; p: number | null; std: number | null };
  yCor: { est: number | null; se: number | null; p: number | null; std: number | null };
  fit: ApimFit;
  distFit: ApimFit;
  indistFit: ApimFit;
  test: { chisqDiff: number | null; dfDiff: number | null; p: number | null };
  level: number;
  boot: number;
  warnings: string[];
  engine: REngineInfo;
}

const estimateOf = (v: Record<string, unknown>): ApimEstimate => ({
  label: String(v.label),
  est: rNum(v.est),
  se: rNum(v.se),
  z: rNum(v.z),
  p: rNum(v.p),
  low: rNum(v.low),
  high: rNum(v.high),
  std: rNum(v.std),
  bootLow: rNum(v.bootLow),
  bootHigh: rNum(v.bootHigh),
});

const fitOf = (v: Record<string, unknown> = {}): ApimFit => ({
  chisq: rNum(v.chisq),
  df: rNum(v.df),
  pvalue: rNum(v.pvalue),
  cfi: rNum(v.cfi),
  rmsea: rNum(v.rmsea),
  srmr: rNum(v.srmr),
});

const corOf = (v: Record<string, unknown> = {}) => ({ est: rNum(v.est), se: rNum(v.se), p: rNum(v.p), std: rNum(v.std) });

export function parseApim(r: Record<string, any>): ApimResult {
  return {
    n: rNum(r.n) ?? 0,
    dyads: r.dyads === 'indistinguishable' ? 'indistinguishable' : 'distinguishable',
    latent: { x: r.latent?.x === true, y: r.latent?.y === true },
    effects: rList<Record<string, unknown>>(r.effects).map(estimateOf),
    k: rList<Record<string, unknown>>(r.k).map(estimateOf),
    xCor: corOf(r.xCor),
    yCor: corOf(r.yCor),
    fit: fitOf(r.fit),
    distFit: fitOf(r.distFit),
    indistFit: fitOf(r.indistFit),
    test: { chisqDiff: rNum(r.test?.chisqDiff), dfDiff: rNum(r.test?.dfDiff), p: rNum(r.test?.p) },
    level: rNum(r.level) ?? 0.95,
    boot: rNum(r.boot) ?? 0,
    warnings: rStrings(r.warnings),
    engine: r.engine,
  };
}

export const apimRequest = (data: Dataset, i: ApimInput) => ({
  ...i,
  data: rColumns(data, [...i.x1, ...i.x2, ...i.y1, ...i.y2]),
});

export async function apimR(data: Dataset, input: ApimInput): Promise<ApimResult> {
  const raw = await rCall<Record<string, any>>('ps_apim', apimRequest(data, input), 'lavaan');
  return parseApim(raw);
}

export const apimScriptR = (data: Dataset, input: ApimInput) => rScript('ps_apim', apimRequest(data, input), 'lavaan');
