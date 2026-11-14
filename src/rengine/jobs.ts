// Who an R call works for, so that cancelling one job stops only that job's R work.
//
// A job is anything the user can cancel: an analysis card or a panel's Calculate (a
// CancelGroup, src/cancellable.ts), the Model tab's job and the Monte Carlo simulation
// (src/runner.ts). A job is live from its start until it ends or is cancelled.
//
// JavaScript has no async context, so an R call cannot see which job's code made it.
// It is attributed when it is made: to the only live job when exactly one is live
// (every R call then is that job's), and to no job when none or several are (or when
// the caller says so, withRJob). Cancelling a job then stops only the R calls
// attributed to it: a queued one leaves the queue, a running one is interrupted. A call
// attributed to no job is never stopped by a cancel: it finishes, and whoever asked for
// it decides what to do with the result. So cancelling one job can never stop another
// job's calculation; when several jobs run at once, a cancelled job's calls may finish
// in the background (their results go nowhere).
//
// No imports: src/cancellable.ts uses this without loading the R runtime.

/** An R job (compared by identity). */
export interface RJob {
  readonly name: string;
}

const live = new Set<RJob>();
/** The owner given explicitly to the calls made synchronously inside withRJob (undefined: inferred). */
let explicit: RJob | null | undefined;
const handlers = new Set<(job: RJob) => void>();

export const newRJob = (name: string): RJob => ({ name });

export function beginRJob(job: RJob) {
  live.add(job);
}

export function endRJob(job: RJob) {
  live.delete(job);
}

/** The job an R call made now works for (null: none, or not known). */
export function rCallOwner(): RJob | null {
  if (explicit !== undefined) return explicit;
  if (live.size !== 1) return null;
  return live.values().next().value ?? null;
}

/**
 * Run `f`, attributing the R calls it makes synchronously (before its first await) to
 * `job`; null: to no job (background work such as the warm-up, which no cancel stops).
 */
export function withRJob<T>(job: RJob | null, f: () => T): T {
  const before = explicit;
  explicit = job;
  try {
    return f();
  } finally {
    explicit = before;
  }
}

/** Cancel a job: it is no longer live, and the R runtime stops the calls attributed to it. */
export function cancelRJob(job: RJob) {
  live.delete(job);
  for (const h of handlers) h(job);
}

/** The R runtime's part of cancelling (runtime.ts, helper.ts): stop the job's calls. */
export function onRJobCancelled(h: (job: RJob) => void): () => void {
  handlers.add(h);
  return () => handlers.delete(h);
}

/** Tests: forget every job. */
export function resetRJobs() {
  live.clear();
  explicit = undefined;
}
