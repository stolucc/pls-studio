// Covariance-based SEM: maximum-likelihood estimation of a LISREL "all-y"
// model, Σ = Λ (I−B)⁻¹ Ψ (I−B)⁻ᵀ Λᵀ + Θ, by Fisher scoring with analytic
// derivatives. Identification uses marker variables (first loading = 1),
// exogenous factors covary freely, single-indicator factors get a zero error
// variance. Results are validated against lavaan in cbsem.test.ts.

import { cholesky, invert, invertPD, logDetPD, zeros, type Mat } from './linalg';
import { compileModel, extractColumns, htmt2Of, htmtOf, type CompiledModel } from './pls';
import { bisect, chisqCdf, mean, ncChisqCdf, normalP } from './stats';
import { deltaMatrix, gammaADF, mm, quad, t as tp, tr, trProd, vech, vechPairs, weightNT, type Pairs } from './vech';
import type { Dataset, MissingTreatment, ModelSpec } from './types';
import { interactionName } from './types';

export type CbParamKind = 'loading' | 'regression' | 'hoLoading' | 'lvcov' | 'residual' | 'rescov';

/**
 * ML: normal-theory maximum likelihood. MLM: ML + robust SEs + Satorra–Bentler
 * scaled χ². MLMV: ML + robust SEs + mean-and-variance adjusted χ². MLR: ML +
 * Huber–White SEs + Yuan–Bentler scaled χ². GLS / ULS: least-squares fitting.
 */
/** WLSMV (ordinal indicators) is estimated by lavaan only. */
/** RML: robust ML with Huber-type case weights (Yuan & Zhang 2012; rsem, R engine only). */
export type CbEstimator = 'ML' | 'MLM' | 'MLMV' | 'MLR' | 'GLS' | 'ULS' | 'WLSMV' | 'RML';

interface ParamDef {
  kind: CbParamKind;
  /** loading: [indicator, factor]; regression / hoLoading: [to, from] (B entry); lvcov: [k, l]; residual: [indicator, indicator]; rescov: [indicator a, indicator b], a < b */
  i: number;
  j: number;
}

export interface CbEstimate {
  kind: CbParamKind | 'fixed-loading' | 'fixed' | 'threshold' | 'defined' | 'mean';
  /** lavaan parameter label (equal labels = equality constraint). */
  label?: string;
  /** lavaan-style labels: lhs op rhs. */
  lhs: string;
  op: '=~' | '~' | '~~';
  rhs: string;
  est: number;
  se: number | null;
  z: number | null;
  p: number | null;
  std: number;
  /** Index into the free-parameter vector (and `vcov`); absent for fixed parameters. */
  index?: number;
}

export interface CbFit {
  chisq: number; df: number; pvalue: number;
  baselineChisq: number; baselineDf: number;
  cfi: number; tli: number;
  rmsea: number; rmseaLow: number; rmseaHigh: number; rmseaP: number;
  srmr: number; aic: number; bic: number; logl: number; npar: number;
  /** Robust / scaled statistics (MLM, MLMV, MLR); undefined otherwise. */
  chisqScaled?: number; dfScaled?: number; pvalueScaled?: number;
  scalingFactor?: number; shiftParameter?: number;
  baselineChisqScaled?: number;
  cfiScaled?: number; tliScaled?: number; cfiRobust?: number; tliRobust?: number;
  rmseaScaled?: number; rmseaRobust?: number;
}

export interface CbResult {
  /** Multiple groups (lavaan): every group's results; this object is group `groupIndex`'s. */
  groups?: {
    labels: string[]; results: CbResult[]; score: { param: string; groups: string[]; x2: number; df: number; p: number }[];
    /** Two-level model: the "groups" are the within and between levels; intraclass correlations of the indicators. */
    levels?: boolean; icc?: Record<string, number>;
  };
  groupIndex?: number;
  /** Modification indices ≥ 3.84 (lavaan), largest first. */
  modindices?: { lhs: string; op: string; rhs: string; mi: number; epc: number; sepc: number; group?: string }[];
  /** Robust ML (rsem): each analysed case's weight, by data row (1-based); below 1 = down-weighted. */
  caseWeights?: { rows: number[]; weights: number[] };
  /** Multiple imputation: the number of imputed data sets pooled. */
  imputations?: number;
  /** Latent interactions estimated by LMS or QML (modsem); absent for product indicators. */
  interaction?: 'lms' | 'qml';
  /** Wald tests of user hypotheses (lavaan). */
  wald?: { name: string; stat: number; df: number; p: number }[];
  estimator: CbEstimator;
  n: number;
  iterations: number;
  converged: boolean;
  constructs: string[];
  indicators: { name: string; construct: number }[];
  estimates: CbEstimate[];
  fit: CbFit;
  /** R² of indicators (by indicator index) and of constructs (null for exogenous). */
  r2Indicators: number[];
  r2Constructs: (number | null)[];
  /** Standardised loadings by indicator index. */
  stdLoadings: number[];
  /** Standardised path matrix [from][to]. */
  stdPaths: number[][];
  hasPath: boolean[][];
  stdTotal: number[][];
  stdIndirect: number[][];
  /** Model-implied factor correlations. */
  lvCor: number[][];
  /** cr, ave from the standardised loadings; omega, alpha: semTools::compRelSEM (R engine only). */
  reliability: { cr: number; ave: number; omega?: number; alpha?: number }[];
  /** Standardised residual correlations (observed − implied). */
  residualCor: number[][];
  htmt: (number | null)[][];
  htmt2: (number | null)[][];
  /** Sampling covariance matrix of the free parameters (unstandardised). */
  vcov: number[][] | null;
  moderations: CbModeration[];
  warnings: string[];
  droppedRows: number;
}

// ---------- model structure ----------

interface CbModel {
  m: CompiledModel;
  params: ParamDef[];
  p: number;
  k: number;
  singleIndicator: boolean[];
  exo: number[];
  /** Second-order relations child ← parent; the first child of each parent is the marker (B fixed to 1). */
  ho: { parent: number; child: number; marker: boolean }[];
  /** Observed covariates (lavaan fixed.x): construct indices. */
  covariates: number[];
  /** Ψ entries fixed at sample values (covariates), set per sample by bindSample(). */
  fixedPsi: { i: number; j: number; value: number }[];
  /** Loadings / regressions held at given values instead of estimated (user-fixed values; MIIV-2SLS variance step). */
  fixedCoef?: (ParamDef & { value: number })[];
  /** Measurement-error covariances held at given values. */
  fixedThetaCov?: { i: number; j: number; value: number }[];
}

function buildCbModel(spec: ModelSpec): CbModel {
  const m = compileModel(spec);
  const k = m.constructs.length;
  const params: ParamDef[] = [];
  const singleIndicator = m.blocks.map((b) => b.length === 1);
  const ho: CbModel['ho'] = [];
  spec.constructs.forEach((c, parent) => {
    if (!c.components?.length) return;
    if (c.indicators.length) throw new Error(`"${c.name}" has both indicators and component constructs.`);
    c.components.forEach((name, i) => {
      const child = m.constructs.indexOf(name);
      if (child < 0) throw new Error(`"${c.name}" refers to unknown component "${name}".`);
      if (m.preds[child].length) throw new Error(`"${name}" is a component of "${c.name}" and cannot have structural predictors.`);
      ho.push({ parent, child, marker: i === 0 });
    });
  });
  spec.constructs.forEach((c, j) => {
    if (!c.components?.length && m.blocks[j].length === 0) throw new Error(`"${c.name}" has no indicators.`);
  });
  const isChild = new Set(ho.map((h) => h.child));
  const covariates = spec.constructs.flatMap((c, j) => (c.covariate ? [j] : []));
  for (const j of covariates) {
    if (m.blocks[j].length !== 1 || m.preds[j].length || isChild.has(j)) {
      throw new Error(`Covariate "${m.constructs[j]}" must be a single observed variable without predictors.`);
    }
  }
  const isCov = new Set(covariates);

  m.blocks.forEach((b, j) => b.slice(1).forEach((i) => params.push({ kind: 'loading', i, j })));
  for (let t = 0; t < k; t++) for (const f of m.preds[t]) params.push({ kind: 'regression', i: t, j: f });
  for (const h of ho) if (!h.marker) params.push({ kind: 'hoLoading', i: h.child, j: h.parent });
  const exo = m.constructs.map((_, j) => j).filter((j) => m.preds[j].length === 0 && !isChild.has(j));
  for (let j = 0; j < k; j++) if (!isCov.has(j)) params.push({ kind: 'lvcov', i: j, j });
  // Exogenous latent variables covary; observed covariates (fixed.x) do not covary with them (lavaan default).
  const exoLatent = exo.filter((j) => !isCov.has(j));
  // Pairs the user fixed at zero (uncorrelated exogenous constructs) get no parameter.
  const zero = new Set((spec.covariances ?? []).filter((cv) => cv.zero && cv.kind === 'construct')
    .map((cv) => [m.constructs.indexOf(cv.a), m.constructs.indexOf(cv.b)].sort((x, y) => x - y).join(',')));
  for (let a = 0; a < exoLatent.length; a++) for (let b = a + 1; b < exoLatent.length; b++) {
    if (!zero.has([exoLatent[a], exoLatent[b]].sort((x, y) => x - y).join(','))) params.push({ kind: 'lvcov', i: exoLatent[a], j: exoLatent[b] });
  }
  m.indicatorNames.forEach((_, i) => {
    if (!singleIndicator[m.indicatorConstruct[i]]) params.push({ kind: 'residual', i, j: i });
  });
  addCovariances(spec, m, params, new Set(exoLatent), isCov, singleIndicator);
  return fixValues(spec, { m, params, p: m.indicatorNames.length, k, singleIndicator, exo, ho, covariates, fixedPsi: [] });
}

/**
 * Parameters the user fixed at a value (lavaan's `a*x`): removed from the
 * free parameters and held in the model matrices instead.
 */
function fixValues(spec: ModelSpec, cm: CbModel): CbModel {
  const { m } = cm;
  let params = cm.params;
  const fixedCoef: NonNullable<CbModel['fixedCoef']> = [];
  const fixedPsi: CbModel['fixedPsi'] = [];
  const fixedThetaCov: NonNullable<CbModel['fixedThetaCov']> = [];
  const take = (match: (d: ParamDef) => boolean) => { const d = params.find(match); params = params.filter((x) => x !== d); return d; };
  for (const p of spec.paths) {
    if (p.fixed === undefined) continue;
    const i = m.constructs.indexOf(p.to), j = m.constructs.indexOf(p.from);
    const d = take((x) => x.kind === 'regression' && x.i === i && x.j === j);
    if (!d) throw new Error(`The path ${p.from} → ${p.to} cannot be fixed.`);
    fixedCoef.push({ ...d, value: p.fixed });
  }
  spec.constructs.forEach((c, j) => {
    for (const [ind, value] of Object.entries(c.fixedLoadings ?? {})) {
      const i = m.indicatorNames.indexOf(ind);
      if (i < 0 || !m.blocks[j].includes(i)) throw new Error(`"${ind}" is not an indicator of ${c.name}; its loading cannot be fixed.`);
      // The marker has no free loading: its value replaces the 1.
      take((x) => x.kind === 'loading' && x.i === i && x.j === j);
      fixedCoef.push({ kind: 'loading', i, j, value });
    }
  });
  for (const cv of spec.covariances ?? []) {
    if (cv.fixed === undefined || cv.zero) continue;
    if (cv.kind === 'construct') {
      const [i, j] = [m.constructs.indexOf(cv.a), m.constructs.indexOf(cv.b)].sort((x, y) => x - y);
      if (!take((x) => x.kind === 'lvcov' && x.i === i && x.j === j)) throw new Error(`The covariance ${cv.a} ↔ ${cv.b} cannot be fixed.`);
      fixedPsi.push({ i, j, value: cv.fixed });
    } else {
      const [i, j] = [m.indicatorNames.indexOf(cv.a), m.indicatorNames.indexOf(cv.b)].sort((x, y) => x - y);
      if (!take((x) => x.kind === 'rescov' && x.i === i && x.j === j)) throw new Error(`The error covariance ${cv.a} ↔ ${cv.b} cannot be fixed.`);
      fixedThetaCov.push({ i, j, value: cv.fixed });
    }
  }
  return { ...cm, params, fixedPsi, ...(fixedCoef.length ? { fixedCoef } : {}), ...(fixedThetaCov.length ? { fixedThetaCov } : {}) };
}

/**
 * User-specified covariances: disturbance covariances between two endogenous
 * constructs (or higher-order components), and correlated measurement errors.
 */
function addCovariances(spec: ModelSpec, m: CompiledModel, params: ParamDef[], exoLatent: Set<number>, isCov: Set<number>, singleIndicator: boolean[]) {
  const seen = new Set<string>();
  for (const cv of spec.covariances ?? []) {
    const label = `${cv.a} ↔ ${cv.b}`;
    if (cv.kind === 'construct') {
      const a = m.constructs.indexOf(cv.a), b = m.constructs.indexOf(cv.b);
      if (a < 0 || b < 0) throw new Error(`Correlation ${label} refers to an unknown construct.`);
      if (a === b) throw new Error(`Correlation ${label} connects a construct with itself.`);
      if (isCov.has(a) || isCov.has(b)) throw new Error(`Correlation ${label}: covariates (fixed.x) cannot get extra covariances.`);
      const ea = exoLatent.has(a), eb = exoLatent.has(b);
      if (cv.zero) {
        if (!ea || !eb) throw new Error(`Correlation ${label}: only two exogenous constructs can be fixed as uncorrelated.`);
        continue; // handled where the exogenous covariances are set up
      }
      if (ea && eb) continue; // exogenous constructs covary already
      if (ea !== eb) throw new Error(`Correlation ${label} joins an exogenous construct with the disturbance of an endogenous one; correlate disturbances of endogenous constructs only.`);
      const [i, j] = a < b ? [a, b] : [b, a];
      if (seen.has(`c${i},${j}`)) continue;
      seen.add(`c${i},${j}`);
      params.push({ kind: 'lvcov', i, j });
    } else {
      const a = m.indicatorNames.indexOf(cv.a), b = m.indicatorNames.indexOf(cv.b);
      if (a < 0 || b < 0) throw new Error(`Error correlation ${label} refers to an indicator that is not in the model.`);
      if (a === b) throw new Error(`Error correlation ${label} connects an indicator with itself.`);
      if (singleIndicator[m.indicatorConstruct[a]] || singleIndicator[m.indicatorConstruct[b]]) {
        throw new Error(`Error correlation ${label}: single-indicator constructs have no measurement error to correlate.`);
      }
      const [i, j] = a < b ? [a, b] : [b, a];
      if (seen.has(`i${i},${j}`)) continue;
      seen.add(`i${i},${j}`);
      params.push({ kind: 'rescov', i, j });
    }
  }
}

/** Fix covariate (co)variances at the values of this sample covariance matrix. */
export function bindSample(cm: CbModel, S: Mat): CbModel {
  if (cm.covariates.length === 0) return cm;
  // User-fixed covariances stay; covariate (co)variances take this sample's values.
  const fixedPsi: CbModel['fixedPsi'] = cm.fixedPsi.filter((f) => !(cm.covariates.includes(f.i) && cm.covariates.includes(f.j)));
  for (const a of cm.covariates) for (const b of cm.covariates) {
    if (b < a) continue;
    fixedPsi.push({ i: a, j: b, value: S[cm.m.blocks[a][0]][cm.m.blocks[b][0]] });
  }
  return { ...cm, fixedPsi };
}

interface Matrices { L: Mat; B: Mat; Psi: Mat; theta: number[]; thetaCov: { i: number; j: number; v: number }[]; A: Mat; C: Mat; Sigma: Mat }

function matrices(cm: CbModel, th: number[]): Matrices {
  const { p, k, m } = cm;
  const L = zeros(p, k);
  m.blocks.forEach((b, j) => { if (b.length) L[b[0]][j] = 1; });
  const B = zeros(k, k);
  const Psi = zeros(k, k);
  const theta = new Array<number>(p).fill(0);
  const thetaCov: Matrices['thetaCov'] = [];
  for (const h of cm.ho) if (h.marker) B[h.child][h.parent] = 1;
  for (const f of cm.fixedPsi) { Psi[f.i][f.j] = f.value; Psi[f.j][f.i] = f.value; }
  for (const f of cm.fixedCoef ?? []) { if (f.kind === 'loading') L[f.i][f.j] = f.value; else B[f.i][f.j] = f.value; }
  for (const f of cm.fixedThetaCov ?? []) thetaCov.push({ i: f.i, j: f.j, v: f.value });
  cm.params.forEach((d, a) => {
    const v = th[a];
    if (d.kind === 'loading') L[d.i][d.j] = v;
    else if (d.kind === 'regression' || d.kind === 'hoLoading') B[d.i][d.j] = v;
    else if (d.kind === 'lvcov') { Psi[d.i][d.j] = v; Psi[d.j][d.i] = v; }
    else if (d.kind === 'rescov') thetaCov.push({ i: d.i, j: d.j, v });
    else theta[d.i] = v;
  });
  const IB = B.map((row, i) => row.map((v, j) => (i === j ? 1 : 0) - v));
  const A = invert(IB);
  const C = sandwich(A, Psi);
  const LC = mul(L, C);
  const Sigma = zeros(p, p);
  for (let i = 0; i < p; i++) for (let j = 0; j <= i; j++) {
    let s = 0;
    for (let q = 0; q < k; q++) s += LC[i][q] * L[j][q];
    if (i === j) s += theta[i];
    Sigma[i][j] = s; Sigma[j][i] = s;
  }
  for (const t of thetaCov) { Sigma[t.i][t.j] += t.v; Sigma[t.j][t.i] += t.v; }
  return { L, B, Psi, theta, thetaCov, A, C, Sigma };
}

function mul(a: Mat, b: Mat): Mat {
  const r = a.length, k = b.length, c = b[0]?.length ?? 0;
  const out = zeros(r, c);
  for (let i = 0; i < r; i++) {
    const ai = a[i], oi = out[i];
    for (let q = 0; q < k; q++) {
      const v = ai[q];
      if (v === 0) continue;
      const bq = b[q];
      for (let j = 0; j < c; j++) oi[j] += v * bq[j];
    }
  }
  return out;
}
/** A M Aᵀ */
const sandwich = (A: Mat, M: Mat): Mat => mul(mul(A, M), A.map((_, i) => A.map((r) => r[i])));

/**
 * dΣ/dθ_a for every free parameter. Each derivative is a symmetric outer
 * product c (u vᵀ + v uᵀ), which keeps gradient and information cheap.
 */
interface Deriv { u: number[]; v: number[]; c: number }

function derivatives(cm: CbModel, X: Matrices): Deriv[] {
  const { p } = cm;
  const LC = mul(X.L, X.C);
  const LA = mul(X.L, X.A);
  const col = (M: Mat, j: number) => M.map((r) => r[j]);
  const unit = (i: number) => { const e = new Array<number>(p).fill(0); e[i] = 1; return e; };
  return cm.params.map((d) => {
    switch (d.kind) {
      case 'loading': return { u: unit(d.i), v: col(LC, d.j), c: 1 };
      case 'regression':
      case 'hoLoading': return { u: col(LA, d.i), v: col(LC, d.j), c: 1 };
      case 'lvcov': return { u: col(LA, d.i), v: col(LA, d.j), c: d.i === d.j ? 0.5 : 1 };
      case 'residual': { const e = unit(d.i); return { u: e, v: e, c: 0.5 }; }
      case 'rescov': return { u: unit(d.i), v: unit(d.j), c: 1 };
    }
  });
}

const dot = (a: number[], b: number[]) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
const matVec = (M: Mat, v: number[]) => M.map((r) => dot(r, v));

type StartStrategy = 'fabin' | 'covratio' | 'simple';

/**
 * Starting values. 'fabin': FABIN3 instrumental-variable loadings (Hägglund
 * 1982, lavaan's default) with factor variances from the implied covariances;
 * 'covratio': ratios of average within-block covariances; 'simple': unit
 * loadings and small factor variances (lavaan's "simple").
 */
function startValues(cm: CbModel, S: Mat, strategy: StartStrategy = 'fabin'): number[] {
  const { m } = cm;
  const scale = new Array<number>(cm.k).fill(0);
  const lambda = new Map<number, number>();
  m.blocks.forEach((b, j) => {
    const mk = b[0];
    if (b.length === 0) return; // higher-order: set from its components below
    if (strategy === 'simple') {
      b.forEach((i) => lambda.set(i, 1));
      scale[j] = b.length > 1 ? 0.05 : S[mk][mk];
      return;
    }
    if (strategy === 'covratio' || b.length < 3) {
      const avgCov = (i: number) => {
        const others = b.filter((o) => o !== i);
        return others.length ? mean(others.map((o) => S[i][o])) : S[i][i];
      };
      const ref = avgCov(mk);
      b.forEach((i) => lambda.set(i, b.length > 1 && Math.abs(ref) > 1e-8 ? avgCov(i) / ref : 1));
    } else {
      lambda.set(mk, 1);
      for (const i of b.slice(1)) {
        const Z = b.filter((o) => o !== mk && o !== i);
        try {
          const Szz = invert(Z.map((a) => Z.map((c) => S[a][c])));
          const zMk = Z.map((z) => S[z][mk]);
          const w = Szz.map((row) => dot(row, zMk));
          const num = Z.reduce((acc, z, a) => acc + S[i][z] * w[a], 0);
          const den = Z.reduce((acc, z, a) => acc + S[mk][z] * w[a], 0);
          lambda.set(i, Math.abs(den) > 1e-10 ? num / den : 1);
        } catch {
          lambda.set(i, 1);
        }
      }
    }
    if (b.length === 1) { scale[j] = S[mk][mk]; return; }
    // Factor variance from off-diagonal covariances: s_il ≈ λ_i λ_l ψ.
    const est: number[] = [];
    for (let a = 0; a < b.length; a++) for (let c = a + 1; c < b.length; c++) {
      const ll = lambda.get(b[a])! * lambda.get(b[c])!;
      if (Math.abs(ll) > 1e-8) est.push(S[b[a]][b[c]] / ll);
    }
    scale[j] = Math.max(0.05 * S[mk][mk], Math.min(S[mk][mk], est.length ? mean(est) : 0.5 * S[mk][mk]));
  });
  // Higher-order factors: half the average component variance; components keep the other half as disturbance.
  const parents = [...new Set(cm.ho.map((h) => h.parent))];
  for (const par of parents) {
    const kids = cm.ho.filter((h) => h.parent === par).map((h) => scale[h.child]);
    scale[par] = 0.5 * mean(kids);
    for (const h of cm.ho.filter((x) => x.parent === par)) scale[h.child] *= 0.5;
  }
  return cm.params.map((d) => {
    if (d.kind === 'loading') return lambda.get(d.i) ?? 1;
    if (d.kind === 'hoLoading') return 1;
    if (d.kind === 'regression') return 0;
    if (d.kind === 'lvcov') return d.i === d.j ? scale[d.i] : 0;
    if (d.kind === 'rescov') return 0;
    if (strategy === 'simple') return 0.5 * S[d.i][d.i];
    const l = lambda.get(d.i) ?? 1;
    return Math.max(0.1 * S[d.i][d.i], S[d.i][d.i] - l * l * scale[m.indicatorConstruct[d.i]]);
  });
}

/** ML discrepancy F = log|Σ| + tr(SΣ⁻¹) − log|S| − p, or Infinity if Σ is not PD. */
function discrepancy(S: Mat, logDetS: number, Sigma: Mat): { F: number; inv: Mat; logDet: number } | null {
  const L = cholesky(Sigma);
  if (!L) return null;
  const inv = invertPD(L);
  const logDet = logDetPD(L);
  let tr = 0;
  for (let i = 0; i < S.length; i++) for (let j = 0; j < S.length; j++) tr += S[i][j] * inv[j][i];
  return { F: logDet + tr - logDetS - S.length, inv, logDet };
}

export interface CbCore {
  theta: number[];
  X: Matrices;
  F: number;
  logDetSigma: number;
  /** Expected-information matrix of F (Fisher), used for standard errors. */
  H: Mat;
  iterations: number;
  converged: boolean;
}

/**
 * ML fit with a multi-start fallback: FABIN3 starts first, then the other
 * strategies if the solution did not converge or is improper (negative
 * variances). The best converged proper solution, else the lowest F, wins.
 */
export function fitCb(cm: CbModel, S: Mat, init?: number[], maxIter = 500): CbCore {
  const proper = (c: CbCore) => cm.params.every((d, a) => !((d.kind === 'residual' || (d.kind === 'lvcov' && d.i === d.j)) && c.theta[a] < 0));
  const attempts: CbCore[] = [];
  const tryStart = (th: number[] | undefined, strategy: StartStrategy) => {
    try {
      const c = fitCbFrom(cm, S, th ?? startValues(cm, S, strategy), maxIter);
      attempts.push(c);
      return c.converged && proper(c);
    } catch {
      return false;
    }
  };
  if (init && tryStart(init, 'fabin')) return attempts[0];
  for (const strategy of ['fabin', 'covratio', 'simple'] as const) if (tryStart(undefined, strategy)) return attempts[attempts.length - 1];
  if (attempts.length === 0) throw new Error('Could not find valid starting values.');
  const rank = (c: CbCore) => (c.converged ? 0 : 2) + (proper(c) ? 0 : 1);
  return attempts.reduce((best, c) => (rank(c) < rank(best) || (rank(c) === rank(best) && c.F < best.F) ? c : best));
}

function fitCbFrom(cm: CbModel, S: Mat, init: number[], maxIter: number): CbCore {
  const SL = cholesky(S);
  if (!SL) throw new Error('The indicator covariance matrix is not positive definite (collinear or constant indicators).');
  const logDetS = logDetPD(SL);
  let th = init.slice();
  let X = matrices(cm, th);
  let cur = discrepancy(S, logDetS, X.Sigma);
  if (!cur) throw new Error('Starting values give a non-positive-definite Σ.');
  const q = th.length;
  let H: Mat = zeros(q, q);
  let converged = false;
  let it = 0;
  for (; it < maxIter; it++) {
    const D = derivatives(cm, X);
    const P = cur.inv;
    // W = Σ⁻¹ − Σ⁻¹ S Σ⁻¹ ; g_a = tr(W dΣ_a) = 2c u'Wv
    const PS = mul(P, S);
    const PSP = mul(PS, P);
    const W = P.map((r, i) => r.map((v, j) => v - PSP[i][j]));
    const g = D.map((d) => 2 * d.c * dot(d.u, matVec(W, d.v)));
    // H_ab = tr(Σ⁻¹ dΣ_a Σ⁻¹ dΣ_b) = 2 c_a c_b [(u_a'Pu_b)(v_a'Pv_b) + (u_a'Pv_b)(v_a'Pu_b)]
    const Pu = D.map((d) => matVec(P, d.u));
    const Pv = D.map((d) => matVec(P, d.v));
    H = zeros(q, q);
    for (let a = 0; a < q; a++) for (let b = a; b < q; b++) {
      const da = D[a];
      const v = 2 * da.c * D[b].c * (dot(da.u, Pu[b]) * dot(da.v, Pv[b]) + dot(da.u, Pv[b]) * dot(da.v, Pu[b]));
      H[a][b] = v; H[b][a] = v;
    }
    if (Math.max(...g.map(Math.abs)) < 1e-9) { converged = true; break; }
    // Levenberg damping when the information matrix is (locally) singular,
    // e.g. a two-indicator factor that is disconnected at the start values.
    let Hinv: Mat | null = null;
    for (let mu = 0; !Hinv && mu < 1e6; mu = mu === 0 ? 1e-6 : mu * 10) {
      try { Hinv = invert(mu === 0 ? H : H.map((r, a) => r.map((v, b) => (a === b ? v * (1 + mu) + mu : v)))); } catch { /* increase damping */ }
    }
    if (!Hinv) throw new Error('The model is not identified (information matrix is singular).');
    const step = Hinv.map((row) => -row.reduce((s, v, b) => s + v * g[b], 0));
    let t = 1;
    let accepted = false;
    for (let half = 0; half < 30; half++, t /= 2) {
      const cand = th.map((v, a) => v + t * step[a]);
      let Xc: Matrices;
      try { Xc = matrices(cm, cand); } catch { continue; }
      const dc = discrepancy(S, logDetS, Xc.Sigma);
      if (dc && dc.F <= cur.F + 1e-12) {
        const improvement = cur.F - dc.F;
        th = cand; X = Xc; cur = dc; accepted = true;
        if (improvement < 1e-14 && half === 0) converged = true;
        break;
      }
    }
    if (!accepted || converged) { converged = converged || !accepted && Math.max(...g.map(Math.abs)) < 1e-6; break; }
  }
  return { theta: th, X, F: cur.F, logDetSigma: cur.logDet, H, iterations: it + 1, converged };
}

/** Gradient of the ML discrepancy F at θ (for the observed information used by MLR). */
function mlGradient(cm: CbModel, S: Mat, th: number[]): number[] {
  const X = matrices(cm, th);
  const P = invertPD(cholesky(X.Sigma)!);
  const PSP = mul(mul(P, S), P);
  const W = P.map((r, i) => r.map((v, j) => v - PSP[i][j]));
  return derivatives(cm, X).map((d) => 2 * d.c * dot(d.u, matVec(W, d.v)));
}

/**
 * Least-squares fitting, F = rᵀVr with r = vech(S − Σ(θ)): GLS (V = ½Dᵀ(S⁻¹⊗S⁻¹)D)
 * and ULS (V = I). Gauss–Newton with step halving and Levenberg damping.
 */
function fitLS(cm: CbModel, S: Mat, V: Mat, pairs: Pairs, init?: number[], maxIter = 500): CbCore {
  const s = vech(S, pairs);
  let th = init ? init.slice() : startValues(cm, S);
  const objective = (X: Matrices) => {
    const r = vech(X.Sigma, pairs).map((v, a) => s[a] - v);
    let f = 0;
    for (let a = 0; a < r.length; a++) { let row = 0; for (let b = 0; b < r.length; b++) row += V[a][b] * r[b]; f += r[a] * row; }
    return { f, r };
  };
  let X = matrices(cm, th);
  let cur = objective(X);
  const q = th.length;
  let converged = false;
  let it = 0;
  for (; it < maxIter; it++) {
    const Delta = deltaMatrix(derivatives(cm, X), pairs);
    const VD = mm(V, Delta);
    const E = mm(tp(Delta), VD);
    const g = tp(VD).map((row) => -2 * dot(row, cur.r));
    if (Math.max(...g.map(Math.abs)) < 1e-10) { converged = true; break; }
    let Einv: Mat | null = null;
    for (let mu = 0; !Einv && mu < 1e6; mu = mu === 0 ? 1e-6 : mu * 10) {
      try { Einv = invert(mu === 0 ? E : E.map((r, a) => r.map((v, b) => (a === b ? v * (1 + mu) + mu : v)))); } catch { /* damp more */ }
    }
    if (!Einv) throw new Error('The model is not identified (information matrix is singular).');
    const step = Einv.map((row) => -0.5 * dot(row, g));
    let accepted = false;
    for (let half = 0, tt = 1; half < 30; half++, tt /= 2) {
      const cand = th.map((v, a) => v + tt * step[a]);
      let Xc: Matrices;
      try { Xc = matrices(cm, cand); } catch { continue; }
      const oc = objective(Xc);
      if (oc.f <= cur.f + 1e-15) {
        const improvement = cur.f - oc.f;
        th = cand; X = Xc; cur = oc; accepted = true;
        if (improvement < 1e-16 && half === 0) converged = true;
        break;
      }
    }
    if (!accepted || converged) { converged = converged || Math.max(...g.map(Math.abs)) < 1e-7; break; }
  }
  const L = cholesky(X.Sigma);
  return { theta: th, X, F: cur.f, logDetSigma: L ? logDetPD(L) : NaN, H: zeros(q, q), iterations: it + 1, converged };
}

/** The covariance matrix an estimator works with: lavaan fits GLS/ULS to the unbiased (N − 1) matrix. */
export function covForEstimator(SN: Mat, n: number, estimator: CbEstimator): Mat {
  return estimator === 'GLS' || estimator === 'ULS' ? SN.map((r) => r.map((v) => (v * n) / (n - 1))) : SN;
}

export function sampleCov(cols: Float64Array[], estimator: CbEstimator): Mat {
  return covForEstimator(covarianceN(cols), cols[0].length, estimator);
}

/** Point estimates: ML for the ML family (MLM/MLMV/MLR differ only in inference), else least squares. */
export function fitEstimator(cm0: CbModel, S: Mat, estimator: CbEstimator, init?: number[], maxIter = 500): CbCore {
  const cm = bindSample(cm0, S);
  if (estimator !== 'GLS' && estimator !== 'ULS') return fitCb(cm, S, init, maxIter);
  const pairs = vechPairs(cm.p);
  const V = estimator === 'GLS' ? weightNT(invertPD(cholesky(S)!), pairs) : pairs.map((_, a) => pairs.map((__, b) => (a === b ? 1 : 0)));
  return fitLS(cm, S, V, pairs, init, maxIter);
}

// ---------- data ----------

export function covarianceN(cols: Float64Array[]): Mat {
  const n = cols[0].length;
  const means = cols.map((c) => mean(c));
  return cols.map((a, i) => cols.map((b, j) => {
    let s = 0;
    for (let r = 0; r < n; r++) s += (a[r] - means[i]) * (b[r] - means[j]);
    return s / n;
  }));
}

export interface CbModeration { from: string; moderator: string; to: string; construct: number }

/**
 * Compile the model and extract its indicator columns. Moderation is modelled
 * as a latent interaction measured by matched-pair product indicators of
 * mean-centred items (Marsh, Wen & Hau 2004): the i-th indicator of the
 * predictor times the i-th indicator of the moderator, in listed order.
 */
export function prepareCb(data: Dataset, spec: ModelSpec, missing: MissingTreatment) {
  const mods = spec.moderations ?? [];
  if (data.moments && data.cols.length === 0) return matrixInput(data, spec);
  if (mods.length === 0) {
    const cm = buildCbModel(spec);
    const { cols, dropped } = extractColumns(data, cm.m, missing);
    return rawInput(cm, cols, dropped, []);
  }
  const m0 = compileModel({ constructs: spec.constructs, paths: spec.paths });
  const { cols, dropped } = extractColumns(data, m0, missing);
  const names = [...m0.indicatorNames];
  const all = [...cols];
  const extraConstructs: ModelSpec['constructs'] = [];
  const extraPaths: ModelSpec['paths'] = [];
  for (const mo of mods) {
    const f = m0.constructs.indexOf(mo.from), mm = m0.constructs.indexOf(mo.moderator), t = m0.constructs.indexOf(mo.to);
    if (f < 0 || mm < 0 || t < 0) throw new Error(`Moderation ${mo.moderator} on ${mo.from} → ${mo.to} references an unknown construct.`);
    if (m0.preds[f].length || m0.preds[mm].length) {
      throw new Error(`Latent interactions need an exogenous predictor and moderator; ${m0.preds[f].length ? mo.from : mo.moderator} has incoming paths.`);
    }
    for (const src of [mo.from, mo.moderator]) {
      if (!spec.paths.some((p) => p.from === src && p.to === mo.to)) throw new Error(`Moderation needs the main effect ${src} → ${mo.to}.`);
    }
    const xi = m0.blocks[f], mi = m0.blocks[mm];
    const k = Math.min(xi.length, mi.length);
    const prodNames: string[] = [];
    for (let i = 0; i < k; i++) {
      const a = cols[xi[i]], b = cols[mi[i]];
      const ma = mean(a), mb = mean(b);
      const name = `${names[xi[i]]}×${names[mi[i]]}`;
      names.push(name);
      all.push(Float64Array.from(a, (v, r) => (v - ma) * (b[r] - mb)));
      prodNames.push(name);
    }
    const factor = interactionName(mo.from, mo.moderator);
    extraConstructs.push({ name: factor, mode: 'A', type: 'factor', indicators: prodNames });
    extraPaths.push({ from: factor, to: mo.to });
  }
  const cm = buildCbModel({ constructs: [...spec.constructs, ...extraConstructs], paths: [...spec.paths, ...extraPaths], covariances: spec.covariances });
  const ext = extractColumns({ names, cols: all }, cm.m, 'casewise');
  return rawInput(cm, ext.cols, dropped, mods.map((mo) => ({ ...mo, construct: cm.m.constructs.indexOf(interactionName(mo.from, mo.moderator)) })));
}

export interface CbInput {
  cm: CbModel;
  /** Raw indicator columns, or null for covariance-matrix input. */
  cols: Float64Array[] | null;
  /** Covariance matrix with divisor N, in model indicator order. */
  SN: Mat;
  n: number;
  /** ADF Γ in model vech order, or null when unavailable (matrix input without NACOV). */
  gamma: () => Mat | null;
  dropped: number;
  moderations: CbModeration[];
}

function rawInput(cm: CbModel, cols: Float64Array[], dropped: number, moderations: CbModeration[]): CbInput {
  let cache: Mat | null = null;
  return {
    cm, cols, SN: covarianceN(cols), n: cols[0]?.length ?? 0, dropped, moderations,
    gamma: () => {
      if (!cache) {
        const centred = cols.map((c) => { const m = mean(c); return c.map((v) => v - m); });
        cache = gammaADF(centred, vechPairs(cols.length)).Gamma;
      }
      return cache;
    },
  };
}

/**
 * Summary-statistics input (as lavaan's sample.cov / sample.nobs / NACOV):
 * S is taken as the unbiased covariance matrix, NACOV in the column-major
 * vech order of the file's variables, both reordered to the model's indicators.
 */
function matrixInput(data: Dataset, spec: ModelSpec): CbInput {
  if (spec.moderations?.length) throw new Error('Latent interactions need raw data (product indicators); this dataset is a covariance matrix.');
  const mom = data.moments!;
  const cm = buildCbModel(spec);
  const idx = cm.m.indicatorNames.map((nm) => {
    const i = data.names.indexOf(nm);
    if (i < 0) throw new Error(`Indicator "${nm}" is not in the covariance matrix.`);
    return i;
  });
  const n = mom.n;
  if (!(n > 2)) throw new Error('The covariance matrix needs a sample size N.');
  const SN = idx.map((a) => idx.map((b) => (mom.S[a][b] * (n - 1)) / n));
  const p0 = data.names.length;
  const pos = (i: number, j: number) => { const hi = Math.max(i, j), lo = Math.min(i, j); return lo * p0 - (lo * (lo - 1)) / 2 + (hi - lo); };
  const pairs = vechPairs(idx.length);
  const G = mom.nacov ? pairs.map(([a, b]) => pairs.map(([c, d]) => mom.nacov![pos(idx[a], idx[b])][pos(idx[c], idx[d])])) : null;
  return { cm, cols: null, SN, n, gamma: () => G, dropped: 0, moderations: [] };
}

// ---------- test statistics and fit indices ----------

interface TestStats {
  chisq: number;
  baselineChisq: number;
  /** Robust traces (MLM/MLMV/MLR): tr(UΓ), tr((UΓ)²) for model and baseline. */
  trU?: number; trU2?: number; trUb?: number; trU2b?: number;
}

const cfiOf = (x2: number, df: number, x2b: number, dfb: number, c = 1, cb = 1) => {
  const useC = df > 0 && c !== 1 && cb !== 1;
  const t1 = Math.max(x2 - (useC ? c : 1) * df, 0);
  const t2 = Math.max(x2 - (useC ? c : 1) * df, x2b - (useC ? cb : 1) * dfb, 0);
  return Math.abs(t1) < 1e-12 && Math.abs(t2) < 1e-12 ? 1 : 1 - t1 / t2;
};
const tliOf = (x2: number, df: number, x2b: number, dfb: number, c = 1, cb = 1) => {
  const useC = df > 0 && c !== 1 && cb !== 1;
  const t1 = (x2 - (useC ? c : 1) * df) * dfb;
  const t2 = (x2b - (useC ? cb : 1) * dfb) * df;
  return df > 0 && Math.abs(t2) > 0 ? 1 - t1 / t2 : 1;
};
const rmseaOf = (x2: number, df: number, n: number, c = 1) => (df > 0 ? Math.sqrt(Math.max((x2 / n) / df - c / n, 0)) : 0);

function fitIndices(cm: CbModel, S: Mat, core: CbCore, n: number, estimator: CbEstimator, ts: TestStats): CbFit {
  const p = cm.p;
  const npar = cm.params.length;
  // fixed.x: covariate (co)variances are not data moments for the model.
  const kx = cm.covariates.length;
  const pstar = (p * (p + 1)) / 2 - (kx * (kx + 1)) / 2;
  const df = pstar - npar;
  const { chisq, baselineChisq } = ts;
  const baselineDf = pstar - (p - kx);
  const cfi = cfiOf(chisq, df, baselineChisq, baselineDf);
  const tli = tliOf(chisq, df, baselineChisq, baselineDf);
  // Least-squares estimators work with N − 1 throughout (as lavaan).
  const nR = estimator === 'GLS' || estimator === 'ULS' ? n - 1 : n;
  const rmsea = rmseaOf(chisq, df, nR);

  // 90% CI by inverting the noncentral chi-square in its noncentrality parameter.
  const ciFor = (target: number) => {
    const f = (ncp: number) => ncChisqCdf(chisq, df, ncp) - target;
    if (f(0) < 0) return 0;
    let hi = Math.max(10, chisq);
    while (f(hi) > 0 && hi < 1e7) hi *= 2;
    return Math.sqrt(bisect(f, 0, hi, 1e-9) / (nR * df));
  };
  const rmseaLow = df > 0 ? ciFor(0.95) : 0;
  const rmseaHigh = df > 0 ? ciFor(0.05) : 0;
  const rmseaP = df > 0 ? 1 - ncChisqCdf(chisq, df, nR * df * 0.05 ** 2) : NaN;

  const Sig = core.X.Sigma;
  let ss = 0;
  // Bentler's SRMR: residuals scaled by the observed standard deviations (as lavaan).
  for (let i = 0; i < p; i++) for (let j = 0; j <= i; j++) {
    const r = (S[i][j] - Sig[i][j]) / Math.sqrt(S[i][i] * S[j][j]);
    ss += r * r;
  }
  const srmr = Math.sqrt(ss / ((p * (p + 1)) / 2));
  // Log-likelihood (and AIC/BIC) are only meaningful for the ML family.
  let logl = NaN;
  if (estimator !== 'GLS' && estimator !== 'ULS') {
    let trc = 0;
    const inv = invertPD(cholesky(Sig)!);
    for (let i = 0; i < p; i++) for (let j = 0; j < p; j++) trc += S[i][j] * inv[j][i];
    logl = (-n / 2) * (p * Math.log(2 * Math.PI) + core.logDetSigma + trc);
    // fixed.x: lavaan reports the likelihood conditional on the covariates, i.e. minus
    // the (saturated) marginal likelihood of x.
    if (kx > 0) {
      const xi = cm.covariates.map((j) => cm.m.blocks[j][0]);
      const Sxx = xi.map((a) => xi.map((b) => S[a][b]));
      logl -= (-n / 2) * (kx * Math.log(2 * Math.PI) + logDetPD(cholesky(Sxx)!) + kx);
    }
  }
  const fit: CbFit = {
    // ULS χ² has no reference distribution (lavaan reports no p-value).
    chisq, df, pvalue: df > 0 && estimator !== 'ULS' ? 1 - chisqCdf(chisq, df) : NaN, baselineChisq, baselineDf, cfi, tli,
    rmsea, rmseaLow, rmseaHigh, rmseaP, srmr, logl, npar,
    aic: -2 * logl + 2 * npar, bic: -2 * logl + npar * Math.log(n),
  };

  if (ts.trU !== undefined && df > 0) {
    let scaled: number, scaledB: number, c: number, cb: number, rmseaScaled: number;
    if (estimator === 'MLMV') {
      // Scaled-and-shifted (Asparouhov & Muthén 2010), as lavaan "scaled.shifted".
      const a = Math.sqrt(df / ts.trU2!), b = df - a * ts.trU;
      const ab = Math.sqrt(baselineDf / ts.trU2b!), bb = baselineDf - ab * ts.trUb!;
      scaled = chisq * a + b;
      scaledB = baselineChisq * ab + bb;
      fit.scalingFactor = 1 / a;
      fit.shiftParameter = b;
      c = (1 / a) * (df - b) / df;
      cb = (1 / ab) * (baselineDf - bb) / baselineDf;
      rmseaScaled = rmseaOf(scaled, df, n);
    } else {
      // Satorra–Bentler (MLM) or Yuan–Bentler (MLR) mean scaling.
      c = ts.trU / df;
      cb = ts.trUb! / baselineDf;
      scaled = chisq / c;
      scaledB = baselineChisq / cb;
      fit.scalingFactor = c;
      rmseaScaled = rmseaOf(chisq, ts.trU, n);
    }
    Object.assign(fit, {
      chisqScaled: scaled, dfScaled: df, pvalueScaled: 1 - chisqCdf(scaled, df), baselineChisqScaled: scaledB,
      cfiScaled: cfiOf(scaled, df, scaledB, baselineDf), tliScaled: tliOf(scaled, df, scaledB, baselineDf),
      // Robust indices (Brosseau-Liard & Savalei): population-corrected with ĉ.
      cfiRobust: cfiOf(chisq, df, baselineChisq, baselineDf, c, cb), tliRobust: tliOf(chisq, df, baselineChisq, baselineDf, c, cb),
      rmseaScaled, rmseaRobust: rmseaOf(chisq, df, n, c),
    });
  }
  return fit;
}

// ---------- inference per estimator ----------

interface Inference { cov: Mat | null; ts: TestStats }

function inference(cm: CbModel, S: Mat, gammaOf: () => Mat | null, core: CbCore, n: number, estimator: CbEstimator): Inference {
  const p = cm.p;
  const pairs = vechPairs(p);
  const X = core.X;
  const Delta = deltaMatrix(derivatives(cm, X), pairs);
  const s = vech(S, pairs);
  const sigma = vech(X.Sigma, pairs);
  const SL = cholesky(S)!;
  const Sinv = invertPD(SL);
  const inv = (M: Mat) => { try { return invert(M); } catch { return null; } };
  const sandwichCov = (Ainv: Mat, B: Mat) => mm(mm(Ainv, B), Ainv).map((r) => r.map((v) => v / n));

  // Independence (baseline) model: Σ_b = diag(ψ) for outcomes; covariates keep their
  // sample (co)variances (fixed.x). Δ_b has one column per free variance.
  const xInd = new Set(cm.covariates.map((j) => cm.m.blocks[j][0]));
  const yInd = Array.from({ length: p }, (_, i) => i).filter((i) => !xInd.has(i));
  const Db: Mat = pairs.map(([i, j]) => yInd.map((k) => (i === j && i === k ? 1 : 0)));
  const fixedB = pairs.map(([i, j]) => (xInd.has(i) && xInd.has(j) ? S[i][j] : 0));

  if (estimator === 'GLS' || estimator === 'ULS') {
    const V = estimator === 'GLS' ? weightNT(Sinv, pairs) : pairs.map((_, a) => pairs.map((__, b) => (a === b ? 1 : 0)));
    const E = quad(Delta, V);
    const Einv = inv(E);
    let cov: Mat | null = null;
    if (Einv) {
      // lavaan's "standard" SEs for both least-squares estimators: (ΔᵀVΔ)⁻¹ / (N − 1).
      // For ULS this is not a sampling variance; use bootstrapping for inference.
      cov = Einv.map((r) => r.map((v) => v / (n - 1)));
    }
    const sAdj = s.map((v, a) => v - fixedB[a]);
    const psiB = inv(quad(Db, V))!.map((row) => dot(row, tp(Db).map((col) => dot(col, V.map((r) => dot(r, sAdj))))));
    const rB = sAdj.map((v, a) => v - dot(Db[a], psiB));
    const fB = rB.reduce((acc, v, a) => acc + v * dot(V[a], rB), 0);
    // Test statistic (N − 1)·F with F = rᵀVr on the unbiased covariance matrix.
    return { cov, ts: { chisq: (n - 1) * core.F, baselineChisq: (n - 1) * fB } };
  }

  // ML family
  const chisq = n * core.F;
  const Sxx = [...xInd].map((a) => [...xInd].map((b) => S[a][b]));
  const logDetSxx = Sxx.length ? logDetPD(cholesky(Sxx)!) : 0;
  const baselineChisq = n * (yInd.reduce((acc, i) => acc + Math.log(S[i][i]), 0) + logDetSxx - logDetPD(SL));
  const W = weightNT(invertPD(cholesky(X.Sigma)!), pairs);
  const E = quad(Delta, W);
  const Einv = inv(E);
  if (estimator === 'ML') return { cov: Einv && Einv.map((r) => r.map((v) => v / n)), ts: { chisq, baselineChisq } };

  const Gamma = gammaOf();
  if (!Gamma) throw new Error(`${estimator} needs raw data or a NACOV (asymptotic covariance) matrix.`);
  const SigmaB = S.map((r, i) => r.map((v, j) => (i === j ? v : xInd.has(i) && xInd.has(j) ? v : 0)));
  const Wb = weightNT(invertPD(cholesky(SigmaB)!), pairs);
  const Eb = quad(Db, Wb);

  if (estimator === 'MLM' || estimator === 'MLMV') {
    const WD = mm(W, Delta);
    const cov = Einv && sandwichCov(Einv, quad(WD, Gamma));
    const uTrace = (Wm: Mat, Dm: Mat, Em: Mat) => {
      // A singular information matrix (an unidentified model) leaves the scaled test undefined.
      const EmInv = inv(Em);
      if (!EmInv) return { tr1: NaN, tr2: NaN };
      const WDm = mm(Wm, Dm);
      const U = mm(mm(WDm, EmInv), tp(WDm)).map((r, a) => r.map((v, b) => Wm[a][b] - v));
      const UG = mm(U, Gamma);
      return { tr1: tr(UG), tr2: trProd(UG, UG) };
    };
    const m0 = uTrace(W, Delta, E);
    const b0 = uTrace(Wb, Db, Eb);
    return { cov, ts: { chisq, baselineChisq, trU: m0.tr1, trU2: m0.tr2, trUb: b0.tr1, trU2b: b0.tr2 } };
  }

  // MLR: observed (Hessian) information, first-order meat, Yuan–Bentler (Mplus) trace.
  const q = core.theta.length;
  const Eobs = zeros(q, q);
  for (let a = 0; a < q; a++) {
    const h = 1e-5 * Math.max(1, Math.abs(core.theta[a]));
    const up = core.theta.slice(); up[a] += h;
    const dn = core.theta.slice(); dn[a] -= h;
    const gu = mlGradient(cm, S, up), gd = mlGradient(cm, S, dn);
    for (let b = 0; b < q; b++) Eobs[b][a] = (0.5 * (gu[b] - gd[b])) / (2 * h);
  }
  const Esym = Eobs.map((r, a) => r.map((v, b) => (v + Eobs[b][a]) / 2));
  const EobsInv = inv(Esym);
  const r = s.map((v, a) => v - sigma[a]);
  const meatOf = (Wm: Mat, Dm: Mat, resid: number[]) => {
    const G2 = Gamma.map((row, a) => row.map((v, b) => v + resid[a] * resid[b]));
    return quad(mm(Wm, Dm), G2);
  };
  const B0 = meatOf(W, Delta, r);
  const cov = EobsInv && sandwichCov(EobsInv, B0);
  const h1 = trProd(weightNT(Sinv, pairs), Gamma);
  const sigmaB = vech(SigmaB, pairs);
  const rb = s.map((v, a) => v - sigmaB[a]);
  const trU = h1 - (EobsInv ? trProd(B0, EobsInv) : NaN);
  const trUb = h1 - trProd(meatOf(Wb, Db, rb), invert(Eb));
  return { cov, ts: { chisq, baselineChisq, trU, trUb } };
}

// ---------- standardised quantities ----------

export function standardized(cm: CbModel, X: Matrices) {
  const { m, k } = cm;
  const sdEta = X.C.map((r, i) => Math.sqrt(r[i]));
  const sdX = X.Sigma.map((r, i) => Math.sqrt(r[i]));
  const stdLoadings = m.indicatorConstruct.map((j, i) => (X.L[i][j] * sdEta[j]) / sdX[i]);
  const stdPaths = zeros(k, k);
  for (let t = 0; t < k; t++) for (const f of m.preds[t]) stdPaths[f][t] = (X.B[t][f] * sdEta[f]) / sdEta[t];
  // Total effects in [from][to] orientation: T = B + B² + …, standardised.
  const total = zeros(k, k);
  let power = stdPaths.map((r) => r.slice());
  for (let s = 0; s < k; s++) {
    for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) total[i][j] += power[i][j];
    power = mul(power, stdPaths);
  }
  const indirect = total.map((r, i) => r.map((v, j) => v - stdPaths[i][j]));
  const lvCor = X.C.map((r, i) => r.map((v, j) => v / (sdEta[i] * sdEta[j])));
  return { stdLoadings, stdPaths, total, indirect, lvCor, sdEta, sdX };
}

export function estimateCb(data: Dataset, spec: ModelSpec, missing: MissingTreatment = 'casewise', estimator: CbEstimator = 'ML'): CbResult {
  if (estimator === 'WLSMV' || spec.ordered?.length || missing === 'fiml') throw new Error('Ordinal indicators, WLSMV and FIML are estimated by lavaan: choose the R engine.');
  if (spec.multigroup) throw new Error('Multiple-group analysis is estimated by lavaan: choose the R engine.');
  if (spec.multilevel) throw new Error('Two-level models are estimated by lavaan: choose the R engine.');
  if (spec.esem?.blocks.length) throw new Error('Exploratory SEM (ESEM) is estimated by lavaan: choose the R engine.');
  if (spec.constructs.some((c) => c.reliability !== undefined)) throw new Error('Single indicators with a known reliability are estimated by lavaan: choose the R engine.');
  if (spec.paths.some((p) => p.label) || spec.constructs.some((c) => c.loadingLabels && Object.keys(c.loadingLabels).length) || spec.covariances?.some((k) => k.label) || spec.defined?.length || spec.waldTests?.length) {
    throw new Error('Parameter labels, equality constraints, defined parameters and Wald tests are estimated by lavaan: choose the R engine.');
  }
  const input = prepareCb(data, spec, missing);
  const { dropped, moderations, n } = input;
  if (n < 3) throw new Error('Not enough complete observations to estimate the model.');
  if (!input.cols && estimator === 'MLR') throw new Error('MLR needs raw data; with a covariance matrix use MLM or MLMV (with NACOV), ML, GLS or ULS.');
  const S = covForEstimator(input.SN, n, estimator);
  const cm = bindSample(input.cm, S);
  const kx = cm.covariates.length;
  const df = (cm.p * (cm.p + 1)) / 2 - (kx * (kx + 1)) / 2 - cm.params.length;
  if (df < 0) throw new Error(`The model has more parameters (${cm.params.length}) than covariances; it is not identified.`);
  let core: CbCore;
  try {
    core = fitEstimator(cm, S, estimator);
  } catch (e) {
    // A singular system at this stage means parameters the data cannot separate.
    if (/singular/i.test((e as Error).message)) {
      throw new Error('The model is not identified: some parameters cannot be estimated separately. Typical causes: a correlation between the disturbances of two constructs where one predicts the other, or between the only two components of a higher-order factor; or a factor with too few indicators.', { cause: e });
    }
    throw e;
  }
  const X = core.X;
  const st = standardized(cm, X);
  const { m } = cm;
  const warnings: string[] = [];
  if (!core.converged) warnings.push(`The optimizer did not converge after ${core.iterations} iterations.`);

  const { cov, ts } = inference(cm, S, input.gamma, core, n, estimator);
  if (!cov) warnings.push('Standard errors are unavailable: the information matrix is singular.');

  const name = (i: number) => m.indicatorNames[i];
  const lv = (j: number) => m.constructs[j];
  const se = (a: number) => (cov && cov[a][a] > 0 ? Math.sqrt(cov[a][a]) : null);
  const estimates: CbEstimate[] = [];
  const push = (e: Omit<CbEstimate, 'z' | 'p'>) => {
    const z = e.se ? e.est / e.se : null;
    estimates.push({ ...e, z, p: z === null ? null : normalP(z) });
  };

  const userFixed = cm.fixedCoef ?? [];
  m.blocks.forEach((b, j) => {
    if (b.length && !userFixed.some((f) => f.kind === 'loading' && f.i === b[0] && f.j === j)) push({ kind: 'fixed-loading', lhs: lv(j), op: '=~', rhs: name(b[0]), est: 1, se: null, std: st.stdLoadings[b[0]] });
  });
  for (const f of userFixed) {
    if (f.kind === 'loading') push({ kind: 'fixed-loading', lhs: lv(f.j), op: '=~', rhs: name(f.i), est: f.value, se: null, std: st.stdLoadings[f.i] });
    else if (f.kind === 'regression') push({ kind: 'fixed', lhs: lv(f.i), op: '~', rhs: lv(f.j), est: f.value, se: null, std: st.stdPaths[f.j][f.i] });
  }
  for (const f of cm.fixedThetaCov ?? []) push({ kind: 'fixed', lhs: name(f.i), op: '~~', rhs: name(f.j), est: f.value, se: null, std: f.value / Math.sqrt(X.theta[f.i] * X.theta[f.j]) });
  const stdHo = (child: number, parent: number) => (X.B[child][parent] * st.sdEta[parent]) / st.sdEta[child];
  for (const h of cm.ho) if (h.marker) push({ kind: 'fixed-loading', lhs: lv(h.parent), op: '=~', rhs: lv(h.child), est: 1, se: null, std: stdHo(h.child, h.parent) });
  for (const f of cm.fixedPsi) push({ kind: 'fixed', lhs: lv(f.i), op: '~~', rhs: lv(f.j), est: f.value, se: null, std: f.value / (st.sdEta[f.i] * st.sdEta[f.j]) });
  cm.params.forEach((d, a) => {
    const est = core.theta[a];
    if (d.kind === 'loading') push({ kind: d.kind, lhs: lv(d.j), op: '=~', rhs: name(d.i), est, se: se(a), std: st.stdLoadings[d.i], index: a });
    else if (d.kind === 'regression') push({ kind: d.kind, lhs: lv(d.i), op: '~', rhs: lv(d.j), est, se: se(a), std: st.stdPaths[d.j][d.i], index: a });
    else if (d.kind === 'hoLoading') push({ kind: d.kind, lhs: lv(d.j), op: '=~', rhs: lv(d.i), est, se: se(a), std: stdHo(d.i, d.j), index: a });
    // Covariances standardise by the (residual) variances: disturbance and error correlations, as lavaan's std.all.
    else if (d.kind === 'lvcov') push({ kind: d.kind, lhs: lv(d.i), op: '~~', rhs: lv(d.j), est, se: se(a), std: d.i === d.j ? est / X.C[d.i][d.i] : est / Math.sqrt(X.Psi[d.i][d.i] * X.Psi[d.j][d.j]), index: a });
    else if (d.kind === 'rescov') push({ kind: d.kind, lhs: name(d.i), op: '~~', rhs: name(d.j), est, se: se(a), std: est / Math.sqrt(X.theta[d.i] * X.theta[d.j]), index: a });
    else push({ kind: d.kind, lhs: name(d.i), op: '~~', rhs: name(d.i), est, se: se(a), std: est / X.Sigma[d.i][d.i], index: a });
  });
  // Order like lavaan: loadings, regressions, then variances/covariances.
  const order = { 'fixed-loading': 0, loading: 0, hoLoading: 0, regression: 1, residual: 2, rescov: 2, lvcov: 3, fixed: 3, threshold: 4, defined: 5, mean: 4 } as const;
  // Fixed values sort with their kind of parameter (op).
  const rank = (e: CbEstimate) => (e.kind === 'fixed' ? (e.op === '~' ? 1 : 3) : order[e.kind]);
  estimates.sort((x, y) => rank(x) - rank(y));

  for (const e of estimates) {
    if (e.op === '~~' && e.lhs === e.rhs && e.est < 0) warnings.push(`Negative variance for ${e.lhs} (Heywood case).`);
  }

  const r2Indicators = X.theta.map((t, i) => 1 - t / X.Sigma[i][i]);
  const isChild = new Set(cm.ho.map((h) => h.child));
  const r2Constructs = m.constructs.map((_, j) => (m.preds[j].length || isChild.has(j) ? 1 - X.Psi[j][j] / X.C[j][j] : null));
  const reliability = m.blocks.map((b) => {
    if (b.length === 0) return { cr: NaN, ave: NaN };
    const l = b.map((i) => st.stdLoadings[i]);
    const sum = l.reduce((s, v) => s + v, 0);
    const err = l.reduce((s, v) => s + (1 - v * v), 0);
    return { cr: (sum * sum) / (sum * sum + err), ave: l.reduce((s, v) => s + v * v, 0) / l.length };
  });
  const Sc = S.map((r, i) => r.map((v, j) => v / Math.sqrt(S[i][i] * S[j][j])));
  const residualCor = S.map((r, i) => r.map((v, j) =>
    v / Math.sqrt(S[i][i] * S[j][j]) - X.Sigma[i][j] / Math.sqrt(X.Sigma[i][i] * X.Sigma[j][j])));

  return {
    n, iterations: core.iterations, converged: core.converged,
    constructs: m.constructs,
    indicators: m.indicatorNames.map((nm, i) => ({ name: nm, construct: m.indicatorConstruct[i] })),
    estimator, estimates, fit: fitIndices(cm, S, core, n, estimator, ts),
    r2Indicators, r2Constructs, stdLoadings: st.stdLoadings, stdPaths: st.stdPaths, hasPath: m.hasPath,
    stdTotal: st.total, stdIndirect: st.indirect, lvCor: st.lvCor, reliability, residualCor,
    htmt: htmtOf(m, Sc), htmt2: htmt2Of(m, Sc), vcov: cov, moderations, warnings, droppedRows: dropped,
  };
}

export { buildCbModel, matrices };
export type { CbModel, ParamDef };
