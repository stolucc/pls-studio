// Segmentation of PLS path models (R/segment.R): REBUS-PLS with plspm.

import type { Dataset, ModelSpec, PlsOptions } from '../engine/types';
import { rCall, rScript, rStrings } from './bridge';
import { rList } from './rjson';
import type { REngineInfo } from './lavaan';
import { plsRequest } from './pls';

export interface RebusInput { classes: number[]; stopCrit: number; iterMax: number; seed: number }
export interface RebusModel {
  k: number;
  /** Group Quality Index: GoF of the class-specific models, comparable to the global GoF. */
  gqi: number; iterations: number; changeRate: number;
  sizes: number[];
  /** Class (1-based) of each observation, in data order (after casewise deletion). */
  segments: number[];
  paths: { from: string; to: string; byClass: number[] }[];
  loadings: { indicator: string; byClass: number[] }[];
  communality: Record<string, number[]>; r2: Record<string, number[]>; gof: number[];
  /** Permutation tests between pairs of classes (plspm's rebus.test). */
  tests: { classes: number[]; paths: { from: string; to: string; diff: number; p: number }[]; gof: { diff: number; p: number } }[];
}
export interface RebusResult {
  n: number; globalGof: number; globalPaths: { from: string; to: string; est: number }[];
  /** Fusion levels of the last merges of the Ward clustering (largest first). */
  fusion: number[];
  models: RebusModel[]; warnings: string[]; engine: REngineInfo;
}

const nums = (v: unknown) => rList<number>(v);
const rec = (v: unknown): Record<string, number[]> => (v && !Array.isArray(v) && typeof v === 'object'
  ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, nums(x)])) : {});

export const rebusRequest = (data: Dataset, spec: ModelSpec, options: PlsOptions, input: RebusInput) =>
  ({ ...plsRequest(data, spec, options, 'cSEM'), ...input });

export function parseRebus(raw: Record<string, any>): RebusResult {
  return {
    n: raw.n, globalGof: raw.globalGof, globalPaths: rList(raw.globalPaths), fusion: nums(raw.fusion), warnings: rStrings(raw.warnings), engine: raw.engine,
    models: rList<any>(raw.models).map((m) => ({
      ...m, sizes: nums(m.sizes), segments: nums(m.segments), gof: nums(m.gof), communality: rec(m.communality), r2: rec(m.r2),
      paths: rList<any>(m.paths).map((p) => ({ from: p.from, to: p.to, byClass: nums(p.byClass) })),
      loadings: rList<any>(m.loadings).map((l) => ({ indicator: l.indicator, byClass: nums(l.byClass) })),
      tests: rList<any>(m.tests).map((t) => ({ classes: nums(t.classes), paths: rList(t.paths), gof: t.gof })),
    })),
  };
}

export async function rebusR(data: Dataset, spec: ModelSpec, options: PlsOptions, input: RebusInput): Promise<RebusResult> {
  return parseRebus(await rCall<Record<string, any>>('ps_rebus', rebusRequest(data, spec, options, input), 'plspm'));
}
export const rebusScriptR = (data: Dataset, spec: ModelSpec, options: PlsOptions, input: RebusInput) =>
  rScript('ps_rebus', rebusRequest(data, spec, options, input), 'plspm');

/** A categorical segmentation variable for PATHMOX: its category names, nominal or ordered (with their order, 1-based codes). */
export interface PathmoxSegment { column: string; labels: string[]; ordered: boolean; order?: number[] }
export interface PathmoxInput { segments: PathmoxSegment[]; alpha: number; depth: number; size: number }
export interface PathmoxResult {
  nodes: { node: number; parent: number; depth: number; terminal: boolean; size: number; percent: number; variable?: string; category?: string }[];
  splits: { node: number; f: number; p: number; variable: string; left: string; right: string; paths: { path: string; f: number; p: number }[] }[];
  terminal: { nodes: string[]; rows: { name: string; values: number[] }[] };
  importance: { variable: string; ranking: number }[];
  warnings: string[]; engine: REngineInfo;
}

export function pathmoxRequest(data: Dataset, spec: ModelSpec, options: PlsOptions, input: PathmoxInput) {
  const req = plsRequest(data, spec, options, 'cSEM');
  const extra = input.segments.map((s) => s.column).filter((c) => !req.data.names.includes(c));
  const cols = extra.map((c) => { const j = data.names.indexOf(c); if (j < 0) throw new Error(`“${c}” is not in the dataset.`); return Array.from(data.cols[j], (v) => (Number.isNaN(v) ? null : v)); });
  return { ...req, ...input, data: { names: [...req.data.names, ...extra], cols: [...req.data.cols, ...cols] } };
}
export async function pathmoxR(data: Dataset, spec: ModelSpec, options: PlsOptions, input: PathmoxInput): Promise<PathmoxResult> {
  const raw = await rCall<Record<string, any>>('ps_pathmox', pathmoxRequest(data, spec, options, input), 'genpathmox');
  return {
    nodes: rList(raw.nodes), importance: rList(raw.importance), warnings: rStrings(raw.warnings), engine: raw.engine,
    splits: rList<any>(raw.splits).map((s) => ({ ...s, paths: rList(s.paths) })),
    terminal: { nodes: rStrings(raw.terminal?.nodes), rows: rList<any>(raw.terminal?.rows).map((r) => ({ name: r.name, values: nums(r.values) })) },
  };
}
export const pathmoxScriptR = (data: Dataset, spec: ModelSpec, options: PlsOptions, input: PathmoxInput) =>
  rScript('ps_pathmox', pathmoxRequest(data, spec, options, input), 'genpathmox');

export interface FimixInput { classes: number[]; nrep: number; seed: number; intercepts: boolean }
export interface FimixModel {
  k: number;
  criteria: { logLik: number; npar: number; AIC: number; AIC3: number; AIC4: number; BIC: number; CAIC: number; HQ: number; MDL5: number; EN: number | null };
  segments: { segment: number; share: number; paths: { from: string; to: string; est: number }[]; r2: { construct: string; r2: number | null }[] }[];
  /** Segment (1-based) of each observation, in data order (after casewise deletion). */
  assignment: number[];
}
export interface FimixResult { n: number; models: FimixModel[]; warnings: string[]; engine: REngineInfo }

export const fimixRequest = (data: Dataset, spec: ModelSpec, options: PlsOptions, input: FimixInput) => ({ ...plsRequest(data, spec, options, 'cSEM'), ...input });
export async function fimixR(data: Dataset, spec: ModelSpec, options: PlsOptions, input: FimixInput): Promise<FimixResult> {
  const raw = await rCall<Record<string, any>>('ps_fimix', fimixRequest(data, spec, options, input), 'flexmix');
  return {
    n: raw.n, warnings: rStrings(raw.warnings), engine: raw.engine,
    models: rList<any>(raw.models).map((m) => ({ k: m.k, criteria: { ...m.criteria, EN: typeof m.criteria.EN === 'number' ? m.criteria.EN : null }, assignment: nums(m.assignment),
      segments: rList<any>(m.segments).map((g) => ({ segment: g.segment, share: g.share, paths: rList(g.paths), r2: rList<any>(g.r2).map((x) => ({ construct: x.construct, r2: typeof x.r2 === 'number' ? x.r2 : null })) })) })),
  };
}
export const fimixScriptR = (data: Dataset, spec: ModelSpec, options: PlsOptions, input: FimixInput) => rScript('ps_fimix', fimixRequest(data, spec, options, input), 'flexmix');

export interface PosInput { segments: number; nrep: number; seed: number }
export interface PosResult {
  k: number; n: number; objective: number; globalObjective: number; moves: number; starts: number[];
  assignment: number[]; globalR2: Record<string, number>;
  segments: { segment: number; size: number; paths: { from: string; to: string; est: number }[]; r2: Record<string, number> }[];
  warnings: string[]; engine: REngineInfo;
}
export const posRequest = (data: Dataset, spec: ModelSpec, options: PlsOptions, input: PosInput) => ({ ...plsRequest(data, spec, options, 'cSEM'), ...input });
export async function posR(data: Dataset, spec: ModelSpec, options: PlsOptions, input: PosInput): Promise<PosResult> {
  const raw = await rCall<Record<string, any>>('ps_pos', posRequest(data, spec, options, input), 'cSEM');
  const rec = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, number> : {});
  return { ...raw, starts: nums(raw.starts), assignment: nums(raw.assignment), globalR2: rec(raw.globalR2), warnings: rStrings(raw.warnings),
    segments: rList<any>(raw.segments).map((g) => ({ segment: g.segment, size: g.size, paths: rList(g.paths), r2: rec(g.r2) })) } as PosResult;
}
export const posScriptR = (data: Dataset, spec: ModelSpec, options: PlsOptions, input: PosInput) => rScript('ps_pos', posRequest(data, spec, options, input), 'cSEM');
