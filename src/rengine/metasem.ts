// Meta-analytic SEM (R/metasem.R ps_metasem): two-stage SEM by metaSEM on studies' correlation matrices, one row per
// study with its N and one column per pair of the model's observed variables. Desktop R only (OpenMx; DESKTOP_ONLY).

import type { Dataset, ModelSpec } from '../engine/types';
import { rCall, rScript, rStrings } from './bridge';
import type { REngineInfo } from './lavaan';

export interface MetaSemOptions { n: string; method: 'FEM' | 'REM'; reType: 'Diag' | 'Symm' | 'Zero' }
export interface MetaPooled { a: string; b: string; r: number; se: number; low?: number; high?: number; tau2?: number; i2?: number }
export interface MetaParam { label: string; kind: 'loading' | 'regression' | 'covariance' | 'variance' | 'other'; from: string; to: string; est: number; se: number; low: number; high: number; z: number; p: number }
export interface MetaSemResult {
  stage1: { method: 'FEM' | 'REM'; reType?: string; studies: number; totalN: number; pooled: MetaPooled[]; q?: number; qDf?: number; qP?: number; chisq?: number; df?: number; p?: number; rmsea?: number; srmr?: number; cfi?: number; status: number };
  stage2: { params: MetaParam[]; fit: Partial<Record<'n' | 'chisq' | 'df' | 'p' | 'baselineChisq' | 'baselineDf' | 'rmsea' | 'rmseaLow' | 'rmseaHigh' | 'srmr' | 'tli' | 'cfi' | 'aic' | 'bic', number>>; status: number };
  variables: string[];
  warnings: string[]; engine: REngineInfo & { openmx?: string; desktop?: string };
}

/** The model's observed variables, in the order the R side names them (each construct's indicators, first use). */
export const metaVariables = (spec: ModelSpec): string[] => [...new Set(spec.constructs.flatMap((c) => c.indicators))];

/** The pairs of variables in the bridge's order: (1,2), (1,3), …, (1,p), (2,3), … (the lower triangle by columns). */
export const metaPairs = (vars: string[]): [string, string][] => vars.flatMap((a, i) => vars.slice(i + 1).map((b) => [a, b] as [string, string]));

/**
 * The data column of each pair: named "A_B" or "B_A" (A and B the variables' names). `missing`: pairs with no column;
 * `ambiguous`: pairs whose name could also be another pair's (both columns present, or names that collide).
 */
export function metaColumns(names: string[], vars: string[]): { columns: (string | null)[]; missing: [string, string][]; ambiguous: [string, string][] } {
  const pairs = metaPairs(vars);
  const keys = pairs.map(([a, b]) => [...new Set([`${a}_${b}`, `${b}_${a}`])]);
  // (a name two pairs could both have: variables whose names contain underscores, "a_b" with "c" and "a" with "b_c")
  const count = new Map<string, number>();
  for (const k of keys.flat()) count.set(k, (count.get(k) ?? 0) + 1);
  const columns: (string | null)[] = [], missing: [string, string][] = [], ambiguous: [string, string][] = [];
  pairs.forEach((p, i) => {
    const found = keys[i].filter((k) => names.includes(k));
    if (found.length > 1 || found.some((k) => count.get(k)! > 1)) ambiguous.push(p);
    if (!found.length) missing.push(p);
    columns.push(found[0] ?? null);
  });
  return { columns, missing, ambiguous };
}

/** Why the data cannot be the studies (null when they can). */
export function metaDataProblem(data: Dataset, vars: string[], nCol: string): string | null {
  if (data.moments && data.cols.length === 0) return 'Meta-analytic SEM reads one row per study (N and correlations), not a covariance matrix.';
  if (!nCol) return 'Choose the column with each study’s N.';
  if (!data.names.includes(nCol)) return `Not in the data: ${nCol}.`;
  if (vars.length < 2) return 'The model needs at least two observed variables.';
  const m = metaColumns(data.names, vars);
  if (m.ambiguous.length) return `Ambiguous correlation columns for ${m.ambiguous.map(([a, b]) => `${a}–${b}`).join(', ')}: keep one column per pair.`;
  if (m.missing.length) return `No column for the correlation of ${m.missing.slice(0, 4).map(([a, b]) => `${a} and ${b} (name it ${a}_${b})`).join(', ')}${m.missing.length > 4 ? `, and ${m.missing.length - 4} more` : ''}.`;
  return null;
}

export function metaSemRequest(data: Dataset, spec: ModelSpec, o: MetaSemOptions) {
  const vars = metaVariables(spec);
  const why = metaDataProblem(data, vars, o.n);
  if (why) throw new Error(why);
  const cols = metaColumns(data.names, vars).columns.map((c) => data.cols[data.names.indexOf(c!)]);
  const nc = data.cols[data.names.indexOf(o.n)];
  const studies = Array.from(nc, (n, row) => {
    if (!Number.isFinite(n)) throw new Error(`Row ${row + 1} has no N.`);
    return { n, r: cols.map((c) => (Number.isFinite(c[row]) ? c[row] : null)) };
  });
  return { model: spec, meta: { method: o.method, reType: o.reType, studies } };
}

const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? v : v == null ? [] : [v]) as T[];
/** The reply as the card reads it (R's single values and empty lists normalised). */
export function metaSemResult(r: Record<string, any>): MetaSemResult {
  const clean = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0))) as T;
  return {
    stage1: { ...clean(r.stage1), pooled: arr<MetaPooled>(r.stage1?.pooled).map(clean) },
    stage2: { params: arr<MetaParam>(r.stage2?.params), fit: clean(r.stage2?.fit ?? {}), status: r.stage2?.status },
    variables: arr<string>(r.variables), warnings: rStrings(r.warnings), engine: r.engine,
  };
}

export async function metaSemR(data: Dataset, spec: ModelSpec, o: MetaSemOptions): Promise<MetaSemResult> {
  return metaSemResult(await rCall<Record<string, any>>('ps_metasem', metaSemRequest(data, spec, o), 'metaSEM'));
}
export const metaSemScriptR = (data: Dataset, spec: ModelSpec, o: MetaSemOptions) => rScript('ps_metasem', metaSemRequest(data, spec, o), 'metaSEM');
