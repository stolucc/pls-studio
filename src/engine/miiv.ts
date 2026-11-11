// Model-implied instrumental variables, two-stage least squares (MIIV-2SLS;
// Bollen 1996). Every latent variable is replaced by its scaling (marker)
// indicator, turning each measurement and structural equation into a
// regression among observed variables with a composite error u. Observed
// variables whose model-implied covariance with u is zero are the equation's
// instruments; each equation is estimated separately by 2SLS, so a
// misspecified equation does not bias the others. Sargan's test checks each
// overidentified equation. Validated against MIIVsem.
//
// Instrument selection: every observed variable and every composite error is
// expanded into independent sources (exogenous factors ξ, disturbances ζ,
// measurement errors ε); a variable is a valid instrument when it shares no
// source with u (u never contains ξ, and ζ/ε are mutually uncorrelated).

import {
  bindSample,
  covForEstimator,
  fitEstimator,
  prepareCb,
  standardized,
  type CbModel,
} from './cbsem';
import { invert, type Mat } from './linalg';
import { chisqCdf, normalP } from './stats';
import type { Dataset, MissingTreatment, ModelSpec } from './types';

/** std: standardised value (R engine: lavaan's std.all for the 2SLS estimates); absent for the built-in engine. */
export interface MiivCoefficient {
  lhs: string;
  op: '=~' | '~';
  rhs: string;
  est: number;
  se: number;
  z: number;
  p: number;
  std?: number;
}

export interface MiivEquation {
  kind: 'measurement' | 'higher-order' | 'structural';
  /** Dependent observed variable and observed regressors (scaling indicators). */
  dv: string;
  regressors: string[];
  instruments: string[];
  coefficients: MiivCoefficient[];
  /** Residual variance of the composite error (divisor N). */
  sigma2: number;
  /** Sargan overidentification test; null when exactly identified. */
  sargan: number | null;
  sarganDf: number;
  sarganP: number | null;
}

export interface MiivResult {
  n: number;
  equations: MiivEquation[];
  estimates: MiivCoefficient[];
  /** R² by variable (indicators and constructs); R engine only. */
  r2?: Record<string, number>;
  /** Standardised marker loadings (fixed to 1 unstandardised), by indicator or component; R engine only. */
  fixedStd?: Record<string, number>;
  /** (Co)variances from MIIVsem's var.cov step (no standard errors); latent: between constructs. R engine only. */
  variances?: { lhs: string; rhs: string; latent: boolean; est: number; std: number }[];
}

export function estimateMiiv(
  data: Dataset,
  spec: ModelSpec,
  missing: MissingTreatment = 'casewise',
): MiivResult {
  if (spec.moderations?.length)
    throw new Error('MIIV-2SLS does not support latent interactions here.');
  const { cm, SN: S, n } = prepareCb(data, spec, missing);
  const { m, ho } = cm;
  const K = m.constructs.length;
  const isCov = new Set(cm.covariates);
  const parentOf = new Map(ho.map((h) => [h.child, h.parent]));
  const childrenOf = (j: number) => ho.filter((h) => h.parent === j);
  const endogenous = (j: number) => m.preds[j].length > 0 || parentOf.has(j);

  // Indicators with a measurement error: multi-indicator blocks (single indicators and covariates are error-free).
  const hasError = (i: number) =>
    !isCov.has(m.indicatorConstruct[i]) && m.blocks[m.indicatorConstruct[i]].length > 1;
  // Scaling indicator of a construct (a higher-order construct is scaled through its marker component).
  const scaleObs = (j: number): number =>
    m.blocks[j].length ? m.blocks[j][0] : scaleObs(childrenOf(j).find((h) => h.marker)!.child);
  // Sources hidden in the scaling indicator besides the construct itself: η_j = y_mk − R(j).
  const scaleResidual = (j: number): string[] => {
    if (m.blocks[j].length) return hasError(m.blocks[j][0]) ? [`e${m.blocks[j][0]}`] : [];
    const c0 = childrenOf(j).find((h) => h.marker)!.child;
    return [`z${c0}`, ...scaleResidual(c0)];
  };

  // Latent sources via the reduced form: η_j depends on the source of every construct reaching j.
  const out = Array.from({ length: K }, () => [] as number[]);
  for (let t = 0; t < K; t++) for (const f of m.preds[t]) out[f].push(t);
  for (const h of ho) out[h.parent].push(h.child);
  const latentSources = Array.from({ length: K }, () => new Set<string>());
  for (let k = 0; k < K; k++) {
    const src = endogenous(k) ? `z${k}` : `x${k}`;
    const stack = [k],
      seen = new Set<number>();
    while (stack.length) {
      const j = stack.pop()!;
      if (seen.has(j)) continue;
      seen.add(j);
      latentSources[j].add(src);
      stack.push(...out[j]);
    }
  }
  const obsSources = m.indicatorNames.map((_, i) => {
    const s = new Set(latentSources[m.indicatorConstruct[i]]);
    if (hasError(i)) s.add(`e${i}`);
    return s;
  });

  interface Spec {
    kind: MiivEquation['kind'];
    dv: number;
    regs: { obs: number; label: Omit<MiivCoefficient, 'est' | 'se' | 'z' | 'p'> }[];
    error: string[];
  }
  const specs: Spec[] = [];
  // Measurement: y_i = λ y_mk + (ε_i − λ ε_mk)
  m.blocks.forEach((b, j) => {
    if (isCov.has(j)) return;
    for (const i of b.slice(1)) {
      specs.push({
        kind: 'measurement',
        dv: i,
        regs: [{ obs: b[0], label: { lhs: m.constructs[j], op: '=~', rhs: m.indicatorNames[i] } }],
        error: [`e${i}`, ...scaleResidual(j)],
      });
    }
  });
  // Higher-order: η_c = λ η_H + ζ_c for non-marker components c.
  for (const h of ho) {
    if (h.marker) continue;
    specs.push({
      kind: 'higher-order',
      dv: scaleObs(h.child),
      regs: [
        {
          obs: scaleObs(h.parent),
          label: { lhs: m.constructs[h.parent], op: '=~', rhs: m.constructs[h.child] },
        },
      ],
      error: [`z${h.child}`, ...scaleResidual(h.child), ...scaleResidual(h.parent)],
    });
  }
  // Structural: η_t = Σ β η_f + ζ_t
  for (let t = 0; t < K; t++) {
    if (!m.preds[t].length) continue;
    specs.push({
      kind: 'structural',
      dv: scaleObs(t),
      regs: m.preds[t].map((f) => ({
        obs: scaleObs(f),
        label: { lhs: m.constructs[t], op: '~' as const, rhs: m.constructs[f] },
      })),
      error: [`z${t}`, ...scaleResidual(t), ...m.preds[t].flatMap((f) => scaleResidual(f))],
    });
  }

  // Correlated errors / disturbances: a source correlated with one in the equation error disqualifies instruments too.
  const partners = new Map<string, string[]>();
  const link = (x: string, y: string) => {
    partners.set(x, [...(partners.get(x) ?? []), y]);
    partners.set(y, [...(partners.get(y) ?? []), x]);
  };
  for (const d of cm.params) {
    if (d.kind === 'rescov') link(`e${d.i}`, `e${d.j}`);
    else if (d.kind === 'lvcov' && d.i !== d.j && endogenous(d.i) && endogenous(d.j))
      link(`z${d.i}`, `z${d.j}`);
  }

  const equations = specs.map((sp): MiivEquation => {
    const err = new Set(sp.error.flatMap((x) => [x, ...(partners.get(x) ?? [])]));
    const Z = m.indicatorNames
      .map((_, v) => v)
      .filter((v) => ![...obsSources[v]].some((x) => err.has(x)));
    const X = sp.regs.map((r) => r.obs);
    const y = sp.dv;
    const name = m.indicatorNames;
    if (Z.length < X.length) {
      throw new Error(
        `Equation for ${name[y]} is not identified by MIIV-2SLS: ${Z.length} instrument(s) for ${X.length} regressor(s).`,
      );
    }
    const Szz = Z.map((a) => Z.map((b) => S[a][b]));
    let SzzInv: Mat;
    try {
      SzzInv = invert(Szz);
    } catch {
      throw new Error(`Instruments for ${name[y]} are collinear.`);
    }
    const Sxz = X.map((a) => Z.map((b) => S[a][b]));
    const szy = Z.map((a) => S[a][y]);
    // A = Sxz Szz⁻¹ ; M = A Szx ; β = M⁻¹ A szy
    const A = Sxz.map((row) => Z.map((_, c) => row.reduce((s, v, k) => s + v * SzzInv[k][c], 0)));
    const M = A.map((row) => X.map((_, c) => row.reduce((s, v, k) => s + v * Sxz[c][k], 0)));
    const Minv = invert(M);
    const Ay = A.map((row) => row.reduce((s, v, k) => s + v * szy[k], 0));
    const beta = Minv.map((row) => row.reduce((s, v, k) => s + v * Ay[k], 0));
    // σ² = Var(y − Xβ) with divisor N.
    let s2 = S[y][y];
    X.forEach((a, i) => {
      s2 -= 2 * beta[i] * S[a][y];
      X.forEach((b, j) => (s2 += beta[i] * beta[j] * S[a][b]));
    });
    const coefficients = sp.regs.map((r, i) => {
      const se = Math.sqrt((s2 * Minv[i][i]) / n);
      const z = beta[i] / se;
      return { ...r.label, est: beta[i], se, z, p: normalP(z) };
    });
    const df = Z.length - X.length;
    let sargan: number | null = null,
      sarganP: number | null = null;
    if (df > 0) {
      // N·R² of the residuals regressed on the instruments.
      const suz = Z.map((a, k) => szy[k] - X.reduce((s, b, i) => s + beta[i] * S[a][b], 0));
      const explained = suz.reduce(
        (s, v, k) => s + v * suz.reduce((t, w, l) => t + SzzInv[k][l] * w, 0),
        0,
      );
      sargan = (n * explained) / s2;
      sarganP = 1 - chisqCdf(sargan, df);
    }
    return {
      kind: sp.kind,
      dv: name[y],
      regressors: X.map((a) => name[a]),
      instruments: Z.map((a) => name[a]),
      coefficients,
      sigma2: s2,
      sargan,
      sarganDf: df,
      sarganP,
    };
  });
  const estimates = equations.flatMap((e) => e.coefficients);
  const result: MiivResult = { n, equations, estimates };
  try {
    Object.assign(result, varianceStep(cm, S, n, estimates));
  } catch {
    // The variance step is optional: the 2SLS estimates stand without it.
  }
  return result;
}

/**
 * Variances and covariances with every 2SLS coefficient held fixed, by ML (as
 * MIIVsem's var.cov = TRUE, which fits them with lavaan); then standardised
 * coefficients, marker loadings and R².
 */
function varianceStep(
  cm0: CbModel,
  SN: Mat,
  n: number,
  coefs: MiivCoefficient[],
): Partial<MiivResult> {
  const { m } = cm0;
  const ci = (name: string) => m.constructs.indexOf(name);
  const ii = (name: string) => m.indicatorNames.indexOf(name);
  const value = (d: CbModel['params'][number]): number | undefined => {
    const find = (lhs: string, op: '=~' | '~', rhs: string) =>
      coefs.find((c) => c.lhs === lhs && c.op === op && c.rhs === rhs)?.est;
    if (d.kind === 'loading') return find(m.constructs[d.j], '=~', m.indicatorNames[d.i]);
    if (d.kind === 'hoLoading') return find(m.constructs[d.j], '=~', m.constructs[d.i]);
    if (d.kind === 'regression') return find(m.constructs[d.i], '~', m.constructs[d.j]);
    return undefined;
  };
  const coefDefs = cm0.params.filter(
    (d) => d.kind === 'loading' || d.kind === 'hoLoading' || d.kind === 'regression',
  );
  const fixedCoef = coefDefs.map((d) => {
    const v = value(d);
    if (v === undefined) throw new Error('coefficient missing');
    return { ...d, value: v };
  });
  const S = covForEstimator(SN, n, 'ML');
  const cm = bindSample(
    { ...cm0, params: cm0.params.filter((d) => !coefDefs.includes(d)), fixedCoef },
    S,
  );
  const core = fitEstimator(cm, S, 'ML');
  if (!core.converged) throw new Error('variance step did not converge');
  const X = core.X;
  const st = standardized(cm, X);
  const stdHo = (child: number, parent: number) =>
    (X.B[child][parent] * st.sdEta[parent]) / st.sdEta[child];
  const withStd = coefs.map((c) => {
    if (c.op === '~') return { ...c, std: st.stdPaths[ci(c.rhs)][ci(c.lhs)] };
    const ind = ii(c.rhs);
    return { ...c, std: ind >= 0 ? st.stdLoadings[ind] : stdHo(ci(c.rhs), ci(c.lhs)) };
  });
  coefs.splice(0, coefs.length, ...withStd);
  const fixedStd: Record<string, number> = {};
  m.blocks.forEach((b) => {
    if (b.length > 1) fixedStd[m.indicatorNames[b[0]]] = st.stdLoadings[b[0]];
  });
  for (const h of cm.ho) if (h.marker) fixedStd[m.constructs[h.child]] = stdHo(h.child, h.parent);
  const variances: NonNullable<MiivResult['variances']> = [];
  // Observed covariates: (co)variances fixed at their sample values (fixed.x), reported as lavaan does.
  for (const f of cm.fixedPsi)
    variances.push({
      lhs: m.constructs[f.i],
      rhs: m.constructs[f.j],
      latent: true,
      est: f.value,
      std: f.value / Math.sqrt(X.Psi[f.i][f.i] * X.Psi[f.j][f.j]),
    });
  cm.params.forEach((d, a) => {
    const est = core.theta[a];
    if (d.kind === 'lvcov')
      variances.push({
        lhs: m.constructs[d.i],
        rhs: m.constructs[d.j],
        latent: true,
        est,
        std: d.i === d.j ? est / X.C[d.i][d.i] : est / Math.sqrt(X.Psi[d.i][d.i] * X.Psi[d.j][d.j]),
      });
    else if (d.kind === 'residual')
      variances.push({
        lhs: m.indicatorNames[d.i],
        rhs: m.indicatorNames[d.i],
        latent: false,
        est,
        std: est / X.Sigma[d.i][d.i],
      });
    else if (d.kind === 'rescov')
      variances.push({
        lhs: m.indicatorNames[d.i],
        rhs: m.indicatorNames[d.j],
        latent: false,
        est,
        std: est / Math.sqrt(X.theta[d.i] * X.theta[d.j]),
      });
  });
  const r2: Record<string, number> = {};
  m.indicatorNames.forEach((name, i) => {
    r2[name] = 1 - X.theta[i] / X.Sigma[i][i];
  });
  const isChild = new Set(cm.ho.map((h) => h.child));
  m.constructs.forEach((name, j) => {
    if (m.preds[j].length || isChild.has(j)) r2[name] = 1 - X.Psi[j][j] / X.C[j][j];
  });
  return { variances, fixedStd, r2 };
}
