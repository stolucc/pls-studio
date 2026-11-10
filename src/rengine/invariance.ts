// Measurement invariance cards (R/invariance.R): alignment optimisation for many
// groups (sirt) and moderated nonlinear factor analysis (mnlfa).

import type { Dataset, MissingTreatment } from '../engine/types';
import { rCall, rScript, rStrings } from './bridge';
import type { InvarianceResult, REngineInfo } from './lavaan';

/** A factor of the diagram: its name and indicators (data columns). */
export interface InvFactor { name: string; indicators: string[] }

/** Alignment (sirt::invariance.alignment) of the chosen factors across the groups of `group`. */
export interface AlignmentInput {
  factors: InvFactor[]; group: string;
  /** The alignment loss |x / scale|^power for loadings (lambda) and intercepts (nu): Asparouhov & Muthén's power 0.5 and scale 1. */
  power: { lambda: number; nu: number }; scale: { lambda: number; nu: number };
  /** invariance_alignment_constraints(): an aligned parameter within this distance of the joint value is invariant. */
  tolerance: { lambda: number; nu: number };
  /** sqrtN: groups weighted by sqrt(N) (Asparouhov & Muthén); equal: sirt's default without weights. */
  weights: 'sqrtN' | 'equal';
  estimator: 'ML' | 'MLR'; missing: MissingTreatment;
}
/** One side (loadings or intercepts) of invariance_alignment_constraints(). */
export interface AlignConstraints { tolerance: number; noninvariant: number; joint: number[]; dif: number[][]; unique: number[]; uniqueGroups: number[] }
export interface AlignedFactor {
  name: string; items: string[];
  /** groups × items: the configural (standardised-factor) values and the aligned ones. */
  lambda: number[][]; nu: number[][]; lambdaAligned: number[][]; nuAligned: number[][];
  /** Each group's aligned factor mean (alpha0) and standard deviation (psi0). */
  mean: number[]; sd: number[];
  r2: { lambda: number; nu: number }; sqrtU2: { lambda: number; nu: number }; rbar: { lambda: number; nu: number };
  fopt: number; converged: boolean;
  /** The first group's SD fixed at 1 (sirt's choice for few groups); otherwise the product of the SDs is 1. */
  fixed: boolean; lambdaConstraints: AlignConstraints; nuConstraints: AlignConstraints;
}
export interface AlignmentResult {
  groups: string[]; n: number[]; fit: { chisq: number; df: number; cfi: number; rmsea: number; srmr: number };
  factors: AlignedFactor[]; power: number[]; scale: number[]; weights: AlignmentInput['weights'];
  warnings: string[]; engine: REngineInfo & { lavaan?: string };
}

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? v : v == null ? [] : [v]) as T[];
/** A matrix from R (rows of numbers; one-element rows arrive unboxed). */
export const rows = (v: unknown): number[][] => arr<unknown>(v).map((r) => arr<number>(r).map((x) => (typeof x === 'number' ? x : NaN)));

/** The request: the named columns only (missing values as null); a covariance matrix cannot be used. */
export function invRequest(data: Dataset, kind: string, columns: string[], fields: object) {
  if (data.moments && data.cols.length === 0) throw new Error('This analysis needs raw data; the dataset is a covariance matrix.');
  const names = [...new Set(columns.filter(Boolean))];
  for (const n of names) if (!data.names.includes(n)) throw new Error(`“${n}” is not a column of the dataset.`);
  const keep = data.names.map((n, k) => [n, k] as const).filter(([n]) => names.includes(n));
  return { kind, ...fields, data: { names: keep.map(([n]) => n), cols: keep.map(([, k]) => Array.from(data.cols[k], (v) => (Number.isNaN(v) ? null : v))) } };
}

/** Group codes of a text column as its category names ("2" → "Pasteur"). */
const groupNames = (data: Dataset, column: string, labels: string[]) => {
  const cats = data.categories?.[column];
  return cats ? labels.map((l) => (/^\d+$/.test(l) ? cats[Number(l) - 1] ?? l : l)) : labels;
};

const alignCols = (i: AlignmentInput) => [...i.factors.flatMap((f) => f.indicators), i.group];
export const alignmentRequest = (data: Dataset, i: AlignmentInput) => invRequest(data, 'alignment', alignCols(i), i);
const constraints = (c: any): AlignConstraints => ({ tolerance: c.tolerance, noninvariant: c.noninvariant, joint: arr<number>(c.joint), dif: rows(c.dif), unique: arr<number>(c.unique), uniqueGroups: arr<number>(c.uniqueGroups) });

export async function alignmentR(data: Dataset, i: AlignmentInput): Promise<AlignmentResult> {
  const r = await rCall<Record<string, any>>('ps_alignment', alignmentRequest(data, i), 'sirt');
  return {
    ...r, groups: groupNames(data, i.group, rStrings(r.groups)), n: arr<number>(r.n), power: arr<number>(r.power), scale: arr<number>(r.scale),
    factors: arr<any>(r.factors).map((f) => ({
      ...f, items: rStrings(f.items), lambda: rows(f.lambda), nu: rows(f.nu), lambdaAligned: rows(f.lambdaAligned), nuAligned: rows(f.nuAligned),
      mean: arr<number>(f.mean), sd: arr<number>(f.sd), converged: f.converged === true, fixed: f.fixed === true, lambdaConstraints: constraints(f.lambdaConstraints), nuConstraints: constraints(f.nuConstraints),
    })),
    warnings: rStrings(r.warnings),
  } as AlignmentResult;
}
export const alignmentScriptR = (data: Dataset, i: AlignmentInput) => rScript('ps_alignment', alignmentRequest(data, i), 'sirt');

/** Moderated nonlinear factor analysis (mnlfa): one factor of binary items; each covariate in the roles it is listed in. */
export interface MnlfaInput {
  items: string[]; itemType: '1PL' | '2PL'; covariates: string[]; categorical: string[];
  /** Covariates moderating the item intercepts, the item slopes (2PL), the factor mean and its log SD. */
  intercept: string[]; slope: string[]; mean: string[]; sd: string[];
  /** The items whose intercepts and slopes are moderated (empty: all). */
  moderated: string[];
}
/** kind b: intercept, a: slope; term: "(Intercept)" or a covariate (dummy) term. */
export interface MnlfaItemParam { item: string; kind: 'a' | 'b'; term: string; est: number; free: boolean }
export interface MnlfaResult {
  itemType: MnlfaInput['itemType']; n: number; items: MnlfaItemParam[];
  /** mu: the factor mean's regression; sigma: the log SD's. */
  trait: { kind: 'mu' | 'sigma'; term: string; est: number }[];
  /** A model term: a continuous covariate, or a categorical covariate's dummy for one level (its category name). */
  terms: { term: string; covariate: string; level: string | null }[];
  fit: { deviance: number; logLik: number; npar: number; aic: number; bic: number; caic: number; aicc: number };
  iterations: number; converged: boolean; warnings: string[]; engine: REngineInfo;
}
export const mnlfaRequest = (data: Dataset, i: MnlfaInput) => invRequest(data, 'mnlfa', [...i.items, ...i.covariates], i);
export async function mnlfaR(data: Dataset, i: MnlfaInput): Promise<MnlfaResult> {
  const r = await rCall<Record<string, any>>('ps_mnlfa', mnlfaRequest(data, i), 'mnlfa');
  return {
    ...r, items: arr<MnlfaItemParam>(r.items), trait: arr<any>(r.trait),
    // (a categorical covariate's level code as its category name)
    terms: arr<any>(r.terms).map((t) => ({ ...t, level: t.level == null ? null : groupNames(data, t.covariate, [String(t.level)])[0] })),
    converged: r.converged === true, warnings: rStrings(r.warnings),
  } as MnlfaResult;
}
export const mnlfaScriptR = (data: Dataset, i: MnlfaInput) => rScript('ps_mnlfa', mnlfaRequest(data, i), 'mnlfa');

/** Longitudinal invariance of one factor: `occasions` holds the indicators at each occasion, item k of each the same item. */
export interface LongInvarianceInput { factor: string; occasions: string[][]; lag: 'all' | 'adjacent'; estimator: 'ML' | 'MLR'; missing: MissingTreatment }
/** The factor's mean and variance at one occasion (standard errors absent where fixed). */
export interface OccasionFactor { mean: number; meanSe?: number; variance: number; varianceSe?: number }
export interface LongInvarianceResult extends Omit<InvarianceResult, 'levels'> {
  levels: (InvarianceResult['levels'][number] & { factor: OccasionFactor[] })[];
  n: number; occasions: number; items: number; lag: LongInvarianceInput['lag']; engine: REngineInfo & { lavaan?: string };
}
export const longInvarianceRequest = (data: Dataset, i: LongInvarianceInput) => invRequest(data, 'longinvariance', i.occasions.flat(), i);
export async function longInvarianceR(data: Dataset, i: LongInvarianceInput): Promise<LongInvarianceResult> {
  const r = await rCall<Record<string, any>>('ps_long_invariance', longInvarianceRequest(data, i), 'lavaan');
  const opt = (v: unknown) => (typeof v === 'number' ? v : undefined);
  return {
    ...r, robust: r.robust === true, warnings: rStrings(r.warnings),
    levels: arr<any>(r.levels).map((l) => ({ ...l, factor: arr<any>(l.factor).map((f) => ({ mean: f.mean, variance: f.variance, ...(opt(f.meanSe) !== undefined ? { meanSe: f.meanSe } : {}), ...(opt(f.varianceSe) !== undefined ? { varianceSe: f.varianceSe } : {}) })) })),
  } as LongInvarianceResult;
}
export const longInvarianceScriptR = (data: Dataset, i: LongInvarianceInput) => rScript('ps_long_invariance', longInvarianceRequest(data, i), 'lavaan');

/**
 * Repeated items recognised from column names with an occasion suffix after "_" or "." (x1_t1, x1_t2; anx.1, anx.2;
 * item_w3): one indicator set per occasion, in occasion order, holding the items measured at every occasion (in the
 * order the columns first appear). Empty when fewer than two occasions or two items are found.
 */
export function detectOccasions(names: string[]): { occasions: string[][]; labels: string[] } {
  const re = /^(.+?)[_.](t|T|w|W|time|Time|wave|Wave)?(\d+)$/;
  const byOcc = new Map<number, Map<string, string>>(), stems: string[] = [];
  for (const n of names) {
    const m = re.exec(n);
    if (!m) continue;
    const occ = Number(m[3]);
    if (!byOcc.has(occ)) byOcc.set(occ, new Map());
    byOcc.get(occ)!.set(m[1], n);
    if (!stems.includes(m[1])) stems.push(m[1]);
  }
  const occs = [...byOcc.keys()].sort((a, b) => a - b);
  const common = stems.filter((s) => occs.every((o) => byOcc.get(o)!.has(s)));
  if (occs.length < 2 || common.length < 2) return { occasions: [], labels: [] };
  return { occasions: occs.map((o) => common.map((s) => byOcc.get(o)!.get(s)!)), labels: occs.map(String) };
}
