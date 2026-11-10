// CB-SEM diagnostics of the model on the canvas (R/cbdiag.R): local fit
// (residual z-tests per pair of observed variables, the SRMR's tests and further
// tests of exact fit).

import { rCall, rScript, rStrings } from './bridge';
import type { CbCall } from './cbExtras';
import { cbRequest, type REngineInfo } from './lavaan';

const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? v : v == null ? [] : [v]) as T[];
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
const rows = (m: unknown) => arr<unknown>(m).map((r) => arr<unknown>(r).map(num));
const req = (c: CbCall, extra: object) => ({ ...cbRequest(c.data, c.spec, c.missing, c.estimator, c.interaction), ...extra });
const out = (r: Record<string, any>) => ({ warnings: rStrings(r.warnings), engine: r.engine as REngineInfo });

// ---------- local fit ----------

/** lavaan's further tests of exact fit (lavTest names), in the order the card lists them. */
export const LOCALFIT_TESTS = ['browne.residual.nt.model', 'browne.residual.nt', 'browne.residual.adf', 'satorra.bentler', 'yuan.bentler',
  'mean.var.adjusted', 'scaled.shifted', 'mean.var.adjusted.corrected', 'scaled.shifted.corrected', 'peba4', 'pols3', 'pall'] as const;
export type LocalFitTest = (typeof LOCALFIT_TESTS)[number];
/** The tests that rescale a base statistic, or (FMG) take its p-value: the base (ML χ² or Browne's RLS) applies to them. */
export const SCALED_TESTS: readonly LocalFitTest[] = ['satorra.bentler', 'yuan.bentler', 'mean.var.adjusted', 'scaled.shifted', 'mean.var.adjusted.corrected', 'scaled.shifted.corrected', 'peba4', 'pols3', 'pall'];
export interface LocalFitRequest { tests: LocalFitTest[]; base: 'standard' | 'RLS' }

export interface SrmrSummary { srmr: number | null; se: number | null; z: number | null; p: number | null; usrmr: number | null; usrmrSe: number | null; low: number | null; high: number | null; h0: number | null; closeZ: number | null; closeP: number | null }
/** One group's residuals (lavaan names mapped back to the app's). */
export interface LocalFitBlock {
  label: string; names: string[];
  /** Residual correlations (Bentler's metric), their standard errors and z = residual / SE. */
  residual: (number | null)[][]; se: (number | null)[][]; z: (number | null)[][];
  /** Normalized residuals (null when lavaan has none for this model). */
  normalized: (number | null)[][] | null;
  /** Mean (intercept) residuals, when the model has a mean structure that does not reproduce them exactly. */
  means: { names: string[]; residual: (number | null)[]; se: (number | null)[]; z: (number | null)[] } | null;
  summary: SrmrSummary;
}
export interface LocalFitTestRow { test: string; label: string | null; stat: number | null; df: number | null; p: number | null; scaling: number | null; shift: number | null; base: string | null; error: string | null; warning: string | null }
export interface LocalFitResult { blocks: LocalFitBlock[]; tests: LocalFitTestRow[]; base: 'standard' | 'RLS'; estimator: string; n: number; warnings: string[]; engine: REngineInfo }

const srmr = (s: any): SrmrSummary => ({ srmr: num(s?.srmr), se: num(s?.se), z: num(s?.z), p: num(s?.p), usrmr: num(s?.usrmr), usrmrSe: num(s?.usrmrSe), low: num(s?.low), high: num(s?.high), h0: num(s?.h0), closeZ: num(s?.closeZ), closeP: num(s?.closeP) });

/** The R result as the card keeps it. */
export function parseLocalFit(r: Record<string, any>): LocalFitResult {
  return {
    blocks: arr<any>(r.blocks).map((b) => ({
      label: typeof b.label === 'string' ? b.label : '', names: arr<string>(b.names), residual: rows(b.residual), se: rows(b.se), z: rows(b.z),
      normalized: b.normalized == null ? null : rows(b.normalized),
      means: b.means ? { names: arr<string>(b.means.names), residual: arr<unknown>(b.means.residual).map(num), se: arr<unknown>(b.means.se).map(num), z: arr<unknown>(b.means.z).map(num) } : null,
      summary: srmr(b.summary),
    })),
    tests: arr<any>(r.tests).map((t) => ({ test: String(t.test), label: str(t.label), stat: num(t.stat), df: num(t.df), p: num(t.p), scaling: num(t.scaling), shift: num(t.shift), base: str(t.base), error: str(t.error), warning: str(t.warning) })),
    base: r.base === 'RLS' ? 'RLS' : 'standard', estimator: String(r.estimator ?? ''), n: Number(r.n) || 0, ...out(r),
  };
}
export async function localFitR(c: CbCall, o: LocalFitRequest): Promise<LocalFitResult> {
  return parseLocalFit(await rCall<Record<string, any>>('ps_cb_localfit', req(c, { localfit: o }), 'lavaan'));
}
export const localFitScriptR = (c: CbCall, o: LocalFitRequest) => rScript('ps_cb_localfit', req(c, { localfit: o }), 'lavaan');

/** The pairs of observed variables in one group, largest |z| first (the diagonal, structurally zero, left out). */
export function largestResiduals(b: LocalFitBlock, by: 'z' | 'normalized' = 'z'): { a: string; b: string; residual: number | null; se: number | null; z: number }[] {
  const m = by === 'normalized' && b.normalized ? b.normalized : b.z;
  const pairs: { a: string; b: string; residual: number | null; se: number | null; z: number }[] = [];
  for (let i = 1; i < b.names.length; i++) for (let j = 0; j < i; j++) {
    const z = m[i]?.[j];
    if (z !== null && z !== undefined && Number.isFinite(z)) pairs.push({ a: b.names[j], b: b.names[i], residual: b.residual[i]?.[j] ?? null, se: b.se[i]?.[j] ?? null, z });
  }
  return pairs.sort((x, y) => Math.abs(y.z) - Math.abs(x.z));
}
