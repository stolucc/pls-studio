// The custom likelihood card (R/customml.R): maximum likelihood for a nominal, normal or probit model whose parts
// are expressions of named parameters and of data columns (definition variables).

import type { Dataset } from '../engine/types';
import { parseExpr, namesIn } from '../model/expr';
import { rCall, rScript, rStrings } from './bridge';
import type { REngineInfo } from './lavaan';

export type CustomMlType = 'nominal' | 'normal' | 'probit';
export interface CustomMlInput {
  type: CustomMlType;
  outcomes: string[];
  parameters: { name: string; start: number }[];
  /** nominal: the logit of each category against the last, in the categories' order. */
  logits: string[];
  /** normal: the outcomes' means; probit: their thresholds. One per outcome. */
  means: string[];
  variances: string[];
  /** One per pair of outcomes, (1,2), (1,3), (2,3), …; empty: 0. */
  covariances: string[];
  defined: { name: string; expr: string }[];
  /** Observed information; the sandwich (MLR); or the sandwich with Mplus's information under MODEL CONSTRAINT (its MLR). */
  se: 'model' | 'robust' | 'mplus';
}
export interface CustomMlQuantity { name: string; kind: 'part' | 'defined'; est: number | null; se: number | null; expr: string }
export interface CustomMlResult {
  type: CustomMlType; outcomes: string[]; n: number; converged: boolean; se: 'model' | 'robust' | 'mplus';
  /** se 'mplus': Mplus's MLR scaling correction factor (the trace of the bread times the meat, over the parameters). */
  scaling?: number;
  parameters: { name: string; est: number; se: number; start: number }[];
  parts: CustomMlQuantity[]; defined: CustomMlQuantity[]; categories: number[] | null;
  fit: { logLik: number; npar: number; aic: number; bic: number };
  warnings: string[]; engine: REngineInfo;
}

/** The functions an expression may call (besides + − * / ^ and parentheses). */
export const CUSTOM_ML_FUNCTIONS = ['exp', 'log', 'sqrt'] as const;

/** Check an expression's grammar; the names it uses. Throws with a readable message. */
export function customMlNames(src: string): string[] {
  // (a call of exp, log or sqrt has the grammar of a parenthesised expression)
  const plain = src.replace(/\b(exp|log|sqrt)\s*\(/g, '(');
  return namesIn(parseExpr(plain)).filter((n) => !(CUSTOM_ML_FUNCTIONS as readonly string[]).includes(n));
}

/** Every expression of the model, with what it is. */
export function customMlExpressions(o: CustomMlInput): [string, string][] {
  if (o.type === 'nominal') return o.logits.map((e, k) => [`the logit of category ${k + 1}`, e]);
  const loc = o.type === 'probit' ? 'threshold' : 'mean';
  return [...o.means.map((e, j): [string, string] => [`the ${loc} of ${o.outcomes[j] ?? j + 1}`, e]), ...o.variances.map((e, j): [string, string] => [`the variance of ${o.outcomes[j] ?? j + 1}`, e]),
    ...o.covariances.map((e, k): [string, string] => [`covariance ${k + 1}`, e]).filter(([, e]) => e.trim() !== '')];
}

/** The data columns the model's expressions use (definition variables). */
export function customMlColumns(o: CustomMlInput, columns: string[]): string[] {
  const pars = new Set(o.parameters.map((p) => p.name));
  const used = new Set<string>();
  for (const [, e] of customMlExpressions(o)) { try { for (const n of customMlNames(e)) if (!pars.has(n) && columns.includes(n)) used.add(n); } catch { /* reported by blocked */ } }
  return [...o.outcomes, ...[...used].filter((n) => !o.outcomes.includes(n))];
}

export function customMlRequest(data: Dataset, o: CustomMlInput) {
  if (data.moments && data.cols.length === 0) throw new Error('The custom likelihood needs raw data.');
  const cols = customMlColumns(o, data.names);
  const keep = cols.map((n) => [n, data.names.indexOf(n)] as const);
  if (keep.some(([, k]) => k < 0)) throw new Error('A column of the model is not in the data.');
  return { ...o, data: { names: keep.map(([n]) => n), cols: keep.map(([, k]) => Array.from(data.cols[k], (v) => (Number.isNaN(v) ? null : v))) } };
}

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? v : v == null ? [] : [v]) as T[];
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export async function customMlR(data: Dataset, o: CustomMlInput): Promise<CustomMlResult> {
  const raw = await rCall<Record<string, any>>('ps_customml', customMlRequest(data, o), 'customml');
  const q = (x: any): CustomMlQuantity => ({ name: x.name, kind: x.kind, est: num(x.est), se: num(x.se), expr: x.expr });
  return {
    type: raw.type, outcomes: arr<string>(raw.outcomes), n: raw.n, converged: !!raw.converged, se: raw.se,
    parameters: arr<any>(raw.parameters).map((p) => ({ name: p.name, est: p.est, se: p.se, start: p.start })),
    parts: arr<any>(raw.parts).map(q), defined: arr<any>(raw.defined).map(q), categories: raw.categories ? arr<number>(raw.categories) : null,
    fit: raw.fit, warnings: rStrings(raw.warnings), engine: raw.engine, ...(num(raw.scaling) !== null ? { scaling: num(raw.scaling)! } : {}),
  };
}
export const customMlScriptR = (data: Dataset, o: CustomMlInput) => rScript('ps_customml', customMlRequest(data, o), 'customml');

/** The Bayesian multivariate regression card (R/customml.R, ps_bmvreg): flat priors, the exact posterior. */
export interface BmvregInput { outcomes: string[]; predictors: string[]; draws: number; seed: number }
export interface BmvregParameter { name: string; median: number; mean: number; sd: number; lower: number; upper: number; pOne: number; exact: boolean }
export interface BmvregResult { n: number; k: number; df: number; draws: number; seed: number; outcomes: string[]; predictors: string[]; parameters: BmvregParameter[]; warnings: string[]; engine: REngineInfo }

export function bmvregRequest(data: Dataset, o: BmvregInput) {
  if (data.moments && data.cols.length === 0) throw new Error('The Bayesian multivariate regression needs raw data.');
  const cols = [...o.outcomes, ...o.predictors];
  const keep = cols.map((n) => [n, data.names.indexOf(n)] as const);
  if (keep.some(([, k]) => k < 0)) throw new Error('A column of the model is not in the data.');
  return { ...o, data: { names: cols, cols: keep.map(([, k]) => Array.from(data.cols[k], (v) => (Number.isNaN(v) ? null : v))) } };
}
export async function bmvregR(data: Dataset, o: BmvregInput): Promise<BmvregResult> {
  const raw = await rCall<Record<string, any>>('ps_bmvreg', bmvregRequest(data, o), 'customml');
  return { ...raw, outcomes: arr<string>(raw.outcomes), predictors: arr<string>(raw.predictors), parameters: arr<BmvregParameter>(raw.parameters), warnings: rStrings(raw.warnings) } as BmvregResult;
}
export const bmvregScriptR = (data: Dataset, o: BmvregInput) => rScript('ps_bmvreg', bmvregRequest(data, o), 'customml');
