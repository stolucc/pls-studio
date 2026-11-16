// Monte Carlo simulation studies: power / sample-size planning and estimator
// comparisons. Data are drawn from a population model (population.ts); every
// replication is estimated by each requested estimator, and per parameter we
// report mean estimate, bias, relative bias, empirical SD, RMSE, CI coverage,
// mean CI width, power (rejection rate; the Type I error rate when the true
// value is 0) and the share of inadmissible solutions.
//
// Replications are split into ranges for parallel workers. Replication r at
// sample size n always uses the same seed, so results do not depend on how
// the work was split.

import { runRange, sampleSeed } from './bootstrap';
import { estimateCb, type CbEstimator, type CbFit } from './cbsem';
import {
  bootTests,
  constructFlips,
  correctedDraws,
  DEFAULT_INFERENCE,
  MC_TESTS,
  type McInference,
  type McTest,
} from './mcInference';
import { mcIndirect } from './mcci';
import { regressionFit, tCrit } from './mcRegression';
import { MC_FIT_INDICES, poorFit, type McFitIndex } from './mcFitIndices';
import { failsCutoff, validityValues, type McValidityRule } from './mcValidity';
import { plscProblems, preparePls } from './pls';
import {
  buildPopulation,
  compositeReliability,
  generateData,
  idealReliability,
  populationValidityInputs,
  specFromPopulation,
  unitReliability,
  type Population,
  type PopulationSpec,
} from './population';
import { corStd, mulberry32, qnorm, quantileSorted, tTestP, zCrit } from './stats';
import {
  DEFAULT_OPTIONS,
  type Dataset,
  type Mode,
  type ModelSpec,
  type WeightingScheme,
} from './types';

export type McEstimator =
  | {
      id: string;
      method: 'pls';
      consistent: boolean;
      /** Outer mode of every construct (unit: sum scores); omitted: factors mode A, composites mode B. */
      mode?: Mode;
      /** Inner weighting scheme; omitted: path. */
      scheme?: WeightingScheme;
    }
  | { id: string; method: 'cb'; estimator: CbEstimator }
  /** Regression on unit-weighted composites (dr: disattenuated), OLS t tests (mcRegression.ts). */
  | { id: string; method: 'regression'; dr: boolean };

export interface McDesign {
  population: PopulationSpec;
  estimators: McEstimator[];
  sampleSizes: number[];
  replications: number;
  seed: number;
  alpha: number;
  /** Bootstrap samples per replication for PLS inference (0 = point estimates only). */
  bootSamples: number;
  /** Monte Carlo draws per replication for CB indirect-effect CIs. */
  mcDraws: number;
  /** Bootstrap inference: sign-change correction and the interval (percentile and none when omitted). */
  inference?: McInference;
  /** Missing values put into every replication (none when omitted or the rate is 0). */
  missing?: McMissing;
  /** Ordinal indicators: every indicator cut into categories (continuous when omitted). */
  ordinal?: McOrdinal;
}

/**
 * Ordinal (Likert-type) indicators: each standardised indicator cut into `categories` at fixed thresholds.
 * Symmetric: thresholds at the normal quantiles of k/categories, equal shares. Asymmetric: at the quantiles of
 * (k/categories)², so few cases fall in the low categories and many in the high ones. CB-WLSMV estimates them
 * as ordinal (polychoric correlations); the other estimators take the category numbers as continuous.
 */
export interface McOrdinal {
  categories: number;
  thresholds: 'symmetric' | 'asymmetric';
}

/** The thresholds an ordinal design cuts at, on the standardised scale. */
export function ordinalThresholds(o: McOrdinal): number[] {
  return Array.from({ length: o.categories - 1 }, (_, i) => {
    const p = (i + 1) / o.categories;
    return qnorm(o.thresholds === 'asymmetric' ? p * p : p);
  });
}

/** The data cut into categories 1 … k at the thresholds (missing values stay missing). */
export function categorise(data: Dataset, o: McOrdinal): Dataset {
  const t = ordinalThresholds(o);
  const cols = data.cols.map((c) =>
    Float64Array.from(c, (v) => (Number.isNaN(v) ? v : 1 + t.filter((x) => v > x).length)),
  );
  return { ...data, cols };
}

/**
 * Missing values: a share `rate` of the values, completely at random (MCAR) or depending on an observed
 * variable (MAR: the first indicator stays complete; the higher a case's value on it, the likelier its other
 * values are missing, with probability 2 · rate · rank / n, so `rate` on average). Then each estimator's
 * treatment: PLS mean replacement or casewise deletion, CB-SEM casewise deletion or FIML (lavaan only).
 */
export interface McMissing {
  rate: number;
  mechanism: 'MCAR' | 'MAR';
  pls: 'mean' | 'casewise';
  cb: 'casewise' | 'fiml';
}

/** A replication's data with missing values (NaN) put in as `m` says; `seed` draws which. */
export function withMissing(data: Dataset, m: McMissing, seed: number): Dataset {
  const u = mulberry32(seed);
  const n = data.cols[0]?.length ?? 0;
  // MAR: each case's chance follows its rank on the first indicator (0 … n − 1), which stays complete.
  const chance = new Float64Array(n).fill(m.rate);
  if (m.mechanism === 'MAR' && n > 1) {
    const order = Array.from(data.cols[0], (v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
    order.forEach(([, i], rank) => (chance[i] = Math.min(1, (2 * m.rate * (rank + 0.5)) / n)));
  }
  const cols = data.cols.map((c, j) => {
    if (m.mechanism === 'MAR' && j === 0) return c;
    return Float64Array.from(c, (v, i) => (u() < chance[i] ? NaN : v));
  });
  return { ...data, cols };
}

export interface McParam {
  key: string;
  /**
   * 'fit': a test of the CB-SEM model, the χ² test (to 'χ² test') or a fit index against its cutoff (to its
   * label); the rejection rate is the Type I error (value 0: the fitted model is the population's).
   * 'covariance': the correlation of two exogenous constructs.
   * 'reliability': the squared correlation of a construct's composite with the construct (from and to: the
   * construct; value: with ideal weights, the most any weights give; population.ts compositeReliability).
   * 'validity': a measurement check of PLS (mcValidity.ts; rule), from and to its construct(s), 'model' for
   * GoF; value: the population's; the rejection rate is the share failing the rule's cutoff.
   */
  kind: 'path' | 'indirect' | 'covariance' | 'fit' | 'reliability' | 'validity';
  from: string;
  to: string;
  /** True standardised value. */
  value: number;
  /** 'reliability': the sum score's (unit weights). */
  unit?: number;
  /** 'validity': the check. */
  rule?: McValidityRule;
}

export interface McTask {
  design: McDesign;
  n: number;
  start: number;
  end: number;
}

/** Raw per-replication results for one task; NaN marks a failed replication. */
export interface McPart {
  n: number;
  start: number;
  /** [estimator][param] → per-replication arrays. */
  est: Float64Array[][];
  lo: Float64Array[][];
  hi: Float64Array[][];
  /** CI metric differs from the estimate metric for CB-SEM (unstandardised); truth used for coverage. */
  truthCI: number[][];
  sig: Float64Array[][];
  proper: Float64Array[];
  /** Bootstrap estimators: the rejection (1 / 0, NaN: none) of every test, [estimator][param] per test. */
  tests?: Partial<Record<McTest, Float64Array[][]>>;
}

/** The parameters of a design: fit tests with a CB-SEM estimator, composite reliabilities with a PLS or regression one. */
export const designParameters = (design: McDesign, pop: Population) =>
  mcParameters(
    pop,
    design.estimators.some((e) => e.method === 'cb'),
    design.estimators.some((e) => e.method !== 'cb'),
    design.estimators.some((e) => e.method === 'pls'),
  );

export function mcParameters(
  pop: Population,
  withFit = false,
  withReliability = false,
  withValidity = false,
): McParam[] {
  const C = pop.constructs;
  const out: McParam[] = [];
  if (withFit) {
    // 1: the estimated model is not the population's, so a rejection is power, not a Type I error.
    const value = pop.misspecified ? 1 : 0;
    out.push({ key: 'fit:chisq', kind: 'fit', from: 'model', to: 'χ² test', value });
    for (const f of MC_FIT_INDICES)
      out.push({ key: `fit:${f.id}`, kind: 'fit', from: 'model', to: f.label, value });
  }
  C.forEach((f, i) =>
    C.forEach((t, j) => {
      if (pop.specified[i][j])
        out.push({ key: `path:${f}:${t}`, kind: 'path', from: f, to: t, value: pop.paths[i][j] });
    }),
  );
  for (const k of pop.covariances)
    out.push({
      key: `cov:${C[k.a]}:${C[k.b]}`,
      kind: 'covariance',
      from: C[k.a],
      to: C[k.b],
      value: k.value,
    });
  C.forEach((f, i) =>
    C.forEach((t, j) => {
      if (Math.abs(pop.indirect[i][j]) > 1e-12)
        out.push({
          key: `indirect:${f}:${t}`,
          kind: 'indirect',
          from: f,
          to: t,
          value: pop.indirect[i][j],
        });
    }),
  );
  if (withReliability)
    C.forEach((name, j) => {
      if (pop.blocks[j].length < 2) return;
      out.push({
        key: `reliability:${name}`,
        kind: 'reliability',
        from: name,
        to: name,
        value: idealReliability(pop, j),
        unit: unitReliability(pop, j),
      });
    });
  if (withValidity)
    for (const [key, value] of validityValues(populationValidityInputs(pop))) {
      const [rule, a, b] = key.split(':') as [McValidityRule, string?, string?];
      out.push({
        key: `validity:${key}`,
        kind: 'validity',
        from: a ?? 'model',
        to: b ?? a ?? 'model',
        value,
        rule,
      });
    }
  return out;
}

/**
 * The factor from the standardised metric to the metric of the confidence intervals, per estimator and parameter.
 * CB-SEM CIs are for unstandardised effects in the marker metric: β · λ_mk(to) / λ_mk(from); a covariance
 * ρ · λ_mk(a) · λ_mk(b). PLS CIs are standardised (1).
 */
export function ciScale(design: McDesign, pop: Population, params: McParam[]): number[][] {
  const ci = (name: string) => pop.constructs.indexOf(name);
  return design.estimators.map((e) =>
    params.map((p) => {
      if (p.kind === 'fit') return NaN;
      if (e.method !== 'cb' || p.kind === 'reliability' || p.kind === 'validity') return 1;
      const fromLoading = pop.markerLoading[ci(p.from)];
      const toLoading = pop.markerLoading[ci(p.to)];
      if (p.kind === 'covariance') return fromLoading * toLoading;
      return toLoading / fromLoading;
    }),
  );
}

/** The true values the confidence intervals are checked against, per estimator and parameter (see ciScale). */
export function ciTruth(design: McDesign, pop: Population, params: McParam[]): number[][] {
  const scale = ciScale(design, pop, params);
  return scale.map((perParam) => perParam.map((f, pi) => params[pi].value * f));
}

/** Indirect effects (total − direct) of a path matrix [from][to]. */
function indirectOf(B: number[][]): number[][] {
  const J = B.length;
  const total = B.map((r) => r.slice());
  let power = B.map((r) => r.slice());
  for (let step = 1; step < J; step++) {
    const next = power.map((r) => r.map(() => 0));
    for (let i = 0; i < J; i++)
      for (let k = 0; k < J; k++)
        if (power[i][k]) for (let j = 0; j < J; j++) next[i][j] += power[i][k] * B[k][j];
    power = next;
    for (let i = 0; i < J; i++) for (let j = 0; j < J; j++) total[i][j] += power[i][j];
  }
  return total.map((r, i) => r.map((v, j) => v - B[i][j]));
}

/** The PLS model with every construct in one outer mode (undefined: as specified). */
function withMode(spec: ModelSpec, mode: Mode | undefined): ModelSpec {
  if (!mode) return spec;
  return { ...spec, constructs: spec.constructs.map((c) => ({ ...c, mode })) };
}

/** A fit index of a CB-SEM fit: the robust one where the estimator has it (MLM, MLMV, MLR). */
function fitIndex(fit: CbFit, id: McFitIndex['id']): number {
  if (id === 'cfi') return fit.cfiRobust ?? fit.cfi;
  if (id === 'tli') return fit.tliRobust ?? fit.tli;
  if (id === 'rmsea') return fit.rmseaRobust ?? fit.rmsea;
  return fit.srmr;
}

export const replicationSeed = (seed: number, n: number, r: number) =>
  sampleSeed(seed, ((n * 100003) ^ r) >>> 0);

export function runMcTask(
  task: McTask,
  onProgress?: (done: number, total: number) => void,
): McPart {
  const { design, n } = task;
  const pop = buildPopulation(design.population);
  const params = designParameters(design, pop);
  const E = design.estimators.length,
    count = Math.max(0, task.end - task.start);
  const arr = () =>
    Array.from({ length: E }, () => params.map(() => new Float64Array(count).fill(NaN)));
  const est = arr(),
    lo = arr(),
    hi = arr(),
    sig = arr();
  const proper = Array.from({ length: E }, () => new Float64Array(count).fill(NaN));
  const tests = Object.fromEntries(MC_TESTS.map((t) => [t, arr()])) as Record<
    McTest,
    Float64Array[][]
  >;
  const inference = design.inference ?? DEFAULT_INFERENCE;
  const blocks = design.population.constructs.map((c) => ({
    construct: c.name,
    indicators: c.indicators,
  }));
  const C = pop.constructs;
  const ci = (name: string) => C.indexOf(name);
  const truthCI = ciTruth(design, pop, params);
  const zc = zCrit(design.alpha);
  const plsSpec = specFromPopulation(design.population);
  const cbSpec = specFromPopulation(design.population, 'factor');

  for (let k = 0; k < count; k++) {
    const r = task.start + k;
    const continuous = generateData(pop, n, replicationSeed(design.seed, n, r));
    const complete = design.ordinal ? categorise(continuous, design.ordinal) : continuous;
    const miss = design.missing && design.missing.rate > 0 ? design.missing : null;
    const data = miss
      ? withMissing(complete, miss, replicationSeed(design.seed + 3, n, r))
      : complete;
    design.estimators.forEach((e, ei) => {
      try {
        if (e.method === 'pls') {
          const opts = {
            ...DEFAULT_OPTIONS,
            consistent: e.consistent,
            scheme: e.scheme ?? 'path',
            missing: miss?.pls ?? DEFAULT_OPTIONS.missing,
          };
          const spec = withMode(plsSpec, e.mode);
          const prep = preparePls(data, spec, opts);
          const { m, st, core, X } = prep.estimate(prep.cols);
          if (!core.converged) throw new Error('not converged');
          const validity = params.some((p) => p.kind === 'validity')
            ? validityValues({
                constructs: m.constructs,
                blocks: m.blocks,
                factor: m.constructs.map(
                  (name) => pop.factor[pop.constructs.indexOf(name)] ?? false,
                ),
                loadings: st.loadings,
                C: st.C,
                R: X.map((a) => X.map((b) => corStd(a, b))),
                r2: st.rSquared,
              })
            : null;
          params.forEach((p, pi) => {
            if (p.kind === 'fit') return;
            const i = ci(p.from),
              j = ci(p.to);
            if (p.kind === 'validity') {
              const v = validity?.get(p.key.slice('validity:'.length)) ?? NaN;
              est[ei][pi][k] = v;
              sig[ei][pi][k] = failsCutoff(p.rule!, v);
              return;
            }
            if (p.kind === 'reliability') {
              // (the estimated weights of the construct's indicators, in the population's order)
              const w = pop.blocks[i].map((x) => core.w[m.indicatorNames.indexOf(pop.names[x])]);
              est[ei][pi][k] = compositeReliability(pop, i, w);
              return;
            }
            let value: number;
            if (p.kind === 'path') value = st.pathCoef[i][j];
            else if (p.kind === 'covariance') value = st.C[i][j];
            else value = st.totalEffects[i][j] - st.pathCoef[i][j]; // (the indirect effect)
            est[ei][pi][k] = value;
          });
          if (design.bootSamples > 0) {
            const part = runRange({
              job: 'pls',
              data,
              spec,
              options: opts,
              seed: replicationSeed(design.seed + 1, n, r),
              start: 0,
              end: design.bootSamples,
              jackknife: inference.interval === 'bca',
            });
            const keys = part.params.map((x) => x.key);
            const flips =
              inference.signChange === 'construct'
                ? constructFlips(blocks, keys, part.originals, part.draws)
                : null;
            const cases = prep.cols[0].length;
            params.forEach((p, pi) => {
              const bi = keys.indexOf(p.key);
              if (p.kind === 'fit' || bi < 0) return;
              // (draws that failed are NaN in every parameter: dropped)
              const v = correctedDraws(
                part.draws[bi],
                part.originals[bi],
                inference.signChange,
                flips ? { from: flips.get(p.from)!, to: flips.get(p.to)! } : undefined,
              );
              const res = bootTests(
                v,
                part.originals[bi],
                design.alpha,
                cases,
                part.jack ? Array.from(part.jack[bi]) : undefined,
              );
              [lo[ei][pi][k], hi[ei][pi][k]] = res.ci[inference.interval];
              sig[ei][pi][k] = res.reject[inference.interval];
              for (const t of MC_TESTS) tests[t][ei][pi][k] = res.reject[t];
            });
          }
          // PLSc: the rule the bootstrap drops draws by (ρA in (0, 1], correlations within ±1).
          // PLS composites are always admissible.
          proper[ei][k] = e.consistent && plscProblems(m, st).problems.length ? 0 : 1;
        } else if (e.method === 'regression') {
          const fit = regressionFit(data, plsSpec, miss?.pls ?? 'mean', e.dr);
          const indirect = indirectOf(fit.paths);
          params.forEach((p, pi) => {
            if (p.kind === 'fit') return;
            const i = fit.constructs.indexOf(p.from),
              j = fit.constructs.indexOf(p.to);
            if (p.kind === 'validity') return;
            if (p.kind === 'reliability') {
              est[ei][pi][k] = unitReliability(pop, i);
            } else if (p.kind === 'covariance') {
              est[ei][pi][k] = fit.C[i][j];
            } else if (p.kind === 'indirect') {
              est[ei][pi][k] = indirect[i][j];
            } else {
              const b = fit.paths[i][j],
                s = fit.se[i][j],
                df = fit.df[j];
              const crit = tCrit(design.alpha, df);
              est[ei][pi][k] = b;
              lo[ei][pi][k] = b - crit * s;
              hi[ei][pi][k] = b + crit * s;
              sig[ei][pi][k] = tTestP(b / s, df) < design.alpha ? 1 : 0;
            }
          });
          proper[ei][k] = fit.admissible ? 1 : 0;
        } else {
          const cb = estimateCb(data, cbSpec, miss?.cb ?? 'casewise', e.estimator);
          if (!cb.converged) throw new Error('not converged');
          const mc =
            params.some((p) => p.kind === 'indirect') && design.mcDraws > 0
              ? mcIndirect(
                  cb,
                  design.mcDraws,
                  replicationSeed(design.seed + 2, n, r),
                  1 - design.alpha,
                )
              : [];
          params.forEach((p, pi) => {
            // (CB-SEM estimates no composites; the PLS checks are PLS's)
            if (p.kind === 'reliability' || p.kind === 'validity') return;
            if (p.kind === 'fit') {
              const index = MC_FIT_INDICES.find((f) => `fit:${f.id}` === p.key);
              if (index) {
                const v = fitIndex(cb.fit, index.id);
                est[ei][pi][k] = v;
                if (Number.isFinite(v)) sig[ei][pi][k] = poorFit(index, v) ? 1 : 0;
                return;
              }
              // Scaled statistic for robust estimators; ULS has no χ² p-value.
              const pv = cb.fit.pvalueScaled ?? cb.fit.pvalue;
              est[ei][pi][k] = cb.fit.chisqScaled ?? cb.fit.chisq;
              if (Number.isFinite(pv)) sig[ei][pi][k] = pv < design.alpha ? 1 : 0;
              return;
            }
            const i = cb.constructs.indexOf(p.from),
              j = cb.constructs.indexOf(p.to);
            if (p.kind === 'covariance') {
              const e2 = cb.estimates.find(
                (x) =>
                  x.op === '~~' &&
                  ((x.lhs === p.from && x.rhs === p.to) || (x.lhs === p.to && x.rhs === p.from)),
              );
              if (!e2) return;
              est[ei][pi][k] = e2.std;
              if (e2.se) {
                lo[ei][pi][k] = e2.est - zc * e2.se;
                hi[ei][pi][k] = e2.est + zc * e2.se;
                sig[ei][pi][k] = (e2.p ?? 1) < design.alpha ? 1 : 0;
              }
            } else if (p.kind === 'path') {
              est[ei][pi][k] = cb.stdPaths[i][j];
              const e2 = cb.estimates.find(
                (x) => x.op === '~' && x.lhs === p.to && x.rhs === p.from,
              );
              if (e2?.se) {
                lo[ei][pi][k] = e2.est - zc * e2.se;
                hi[ei][pi][k] = e2.est + zc * e2.se;
                sig[ei][pi][k] = (e2.p ?? 1) < design.alpha ? 1 : 0;
              }
            } else {
              est[ei][pi][k] = cb.stdIndirect[i][j];
              const m = mc.find((x) => x.from === p.from && x.to === p.to);
              if (m) {
                lo[ei][pi][k] = m.ciLow;
                hi[ei][pi][k] = m.ciHigh;
                sig[ei][pi][k] = m.ciLow > 0 || m.ciHigh < 0 ? 1 : 0;
              }
            }
          });
          proper[ei][k] = cb.warnings.some((w) => w.includes('Heywood')) ? 0 : 1;
        }
      } catch {
        // replication failed for this estimator: leave NaN
      }
    });
    onProgress?.(k + 1, count);
  }
  return { n, start: task.start, est, lo, hi, truthCI, sig, proper, tests };
}

export interface McSummaryRow {
  estimator: string;
  n: number;
  param: McParam;
  reps: number;
  failed: number;
  improper: number;
  mean: number;
  bias: number;
  relBias: number | null;
  sd: number;
  rmse: number;
  coverage: number | null;
  /** Mean confidence interval width, standardised (CB-SEM: the marker-metric width divided by ciScale). */
  width: number | null;
  /** Rejection rate: power if the true value ≠ 0, else Type I error. */
  rejection: number | null;
  /** The distribution of the estimates (one range per parameter, shared by all estimators and sample sizes). */
  hist?: McHistogram;
  /** Bootstrap estimators: the rejection rate of every test computed. */
  tests?: Partial<Record<McTest, number>>;
}

/** Counts of estimates in HIST_BINS equal bins over [lo, hi]; estimates outside the range counted apart. */
export interface McHistogram {
  lo: number;
  hi: number;
  counts: number[];
  below: number;
  above: number;
  /**
   * Kernel density of the estimates at DENSITY_POINTS evenly spaced points from lo to hi (Gaussian kernel,
   * R's default bandwidth bw.nrd0, as density() and ggplot2's geom_density draw it); absent in results saved
   * before it was added.
   */
  density?: number[];
}

const HIST_BINS = 40;
export const DENSITY_POINTS = 101;

/** R's bw.nrd0: 0.9 · min(SD, IQR / 1.34) · n^(−1/5), falling back as R does when that is 0. */
export function bandwidthNrd0(values: number[]): number {
  const n = values.length;
  const sorted = Float64Array.from(values).sort();
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const sd = n > 1 ? Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1)) : 0;
  const iqr = quantileSorted(sorted, 0.75) - quantileSorted(sorted, 0.25);
  let spread = Math.min(sd, iqr / 1.34);
  if (!(spread > 0)) spread = sd || Math.abs(values[0]) || 1;
  return 0.9 * spread * n ** -0.2;
}

/** Gaussian kernel density of the values at DENSITY_POINTS points from lo to hi. */
export function kernelDensity(values: number[], lo: number, hi: number): number[] {
  const h = bandwidthNrd0(values);
  const scale = 1 / (values.length * h * Math.sqrt(2 * Math.PI));
  return Array.from({ length: DENSITY_POINTS }, (_, i) => {
    const x = lo + ((hi - lo) * i) / (DENSITY_POINTS - 1);
    let s = 0;
    for (const v of values) s += Math.exp(-0.5 * ((x - v) / h) ** 2);
    return s * scale;
  });
}

/**
 * The histogram range of each parameter: the 0.5th to 99.5th percentile of all its estimates (every
 * estimator and sample size), widened to include the true value. Extreme estimates (an inadmissible PLSc
 * solution) would otherwise squeeze the rest into a few bins.
 */
function histRanges(params: McParam[], parts: McPart[]): { lo: number; hi: number }[] {
  return params.map((param, pi) => {
    const all: number[] = [];
    for (const part of parts)
      for (const perParam of part.est)
        for (const v of perParam[pi]) if (Number.isFinite(v)) all.push(v);
    if (!all.length) return { lo: NaN, hi: NaN };
    all.sort((a, b) => a - b);
    const at = (q: number) => all[Math.min(all.length - 1, Math.floor(q * all.length))];
    let lo = Math.min(at(0.005), param.kind === 'fit' ? Infinity : param.value);
    let hi = Math.max(at(0.995), param.kind === 'fit' ? -Infinity : param.value);
    if (hi - lo < 1e-9) {
      lo -= 0.05;
      hi += 0.05;
    }
    return { lo, hi };
  });
}

function histogram(values: number[], range: { lo: number; hi: number }): McHistogram | undefined {
  if (!Number.isFinite(range.lo)) return undefined;
  const counts = new Array<number>(HIST_BINS).fill(0);
  let below = 0;
  let above = 0;
  const width = (range.hi - range.lo) / HIST_BINS;
  for (const v of values) {
    if (v < range.lo) below++;
    else if (v > range.hi) above++;
    else counts[Math.min(HIST_BINS - 1, Math.floor((v - range.lo) / width))]++;
  }
  const density = values.length > 1 ? kernelDensity(values, range.lo, range.hi) : undefined;
  return { lo: range.lo, hi: range.hi, counts, below, above, ...(density ? { density } : {}) };
}

export function summariseMc(design: McDesign, parts: McPart[]): McSummaryRow[] {
  const pop = buildPopulation(design.population);
  const params = designParameters(design, pop);
  const scale = ciScale(design, pop, params);
  const ranges = histRanges(params, parts);
  const rows: McSummaryRow[] = [];
  for (const n of design.sampleSizes) {
    const ps = parts.filter((p) => p.n === n).sort((a, b) => a.start - b.start);
    if (ps.length === 0) continue;
    design.estimators.forEach((e, ei) => {
      params.forEach((param, pi) => {
        const ests: number[] = [],
          cover: number[] = [],
          widths: number[] = [],
          rej: number[] = [];
        const byTest = new Map<McTest, number[]>();
        let failed = 0,
          improper = 0;
        for (const part of ps) {
          const len = part.est[ei][pi].length;
          for (let k = 0; k < len; k++) {
            const v = part.est[ei][pi][k];
            if (!Number.isFinite(v)) {
              failed++;
              continue;
            }
            if (part.proper[ei][k] === 0) improper++;
            ests.push(v);
            const l = part.lo[ei][pi][k],
              h = part.hi[ei][pi][k];
            const truth = part.truthCI[ei][pi];
            if (Number.isFinite(l) && Number.isFinite(h)) {
              cover.push(l <= truth && truth <= h ? 1 : 0);
              widths.push((h - l) / Math.abs(scale[ei][pi]));
            }
            const sg = part.sig[ei][pi][k];
            if (Number.isFinite(sg)) rej.push(sg);
            for (const t of MC_TESTS) {
              const x = part.tests?.[t]?.[ei]?.[pi]?.[k];
              if (x === undefined || !Number.isFinite(x)) continue;
              if (!byTest.has(t)) byTest.set(t, []);
              byTest.get(t)!.push(x);
            }
          }
        }
        const R = ests.length;
        if (param.kind === 'fit' && e.method !== 'cb') return;
        if (param.kind === 'reliability' && e.method === 'cb') return;
        if (param.kind === 'validity' && e.method !== 'pls') return;
        const mean = R ? ests.reduce((s, x) => s + x, 0) / R : NaN;
        const sd = R > 1 ? Math.sqrt(ests.reduce((s, x) => s + (x - mean) ** 2, 0) / (R - 1)) : NaN;
        let rmse = NaN;
        if (param.kind !== 'fit' && R)
          rmse = Math.sqrt(ests.reduce((s, x) => s + (x - param.value) ** 2, 0) / R);
        rows.push({
          estimator: e.id,
          n,
          param,
          reps: R,
          failed,
          improper,
          mean,
          // For the χ² test row, `mean` is the mean statistic; bias is not meaningful.
          bias: param.kind === 'fit' ? NaN : mean - param.value,
          relBias:
            param.kind !== 'fit' && Math.abs(param.value) > 1e-12
              ? (mean - param.value) / param.value
              : null,
          sd,
          rmse,
          coverage: cover.length ? cover.reduce((s, x) => s + x, 0) / cover.length : null,
          width: widths.length ? widths.reduce((s, x) => s + x, 0) / widths.length : null,
          rejection: rej.length ? rej.reduce((s, x) => s + x, 0) / rej.length : null,
          hist: histogram(ests, ranges[pi]),
          ...(byTest.size
            ? {
                tests: Object.fromEntries(
                  [...byTest].map(([t, xs]) => [t, xs.reduce((a, b) => a + b, 0) / xs.length]),
                ),
              }
            : {}),
        });
      });
    });
  }
  return rows;
}

/** Tasks: every sample size split into `chunks` replication ranges. */
export function mcTasks(design: McDesign, chunks: number): McTask[] {
  const out: McTask[] = [];
  for (const n of design.sampleSizes) {
    const k = Math.max(1, Math.min(chunks, design.replications));
    for (let i = 0; i < k; i++) {
      const start = Math.floor((i * design.replications) / k),
        end = Math.floor(((i + 1) * design.replications) / k);
      if (end > start) out.push({ design, n, start, end });
    }
  }
  return out;
}
