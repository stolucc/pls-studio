// run() with a stub Worker: which engine a job goes to, how a bootstrap is split over the workers and merged
// (parts in any order), that a cancelled job's late messages change nothing, and the point estimates a bootstrap
// starts when none are on screen. The R packages are mocked (src/rengine/pls); the built-in engine's workers are
// FakeWorkers that the test answers.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mergeBootstrap, type RangePart } from './engine/bootstrap';
import type { PlsResult } from './engine/types';
import { makeSample } from './sample';
import { useStore } from './store';
import type { WorkerRequest, WorkerResponse } from './worker';

const estimatePlsR = vi.hoisted(() => vi.fn());
vi.mock('./rengine/pls', () => ({ estimatePlsR }));
vi.mock('./rengine/runtime', () => ({ interruptR: vi.fn() }));
vi.mock('./analyses/runs', () => ({ logCurrentRun: vi.fn() }));

import { cancelJob, run } from './runner';

class FakeWorker {
  static all: FakeWorker[] = [];
  onmessage: ((e: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  posted: WorkerRequest[] = [];
  terminated = false;
  constructor() {
    FakeWorker.all.push(this);
  }
  postMessage(m: WorkerRequest) {
    this.posted.push(m);
  }
  terminate() {
    this.terminated = true;
  }
  /** A message from the worker, delivered even after terminate() (as a message already queued may be). */
  reply(m: WorkerResponse) {
    this.onmessage?.({ data: m } as MessageEvent<WorkerResponse>);
  }
}

const s = () => useStore.getState();
const tick = () => new Promise((r) => setTimeout(r, 0));
const plsResult = (iterations = 5) =>
  ({ converged: true, consistent: false, iterations, warnings: [] }) as unknown as PlsResult;

/** A worker's part of the bootstrap: one parameter, its draws start, start + 1, … */
function part(start: number, end: number): RangePart {
  return {
    start,
    params: [{ key: 'p:a:b', group: 'path', label: 'A → B' }],
    originals: [0.5],
    draws: [Float64Array.from({ length: end - start }, (_, k) => (start + k) / 100)],
  };
}

beforeEach(() => {
  FakeWorker.all = [];
  vi.stubGlobal('Worker', FakeWorker);
  // (three bootstrap workers: one per core, less one for the page)
  vi.stubGlobal('navigator', { hardwareConcurrency: 4 });
  s().newProject();
  const { data, info, model } = makeSample();
  s().setData(data, info);
  useStore.setState({ model, job: null, results: null, toasts: [] } as never);
  s().setSettings({ method: 'pls', engine: 'builtin', bootSamples: 30 });
  estimatePlsR.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('which engine a job goes to', () => {
  it('the R packages: one call, no worker; the result shown when it arrives', async () => {
    s().setSettings({ engine: 'r', plsPackage: 'seminr' });
    let resolve!: (r: PlsResult) => void;
    estimatePlsR.mockReturnValue(new Promise((r) => (resolve = r)));
    run('estimate');
    expect(s().job?.label).toBe('Estimating with seminr…');
    await tick();
    expect(estimatePlsR).toHaveBeenCalledTimes(1);
    expect(estimatePlsR.mock.calls[0][3]).toBe('seminr');
    expect(FakeWorker.all).toHaveLength(0);
    resolve({ ...plsResult(), engine: { package: 'seminr', version: '2.5.0' } } as never);
    await tick();
    expect(s().job).toBeNull();
    expect(s().results?.pls?.iterations).toBe(5);
  });

  it('the built-in engine: one worker for the point estimates, its result shown and the worker ended', () => {
    run('estimate');
    expect(FakeWorker.all).toHaveLength(1);
    const w = FakeWorker.all[0];
    expect(w.posted.map((m) => m.kind)).toEqual(['pls']);
    w.reply({ kind: 'progress', done: 1, total: 2 });
    expect(s().results).toBeNull();
    w.reply({ kind: 'pls', result: plsResult(7) });
    expect(w.terminated).toBe(true);
    expect(s().job).toBeNull();
    expect(s().results?.pls?.iterations).toBe(7);
  });

  it('studentized intervals go to the built-in engine’s workers even with the R engine chosen', () => {
    s().setSettings({ engine: 'r', bootInterval: 'studentized' });
    run('boot');
    expect(estimatePlsR).not.toHaveBeenCalled();
    expect(FakeWorker.all).toHaveLength(3);
    for (const w of FakeWorker.all) {
      const req = w.posted[0] as Extract<WorkerRequest, { kind: 'range' }>;
      expect(req.range.innerSamples).toBeGreaterThan(0);
    }
  });
});

describe('the bootstrap on the workers', () => {
  it('splits the samples over the workers, adds up progress, merges parts in any order, then estimates', () => {
    s().setSettings({ bootInterval: 'bca' });
    run('boot');
    const workers = [...FakeWorker.all];
    expect(workers).toHaveLength(3);
    const ranges = workers.map((w) => {
      const req = w.posted[0] as Extract<WorkerRequest, { kind: 'range' }>;
      return [req.range.start, req.range.end, !!req.range.jackknife];
    });
    // (BCa: the first worker also runs the jackknife)
    expect(ranges).toEqual([
      [0, 10, true],
      [10, 20, false],
      [20, 30, false],
    ]);
    workers[0].reply({ kind: 'progress', done: 4, total: 10 });
    workers[2].reply({ kind: 'progress', done: 6, total: 10 });
    expect(s().job).toMatchObject({ kind: 'boot', done: 10, total: 30, workers: 3 });
    // The parts arrive out of order: 20–30, 0–10, 10–20.
    workers[2].reply({ kind: 'range', part: part(20, 30) });
    workers[0].reply({ kind: 'range', part: part(0, 10) });
    expect(s().results).toBeNull();
    workers[1].reply({ kind: 'range', part: part(10, 20) });
    expect(workers.every((w) => w.terminated)).toBe(true);
    const inOrder = mergeBootstrap([part(0, 10), part(10, 20), part(20, 30)], 0.95, { tails: 2 });
    expect(s().results?.boot).toEqual({ ...inOrder, seed: s().settings.seed });
    expect(s().results?.boot?.samples).toBe(30);
    // No point estimates on screen: the bootstrap starts them (a new worker, a 'pls' request).
    expect(FakeWorker.all).toHaveLength(4);
    expect(FakeWorker.all[3].posted.map((m) => m.kind)).toEqual(['pls']);
    expect(s().job).toMatchObject({ kind: 'estimate' });
  });

  it('starts no estimation when the point estimates are already on screen', () => {
    run('estimate');
    FakeWorker.all[0].reply({ kind: 'pls', result: plsResult() });
    run('boot');
    const workers = FakeWorker.all.slice(1);
    expect(workers).toHaveLength(3);
    workers.forEach((w, i) => w.reply({ kind: 'range', part: part(i * 10, i * 10 + 10) }));
    expect(s().results?.boot?.samples).toBe(30);
    expect(s().results?.pls).not.toBeNull();
    expect(FakeWorker.all).toHaveLength(4);
    expect(s().job).toBeNull();
  });

  it('a part that fails ends the job; the other workers’ late parts change nothing', () => {
    run('boot');
    const workers = [...FakeWorker.all];
    workers[1].reply({ kind: 'error', message: 'singular matrix' });
    expect(s().job).toBeNull();
    expect(workers.every((w) => w.terminated)).toBe(true);
    workers[0].reply({ kind: 'range', part: part(0, 10) });
    workers[2].reply({ kind: 'range', part: part(20, 30) });
    expect(s().results).toBeNull();
    expect(s().toasts.at(-1)?.text).toBe('singular matrix');
  });
});

describe('cancelling', () => {
  it('a bootstrap: parts that arrive after cancelJob() are ignored', () => {
    run('boot');
    const workers = [...FakeWorker.all];
    workers[0].reply({ kind: 'range', part: part(0, 10) });
    cancelJob();
    expect(s().job).toBeNull();
    expect(workers.every((w) => w.terminated)).toBe(true);
    workers[1].reply({ kind: 'progress', done: 10, total: 10 });
    workers[1].reply({ kind: 'range', part: part(10, 20) });
    workers[2].reply({ kind: 'range', part: part(20, 30) });
    expect(s().job).toBeNull();
    expect(s().results).toBeNull();
    // (and no estimation started for it)
    expect(FakeWorker.all).toHaveLength(3);
  });

  it('the point estimates of the built-in engine: a late result is ignored', () => {
    run('estimate');
    cancelJob();
    FakeWorker.all[0].reply({ kind: 'pls', result: plsResult() });
    expect(s().results).toBeNull();
    expect(s().job).toBeNull();
  });

  it('an R calculation: its result, arriving after cancelJob(), is discarded', async () => {
    s().setSettings({ engine: 'r' });
    let resolve!: (r: PlsResult) => void;
    estimatePlsR.mockReturnValue(new Promise((r) => (resolve = r)));
    run('estimate');
    await tick();
    cancelJob();
    resolve({ ...plsResult(), engine: { package: 'cSEM', version: '0.6.1' } } as never);
    await tick();
    expect(s().results).toBeNull();
    expect(s().job).toBeNull();
    expect(s().toasts.at(-1)?.text).toBe('Calculation cancelled.');
  });
});
