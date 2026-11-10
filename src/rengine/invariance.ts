// Measurement invariance cards (R/invariance.R): alignment optimisation for many
// groups (sirt).

import type { Dataset, MissingTreatment } from '../engine/types';
import { rCall, rScript, rStrings } from './bridge';
import type { REngineInfo } from './lavaan';

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
