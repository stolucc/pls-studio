// Cancelling one job stops only that job's R calls (jobs.ts): a queued call leaves the
// queue, a running one is interrupted in its own session, idle sessions and other
// jobs' calls are left alone. webR is replaced by a fake that records interrupts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const interrupts: number[] = [];
let created = 0;
vi.mock('webr', () => ({
  ChannelType: { SharedArrayBuffer: 1 },
  WebR: class {
    id = created++;
    version = 'fake';
    versionR = 'fake';
    async init() {}
    async evalRVoid() {}
    interrupt() {
      interrupts.push(this.id);
    }
    close() {}
  },
}));

const { configureR, withSession, interruptR } = await import('./runtime');
configureR({ baseUrl: 'http://fake/', repoUrl: 'http://fake/repo/' });
const { beginRJob, cancelRJob, endRJob, newRJob, resetRJobs, withRJob } = await import('./jobs');
const { cancelGroup, isCancelled } = await import('../cancellable');

/** An R call whose end the test decides. */
function controlled() {
  let finish!: (v: string) => void;
  let started = false;
  const done = new Promise<string>((r) => (finish = r));
  return {
    fn: () => {
      started = true;
      return done;
    },
    finish,
    started: () => started,
  };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  interrupts.length = 0;
  resetRJobs();
});
afterEach(() => resetRJobs());

describe('cancelling an R job', () => {
  it('a queued call of the cancelled job leaves the queue; the running call of another job is not interrupted', async () => {
    const a = newRJob('card A');
    const b = newRJob('card B');
    beginRJob(a);
    const runA = controlled();
    const pa = withSession(0, [], {}, runA.fn);
    await tick();
    expect(runA.started()).toBe(true);
    beginRJob(b);
    const runB = controlled();
    // (B's call, attributed explicitly here: with two jobs live, inference attributes it to none)
    const pb = withRJob(b, () => withSession(0, [], {}, runB.fn));
    const caught = pb.catch((e) => e);
    cancelRJob(b);
    expect(isCancelled(await caught)).toBe(true);
    expect(interrupts).toEqual([]);
    runA.finish('A done');
    expect(await pa).toBe('A done');
    await tick();
    expect(runB.started()).toBe(false);
    endRJob(a);
  });

  it('the running call of the cancelled job is interrupted, in its own session only', async () => {
    const a = newRJob('simulation');
    beginRJob(a);
    // Session 1 starts (and stays idle), then session 2 runs the job's call.
    await withSession(1, [], {}, async () => 'warm');
    const run = controlled();
    void withSession(2, [], {}, run.fn);
    await tick();
    const before = created;
    cancelRJob(a);
    await tick();
    expect(interrupts).toHaveLength(1);
    expect(interrupts[0]).toBe(before - 1);
    run.finish('');
  });

  it('a call attributed to no job (several jobs live, or the warm-up) is never stopped by a cancel', async () => {
    const a = newRJob('A');
    const b = newRJob('B');
    beginRJob(a);
    beginRJob(b);
    const run = controlled();
    const p = withSession(3, [], {}, run.fn);
    await tick();
    cancelRJob(a);
    await tick();
    expect(interrupts).toEqual([]);
    run.finish('kept');
    expect(await p).toBe('kept');
    endRJob(b);
  });

  it('interruptR (a cancel without a job) skips idle sessions', async () => {
    await withSession(4, [], {}, async () => 'idle now');
    interruptR();
    await tick();
    expect(interrupts).toEqual([]);
  });

  it('a cancel group is a job while it has pending calls: its cancel stops its own R call', async () => {
    const g = cancelGroup();
    const run = controlled();
    // (the R call is made inside the guarded run, as a card's analysis does)
    const guarded = g.guard(tick().then(() => withSession(5, [], {}, run.fn)));
    const caught = guarded.catch((e) => e);
    await tick();
    await tick();
    expect(run.started()).toBe(true);
    expect(g.cancel()).toBe(1);
    expect(isCancelled(await caught)).toBe(true);
    await tick();
    expect(interrupts).toHaveLength(1);
    run.finish('');
  });

  it('a group without pending calls (a built-in job) interrupts nothing', async () => {
    const other = newRJob('other');
    beginRJob(other);
    const run = controlled();
    const p = withSession(6, [], {}, run.fn);
    await tick();
    const g = cancelGroup();
    expect(g.cancel()).toBe(0);
    await tick();
    expect(interrupts).toEqual([]);
    run.finish('ok');
    expect(await p).toBe('ok');
    endRJob(other);
  });
});

describe('the Model tab job (runner.ts)', () => {
  it('is an R job while it runs: cancelling it interrupts its R call; a built-in job interrupts nothing', async () => {
    const { cancelJob } = await import('../runner');
    const { useStore } = await import('../store');
    const job = { kind: 'estimate' as const, done: 0, total: 1, workers: 1 };
    // A built-in job: no R call, so nothing to interrupt (an idle session is left alone).
    useStore.getState().setJob(job);
    cancelJob();
    await tick();
    expect(interrupts).toEqual([]);
    // An R job: its running call is interrupted.
    useStore.getState().setJob({ ...job, label: 'Estimating with lavaan…' });
    const run = controlled();
    void withSession(7, [], {}, run.fn);
    await tick();
    cancelJob();
    await tick();
    expect(interrupts).toHaveLength(1);
    run.finish('');
  });
});
