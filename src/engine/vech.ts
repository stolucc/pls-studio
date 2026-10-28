// Half-vectorisation (vech) algebra for covariance-structure inference:
// normal-theory weight matrices, the ADF fourth-moment matrix Γ, and the
// Jacobian Δ = ∂vech(Σ)/∂θ. Used by the robust (MLM, MLMV, MLR) and
// least-squares (GLS, ULS) estimators in cbsem.ts.

import type { Mat } from './linalg';
import { zeros } from './linalg';

export type Pairs = [number, number][];

/** vech index pairs (i ≥ j), column-major like R's vech. */
export function vechPairs(p: number): Pairs {
  const out: Pairs = [];
  for (let j = 0; j < p; j++) for (let i = j; i < p; i++) out.push([i, j]);
  return out;
}

export const vech = (M: Mat, pairs: Pairs) => pairs.map(([i, j]) => M[i][j]);

/**
 * ½ Dᵀ(A ⊗ A)D for symmetric A: the normal-theory weight on vech(S − Σ).
 * With A = Σ⁻¹ this is the expected ML information per unit of vech.
 */
export function weightNT(A: Mat, pairs: Pairs): Mat {
  const q = pairs.length;
  const W = zeros(q, q);
  for (let a = 0; a < q; a++) {
    const [i, j] = pairs[a];
    for (let b = a; b < q; b++) {
      const [k, l] = pairs[b];
      // Σ over symmetric expansions (u,v) of (i,j) and (x,y) of (k,l) of A_ux A_vy.
      let v = A[i][k] * A[j][l];
      if (k !== l) v += A[i][l] * A[j][k];
      if (i !== j) {
        v += A[j][k] * A[i][l];
        if (k !== l) v += A[j][l] * A[i][k];
      }
      W[a][b] = 0.5 * v;
      W[b][a] = 0.5 * v;
    }
  }
  return W;
}

/**
 * ADF estimate of the asymptotic covariance of vech(S) (biased, divisor N),
 * from columns centred at their means: Γ = 1/N Σ (dᵢ − s)(dᵢ − s)ᵀ with
 * dᵢ = vech(zᵢzᵢᵀ).
 */
export function gammaADF(centred: Float64Array[], pairs: Pairs): { Gamma: Mat; s: number[] } {
  const n = centred[0].length;
  const q = pairs.length;
  const d = pairs.map(([i, j]) => {
    const out = new Float64Array(n);
    const a = centred[i], b = centred[j];
    for (let r = 0; r < n; r++) out[r] = a[r] * b[r];
    return out;
  });
  const s = d.map((col) => col.reduce((acc, v) => acc + v, 0) / n);
  const G = zeros(q, q);
  for (let a = 0; a < q; a++) {
    const da = d[a], sa = s[a];
    for (let b = a; b < q; b++) {
      const db = d[b], sb = s[b];
      let acc = 0;
      for (let r = 0; r < n; r++) acc += (da[r] - sa) * (db[r] - sb);
      G[a][b] = acc / n;
      G[b][a] = acc / n;
    }
  }
  return { Gamma: G, s };
}

/** Δ (p* × q) from symmetric outer-product derivatives c(uvᵀ + vuᵀ). */
export function deltaMatrix(derivs: { u: number[]; v: number[]; c: number }[], pairs: Pairs): Mat {
  return pairs.map(([i, j]) => derivs.map((d) => d.c * (d.u[i] * d.v[j] + d.v[i] * d.u[j])));
}

// ---------- small dense helpers (row-major) ----------

export function mm(a: Mat, b: Mat): Mat {
  const r = a.length, k = b.length, c = b[0]?.length ?? 0;
  const out = zeros(r, c);
  for (let i = 0; i < r; i++) {
    const ai = a[i], oi = out[i];
    for (let x = 0; x < k; x++) {
      const v = ai[x];
      if (v === 0) continue;
      const bx = b[x];
      for (let j = 0; j < c; j++) oi[j] += v * bx[j];
    }
  }
  return out;
}

export const tr = (M: Mat) => M.reduce((s, r, i) => s + r[i], 0);
export const t = (M: Mat): Mat => (M[0] ?? []).map((_, j) => M.map((r) => r[j]));
/** tr(AB) without forming the product. */
export function trProd(A: Mat, B: Mat): number {
  let s = 0;
  for (let i = 0; i < A.length; i++) for (let j = 0; j < B.length; j++) s += A[i][j] * B[j][i];
  return s;
}
/** Xᵀ M X */
export const quad = (X: Mat, M: Mat) => mm(t(X), mm(M, X));
