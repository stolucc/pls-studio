// Item-level measurement models (R/items.R): item response theory (ltm) and
// latent class analysis (poLCA).

import type { Dataset } from '../engine/types';
import { rCall, rScript, rStrings } from './bridge';
import type { REngineInfo } from './lavaan';

export type IrtModel = 'rasch' | 'twopl' | 'grm' | 'gpcm';
export interface IrtResult {
  model: IrtModel; n: number; items: string[];
  /** Per item: difficulty (Dffclt) or thresholds (Extrmt1…, Catgr.1…) and discrimination (Dscrmn). */
  params: { item: string; values: Record<string, number> }[];
  logLik: number; aic: number; bic: number; reliability: number | null;
  theta: number[];
  /** Item information over theta, one array per item. */
  information: number[][];
  itemFit: { item: string; x2: number; p: number }[];
  /** 2PL and partial credit: loadings and thresholds (steps) in the logit metric Mplus prints (threshold = −ltm's intercept), with standard errors (robust ones with `robust`). */
  coefficients?: { item: string; parameter: string; est: number; se: number | null }[];
  /** Gauss-Hermite quadrature points, when chosen (absent: ltm's default). */
  quadrature?: number;
  robust?: boolean;
  warnings: string[]; engine: REngineInfo;
}
/** How an IRT model is fitted: quadrature points (ltm's GHk), and robust (sandwich, Mplus MLR) standard errors for the 2PL and partial credit models. */
export interface IrtFit { quadrature?: number; robust?: boolean }

export interface LcaModel {
  k: number; llik: number; npar: number; aic: number; bic: number; gsq: number | null; entropy: number | null;
  /** Class proportions, largest first (classes are numbered in this order). */
  shares: number[];
  /** Categorical items: P(category | class); growth (LCGA): the model-implied probabilities at each occasion. */
  probs: { item: string; categories: string[]; byClass: number[][] }[];
  /** Latent profiles: the class means (class × item) and covariance matrices (class × item × item). */
  means?: number[][]; cov?: number[][][];
  /** Growth (LCGA): thresholds (equal over time and classes) and each class's intercept (the last class's fixed at 0) and slope. */
  growth?: { thresholds: number[]; intercepts: number[]; slopes: number[] };
}
export interface LcaResult { n: number; items: string[]; models: LcaModel[]; warnings: string[]; engine: REngineInfo; times?: number[]; structure?: LpaStructure }

/**
 * The model of the latent class card: categorical items (poLCA), continuous items (latent profiles, a normal
 * mixture by EM) with a variance structure, or an ordered categorical outcome over occasions (latent class
 * growth, `times` the occasions' time scores).
 */
export type LcaKind = 'lca' | 'lpa' | 'lcga';
/** Latent profiles: EEI variances equal across classes, no covariances (Mplus's default); VVI class-specific variances; EEE / VVV with covariances, equal / class-specific. */
export type LpaStructure = 'EEI' | 'VVI' | 'EEE' | 'VVV';
export interface LcaSpec { model?: LcaKind; structure?: LpaStructure; times?: number[] }

const columns = (data: Dataset, names: string[]) => {
  const keep = data.names.map((n, i) => [n, i] as const).filter(([n]) => names.includes(n));
  return { names: keep.map(([n]) => n), cols: keep.map(([, i]) => Array.from(data.cols[i], (v) => (Number.isNaN(v) ? null : v))) };
};
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? v : v == null ? [] : [v]) as T[];

export const irtRequest = (data: Dataset, items: string[], model: IrtModel, fit: IrtFit = {}) =>
  ({ kind: 'irt', model, items, ...(fit.quadrature ? { quadrature: fit.quadrature } : {}), ...(fit.robust ? { robust: true } : {}), data: columns(data, items) });
export const lcaRequest = (data: Dataset, items: string[], classes: number[], nrep: number, seed: number, spec: LcaSpec = {}) =>
  spec.model === 'lpa' ? { kind: 'lpa', items, classes, nrep, seed, structure: spec.structure ?? 'EEI', data: columns(data, items) }
  : spec.model === 'lcga' ? { kind: 'lcga', items, classes, nrep, seed, times: spec.times ?? items.map((_, i) => i), data: columns(data, items) }
  : { kind: 'lca', items, classes, nrep, seed, data: columns(data, items) };
const LCA_BRIDGE = { lca: ['ps_lca', 'poLCA'], lpa: ['ps_lpa', 'stats'], lcga: ['ps_lcga', 'stats'] } as const;

export async function irtR(data: Dataset, items: string[], model: IrtModel, fit: IrtFit = {}): Promise<IrtResult> {
  const raw = await rCall<Record<string, any>>('ps_irt', irtRequest(data, items, model, fit), 'ltm');
  return {
    ...raw, items: arr<string>(raw.items), params: arr<any>(raw.params), theta: arr<number>(raw.theta),
    ...(raw.coefficients != null ? { coefficients: arr<any>(raw.coefficients) } : {}), quadrature: typeof raw.quadrature === 'number' ? raw.quadrature : undefined, robust: raw.robust === true,
    information: arr<unknown>(raw.information).map((x) => arr<number>(x)), itemFit: arr<any>(raw.itemFit), warnings: rStrings(raw.warnings),
  } as IrtResult;
}
export const irtScriptR = (data: Dataset, items: string[], model: IrtModel, fit: IrtFit = {}) => rScript('ps_irt', irtRequest(data, items, model, fit), 'ltm');

export async function lcaR(data: Dataset, items: string[], classes: number[], nrep = 10, seed = 1, spec: LcaSpec = {}): Promise<LcaResult> {
  const [fn, pkg] = LCA_BRIDGE[spec.model ?? 'lca'];
  const raw = await rCall<Record<string, any>>(fn, lcaRequest(data, items, classes, nrep, seed, spec), pkg);
  const num2 = (v: unknown) => arr<unknown>(v).map((x) => arr<number>(x));
  return {
    ...raw, items: arr<string>(raw.items), warnings: rStrings(raw.warnings), ...(raw.times != null ? { times: arr<number>(raw.times) } : {}),
    models: arr<any>(raw.models).map((m) => ({
      ...m, shares: arr<number>(m.shares),
      probs: arr<any>(m.probs).map((p) => ({ item: p.item, categories: rStrings(p.categories), byClass: num2(p.byClass) })),
      ...(m.means != null ? { means: num2(m.means), cov: arr<unknown>(m.cov).map(num2) } : {}),
      ...(m.growth != null ? { growth: { thresholds: arr<number>(m.growth.thresholds), intercepts: arr<number>(m.growth.intercepts), slopes: arr<number>(m.growth.slopes) } } : {}),
    })),
  } as LcaResult;
}
export const lcaScriptR = (data: Dataset, items: string[], classes: number[], nrep = 10, seed = 1, spec: LcaSpec = {}) =>
  rScript(LCA_BRIDGE[spec.model ?? 'lca'][0], lcaRequest(data, items, classes, nrep, seed, spec), LCA_BRIDGE[spec.model ?? 'lca'][1]);
