import { mergeBootstrap, mergeFitTest, splitRanges, type BootJobKind, type RangePart } from './engine/bootstrap';
import type { CbEstimator, CbResult } from './engine/cbsem';
import type { McDesign, McPart } from './engine/montecarlo';
import type { PlsOptions } from './engine/types';
import { toSpec, validateModel } from './model/project';
import { processGraph } from './process/fromModel';
import { indirectPaths as processPlanPaths } from './process/plan';
import { processInput } from './process/input';
import { resultsKey, useStore, type JobKind } from './store';
import type { WorkerRequest, WorkerResponse } from './worker';

let pool: Worker[] = [];
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
  if (r.warnings.length) st.toast('error', r.warnings[0]);
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
  const options: PlsOptions = { scheme: st.scheme, maxIter: st.maxIter, tolerance: 10 ** -st.stopExp, missing: st.missing, consistent: st.consistent };
  const boot = { samples: Math.max(2, Math.floor(st.bootSamples)), seed: st.seed, confidence: st.confidence };
  const token = ++rToken;
  const pkg = cb ? (st.estimator === '2SLS' ? 'MIIVsem' : 'lavaan') : kind === 'fittest' ? 'cSEM' : st.plsPackage;
  const what = kind === 'estimate' ? 'Estimating' : kind === 'fittest' ? `Fit test (${boot.samples} samples)` : `Bootstrapping ${boot.samples} samples`;
  s.setJob({ kind, done: 0, total: 1, workers: 1, label: `${what} with ${pkg}…` });
  const done = () => { if (token !== rToken) return null; const t = useStore.getState(); t.setJob(null); return t; };
  const failed = (e: unknown) => {
    if (token !== rToken) return;
    import('./rengine/bridge').then(({ rMessage }) => fail(`${pkg}: ${rMessage(e)}`));
  };
  const fail = (m: string) => { useStore.getState().setJob(null); useStore.getState().toast('error', m); };
  const version = () => import('./rengine/status').then(({ useR }) => useR.getState().versions[pkg] ?? '');

  if (kind === 'estimate') {
    if (cb && st.estimator === '2SLS') {
      import('./rengine/analyses').then(({ miivR }) => miivR(data, spec, st.missing)).then((r) => {
        const t = done(); if (!t) return;
        t.setResults({ miiv: r }, key);
        const rejected = r.equations.filter((e) => e.sarganP !== null && e.sarganP < 0.05).length;
        t.toast('success', `MIIVsem ${r.engine.version}: ${r.equations.length} equations estimated${rejected ? `; ${rejected} Sargan test${rejected > 1 ? 's' : ''} significant at .05` : ''}.`);
      }).catch(failed);
    } else if (cb) {
      import('./rengine/lavaan').then(({ estimateCbLavaan }) => estimateCbLavaan(data, spec, st.missing, st.estimator as CbEstimator)).then((r) => {
        const t = done(); if (!t) return;
        t.setResults({ cb: r }, key);
        cbToast(r, `lavaan ${r.engine.version}`);
      }).catch(failed);
    } else {
      import('./rengine/pls').then(({ estimatePlsR }) => estimatePlsR(data, spec, options, st.plsPackage)).then((r) => {
        const t = done(); if (!t) return;
        t.setResults({ pls: r }, key);
        const by = `${r.engine.package} ${r.engine.version}`;
        if (!r.converged) t.toast('error', `${by}: did not converge in ${r.iterations} iterations. Interpret results with care.`);
        else if (r.warnings.length) t.toast('error', `${by}: ${r.warnings[0]}`);
        else t.toast('success', `${by}: ${r.consistent ? 'PLSc' : 'PLS'} converged in ${r.iterations} iterations.`);
      }).catch(failed);
    }
    return;
  }
  if (cb && st.estimator === '2SLS') { fail('Bootstrapping is not available for MIIV-2SLS; its standard errors and Sargan tests are analytic.'); return; }
  if (kind === 'fittest') {
    import('./rengine/analyses').then(({ fitTestR }) => fitTestR(data, spec, options, boot)).then((r) => {
      const t = done(); if (!t) return;
      t.setResults({ fitTest: r }, key);
      t.toast('success', `cSEM fit test: ${r.samples - r.failed} of ${r.samples} bootstrap samples admissible.`);
    }).catch(failed);
    return;
  }
  Promise.all([import('./rengine/analyses'), version()]).then(([{ bootstrapR }, v]) => bootstrapR(data, spec,
    cb ? { kind: 'cbBoot', estimator: st.estimator as CbEstimator, missing: st.missing, boot } : { kind: 'plsBoot', pkg: st.plsPackage, options, boot }, () => v))
    .then((r) => {
      const t = done(); if (!t) return;
      t.setResults({ boot: r }, key);
      t.toast('success', `${r.engine.package}: ${r.samples - r.failed} of ${r.samples} bootstrap samples used${r.failed ? ` (${r.failed} not admissible or failed)` : ''}.`);
    }).catch(failed);
}

/**
 * Conditional process analysis: always manymome in R (no built-in engine). One
 * job fits the regressions and bootstraps the indirect effects.
 */
function runProcess(key: string) {
  const s = useStore.getState();
  const input = processInput(s.model, s.settings);
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
    t.setResults({ process: r }, key);
    const name = recognised ? `PROCESS model ${recognised.model}` : 'Custom model';
    if (r.warnings.length) t.toast('error', `manymome: ${r.warnings[0]}`);
    else t.toast('success', `manymome ${r.engine.version}: ${name} estimated (n = ${r.n}).`);
  }).catch((e) => {
    if (token !== rToken) return;
    import('./rengine/bridge').then(({ rMessage }) => { useStore.getState().setJob(null); useStore.getState().toast('error', `manymome: ${rMessage(e)}`); });
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
  };
  const spec = toSpec(s.model);
  const data = s.data;
  terminateAll();

  const fail = (message: string) => {
    terminateAll();
    useStore.getState().setJob(null);
    useStore.getState().toast('error', message);
  };

  if (s.settings.engine === 'r') { runR(kind, key); return; }

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
        st.setResults({ pls: msg.result }, key);
        if (!msg.result.converged) st.toast('error', `Did not converge in ${msg.result.iterations} iterations. Interpret results with care.`);
        else st.toast('success', `${msg.result.consistent ? 'PLSc' : 'PLS'} algorithm converged in ${msg.result.iterations} iterations.`);
      } else if (msg.kind === 'miiv') {
        st.setResults({ miiv: msg.result }, key);
        const rejected = msg.result.equations.filter((e) => e.sarganP !== null && e.sarganP < 0.05).length;
        st.toast('success', `MIIV-2SLS: ${msg.result.equations.length} equations estimated${rejected ? `; ${rejected} Sargan test${rejected > 1 ? 's' : ''} significant at .05` : ''}.`);
      } else if (msg.kind === 'cb') {
        st.setResults({ cb: msg.result }, key);
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
          st.setResults({ fitTest: result }, key);
          st.toast('success', `Fit test finished: ${result.samples} bootstrap samples on ${ranges.length} core${ranges.length > 1 ? 's' : ''}.`);
          if (!useStore.getState().results?.pls) run('estimate');
        } else {
          const result = mergeBootstrap(parts, s.settings.confidence);
          st.setResults({ boot: result }, key);
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
      range: { job, data, spec, options, estimator: s.settings.estimator as CbEstimator, seed: s.settings.seed, start, end },
    };
    w.postMessage(req);
  });
}

// ---------- Monte Carlo simulation ----------

let simPool: Worker[] = [];

export function cancelSimulation() {
  simPool.forEach((w) => w.terminate());
  simPool = [];
  if (simR) { simR = false; rSimToken++; void import('./rengine/runtime').then((m) => m.interruptR()); }
  void import('./simStore').then(({ useSim }) => useSim.getState().setJob(null));
  useStore.getState().toast('info', 'Simulation cancelled.');
}

/**
 * Run a simulation on a pool of workers. Tasks (sample size × replication
 * range) are queued so every core stays busy; results merge deterministically.
 */
let simR = false;
let rSimToken = 0;

/**
 * Simulation by the R packages: replications in chunks (for progress and
 * cancelling), one R call per chunk; summarised like the built-in engine.
 */
async function runSimulationR(design: McDesign) {
  const { useSim } = await import('./simStore');
  const [{ summariseMc }, { runMcChunkR }, { rMessage }] = await Promise.all([import('./engine/montecarlo'), import('./rengine/mc'), import('./rengine/bridge')]);
  const total = design.replications * design.sampleSizes.length;
  const token = ++rSimToken;
  simR = true;
  useSim.getState().setJob({ done: 0, total, workers: 1 });
  const parts: McPart[] = [];
  const CHUNK = 10;
  try {
    for (const n of design.sampleSizes) {
      for (let start = 0; start < design.replications; start += CHUNK) {
        const part = await runMcChunkR(design, n, start, Math.min(design.replications, start + CHUNK));
        if (token !== rSimToken) return;
        parts.push(part);
        useSim.getState().setJob({ done: parts.reduce((s, p) => s + p.est[0][0].length, 0), total, workers: 1 });
      }
    }
    useSim.getState().setRows(summariseMc(design, parts), JSON.stringify(design));
    useStore.getState().toast('success', `Simulation finished: ${total} replications with lavaan and cSEM (R).`);
  } catch (e) {
    if (token === rSimToken) useStore.getState().toast('error', `Simulation failed: ${rMessage(e)}`);
  } finally {
    if (token === rSimToken) { simR = false; useSim.getState().setJob(null); }
  }
}

export async function runSimulation(design: McDesign) {
  const { useSim } = await import('./simStore');
  const { mcTasks, summariseMc } = await import('./engine/montecarlo');
  const sim = useSim.getState();
  if (sim.job) return;
  if (useStore.getState().settings.engine === 'r') { void runSimulationR(design); return; }
  const workers = workerCount();
  const tasks = mcTasks(design, workers * 2);
  const total = design.replications * design.sampleSizes.length;
  const doneBy = new Map<number, number>();
  const parts: McPart[] = [];
  let next = 0;
  sim.setJob({ done: 0, total, workers });
  const key = JSON.stringify(design);
  const finishAll = () => { simPool.forEach((w) => w.terminate()); simPool = []; };

  const feed = (w: Worker) => {
    if (next >= tasks.length) return;
    const ti = next++;
    w.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      if (msg.kind === 'progress') {
        doneBy.set(ti, msg.done);
        useSim.getState().setJob({ done: [...doneBy.values()].reduce((a, b) => a + b, 0), total, workers });
        return;
      }
      if (msg.kind === 'error') {
        finishAll();
        useSim.getState().setJob(null);
        useStore.getState().toast('error', `Simulation failed: ${msg.message}`);
        return;
      }
      if (msg.kind !== 'mc') return;
      parts.push(msg.part);
      if (parts.length === tasks.length) {
        finishAll();
        useSim.getState().setRows(summariseMc(design, parts), key);
        useSim.getState().setJob(null);
        useStore.getState().toast('success', `Simulation finished: ${total} replications on ${workers} core${workers > 1 ? 's' : ''}.`);
      } else feed(w);
    };
    const req: WorkerRequest = { kind: 'mc', task: tasks[ti] };
    w.postMessage(req);
  };
  simPool = Array.from({ length: Math.min(workers, tasks.length) }, () => {
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    w.onerror = (e) => { finishAll(); useSim.getState().setJob(null); useStore.getState().toast('error', `Simulation failed: ${e.message}`); };
    return w;
  });
  simPool.forEach(feed);
}
