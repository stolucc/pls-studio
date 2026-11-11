// PLSc for models with interaction and quadratic terms (Dijkstra & Schermelleh-
// Engel 2014). A proxy is Q·η + δ with Q² = ρA and δ normal, independent of η
// and of the other errors, so the moments of the latent variables follow from
// those of the proxies by taking out the error parts, lowest order first. Means
// over n, as cSEM (Rademaker & Schuberth 2020).

import { solve } from './linalg';

/** Even moment E[δ^k] of a normal error of variance s2: (k − 1)!! s2^(k/2). */
export function normalMoment(k: number, s2: number): number {
  let m = 1;
  for (let i = k - 1; i > 1; i -= 2) m *= i;
  return m * s2 ** (k / 2);
}

/** E[η_a η_b …] of the latent variables, from the construct scores (unit variance) and their reliabilities. */
export function latentMoments(scores: Float64Array[], rho: number[]) {
  const n = scores[0]?.length ?? 0;
  const memo = new Map<string, number>();
  const proxy = (vars: number[]) => {
    let s = 0;
    for (let r = 0; r < n; r++) {
      let p = 1;
      for (const v of vars) p *= scores[v][r];
      s += p;
    }
    return s / n;
  };
  const binom = (a: number, k: number) => {
    let c = 1;
    for (let i = 0; i < k; i++) c = (c * (a - i)) / (i + 1);
    return c;
  };

  const moment = (input: number[]): number => {
    if (input.length === 0) return 1;
    if (input.length === 1) return 0;
    if (input.length === 2 && input[0] === input[1]) return 1; // (a latent variable has unit variance)
    const vars = [...input].sort((a, b) => a - b);
    const key = vars.join(',');
    const known = memo.get(key);
    if (known !== undefined) return known;
    const ids = [...new Set(vars)];
    const powers = ids.map((v) => vars.filter((x) => x === v).length);
    let rest = proxy(vars),
      lead = 1;
    ids.forEach((v, i) => {
      lead *= Math.sqrt(rho[v]) ** powers[i];
    });
    // Every way of giving an even number of each variable's factors to its error, bar the one that gives none.
    const walk = (i: number, taken: number[]) => {
      if (i < ids.length) {
        for (let k = 0; k <= powers[i]; k += 2) walk(i + 1, [...taken, k]);
        return;
      }
      if (taken.every((k) => k === 0)) return;
      let term = 1;
      const left: number[] = [];
      ids.forEach((v, j) => {
        term *=
          binom(powers[j], taken[j]) *
          Math.sqrt(rho[v]) ** (powers[j] - taken[j]) *
          normalMoment(taken[j], 1 - rho[v]);
        for (let c = 0; c < powers[j] - taken[j]; c++) left.push(v);
      });
      rest -= term * moment(left);
    };
    walk(0, []);
    const value = rest / lead;
    memo.set(key, value);
    return value;
  };
  return moment;
}

/** A regressor of the structural equation: one latent variable, or the product of two. */
export type Regressor = number[];

/** The regression of `y` on these regressors, from the latent moments. */
export function momentRegression(
  moment: (vars: number[]) => number,
  y: number,
  regressors: Regressor[],
) {
  const A = regressors.map((a) =>
    regressors.map((b) => moment([...a, ...b]) - moment(a) * moment(b)),
  );
  const c = regressors.map((a) => moment([y, ...a]));
  const beta = regressors.length ? solve(A, c) : [];
  return { beta, r2: beta.reduce((s, b, i) => s + b * c[i], 0) };
}
