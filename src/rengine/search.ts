// Model search and modification for the CB-SEM model on the canvas (R/search.R): the specification search over
// optional arrows (as Amos), equivalent models confirmed by lavaan, EQS's multivariate LM and Wald tests, and
// regularised SEM (lslx).

import { rCall, rScript, rStrings } from './bridge';
import type { CbCall } from './cbExtras';
import { cbRequest, type REngineInfo } from './lavaan';

const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? v : v == null ? [] : [v]) as T[];
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const req = (c: CbCall, extra: object) => ({ ...cbRequest(c.data, c.spec, c.missing, c.estimator, c.interaction), ...extra });

/** An arrow of the diagram by the names of what it joins: a path (from → to) or a covariance of constructs or indicator errors. */
export type ArrowRef = { type: 'path'; from: string; to: string } | { type: 'cov'; kind: 'construct' | 'indicator'; a: string; b: string };

// ---------- specification search ----------

/** One model of the search: which optional arrows it keeps (in their order) and its fit. */
export interface SpecModel { keep: boolean[]; converged: boolean; npar: number | null; chisq: number | null; df: number | null; p: number | null; cfi: number | null; rmsea: number | null; aic: number | null; bic: number | null; warning: string | null }
export interface SpecSearchRaw { models: SpecModel[]; warnings: string[]; engine: REngineInfo }

export async function specSearchR(c: CbCall, optional: ArrowRef[]): Promise<SpecSearchRaw> {
  const r = await rCall<Record<string, any>>('ps_cb_specsearch', req(c, { optional }), 'lavaan');
  return {
    models: arr<Record<string, unknown>>(r.models).map((m) => ({
      keep: arr<boolean>(m.keep).map(Boolean), converged: m.converged === true, npar: num(m.npar), chisq: num(m.chisq), df: num(m.df), p: num(m.p),
      cfi: num(m.cfi), rmsea: num(m.rmsea), aic: num(m.aic), bic: num(m.bic), warning: typeof m.warning === 'string' ? m.warning : null,
    })),
    warnings: rStrings(r.warnings), engine: r.engine,
  };
}
export const specSearchScriptR = (c: CbCall, optional: ArrowRef[]) => rScript('ps_cb_specsearch', req(c, { optional }), 'lavaan');
