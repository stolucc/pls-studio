// The measurement checks of PLS reports in a simulation, as Rönkkö & Evermann
// (2013) and Henseler et al. (2015) study them: how the usual checks behave
// across replications, and how often each fails its cutoff, whether the model
// is right or wrong. Per common-factor construct with two or more indicators:
// - ρc (composite reliability) from the loadings, ≥ 0.70;
// - AVE, the mean squared loading, ≥ 0.50;
// - the Fornell–Larcker margin √AVE − max |r| with the other constructs, > 0;
// per pair of them HTMT (from the indicator correlations), < 0.85 and < 0.90, and HTMT inference: the upper
// bound of its 90% normal bootstrap interval (Henseler et al. 2015), < 1 (with bootstrap samples only); per
// construct the cross-loadings margin, the smallest own-construct correlation of its indicators less their
// largest correlation with another construct's scores, > 0; and for the model GoF = √(mean AVE · mean R²)
// (Tenenhaus et al. 2005), ≥ 0.36.
// CB-SEM gets the same checks from its standardised loadings and factor correlations (AVE/SV_CFA in Rönkkö &
// Cho 2022), and per pair of factors their tests of the factor correlation: the upper bound of its
// (delta-method) interval at 1 − α against 1, .90 and .85 (CI_CFA(cut); α = .10 gives Franke & Sarstedt's
// one-tailed 5% test), and χ²(1), the χ² difference
// against the model with the correlation fixed at 1, which flags the pair when below 3.84 (not significant).
// The true values are the same checks of the population: loadings are the
// indicator–construct correlations, the construct and indicator correlations
// the population's; HTMT inference's true value is the population HTMT. R/mc.R computes the same
// (validity_value).

import { corStd, mulberry32, qnorm, standardize } from './stats';

export type McValidityRule =
  | 'cr'
  | 'ave'
  | 'fl'
  | 'xl'
  | 'htmt'
  | 'htmt90'
  | 'htmtci'
  | 'gof'
  | 'cicfa'
  | 'cicfa90'
  | 'cicfa85'
  | 'chi1';

/** The checks only CB-SEM computes (tests of the factor correlation), and those only PLS does (from its scores). */
export const CB_ONLY_RULES: McValidityRule[] = ['cicfa', 'cicfa90', 'cicfa85', 'chi1'];
export const PLS_ONLY_RULES: McValidityRule[] = ['xl', 'gof'];

export const MC_VALIDITY_RULES: Record<
  McValidityRule,
  { label: string; cutoff: number; poorBelow: boolean }
> = {
  cr: { label: 'ρc', cutoff: 0.7, poorBelow: true },
  ave: { label: 'AVE', cutoff: 0.5, poorBelow: true },
  fl: { label: 'Fornell–Larcker margin', cutoff: 0, poorBelow: true },
  xl: { label: 'Cross-loadings margin', cutoff: 0, poorBelow: true },
  htmt: { label: 'HTMT (.85)', cutoff: 0.85, poorBelow: false },
  htmt90: { label: 'HTMT (.90)', cutoff: 0.9, poorBelow: false },
  htmtci: { label: 'HTMT inference (upper 90% bound)', cutoff: 1, poorBelow: false },
  gof: { label: 'GoF', cutoff: 0.36, poorBelow: true },
  cicfa: { label: 'Factor correlation CI (upper bound) vs 1', cutoff: 1, poorBelow: false },
  cicfa90: { label: 'Factor correlation CI (upper bound) vs .90', cutoff: 0.9, poorBelow: false },
  cicfa85: { label: 'Factor correlation CI (upper bound) vs .85', cutoff: 0.85, poorBelow: false },
  chi1: {
    label: 'χ²(1): correlation fixed at 1 (Δχ²)',
    cutoff: 3.841458820694124,
    poorBelow: true,
  },
};

/** The checks' inputs, index-aligned: blocks index indicators, constructs index C and r2. */
export interface ValidityInputs {
  constructs: string[];
  blocks: number[][];
  /** Common-factor constructs (the checks apply to those with two or more indicators). */
  factor: boolean[];
  /** Each indicator's loading on its own construct. */
  loadings: number[];
  /** Construct correlations. */
  C: number[][];
  /** Indicator correlations. */
  R: number[][];
  /** R² of each construct (null: exogenous). */
  r2: (number | null)[];
  /** Correlations of each indicator with each construct('s scores) [indicator][construct]: the cross-loadings. */
  cross?: number[][];
  /**
   * HTMT inference: the indicator columns, bootstrap samples and seed; 'population': its true value, the
   * population HTMT (none: not computed).
   */
  boot?: { cols: Float64Array[]; samples: number; seed: number } | 'population';
  /**
   * CB-SEM's tests of each factor correlation [construct][construct]: the upper bound of its interval and
   * the χ² difference against the correlation fixed at 1 (NaN: not available); 'population': the true
   * correlation (and no Δχ²).
   */
  factorTests?: { upper: number[][]; chi1: number[][] } | 'population';
}

/** HTMT of two blocks from an indicator correlation matrix. */
function htmtOf(R: ArrayLike<ArrayLike<number>>, a: number[], b: number[]): number {
  const mono = (x: number[]) => {
    let s = 0;
    let count = 0;
    for (let i = 0; i < x.length; i++)
      for (let j = i + 1; j < x.length; j++) {
        s += Math.abs(R[x[i]][x[j]]);
        count++;
      }
    return s / count;
  };
  let s = 0;
  for (const i of a) for (const j of b) s += Math.abs(R[i][j]);
  return s / (a.length * b.length) / Math.sqrt(mono(a) * mono(b));
}

/**
 * The upper bound of HTMT's 90% normal bootstrap interval (boot's "normal" interval: bias-corrected estimate
 * plus 1.645 bootstrap standard errors), resampling the cases; Henseler et al. (2015) flag a pair when it
 * reaches 1.
 */
export function htmtUpper(
  cols: Float64Array[],
  a: number[],
  b: number[],
  samples: number,
  seed: number,
): number {
  const n = cols[0].length;
  const vars = [...a, ...b];
  const u = mulberry32(seed);
  const at = new Map(vars.map((v, k) => [v, k]));
  const draws: number[] = [];
  const x = vars.map(() => new Float64Array(n));
  for (let s = 0; s < samples; s++) {
    for (let r = 0; r < n; r++) {
      const row = Math.floor(u() * n);
      vars.forEach((v, k) => (x[k][r] = cols[v][row]));
    }
    const z = x.map((c) => standardizeOrNull(c));
    if (z.some((c) => c === null)) continue;
    const R = vars.map((_, i) => vars.map((__, j) => corStd(z[i]!, z[j]!)));
    const d = htmtOf(
      R,
      a.map((v) => at.get(v)!),
      b.map((v) => at.get(v)!),
    );
    if (Number.isFinite(d)) draws.push(d);
  }
  if (draws.length < 2) return NaN;
  const R0 = vars.map((i) => vars.map((j) => corStd(standardize(cols[i]), standardize(cols[j]))));
  const t0 = htmtOf(
    R0,
    a.map((v) => at.get(v)!),
    b.map((v) => at.get(v)!),
  );
  const mean = draws.reduce((s, v) => s + v, 0) / draws.length;
  const sd = Math.sqrt(draws.reduce((s, v) => s + (v - mean) ** 2, 0) / (draws.length - 1));
  return t0 - (mean - t0) + qnorm(0.95) * sd;
}

/** A column standardised, or null when it is constant (a bootstrap sample can repeat one case). */
function standardizeOrNull(x: Float64Array): Float64Array | null {
  try {
    return standardize(x);
  } catch {
    return null;
  }
}

/** The constructs the checks apply to. */
export const checkedConstructs = (v: Pick<ValidityInputs, 'blocks' | 'factor'>) =>
  v.blocks.map((_, j) => j).filter((j) => v.factor[j] && v.blocks[j].length >= 2);

/** Every check, keyed `<rule>:<construct>`, `htmt:<a>:<b>` and `gof`. */
export function validityValues(v: ValidityInputs): Map<string, number> {
  const out = new Map<string, number>();
  const checked = checkedConstructs(v);
  const ave = new Map<number, number>();
  for (const j of checked) {
    const lam = v.blocks[j].map((i) => v.loadings[i]);
    const sum = lam.reduce((s, l) => s + l, 0);
    const error = lam.reduce((s, l) => s + (1 - l * l), 0);
    const a = lam.reduce((s, l) => s + l * l, 0) / lam.length;
    ave.set(j, a);
    const name = v.constructs[j];
    out.set(`cr:${name}`, (sum * sum) / (sum * sum + error));
    out.set(`ave:${name}`, a);
    let largest = 0;
    v.constructs.forEach((_, k) => {
      if (k !== j) largest = Math.max(largest, Math.abs(v.C[j][k]));
    });
    out.set(`fl:${name}`, Math.sqrt(a) - largest);
  }
  checked.forEach((i, x) =>
    checked.slice(x + 1).forEach((j) => {
      const pair = `${v.constructs[i]}:${v.constructs[j]}`;
      const h = htmtOf(v.R, v.blocks[i], v.blocks[j]);
      out.set(`htmt:${pair}`, h);
      out.set(`htmt90:${pair}`, h);
      if (v.boot === 'population') out.set(`htmtci:${pair}`, h);
      else if (v.boot)
        out.set(
          `htmtci:${pair}`,
          htmtUpper(v.boot.cols, v.blocks[i], v.blocks[j], v.boot.samples, v.boot.seed),
        );
      if (v.factorTests) {
        const t = v.factorTests;
        const upper = t === 'population' ? v.C[i][j] : t.upper[i][j];
        out.set(`cicfa:${pair}`, upper);
        out.set(`cicfa90:${pair}`, upper);
        out.set(`cicfa85:${pair}`, upper);
        out.set(`chi1:${pair}`, t === 'population' ? NaN : t.chi1[i][j]);
      }
    }),
  );
  if (v.cross)
    for (const j of checked) {
      let margin = Infinity;
      for (const i of v.blocks[j]) {
        let other = -Infinity;
        v.constructs.forEach((_, k) => {
          if (k !== j) other = Math.max(other, Math.abs(v.cross![i][k]));
        });
        margin = Math.min(margin, Math.abs(v.cross[i][j]) - other);
      }
      out.set(`xl:${v.constructs[j]}`, margin);
    }
  const r2 = v.r2.filter((x): x is number => x !== null);
  if (ave.size && r2.length) {
    const meanAve = [...ave.values()].reduce((s, x) => s + x, 0) / ave.size;
    const meanR2 = r2.reduce((s, x) => s + x, 0) / r2.length;
    out.set('gof', Math.sqrt(meanAve * meanR2));
  }
  return out;
}

/** 1 when a value fails its rule's cutoff, 0 when it passes (NaN: no value). */
export function failsCutoff(rule: McValidityRule, value: number): number {
  if (!Number.isFinite(value)) return NaN;
  const r = MC_VALIDITY_RULES[rule];
  return (r.poorBelow ? value < r.cutoff : value > r.cutoff) ? 1 : 0;
}
