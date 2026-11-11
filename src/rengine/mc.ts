// Monte Carlo simulation by the R packages: lavaan::simulateData generates the
// data from the population covariance matrix; cSEM and lavaan estimate. The
// app computes the population (Σ, true values) and the per-replication seeds,
// and summarises the per-replication results exactly as for the built-in engine.

import { buildPopulation, specFromPopulation } from '../engine/population';
import {
  ciTruth,
  mcParameters,
  replicationSeed,
  type McDesign,
  type McPart,
} from '../engine/montecarlo';
import { rCallOn, rScript } from './bridge';

const rSeed = (s: number) => s % 2147483647;

export function mcRequest(design: McDesign, reps: { n: number; rep: number }[]) {
  const pop = buildPopulation(design.population);
  const params = mcParameters(
    pop,
    design.estimators.some((e) => e.method === 'cb'),
  );
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
    params: params.map((p) => ({ kind: p.kind, from: p.from, to: p.to, value: p.value })),
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
    })),
  };
}

const f64 = (v: unknown) =>
  Float64Array.from((v as (number | null)[]).map((x) => (typeof x === 'number' ? x : NaN)));

/** The request for replications start..end-1 at sample size n. */
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
  const params = mcParameters(
    pop,
    design.estimators.some((e) => e.method === 'cb'),
  );
  // CB-SEM CIs are in the unstandardised (marker) metric: β · λ_mk(to) / λ_mk(from).
  const truthCI = ciTruth(design, pop, params);
  const arr = (x: unknown) => (x as unknown[][]).map((perE) => perE.map(f64));
  return {
    n,
    start,
    est: arr(raw.est),
    lo: arr(raw.lo),
    hi: arr(raw.hi),
    sig: arr(raw.sig),
    truthCI,
    proper: (raw.proper as unknown[]).map(f64),
  };
}

/** The whole simulation as one R script (all sample sizes and replications). */
export function mcScriptR(design: McDesign): Promise<string> {
  const reps = design.sampleSizes.flatMap((n) =>
    Array.from({ length: design.replications }, (_, r) => ({ n, rep: r })),
  );
  return rScript('ps_mc', mcRequest(design, reps), 'simulation');
}
