// Segmentation of PLS path models (R/segment.R): REBUS-PLS with plspm.

import type { Dataset, ModelSpec, PlsOptions } from '../engine/types';
import { rCall, rScript, rStrings } from './bridge';
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

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? v : v == null ? [] : [v]) as T[];
const nums = (v: unknown) => arr<number>(v);
const rec = (v: unknown): Record<string, number[]> => (v && !Array.isArray(v) && typeof v === 'object'
  ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, nums(x)])) : {});

export const rebusRequest = (data: Dataset, spec: ModelSpec, options: PlsOptions, input: RebusInput) =>
  ({ ...plsRequest(data, spec, options, 'cSEM'), ...input });

export function parseRebus(raw: Record<string, any>): RebusResult {
  return {
    n: raw.n, globalGof: raw.globalGof, globalPaths: arr(raw.globalPaths), fusion: nums(raw.fusion), warnings: rStrings(raw.warnings), engine: raw.engine,
    models: arr<any>(raw.models).map((m) => ({
      ...m, sizes: nums(m.sizes), segments: nums(m.segments), gof: nums(m.gof), communality: rec(m.communality), r2: rec(m.r2),
      paths: arr<any>(m.paths).map((p) => ({ from: p.from, to: p.to, byClass: nums(p.byClass) })),
      loadings: arr<any>(m.loadings).map((l) => ({ indicator: l.indicator, byClass: nums(l.byClass) })),
      tests: arr<any>(m.tests).map((t) => ({ classes: nums(t.classes), paths: arr(t.paths), gof: t.gof })),
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
    nodes: arr(raw.nodes), importance: arr(raw.importance), warnings: rStrings(raw.warnings), engine: raw.engine,
    splits: arr<any>(raw.splits).map((s) => ({ ...s, paths: arr(s.paths) })),
    terminal: { nodes: rStrings(raw.terminal?.nodes), rows: arr<any>(raw.terminal?.rows).map((r) => ({ name: r.name, values: nums(r.values) })) },
  };
}
export const pathmoxScriptR = (data: Dataset, spec: ModelSpec, options: PlsOptions, input: PathmoxInput) =>
  rScript('ps_pathmox', pathmoxRequest(data, spec, options, input), 'genpathmox');
