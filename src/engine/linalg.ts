// Small dense linear-algebra helpers. Matrices are row-major number[][];
// data columns are Float64Array. Sizes in PLS are tiny (tens of variables),
// so clarity beats cleverness here.

export type Mat = number[][];

export function zeros(r: number, c: number): Mat {
  return Array.from({ length: r }, () => new Array<number>(c).fill(0));
}

export function identity(n: number): Mat {
  const m = zeros(n, n);
  for (let i = 0; i < n; i++) m[i][i] = 1;
  return m;
}

export function matMul(a: Mat, b: Mat): Mat {
  const r = a.length,
    k = b.length,
    c = b[0]?.length ?? 0;
  const out = zeros(r, c);
  for (let i = 0; i < r; i++) {
    for (let p = 0; p < k; p++) {
      const aip = a[i][p];
      if (aip === 0) continue;
      for (let j = 0; j < c; j++) out[i][j] += aip * b[p][j];
    }
  }
  return out;
}

/**
 * Power of two nearest √x: scaling by powers of two is exact in floating
 * point, so equilibrating a matrix with them adds no rounding of its own.
 */
function sqrtScale(x: number): number {
  return 2 ** Math.round(Math.log2(x) / 2);
}

/**
 * Inverse via Gauss-Jordan elimination with partial pivoting. Throws on singular input.
 *
 * The matrix is first equilibrated (Ruiz 2001): rows and columns are divided
 * repeatedly by the square roots of their largest entries, rounded to powers
 * of two, until every row and column has its largest entry near 1. The
 * singularity test |pivot| < 1e-12 is then relative to the matrix's own scale
 * rather than absolute. That matters for matrices whose entries carry units,
 * such as the CB-SEM information matrix, whose entries scale as 1/variance²:
 * an income variable with SD 2000 would otherwise make a perfectly regular
 * matrix look singular. For a matrix D·A·D with D diagonal the scaling absorbs
 * D, so the test does not depend on the units. Since
 * inv(Dr·A·Dc) = Dc⁻¹·inv(A)·Dr⁻¹, the inverse is recovered by scaling back
 * with the same factors.
 */
export function invert(m: Mat): Mat {
  const n = m.length;
  const a = m.map((row) => row.slice());
  const rowScale = new Array<number>(n).fill(1);
  const colScale = new Array<number>(n).fill(1);
  for (let pass = 0; pass < 64; pass++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      const big = Math.max(...a[i].map(Math.abs));
      if (!(big > 0) || !Number.isFinite(big)) throw new SingularMatrixError();
      const f = sqrtScale(big);
      if (f === 1) continue;
      changed = true;
      rowScale[i] *= f;
      for (let j = 0; j < n; j++) a[i][j] /= f;
    }
    for (let j = 0; j < n; j++) {
      const big = Math.max(...a.map((row) => Math.abs(row[j])));
      if (!(big > 0)) throw new SingularMatrixError();
      const f = sqrtScale(big);
      if (f === 1) continue;
      changed = true;
      colScale[j] *= f;
      for (let i = 0; i < n; i++) a[i][j] /= f;
    }
    if (!changed) break;
  }
  const inv = identity(n);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(a[r][col]) > Math.abs(a[piv][col])) piv = r;
    if (Math.abs(a[piv][col]) < 1e-12) throw new SingularMatrixError();
    [a[col], a[piv]] = [a[piv], a[col]];
    [inv[col], inv[piv]] = [inv[piv], inv[col]];
    const d = a[col][col];
    for (let j = 0; j < n; j++) {
      a[col][j] /= d;
      inv[col][j] /= d;
    }
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = a[r][col];
      if (f === 0) continue;
      for (let j = 0; j < n; j++) {
        a[r][j] -= f * a[col][j];
        inv[r][j] -= f * inv[col][j];
      }
    }
  }
  // inv now holds inv(Dr·A·Dc); undo the scaling.
  return inv.map((row, i) => row.map((v, j) => v / colScale[i] / rowScale[j]));
}

/** Solve A x = b for symmetric/general square A. */
export function solve(a: Mat, b: number[]): number[] {
  const inv = invert(a);
  return inv.map((row) => row.reduce((s, v, j) => s + v * b[j], 0));
}

export class SingularMatrixError extends Error {
  constructor() {
    super('Matrix is singular (perfectly collinear variables).');
    this.name = 'SingularMatrixError';
  }
}

export function transpose(a: Mat): Mat {
  return (a[0] ?? []).map((_, j) => a.map((row) => row[j]));
}

/** Cholesky factor L (lower) with A = L Lᵀ, or null if A is not positive definite. */
export function cholesky(a: Mat): Mat | null {
  const n = a.length;
  const L = zeros(n, n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = a[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      if (i === j) {
        if (!(s > 0)) return null;
        L[i][i] = Math.sqrt(s);
      } else L[i][j] = s / L[j][j];
    }
  }
  return L;
}

export function logDetPD(L: Mat): number {
  let s = 0;
  for (let i = 0; i < L.length; i++) s += 2 * Math.log(L[i][i]);
  return s;
}

/** Inverse of a positive-definite matrix from its Cholesky factor. */
export function invertPD(L: Mat): Mat {
  const n = L.length;
  // Invert L (lower triangular), then A⁻¹ = L⁻ᵀ L⁻¹.
  const Li = zeros(n, n);
  for (let i = 0; i < n; i++) {
    Li[i][i] = 1 / L[i][i];
    for (let j = 0; j < i; j++) {
      let s = 0;
      for (let k = j; k < i; k++) s -= L[i][k] * Li[k][j];
      Li[i][j] = s / L[i][i];
    }
  }
  const out = zeros(n, n);
  for (let i = 0; i < n; i++)
    for (let j = 0; j <= i; j++) {
      let s = 0;
      for (let k = i; k < n; k++) s += Li[k][i] * Li[k][j];
      out[i][j] = s;
      out[j][i] = s;
    }
  return out;
}

/** Eigen-decomposition of a symmetric matrix (cyclic Jacobi). Columns of `vectors` are eigenvectors. */
export function symEigen(a: Mat): { values: number[]; vectors: Mat } {
  const n = a.length;
  const A = a.map((r) => r.slice());
  const V = identity(n);
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += A[i][j] * A[i][j];
    if (off < 1e-24) break;
    for (let p = 0; p < n; p++)
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(A[p][q]) < 1e-300) continue;
        const theta = (A[q][q] - A[p][p]) / (2 * A[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1),
          s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = A[k][p],
            akq = A[k][q];
          A[k][p] = c * akp - s * akq;
          A[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = A[p][k],
            aqk = A[q][k];
          A[p][k] = c * apk - s * aqk;
          A[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = V[k][p],
            vkq = V[k][q];
          V[k][p] = c * vkp - s * vkq;
          V[k][q] = s * vkp + c * vkq;
        }
      }
  }
  return { values: A.map((r, i) => r[i]), vectors: V };
}

/** f(A) for symmetric A via its eigen-decomposition, e.g. matrix square root. */
export function symMatFn(a: Mat, f: (x: number) => number): Mat {
  const { values, vectors: V } = symEigen(a);
  const n = a.length;
  const out = zeros(n, n);
  for (let k = 0; k < n; k++) {
    const fk = f(values[k]);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) out[i][j] += V[i][k] * fk * V[j][k];
  }
  return out;
}
