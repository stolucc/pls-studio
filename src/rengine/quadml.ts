// The integration card's engine (R/quadml.R): maximum likelihood by numerical integration for structural equation
// models with censored, count, categorical, survival or non-linearly modelled outcomes and continuous latent
// variables, with robust (MLR) standard errors. The model is the specification analyses/quadmlSyntax.ts builds from
// the card's Mplus syntax.

import type { QuadSpec } from '../analyses/quadmlSyntax';
import type { Dataset } from '../engine/types';
import { rCall, rScript, rStrings } from './bridge';
import type { REngineInfo } from './lavaan';

export interface QuadParam { lhs: string; op: string; rhs: string; est: number; se: number | null; fixed: boolean }
export interface QuadResult {
  n: number; logLik: number; npar: number; aic: number; bic: number;
  params: QuadParam[]; converged: boolean; theta: number[];
  /** The most dimensions of integration of a case, and the rule. */
  dims: number; integration: { type: 'rect' | 'gh' | 'mc'; points: number; adaptive: boolean };
  se: 'mlr' | 'ml';
  /** With MODEL PRIORS: the log prior density at the estimates (included in logLik, as Mplus prints it). */
  logPrior?: number | null;
  warnings: string[]; engine: REngineInfo;
}

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? v : v == null ? [] : [v]) as T[];
const columns = (data: Dataset, names: string[]) => {
  const keep = data.names.map((n, i) => [n, i] as const).filter(([n]) => names.includes(n));
  return { names: keep.map(([n]) => n), cols: keep.map(([, i]) => Array.from(data.cols[i], (v) => (Number.isNaN(v) ? null : v))) };
};
export const quadRequest = (data: Dataset, spec: QuadSpec) => ({ kind: 'quadml', spec, data: columns(data, spec.columns) });

export async function quadR(data: Dataset, spec: QuadSpec): Promise<QuadResult> {
  const raw = await rCall<Record<string, any>>('ps_quadml', quadRequest(data, spec), 'stats');
  return {
    ...raw, params: arr<any>(raw.params).map((p) => ({ ...p, rhs: p.rhs ?? '', se: typeof p.se === 'number' ? p.se : null })),
    theta: arr<number>(raw.theta), se: spec.se, warnings: rStrings(raw.warnings),
  } as QuadResult;
}
export const quadScriptR = (data: Dataset, spec: QuadSpec) => rScript('ps_quadml', quadRequest(data, spec), 'stats');
