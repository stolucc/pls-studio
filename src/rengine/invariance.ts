// Measurement invariance cards (R/invariance.R): alignment optimisation for many
// groups (sirt), moderated nonlinear factor analysis (mnlfa) and local SEM along a
// continuous moderator (sirt::lsem.estimate).

import type { Dataset, MissingTreatment } from '../engine/types';
import { rCall, rScript, rStrings } from './bridge';
import { cbCallRequest, type CbCall } from './cbExtras';
import { rColumns, rList, rNum } from './rjson';
import type { InvarianceResult, REngineInfo } from './lavaan';

/** A factor of the diagram: its name and indicators (data columns). */
export interface InvFactor {
  name: string;
  indicators: string[];
}

/** Alignment (sirt::invariance.alignment) of the chosen factors across the groups of `group`. */
export interface AlignmentInput {
  factors: InvFactor[];
  group: string;
  /** The alignment loss |x / scale|^power for loadings (lambda) and intercepts (nu): Asparouhov & Muthén's power 0.5 and scale 1. */
  power: { lambda: number; nu: number };
  scale: { lambda: number; nu: number };
  /** invariance_alignment_constraints(): an aligned parameter within this distance of the joint value is invariant. */
  tolerance: { lambda: number; nu: number };
  /** sqrtN: groups weighted by sqrt(N) (Asparouhov & Muthén); equal: sirt's default without weights. */
  weights: 'sqrtN' | 'equal';
  estimator: 'ML' | 'MLR';
  missing: MissingTreatment;
}
/** One side (loadings or intercepts) of invariance_alignment_constraints(). */
export interface AlignConstraints {
  tolerance: number;
  noninvariant: number;
  joint: number[];
  dif: number[][];
  unique: number[];
  uniqueGroups: number[];
}
export interface AlignedFactor {
  name: string;
  items: string[];
  /** groups × items: the configural (standardised-factor) values and the aligned ones. */
  lambda: number[][];
  nu: number[][];
  lambdaAligned: number[][];
  nuAligned: number[][];
  /** Each group's aligned factor mean (alpha0) and standard deviation (psi0). */
  mean: number[];
  sd: number[];
  r2: { lambda: number; nu: number };
  sqrtU2: { lambda: number; nu: number };
  rbar: { lambda: number; nu: number };
  fopt: number;
  converged: boolean;
  /** The first group's SD fixed at 1 (sirt's choice for few groups); otherwise the product of the SDs is 1. */
  fixed: boolean;
  lambdaConstraints: AlignConstraints;
  nuConstraints: AlignConstraints;
}
export interface AlignmentResult {
  groups: string[];
  n: number[];
  fit: { chisq: number; df: number; cfi: number; rmsea: number; srmr: number };
  factors: AlignedFactor[];
  power: number[];
  scale: number[];
  weights: AlignmentInput['weights'];
  warnings: string[];
  engine: REngineInfo & { lavaan?: string };
}

/** A matrix from R (rows of numbers; one-element rows arrive unboxed). */
export const rows = (v: unknown): number[][] =>
  rList<unknown>(v).map((r) => rList<number>(r).map((x) => (typeof x === 'number' ? x : NaN)));

/** The request: the named columns only (missing values as null); a covariance matrix cannot be used. */
export function invRequest(data: Dataset, kind: string, columns: string[], fields: object) {
  if (data.moments && data.cols.length === 0)
    throw new Error('This analysis needs raw data; the dataset is a covariance matrix.');
  const names = [...new Set(columns.filter(Boolean))];
  for (const n of names)
    if (!data.names.includes(n)) throw new Error(`“${n}” is not a column of the dataset.`);
  return { kind, ...fields, data: rColumns(data, names) };
}

/** Group codes of a text column as its category names ("2" → "Pasteur"). */
const groupNames = (data: Dataset, column: string, labels: string[]) => {
  const cats = data.categories?.[column];
  return cats ? labels.map((l) => (/^\d+$/.test(l) ? (cats[Number(l) - 1] ?? l) : l)) : labels;
};

const alignCols = (i: AlignmentInput) => [...i.factors.flatMap((f) => f.indicators), i.group];
export const alignmentRequest = (data: Dataset, i: AlignmentInput) =>
  invRequest(data, 'alignment', alignCols(i), i);
const constraints = (c: any): AlignConstraints => ({
  tolerance: c.tolerance,
  noninvariant: c.noninvariant,
  joint: rList<number>(c.joint),
  dif: rows(c.dif),
  unique: rList<number>(c.unique),
  uniqueGroups: rList<number>(c.uniqueGroups),
});

export async function alignmentR(data: Dataset, i: AlignmentInput): Promise<AlignmentResult> {
  const r = await rCall<Record<string, any>>('ps_alignment', alignmentRequest(data, i), 'sirt');
  return {
    ...r,
    groups: groupNames(data, i.group, rStrings(r.groups)),
    n: rList<number>(r.n),
    power: rList<number>(r.power),
    scale: rList<number>(r.scale),
    factors: rList<any>(r.factors).map((f) => ({
      ...f,
      items: rStrings(f.items),
      lambda: rows(f.lambda),
      nu: rows(f.nu),
      lambdaAligned: rows(f.lambdaAligned),
      nuAligned: rows(f.nuAligned),
      mean: rList<number>(f.mean),
      sd: rList<number>(f.sd),
      converged: f.converged === true,
      fixed: f.fixed === true,
      lambdaConstraints: constraints(f.lambdaConstraints),
      nuConstraints: constraints(f.nuConstraints),
    })),
    warnings: rStrings(r.warnings),
  } as AlignmentResult;
}
export const alignmentScriptR = (data: Dataset, i: AlignmentInput) =>
  rScript('ps_alignment', alignmentRequest(data, i), 'sirt');

/** Moderated nonlinear factor analysis (mnlfa): one factor of binary items; each covariate in the roles it is listed in. */
export interface MnlfaInput {
  items: string[];
  itemType: '1PL' | '2PL';
  covariates: string[];
  categorical: string[];
  /** Covariates moderating the item intercepts, the item slopes (2PL), the factor mean and its log SD. */
  intercept: string[];
  slope: string[];
  mean: string[];
  sd: string[];
  /** The items whose intercepts and slopes are moderated (empty: all). */
  moderated: string[];
}
/** kind b: intercept, a: slope; term: "(Intercept)" or a covariate (dummy) term. */
export interface MnlfaItemParam {
  item: string;
  kind: 'a' | 'b';
  term: string;
  est: number;
  free: boolean;
}
export interface MnlfaResult {
  itemType: MnlfaInput['itemType'];
  n: number;
  items: MnlfaItemParam[];
  /** mu: the factor mean's regression; sigma: the log SD's. */
  trait: { kind: 'mu' | 'sigma'; term: string; est: number }[];
  /** A model term: a continuous covariate, or a categorical covariate's dummy for one level (its category name). */
  terms: { term: string; covariate: string; level: string | null }[];
  fit: {
    deviance: number;
    logLik: number;
    npar: number;
    aic: number;
    bic: number;
    caic: number;
    aicc: number;
  };
  iterations: number;
  converged: boolean;
  warnings: string[];
  engine: REngineInfo;
}
export const mnlfaRequest = (data: Dataset, i: MnlfaInput) =>
  invRequest(data, 'mnlfa', [...i.items, ...i.covariates], i);
export async function mnlfaR(data: Dataset, i: MnlfaInput): Promise<MnlfaResult> {
  const r = await rCall<Record<string, any>>('ps_mnlfa', mnlfaRequest(data, i), 'mnlfa');
  return {
    ...r,
    items: rList<MnlfaItemParam>(r.items),
    trait: rList<any>(r.trait),
    // (a categorical covariate's level code as its category name)
    terms: rList<any>(r.terms).map((t) => ({
      ...t,
      level: t.level == null ? null : groupNames(data, t.covariate, [String(t.level)])[0],
    })),
    converged: r.converged === true,
    warnings: rStrings(r.warnings),
  } as MnlfaResult;
}
export const mnlfaScriptR = (data: Dataset, i: MnlfaInput) =>
  rScript('ps_mnlfa', mnlfaRequest(data, i), 'mnlfa');

/** Longitudinal invariance of one factor: `occasions` holds the indicators at each occasion, item k of each the same item. */
export interface LongInvarianceInput {
  factor: string;
  occasions: string[][];
  lag: 'all' | 'adjacent';
  estimator: 'ML' | 'MLR';
  missing: MissingTreatment;
}
/** The factor's mean and variance at one occasion (standard errors absent where fixed). */
export interface OccasionFactor {
  mean: number;
  meanSe?: number;
  variance: number;
  varianceSe?: number;
}
export interface LongInvarianceResult extends Omit<InvarianceResult, 'levels'> {
  /** `syntax`: the lavaan syntax semTools::measEq.syntax generated for the level (absent in older results). */
  levels: (InvarianceResult['levels'][number] & { factor: OccasionFactor[]; syntax?: string })[];
  n: number;
  occasions: number;
  items: number;
  lag: LongInvarianceInput['lag'];
  engine: REngineInfo & { lavaan?: string };
}
export const longInvarianceRequest = (data: Dataset, i: LongInvarianceInput) =>
  invRequest(data, 'longinvariance', i.occasions.flat(), i);
export async function longInvarianceR(
  data: Dataset,
  i: LongInvarianceInput,
): Promise<LongInvarianceResult> {
  const r = await rCall<Record<string, any>>(
    'ps_long_invariance',
    longInvarianceRequest(data, i),
    'lavaan',
  );
  const opt = (v: unknown) => (typeof v === 'number' ? v : undefined);
  return {
    ...r,
    robust: r.robust === true,
    warnings: rStrings(r.warnings),
    levels: rList<any>(r.levels).map((l) => ({
      ...l,
      factor: rList<any>(l.factor).map((f) => ({
        mean: f.mean,
        variance: f.variance,
        ...(opt(f.meanSe) !== undefined ? { meanSe: f.meanSe } : {}),
        ...(opt(f.varianceSe) !== undefined ? { varianceSe: f.varianceSe } : {}),
      })),
    })),
  } as LongInvarianceResult;
}
export const longInvarianceScriptR = (data: Dataset, i: LongInvarianceInput) =>
  rScript('ps_long_invariance', longInvarianceRequest(data, i), 'lavaan');

/** DIF by MIMIC: one factor regressed on `covariate`, each item's direct effect screened; `free`: a final model with the flagged items' direct effects. */
export interface MimicDifInput {
  factors: InvFactor[];
  covariate: string;
  adjust: 'holm' | 'BH' | 'bonferroni' | 'none';
  alpha: number;
  free: boolean;
  estimator: 'ML' | 'MLR';
  missing: MissingTreatment;
}
export interface MimicEffect {
  est: number;
  se: number;
  z: number;
  p: number;
  std: number;
}
export interface MimicDifItem extends MimicEffect {
  item: string;
  /** Likelihood-ratio test of the direct effect (1 df), its p corrected for the number of items, and whether it is flagged. */
  chisq: number;
  df: number;
  pLrt: number;
  pAdj: number;
  flagged: boolean;
  /** Score test from the model without direct effects (absent when lavaan could not compute it). */
  score?: number;
  scoreP?: number;
}
export interface MimicDifResult {
  n: number;
  factor: string;
  covariate: string;
  adjust: MimicDifInput['adjust'];
  alpha: number;
  effect: MimicEffect;
  fit: { chisq: number; df: number; cfi: number; rmsea: number; srmr: number };
  items: MimicDifItem[];
  flagged: string[];
  final: {
    effect: MimicEffect;
    fit: MimicDifResult['fit'];
    direct: (MimicEffect & { item: string })[];
  } | null;
  scoreError: boolean;
  warnings: string[];
  engine: REngineInfo;
}
export const mimicDifRequest = (data: Dataset, i: MimicDifInput) =>
  invRequest(data, 'mimicdif', [...i.factors.flatMap((f) => f.indicators), i.covariate], i);
export async function mimicDifR(data: Dataset, i: MimicDifInput): Promise<MimicDifResult> {
  const r = await rCall<Record<string, any>>('ps_mimic_dif', mimicDifRequest(data, i), 'lavaan');
  return {
    ...r,
    items: rList<any>(r.items).map((x) => ({
      ...x,
      flagged: x.flagged === true,
      ...(typeof x.score === 'number' ? {} : { score: undefined, scoreP: undefined }),
    })),
    flagged: rStrings(r.flagged),
    final: r.final ? { ...r.final, direct: rList<any>(r.final.direct) } : null,
    scoreError: r.scoreError === true,
    warnings: rStrings(r.warnings),
  } as MimicDifResult;
}
export const mimicDifScriptR = (data: Dataset, i: MimicDifInput) =>
  rScript('ps_mimic_dif', mimicDifRequest(data, i), 'lavaan');

/** Local SEM (sirt::lsem.estimate) of the canvas model along `moderator`, at `points` focal points from `from` to `to`. */
export interface LsemInput {
  moderator: string;
  from: number;
  to: number;
  points: number;
  /** Bandwidth factor: the kernel's bandwidth is h × SD(moderator) × N^(−1/5) (sirt's default 1.1). */
  h: number;
  kernel: 'gaussian' | 'epanechnikov' | 'uniform';
  /** Bootstrap resamples and permutations (0: none); both after set.seed(seed). */
  bootstrap: number;
  permutations: number;
  seed: number;
}
/** One parameter (or fit index, op 'fit') along the focal points. */
export interface LsemParam {
  par: string;
  op: string;
  lhs: string;
  rhs: string;
  est: number[];
  se: (number | null)[];
  summary?: {
    mean: number;
    sd: number;
    mad: number;
    min: number;
    max: number;
    linInt: number;
    linSlope: number;
    sdNonlin: number;
  };
  boot?: { se: (number | null)[]; lower: (number | null)[]; upper: (number | null)[] };
  /** Permutation p values: of the SD and MAD over the focal points, of the linear slope, and at each focal point. */
  test?: { sdP: number; madP: number; linSlopeP: number; pointwise: (number | null)[] };
}
export interface LsemResult {
  moderator: string;
  grid: number[];
  n: number;
  h: number;
  bw: number;
  kernel: LsemInput['kernel'];
  /** sirt's moderator density at the focal points (summing to 1) and the effective sample size of each local fit. */
  weight: number[];
  neff: number[];
  params: LsemParam[];
  bootstrap: number;
  permutations: number;
  seed: number;
  warnings: string[];
  engine: REngineInfo & { lavaan?: string };
}

export function lsemRequest(m: CbCall, i: LsemInput) {
  const k = m.data.names.indexOf(i.moderator);
  if (k < 0) throw new Error(`“${i.moderator}” is not a column of the dataset.`);
  const { moderator, bootstrap, permutations, ...rest } = i;
  return cbCallRequest(m, {
    lsem: {
      ...rest,
      ...(bootstrap > 0 ? { bootstrap } : {}),
      ...(permutations > 0 ? { permutations } : {}),
    },
    moderator: {
      name: moderator,
      col: Array.from(m.data.cols[k], (v) => (Number.isNaN(v) ? null : v)),
    },
  });
}
const nums = (v: unknown) => rList<unknown>(v).map(rNum);
/** The reply as the card reads it (R's single values unboxed into arrays). */
export function lsemResult(r: Record<string, any>): LsemResult {
  return {
    moderator: r.moderator,
    grid: rList<number>(r.grid),
    n: r.n,
    h: r.h,
    bw: r.bw,
    kernel: r.kernel,
    weight: rList<number>(r.weight),
    neff: rList<number>(r.neff),
    params: rList<Record<string, any>>(r.params).map(
      (p): LsemParam => ({
        par: String(p.par),
        op: String(p.op),
        lhs: String(p.lhs),
        rhs: String(p.rhs ?? ''),
        est: nums(p.est).map((v) => v ?? NaN),
        se: nums(p.se),
        ...(p.summary ? { summary: p.summary } : {}),
        ...(p.boot
          ? { boot: { se: nums(p.boot.se), lower: nums(p.boot.lower), upper: nums(p.boot.upper) } }
          : {}),
        ...(p.test
          ? {
              test: {
                sdP: p.test.sdP,
                madP: p.test.madP,
                linSlopeP: p.test.linSlopeP,
                pointwise: nums(p.test.pointwise),
              },
            }
          : {}),
      }),
    ),
    bootstrap: r.bootstrap,
    permutations: r.permutations,
    seed: r.seed,
    warnings: rStrings(r.warnings),
    engine: r.engine,
  };
}
export async function lsemR(m: CbCall, i: LsemInput): Promise<LsemResult> {
  return lsemResult(await rCall<Record<string, any>>('ps_lsem', lsemRequest(m, i), 'sirt'));
}
export const lsemScriptR = (m: CbCall, i: LsemInput) =>
  rScript('ps_lsem', lsemRequest(m, i), 'sirt');

/** Effect sizes of non-invariance (ps_dmacs) between the canvas model's groups. */
export interface DmacsInput {
  /** The reference group by its lavaan label (null: the first group). */
  reference: string | null;
  sd: 'pooled' | 'reference';
}

/** One item of one factor, a focal group against the reference group. */
export interface DmacsItem {
  focal: string;
  factor: string;
  item: string;
  lambdaRef: number;
  nuRef: number;
  lambdaFocal: number;
  nuFocal: number;
  sd: number;
  /** dMACS (Nye & Drasgow 2011). */
  dmacs: number;
  /** Signed dMACS: the mean difference, focal − reference, in SD units. */
  signed: number;
  /** Expected bias in the item's mean and variance (focal − reference). */
  meanBias: number;
  varBias: number;
}

/** A factor's scale (sum of its items) in a focal group. */
export interface DmacsScale {
  focal: string;
  factor: string;
  items: number;
  /** The focal group's model-implied factor mean and variance (integrated over). */
  kappa: number;
  phi: number;
  /** Expected bias in the scale's mean and variance. */
  meanBias: number;
  varBias: number;
}

export interface DmacsResult {
  groups: string[];
  reference: string;
  sd: DmacsInput['sd'];
  n: number[];
  items: DmacsItem[];
  scales: DmacsScale[];
  warnings: string[];
  engine: REngineInfo;
}

export function dmacsRequest(m: CbCall, i: DmacsInput) {
  const dmacs = i.reference === null ? { sd: i.sd } : { sd: i.sd, reference: i.reference };
  return cbCallRequest(m, { dmacs });
}

export async function dmacsR(m: CbCall, i: DmacsInput): Promise<DmacsResult> {
  const r = await rCall<Record<string, any>>('ps_dmacs', dmacsRequest(m, i), 'lavaan');
  const column = m.spec.multigroup?.column ?? '';
  // (group codes of a text column as its category names)
  const name = (label: unknown) => groupNames(m.data, column, [String(label)])[0];
  const items = rList<DmacsItem>(r.items).map((x) => ({ ...x, focal: name(x.focal) }));
  const scales = rList<DmacsScale>(r.scales).map((x) => ({ ...x, focal: name(x.focal) }));
  return {
    groups: rStrings(r.groups).map(name),
    reference: name(r.reference),
    sd: r.sd,
    n: rList<number>(r.n),
    items,
    scales,
    warnings: rStrings(r.warnings),
    engine: r.engine,
  };
}

export const dmacsScriptR = (m: CbCall, i: DmacsInput) =>
  rScript('ps_dmacs', dmacsRequest(m, i), 'lavaan');

/**
 * Repeated items recognised from column names with an occasion suffix after "_" or "." (x1_t1, x1_t2; anx.1, anx.2;
 * item_w3): one indicator set per occasion, in occasion order, holding the items measured at every occasion (in the
 * order the columns first appear). Empty when fewer than two occasions or two items are found.
 */
export function detectOccasions(names: string[]): { occasions: string[][]; labels: string[] } {
  const re = /^(.+?)[_.](t|T|w|W|time|Time|wave|Wave)?(\d+)$/;
  const byOcc = new Map<number, Map<string, string>>();
  const stems: string[] = [];
  for (const n of names) {
    const m = re.exec(n);
    if (!m) continue;
    const occ = Number(m[3]);
    if (!byOcc.has(occ)) byOcc.set(occ, new Map());
    byOcc.get(occ)!.set(m[1], n);
    if (!stems.includes(m[1])) stems.push(m[1]);
  }
  const occs = [...byOcc.keys()].sort((a, b) => a - b);
  const common = stems.filter((s) => occs.every((o) => byOcc.get(o)!.has(s)));
  if (occs.length < 2 || common.length < 2) return { occasions: [], labels: [] };
  return {
    occasions: occs.map((o) => common.map((s) => byOcc.get(o)!.get(s)!)),
    labels: occs.map(String),
  };
}
