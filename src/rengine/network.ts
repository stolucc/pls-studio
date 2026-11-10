// Network psychometrics (R/network.R): a Gaussian graphical model of chosen
// variables with bootnet / qgraph, and exploratory graph analysis with EGAnet.

import type { Dataset } from '../engine/types';
import { rCall, rScript, rStrings } from './bridge';
import { rList } from './reply';
import type { REngineInfo } from './lavaan';

const nums = (v: unknown) => rList<unknown>(v).map((x) => (typeof x === 'number' ? x : NaN));
const matrix = (v: unknown) => rList<unknown>(v).map(nums);

/** Only the chosen columns travel to R. */
function columns(data: Dataset, vars: string[]) {
  const keep = vars.map((v) => data.names.indexOf(v)).filter((k) => k >= 0);
  return { names: keep.map((k) => data.names[k]), cols: keep.map((k) => Array.from(data.cols[k], (x) => (Number.isNaN(x) ? null : x))) };
}

export interface NetworkInput {
  vars: string[]; estimator: 'EBICglasso' | 'pcor' | 'cor'; corMethod: 'cor_auto' | 'cor' | 'spearman';
  missing: 'pairwise' | 'listwise'; gamma: number; boot: { samples: number; seed: number };
}
export interface NetworkResult {
  names: string[]; weights: number[][]; layout: number[][]; n: number; nComplete: number;
  centrality: { strength: number[]; expectedInfluence: number[]; closeness: number[]; betweenness: number[] };
  cs: Record<string, number> | null; samples: number; warnings: string[]; engine: REngineInfo;
}
const netReq = (data: Dataset, i: NetworkInput) => ({ vars: i.vars, netEstimator: i.estimator, corMethod: i.corMethod, netMissing: i.missing, gamma: i.gamma, boot: i.boot, data: columns(data, i.vars) });
export async function networkR(data: Dataset, input: NetworkInput): Promise<NetworkResult> {
  const r = await rCall<Record<string, any>>('ps_network', netReq(data, input), 'bootnet');
  const c = r.centrality ?? {};
  return {
    names: rList<string>(r.names), weights: matrix(r.weights), layout: matrix(r.layout), n: r.n, nComplete: r.nComplete,
    centrality: { strength: nums(c.strength), expectedInfluence: nums(c.expectedInfluence), closeness: nums(c.closeness), betweenness: nums(c.betweenness) },
    cs: r.cs && typeof r.cs === 'object' ? Object.fromEntries(Object.entries(r.cs as Record<string, unknown>).map(([k, v]) => [k, typeof v === 'number' ? v : NaN])) : null,
    samples: r.samples, warnings: rStrings(r.warnings), engine: r.engine,
  };
}
export const networkScriptR = (data: Dataset, input: NetworkInput) => rScript('ps_network', netReq(data, input), 'bootnet');

export interface EgaInput { vars: string[]; model: 'glasso' | 'TMFG'; algorithm: 'walktrap' | 'louvain' | 'leiden'; corr: 'auto' | 'pearson' | 'spearman'; boot: { samples: number; seed: number } }
export interface EgaResult {
  names: string[]; dims: number; membership: number[]; weights: number[][]; loadings: number[][]; loadingDims: string[];
  layout: number[][]; tefi: number | null; frequency: { dims: number; share: number }[] | null; itemStability: number[] | null;
  samples: number; n: number; warnings: string[]; engine: REngineInfo;
}
const egaReq = (data: Dataset, i: EgaInput) => ({ ...i, data: columns(data, i.vars) });
export async function egaR(data: Dataset, input: EgaInput): Promise<EgaResult> {
  const r = await rCall<Record<string, any>>('ps_ega', egaReq(data, input), 'EGAnet');
  return {
    names: rList<string>(r.names), dims: r.dims, membership: nums(r.membership), weights: matrix(r.weights), loadings: matrix(r.loadings),
    loadingDims: rList<unknown>(r.loadingDims).map(String), layout: matrix(r.layout), tefi: typeof r.tefi === 'number' ? r.tefi : null,
    frequency: r.frequency ? rList<{ dims: number; share: number }>(r.frequency) : null, itemStability: r.itemStability ? nums(r.itemStability) : null,
    samples: r.samples, n: r.n, warnings: rStrings(r.warnings), engine: r.engine,
  };
}
export const egaScriptR = (data: Dataset, input: EgaInput) => rScript('ps_ega', egaReq(data, input), 'EGAnet');
