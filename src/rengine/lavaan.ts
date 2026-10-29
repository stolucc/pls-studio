// CB-SEM through lavaan (in webR). The model is translated and fitted by
// R/lavaan.R; this module builds the request and turns lavaan's output into
// the app's CbResult, so every view works unchanged.

import type { CbEstimate, CbEstimator, CbFit, CbResult } from '../engine/cbsem';
import type { Dataset, MissingTreatment, ModelSpec } from '../engine/types';
import { rCall, rScript, rStrings } from './bridge';


/** How latent interactions are estimated: product indicators (lavaan) or LMS / QML (modsem). */
export type LatentInteraction = 'product' | 'lms' | 'qml';

export interface CbRequest {
  kind: 'cb';
  estimator: CbEstimator;
  interaction?: LatentInteraction;
  missing: MissingTreatment;
  data: { names: string[]; cols?: (number | null)[][]; moments?: { S: number[][]; n: number; nacov?: number[][] } };
  model: ModelSpec;
}

export function cbRequest(data: Dataset, spec: ModelSpec, missing: MissingTreatment, estimator: CbEstimator, interaction: LatentInteraction = 'product'): CbRequest {
  // Only the columns the model uses travel to R.
  const used = new Set([...spec.constructs.flatMap((c) => c.indicators), ...(spec.multigroup ? [spec.multigroup.column] : []), ...(spec.multilevel ? [spec.multilevel.column] : [])]);
  const keep = data.names.map((n, i) => [n, i] as const).filter(([n]) => used.has(n));
  return {
    kind: 'cb', estimator, missing, ...(interaction !== 'product' && spec.moderations?.length ? { interaction } : {}),
    data: data.moments && data.cols.length === 0
      ? { names: data.names, moments: data.moments }
      : { names: keep.map(([n]) => n), cols: keep.map(([, i]) => Array.from(data.cols[i], (v) => (Number.isNaN(v) ? null : v))) },
    model: spec,
  };
}

/** lavaan fitMeasures name → CbFit key. */
export const LAVAAN_FIT: Record<string, keyof CbFit> = {
  npar: 'npar', chisq: 'chisq', df: 'df', pvalue: 'pvalue',
  'chisq.scaled': 'chisqScaled', 'df.scaled': 'dfScaled', 'pvalue.scaled': 'pvalueScaled',
  'chisq.scaling.factor': 'scalingFactor', 'chisq.shift.parameter': 'shiftParameter',
  'baseline.chisq': 'baselineChisq', 'baseline.df': 'baselineDf', 'baseline.chisq.scaled': 'baselineChisqScaled',
  cfi: 'cfi', tli: 'tli', 'cfi.scaled': 'cfiScaled', 'tli.scaled': 'tliScaled', 'cfi.robust': 'cfiRobust', 'tli.robust': 'tliRobust',
  rmsea: 'rmsea', 'rmsea.ci.lower': 'rmseaLow', 'rmsea.ci.upper': 'rmseaHigh', 'rmsea.pvalue': 'rmseaP',
  'rmsea.scaled': 'rmseaScaled', 'rmsea.robust': 'rmseaRobust',
  srmr: 'srmr', logl: 'logl', aic: 'aic', bic: 'bic',
};

const num = (v: unknown) => (typeof v === 'number' ? v : NaN);
const mat = (m: unknown) => ((m ?? []) as (number | null)[][]).map((r) => r.map(num));

export interface REngineInfo { package: string; version: string }
export type CbResultR = CbResult & { engine: REngineInfo };

/** Shape ps_cb()'s JSON into a CbResult (null → NaN for numbers, null kept where the type allows). */
export function parseCbOutput(raw: Record<string, any>): CbResultR {
  const fit: Partial<CbFit> = {};
  for (const [name, key] of Object.entries(LAVAAN_FIT)) {
    const v = raw.fit?.[name];
    if (typeof v === 'number') (fit as Record<string, number>)[key] = v;
  }
  for (const key of ['chisq', 'df', 'pvalue', 'baselineChisq', 'baselineDf', 'cfi', 'tli', 'rmsea', 'rmseaLow', 'rmseaHigh', 'rmseaP', 'srmr', 'aic', 'bic', 'logl', 'npar'] as const) {
    if (fit[key] === undefined) fit[key] = NaN;
  }
  const estimates: CbEstimate[] = (raw.estimates as any[]).map((e) => ({
    kind: e.kind, lhs: e.lhs, op: e.op, rhs: e.rhs, est: num(e.est),
    se: e.se ?? null, z: e.z ?? null, p: e.p ?? null, std: num(e.std),
    ...(typeof e.index === 'number' ? { index: e.index } : {}),
    ...(typeof e.label === 'string' ? { label: e.label } : {}),
  }));
  return {
    estimator: raw.estimator, n: raw.n, iterations: raw.iterations, converged: !!raw.converged,
    constructs: raw.constructs, indicators: raw.indicators, estimates, fit: fit as CbFit,
    r2Indicators: (raw.r2Indicators as unknown[]).map(num),
    r2Constructs: (raw.r2Constructs as unknown[]).map((v) => (typeof v === 'number' ? v : null)),
    stdLoadings: (raw.stdLoadings as unknown[]).map(num),
    stdPaths: mat(raw.stdPaths), hasPath: raw.hasPath, stdTotal: mat(raw.stdTotal), stdIndirect: mat(raw.stdIndirect),
    lvCor: mat(raw.lvCor),
    reliability: (raw.reliability as any[]).map((r) => ({ cr: num(r.cr), ave: num(r.ave) })),
    residualCor: mat(raw.residualCor),
    htmt: (raw.htmt as (number | null)[][]),
    htmt2: (raw.htmt2 as (number | null)[][]),
    vcov: raw.vcov ? mat(raw.vcov) : null,
    moderations: raw.moderations, warnings: rStrings(raw.warnings), droppedRows: raw.droppedRows ?? 0,
    ...(raw.groups ? {
      groups: {
        labels: rStrings(raw.groups.labels),
        results: (raw.groups.results as Record<string, any>[]).map((g) => parseCbOutput(g)),
        score: (Array.isArray(raw.groups.score) ? raw.groups.score : []).map((t: any) => ({ param: String(t.param), groups: rStrings(t.groups), x2: num(t.x2), df: num(t.df), p: num(t.p) })),
        ...(raw.groups.levels ? { levels: true, icc: raw.groups.icc && !Array.isArray(raw.groups.icc) ? raw.groups.icc : {} } : {}),
      },
      groupIndex: 0,
    } : {}),
    modindices: (Array.isArray(raw.modindices) ? raw.modindices : []).map((m: any) => ({ lhs: m.lhs, op: m.op, rhs: m.rhs, mi: num(m.mi), epc: num(m.epc), sepc: num(m.sepc), ...(m.group ? { group: String(m.group) } : {}) })),
    wald: (Array.isArray(raw.wald) ? raw.wald : raw.wald ? [raw.wald] : []).map((w: any) => ({ name: String(w.name), stat: num(w.stat), df: num(w.df), p: num(w.p) })),
    ...(raw.interaction === 'lms' || raw.interaction === 'qml' ? { interaction: raw.interaction } : {}),
    engine: raw.engine,
  };
}

const usesModsem = (spec: ModelSpec, interaction: LatentInteraction) => interaction !== 'product' && !!spec.moderations?.length;

/** Estimate a CB-SEM model with lavaan (latent interactions by LMS / QML: modsem). */
export async function estimateCbLavaan(data: Dataset, spec: ModelSpec, missing: MissingTreatment, estimator: CbEstimator, interaction: LatentInteraction = 'product'): Promise<CbResultR> {
  return parseCbOutput(await rCall<Record<string, any>>('ps_cb', cbRequest(data, spec, missing, estimator, interaction), usesModsem(spec, interaction) ? 'modsem' : 'lavaan'));
}

/** The self-contained R script (data embedded) that estimateCbLavaan runs. */
export function cbScriptLavaan(data: Dataset, spec: ModelSpec, missing: MissingTreatment, estimator: CbEstimator, interaction: LatentInteraction = 'product'): Promise<string> {
  return rScript('ps_cb', cbRequest(data, spec, missing, estimator, interaction), usesModsem(spec, interaction) ? 'modsem' : 'lavaan');
}

/** Fit and difference tests at each level of measurement invariance (lavaan). */
export interface InvarianceResult {
  /** Robust (scaled) statistics, as the estimator provides. */
  robust: boolean;
  levels: {
    level: 'configural' | 'metric' | 'scalar' | 'strict';
    chisq: number; df: number; cfi: number; rmsea: number; srmr: number;
    chisqDiff?: number; dfDiff?: number; p?: number; cfiChange?: number; rmseaChange?: number;
  }[];
  warnings: string[];
}

export async function invarianceR(data: Dataset, spec: ModelSpec, missing: MissingTreatment, estimator: CbEstimator): Promise<InvarianceResult> {
  const raw = await rCall<Record<string, any>>('ps_invariance', cbRequest(data, spec, missing, estimator), 'lavaan');
  return { robust: !!raw.robust, levels: raw.levels, warnings: rStrings(raw.warnings) };
}

export function invarianceScriptR(data: Dataset, spec: ModelSpec, missing: MissingTreatment, estimator: CbEstimator): Promise<string> {
  return rScript('ps_invariance', cbRequest(data, spec, missing, estimator), 'lavaan');
}
