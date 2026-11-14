// The admissibility check of a CB-SEM solution: is the solution a possible one (no negative
// variances, correlations within ±1, positive definite model matrices), independently of whether
// the estimation converged and of lavaan's own post.check. It works from the result every engine
// returns (estimates, standard errors, standardised loadings, the covariance matrix of the
// estimates) and, for lavaan, from the eigenvalues of every model matrix in every group and level
// (R/admissibility.R). Nothing here changes an estimate.
//
// Sources: Chen, Bollen, Paxton, Curran & Kirby (2001) for the causes of improper solutions and
// what to do; Kolenikov & Bollen (2012) for judging a negative variance by its confidence interval;
// Anderson & Gerbing (1984) for small samples and few indicators; Jöreskog (1999) for standardised
// loadings above 1; Wothke (1993) for matrices that are not positive definite.

import type { CbEstimate, CbResult } from './cbsem';
import { symEigen } from './linalg';

/** The model matrices R/admissibility.R reports (the sample matrix is the polychoric one for ordinal data). */
export type AdmissibilityMatrix = 'sample' | 'implied' | 'latent' | 'psi' | 'theta';

/** The eigenvalue range of one model matrix of one block, and the variables most involved in its smallest eigenvalue. */
export interface MatrixSpectrum {
  matrix: AdmissibilityMatrix;
  size: number;
  /** False when the matrix holds a missing or infinite value (then min and max are absent). */
  finite: boolean;
  min?: number;
  max?: number;
  involved: string[];
  /** Variables whose variance (the matrix diagonal) is negative. */
  negativeDiagonal: string[];
}

/** A pair of ordinal indicators whose observed two-way table has empty cells. */
export interface SparsePair {
  a: string;
  b: string;
  cells: number;
  empty: number;
  /** Cells with fewer than 5 cases (empty ones included). */
  sparse: number;
  /** The pair's sample polychoric correlation. */
  r: number;
}

/** What R/admissibility.R adds to a lavaan result. */
export interface AdmissibilityInfo {
  blocks: { label: string | null; matrices: MatrixSpectrum[] }[];
  /** The free parameters in the order of `vcov`, named as the app shows them. */
  vcovNames: string[];
  /** Equality constraints: each makes one eigenvalue of vcov zero by construction. */
  equalityConstraints: number;
  /** Ordinal indicators, per group: pairs with empty cells (at most 50) and how many there are. */
  sparse?: { pairs: SparsePair[]; total: number }[];
}

/**
 * serious: the solution is not admissible; check: a value to look at (it may be sampling error);
 * numerical: rounding-level, usually ignorable.
 */
export type Severity = 'serious' | 'check' | 'numerical';

export type FindingKind =
  | 'nonconvergence'
  | 'negative-variance'
  | 'correlation'
  | 'std-loading'
  | 'matrix'
  | 'vcov'
  | 'sparse';

export interface Finding {
  severity: Severity;
  kind: FindingKind;
  /** The group or level, when the model has several. */
  block: string | null;
  /** The parameters or variables responsible, by the names the user sees. */
  params: string[];
  /** One short sentence: what is wrong. */
  title: string;
  /** The numbers behind it, and what they mean. */
  detail: string;
}

/** A likely cause of the findings, with plain advice and the work it comes from. */
export interface Cause {
  id: CauseId;
  title: string;
  advice: string;
  source: string;
}

export type CauseId =
  | 'nonconvergence'
  | 'overfactoring'
  | 'misspecification'
  | 'sampling'
  | 'few-indicators'
  | 'sparse'
  | 'data'
  | 'identification'
  | 'numerical'
  | 'loading';

export type AdmissibilityStatus = 'admissible' | 'numerical' | 'check' | 'serious';

export interface Admissibility {
  status: AdmissibilityStatus;
  findings: Finding[];
  /** Most likely first. */
  causes: Cause[];
  /** What was checked, for the note under the findings. */
  checked: string[];
}

/** The relative tolerance below which an eigenvalue counts as zero: √ε, as MASS::ginv (Venables & Ripley, 2002). */
export const EIGEN_TOLERANCE = Math.sqrt(Number.EPSILON);

/** The two-sided 95% normal quantile (Wald intervals, lavaan's default ci). */
const Z95 = 1.959963984540054;

const MATRIX_NAMES: Record<AdmissibilityMatrix, string> = {
  sample: 'sample covariance (or polychoric correlation) matrix',
  implied: 'model-implied covariance matrix of the observed variables (Σ̂)',
  latent: 'covariance matrix of the latent variables (ψ, cov.lv)',
  psi: 'covariance matrix of the structural disturbances (ψ)',
  theta: 'residual covariance matrix of the indicators (θ)',
};

const f3 = (x: number) => (Number.isFinite(x) ? x.toFixed(3) : '—');
const sci = (x: number) => (Number.isFinite(x) ? x.toExponential(2) : '—');

// ---------- parsing R's output ----------

const strings = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string') return [v];
  return [];
};
const numOr = (v: unknown, fallback: number) => (typeof v === 'number' ? v : fallback);
type Raw = Record<string, unknown>;
/** An R list of objects as an array; one unboxed object as an array of one. */
const list = (v: unknown): Raw[] => {
  if (Array.isArray(v)) return v.filter((x): x is Raw => !!x && typeof x === 'object');
  if (v && typeof v === 'object' && Object.keys(v).length) return [v as Raw];
  return [];
};
const MATRICES: readonly AdmissibilityMatrix[] = ['sample', 'implied', 'latent', 'psi', 'theta'];

function parseSpectrum(m: Raw): MatrixSpectrum | null {
  const matrix = MATRICES.find((x) => x === m.matrix);
  if (!matrix) return null;
  return {
    matrix,
    size: numOr(m.size, 0),
    finite: m.finite !== false,
    ...(typeof m.min === 'number' ? { min: m.min } : {}),
    ...(typeof m.max === 'number' ? { max: m.max } : {}),
    involved: strings(m.involved),
    negativeDiagonal: strings(m.negativeDiagonal),
  };
}

/** R's admissibility output (ps_cb_admissibility) as AdmissibilityInfo; undefined when absent or malformed. */
export function parseAdmissibility(raw: unknown): AdmissibilityInfo | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Raw;
  const blocks = list(r.blocks).map((b) => ({
    label: typeof b.label === 'string' ? b.label : null,
    matrices: list(b.matrices)
      .map(parseSpectrum)
      .filter((m): m is MatrixSpectrum => m !== null),
  }));
  const sparse = list(r.sparse).map((g) => ({
    pairs: list(g.pairs).map((p) => ({
      a: String(p.a),
      b: String(p.b),
      cells: numOr(p.cells, 0),
      empty: numOr(p.empty, 0),
      sparse: numOr(p.sparse, 0),
      r: numOr(p.r, NaN),
    })),
    total: numOr(g.total, 0),
  }));
  return {
    blocks,
    vcovNames: strings(r.vcovNames),
    equalityConstraints: numOr(r.equalityConstraints, 0),
    ...(sparse.length ? { sparse } : {}),
  };
}

// ---------- the checks ----------

/** One group's (or level's) result, with its label when the model has several. */
interface Part {
  r: CbResult;
  label: string | null;
}

function parts(cb: CbResult): Part[] {
  if (!cb.groups) return [{ r: cb, label: null }];
  return cb.groups.results.map((r, i) => ({ r, label: cb.groups!.labels[i] ?? null }));
}

/** The Wald 95% interval of an estimate (lavaan's default ci). */
export function waldInterval(est: number, se: number): [number, number] {
  return [est - Z95 * se, est + Z95 * se];
}

const isVariance = (e: CbEstimate) => e.op === '~~' && e.lhs === e.rhs;

/** Negative variances, each graded by its Wald 95% interval (Kolenikov & Bollen, 2012). */
function negativeVariances({ r, label }: Part): Finding[] {
  const out: Finding[] = [];
  for (const e of r.estimates) {
    if (!isVariance(e) || !(e.est < 0)) continue;
    const latent = r.constructs.includes(e.lhs);
    const what = latent ? 'latent (or disturbance) variance' : 'residual variance';
    if (e.se === null || !Number.isFinite(e.se)) {
      out.push({
        severity: 'serious',
        kind: 'negative-variance',
        block: label,
        params: [e.lhs],
        title: `Negative ${what} of ${e.lhs}`,
        detail: `Estimate ${f3(e.est)}; no standard error, so it cannot be judged against sampling error.`,
      });
      continue;
    }
    const [low, high] = waldInterval(e.est, e.se);
    const ci = `95% CI [${f3(low)}, ${f3(high)}]`;
    const excludesZero = high < 0;
    out.push({
      severity: excludesZero ? 'serious' : 'check',
      kind: 'negative-variance',
      block: label,
      params: [e.lhs],
      title: `Negative ${what} of ${e.lhs}`,
      detail: excludesZero
        ? `Estimate ${f3(e.est)} (SE ${f3(e.se)}, ${ci}): the interval lies below zero, so this is more than sampling error. It points to a misspecified model (Kolenikov & Bollen, 2012).`
        : `Estimate ${f3(e.est)} (SE ${f3(e.se)}, ${ci}): the interval includes zero, so the true variance may be small but positive and this can be sampling error (Kolenikov & Bollen, 2012).`,
    });
  }
  return out;
}

/** Correlations implied by the parameters (covariance over the root of its two variances) and the implied latent correlations, beyond ±1. */
function correlations({ r, label }: Part): Finding[] {
  const out: Finding[] = [];
  const variance = new Map<string, number>();
  for (const e of r.estimates) if (isVariance(e)) variance.set(e.lhs, e.est);
  const endogenous = new Set(
    r.constructs.filter(
      (_, j) => r.r2Constructs?.[j] !== null && r.r2Constructs?.[j] !== undefined,
    ),
  );
  const flagged = new Set<string>();
  const pairKey = (a: string, b: string) => [a, b].sort().join('\u0000');
  for (const e of r.estimates) {
    if (e.op !== '~~' || e.lhs === e.rhs) continue;
    const va = variance.get(e.lhs);
    const vb = variance.get(e.rhs);
    if (va === undefined || vb === undefined || !(va > 0) || !(vb > 0)) continue;
    const corr = e.est / Math.sqrt(va * vb);
    if (!(Math.abs(corr) > 1)) continue;
    const bothLatent = r.constructs.includes(e.lhs) && r.constructs.includes(e.rhs);
    const residual = !bothLatent || endogenous.has(e.lhs) || endogenous.has(e.rhs);
    flagged.add(pairKey(e.lhs, e.rhs));
    out.push({
      severity: 'serious',
      kind: 'correlation',
      block: label,
      params: [e.lhs, e.rhs],
      title: residual
        ? `Residual correlation of ${e.lhs} and ${e.rhs} beyond ±1`
        : `Latent correlation of ${e.lhs} and ${e.rhs} beyond ±1`,
      detail: `r = ${f3(corr)} (covariance ${f3(e.est)} over the root of the variances ${f3(va)} and ${f3(vb)}). A correlation cannot exceed 1 in size.`,
    });
  }
  // The implied correlations among the latent variables (endogenous ones included).
  const k = r.constructs.length;
  for (let i = 0; i < k; i++) {
    for (let j = i + 1; j < k; j++) {
      const v = r.lvCor?.[i]?.[j];
      if (v === undefined || !Number.isFinite(v) || !(Math.abs(v) > 1)) continue;
      const a = r.constructs[i];
      const b = r.constructs[j];
      if (flagged.has(pairKey(a, b))) continue;
      out.push({
        severity: 'serious',
        kind: 'correlation',
        block: label,
        params: [a, b],
        title: `Implied correlation of ${a} and ${b} beyond ±1`,
        detail: `r = ${f3(v)} in the model-implied correlations of the latent variables. A correlation cannot exceed 1 in size.`,
      });
    }
  }
  return out;
}

/** Standardised loadings above 1 in size: improper together with a negative residual variance, otherwise possible (Jöreskog, 1999). */
function stdLoadings({ r, label }: Part, varianceFindings: Finding[]): Finding[] {
  // (with a negative residual variance the loading is its consequence: it takes that variance's severity)
  const negative = new Map<string, Severity>();
  for (const f of varianceFindings) {
    if (f.block === label) negative.set(f.params[0], f.severity);
  }
  return r.estimates
    .filter((e) => e.op === '=~' && Number.isFinite(e.std) && Math.abs(e.std) > 1)
    .map((e) => {
      const heywood = negative.get(e.rhs);
      return {
        severity: heywood ?? 'check',
        kind: 'std-loading',
        block: label,
        params: [`${e.lhs} → ${e.rhs}`],
        title: `Standardised loading of ${e.rhs} on ${e.lhs} beyond ±1`,
        detail: heywood
          ? `Standardised loading ${f3(e.std)}, the consequence of the negative residual variance of ${e.rhs} (a Heywood case).`
          : `Standardised loading ${f3(e.std)}. With correlated factors or cross-loadings a standardised loading can exceed 1 without anything being wrong (Jöreskog, 1999); check that ${e.rhs}'s residual variance is positive.`,
      } satisfies Finding;
    });
}

/** How one matrix's eigenvalues grade: negative beyond rounding, (numerically) zero, or fine. */
function grade(m: MatrixSpectrum): 'negative' | 'zero' | 'fine' | 'unknown' {
  if (!m.finite || m.min === undefined || m.max === undefined) return 'unknown';
  const scale = Math.max(Math.abs(m.max), Math.abs(m.min));
  if (scale === 0) return 'zero';
  if (m.min < -EIGEN_TOLERANCE * scale) return 'negative';
  if (Math.abs(m.min) <= EIGEN_TOLERANCE * scale) return 'zero';
  return 'fine';
}

/** The model matrices of each block (lavaan): not positive definite, and which variables are involved. */
function matrices(info: AdmissibilityInfo, labels: (string | null)[]): Finding[] {
  const groups = labels.length > 1;
  const out: Finding[] = [];
  info.blocks.forEach((b, i) => {
    const label = groups ? (labels[i] ?? b.label) : null;
    const latentBad = b.matrices.some((m) => m.matrix === 'latent' && grade(m) === 'negative');
    for (const m of b.matrices) {
      const g = grade(m);
      const name = MATRIX_NAMES[m.matrix];
      if (g === 'unknown') {
        out.push({
          severity: 'serious',
          kind: 'matrix',
          block: label,
          params: [],
          title: `The ${name} holds missing or infinite values`,
          detail: 'Its eigenvalues cannot be computed; the solution is not usable as it stands.',
        });
        continue;
      }
      if (g === 'fine') continue;
      // (zero eigenvalues of θ, ψ and cov.lv come from variances fixed at 0 by design, e.g. single indicators)
      if (g === 'zero' && (m.matrix === 'theta' || m.matrix === 'latent' || m.matrix === 'psi')) {
        continue;
      }
      // (ψ repeats cov.lv's problem in a measurement model: reported once)
      if (m.matrix === 'psi' && latentBad) continue;
      // (a negative diagonal alone is the negative variance reported above)
      const others = m.involved.filter((x) => !m.negativeDiagonal.includes(x));
      if (g === 'negative' && m.negativeDiagonal.length && !others.length) continue;
      const eig = `smallest eigenvalue ${sci(m.min!)}, largest ${sci(m.max!)}`;
      const who = m.involved.length ? ` Most involved: ${m.involved.join(', ')}.` : '';
      out.push({
        severity: g === 'negative' || m.matrix === 'sample' ? 'serious' : 'check',
        kind: 'matrix',
        block: label,
        params: m.involved,
        title:
          g === 'negative'
            ? `The ${name} is not positive definite`
            : `The ${name} is singular (an eigenvalue of zero)`,
        detail: `${eig}.${who}`,
      });
    }
  });
  return out;
}

/** The free parameters' names in vcov order: R's, or else from the estimates' indices. */
function vcovNames(cb: CbResult, info: AdmissibilityInfo | undefined, size: number): string[] {
  if (info?.vcovNames.length === size) {
    // (R labels groups by their codes; the result may show category names instead)
    const shown = parts(cb).map((p) => p.label);
    return info.vcovNames.map((n) => {
      let out = n;
      info.blocks.forEach((b, i) => {
        const now = shown[i];
        if (b.label && now && b.label !== now && out.endsWith(`(${b.label})`)) {
          out = `${out.slice(0, -b.label.length - 2)}(${now})`;
        }
      });
      return out;
    });
  }
  const names = new Array<string>(size).fill('');
  for (const { r, label } of parts(cb)) {
    for (const e of r.estimates) {
      if (e.index === undefined || e.index < 0 || e.index >= size || names[e.index]) continue;
      const suffix = label ? ` (${label})` : '';
      names[e.index] = `${e.lhs} ${e.op} ${e.rhs}${suffix}`;
    }
  }
  return names.map((n, i) => n || `parameter ${i + 1}`);
}

/**
 * The covariance matrix of the estimates: its smallest eigenvalue, one dropped per equality constraint
 * (each makes an eigenvalue zero by construction, as lavaan's own check does), against √ε times the largest.
 */
export interface VcovSpectrum {
  /** The smallest eigenvalue once the constraint ones are dropped, and the largest. */
  min: number;
  max: number;
  /** The eigenvalues dropped (one per equality constraint), smallest first. */
  dropped: number[];
  /** The eigenvector of `min`. */
  vector: number[];
}

/** The eigenvalues of the covariance matrix of the estimates, one dropped per equality constraint (as lavaan's own check). */
export function vcovSpectrum(cb: CbResult): VcovSpectrum | null {
  const v = cb.vcov;
  if (!v || v.length < 2 || v.some((row) => row.some((x) => !Number.isFinite(x)))) return null;
  // (scaled to a unit diagonal maximum first: the Jacobi sweeps stop at an absolute threshold)
  const s = Math.max(...v.map((row, i) => Math.abs(row[i])));
  if (!(s > 0)) return null;
  const eig = symEigen(v.map((row) => row.map((x) => x / s)));
  const values = eig.values.map((x) => x * s);
  const order = values.map((_, i) => i).sort((a, b) => values[a] - values[b]);
  const drop = Math.min(cb.admissibility?.equalityConstraints ?? 0, order.length - 1);
  const iMin = order[drop];
  return {
    min: values[iMin],
    max: values[order[order.length - 1]],
    dropped: order.slice(0, drop).map((i) => values[i]),
    vector: eig.vectors.map((row) => row[iMin]),
  };
}

function vcovFinding(cb: CbResult, info: AdmissibilityInfo | undefined): Finding | null {
  const sp = vcovSpectrum(cb);
  if (!sp) return null;
  const v = cb.vcov!;
  const lmin = sp.min;
  const lmax = sp.max;
  const drop = sp.dropped.length;
  const scale = Math.max(Math.abs(lmax), Math.abs(lmin));
  if (scale === 0) return null;
  const negative = lmin < -EIGEN_TOLERANCE * scale;
  const zero = Math.abs(lmin) <= EIGEN_TOLERANCE * scale;
  if (!negative && !zero) return null;
  const names = vcovNames(cb, info, v.length);
  const loads = sp.vector.map(Math.abs);
  const top = Math.max(...loads);
  const involved = loads
    .map((x, i) => ({ x, i }))
    .filter((t) => t.x >= 0.5 * top)
    .sort((a, b) => b.x - a.x)
    .slice(0, 4)
    .map((t) => names[t.i]);
  const eig = `smallest eigenvalue ${sci(lmin)}, largest ${sci(lmax)}`;
  const constraints = drop ? ` (${drop} more, zero by the equality constraints, left out)` : '';
  if (negative) {
    return {
      severity: 'serious',
      kind: 'vcov',
      block: null,
      params: involved,
      title: 'The covariance matrix of the estimates (vcov) is not positive definite',
      detail: `${eig}${constraints}. A negative eigenvalue beyond rounding error suggests the model is empirically not identified; the standard errors of the parameters most involved are not trustworthy.`,
    };
  }
  return {
    severity: 'numerical',
    kind: 'vcov',
    block: null,
    params: involved,
    title: 'The covariance matrix of the estimates (vcov) has an eigenvalue of about zero',
    detail: `${eig}${constraints}. That is at the level of rounding error (below √ε relative to the largest; Venables & Ripley, 2002) and is usually ignorable when nothing else is flagged and the standard errors look reasonable.`,
  };
}

/** Ordinal indicators: pairs whose two-way table has empty cells. */
function sparseFindings(info: AdmissibilityInfo, labels: (string | null)[]): Finding[] {
  return (info.sparse ?? []).flatMap((g, i) => {
    if (!g.total) return [];
    const shown = g.pairs
      .slice(0, 6)
      .map((p) => `${p.a} × ${p.b} (${p.empty} of ${p.cells} empty, r = ${f3(p.r)})`);
    const more = g.total > shown.length ? `, and ${g.total - shown.length} more` : '';
    const atBound = g.pairs.filter((p) => Math.abs(p.r) > 0.999).map((p) => `${p.a} × ${p.b}`);
    const bound = atBound.length ? ` Polychoric correlation at ±1: ${atBound.join(', ')}.` : '';
    return [
      {
        severity: 'check',
        kind: 'sparse',
        block: labels[i] ?? null,
        params: g.pairs.slice(0, 6).flatMap((p) => [p.a, p.b]),
        title: `${g.total} pair${g.total === 1 ? '' : 's'} of ordinal indicators with empty cells in their two-way table`,
        detail: `${shown.join('; ')}${more}.${bound} Empty cells make the polychoric correlations unstable and can push them to ±1.`,
      } satisfies Finding,
    ];
  });
}

const RANK: Record<Severity, number> = { serious: 0, check: 1, numerical: 2 };

const CAUSES: Record<CauseId, Omit<Cause, 'id'>> = {
  nonconvergence: {
    title: 'The estimation did not converge',
    advice:
      'The estimates are not a solution and should not be interpreted. Check the model for errors first (a misplaced arrow, a factor without a scale), then simplify it or give better starting values.',
    source: 'Chen et al. (2001)',
  },
  overfactoring: {
    title: 'Two factors that are really one (too many factors)',
    advice:
      'A latent correlation at or beyond ±1, or a latent covariance matrix that is not positive definite, usually means two factors measure the same thing. Fit the model with those factors merged and compare the two, or go back to an exploratory factor analysis with one factor fewer.',
    source: 'Chen et al. (2001); Wothke (1993)',
  },
  misspecification: {
    title: 'A misspecified model',
    advice:
      'A negative variance whose interval excludes zero, or a residual correlation beyond ±1, points to a structural problem: a missing cross-loading or error correlation, an indicator on the wrong factor, or the wrong number of factors. Look at the residuals and modification indices, and change the model only where theory supports it.',
    source: 'Kolenikov & Bollen (2012); Chen et al. (2001)',
  },
  sampling: {
    title: 'Sampling error in a small sample',
    advice:
      'A small negative variance whose interval includes zero can arise by chance even when the model is right. Report it. Fixing that variance at zero (or bounding it at zero) is defensible only when it is small and not significant; say that you did so.',
    source: 'Kolenikov & Bollen (2012); Anderson & Gerbing (1984)',
  },
  'few-indicators': {
    title: 'Too few indicators per factor',
    advice:
      'Factors with only two indicators are identified only through their relations with other factors, and improper solutions are much more common with two (or three) indicators, more so in small samples. Add indicators where you can.',
    source: 'Anderson & Gerbing (1984); Bollen (1989)',
  },
  sparse: {
    title: 'Sparse categories of ordinal indicators',
    advice:
      'Empty cells in the two-way tables make the polychoric correlations, and so the whole solution, unstable. Collapse rarely used neighbouring categories, or collect more cases.',
    source: 'Chen et al. (2001)',
  },
  data: {
    title: 'A problem in the data',
    advice:
      'A sample matrix that is not positive definite comes from the data, not the model: a variable that is a sum or copy of others, more variables than cases, pairwise deletion, or polychoric correlations estimated pair by pair. Check the data before the model.',
    source: 'Wothke (1993)',
  },
  identification: {
    title: 'An empirically unidentified model',
    advice:
      'When vcov is not positive definite the data cannot pin down some parameters, even if the model is identified in principle (for example a path or correlation close to zero that another parameter needs). Look at the parameters named, and add constraints or indicators.',
    source: 'Chen et al. (2001)',
  },
  numerical: {
    title: 'Rounding error only',
    advice:
      'An eigenvalue of about zero relative to the largest is numerical noise. When nothing else is flagged it can be ignored.',
    source: 'Venables & Ripley (2002)',
  },
  loading: {
    title: 'A standardised loading above 1',
    advice:
      'With correlated factors or cross-loadings a standardised loading can exceed 1 legitimately. It is a problem only together with a negative residual variance.',
    source: 'Jöreskog (1999)',
  },
};

/** The likely causes, most likely first, from the findings and the model. */
function rankCauses(cb: CbResult, findings: Finding[]): Cause[] {
  const ids: CauseId[] = [];
  const add = (id: CauseId) => {
    if (!ids.includes(id)) ids.push(id);
  };
  const has = (pred: (f: Finding) => boolean) => findings.some(pred);
  const latentCorr = has(
    (f) => f.kind === 'correlation' && !f.title.startsWith('Residual') && f.severity === 'serious',
  );
  const latentMatrix = has((f) => f.kind === 'matrix' && /latent|disturbances/.test(f.title));
  const seriousNegative = has((f) => f.kind === 'negative-variance' && f.severity === 'serious');
  const smallNegative = has((f) => f.kind === 'negative-variance' && f.severity === 'check');
  const residualCorr = has((f) => f.kind === 'correlation' && f.title.startsWith('Residual'));
  const twoIndicators = parts(cb).some(({ r }) =>
    r.constructs.some((_, j) => {
      const n = (r.indicators ?? []).filter((i) => i.construct === j).length;
      return n === 2;
    }),
  );
  if (has((f) => f.kind === 'nonconvergence')) add('nonconvergence');
  if (has((f) => f.kind === 'matrix' && f.title.includes('sample'))) add('data');
  if (latentCorr || latentMatrix) add('overfactoring');
  if (seriousNegative || residualCorr) add('misspecification');
  if (smallNegative) add('sampling');
  if ((seriousNegative || smallNegative || latentCorr) && twoIndicators) add('few-indicators');
  if (has((f) => f.kind === 'sparse')) add('sparse');
  if (has((f) => f.kind === 'vcov' && f.severity === 'serious')) add('identification');
  // (a loading above 1 without a negative residual variance of its indicator)
  const negativeNames = new Set(
    findings.filter((f) => f.kind === 'negative-variance').map((f) => f.params[0]),
  );
  const loadingAlone = has(
    (f) => f.kind === 'std-loading' && !negativeNames.has(f.params[0].split(' → ')[1]),
  );
  if (loadingAlone) add('loading');
  if (smallNegative && !seriousNegative) {
    // (only non-significant negative variances: sampling error is the first suspect)
    ids.splice(ids.indexOf('sampling'), 1);
    ids.unshift('sampling');
  }
  if (has((f) => f.kind === 'vcov' && f.severity === 'numerical')) add('numerical');
  return ids.map((id) => ({ id, ...CAUSES[id] }));
}

/** The admissibility of a CB-SEM result: every group and level, every engine (the matrices: lavaan only). */
export function checkAdmissibility(cb: CbResult): Admissibility {
  const info = cb.admissibility;
  const ps = parts(cb);
  const groups = ps.length > 1;
  const findings: Finding[] = [];
  // (false only: a partial result without the field is not taken as non-converged)
  if (cb.converged === false) {
    findings.push({
      severity: 'serious',
      kind: 'nonconvergence',
      block: null,
      params: [],
      title: 'The estimation did not converge',
      detail: `Stopped after ${cb.iterations} iterations without reaching a solution.`,
    });
  }
  for (const p of ps) {
    const variances = negativeVariances(p);
    findings.push(...variances, ...correlations(p), ...stdLoadings(p, variances));
  }
  if (info) {
    findings.push(
      ...matrices(
        info,
        ps.map((p) => p.label),
      ),
    );
    findings.push(
      ...sparseFindings(
        info,
        ps.map((p) => p.label),
      ),
    );
  }
  const vc = vcovFinding(cb, info);
  if (vc) findings.push(vc);
  findings.sort((a, b) => RANK[a.severity] - RANK[b.severity]);
  let status: AdmissibilityStatus = 'admissible';
  if (findings.length) {
    const worst = findings[0].severity;
    status = worst;
  }
  const checked = [
    'convergence',
    'negative variances (with their 95% intervals)',
    'latent and residual correlations within ±1',
    'standardised loadings within ±1',
    ...(cb.vcov ? ['the covariance matrix of the estimates (eigenvalues)'] : []),
    ...(info
      ? [
          'the eigenvalues of the sample, model-implied, latent, disturbance and residual covariance matrices' +
            (groups ? ' in every group and level' : ''),
        ]
      : []),
    ...(info?.sparse ? ['empty cells in the two-way tables of the ordinal indicators'] : []),
  ];
  return { status, findings, causes: rankCauses(cb, findings), checked };
}

/** The one-line verdict shown on the badge. */
export const STATUS_LABEL: Record<AdmissibilityStatus, string> = {
  admissible: 'Admissible',
  numerical: 'Admissible (numerical notes only)',
  check: 'Check the flagged values',
  serious: 'Not admissible',
};
