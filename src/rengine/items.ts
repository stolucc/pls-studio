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
  warnings: string[]; engine: REngineInfo;
}

export interface LcaModel {
  k: number; llik: number; npar: number; aic: number; bic: number; gsq: number; entropy: number | null;
  /** Class proportions, largest first (classes are numbered in this order). */
  shares: number[];
  probs: { item: string; categories: string[]; byClass: number[][] }[];
}
export interface LcaResult { n: number; items: string[]; models: LcaModel[]; warnings: string[]; engine: REngineInfo }

const columns = (data: Dataset, names: string[]) => {
  const keep = data.names.map((n, i) => [n, i] as const).filter(([n]) => names.includes(n));
  return { names: keep.map(([n]) => n), cols: keep.map(([, i]) => Array.from(data.cols[i], (v) => (Number.isNaN(v) ? null : v))) };
};
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? v : v == null ? [] : [v]) as T[];

export const irtRequest = (data: Dataset, items: string[], model: IrtModel) => ({ kind: 'irt', model, items, data: columns(data, items) });
export const lcaRequest = (data: Dataset, items: string[], classes: number[], nrep: number, seed: number) =>
  ({ kind: 'lca', items, classes, nrep, seed, data: columns(data, items) });

export async function irtR(data: Dataset, items: string[], model: IrtModel): Promise<IrtResult> {
  const raw = await rCall<Record<string, any>>('ps_irt', irtRequest(data, items, model), 'ltm');
  return {
    ...raw, items: arr<string>(raw.items), params: arr<any>(raw.params), theta: arr<number>(raw.theta),
    information: arr<unknown>(raw.information).map((x) => arr<number>(x)), itemFit: arr<any>(raw.itemFit), warnings: rStrings(raw.warnings),
  } as IrtResult;
}
export const irtScriptR = (data: Dataset, items: string[], model: IrtModel) => rScript('ps_irt', irtRequest(data, items, model), 'ltm');

export async function lcaR(data: Dataset, items: string[], classes: number[], nrep = 10, seed = 1): Promise<LcaResult> {
  const raw = await rCall<Record<string, any>>('ps_lca', lcaRequest(data, items, classes, nrep, seed), 'poLCA');
  return {
    ...raw, items: arr<string>(raw.items), warnings: rStrings(raw.warnings),
    models: arr<any>(raw.models).map((m) => ({
      ...m, shares: arr<number>(m.shares),
      probs: arr<any>(m.probs).map((p) => ({ item: p.item, categories: rStrings(p.categories), byClass: arr<unknown>(p.byClass).map((x) => arr<number>(x)) })),
    })),
  } as LcaResult;
}
export const lcaScriptR = (data: Dataset, items: string[], classes: number[], nrep = 10, seed = 1) => rScript('ps_lca', lcaRequest(data, items, classes, nrep, seed), 'poLCA');
