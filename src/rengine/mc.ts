// Monte Carlo simulation by the R packages: lavaan::simulateData generates the
// data from the population covariance matrix; cSEM and lavaan estimate. The
// app computes the population (Σ, true values) and the per-replication seeds,
// and summarises the per-replication results exactly as for the built-in engine.

import { blockMoments, buildPopulation, specFromPopulation } from '../engine/population';
import {
  ciTruth,
  designParameters,
  ordinalThresholds,
  replicationSeed,
  type McDesign,
  type McPart,
} from '../engine/montecarlo';
import { MC_FIT_INDICES } from '../engine/mcFitIndices';
import { MC_VALIDITY_RULES } from '../engine/mcValidity';
import { DEFAULT_INFERENCE, MC_TESTS } from '../engine/mcInference';
import { rCallOn, rScript } from './bridge';
import { rList } from './rjson';

const rSeed = (s: number) => s % 2147483647;

export function mcRequest(design: McDesign, reps: { n: number; rep: number }[]) {
  const pop = buildPopulation(design.population);
  const params = designParameters(design, pop);
  const perIndicator = (f: (c: McDesign['population']['constructs'][number]) => number) =>
    design.population.constructs.flatMap((c) => c.indicators.map(() => f(c)));
  return {
    spec: specFromPopulation(design.population),
    population: {
      names: pop.names,
      Sigma: pop.Sigma,
      skew: perIndicator((c) => c.skew ?? design.population.skew ?? 0),
      kurtosis: perIndicator((c) => c.kurtosis ?? design.population.kurtosis ?? 0),
    },
    estimators: design.estimators,
    params: params.map((p) => {
      // A fit index: its cutoff, so R applies the same rule (cutoff NA: not an index).
      const index = MC_FIT_INDICES.find((f) => `fit:${f.id}` === p.key);
      return {
        kind: p.kind,
        from: p.from,
        to: p.to,
        value: p.value,
        index: index?.id ?? '',
        // (a PLS measurement check: its rule and cutoff, applied the same way)
        rule: p.rule ?? '',
        cutoff: index?.cutoff ?? (p.rule ? MC_VALIDITY_RULES[p.rule].cutoff : null),
        poorBelow: index?.poorBelow ?? (p.rule ? MC_VALIDITY_RULES[p.rule].poorBelow : false),
        // A composite reliability: its block's population moments (population.ts compositeReliability)
        ...(p.kind === 'reliability' ? blockMoments(pop, pop.constructs.indexOf(p.from)) : {}),
      };
    }),
    alpha: design.alpha,
    bootSamples: design.bootSamples,
    mcDraws: design.mcDraws,
    // R's set.seed takes a signed 32-bit integer.
    seeds: reps.map(({ n, rep }) => ({
      n,
      rep,
      data: rSeed(replicationSeed(design.seed, n, rep)),
      boot: rSeed(replicationSeed(design.seed + 1, n, rep)),
      mc: rSeed(replicationSeed(design.seed + 2, n, rep)),
      miss: rSeed(replicationSeed(design.seed + 3, n, rep)),
    })),
    inference: design.inference ?? DEFAULT_INFERENCE,
    ...(design.missing && design.missing.rate > 0 ? { nonresponse: design.missing } : {}),
    ...(design.ordinal ? { ordinal: { thresholds: ordinalThresholds(design.ordinal) } } : {}),
  };
}

// (rList: a chunk of one replication arrives as a scalar, not a one-element vector)
const f64 = (v: unknown) =>
  Float64Array.from(rList<unknown>(v).map((x) => (typeof x === 'number' ? x : NaN)));

/** The request for replications start..end-1 at sample size n. */
/**
 * Replications per R call, 1 to 10 (small enough for prompt progress and cancelling): the size whose last
 * round leaves the fewest sessions idle, i.e. the fewest replications on the busiest session, the largest such
 * size. A fixed 10 left the last of five rounds of a 500-replication run on 11 sessions half empty.
 */
export function mcChunkSize(design: McDesign, sessions: number): number {
  const k = Math.max(1, sessions);
  let best = 10;
  let bestSpan = Infinity;
  for (let size = 10; size >= 1; size--) {
    const calls = design.sampleSizes.length * Math.ceil(design.replications / size);
    const span = Math.ceil(calls / k) * size;
    if (span < bestSpan) {
      best = size;
      bestSpan = span;
    }
  }
  return best;
}

export const mcChunkRequest = (design: McDesign, n: number, start: number, end: number) =>
  mcRequest(
    design,
    Array.from({ length: end - start }, (_, k) => ({ n, rep: start + k })),
  );

/**
 * Replications start..end-1 at sample size n, as an McPart for summariseMc, in
 * R session `session` (every replication has its own seeds, so the results do
 * not depend on which session runs it).
 */
export async function runMcChunkR(
  design: McDesign,
  n: number,
  start: number,
  end: number,
  session = 0,
): Promise<McPart> {
  return parseMcChunk(
    design,
    n,
    start,
    await rCallOn<Record<string, any>>(
      session,
      'ps_mc',
      mcChunkRequest(design, n, start, end),
      'simulation',
    ),
  );
}

/** ps_mc's answer for a chunk as an McPart. */
export function parseMcChunk(
  design: McDesign,
  n: number,
  start: number,
  raw: Record<string, unknown>,
): McPart {
  const pop = buildPopulation(design.population);
  const params = designParameters(design, pop);
  // CB-SEM CIs are in the unstandardised (marker) metric: β · λ_mk(to) / λ_mk(from).
  const truthCI = ciTruth(design, pop, params);
  const arr = (x: unknown) => rList<unknown>(x).map((perE) => rList<unknown>(perE).map(f64));
  return {
    n,
    start,
    est: arr(raw.est),
    lo: arr(raw.lo),
    hi: arr(raw.hi),
    sig: arr(raw.sig),
    truthCI,
    proper: rList<unknown>(raw.proper).map(f64),
    // (one entry per test, in MC_TESTS order; absent from an older helper's answer)
    ...(raw.tests === undefined
      ? {}
      : {
          tests: Object.fromEntries(
            rList<unknown>(raw.tests).map((perTest, ti) => [MC_TESTS[ti], arr(perTest)]),
          ),
        }),
  };
}

/** The whole simulation as one R script (all sample sizes and replications). */
export function mcScriptR(design: McDesign): Promise<string> {
  const reps = design.sampleSizes.flatMap((n) =>
    Array.from({ length: design.replications }, (_, r) => ({ n, rep: r })),
  );
  return rScript('ps_mc', mcRequest(design, reps), 'simulation');
}
