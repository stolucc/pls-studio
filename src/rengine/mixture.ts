// The mixture model card's engine (R/mixture.R): a general finite mixture likelihood fitted by maximum likelihood
// from random starts, with robust (MLR) standard errors. The model is the specification analyses/mixtureSyntax.ts
// builds from the card's Mplus-style syntax.

import type { MixtureSpec } from '../analyses/mixtureSyntax';
import type { Dataset } from '../engine/types';
import { rCall, rScript, rStrings } from './bridge';
import type { REngineInfo } from './lavaan';

/** A printed parameter: `at` the class of each latent class variable it belongs to (0: the same in all of its classes). */
export interface MixtureParam { lhs: string; op: string; rhs: string; at: number[]; est: number; se: number | null; fixed: boolean }
export interface MixtureResult {
  /** Cases (the sum of the frequency weights) and data rows used (identical cases collapsed). */
  n: number; rows: number;
  logLik: number; npar: number; aic: number; bic: number;
  params: MixtureParam[];
  /** Each latent class variable's class shares (posterior). */
  classes: { name: string; k: number; shares: number[] }[];
  /** The joint classes (one class of each variable) and their shares. */
  patterns: { classes: number[]; share: number }[];
  entropy: number | null;
  /** The log-likelihoods the final-stage starts reached, best first. */
  lls: number[];
  converged: boolean;
  /** The free parameters at the maximum (to start a refit from, e.g. with the classes in another order). */
  theta: number[];
  warnings: string[]; engine: REngineInfo;
}

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? v : v == null ? [] : [v]) as T[];
const columns = (data: Dataset, names: string[]) => {
  const keep = data.names.map((n, i) => [n, i] as const).filter(([n]) => names.includes(n));
  return { names: keep.map(([n]) => n), cols: keep.map(([, i]) => Array.from(data.cols[i], (v) => (Number.isNaN(v) ? null : v))) };
};
export const mixtureRequest = (data: Dataset, spec: MixtureSpec) => ({ kind: 'mixture', spec, data: columns(data, spec.columns) });

export async function mixtureR(data: Dataset, spec: MixtureSpec): Promise<MixtureResult> {
  const raw = await rCall<Record<string, any>>('ps_mixture', mixtureRequest(data, spec), 'stats');
  return {
    ...raw, params: arr<any>(raw.params).map((p) => ({ ...p, rhs: p.rhs ?? '', at: arr<number>(p.at), se: typeof p.se === 'number' ? p.se : null })),
    classes: arr<any>(raw.classes).map((c) => ({ name: c.name, k: c.k, shares: arr<number>(c.shares) })),
    patterns: arr<any>(raw.patterns).map((p) => ({ classes: arr<number>(p.classes), share: p.share })),
    lls: arr<number>(raw.lls), theta: arr<number>(raw.theta), entropy: typeof raw.entropy === 'number' ? raw.entropy : null,
    warnings: rStrings(raw.warnings),
  } as MixtureResult;
}
export const mixtureScriptR = (data: Dataset, spec: MixtureSpec) => rScript('ps_mixture', mixtureRequest(data, spec), 'stats');
