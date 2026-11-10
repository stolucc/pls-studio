// Model search and modification for the CB-SEM model on the canvas (R/search.R): the specification search over
// optional arrows (as Amos), equivalent models confirmed by lavaan, EQS's multivariate LM and Wald tests, and
// regularised SEM (lslx).

import { rCall, rScript, rStrings } from './bridge';
import { rList, rNum } from './rjson';
import { cbCallRequest, type CbCall } from './cbExtras';
import type { ModelSpec } from '../engine/types';
import type { REngineInfo } from './lavaan';


/** An arrow of the diagram by the names of what it joins: a path (from → to) or a covariance of constructs or indicator errors. */
export type ArrowRef = { type: 'path'; from: string; to: string } | { type: 'cov'; kind: 'construct' | 'indicator'; a: string; b: string };

// ---------- specification search ----------

/** One model of the search: which optional arrows it keeps (in their order) and its fit. */
export interface SpecModel { keep: boolean[]; converged: boolean; npar: number | null; chisq: number | null; df: number | null; p: number | null; cfi: number | null; rmsea: number | null; aic: number | null; bic: number | null; warning: string | null }
export interface SpecSearchRaw { models: SpecModel[]; warnings: string[]; engine: REngineInfo }

export async function specSearchR(c: CbCall, optional: ArrowRef[]): Promise<SpecSearchRaw> {
  const r = await rCall<Record<string, any>>('ps_cb_specsearch', cbCallRequest(c, { optional }), 'lavaan');
  return {
    models: rList<Record<string, unknown>>(r.models).map((m) => ({
      keep: rList<boolean>(m.keep).map(Boolean), converged: m.converged === true, npar: rNum(m.npar), chisq: rNum(m.chisq), df: rNum(m.df), p: rNum(m.p),
      cfi: rNum(m.cfi), rmsea: rNum(m.rmsea), aic: rNum(m.aic), bic: rNum(m.bic), warning: typeof m.warning === 'string' ? m.warning : null,
    })),
    warnings: rStrings(r.warnings), engine: r.engine,
  };
}
export const specSearchScriptR = (c: CbCall, optional: ArrowRef[]) => rScript('ps_cb_specsearch', cbCallRequest(c, { optional }), 'lavaan');

// ---------- equivalent models ----------

/** An alternative's structural model: its paths and covariances (the rest of the model as in `c.spec`). */
export type ModelVariant = Pick<ModelSpec, 'paths' | 'covariances'>;
export interface VariantFit { converged: boolean; npar: number | null; chisq: number | null; df: number | null; logl: number | null }
export interface EquivalentFitsRaw { fits: VariantFit[]; warnings: string[]; engine: REngineInfo }
const variantsOf = (v: ModelVariant[]) => v.map((x) => ({ paths: x.paths, covariances: x.covariances ?? [] }));

/** The model (first) and each alternative, fitted alike. */
export async function equivalentFitsR(c: CbCall, variants: ModelVariant[]): Promise<EquivalentFitsRaw> {
  const r = await rCall<Record<string, any>>('ps_cb_equivalent', cbCallRequest(c, { variants: variantsOf(variants) }), 'lavaan');
  return {
    fits: rList<Record<string, unknown>>(r.fits).map((f) => ({ converged: f.converged === true, npar: rNum(f.npar), chisq: rNum(f.chisq), df: rNum(f.df), logl: rNum(f.logl) })),
    warnings: rStrings(r.warnings), engine: r.engine,
  };
}
export const equivalentFitsScriptR = (c: CbCall, variants: ModelVariant[]) => rScript('ps_cb_equivalent', cbCallRequest(c, { variants: variantsOf(variants) }), 'lavaan');

// ---------- multivariate LM and Wald tests (EQS) ----------

export type TestKind = 'loadings' | 'paths' | 'covariances';
/** One step: the parameter added (LM) or dropped (Wald), the multivariate statistic so far, its univariate increment, and the parameter's own statistic. */
export interface LmWaldStep { label: string; kind: 'loading' | 'path' | 'covariance'; lavaan: string; chisq: number; df: number; p: number; increment: number; incrementP: number; univariate: number | null; epc?: number | null; est?: number | null }
export interface LmWaldRaw { lm: { candidates: number; steps: LmWaldStep[] } | null; wald: { candidates: number; steps: LmWaldStep[] } | null; chisq: number | null; df: number | null; warnings: string[]; engine: REngineInfo }
export interface LmWaldRequest { lm: { kinds: TestKind[]; maxCandidates: number }; wald: { kinds: TestKind[] }; alpha: number }

const stepsOf = (v: unknown): LmWaldStep[] => rList<Record<string, unknown>>(v).map((s) => ({
  label: String(s.label), kind: s.kind as LmWaldStep['kind'], lavaan: String(s.lavaan), chisq: rNum(s.chisq) ?? NaN, df: rNum(s.df) ?? 0, p: rNum(s.p) ?? NaN,
  increment: rNum(s.increment) ?? NaN, incrementP: rNum(s.incrementP) ?? NaN, univariate: rNum(s.univariate), ...('epc' in s ? { epc: rNum(s.epc) } : {}), ...('est' in s ? { est: rNum(s.est) } : {}),
}));
export async function lmWaldR(c: CbCall, o: LmWaldRequest): Promise<LmWaldRaw> {
  const r = await rCall<Record<string, any>>('ps_cb_lmwald', cbCallRequest(c, o), 'lavaan');
  return {
    lm: r.lm ? { candidates: rNum(r.lm.candidates) ?? 0, steps: stepsOf(r.lm.steps) } : null,
    wald: r.wald ? { candidates: rNum(r.wald.candidates) ?? 0, steps: stepsOf(r.wald.steps) } : null,
    chisq: rNum(r.chisq), df: rNum(r.df), warnings: rStrings(r.warnings), engine: r.engine,
  };
}
export const lmWaldScriptR = (c: CbCall, o: LmWaldRequest) => rScript('ps_cb_lmwald', cbCallRequest(c, o), 'lavaan');

// ---------- regularised SEM (lslx) ----------

export type Penalty = 'lasso' | 'ridge' | 'enet' | 'mcp';
/** Elastic net: the lasso's share (0–1); MCP: the convexity (above 1, or 'Inf', the lasso). */
export type Delta = number | 'Inf';
export interface RegsemRequest {
  penalise: TestKind[]; penalty: Penalty; selector: 'bic' | 'aic'; deltas: Delta[];
  /** lslx's own grid of `length` levels (auto), or `length` equally spaced levels from `from` to `to`. */
  lambda: { auto: boolean; length: number; from: number; to: number };
}
/** One penalty level: λ, δ, the criteria (lslx's, per observation), non-zero coefficients, df, and the penalised estimates (in `penalised` order). */
export interface RegsemLevel { lambda: number; delta: number | null; aic: number | null; bic: number | null; nonzero: number | null; df: number | null; loss: number | null; converged: boolean; values: (number | null)[] }
export interface RegsemEstimate { label: string; kind: string; type: 'free' | 'pen'; est: number | null; se: number | null; z: number | null; p: number | null }
export interface RegsemRaw {
  method: Penalty; selector: 'bic' | 'aic'; selected: { lambda: number; delta: number | null }; path: RegsemLevel[]; penalised: string[]; penalisedKind: string[];
  estimates: RegsemEstimate[]; test: { chisq: number | null; df: number | null; p: number | null }; fitIndex: Record<string, number | null>; n: number; warnings: string[]; engine: REngineInfo;
}

export async function regsemR(c: CbCall, o: RegsemRequest): Promise<RegsemRaw> {
  const r = await rCall<Record<string, any>>('ps_cb_regsem', cbCallRequest(c, o), 'lslx');
  return {
    method: r.method, selector: r.selector, selected: { lambda: rNum(r.selected?.lambda) ?? NaN, delta: rNum(r.selected?.delta) },
    path: rList<Record<string, unknown>>(r.path).map((l) => ({ lambda: rNum(l.lambda) ?? NaN, delta: rNum(l.delta), aic: rNum(l.aic), bic: rNum(l.bic), nonzero: rNum(l.nonzero), df: rNum(l.df), loss: rNum(l.loss), converged: l.converged === true, values: rList<unknown>(l.values).map(rNum) })),
    penalised: rList<string>(r.penalised), penalisedKind: rList<string>(r.penalisedKind),
    estimates: rList<Record<string, unknown>>(r.estimates).map((e) => ({ label: String(e.label), kind: String(e.kind), type: e.type === 'pen' ? 'pen' : 'free', est: rNum(e.est), se: rNum(e.se), z: rNum(e.z), p: rNum(e.p) })),
    test: { chisq: rNum(r.test?.chisq), df: rNum(r.test?.df), p: rNum(r.test?.p) },
    fitIndex: Object.fromEntries(Object.entries((r.fitIndex ?? {}) as Record<string, unknown>).map(([k, v]) => [k, rNum(v)])), n: rNum(r.n) ?? 0,
    warnings: rStrings(r.warnings), engine: r.engine,
  };
}
export const regsemScriptR = (c: CbCall, o: RegsemRequest) => rScript('ps_cb_regsem', cbCallRequest(c, o), 'lslx');
