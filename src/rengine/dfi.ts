// Dynamic fit index (DFI) cutoffs of the CB-SEM model on the canvas (R/dfi.R): the dynamic
// package (Wolf & McNeish, dynamicfit.app) run on the lavaan fit of the model as the Model tab
// fits it. The request names the dynamic function and its arguments; the result carries the
// package's tables as it prints them (character cells) and the simulated distributions behind
// them, so the view can draw the package's histograms.

import { rCall, rScript, rStrings } from './bridge';
import type { CbCall } from './cbExtras';
import { cbRequest, type REngineInfo } from './lavaan';

const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? v : v == null ? [] : [v]) as T[];
const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));

/** The dynamic functions the card calls (all take the lavaan fit; likert*, nnor* and DDDFI off the normal scale take the data too). */
export const DFI_FUNCTIONS = ['cfaOne', 'cfaHB', 'catOne', 'catHB', 'likertOne', 'likertHB', 'nnorOne', 'nnorHB', 'hier1HB', 'hier2', 'exactFit', 'equivTest', 'DDDFI'] as const;
export type DfiFn = (typeof DFI_FUNCTIONS)[number];
export type DfiScale = 'normal' | 'nonnormal' | 'categorical';
/** Estimators dynamic lets the simulations use (the package's own default when ''). */
export const DFI_ESTIMATORS = ['ML', 'MLR', 'MLM', 'MLMV', 'WLSMV', 'ULSMV', 'DWLS', 'WLS', 'ULS', 'GLS'] as const;
export type DfiEstimator = (typeof DFI_ESTIMATORS)[number];

export interface DfiArgs {
  fn: DfiFn;
  /** Replications per level (the package's default is 500; 250 for the categorical and Likert functions and DDDFI). */
  reps: number;
  /** The estimator used inside the simulations; '' = the function's default. */
  estimator: DfiEstimator | '';
  /** DDDFI: how the data are simulated. */
  scale: DfiScale;
  /** DDDFI: the mean absolute discrepancies tested (the package's default: .038, .05, .06). */
  mad: number[];
}

/** A table as the package prints it: row names, column names and character cells. */
export interface DfiTable { rows: string[]; columns: string[]; cells: string[][] }

export interface DfiResult {
  fn: DfiFn;
  reps: number | null;
  n: number;
  estimator: string | null;
  scale: DfiScale | null;
  /** The DFI cutoffs (every function but equivTest). */
  cutoffs: DfiTable | null;
  /** The package's "Empirical fit indices" row, as it prints it. */
  fit: DfiTable | null;
  /** The simulated fit indices behind the cutoffs: one column per index and level (SRMR_L0, …; exactFit: chisq, df, srmr, rmsea, cfi). */
  data: { names: string[]; cols: number[][] } | null;
  /** equivTest: the T-size indices and the adjusted bins, as printed. */
  equiv: { rmsea: string; cfi: string; rmseaBins: string[]; cfiBins: string[] } | null;
  /** print(dfi), line by line. */
  printed: string[];
  warnings: string[];
  engine: REngineInfo & { lavaan?: string };
}

const req = (c: CbCall, a: DfiArgs) => ({
  ...cbRequest(c.data, c.spec, c.missing, c.estimator, c.interaction),
  dfi: { fn: a.fn, reps: a.reps, ...(a.estimator ? { estimator: a.estimator } : {}), scale: a.scale, ...(a.fn === 'DDDFI' && a.mad.length ? { mad: a.mad } : {}) },
});

function table(v: unknown): DfiTable | null {
  if (!v || typeof v !== 'object') return null;
  const t = v as Record<string, unknown>;
  const rows = arr<unknown>(t.rows).map(str), columns = arr<unknown>(t.columns).map(str);
  const cells = arr<unknown>(t.cells).map((r) => arr<unknown>(r).map(str));
  return columns.length ? { rows, columns, cells } : null;
}

export function parseDfiOutput(r: Record<string, any>): DfiResult {
  const d = r.data && typeof r.data === 'object' ? r.data as Record<string, unknown> : null;
  const names = d ? arr<unknown>(d.names).map(str) : [];
  const colsRaw = d?.cols;
  const cols = names.map((n, i) => arr<unknown>(Array.isArray(colsRaw) ? colsRaw[i] : (colsRaw as Record<string, unknown> | undefined)?.[n]).map((x) => (typeof x === 'number' ? x : NaN)));
  const e = r.equiv && typeof r.equiv === 'object' ? r.equiv as Record<string, unknown> : null;
  return {
    fn: r.fn, reps: typeof r.reps === 'number' ? r.reps : null, n: Number(r.n), estimator: typeof r.estimator === 'string' ? r.estimator : null,
    scale: r.scale === 'nonnormal' || r.scale === 'categorical' || r.scale === 'normal' ? r.scale : null,
    cutoffs: table(r.cutoffs), fit: table(r.fit), data: names.length ? { names, cols } : null,
    equiv: e ? { rmsea: str(e.rmsea), cfi: str(e.cfi), rmseaBins: arr<unknown>(e.rmseaBins).map(str), cfiBins: arr<unknown>(e.cfiBins).map(str) } : null,
    printed: rStrings(r.printed), warnings: rStrings(r.warnings), engine: r.engine,
  };
}

export async function dfiR(c: CbCall, a: DfiArgs): Promise<DfiResult> {
  return parseDfiOutput(await rCall<Record<string, any>>('ps_dfi', req(c, a), 'dynamic'));
}
export const dfiScriptR = (c: CbCall, a: DfiArgs) => rScript('ps_dfi', req(c, a), 'dynamic');
