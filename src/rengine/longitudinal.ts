// Longitudinal models with lavaan (R/longitudinal.R): latent growth curves and
// the random-intercept cross-lagged panel model (RI-CLPM), latent change score models.

import type { CbFit } from '../engine/cbsem';
import type { Dataset, MissingTreatment } from '../engine/types';
import { rCall, rScript, rStrings } from './bridge';
import { rColumns, rList } from './rjson';
import { LAVAAN_FIT, type REngineInfo } from './lavaan';

/** `group` (1, 2, …) and `label`: a growth model written as syntax. */
export interface LongEstimate { lhs: string; op: string; rhs: string; est: number; se: number | null; z: number | null; p: number | null; std: number; group?: number; label?: string }

/** `timeVarying`: one covariate per occasion (each measure regressed on its own), or none. */
/** `information: 'observed'`: standard errors from the observed information (ML; Mplus's default). */
/** `syntax`: the model as lavaan syntax for growth() instead of the shape and covariates (`measures` and `times` then only draw the chart); `group`: a grouping column (syntax only). */
export interface GrowthInput { measures: string[]; times: number[]; shape: 'linear' | 'quadratic' | 'basis'; covariates: string[]; timeVarying?: string[]; estimator: 'ML' | 'MLR'; missing: MissingTreatment; information?: 'observed'; syntax?: string; group?: string }
export interface GrowthResult {
  n: number; fit: Partial<CbFit>; estimates: LongEstimate[]; r2: Record<string, number>;
  impliedMeans: number[]; observedMeans: number[]; measures: string[]; times: number[]; warnings: string[]; engine: REngineInfo;
  /** The groups' labels (a model written as syntax, with a group column). */
  groups?: string[];
}

export interface RiclpmInput { x: string[]; y: string[]; equal: boolean; estimator: 'ML' | 'MLR'; missing: MissingTreatment; information?: 'observed' }
export interface RiclpmResult {
  n: number; waves: number; equal: boolean; fit: Partial<CbFit>; clpmFit: Partial<CbFit>; estimates: LongEstimate[];
  comparison: { chisqDiff: number; dfDiff: number; p: number }; warnings: string[]; engine: REngineInfo;
}

const fitOf = (raw: Record<string, unknown>): Partial<CbFit> => {
  const out: Partial<CbFit> = {};
  for (const [name, key] of Object.entries(LAVAAN_FIT)) if (typeof raw[name] === 'number') (out as Record<string, number>)[key] = raw[name] as number;
  return out;
};
const estimates = (v: unknown) => rList<any>(v).map((e) => ({ lhs: e.lhs, op: e.op, rhs: e.rhs, est: e.est, se: e.se ?? null, z: e.z ?? null, p: e.p ?? null, std: e.std,
  ...(e.group !== undefined ? { group: e.group } : {}), ...(e.label ? { label: e.label } : {}) })) as LongEstimate[];

/** The data columns a growth model written as syntax names (comments left out). */
export const syntaxColumns = (syntax: string, names: string[]) =>
  [...new Set(syntax.replace(/[#!].*$/gm, '').match(/[A-Za-z_.][A-Za-z0-9_.]*/g) ?? [])].filter((n) => names.includes(n));
export const growthRequest = (data: Dataset, i: GrowthInput) => ({ kind: 'growth', ...i, timeVarying: i.timeVarying ?? [],
  data: rColumns(data, [...i.measures, ...i.covariates, ...(i.timeVarying ?? []), ...(i.syntax?.trim() ? syntaxColumns(i.syntax, data.names) : []), ...(i.group ? [i.group] : [])]) });
export const riclpmRequest = (data: Dataset, i: RiclpmInput) => ({ kind: 'riclpm', ...i, data: rColumns(data, [...i.x, ...i.y]) });

export async function growthR(data: Dataset, input: GrowthInput): Promise<GrowthResult> {
  const raw = await rCall<Record<string, any>>('ps_growth', growthRequest(data, input), 'lavaan');
  return { ...raw, fit: fitOf(raw.fit ?? {}), estimates: estimates(raw.estimates), r2: raw.r2 && !Array.isArray(raw.r2) ? raw.r2 : {},
    impliedMeans: rList<number>(raw.impliedMeans), observedMeans: rList<number>(raw.observedMeans), measures: rList<string>(raw.measures), times: rList<number>(raw.times),
    warnings: rStrings(raw.warnings), ...(rList<string>(raw.groups).length ? { groups: rList<string>(raw.groups).map(String) } : {}) } as GrowthResult;
}
export const growthScriptR = (data: Dataset, input: GrowthInput) => rScript('ps_growth', growthRequest(data, input), 'lavaan');

export async function riclpmR(data: Dataset, input: RiclpmInput): Promise<RiclpmResult> {
  const raw = await rCall<Record<string, any>>('ps_riclpm', riclpmRequest(data, input), 'lavaan');
  return { ...raw, fit: fitOf(raw.fit ?? {}), clpmFit: fitOf(raw.clpmFit ?? {}), estimates: estimates(raw.estimates), warnings: rStrings(raw.warnings) } as RiclpmResult;
}
export const riclpmScriptR = (data: Dataset, input: RiclpmInput) => rScript('ps_riclpm', riclpmRequest(data, input), 'lavaan');

/** The change components of one variable in a latent change score model (lcsm's alpha_constant, beta, phi). */
export interface LcsComponents { constant: boolean; proportional: boolean; autoregressive: boolean }
/** Couplings between two variables: delta, a change on the other's previous true score; xi, on the other's previous change. */
export interface LcsCoupling { deltaXY: boolean; deltaYX: boolean; xiXY: boolean; xiYX: boolean }
/** `y` empty: a univariate model. */
export interface LcsInput { x: string[]; y: string[]; modelX: LcsComponents; modelY: LcsComponents; coupling: LcsCoupling; estimator: 'ML' | 'MLR'; missing: MissingTreatment; information?: 'observed' }
/** A labelled parameter (lcsm's labels: gamma_lx1, sigma2_lx1, alpha_g2, beta_x, phi_x, delta_lag_xy, …). */
export interface LcsEstimate { label: string; lhs: string; op: string; rhs: string; est: number; se: number | null; z: number | null; p: number | null; std: number | null }
export interface LcsResult {
  n: number; occasions: number; bivariate: boolean; x: string[]; y: string[]; fit: Partial<CbFit>; estimates: LcsEstimate[];
  impliedMeans: { x: number[]; y: number[] }; observedMeans: { x: number[]; y: number[] }; warnings: string[]; engine: REngineInfo;
}

export const lcsRequest = (data: Dataset, i: LcsInput) => ({ kind: 'lcs', ...i, data: rColumns(data, [...i.x, ...i.y]) });
const pair = (v: unknown) => { const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>; return { x: rList<number>(o.x), y: rList<number>(o.y) }; };

export async function lcsR(data: Dataset, input: LcsInput): Promise<LcsResult> {
  const raw = await rCall<Record<string, any>>('ps_lcs', lcsRequest(data, input), 'lavaan');
  return { ...raw, x: rList<string>(raw.x), y: rList<string>(raw.y), fit: fitOf(raw.fit ?? {}), warnings: rStrings(raw.warnings),
    estimates: rList<any>(raw.estimates).map((e) => ({ label: String(e.label), lhs: e.lhs, op: e.op, rhs: e.rhs, est: e.est, se: e.se ?? null, z: e.z ?? null, p: e.p ?? null, std: e.std ?? null })),
    impliedMeans: pair(raw.impliedMeans), observedMeans: pair(raw.observedMeans) } as LcsResult;
}
export const lcsScriptR = (data: Dataset, input: LcsInput) => rScript('ps_lcs', lcsRequest(data, input), 'lavaan');
