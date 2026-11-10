// Sensitivity to an unmeasured confounder (R/sensitivity.R): SEMsens's phantom-variable search on the CB-SEM model on the
// canvas (Leite et al. 2022), and mediation::medsens's rho-sensitivity of a simple mediation (Imai, Keele & Yamamoto
// 2010) for the conditional process model.

import { rCall, rScript, rStrings } from './bridge';
import type { CbCall } from './cbExtras';
import type { CpaVariable } from './cpa';
import { cbRequest, type REngineInfo } from './lavaan';
import type { Dataset } from '../engine/types';

const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? v : v == null ? [] : [v]) as T[];
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
const nums = (v: unknown) => arr<unknown>(v).map(num);
const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
/** A number, or null when R gave none (NA, or an empty vector: no zero crossing within the grid). */
const first = (v: unknown): number | null => { const x = arr<unknown>(v)[0]; return typeof x === 'number' && Number.isFinite(x) ? x : null; };

// ---------- SEMsens ----------

/** SEMsens's objective functions (sa.aco opt.fun 1-4). */
export const SEMSENS_OBJECTIVES = [1, 2, 3, 4] as const;
export type SemsensObjective = (typeof SEMSENS_OBJECTIVES)[number];
export interface SemsensArgs {
  /** The paths of interest, [from, to] by construct name. */
  paths: [string, string][];
  /** The constructs the phantom variable affects (2 to 9). */
  phantoms: string[];
  optFun: SemsensObjective;
  /** Archive size (sa.aco k), ants per iteration, at most this many evaluations (max.iter). */
  k: number; ants: number; maxIter: number;
  /** Each phantom coefficient in [-bound, bound]. */
  bound: number;
  alpha: number;
  seed: number;
}
export interface SemsensRow { from: string; to: string; values: number[] }
export interface SemsensResult {
  n: number; optFun: number; k: number; ants: number; maxIter: number; bound: number; alpha: number; seed: number;
  /** Converged evaluations, tries, and the best objective value. */
  evaluations: number; tried: number; maxObjective: number;
  phantoms: string[]; interest: { from: string; to: string }[];
  /** sens.tables: each regression's model estimate, p, and mean, minimum, maximum over the evaluations (standardised). */
  summary: SemsensRow[];
  /** Each phantom coefficient's mean, minimum, maximum (standardised). */
  phantom: { construct: string; values: number[] }[];
  /** The phantom coefficients at each regression's minimum and maximum estimate. */
  atMin: SemsensRow[]; atMax: SemsensRow[];
  /** sens.tables p.paths: the model's p, the p nearest a flip of significance (NaN: no flip found), then the phantom coefficients that give it. */
  flip: SemsensRow[];
  /** Every evaluation: each regression's standardised estimate and p, and each phantom coefficient (in phantom order). */
  draws: { path: { from: string; to: string; est: number[]; p: number[] }[]; phantom: number[][] };
  warnings: string[];
  engine: REngineInfo & { lavaan?: string };
}

const semsensReq = (c: CbCall, a: SemsensArgs) => ({ ...cbRequest(c.data, c.spec, c.missing, c.estimator, c.interaction), semsens: a });
const rows = (v: unknown): SemsensRow[] => arr<any>(v).map((r) => ({ from: str(r.from), to: str(r.to), values: nums(r.values) }));

export function parseSemsensOutput(r: Record<string, any>): SemsensResult {
  return {
    n: num(r.n), optFun: num(r.optFun), k: num(r.k), ants: num(r.ants), maxIter: num(r.maxIter), bound: num(r.bound), alpha: num(r.alpha), seed: num(r.seed),
    evaluations: num(r.evaluations), tried: num(r.tried), maxObjective: num(r.maxObjective),
    phantoms: rStrings(r.phantoms), interest: arr<any>(r.interest).map((p) => ({ from: str(p.from), to: str(p.to) })),
    summary: rows(r.summary), phantom: arr<any>(r.phantom).map((p) => ({ construct: str(p.construct), values: nums(p.values) })),
    atMin: rows(r.atMin), atMax: rows(r.atMax), flip: rows(r.flip),
    draws: { path: arr<any>(r.draws?.path).map((p) => ({ from: str(p.from), to: str(p.to), est: nums(p.est), p: nums(p.p) })), phantom: arr<unknown>(r.draws?.phantom).map(nums) },
    warnings: rStrings(r.warnings), engine: r.engine,
  };
}
export async function semsensR(c: CbCall, a: SemsensArgs): Promise<SemsensResult> {
  return parseSemsensOutput(await rCall<Record<string, any>>('ps_semsens', semsensReq(c, a), 'SEMsens'));
}
export const semsensScriptR = (c: CbCall, a: SemsensArgs) => rScript('ps_semsens', semsensReq(c, a), 'SEMsens');

// ---------- mediation::medsens ----------

export interface MedsensInput {
  variables: CpaVariable[]; x: string; m: string; y: string; covariates: string[];
  /** The grid step of rho (medsens rho.by) and the tolerance of its iterations (eps). */
  rhoBy: number; eps: number;
  confidence: number; seed: number;
}
export interface MedsensCurve { est: number[]; lo: number[]; hi: number[] }
/** Where an effect is zero: rho, and the products of the R² a confounder would explain (of the residual and of the total variances). */
export interface MedsensZero { rho: number | null; r2star: number | null; r2tilde: number | null }
export interface MedsensResult {
  n: number; rhoBy: number; eps: number; confidence: number; x: string; m: string; y: string; covariates: string[];
  /** The a and b paths, and the R² of the mediator and outcome equations. */
  a: number; b: number; r2m: number; r2y: number;
  rho: number[]; acme: MedsensCurve; ade: MedsensCurve; r2starProd: number[]; r2tildeProd: number[];
  acmeZero: MedsensZero; adeZero: MedsensZero;
  printed: string[]; warnings: string[]; engine: REngineInfo;
}

export function medsensRequest(data: Dataset, i: MedsensInput) {
  if (data.moments && data.cols.length === 0) throw new Error('Mediation sensitivity needs raw data; this dataset is a covariance matrix.');
  const used = new Set(i.variables.flatMap((v) => v.indicators));
  const keep = data.names.map((n, k) => [n, k] as const).filter(([n]) => used.has(n));
  return {
    variables: i.variables.map(({ name, indicators }) => ({ name, indicators })), x: i.x, m: i.m, y: i.y, covariates: i.covariates,
    rhoBy: i.rhoBy, eps: i.eps, confidence: i.confidence, seed: i.seed,
    data: { names: keep.map(([n]) => n), cols: keep.map(([, k]) => Array.from(data.cols[k], (v) => (Number.isNaN(v) ? null : v))) },
  };
}
const curve = (v: any): MedsensCurve => ({ est: nums(v?.est), lo: nums(v?.lo), hi: nums(v?.hi) });
const zero = (v: any): MedsensZero => ({ rho: first(v?.rho), r2star: first(v?.r2star), r2tilde: first(v?.r2tilde) });
export function parseMedsensOutput(r: Record<string, any>): MedsensResult {
  return {
    n: num(r.n), rhoBy: num(r.rhoBy), eps: num(r.eps), confidence: num(r.confidence), x: str(r.x), m: str(r.m), y: str(r.y), covariates: rStrings(r.covariates),
    a: num(r.a), b: num(r.b), r2m: num(r.r2m), r2y: num(r.r2y),
    rho: nums(r.rho), acme: curve(r.acme), ade: curve(r.ade), r2starProd: nums(r.r2starProd), r2tildeProd: nums(r.r2tildeProd),
    acmeZero: zero(r.acmeZero), adeZero: zero(r.adeZero), printed: rStrings(r.printed), warnings: rStrings(r.warnings), engine: r.engine,
  };
}
export async function medsensR(data: Dataset, i: MedsensInput): Promise<MedsensResult> {
  return parseMedsensOutput(await rCall<Record<string, any>>('ps_medsens', medsensRequest(data, i), 'mediation'));
}
export const medsensScriptR = (data: Dataset, i: MedsensInput) => rScript('ps_medsens', medsensRequest(data, i), 'mediation');
