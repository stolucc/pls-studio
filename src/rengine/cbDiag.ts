// CB-SEM diagnostics of the model on the canvas (R/cbdiag.R): local fit
// (residual z-tests per pair of observed variables, the SRMR's tests and further
// tests of exact fit).

import { rCall, rScript, rStrings } from './bridge';
import { rList, rNum } from './rjson';
import { cbCallRequest, type CbCall } from './cbExtras';
import type { ModelSpec } from '../engine/types';
import { cbRequest, type REngineInfo } from './lavaan';

const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
const rows = (m: unknown) => rList<unknown>(m).map((r) => rList<unknown>(r).map(rNum));
const out = (r: Record<string, any>) => ({
  warnings: rStrings(r.warnings),
  engine: r.engine as REngineInfo,
});

// ---------- local fit ----------

/** lavaan's further tests of exact fit (lavTest names), in the order the card lists them. */
export const LOCALFIT_TESTS = [
  'browne.residual.nt.model',
  'browne.residual.nt',
  'browne.residual.adf',
  'satorra.bentler',
  'yuan.bentler',
  'mean.var.adjusted',
  'scaled.shifted',
  'mean.var.adjusted.corrected',
  'scaled.shifted.corrected',
  'peba4',
  'pols3',
  'pall',
] as const;
export type LocalFitTest = (typeof LOCALFIT_TESTS)[number];
/** The tests that rescale a base statistic, or (FMG) take its p-value: the base (ML χ² or Browne's RLS) applies to them. */
export const SCALED_TESTS: readonly LocalFitTest[] = [
  'satorra.bentler',
  'yuan.bentler',
  'mean.var.adjusted',
  'scaled.shifted',
  'mean.var.adjusted.corrected',
  'scaled.shifted.corrected',
  'peba4',
  'pols3',
  'pall',
];
export interface LocalFitRequest {
  tests: LocalFitTest[];
  base: 'standard' | 'RLS';
}

export interface SrmrSummary {
  srmr: number | null;
  se: number | null;
  z: number | null;
  p: number | null;
  usrmr: number | null;
  usrmrSe: number | null;
  low: number | null;
  high: number | null;
  h0: number | null;
  closeZ: number | null;
  closeP: number | null;
}
/** One group's residuals (lavaan names mapped back to the app's). */
export interface LocalFitBlock {
  label: string;
  names: string[];
  /** Residual correlations (Bentler's metric), their standard errors and z = residual / SE. */
  residual: (number | null)[][];
  se: (number | null)[][];
  z: (number | null)[][];
  /** Normalized residuals (null when lavaan has none for this model). */
  normalized: (number | null)[][] | null;
  /** Mean (intercept) residuals, when the model has a mean structure that does not reproduce them exactly. */
  means: {
    names: string[];
    residual: (number | null)[];
    se: (number | null)[];
    z: (number | null)[];
  } | null;
  summary: SrmrSummary;
}
export interface LocalFitTestRow {
  test: string;
  label: string | null;
  stat: number | null;
  df: number | null;
  p: number | null;
  scaling: number | null;
  shift: number | null;
  base: string | null;
  error: string | null;
  warning: string | null;
}
export interface LocalFitResult {
  blocks: LocalFitBlock[];
  tests: LocalFitTestRow[];
  base: 'standard' | 'RLS';
  estimator: string;
  n: number;
  warnings: string[];
  engine: REngineInfo;
}

const srmr = (s: any): SrmrSummary => ({
  srmr: rNum(s?.srmr),
  se: rNum(s?.se),
  z: rNum(s?.z),
  p: rNum(s?.p),
  usrmr: rNum(s?.usrmr),
  usrmrSe: rNum(s?.usrmrSe),
  low: rNum(s?.low),
  high: rNum(s?.high),
  h0: rNum(s?.h0),
  closeZ: rNum(s?.closeZ),
  closeP: rNum(s?.closeP),
});

/** The R result as the card keeps it. */
export function parseLocalFit(r: Record<string, any>): LocalFitResult {
  return {
    blocks: rList<any>(r.blocks).map((b) => ({
      label: typeof b.label === 'string' ? b.label : '',
      names: rList<string>(b.names),
      residual: rows(b.residual),
      se: rows(b.se),
      z: rows(b.z),
      normalized: b.normalized == null ? null : rows(b.normalized),
      means: b.means
        ? {
            names: rList<string>(b.means.names),
            residual: rList<unknown>(b.means.residual).map(rNum),
            se: rList<unknown>(b.means.se).map(rNum),
            z: rList<unknown>(b.means.z).map(rNum),
          }
        : null,
      summary: srmr(b.summary),
    })),
    tests: rList<any>(r.tests).map((t) => ({
      test: String(t.test),
      label: str(t.label),
      stat: rNum(t.stat),
      df: rNum(t.df),
      p: rNum(t.p),
      scaling: rNum(t.scaling),
      shift: rNum(t.shift),
      base: str(t.base),
      error: str(t.error),
      warning: str(t.warning),
    })),
    base: r.base === 'RLS' ? 'RLS' : 'standard',
    estimator: String(r.estimator ?? ''),
    n: Number(r.n) || 0,
    ...out(r),
  };
}
export async function localFitR(c: CbCall, o: LocalFitRequest): Promise<LocalFitResult> {
  return parseLocalFit(
    await rCall<Record<string, any>>('ps_cb_localfit', cbCallRequest(c, { localfit: o }), 'lavaan'),
  );
}
export const localFitScriptR = (c: CbCall, o: LocalFitRequest) =>
  rScript('ps_cb_localfit', cbCallRequest(c, { localfit: o }), 'lavaan');

/** The pairs of observed variables in one group, largest |z| first (the diagonal, structurally zero, left out). */
export function largestResiduals(
  b: LocalFitBlock,
  by: 'z' | 'normalized' = 'z',
): { a: string; b: string; residual: number | null; se: number | null; z: number }[] {
  const m = by === 'normalized' && b.normalized ? b.normalized : b.z;
  const pairs: { a: string; b: string; residual: number | null; se: number | null; z: number }[] =
    [];
  for (let i = 1; i < b.names.length; i++)
    for (let j = 0; j < i; j++) {
      const z = m[i]?.[j];
      if (z !== null && z !== undefined && Number.isFinite(z))
        pairs.push({
          a: b.names[j],
          b: b.names[i],
          residual: b.residual[i]?.[j] ?? null,
          se: b.se[i]?.[j] ?? null,
          z,
        });
    }
  return pairs.sort((x, y) => Math.abs(y.z) - Math.abs(x.z));
}

// ---------- discriminant validity (Rönkkö & Cho 2022) ----------

export interface DiscriminantRequest {
  level: number;
  merge: boolean;
}
type Lrt = { chisq: number | null; df: number | null; p: number | null };
export interface DiscriminantResult {
  level: number;
  /** One row per factor pair: the correlation, its CI, χ²(cut) at .8, .9 and 1, and (when asked) χ²(merge). */
  pairs: {
    a: string;
    b: string;
    est: number | null;
    low: number | null;
    high: number | null;
    cut80: Lrt;
    cut90: Lrt;
    cut100: Lrt;
    merge: Lrt | null;
  }[];
  /** The model used markers: semTools refitted it with unit factor variances. */
  markers: boolean;
  warnings: string[];
  engine: REngineInfo;
}
const lrtCols = (v: any) => ({
  chisq: rList<unknown>(v?.chisq).map(rNum),
  df: rList<unknown>(v?.df).map(rNum),
  p: rList<unknown>(v?.p).map(rNum),
});
const lrtAt = (c: ReturnType<typeof lrtCols>, i: number): Lrt => ({
  chisq: c.chisq[i] ?? null,
  df: c.df[i] ?? null,
  p: c.p[i] ?? null,
});
export function parseDiscriminant(r: Record<string, any>): DiscriminantResult {
  const lhs = rList<string>(r.lhs);
  const rhs = rList<string>(r.rhs);
  const est = rList<unknown>(r.est).map(rNum);
  const low = rList<unknown>(r.low).map(rNum);
  const high = rList<unknown>(r.high).map(rNum);
  const c80 = lrtCols(r.cut80);
  const c90 = lrtCols(r.cut90);
  const c100 = lrtCols(r.cut100);
  const merge = r.merge ? lrtCols(r.merge) : null;
  return {
    level: Number(r.level),
    markers: r.markers === true,
    pairs: lhs.map((a, i) => ({
      a,
      b: rhs[i],
      est: est[i] ?? null,
      low: low[i] ?? null,
      high: high[i] ?? null,
      cut80: lrtAt(c80, i),
      cut90: lrtAt(c90, i),
      cut100: lrtAt(c100, i),
      merge: merge ? lrtAt(merge, i) : null,
    })),
    ...out(r),
  };
}
export async function discriminantR(
  c: CbCall,
  o: DiscriminantRequest,
): Promise<DiscriminantResult> {
  return parseDiscriminant(
    await rCall<Record<string, any>>(
      'ps_cb_discriminant',
      cbCallRequest(c, { discriminant: o }),
      'lavaan',
    ),
  );
}
export const discriminantScriptR = (c: CbCall, o: DiscriminantRequest) =>
  rScript('ps_cb_discriminant', cbCallRequest(c, { discriminant: o }), 'lavaan');

export type DvClass = 'severe' | 'moderate' | 'marginal' | 'none';
/**
 * Rönkkö & Cho's (2022) classification from the CI of a factor correlation: the bound furthest from 0 (the upper
 * limit of a positive correlation) at or above 1 is a severe problem, .90 to 1 moderate, .80 to .90 marginal,
 * below .80 none. (null without a CI.)
 */
export function dvClass(low: number | null, high: number | null): DvClass | null {
  if (low === null || high === null) return null;
  const ul = Math.max(Math.abs(low), Math.abs(high));
  if (ul >= 1) return 'severe';
  if (ul >= 0.9) return 'moderate';
  if (ul >= 0.8) return 'marginal';
  return 'none';
}

/** True when the fit is significantly worse with the correlation fixed at the cutoff (p < .05; no test: null). */
const worse = (t: Lrt) => (t.p === null ? null : t.p < 0.05);
/**
 * Rönkkö & Cho's (2022, Table 12) χ²(sys): a correlation belongs to the highest class it is not significantly different
 * from: fixing it at 1 does not worsen the fit, severe; at .9, moderate; at .8 (or an estimate of .8 or more), marginal;
 * otherwise none.
 */
export function dvClassChi2(
  p: Pick<DiscriminantResult['pairs'][number], 'est' | 'cut80' | 'cut90' | 'cut100'>,
): DvClass | null {
  const w1 = worse(p.cut100);
  const w9 = worse(p.cut90);
  const w8 = worse(p.cut80);
  if (w1 === null || w9 === null || w8 === null || p.est === null) return null;
  if (!w1) return 'severe';
  if (!w9) return 'moderate';
  if (!w8 || Math.abs(p.est) >= 0.8) return 'marginal';
  return 'none';
}

// ---------- comparing two models (lavTestNET, lavTestLRT, nonnest2) ----------

export type Nesting = 'auto' | 'nested' | 'nonnested';
type TestNote = { error: string | null; notes: string[] };
export interface ModelFit {
  npar: number | null;
  chisq: number | null;
  df: number | null;
  pvalue: number | null;
  cfi: number | null;
  rmsea: number | null;
  srmr: number | null;
  logl: number | null;
  aic: number | null;
  bic: number | null;
}
export interface CompareModelsResult {
  /** Model 1: the diagram; model 2: the saved alternative. */
  fit1: ModelFit;
  fit2: ModelFit;
  n: number;
  /** nested12: model 1 nested in model 2 (null: could not be checked, or inconclusive). */
  net: TestNote & {
    nested12: boolean | null;
    nested21: boolean | null;
    fx12: number | null;
    fx21: number | null;
    reason12: string;
    reason21: string;
    crit: number | null;
  };
  lrt: TestNote & { chisq: number | null; df: number | null; p: number | null; method: string };
  vuong: TestNote & {
    nested: boolean;
    omega: number | null;
    pOmega: number | null;
    stat: number | null;
    pA: number | null;
    pB: number | null;
  };
  icci: TestNote & {
    aic1: number | null;
    aic2: number | null;
    aicLow: number | null;
    aicHigh: number | null;
    bic1: number | null;
    bic2: number | null;
    bicLow: number | null;
    bicHigh: number | null;
    level: number | null;
  };
  nestedChoice: Nesting;
  warnings: string[];
  engine: REngineInfo & { lavaan?: string };
}
const fitOf = (f: any): ModelFit => ({
  npar: rNum(f?.npar),
  chisq: rNum(f?.chisq),
  df: rNum(f?.df),
  pvalue: rNum(f?.pvalue),
  cfi: rNum(f?.cfi),
  rmsea: rNum(f?.rmsea),
  srmr: rNum(f?.srmr),
  logl: rNum(f?.logl),
  aic: rNum(f?.aic),
  bic: rNum(f?.bic),
});
const noteOf = (t: any): TestNote => ({ error: str(t?.error), notes: rStrings(t?.notes) });
const bool = (v: unknown) => (typeof v === 'boolean' ? v : null);
export function parseCompareModels(r: Record<string, any>): CompareModelsResult {
  const net = r.net ?? {};
  const lrt = r.lrt ?? {};
  const vt = r.vuong ?? {};
  const ic = r.icci ?? {};
  return {
    fit1: fitOf(r.fit1),
    fit2: fitOf(r.fit2),
    n: Number(r.n) || 0,
    net: {
      ...noteOf(net),
      nested12: bool(net.nested12),
      nested21: bool(net.nested21),
      fx12: rNum(net.fx12),
      fx21: rNum(net.fx21),
      reason12: String(net.reason12 ?? ''),
      reason21: String(net.reason21 ?? ''),
      crit: rNum(net.crit),
    },
    lrt: {
      ...noteOf(lrt),
      chisq: rNum(lrt.chisq),
      df: rNum(lrt.df),
      p: rNum(lrt.p),
      method: String(lrt.method ?? ''),
    },
    vuong: {
      ...noteOf(vt),
      nested: vt.nested === true,
      omega: rNum(vt.omega),
      pOmega: rNum(vt.pOmega),
      stat: rNum(vt.stat),
      pA: rNum(vt.pA),
      pB: rNum(vt.pB),
    },
    icci: {
      ...noteOf(ic),
      aic1: rNum(ic.aic1),
      aic2: rNum(ic.aic2),
      aicLow: rNum(ic.aicLow),
      aicHigh: rNum(ic.aicHigh),
      bic1: rNum(ic.bic1),
      bic2: rNum(ic.bic2),
      bicLow: rNum(ic.bicLow),
      bicHigh: rNum(ic.bicHigh),
      level: rNum(ic.level),
    },
    nestedChoice:
      r.nestedChoice === 'nested' || r.nestedChoice === 'nonnested' ? r.nestedChoice : 'auto',
    warnings: rStrings(r.warnings),
    engine: r.engine,
  };
}
/** The request: model 1's, with the data columns of both models and the alternative's model. */
export function compareModelsRequest(c: CbCall, alternative: ModelSpec, nested: Nesting) {
  const both: ModelSpec = {
    ...c.spec,
    constructs: [...c.spec.constructs, ...alternative.constructs],
    multigroup: c.spec.multigroup ?? alternative.multigroup,
    auxiliary: [...new Set([...(c.spec.auxiliary ?? []), ...(alternative.auxiliary ?? [])])],
  };
  const alt = cbRequest(c.data, alternative, c.missing, c.estimator, c.interaction).model;
  return cbCallRequest(c, {
    alternative: alt,
    compare: { nested },
    data: cbRequest(c.data, both, c.missing, c.estimator, c.interaction).data,
  });
}
export async function compareModelsR(
  c: CbCall,
  alternative: ModelSpec,
  nested: Nesting,
): Promise<CompareModelsResult> {
  return parseCompareModels(
    await rCall<Record<string, any>>(
      'ps_cb_compare_models',
      compareModelsRequest(c, alternative, nested),
      'nonnest2',
    ),
  );
}
export const compareModelsScriptR = (c: CbCall, alternative: ModelSpec, nested: Nesting) =>
  rScript('ps_cb_compare_models', compareModelsRequest(c, alternative, nested), 'nonnest2');

// ---------- EPC-based judgement of misspecification (semTools::epcEquivFit) ----------

export interface EpcRequest {
  stdLoad: number;
  cor: number;
  stdBeta: number;
  stdIntcept: number;
  cilevel: number;
  mialpha: number;
  mipower: number;
  adjust: 'none' | 'bonferroni';
}
/** decisionPow: M / EPC:M substantially misspecified, NM / EPC:NM trivially, I inconclusive (J-rule); decisionCi: M, NM, I, U (underpowered). */
export interface EpcRow {
  lhs: string;
  op: string;
  rhs: string;
  group: number | null;
  mi: number | null;
  epc: number | null;
  stdEpc: number | null;
  sesoi: number | null;
  stdSesoi: number | null;
  significant: boolean | null;
  highPower: boolean | null;
  power: number | null;
  decisionPow: string | null;
  seEpc: number | null;
  lowStd: number | null;
  highStd: number | null;
  decisionCi: string | null;
}
export interface EpcResult {
  rows: EpcRow[];
  settings: EpcRequest;
  groups: string[] | null;
  warnings: string[];
  engine: REngineInfo;
}
export function parseEpc(r: Record<string, any>): EpcResult {
  const lhs = rList<string>(r.lhs);
  const at = <T>(k: string, f: (v: unknown) => T) => rList<unknown>(r[k]).map(f);
  const n = (k: string) => at(k, rNum);
  const s = (k: string) => at(k, str);
  const b = (k: string) => at(k, (v) => (typeof v === 'boolean' ? v : null));
  const [
    op,
    rhs,
    group,
    mi,
    epc,
    stdEpc,
    sesoi,
    stdSesoi,
    sig,
    high,
    power,
    dPow,
    seEpc,
    lowStd,
    highStd,
    dCi,
  ] = [
    s('op'),
    s('rhs'),
    n('group'),
    n('mi'),
    n('epc'),
    n('stdEpc'),
    n('sesoi'),
    n('stdSesoi'),
    b('significant'),
    b('highPower'),
    n('power'),
    s('decisionPow'),
    n('seEpc'),
    n('lowStd'),
    n('highStd'),
    s('decisionCi'),
  ] as const;
  return {
    rows: lhs.map((l, i) => ({
      lhs: l,
      op: op[i] ?? '',
      rhs: rhs[i] ?? '',
      group: group[i] ?? null,
      mi: mi[i] ?? null,
      epc: epc[i] ?? null,
      stdEpc: stdEpc[i] ?? null,
      sesoi: sesoi[i] ?? null,
      stdSesoi: stdSesoi[i] ?? null,
      significant: sig[i] ?? null,
      highPower: high[i] ?? null,
      power: power[i] ?? null,
      decisionPow: dPow[i] ?? null,
      seEpc: seEpc[i] ?? null,
      lowStd: lowStd[i] ?? null,
      highStd: highStd[i] ?? null,
      decisionCi: dCi[i] ?? null,
    })),
    settings: r.settings as EpcRequest,
    groups: r.groups == null ? null : rList<string>(r.groups),
    ...out(r),
  };
}
export async function epcR(c: CbCall, o: EpcRequest): Promise<EpcResult> {
  return parseEpc(
    await rCall<Record<string, any>>('ps_cb_epcequiv', cbCallRequest(c, { epc: o }), 'lavaan'),
  );
}
export const epcScriptR = (c: CbCall, o: EpcRequest) =>
  rScript('ps_cb_epcequiv', cbCallRequest(c, { epc: o }), 'lavaan');

/** The decisions counted as semTools' summary() counts them (the J-rule's M and NM include EPC:M and EPC:NM). */
export function epcCounts(rows: EpcRow[]) {
  const ci = (d: string) => rows.filter((r) => r.decisionCi === d).length;
  const pow = (...d: string[]) =>
    rows.filter((r) => r.decisionPow !== null && d.includes(r.decisionPow)).length;
  return {
    ci: { M: ci('M'), I: ci('I'), U: ci('U'), NM: ci('NM') },
    pow: { M: pow('M', 'EPC:M'), I: pow('I'), NM: pow('NM', 'EPC:NM') },
  };
}
export type EpcVerdict =
  | 'UNDERPOWERED'
  | 'SUBSTANTIAL MISSPECIFICATION'
  | 'INCONCLUSIVE'
  | 'EQUIVALENT'
  | 'NO PARAMETERS EVALUATED';
/** semTools' global decision (its global_localfit_decision): any underpowered, then any misspecified, then any inconclusive. */
export function epcVerdict(n: { M: number; I: number; U?: number; NM: number }): EpcVerdict {
  if ((n.U ?? 0) > 0) return 'UNDERPOWERED';
  if (n.M > 0) return 'SUBSTANTIAL MISSPECIFICATION';
  if (n.I > 0) return 'INCONCLUSIVE';
  if (n.NM > 0) return 'EQUIVALENT';
  return 'NO PARAMETERS EVALUATED';
}
