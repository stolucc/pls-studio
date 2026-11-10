import { mergeBootstrap, mergeFitTest, splitRanges, STUDENTIZED_INNER, type BootJobKind, type RangePart } from './engine/bootstrap';
import type { CbEstimator, CbResult } from './engine/cbsem';
import type { McDesign, McPart, McSummaryRow } from './engine/montecarlo';
import type { PlsOptions } from './engine/types';
import { toSpec, validateModel } from './model/project';
import { processGraph } from './process/fromModel';
import { indirectPaths as processPlanPaths } from './process/plan';
import { processInput } from './process/input';
import { resultsKey, useStore, type JobKind } from './store';
import type { WorkerRequest, WorkerResponse } from './worker';

let pool: Worker[] = [];
/** Every result on screen is logged as a model run on the Analyses tab (a new version, or the current one's card). */
const logged = () => { void import('./analyses/runs').then((m) => m.logCurrentRun()); };
/** Incremented to discard the result of an R calculation that was cancelled or superseded. */
let rToken = 0;

/** Bootstrap workers: one per logical core, leaving one for the UI, at most 16. */
export function workerCount(): number {
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 2 : 2;
  return Math.max(1, Math.min(16, cores - 1));
}

function spawn(): Worker {
  const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  pool.push(w);
  return w;
}

function terminateAll() {
  pool.forEach((w) => w.terminate());
  pool = [];
}

export function cancelJob() {
  terminateAll();
  if (useStore.getState().job?.label) void import('./rengine/runtime').then((m) => m.interruptR());
  rToken++;
  useStore.getState().setJob(null);
  useStore.getState().toast('info', 'Calculation cancelled.');
}

function cbToast(r: CbResult, by: string) {
  const st = useStore.getState();
  const f = r.fit;
  if (r.warnings.length) st.toast('error', `${by}: ${r.warnings.length === 1 ? r.warnings[0] : `${r.warnings.length} warnings`} (see Messages in the results panel).`, { log: false });
  else if (!r.converged) st.toast('error', `${by}: ${r.estimator} did not converge in ${r.iterations} iterations. Interpret results with care.`);
  else st.toast('success', `${by}: ${r.estimator} converged in ${r.iterations} iterations. χ²(${f.df}) = ${(f.chisqScaled ?? f.chisq).toFixed(2)}${f.chisqScaled !== undefined ? ' (scaled)' : ''}.`);
}

/**
 * The R engine: every job is one call into the reference package (webR is
 * single-threaded; the packages resample internally). Results are discarded
 * if the job was cancelled (which also interrupts R).
 */
function runR(kind: JobKind, key: string) {
  const s = useStore.getState();
  const st = s.settings;
  const cb = st.method === 'cbsem';
  const data = s.data!;
  const spec = toSpec(s.model);
  const options: PlsOptions = { scheme: st.scheme, maxIter: st.maxIter, tolerance: 10 ** -st.stopExp, missing: st.missing, consistent: st.consistent, approach: st.plsApproach, hocApproach: st.hocApproach, mi: { m: st.miImputations, seed: st.seed } };
  const boot = { samples: Math.max(2, Math.floor(st.bootSamples)), seed: st.seed, confidence: st.confidence, tails: st.bootTails === 'one' ? 1 as const : 2 as const, interval: st.bootInterval === 'bca' ? 'bca' as const : 'percentile' as const };
  const token = ++rToken;
  const modsem = cb && st.interaction !== 'product' && s.model.moderations.length > 0;
  const pkg = cb ? (st.estimator === '2SLS' ? 'MIIVsem' : modsem ? 'modsem' : 'lavaan') : kind === 'fittest' ? 'cSEM' : st.plsPackage;
  const what = kind === 'estimate' ? 'Estimating' : kind === 'fittest' ? `Fit test (${boot.samples} samples)` : `Bootstrapping ${boot.samples} samples`;
  s.setJob({ kind, done: 0, total: 1, workers: 1, label: `${what} with ${pkg}…` });
  const done = () => { if (token !== rToken) return null; const t = useStore.getState(); t.setJob(null); return t; };
  const failed = (e: unknown) => {
    if (token !== rToken) return;
    import('./rengine/bridge').then(({ rMessage }) => fail(`${pkg}: ${rMessage(e)}`));
  };
  const fail = (m: string) => { useStore.getState().setJob(null); useStore.getState().toast('error', m); };
  const version = () => Promise.all([import('./rengine/status'), import('./rengine/bridge')]).then(([{ useR }, { computeLocation }]) => {
    const at = computeLocation(pkg);
    return at.where === 'desktop' ? at.version : useR.getState().versions[pkg] ?? '';
  });

  if (kind === 'estimate') {
    if (cb && st.estimator === '2SLS') {
      import('./rengine/analyses').then(({ miivR }) => miivR(data, spec, st.missing)).then((r) => {
        const t = done(); if (!t) return;
        t.setResults({ miiv: r }, key); logged();
        const rejected = r.equations.filter((e) => e.sarganP !== null && e.sarganP < 0.05).length;
        t.toast('success', `MIIVsem ${r.engine.version}: ${r.equations.length} equations estimated${rejected ? `; ${rejected} Sargan test${rejected > 1 ? 's' : ''} significant at .05` : ''}.`);
      }).catch(failed);
    } else if (cb) {
      import('./rengine/lavaan').then(({ estimateCbLavaan }) => estimateCbLavaan(data, spec, st.missing, st.estimator as CbEstimator, st.interaction, { m: st.miImputations, seed: st.seed, method: st.miMethod, auxiliary: st.miAuxiliary, nominal: st.miNominal })).then((r) => {
        const t = done(); if (!t) return;
        t.setResults({ cb: r }, key); logged();
        cbToast(r, `lavaan ${r.engine.version}`);
      }).catch(failed);
    } else {
      import('./rengine/pls').then(({ estimatePlsR }) => estimatePlsR(data, spec, options, st.plsPackage)).then((r) => {
        const t = done(); if (!t) return;
        t.setResults({ pls: r }, key); logged();
        const by = `${r.engine.package} ${r.engine.version}`;
        if (!r.converged) t.toast('error', `${by}: did not converge in ${r.iterations} iterations. Interpret results with care.`);
        else if (r.warnings.length) t.toast('error', `${by}: ${r.warnings.length === 1 ? r.warnings[0] : `${r.warnings.length} warnings`} (see Messages in the results panel).`, { log: false });
        else t.toast('success', `${by}: ${r.ordinal?.length ? 'Ord' : ''}${r.consistent ? 'PLSc' : 'PLS'} converged in ${r.iterations} iterations.`);
      }).catch(failed);
    }
    return;
  }
  if (cb && st.estimator === '2SLS') { fail('Bootstrapping is not available for MIIV-2SLS; its standard errors and Sargan tests are analytic.'); return; }
  if (kind === 'fittest') {
    import('./rengine/analyses').then(({ fitTestR }) => fitTestR(data, spec, options, boot)).then((r) => {
      const t = done(); if (!t) return;
      t.setResults({ fitTest: r }, key); logged();
      t.toast('success', `cSEM fit test: ${r.samples - r.failed} of ${r.samples} bootstrap samples admissible.`);
    }).catch(failed);
    return;
  }
  // Parallel option: progress per chunk of samples, over the R sessions.
  const progress = (d: number, total: number) => {
    if (token !== rToken) return;
    import('./rengine/bridge').then(async ({ parallelism }) => {
      const p = await parallelism();
      const n = Math.min(p.sessions, total);
      if (token === rToken) useStore.getState().setJob({ kind, done: d, total, workers: n, label: `${what} with ${pkg} in ${n} parallel ${p.where === 'desktop' ? 'desktop R processes' : 'R sessions'} (${d} of ${total} chunks)…` });
    });
  };
  Promise.all([import('./rengine/analyses'), version()]).then(([{ bootstrapR }, v]) => bootstrapR(data, spec,
    cb ? { kind: 'cbBoot', estimator: st.estimator as CbEstimator, missing: st.missing, boot, interaction: st.interaction } : { kind: 'plsBoot', pkg: st.plsPackage, options, boot }, () => v, progress))
    .then((r) => {
      const t = done(); if (!t) return;
      t.setResults({ boot: { ...r, seed: boot.seed } }, key); logged();
      // Multiple groups / levels: show the bootstrap of the group on screen.
      const gi = useStore.getState().results?.cb?.groupIndex;
      if (gi) useStore.getState().showGroup(gi);
      t.toast('success', `${r.engine.package}: ${r.samples - r.failed} of ${r.samples} bootstrap samples used${r.failed ? ` (${r.failed} not admissible or failed)` : ''}.`);
    }).catch(failed);
}

/**
 * Conditional process analysis: always manymome in R (no built-in engine). One
 * job fits the regressions and bootstraps the indirect effects.
 */
function runProcess(key: string) {
  const s = useStore.getState();
  const input = processInput(s.model, s.settings, s.data);
  const recognised = processGraph(s.model).recognised;
  if (!input || !s.data) return;
  const token = ++rToken;
  const paths = processPlanPaths(input.graph).length;
  s.setJob({ kind: 'estimate', done: 0, total: 1, workers: 1, label: paths ? `Regressions and ${input.boot.samples} bootstrap samples with manymome…` : 'Regressions with manymome…' });
  const data = s.data;
  import('./rengine/cpa').then(({ estimateCpaR }) => estimateCpaR(data, input)).then((r) => {
    if (token !== rToken) return;
    const t = useStore.getState();
    t.setJob(null);
    t.setResults({ process: r }, key); logged();
    const name = recognised ? `PROCESS model ${recognised.model}` : 'Custom model';
    if (r.warnings.length) t.toast('error', `${r.engine.package}: ${r.warnings.length === 1 ? r.warnings[0] : `${r.warnings.length} warnings`} (see Messages in the results panel).`, { log: false });
    else t.toast('success', `manymome ${r.engine.version}: ${name} estimated (n = ${r.n}).`);
  }).catch((e) => {
    if (token !== rToken) return;
    import('./rengine/bridge').then(({ rMessage }) => { useStore.getState().setJob(null); useStore.getState().toast('error', `manymome: ${rMessage(e)}`); });
  });
}

/** Measurement invariance across groups: the model at each level, with difference tests (lavaan). */
export function runInvariance() {
  const s = useStore.getState();
  if (s.job || !s.data || !s.model.multigroup) return;
  const errors = validateModel(s.model, s.data, s.settings).filter((i) => i.level === 'error');
  if (errors.length) { s.toast('error', errors[0].message); return; }
  const key = resultsKey(s);
  const token = ++rToken;
  const st = s.settings;
  s.setJob({ kind: 'estimate', done: 0, total: 1, workers: 1, label: 'Measurement invariance: four models with lavaan…' });
  const data = s.data, spec = toSpec(s.model);
  import('./rengine/lavaan').then(({ invarianceR }) => invarianceR(data, spec, st.missing, st.estimator as CbEstimator)).then((r) => {
    if (token !== rToken) return;
    const t = useStore.getState();
    t.setJob(null);
    t.setResults({ invariance: r }, key); logged();
    t.toast('success', 'Measurement invariance: configural, metric, scalar and strict models compared.');
  }).catch((e) => {
    if (token !== rToken) return;
    import('./rengine/bridge').then(({ rMessage }) => { useStore.getState().setJob(null); useStore.getState().toast('error', `lavaan: ${rMessage(e)}`); });
  });
}

/** Run an estimation job for the current method: point estimates, bootstrap, or the PLS fit test. */
export function run(kind: JobKind) {
  const s = useStore.getState();
  if (s.job) return;
  const cb = s.settings.method === 'cbsem';
  if (cb && kind === 'fittest') return;
  const errors = validateModel(s.model, s.data, s.settings).filter((i) => i.level === 'error');
  if (errors.length > 0 || !s.data) {
    s.toast('error', errors[0]?.message ?? 'Import a dataset first.');
    if (errors[0]?.constructId) s.select('construct', errors[0].constructId);
    return;
  }
  const key = resultsKey(s);
  if (s.settings.method === 'process') { if (kind === 'estimate') runProcess(key); return; }
  const options: PlsOptions = {
    scheme: s.settings.scheme,
    maxIter: s.settings.maxIter,
    tolerance: 10 ** -s.settings.stopExp,
    missing: s.settings.missing,
    consistent: s.settings.consistent,
    approach: s.settings.plsApproach,
    hocApproach: s.settings.hocApproach,
  };
  const spec = toSpec(s.model);
  const data = s.data;
  terminateAll();

  const fail = (message: string) => {
    terminateAll();
    useStore.getState().setJob(null);
    useStore.getState().toast('error', message);
  };

  // cSEM and seminr have no copula term, and each bootstrap sample must recompute it: the built-in engine does.
  // Neither package takes sampling weights: weighted PLS (WPLS) is the built-in engine's.
  // Studentized intervals (an inner bootstrap per sample) run in its workers too.
  const studentized = s.settings.method === 'pls' && kind === 'boot' && s.settings.bootInterval === 'studentized';
  const builtInTerms = !cb && s.settings.method === 'pls' && !!(spec.copulas?.length || spec.threeWay?.length || spec.weights || spec.constructs.some((c) => c.predefinedWeights));
  if (studentized && spec.ordered?.length) { fail('Studentized intervals run in the built-in engine, which has no ordinal PLS (OrdPLS): choose percentile or BCa intervals (cSEM).'); return; }
  if (s.settings.engine === 'r' && !builtInTerms && !studentized) { runR(kind, key); return; }

  if (kind === 'estimate') {
    const w = spawn();
    s.setJob({ kind, done: 0, total: 1, workers: 1 });
    w.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      if (msg.kind === 'progress') return;
      terminateAll();
      const st = useStore.getState();
      st.setJob(null);
      if (msg.kind === 'error') st.toast('error', msg.message);
      else if (msg.kind === 'pls') {
        st.setResults({ pls: msg.result }, key); logged();
        if (!msg.result.converged) st.toast('error', `Did not converge in ${msg.result.iterations} iterations. Interpret results with care.`);
        else st.toast('success', `${msg.result.consistent ? 'PLSc' : 'PLS'} algorithm converged in ${msg.result.iterations} iterations.`);
      } else if (msg.kind === 'miiv') {
        st.setResults({ miiv: msg.result }, key); logged();
        const rejected = msg.result.equations.filter((e) => e.sarganP !== null && e.sarganP < 0.05).length;
        st.toast('success', `MIIV-2SLS: ${msg.result.equations.length} equations estimated${rejected ? `; ${rejected} Sargan test${rejected > 1 ? 's' : ''} significant at .05` : ''}.`);
      } else if (msg.kind === 'cb') {
        st.setResults({ cb: msg.result }, key); logged();
        cbToast(msg.result, 'Built-in engine');
      }
    };
    w.onerror = (e) => fail(`Calculation failed: ${e.message}`);
    const est = s.settings.estimator;
    const req: WorkerRequest = !cb ? { kind: 'pls', data, spec, options }
      : est === '2SLS' ? { kind: 'miiv', data, spec, options }
        : { kind: 'cb', data, spec, options, estimator: est };
    w.postMessage(req);
    return;
  }

  if (cb && s.settings.estimator === '2SLS') {
    s.toast('error', 'Bootstrapping is not available for MIIV-2SLS here; its standard errors and Sargan tests are analytic.');
    return;
  }
  // Bootstrap and fit test: split the samples across a pool of workers.
  const job: BootJobKind = kind === 'fittest' ? 'fittest' : cb ? 'cb' : 'pls';
  const total = Math.max(2, Math.floor(s.settings.bootSamples));
  const ranges = splitRanges(total, workerCount());
  const done = new Array<number>(ranges.length).fill(0);
  const parts: RangePart[] = [];
  s.setJob({ kind, done: 0, total, workers: ranges.length });

  ranges.forEach(([start, end], i) => {
    const w = spawn();
    w.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      if (msg.kind === 'progress') {
        done[i] = msg.done;
        useStore.getState().setJob({ kind, done: done.reduce((a, b) => a + b, 0), total, workers: ranges.length });
        return;
      }
      if (msg.kind === 'error') { fail(msg.message); return; }
      if (msg.kind !== 'range') return;
      parts.push(msg.part);
      if (parts.length < ranges.length) return;
      terminateAll();
      const st = useStore.getState();
      st.setJob(null);
      try {
        if (kind === 'fittest') {
          const result = mergeFitTest(parts);
          st.setResults({ fitTest: result }, key); logged();
          st.toast('success', `Fit test finished: ${result.samples} bootstrap samples on ${ranges.length} core${ranges.length > 1 ? 's' : ''}.`);
          if (!useStore.getState().results?.pls) run('estimate');
        } else {
          const result = mergeBootstrap(parts, s.settings.confidence, { tails: s.settings.bootTails === 'one' ? 1 : 2 });
          st.setResults({ boot: { ...result, seed: s.settings.seed } }, key); logged();
          const failed = result.failed ? ` (${result.failed} samples failed and were skipped)` : '';
          st.toast('success', `Bootstrapping finished: ${result.samples} samples on ${ranges.length} core${ranges.length > 1 ? 's' : ''}${failed}.`);
          const r = useStore.getState().results;
          if (!(cb ? r?.cb : r?.pls)) run('estimate');
        }
      } catch (err) {
        st.toast('error', err instanceof Error ? err.message : String(err));
      }
    };
    w.onerror = (e) => fail(`Calculation failed: ${e.message}`);
    const req: WorkerRequest = {
      kind: 'range',
      // BCa: the first worker also runs the jackknife (the fit test has no intervals).
      range: { job, data, spec, options, estimator: s.settings.estimator as CbEstimator, seed: s.settings.seed, start, end, ...(studentized ? { innerSamples: STUDENTIZED_INNER } : {}), ...(i === 0 && job !== 'fittest' && s.settings.bootInterval === 'bca' ? { jackknife: true } : {}) },
    };
    w.postMessage(req);
  });
}

// ---------- Monte Carlo simulation ----------

/** Progress of a simulation: replications done of the total, on how many workers. */
export type SimProgress = (done: number, total: number, workers: number) => void;

let simPool: Worker[] = [];
let simStop: ((e: Error) => void) | null = null;

/** Stop the running simulation (workers terminated, R interrupted); its promise rejects with Cancelled. */
export function cancelSimulation() {
  simPool.forEach((w) => w.terminate());
  simPool = [];
  rSimToken++;
  void import('./rengine/runtime').then((m) => m.interruptR());
  const stop = simStop;
  simStop = null;
  void import('./cancellable').then(({ Cancelled }) => stop?.(new Cancelled()));
}

let rSimToken = 0;

/**
 * Simulation by the R packages: replications in chunks (for progress and
 * cancelling), one R call per chunk; summarised like the built-in engine.
 */
async function simulateR(design: McDesign, progress: SimProgress): Promise<McSummaryRow[]> {
  const [{ summariseMc }, { mcChunkRequest, parseMcChunk }, { parallelism, rCallParallel }] = await Promise.all([import('./engine/montecarlo'), import('./rengine/mc'), import('./rengine/bridge')]);
  const total = design.replications * design.sampleSizes.length;
  const token = ++rSimToken;
  const CHUNK = 10;
  const tasks = design.sampleSizes.flatMap((n) => Array.from({ length: Math.ceil(design.replications / CHUNK) }, (_, k) => ({ n, start: k * CHUNK, end: Math.min(design.replications, (k + 1) * CHUNK) })));
  // Several R sessions at once (desktop R: all the helper's processes; the browser: the Parallel
  // setting). Each replication has its own seeds, so the results do not depend on how they are spread.
  const workers = Math.min((await parallelism()).sessions, tasks.length);
  progress(0, total, workers);
  const raws = await rCallParallel<Record<string, unknown>>('ps_mc', tasks.map((t) => mcChunkRequest(design, t.n, t.start, t.end)), 'simulation', (done) => {
    if (token === rSimToken) progress(Math.round(total * done / tasks.length), total, workers);
  });
  if (token !== rSimToken) throw new (await import('./cancellable')).Cancelled();
  const parts: McPart[] = raws.map((raw, i) => parseMcChunk(design, tasks[i].n, tasks[i].start, raw));
  return summariseMc(design, parts);
}

/** Simulation by the built-in engine on a pool of workers; results merge deterministically. */
async function simulateBuiltIn(design: McDesign, progress: SimProgress): Promise<McSummaryRow[]> {
  const { mcTasks, summariseMc } = await import('./engine/montecarlo');
  const workers = workerCount();
  const tasks = mcTasks(design, workers * 2);
  const total = design.replications * design.sampleSizes.length;
  const doneBy = new Map<number, number>();
  const parts: McPart[] = [];
  let next = 0;
  progress(0, total, workers);
  return new Promise<McSummaryRow[]>((resolve, reject) => {
    const finishAll = () => { simPool.forEach((w) => w.terminate()); simPool = []; simStop = null; };
    simStop = reject;
    const fail = (message: string) => { finishAll(); reject(new Error(message)); };
    const feed = (w: Worker) => {
      if (next >= tasks.length) return;
      const ti = next++;
      w.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const msg = e.data;
        if (msg.kind === 'progress') {
          doneBy.set(ti, msg.done);
          progress([...doneBy.values()].reduce((a, b) => a + b, 0), total, workers);
          return;
        }
        if (msg.kind === 'error') { fail(msg.message); return; }
        if (msg.kind !== 'mc') return;
        parts.push(msg.part);
        if (parts.length === tasks.length) { finishAll(); resolve(summariseMc(design, parts)); } else feed(w);
      };
      const req: WorkerRequest = { kind: 'mc', task: tasks[ti] };
      w.postMessage(req);
    };
    simPool = Array.from({ length: Math.min(workers, tasks.length) }, () => {
      const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      w.onerror = (e) => fail(e.message);
      return w;
    });
    simPool.forEach(feed);
  });
}

/** Run a Monte Carlo study with the R packages or the built-in engine. One at a time. */
export async function simulate(design: McDesign, engine: 'r' | 'builtin', progress: SimProgress): Promise<McSummaryRow[]> {
  if (simPool.length || simStop) throw new Error('A simulation is already running.');
  if (engine !== 'r') return simulateBuiltIn(design, progress);
  return new Promise<McSummaryRow[]>((resolve, reject) => {
    simStop = reject;
    simulateR(design, progress).then(resolve, reject).finally(() => { if (simStop === reject) simStop = null; });
  });
}
