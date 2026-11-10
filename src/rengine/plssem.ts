// Two-level PLS-SEM (R/plssem.R ps_plssem): plssem's Monte Carlo consistent PLS for multilevel models (MC-PLSc-MLM).
// The canvas model is level 1, the project's Clusters setting gives the cluster column and level 2; paths may have
// random slopes. Desktop R only (plssem 0.2.0; the browser's R has 0.1.5, whose multilevel interface differs).

import type { Dataset, MissingTreatment, ModelSpec, WeightingScheme } from '../engine/types';
import { rCall, rScript, rStrings } from './bridge';
import { rColumns, rList, rNum } from './rjson';
import type { REngineInfo } from './lavaan';

/** A path (by construct names) whose coefficient varies across clusters (plssem's rv()). */
export interface RandomSlope { from: string; to: string }
export interface PlssemInput {
  slopes: RandomSlope[];
  /** plssem's consistent = TRUE (PLSc in the base fits; off by default, MC-PLSc corrects by simulation). */
  consistent: boolean;
  scheme: WeightingScheme;
  /** The cluster bootstrap (standard errors, z, p and confidence intervals) with this many samples; 0: none. */
  bootR: number;
  seed: number;
}
export interface PlssemModel { data: Dataset; spec: ModelSpec; missing: MissingTreatment }
export interface PlssemRow { lhs: string; op: string; rhs: string; est: number; se: number | null; z: number | null; p: number | null; lo: number | null; hi: number | null }
export interface PlssemLevel {
  level: 1 | 2;
  rows: PlssemRow[];
  r2: { name: string; value: number | null }[];
  r2Indicators: { name: string; value: number | null }[];
  fit: { chisq: number | null; df: number | null; rmsea: number | null; srmr: number | null } | null;
}
export interface PlssemResult {
  levels: PlssemLevel[];
  /** Thresholds of ordinal variables, the same at both levels. */
  thresholds: { variable: string; threshold: string; est: number; se: number | null }[];
  icc: { name: string; value: number | null }[];
  slopes: { name: string; sd: number | null }[];
  n: number; clusters: number; iterations: number; converged: boolean; admissible: boolean; estimator: string;
  consistent: boolean; scheme: string; missing: string; seed: number; bootR: number; ordered: string[];
  fitNote: string; syntax: string[]; warnings: string[]; engine: REngineInfo & { desktop?: string };
}

/** The request: the canvas model with its random slopes, the data columns it needs, the options. */
export function plssemRequest(m: PlssemModel, o: PlssemInput) {
  const ml = m.spec.multilevel;
  if (!ml) throw new Error('Multilevel PLS-SEM needs clusters: choose the cluster column under Clusters (two-level) on the Model tab.');
  if (m.data.moments) throw new Error('Multilevel PLS-SEM needs raw data with a cluster column.');
  const used = new Set([...m.spec.constructs.flatMap((c) => c.indicators), ml.column, ...(ml.between === 'factors' ? ml.betweenCovariates ?? [] : []),
    ...(ml.between === 'model' ? (ml.betweenModel ?? []).flatMap((st) => [st.lhs, ...st.rhs.map((t) => t.name)]) : [])]);
  return {
    missing: m.missing,
    data: rColumns(m.data, used),
    model: {
      constructs: m.spec.constructs, paths: m.spec.paths.map(({ from, to, fixed, label }) => ({ from, to, ...(fixed !== undefined ? { fixed } : {}), ...(label ? { label } : {}) })),
      ...(m.spec.moderations?.length ? { moderations: m.spec.moderations } : {}), ...(m.spec.threeWay?.length ? { threeWay: m.spec.threeWay } : {}),
      ...(m.spec.copulas?.length ? { copulas: m.spec.copulas } : {}), ...(m.spec.ordered?.length ? { ordered: m.spec.ordered } : {}),
      multilevel: ml, slopes: o.slopes,
    },
    options: { consistent: o.consistent, scheme: o.scheme, seed: o.seed, ...(o.bootR > 0 ? { bootstrap: true, bootR: o.bootR } : {}) },
  };
}

const named = (x: any) => rList<string>(x?.names).map((name, i) => ({ name: String(name), value: rNum(rList(x?.values)[i]) }));
/** The reply as the card reads it (R's single values and empty lists normalised). */
export function plssemResult(r: Record<string, any>): PlssemResult {
  return {
    levels: rList<Record<string, any>>(r.levels).map((l) => ({
      level: l.level === 2 ? 2 : 1,
      rows: rList<Record<string, any>>(l.rows).map((x) => ({ lhs: String(x.lhs), op: String(x.op), rhs: String(x.rhs), est: rNum(x.est) ?? NaN, se: rNum(x.se), z: rNum(x.z), p: rNum(x.p), lo: rNum(x.lo), hi: rNum(x.hi) })),
      r2: named(l.r2), r2Indicators: named(l.r2Indicators),
      fit: l.fit && !Array.isArray(l.fit) ? { chisq: rNum(l.fit.chisq), df: rNum(l.fit.df), rmsea: rNum(l.fit.rmsea), srmr: rNum(l.fit.srmr) } : null,
    })),
    thresholds: rList<Record<string, any>>(r.thresholds).map((x) => ({ variable: String(x.variable), threshold: String(x.threshold), est: rNum(x.est) ?? NaN, se: rNum(x.se) })),
    icc: named(r.icc), slopes: rList<Record<string, any>>(r.slopes).map((s) => ({ name: String(s.name), sd: rNum(s.sd) })),
    n: Number(r.n), clusters: Number(r.clusters), iterations: Number(r.iterations), converged: !!r.converged, admissible: !!r.admissible, estimator: String(r.estimator ?? ''),
    consistent: !!r.consistent, scheme: String(r.scheme ?? ''), missing: String(r.missing ?? ''), seed: Number(r.seed), bootR: Number(r.bootR ?? 0),
    ordered: rList<string>(r.ordered).map(String), fitNote: String(r.fitNote ?? ''), syntax: rList<string>(r.syntax).map(String),
    warnings: rStrings(r.warnings), engine: r.engine,
  };
}

export async function plssemR(m: PlssemModel, o: PlssemInput): Promise<PlssemResult> {
  return plssemResult(await rCall<Record<string, any>>('ps_plssem', plssemRequest(m, o), 'plssem'));
}
export const plssemScriptR = (m: PlssemModel, o: PlssemInput) => rScript('ps_plssem', plssemRequest(m, o), 'plssem');
