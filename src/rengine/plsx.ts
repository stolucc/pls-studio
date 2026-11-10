// PLS-SEM assessment with cSEM (R/plsx.R): PLSpredict, model comparison
// (information criteria, CVPAT), MICOM and multigroup analysis.

import type { Dataset, ModelSpec, PlsOptions } from '../engine/types';
import { rCall, rScript, rStrings } from './bridge';
import { rList } from './reply';
import type { REngineInfo } from './lavaan';
import { plsRequest } from './pls';

/** cSEM's predict (the default), or seminr's predict_pls (its predictions, folds and linear benchmark), from the exogenous constructs (EA) or direct antecedents (DA). */
export interface PredictSettings { folds: number; repetitions: number; seed: number; engine?: 'cSEM' | 'seminr'; technique?: 'EA' | 'DA' }
export interface PredictResult {
  folds: number; repetitions: number;
  /** seminr: predict_pls (absent: cSEM). */
  predictEngine?: 'seminr'; technique?: 'EA' | 'DA';
  indicators: { indicator: string; construct: string; maePls: number; maeLm: number; rmsePls: number; rmseLm: number; q2: number }[];
  warnings: string[]; engine: REngineInfo;
}
export interface CompareResult {
  criteria: { criterion: string; byConstruct: Record<string, number> }[];
  criteriaAlt: { criterion: string; byConstruct: Record<string, number> }[];
  cvpat: { statistic: number; p: number; df: number; loss: number; lossAlt: number };
  warnings: string[]; engine: REngineInfo;
}
export type MgaApproach = 'Henseler' | 'Chin' | 'Sarstedt' | 'Keil' | 'Nitzl' | 'Klesel';
export interface GroupsResult {
  groups: { group: string; n: number; paths: { from: string; to: string; est: number }[] }[];
  micom: { c: Record<string, number>; cP: Record<string, number>; mean: { statistic: Record<string, number>; p: Record<string, number> }; variance: { statistic: Record<string, number>; p: Record<string, number> }; admissible: number; runs: number };
  mga: { approach: MgaApproach; overall?: { dG: { statistic: number; p: number }; dL: { statistic: number; p: number } };
    comparisons?: { groups: string; paths: { from: string; to: string; statistic: number | null; p: number }[] }[] }[];
  samples: number; warnings: string[]; engine: REngineInfo;
}

const rec = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, number> : {});
const base = (data: Dataset, spec: ModelSpec, options: PlsOptions) => plsRequest(data, spec, { ...options, consistent: !!options.consistent }, 'cSEM');

export async function predictR(data: Dataset, spec: ModelSpec, options: PlsOptions, cv: PredictSettings): Promise<PredictResult> {
  const raw = await rCall<Record<string, any>>('ps_pls_predict', { ...base(data, spec, options), ...cv }, cv.engine === 'seminr' ? 'seminr' : 'cSEM');
  return { folds: raw.folds, repetitions: raw.repetitions, ...(raw.predictEngine === 'seminr' ? { predictEngine: 'seminr' as const, technique: raw.technique === 'DA' ? 'DA' as const : 'EA' as const } : {}),
    indicators: rList(raw.indicators), warnings: rStrings(raw.warnings), engine: raw.engine };
}
export const predictScriptR = (data: Dataset, spec: ModelSpec, options: PlsOptions, cv: PredictSettings) =>
  rScript('ps_pls_predict', { ...base(data, spec, options), ...cv }, cv.engine === 'seminr' ? 'seminr' : 'cSEM');

export async function compareR(data: Dataset, spec: ModelSpec, alternative: ModelSpec, options: PlsOptions, seed: number): Promise<CompareResult> {
  const raw = await rCall<Record<string, any>>('ps_pls_compare', { ...base(data, spec, options), alternative, seed }, 'cSEM');
  const crit = (v: unknown) => rList<any>(v).map((c) => ({ criterion: c.criterion, byConstruct: rec(c.byConstruct) }));
  return { criteria: crit(raw.criteria), criteriaAlt: crit(raw.criteriaAlt), cvpat: raw.cvpat, warnings: rStrings(raw.warnings), engine: raw.engine };
}
export const compareScriptR = (data: Dataset, spec: ModelSpec, alternative: ModelSpec, options: PlsOptions, seed: number) =>
  rScript('ps_pls_compare', { ...base(data, spec, options), alternative, seed }, 'cSEM');

function groupsRequest(data: Dataset, spec: ModelSpec, options: PlsOptions, g: { group: string; approaches: MgaApproach[]; samples: number; seed: number }) {
  const req = base(data, spec, options);
  const j = data.names.indexOf(g.group);
  if (j < 0) throw new Error('The grouping column is not in the dataset.');
  // The grouping column travels with the indicators; text columns keep their category names.
  return { ...req, ...g, groupLabels: data.categories?.[g.group] ?? [],
    data: { names: [...req.data.names, g.group], cols: [...req.data.cols, Array.from(data.cols[j], (v) => (Number.isNaN(v) ? null : v))] } };
}
export async function groupsR(data: Dataset, spec: ModelSpec, options: PlsOptions, g: { group: string; approaches: MgaApproach[]; samples: number; seed: number }): Promise<GroupsResult> {
  const raw = await rCall<Record<string, any>>('ps_pls_groups', groupsRequest(data, spec, options, g), 'cSEM');
  const m = raw.micom;
  return {
    groups: rList<any>(raw.groups).map((x) => ({ ...x, paths: rList(x.paths) })),
    micom: { c: rec(m.c), cP: rec(m.cP), mean: { statistic: rec(m.mean.statistic), p: rec(m.mean.p) }, variance: { statistic: rec(m.variance.statistic), p: rec(m.variance.p) }, admissible: m.admissible, runs: m.runs },
    mga: rList<any>(raw.mga).map((a) => ({ ...a, comparisons: a.comparisons ? rList<any>(a.comparisons).map((c) => ({ groups: c.groups, paths: rList<any>(c.paths).map((p) => ({ ...p, statistic: typeof p.statistic === 'number' ? p.statistic : null })) })) : undefined })),
    samples: raw.samples, warnings: rStrings(raw.warnings), engine: raw.engine,
  };
}
export const groupsScriptR = (data: Dataset, spec: ModelSpec, options: PlsOptions, g: { group: string; approaches: MgaApproach[]; samples: number; seed: number }) =>
  rScript('ps_pls_groups', groupsRequest(data, spec, options, g), 'cSEM');

export interface CtaResult {
  samples: number; alpha: number;
  blocks: { construct: string; tetrads: { tetrad: string; est: number; se: number; t: number; p: number; low: number; high: number; differs: boolean }[] }[];
  warnings: string[]; engine: REngineInfo;
}
export async function ctaR(data: Dataset, spec: ModelSpec, missing: PlsOptions['missing'], cfg: { samples: number; seed: number; alpha: number }): Promise<CtaResult> {
  const raw = await rCall<Record<string, any>>('ps_cta', { ...plsRequest(data, spec, { scheme: 'path', consistent: false, tolerance: 1e-7, maxIter: 300, missing }, 'cSEM'), ...cfg }, 'cta');
  return { samples: raw.samples, alpha: raw.alpha, warnings: rStrings(raw.warnings), engine: raw.engine, blocks: rList<any>(raw.blocks).map((b) => ({ construct: b.construct, tetrads: rList(b.tetrads) })) };
}
export const ctaScriptR = (data: Dataset, spec: ModelSpec, missing: PlsOptions['missing'], cfg: { samples: number; seed: number; alpha: number }) =>
  rScript('ps_cta', { ...plsRequest(data, spec, { scheme: 'path', consistent: false, tolerance: 1e-7, maxIter: 300, missing }, 'cSEM'), ...cfg }, 'cta');

export interface BlindfoldResult {
  distance: number; n: number; divisible: boolean;
  constructs: { construct: string; sse: number; sso: number; q2: number }[];
  warnings: string[]; engine: REngineInfo;
}
/** The constructs blindfolding reports: endogenous, with reflective (Mode A) indicators, as semPLS. */
export const blindfoldTargets = (spec: ModelSpec) => {
  const endo = new Set(spec.paths.map((p) => p.to));
  return spec.constructs.filter((k) => endo.has(k.name) && k.mode === 'A' && k.indicators.length > 0).map((k) => k.name);
};
export async function blindfoldR(data: Dataset, spec: ModelSpec, options: PlsOptions, distance: number): Promise<BlindfoldResult> {
  const raw = await rCall<Record<string, any>>('ps_blindfold', { ...base(data, spec, options), distance }, 'cSEM');
  return { ...raw, constructs: rList(raw.constructs), warnings: rStrings(raw.warnings) } as BlindfoldResult;
}
export const blindfoldScriptR = (data: Dataset, spec: ModelSpec, options: PlsOptions, distance: number) =>
  rScript('ps_blindfold', { ...base(data, spec, options), distance }, 'cSEM');

export interface CcaEstimate { construct: string; indicator: string; est: number; se: number; p: number; low: number; high: number }
export interface CcaResult {
  samples: number; alpha: number; admissible: number;
  fit: { measure: string; statistic: number; q95: number; q99: number }[];
  weights: CcaEstimate[]; loadings: CcaEstimate[]; vif: { construct: string; indicator: string; vif: number }[];
  composites: string[]; correlations: number[][];
  warnings: string[]; engine: REngineInfo;
}
const ccaRequest = (data: Dataset, spec: ModelSpec, options: PlsOptions, cfg: { samples: number; seed: number; alpha: number }) =>
  ({ ...plsRequest(data, spec, { ...options, consistent: false }, 'cSEM'), ...cfg });
/** Confirmatory composite analysis (Schuberth, Henseler & Dijkstra 2018) with cSEM. */
export async function ccaR(data: Dataset, spec: ModelSpec, options: PlsOptions, cfg: { samples: number; seed: number; alpha: number }): Promise<CcaResult> {
  const raw = await rCall<Record<string, any>>('ps_cca', ccaRequest(data, spec, options, cfg), 'cSEM');
  return { ...raw, fit: rList(raw.fit), weights: rList(raw.weights), loadings: rList(raw.loadings), vif: rList(raw.vif),
    composites: rStrings(raw.composites), correlations: rList<unknown>(raw.correlations).map((r) => rList<number>(r)), warnings: rStrings(raw.warnings) } as CcaResult;
}
export const ccaScriptR = (data: Dataset, spec: ModelSpec, options: PlsOptions, cfg: { samples: number; seed: number; alpha: number }) =>
  rScript('ps_cca', ccaRequest(data, spec, options, cfg), 'cSEM');
