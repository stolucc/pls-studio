// Descriptive statistics, standardisation, Student-t distribution and a
// seedable RNG. Variances use the n-1 denominator (matches R / SmartPLS).

export function mean(x: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i];
  return s / x.length;
}

export function sd(x: ArrayLike<number>): number {
  const m = mean(x);
  let s = 0;
  for (let i = 0; i < x.length; i++) s += (x[i] - m) ** 2;
  return Math.sqrt(s / (x.length - 1));
}

/** Returns a standardised copy (mean 0, sd 1). Throws on zero variance. */
export function standardize(x: ArrayLike<number>, label = 'variable'): Float64Array {
  const m = mean(x);
  const s = sd(x);
  if (!(s > 1e-12)) throw new Error(`"${label}" has zero variance.`);
  const out = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = (x[i] - m) / s;
  return out;
}

/** Correlation of two already-standardised columns. */
export function corStd(a: Float64Array, b: Float64Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s / (a.length - 1);
}

/** Percentile with linear interpolation (R type 7). `sorted` must be ascending. */
export function quantileSorted(sorted: ArrayLike<number>, p: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  const h = (n - 1) * p;
  const lo = Math.floor(h), hi = Math.ceil(h);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

// ---------- Student t distribution ----------

function lnGamma(z: number): number {
  // Lanczos approximation (g=7, n=9)
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
  z -= 1;
  let x = c[0];
  for (let i = 1; i < 9; i++) x += c[i] / (z + i);
  const t = z + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

function betacf(a: number, b: number, x: number): number {
  const MAXIT = 300, EPS = 3e-16, FPMIN = 1e-300;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Regularised incomplete beta I_x(a, b). */
export function incBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/** Two-tailed p-value of a t statistic with `df` degrees of freedom. */
export function tTestP(t: number, df: number): number {
  if (!Number.isFinite(t)) return Number.isNaN(t) ? NaN : 0;
  return incBeta(df / (df + t * t), df / 2, 0.5);
}

// ---------- RNG ----------

/** mulberry32: small, fast, seedable PRNG returning floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- gamma / chi-square / normal ----------

/** Regularised lower incomplete gamma P(a, x). */
export function gammaP(a: number, x: number): number {
  if (x <= 0) return 0;
  const lnPre = a * Math.log(x) - x - lnGamma(a);
  if (x < a + 1) {
    let sum = 1 / a, term = sum;
    for (let n = 1; n < 1000; n++) {
      term *= x / (a + n);
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-16) break;
    }
    return sum * Math.exp(lnPre);
  }
  // Continued fraction for Q(a, x) (modified Lentz).
  const FPMIN = 1e-300;
  let b = x + 1 - a, c = 1 / FPMIN, d = 1 / b, h = d;
  for (let i = 1; i < 1000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-16) break;
  }
  return 1 - Math.exp(lnPre) * h;
}

export function chisqCdf(x: number, df: number): number {
  return x <= 0 ? 0 : gammaP(df / 2, x / 2);
}

/** Noncentral chi-square CDF as a Poisson mixture of central chi-squares. */
export function ncChisqCdf(x: number, df: number, ncp: number): number {
  if (ncp <= 0) return chisqCdf(x, df);
  if (x <= 0) return 0;
  const half = ncp / 2;
  // Sum outward from the Poisson mode for numerical stability.
  const mode = Math.floor(half);
  const logPois = (k: number) => -half + k * Math.log(half) - lnGamma(k + 1);
  let total = 0;
  for (const dir of [1, -1]) {
    for (let k = dir === 1 ? mode : mode - 1; k >= 0; k += dir) {
      const w = Math.exp(logPois(k));
      total += w * chisqCdf(x, df + 2 * k);
      if (w < 1e-17 && Math.abs(k - mode) > 10) break;
      if (k > mode + 10000) break;
    }
  }
  return Math.min(1, total);
}

/** Two-tailed p-value for a standard normal z statistic. */
export function normalP(z: number): number {
  if (!Number.isFinite(z)) return Number.isNaN(z) ? NaN : 0;
  // erfc(|z|/√2) = Q(1/2, z²/2)
  return 1 - gammaP(0.5, (z * z) / 2);
}

/** Two-sided standard normal critical value z with P(|Z| > z) = alpha. */
export function zCrit(alpha: number): number {
  return bisect((z) => normalP(z) - alpha, 0, 40, 1e-13);
}

/** Smallest root of f on [lo, hi] by bisection; f must change sign. */
export function bisect(f: (x: number) => number, lo: number, hi: number, tol = 1e-10): number {
  let flo = f(lo);
  for (let i = 0; i < 200 && hi - lo > tol; i++) {
    const mid = (lo + hi) / 2, fm = f(mid);
    if (Math.sign(fm) === Math.sign(flo)) { lo = mid; flo = fm; } else hi = mid;
  }
  return (lo + hi) / 2;
}
