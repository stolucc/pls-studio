// Validity checks (R/validity.R): common method bias (Harman's single-factor test with
// psych, Kock's full-collinearity VIFs in base R) and the content validity index (base R).

import type { Dataset } from '../engine/types';
import { rCall, rScript, rStrings } from './bridge';
import type { REngineInfo } from './lavaan';

/** `vars`: the columns of `data` analysed (data columns, the model's indicators, or the PLS construct scores). */
export interface CmbInput { type: 'harman' | 'vif'; vars: string[]; extraction: 'pca' | 'fa' }
export interface CmbResult {
  type: CmbInput['type']; vars: string[]; n: number;
  /** Harman: the single factor's share of the total variance, its sum of squared loadings, the eigenvalues of the correlation matrix (and each one's share), how many exceed 1, and the loadings on the single factor. */
  extraction?: CmbInput['extraction']; share?: number; ssLoadings?: number; eigenvalues?: number[]; proportions?: number[]; kaiser?: number; loadings?: { variable: string; loading: number }[];
  /** Full collinearity: each variable's VIF and R² on all the others. */
  rows?: { variable: string; vif: number; r2: number }[]; maxVif?: number;
  warnings: string[]; engine: REngineInfo;
}

/** One row per item, one column per expert (`raters`); `item`: an optional column naming the items; a rating at or above `threshold` is relevant. */
export interface CviInput { raters: string[]; item: string; threshold: number }
export interface CviItem { item: string; n: number; agree: number; icvi: number; pc: number; kappa: number }
export interface CviResult {
  experts: string[]; threshold: number; nItems: number; items: CviItem[]; scviAve: number; scviUA: number;
  expertProportions: { expert: string; proportion: number; rated: number }[];
  warnings: string[]; engine: REngineInfo;
}

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? v : v == null ? [] : [v]) as T[];

/** The request: the named columns only (missing values as null) and the category names of text columns. */
function request(data: Dataset, kind: string, columns: string[], fields: object) {
  if (data.moments && data.cols.length === 0) throw new Error('This analysis needs raw data; the dataset is a covariance matrix.');
  const names = [...new Set(columns.filter(Boolean))];
  for (const n of names) if (!data.names.includes(n)) throw new Error(`“${n}” is not a column of the dataset.`);
  const keep = data.names.map((n, k) => [n, k] as const).filter(([n]) => names.includes(n));
  const categories = Object.fromEntries(names.filter((c) => data.categories?.[c]).map((c) => [c, data.categories![c]]));
  return { kind, ...fields, categories, data: { names: keep.map(([n]) => n), cols: keep.map(([, k]) => Array.from(data.cols[k], (v) => (Number.isNaN(v) ? null : v))) } };
}

const cmbPackage = (i: CmbInput) => (i.type === 'harman' ? 'psych' as const : 'stats' as const);
export const cmbRequest = (d: Dataset, i: CmbInput) => request(d, 'cmb', i.vars, i);
export async function cmbR(d: Dataset, i: CmbInput): Promise<CmbResult> {
  const r = await rCall<Record<string, any>>('ps_cmb', cmbRequest(d, i), cmbPackage(i));
  return { ...r, vars: arr<string>(r.vars), ...(r.type === 'harman' ? { eigenvalues: arr<number>(r.eigenvalues), proportions: arr<number>(r.proportions), loadings: arr(r.loadings) } : { rows: arr(r.rows) }), warnings: rStrings(r.warnings) } as CmbResult;
}
export const cmbScriptR = (d: Dataset, i: CmbInput) => rScript('ps_cmb', cmbRequest(d, i), cmbPackage(i));

export const cviRequest = (d: Dataset, i: CviInput) => request(d, 'cvi', [i.item, ...i.raters], i);
export async function cviR(d: Dataset, i: CviInput): Promise<CviResult> {
  const r = await rCall<Record<string, any>>('ps_cvi', cviRequest(d, i), 'stats');
  return { ...r, experts: arr<string>(r.experts), items: arr<CviItem>(r.items), expertProportions: arr(r.expertProportions), warnings: rStrings(r.warnings) } as CviResult;
}
export const cviScriptR = (d: Dataset, i: CviInput) => rScript('ps_cvi', cviRequest(d, i), 'stats');
