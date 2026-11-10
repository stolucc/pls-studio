// Model search and modification for the CB-SEM model on the canvas (R/search.R): the specification search over
// optional arrows (as Amos), equivalent models confirmed by lavaan, EQS's multivariate LM and Wald tests, and
// regularised SEM (lslx).

import { rCall, rScript, rStrings } from './bridge';
import type { CbCall } from './cbExtras';
import type { ModelSpec } from '../engine/types';
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

// ---------- equivalent models ----------

/** An alternative's structural model: its paths and covariances (the rest of the model as in `c.spec`). */
export type ModelVariant = Pick<ModelSpec, 'paths' | 'covariances'>;
export interface VariantFit { converged: boolean; npar: number | null; chisq: number | null; df: number | null; logl: number | null }
export interface EquivalentFitsRaw { fits: VariantFit[]; warnings: string[]; engine: REngineInfo }
const variantsOf = (v: ModelVariant[]) => v.map((x) => ({ paths: x.paths, covariances: x.covariances ?? [] }));

/** The model (first) and each alternative, fitted alike. */
export async function equivalentFitsR(c: CbCall, variants: ModelVariant[]): Promise<EquivalentFitsRaw> {
  const r = await rCall<Record<string, any>>('ps_cb_equivalent', req(c, { variants: variantsOf(variants) }), 'lavaan');
  return {
    fits: arr<Record<string, unknown>>(r.fits).map((f) => ({ converged: f.converged === true, npar: num(f.npar), chisq: num(f.chisq), df: num(f.df), logl: num(f.logl) })),
    warnings: rStrings(r.warnings), engine: r.engine,
  };
}
export const equivalentFitsScriptR = (c: CbCall, variants: ModelVariant[]) => rScript('ps_cb_equivalent', req(c, { variants: variantsOf(variants) }), 'lavaan');

// ---------- multivariate LM and Wald tests (EQS) ----------

export type TestKind = 'loadings' | 'paths' | 'covariances';
/** One step: the parameter added (LM) or dropped (Wald), the multivariate statistic so far, its univariate increment, and the parameter's own statistic. */
export interface LmWaldStep { label: string; kind: 'loading' | 'path' | 'covariance'; lavaan: string; chisq: number; df: number; p: number; increment: number; incrementP: number; univariate: number | null; epc?: number | null; est?: number | null }
export interface LmWaldRaw { lm: { candidates: number; steps: LmWaldStep[] } | null; wald: { candidates: number; steps: LmWaldStep[] } | null; chisq: number | null; df: number | null; warnings: string[]; engine: REngineInfo }
export interface LmWaldRequest { lm: { kinds: TestKind[]; maxCandidates: number }; wald: { kinds: TestKind[] }; alpha: number }

const stepsOf = (v: unknown): LmWaldStep[] => arr<Record<string, unknown>>(v).map((s) => ({
  label: String(s.label), kind: s.kind as LmWaldStep['kind'], lavaan: String(s.lavaan), chisq: num(s.chisq) ?? NaN, df: num(s.df) ?? 0, p: num(s.p) ?? NaN,
  increment: num(s.increment) ?? NaN, incrementP: num(s.incrementP) ?? NaN, univariate: num(s.univariate), ...('epc' in s ? { epc: num(s.epc) } : {}), ...('est' in s ? { est: num(s.est) } : {}),
}));
export async function lmWaldR(c: CbCall, o: LmWaldRequest): Promise<LmWaldRaw> {
  const r = await rCall<Record<string, any>>('ps_cb_lmwald', req(c, o), 'lavaan');
  return {
    lm: r.lm ? { candidates: num(r.lm.candidates) ?? 0, steps: stepsOf(r.lm.steps) } : null,
    wald: r.wald ? { candidates: num(r.wald.candidates) ?? 0, steps: stepsOf(r.wald.steps) } : null,
    chisq: num(r.chisq), df: num(r.df), warnings: rStrings(r.warnings), engine: r.engine,
  };
}
export const lmWaldScriptR = (c: CbCall, o: LmWaldRequest) => rScript('ps_cb_lmwald', req(c, o), 'lavaan');
