// CB-SEM through lavaan (in webR). The model is translated and fitted by
// R/lavaan.R; this module builds the request and turns lavaan's output into
// the app's CbResult, so every view works unchanged.

import type { CbEstimate, CbEstimator, CbFit, CbResult } from '../engine/cbsem';
import type { Dataset, MissingTreatment, ModelSpec, MomentData } from '../engine/types';
import { rCall, rScript, rStrings } from './bridge';
import { rColumns, rList } from './rjson';

/** How latent interactions are estimated: product indicators (lavaan) or LMS / QML (modsem). */
export type LatentInteraction = 'product' | 'lms' | 'qml';

export interface CbRequest {
  kind: 'cb';
  estimator: CbEstimator;
  interaction?: LatentInteraction;
  missing: MissingTreatment;
  data: { names: string[]; cols?: (number | null)[][]; moments?: MomentData };
  model: ModelSpec;
}

/** Multiple imputation: number of imputed data sets and the seed (only with missing = 'mi'); CB-SEM: the method, auxiliary and (Amelia) nominal columns. */
export interface MiSettings {
  m: number;
  seed: number;
  method?: 'mice' | 'amelia' | 'micenorm' | 'joint';
  auxiliary?: string[];
  nominal?: string[];
}

/** The missing-value treatments lavaan's auxiliary variables (aux =) work with: FIML and the two-stage approach. */
export const AUX_MISSING: readonly MissingTreatment[] = ['fiml', 'twostage', 'robusttwostage'];

export function cbRequest(
  data: Dataset,
  spec0: ModelSpec,
  missing: MissingTreatment,
  estimator: CbEstimator,
  interaction: LatentInteraction = 'product',
  mi?: MiSettings,
): CbRequest {
  // (auxiliary variables of FIML and the two-stage approach: only with those, never for matrices)
  const { auxiliary: aux, ...rest } = spec0;
  const spec: ModelSpec =
    aux?.length && AUX_MISSING.includes(missing) && !(data.moments && data.cols.length === 0)
      ? spec0
      : rest;
  // Only the columns the model uses travel to R.
  const used = new Set([
    ...spec.constructs.flatMap((c) => c.indicators),
    ...(spec.multigroup ? [spec.multigroup.column] : []),
    ...(spec.multilevel
      ? [
          spec.multilevel.column,
          ...(spec.multilevel.between === 'factors'
            ? (spec.multilevel.betweenCovariates ?? [])
            : []),
          // (a between level as written: the columns it names; its factors are not columns and stay behind)
          ...(spec.multilevel.between === 'model'
            ? (spec.multilevel.betweenModel ?? []).flatMap((st) => [
                st.lhs,
                ...st.rhs.map((t) => t.name),
              ])
            : []),
        ]
      : []),
    ...(spec.weights ? [spec.weights] : []),
    ...(spec.cluster ? [spec.cluster] : []),
    // (multiple imputation: the auxiliary variables travel too; they inform the imputation, not the model)
    ...(missing === 'mi' ? (mi?.auxiliary ?? []) : []),
    ...(spec.auxiliary ?? []),
  ]);
  return {
    kind: 'cb',
    estimator,
    missing,
    ...(interaction !== 'product' && spec.moderations?.length ? { interaction } : {}),
    ...(missing === 'mi' && mi ? { mi } : {}),
    data:
      data.moments && data.cols.length === 0
        ? { names: data.names, moments: data.moments }
        : rColumns(data, used),
    model: spec,
  };
}

/** lavaan fitMeasures name → CbFit key. */
export const LAVAAN_FIT: Record<string, keyof CbFit> = {
  npar: 'npar',
  chisq: 'chisq',
  df: 'df',
  pvalue: 'pvalue',
  'chisq.scaled': 'chisqScaled',
  'df.scaled': 'dfScaled',
  'pvalue.scaled': 'pvalueScaled',
  'chisq.scaling.factor': 'scalingFactor',
  'chisq.shift.parameter': 'shiftParameter',
  'baseline.chisq': 'baselineChisq',
  'baseline.df': 'baselineDf',
  'baseline.chisq.scaled': 'baselineChisqScaled',
  cfi: 'cfi',
  tli: 'tli',
  'cfi.scaled': 'cfiScaled',
  'tli.scaled': 'tliScaled',
  'cfi.robust': 'cfiRobust',
  'tli.robust': 'tliRobust',
  rmsea: 'rmsea',
  'rmsea.ci.lower': 'rmseaLow',
  'rmsea.ci.upper': 'rmseaHigh',
  'rmsea.pvalue': 'rmseaP',
  'rmsea.scaled': 'rmseaScaled',
  'rmsea.robust': 'rmseaRobust',
  srmr: 'srmr',
  logl: 'logl',
  aic: 'aic',
  bic: 'bic',
};

const num = (v: unknown) => (typeof v === 'number' ? v : NaN);
/** A list of R objects, or one unboxed object, as an array; none for a missing (or empty) value. */
const objectList = (v: any): any[] => {
  if (Array.isArray(v)) return v;
  return v ? [v] : [];
};
const mat = (m: unknown) => ((m ?? []) as (number | null)[][]).map((r) => r.map(num));

export interface REngineInfo {
  package: string;
  version: string;
}
export type CbResultR = CbResult & { engine: REngineInfo };

/** Shape ps_cb()'s JSON into a CbResult (null → NaN for numbers, null kept where the type allows). */

/** TECH4 from R: length-one vectors arrive unboxed, standard errors held fixed as null. */
function parseTech4(t: Record<string, any>): NonNullable<CbResultR['tech4']> {
  const orNull = (v: unknown) => (typeof v === 'number' ? v : null);
  const sq = (v: unknown) => rList<unknown>(v).map((r) => rList<unknown>(r));
  return {
    names: rStrings(t.names),
    cov: sq(t.cov).map((r) => r.map(num)),
    cor: sq(t.cor).map((r) => r.map(num)),
    ...(t.mean != null ? { mean: rList<unknown>(t.mean).map(num) } : {}),
    ...(t.meanSe != null ? { meanSe: rList<unknown>(t.meanSe).map(orNull) } : {}),
    ...(t.covSe != null ? { covSe: sq(t.covSe).map((r) => r.map(orNull)) } : {}),
    ...(t.corSe != null ? { corSe: sq(t.corSe).map((r) => r.map(orNull)) } : {}),
  };
}

/** SAMPSTAT from R: the correlation matrix (a single indicator arrives unboxed) and the thresholds, column-wise. */
function parseSampleCor(s: Record<string, any>): NonNullable<CbResultR['sampleCor']> {
  const th = s.thresholds ?? {};
  const v = rList<unknown>(th.variable).map(String),
    idx = rList<unknown>(th.index).map(num),
    val = rList<unknown>(th.value).map(num);
  return {
    names: rStrings(s.names),
    ordinal: rList<unknown>(s.ordinal).map((x) => x === true),
    cor: rList<unknown>(s.cor).map((r) => rList<unknown>(r).map(num)),
    thresholds: v.map((variable, i) => ({ variable, index: idx[i], value: val[i] })),
  };
}

/** TECH10 from R: columns, one entry per pair of ordinal indicators. */
function parseTech10(t: Record<string, any>): NonNullable<CbResultR['tech10']> {
  const lhs = rList<unknown>(t.lhs).map(String),
    rhs = rList<unknown>(t.rhs).map(String);
  const col = (k: string) => rList<unknown>(t[k]).map(num);
  const [df, x2, x2p, g2, g2p] = ['df', 'x2', 'x2p', 'g2', 'g2p'].map(col);
  return lhs.map((a, i) => ({
    lhs: a,
    rhs: rhs[i],
    df: df[i],
    x2: x2[i],
    x2p: x2p[i],
    g2: g2[i],
    g2p: g2p[i],
  }));
}

export function parseCbOutput(raw: Record<string, any>): CbResultR {
  const fit: Partial<CbFit> = {};
  for (const [name, key] of Object.entries(LAVAAN_FIT)) {
    const v = raw.fit?.[name];
    if (typeof v === 'number') (fit as Record<string, number>)[key] = v;
  }
  for (const key of [
    'chisq',
    'df',
    'pvalue',
    'baselineChisq',
    'baselineDf',
    'cfi',
    'tli',
    'rmsea',
    'rmseaLow',
    'rmseaHigh',
    'rmseaP',
    'srmr',
    'aic',
    'bic',
    'logl',
    'npar',
  ] as const) {
    if (fit[key] === undefined) fit[key] = NaN;
  }
  const estimates: CbEstimate[] = (raw.estimates as any[]).map((e) => ({
    kind: e.kind,
    lhs: e.lhs,
    op: e.op,
    rhs: e.rhs,
    est: num(e.est),
    se: e.se ?? null,
    z: e.z ?? null,
    p: e.p ?? null,
    std: num(e.std),
    ...(typeof e.index === 'number' ? { index: e.index } : {}),
    ...(typeof e.label === 'string' ? { label: e.label } : {}),
  }));
  return {
    estimator: raw.estimator,
    n: raw.n,
    iterations: raw.iterations,
    converged: !!raw.converged,
    constructs: raw.constructs,
    indicators: raw.indicators,
    estimates,
    fit: fit as CbFit,
    r2Indicators: (raw.r2Indicators as unknown[]).map(num),
    r2Constructs: (raw.r2Constructs as unknown[]).map((v) => (typeof v === 'number' ? v : null)),
    stdLoadings: (raw.stdLoadings as unknown[]).map(num),
    stdPaths: mat(raw.stdPaths),
    hasPath: raw.hasPath,
    stdTotal: mat(raw.stdTotal),
    stdIndirect: mat(raw.stdIndirect),
    lvCor: mat(raw.lvCor),
    reliability: (raw.reliability as any[]).map((r) => ({
      cr: num(r.cr),
      ave: num(r.ave),
      ...(typeof r.omega === 'number' ? { omega: r.omega } : {}),
      ...(typeof r.alpha === 'number' ? { alpha: r.alpha } : {}),
    })),
    residualCor: mat(raw.residualCor),
    ...(raw.tech4 && typeof raw.tech4 === 'object' ? { tech4: parseTech4(raw.tech4) } : {}),
    ...(raw.sampleCor && typeof raw.sampleCor === 'object'
      ? { sampleCor: parseSampleCor(raw.sampleCor) }
      : {}),
    ...(raw.tech10 && typeof raw.tech10 === 'object' ? { tech10: parseTech10(raw.tech10) } : {}),
    ...(Array.isArray(raw.bifactor) && raw.bifactor.length
      ? {
          bifactor: (raw.bifactor as any[]).map((x) => ({
            general: String(x.general),
            items: num(x.items),
            ecv: num(x.ecv),
            omega: num(x.omega),
            omegaH: num(x.omegaH),
            specific: objectList(x.specific).map((s: any) => ({
              factor: String(s.factor),
              omega: num(s.omega),
              omegaHS: num(s.omegaHS),
              items: num(s.items),
            })),
          })),
        }
      : {}),
    htmt: raw.htmt as (number | null)[][],
    htmt2: raw.htmt2 as (number | null)[][],
    vcov: raw.vcov ? mat(raw.vcov) : null,
    moderations: raw.moderations,
    warnings: rStrings(raw.warnings),
    notes: rStrings(raw.notes),
    ...(typeof raw.fitNote === 'string' ? { fitNote: raw.fitNote } : {}),
    ...(typeof raw.modindicesNote === 'string' ? { modindicesNote: raw.modindicesNote } : {}),
    droppedRows: raw.droppedRows ?? 0,
    ...(raw.groups
      ? {
          groups: {
            labels: rStrings(raw.groups.labels),
            results: (raw.groups.results as Record<string, any>[]).map((g) => parseCbOutput(g)),
            score: (Array.isArray(raw.groups.score) ? raw.groups.score : []).map((t: any) => ({
              param: String(t.param),
              groups: rStrings(t.groups),
              x2: num(t.x2),
              df: num(t.df),
              p: num(t.p),
            })),
            ...(raw.groups.levels
              ? {
                  levels: true,
                  icc: raw.groups.icc && !Array.isArray(raw.groups.icc) ? raw.groups.icc : {},
                }
              : {}),
          },
          groupIndex: 0,
        }
      : {}),
    ...(raw.caseWeights
      ? {
          caseWeights: {
            rows: (raw.caseWeights.rows as unknown[]).map(Number),
            weights: (raw.caseWeights.weights as unknown[]).map(Number),
          },
        }
      : {}),
    ...(typeof raw.imputations === 'number' ? { imputations: raw.imputations } : {}),
    ...(typeof raw.modindicesError === 'string' ? { modindicesError: raw.modindicesError } : {}),
    modindices: (Array.isArray(raw.modindices) ? raw.modindices : []).map((m: any) => ({
      lhs: m.lhs,
      op: m.op,
      rhs: m.rhs,
      mi: num(m.mi),
      epc: num(m.epc),
      sepc: num(m.sepc),
      ...(m.group ? { group: String(m.group) } : {}),
    })),
    wald: objectList(raw.wald).map((w: any) => ({
      name: String(w.name),
      stat: num(w.stat),
      df: num(w.df),
      p: num(w.p),
    })),
    ...(raw.interaction === 'lms' || raw.interaction === 'qml'
      ? { interaction: raw.interaction }
      : {}),
    ...(typeof raw.seType === 'string' ? { seType: raw.seType } : {}),
    ...(raw.lrt && typeof raw.lrt === 'object' && typeof raw.lrt.D === 'number'
      ? {
          lrt: {
            D: num(raw.lrt.D),
            df: num(raw.lrt.df),
            p: num(raw.lrt.p),
            llChange: num(raw.lrt.llChange),
          },
        }
      : {}),
    engine: raw.engine,
  };
}

const usesModsem = (spec: ModelSpec, interaction: LatentInteraction) =>
  interaction !== 'product' && !!spec.moderations?.length;
/** The R packages of a CB-SEM estimation: modsem for LMS / QML, mice and lavaan.mi for multiple imputation, rsem for robust ML. */
const cbPackage = (
  spec: ModelSpec,
  interaction: LatentInteraction,
  missing: MissingTreatment,
  estimator: CbEstimator,
) => {
  if (usesModsem(spec, interaction)) return 'modsem';
  if (missing === 'mi') return 'lavaan.mi';
  if (estimator === 'RML') return 'rsem';
  if (spec.esem?.invariant) return 'lavaanRotate';
  return 'lavaan';
};

/** Estimate a CB-SEM model with lavaan (latent interactions by LMS / QML: modsem). */
export async function estimateCbLavaan(
  data: Dataset,
  spec: ModelSpec,
  missing: MissingTreatment,
  estimator: CbEstimator,
  interaction: LatentInteraction = 'product',
  mi?: MiSettings,
): Promise<CbResultR> {
  const r = parseCbOutput(
    await rCall<Record<string, any>>(
      'ps_cb',
      cbRequest(data, spec, missing, estimator, interaction, mi),
      cbPackage(spec, interaction, missing, estimator),
    ),
  );
  const cats = spec.multigroup ? data.categories?.[spec.multigroup.column] : undefined;
  return cats ? withGroupNames(r, cats) : r;
}

/**
 * Groups from a text column arrive as their codes ("1", or "1 · Within" with
 * two levels): show the category names instead.
 */
export function withGroupNames(r: CbResultR, categories: string[]): CbResultR {
  if (!r.groups) return r;
  const name = (l: string) =>
    l.replace(/^(\d+)(?=$| · )/, (code) => categories[Number(code) - 1] ?? code);
  return {
    ...r,
    groups: {
      ...r.groups,
      labels: r.groups.labels.map(name),
      score: r.groups.score.map((t) => ({ ...t, groups: t.groups.map(name) })),
    },
    modindices: r.modindices?.map((m) => (m.group ? { ...m, group: name(m.group) } : m)),
  };
}

/** The self-contained R script (data embedded) that estimateCbLavaan runs. */
export function cbScriptLavaan(
  data: Dataset,
  spec: ModelSpec,
  missing: MissingTreatment,
  estimator: CbEstimator,
  interaction: LatentInteraction = 'product',
  mi?: MiSettings,
): Promise<string> {
  return rScript(
    'ps_cb',
    cbRequest(data, spec, missing, estimator, interaction, mi),
    cbPackage(spec, interaction, missing, estimator),
  );
}

/** Fit and difference tests at each level of measurement invariance (lavaan). */
export interface InvarianceResult {
  /** Robust (scaled) statistics, as the estimator provides. */
  robust: boolean;
  levels: {
    level: 'configural' | 'metric' | 'scalar' | 'strict';
    chisq: number;
    df: number;
    cfi: number;
    rmsea: number;
    srmr: number;
    chisqDiff?: number;
    dfDiff?: number;
    p?: number;
    cfiChange?: number;
    rmseaChange?: number;
  }[];
  warnings: string[];
}

export async function invarianceR(
  data: Dataset,
  spec: ModelSpec,
  missing: MissingTreatment,
  estimator: CbEstimator,
): Promise<InvarianceResult> {
  const raw = await rCall<Record<string, any>>(
    'ps_invariance',
    cbRequest(data, spec, missing, estimator),
    'lavaan',
  );
  return { robust: !!raw.robust, levels: raw.levels, warnings: rStrings(raw.warnings) };
}

export function invarianceScriptR(
  data: Dataset,
  spec: ModelSpec,
  missing: MissingTreatment,
  estimator: CbEstimator,
): Promise<string> {
  return rScript('ps_invariance', cbRequest(data, spec, missing, estimator), 'lavaan');
}

/**
 * Factor scores, index-aligned with `names` and `rows`: `scores` (regression, Bartlett), with `se` when asked;
 * `draws` for plausible values (draw → factor → case).
 */
export interface FactorScores {
  method: 'regression' | 'Bartlett' | 'plausible';
  names: string[];
  rows: number[];
  scores: number[][];
  se?: number[][];
  draws?: number[][][];
  warnings: string[];
  engine: REngineInfo;
}

/**
 * Factor scores of the latent constructs (lavPredict), with the 1-based data row of each; `se`: their standard
 * errors too. Plausible values (semTools::plausibleValues): `draws` per case, from `seed`.
 */
export async function cbScoresR(
  data: Dataset,
  spec: ModelSpec,
  missing: MissingTreatment,
  estimator: CbEstimator,
  method: FactorScores['method'],
  opts: { se?: boolean; draws?: number; seed?: number } = {},
): Promise<FactorScores> {
  const raw = await rCall<Record<string, any>>(
    'ps_cb_scores',
    {
      ...cbRequest(data, spec, missing, estimator),
      scoreMethod: method,
      ...(opts.se ? { scoreSe: true } : {}),
      ...(method === 'plausible'
        ? { plausibleDraws: opts.draws ?? 5, seed: opts.seed ?? 1234 }
        : {}),
    },
    'lavaan',
  );
  const arr = rList;
  const cols = (v: unknown) => arr<unknown>(v).map((c) => arr<number>(c));
  return {
    method: raw.method,
    names: rStrings(raw.names),
    rows: arr<number>(raw.rows),
    scores: cols(raw.scores),
    ...(raw.se ? { se: cols(raw.se) } : {}),
    ...(raw.draws ? { draws: arr<unknown>(raw.draws).map(cols) } : {}),
    warnings: rStrings(raw.warnings),
    engine: raw.engine,
  };
}

/**
 * Score columns for the dataset: one per construct, named "<construct>_score"
 * (or _score_2, ...), NaN in rows without a score.
 */
export function scoreColumns(
  data: Dataset,
  names: string[],
  rows: number[],
  scores: number[][],
  suffix = '_score',
): Dataset {
  const n = data.cols[0]?.length ?? 0;
  const out = { ...data, names: [...data.names], cols: [...data.cols] };
  names.forEach((name, j) => {
    let col = `${name.replace(/[^A-Za-z0-9_.]+/g, '_')}${suffix}`,
      k = 2;
    const base = col;
    while (out.names.includes(col)) col = `${base}_${k++}`;
    const v = new Float64Array(n).fill(NaN);
    rows.forEach((r, i) => {
      if (r >= 1 && r <= n) v[r - 1] = scores[j][i];
    });
    out.names.push(col);
    out.cols.push(v);
  });
  return out;
}
