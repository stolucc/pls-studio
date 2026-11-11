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
  const lo = Math.floor(h),
    hi = Math.ceil(h);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

/** Quantile (type 7) of unsorted values. */
export const quantileOf = (values: ArrayLike<number>, p: number): number =>
  quantileSorted(Float64Array.from(values).sort(), p);

// ---------- Student t distribution ----------

function lnGamma(z: number): number {
  // Lanczos approximation (g=7, n=9)
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
  z -= 1;
  let x = c[0];
  for (let i = 1; i < 9; i++) x += c[i] / (z + i);
  const t = z + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

function betacf(a: number, b: number, x: number): number {
  const MAXIT = 300,
    EPS = 3e-16,
    FPMIN = 1e-300;
  const qab = a + b,
    qap = a + 1,
    qam = a - 1;
  let c = 1,
    d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
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
  const bt = Math.exp(
    lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x),
  );
  return x < (a + 1) / (a + b + 2)
    ? (bt * betacf(a, b, x)) / a
    : 1 - (bt * betacf(b, a, 1 - x)) / b;
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
    let sum = 1 / a,
      term = sum;
    for (let n = 1; n < 1000; n++) {
      term *= x / (a + n);
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-16) break;
    }
    return sum * Math.exp(lnPre);
  }
  // Continued fraction for Q(a, x) (modified Lentz).
  const FPMIN = 1e-300;
  let b = x + 1 - a,
    c = 1 / FPMIN,
    d = 1 / b,
    h = d;
  for (let i = 1; i < 1000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
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
/**
 * The Gaussian copula term of a variable (Park & Gupta 2012): the normal quantile of its empirical CDF. As
 * REndo::copulaCorrection: the largest value's CDF of 1 becomes n / (n + 1), and an exact 0 becomes 1 − n / (n + 1).
 */
export function pStar(v: ArrayLike<number>): Float64Array {
  const n = v.length;
  const sorted = Float64Array.from(v as ArrayLike<number>).sort();
  const upper = (x: number) => {
    let lo = 0,
      hi = n;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (sorted[m] <= x) lo = m + 1;
      else hi = m;
    }
    return lo;
  };
  return Float64Array.from(v as ArrayLike<number>, (x) => {
    const u = upper(x) / n;
    const s = qnorm(u === 1 ? n / (n + 1) : u);
    return s === 0 ? 1 - n / (n + 1) : s;
  });
}

/** Cramér–von Mises test of normality with estimated mean and SD (Stephens 1986, as nortest::cvm.test). */
export function cramerVonMises(x: ArrayLike<number>): { statistic: number; p: number } {
  const n = x.length;
  if (n < 8) throw new Error('The Cramér–von Mises test needs at least eight observations.');
  const sorted = Float64Array.from(x as ArrayLike<number>).sort();
  const mean = sorted.reduce((s, v) => s + v, 0) / n;
  const sd = Math.sqrt(sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1));
  let w = 1 / (12 * n);
  sorted.forEach((v, i) => {
    w += (pnorm((v - mean) / sd) - (2 * (i + 1) - 1) / (2 * n)) ** 2;
  });
  const m = (1 + 0.5 / n) * w;
  const p =
    m < 0.0275
      ? 1 - Math.exp(-13.953 + 775.5 * m - 12542.61 * m * m)
      : m < 0.051
        ? 1 - Math.exp(-5.903 + 179.546 * m - 1515.29 * m * m)
        : m < 0.092
          ? Math.exp(0.886 - 31.62 * m + 10.897 * m * m)
          : m < 1.1
            ? Math.exp(1.111 - 34.242 * m + 12.832 * m * m)
            : 7.37e-10;
  return { statistic: w, p };
}

export function normalP(z: number): number {
  if (!Number.isFinite(z)) return Number.isNaN(z) ? NaN : 0;
  // erfc(|z|/√2) = Q(1/2, z²/2)
  return 1 - gammaP(0.5, (z * z) / 2);
}

/** Standard normal quantile (Wichura 1988, algorithm AS 241; about 16 digits). */
export function qnorm(p: number): number {
  if (!(p > 0 && p < 1)) return p === 0 ? -Infinity : p === 1 ? Infinity : NaN;
  const q = p - 0.5;
  if (Math.abs(q) <= 0.425) {
    const r = 0.180625 - q * q;
    return (
      (q *
        (((((((r * 2509.0809287301227 + 33430.57558358813) * r + 67265.7709270087) * r +
          45921.95393154987) *
          r +
          13731.69376550946) *
          r +
          1971.5909503065513) *
          r +
          133.14166789178438) *
          r +
          3.3871328727963665)) /
      (((((((r * 5226.495278852546 + 28729.085735721943) * r + 39307.89580009271) * r +
        21213.794301586597) *
        r +
        5394.196021424751) *
        r +
        687.1870074920579) *
        r +
        42.31333070160091) *
        r +
        1)
    );
  }
  let r = Math.sqrt(-Math.log(q < 0 ? p : 1 - p)),
    x: number;
  if (r <= 5) {
    r -= 1.6;
    x =
      (((((((r * 0.0007745450142783414 + 0.022723844989269184) * r + 0.2417807251774506) * r +
        1.2704582524523684) *
        r +
        3.6478483247632045) *
        r +
        5.769497221460691) *
        r +
        4.630337846156546) *
        r +
        1.4234371107496835) /
      (((((((r * 1.0507500716444169e-9 + 0.0005475938084995345) * r + 0.015198666563616457) * r +
        0.14810397642748008) *
        r +
        0.6897673349851) *
        r +
        1.6763848301838038) *
        r +
        2.053191626637759) *
        r +
        1);
  } else {
    r -= 5;
    x =
      (((((((r * 2.0103343992922881e-7 + 2.7115555687434876e-5) * r + 0.0012426609473880784) * r +
        0.026532189526576124) *
        r +
        0.29656057182850487) *
        r +
        1.7848265399172913) *
        r +
        5.463784911164114) *
        r +
        6.657904643501103) /
      (((((((r * 2.0442631033899397e-15 + 1.421511758316446e-7) * r + 1.8463183175100548e-5) * r +
        0.0007868691311456133) *
        r +
        0.014875361290850615) *
        r +
        0.1369298809227358) *
        r +
        0.599832206555888) *
        r +
        1);
  }
  return q < 0 ? -x : x;
}

/** Logistic quantile ln(p / (1 − p)), with p kept within [eps, 1 − eps]. */
export function qlogis(p: number, eps = 0): number {
  const q = Math.min(Math.max(p, eps), 1 - eps);
  return Math.log(q / (1 - q));
}

/** Standard normal distribution function. */
export function pnorm(x: number): number {
  if (Number.isNaN(x)) return NaN;
  return x >= 0 ? 1 - normalP(x) / 2 : normalP(x) / 2;
}

/** Two-sided standard normal critical value z with P(|Z| > z) = alpha. */
export function zCrit(alpha: number): number {
  return bisect((z) => normalP(z) - alpha, 0, 40, 1e-13);
}

/** Smallest root of f on [lo, hi] by bisection; f must change sign. */
export function bisect(f: (x: number) => number, lo: number, hi: number, tol = 1e-10): number {
  let flo = f(lo);
  for (let i = 0; i < 200 && hi - lo > tol; i++) {
    const mid = (lo + hi) / 2,
      fm = f(mid);
    if (Math.sign(fm) === Math.sign(flo)) {
      lo = mid;
      flo = fm;
    } else hi = mid;
  }
  return (lo + hi) / 2;
}
