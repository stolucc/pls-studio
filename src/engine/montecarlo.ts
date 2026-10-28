// Monte Carlo simulation studies: power / sample-size planning and estimator
// comparisons. Data are drawn from a population model (population.ts); every
// replication is estimated by each requested estimator, and per parameter we
// report mean estimate, bias, relative bias, empirical SD, RMSE, CI coverage
// and power (rejection rate; the Type I error rate when the true value is 0).
//
// Replications are split into ranges for parallel workers. Replication r at
// sample size n always uses the same seed, so results do not depend on how
// the work was split.

import { mergeBootstrap, runRange, sampleSeed } from './bootstrap';
import { estimateCb, type CbEstimator } from './cbsem';
import { mcIndirect } from './mcci';
import { preparePls } from './pls';
import { buildPopulation, generateData, specFromPopulation, type Population, type PopulationSpec } from './population';
import { zCrit } from './stats';
import { DEFAULT_OPTIONS } from './types';

export type McEstimator =
  | { id: string; method: 'pls'; consistent: boolean }
  | { id: string; method: 'cb'; estimator: CbEstimator };

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
}

export interface McParam {
  key: string;
  /** 'fit': the CB-SEM model χ² test (its rejection rate is the test's Type I error). */
  kind: 'path' | 'indirect' | 'fit';
  from: string;
  to: string;
  /** True standardised value. */
  value: number;
}

export interface McTask { design: McDesign; n: number; start: number; end: number }

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
}

export function mcParameters(pop: Population, withFit = false): McParam[] {
  const C = pop.constructs;
  const out: McParam[] = [];
  if (withFit) out.push({ key: 'fit:chisq', kind: 'fit', from: 'model', to: 'χ² test', value: 0 });
  C.forEach((f, i) => C.forEach((t, j) => {
    if (pop.specified[i][j]) out.push({ key: `path:${f}:${t}`, kind: 'path', from: f, to: t, value: pop.paths[i][j] });
  }));
  C.forEach((f, i) => C.forEach((t, j) => {
    if (Math.abs(pop.indirect[i][j]) > 1e-12) out.push({ key: `indirect:${f}:${t}`, kind: 'indirect', from: f, to: t, value: pop.indirect[i][j] });
  }));
  return out;
}

export const replicationSeed = (seed: number, n: number, r: number) => sampleSeed(seed, ((n * 100003) ^ r) >>> 0);

export function runMcTask(task: McTask, onProgress?: (done: number, total: number) => void): McPart {
  const { design, n } = task;
  const pop = buildPopulation(design.population);
  const params = mcParameters(pop, design.estimators.some((e) => e.method === 'cb'));
  const E = design.estimators.length, count = Math.max(0, task.end - task.start);
  const arr = () => Array.from({ length: E }, () => params.map(() => new Float64Array(count).fill(NaN)));
  const est = arr(), lo = arr(), hi = arr(), sig = arr();
  const proper = Array.from({ length: E }, () => new Float64Array(count).fill(NaN));
  const C = pop.constructs;
  const ci = (name: string) => C.indexOf(name);
  // CB-SEM CIs are for unstandardised effects in the marker metric: β · λ_mk(to) / λ_mk(from).
  const truthCI = design.estimators.map((e) => params.map((p) => (p.kind === 'fit' ? NaN : e.method === 'cb' ? p.value * pop.markerLoading[ci(p.to)] / pop.markerLoading[ci(p.from)] : p.value)));
  const zc = zCrit(design.alpha);
  const plsSpec = specFromPopulation(design.population);
  const cbSpec = specFromPopulation(design.population, 'factor');

  for (let k = 0; k < count; k++) {
    const r = task.start + k;
    const data = generateData(pop, n, replicationSeed(design.seed, n, r));
    design.estimators.forEach((e, ei) => {
      try {
        if (e.method === 'pls') {
          const opts = { ...DEFAULT_OPTIONS, consistent: e.consistent };
          if (design.bootSamples > 0) {
            const boot = mergeBootstrap([runRange({ job: 'pls', data, spec: plsSpec, options: opts, seed: replicationSeed(design.seed + 1, n, r), start: 0, end: design.bootSamples })], 1 - design.alpha);
            params.forEach((p, pi) => {
              if (p.kind === 'fit') return;
              const s = boot.stats.find((x) => x.key === p.key);
              if (!s) return;
              est[ei][pi][k] = s.original;
              lo[ei][pi][k] = s.ciLow;
              hi[ei][pi][k] = s.ciHigh;
              sig[ei][pi][k] = s.p < design.alpha ? 1 : 0;
            });
          } else {
            const prep = preparePls(data, plsSpec, opts);
            const { st, core } = prep.estimate(prep.cols);
            if (!core.converged) throw new Error('not converged');
            params.forEach((p, pi) => {
              if (p.kind === 'fit') return;
              const i = ci(p.from), j = ci(p.to);
              est[ei][pi][k] = p.kind === 'path' ? st.pathCoef[i][j] : st.totalEffects[i][j] - st.pathCoef[i][j];
            });
          }
          proper[ei][k] = 1;
        } else {
          const cb = estimateCb(data, cbSpec, 'casewise', e.estimator);
          if (!cb.converged) throw new Error('not converged');
          const mc = params.some((p) => p.kind === 'indirect') && design.mcDraws > 0
            ? mcIndirect(cb, design.mcDraws, replicationSeed(design.seed + 2, n, r), 1 - design.alpha) : [];
          params.forEach((p, pi) => {
            if (p.kind === 'fit') {
              // Scaled statistic for robust estimators; ULS has no χ² p-value.
              const pv = cb.fit.pvalueScaled ?? cb.fit.pvalue;
              est[ei][pi][k] = cb.fit.chisqScaled ?? cb.fit.chisq;
              if (Number.isFinite(pv)) sig[ei][pi][k] = pv < design.alpha ? 1 : 0;
              return;
            }
            const i = cb.constructs.indexOf(p.from), j = cb.constructs.indexOf(p.to);
            if (p.kind === 'path') {
              est[ei][pi][k] = cb.stdPaths[i][j];
              const e2 = cb.estimates.find((x) => x.op === '~' && x.lhs === p.to && x.rhs === p.from);
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
  return { n, start: task.start, est, lo, hi, truthCI, sig, proper };
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
  /** Rejection rate: power if the true value ≠ 0, else Type I error. */
  rejection: number | null;
}

export function summariseMc(design: McDesign, parts: McPart[]): McSummaryRow[] {
  const pop = buildPopulation(design.population);
  const params = mcParameters(pop, design.estimators.some((e) => e.method === 'cb'));
  const rows: McSummaryRow[] = [];
  for (const n of design.sampleSizes) {
    const ps = parts.filter((p) => p.n === n).sort((a, b) => a.start - b.start);
    if (ps.length === 0) continue;
    design.estimators.forEach((e, ei) => {
      params.forEach((param, pi) => {
        const ests: number[] = [], cover: number[] = [], rej: number[] = [];
        let failed = 0, improper = 0;
        for (const part of ps) {
          const len = part.est[ei][pi].length;
          for (let k = 0; k < len; k++) {
            const v = part.est[ei][pi][k];
            if (!Number.isFinite(v)) { failed++; continue; }
            if (part.proper[ei][k] === 0) improper++;
            ests.push(v);
            const l = part.lo[ei][pi][k], h = part.hi[ei][pi][k];
            const truth = part.truthCI[ei][pi];
            if (Number.isFinite(l) && Number.isFinite(h)) cover.push(l <= truth && truth <= h ? 1 : 0);
            const sg = part.sig[ei][pi][k];
            if (Number.isFinite(sg)) rej.push(sg);
          }
        }
        const R = ests.length;
        if (param.kind === 'fit' && e.method !== 'cb') return;
        const mean = R ? ests.reduce((s, x) => s + x, 0) / R : NaN;
        const sd = R > 1 ? Math.sqrt(ests.reduce((s, x) => s + (x - mean) ** 2, 0) / (R - 1)) : NaN;
        const rmse = param.kind === 'fit' ? NaN : R ? Math.sqrt(ests.reduce((s, x) => s + (x - param.value) ** 2, 0) / R) : NaN;
        rows.push({
          estimator: e.id, n, param, reps: R, failed, improper, mean,
          // For the χ² test row, `mean` is the mean statistic; bias is not meaningful.
          bias: param.kind === 'fit' ? NaN : mean - param.value,
          relBias: param.kind !== 'fit' && Math.abs(param.value) > 1e-12 ? (mean - param.value) / param.value : null,
          sd, rmse,
          coverage: cover.length ? cover.reduce((s, x) => s + x, 0) / cover.length : null,
          rejection: rej.length ? rej.reduce((s, x) => s + x, 0) / rej.length : null,
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
      const start = Math.floor((i * design.replications) / k), end = Math.floor(((i + 1) * design.replications) / k);
      if (end > start) out.push({ design, n, start, end });
    }
  }
  return out;
}
