// Endogeneity (R/endo.R): instrumental variables, Gaussian copula, Lewbel's
// heteroskedasticity-based and higher-moment instruments, Heckman selection.

import type { Dataset } from '../engine/types';
import { rCall, rScript, rStrings } from './bridge';
import type { REngineInfo } from './lavaan';

export type EndoMethod = 'iv' | 'copula' | 'het' | 'hm' | 'liv' | 'heckman';
export type HmType = 'g' | 'gp' | 'gy' | 'yp' | 'p2' | 'y2';
export interface EndoInput {
  method: EndoMethod;
  outcome: string; exogenous: string[]; endogenous: string[];
  /** External instruments (method 'iv'). */
  instruments: string[];
  /** Exogenous regressors that build the internal instruments ('het', 'hm'). */
  hetRegressors: string[];
  hmTypes: HmType[];
  /** Heckman: the selection indicator (non-zero = selected) and its regressors. */
  selection: { outcome: string; regressors: string[] };
  heckmanMethod: 'ml' | '2step';
  boot: { samples: number; seed: number; confidence: number };
}
export interface EndoCoef { term: string; equation?: string; est: number; se: number | null; stat: number | null; p: number | null; ciLow: number | null; ciHigh: number | null }
export interface EndoResult {
  method: EndoMethod; n: number;
  coefficients: EndoCoef[]; ols: EndoCoef[];
  diagnostics: { test: string; df1: number; df2: number; stat: number; p: number }[];
  normality: { variable: string; p: number }[]; heteroskedasticity: { variable: string; p: number }[];
  selection: { selected: number; total: number } | null;
  boot: { samples: number; confidence: number } | null;
  warnings: string[]; engine: REngineInfo;
}

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? v : v == null ? [] : [v]) as T[];
const n0 = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const coefs = (v: unknown): EndoCoef[] => arr<any>(v).map((c) => ({ term: c.term, ...(c.equation ? { equation: c.equation } : {}), est: c.est, se: n0(c.se), stat: n0(c.stat), p: n0(c.p), ciLow: n0(c.ciLow), ciHigh: n0(c.ciHigh) }));
const columns = (data: Dataset, names: string[]) => {
  const keep = data.names.map((n, i) => [n, i] as const).filter(([n]) => names.includes(n));
  return { names: keep.map(([n]) => n), cols: keep.map(([, i]) => Array.from(data.cols[i], (v) => (Number.isNaN(v) ? null : v))) };
};
const used = (i: EndoInput) => i.method === 'heckman'
  ? [i.outcome, ...i.exogenous, i.selection.outcome, ...i.selection.regressors]
  : [i.outcome, ...i.exogenous, ...i.endogenous, ...(i.method === 'iv' ? i.instruments : [])];
export const endoRequest = (data: Dataset, i: EndoInput) => {
  if (data.moments && data.cols.length === 0) throw new Error('These methods need raw data; this dataset is a covariance matrix.');
  return { ...i, data: columns(data, used(i).filter(Boolean)) };
};
const pkg = (i: EndoInput) => (i.method === 'heckman' ? 'sampleSelection' : i.method === 'liv' ? 'optimx' : 'ivreg');

export async function endoR(data: Dataset, input: EndoInput): Promise<EndoResult> {
  const raw = await rCall<Record<string, any>>('ps_endo', endoRequest(data, input), pkg(input));
  return {
    method: raw.method, n: raw.n, coefficients: coefs(raw.coefficients), ols: coefs(raw.ols),
    diagnostics: arr(raw.diagnostics), normality: arr(raw.normality), heteroskedasticity: arr(raw.heteroskedasticity),
    selection: raw.selection ?? null, boot: raw.boot ?? null, warnings: rStrings(raw.warnings), engine: raw.engine,
  };
}
export const endoScriptR = (data: Dataset, input: EndoInput) => rScript('ps_endo', endoRequest(data, input), pkg(input));
