// Cancelling an analysis started from a panel's Calculate (Estimate, Match…)
// button. The panel wraps each R call in guard(); cancel() rejects every
// guarded call at once with Cancelled, so the panel's own code skips the
// result (it never reaches setState), and stops the group's R calls (a group
// with pending calls is an R job, src/rengine/jobs.ts): its queued calls leave
// the queue and its running call is interrupted, in its own webR session or
// helper process only. A result that R still delivers afterwards goes nowhere.

import { beginRJob, cancelRJob, endRJob, newRJob } from './rengine/jobs';

export class Cancelled extends Error {
  constructor() {
    super('Cancelled.');
    this.name = 'Cancelled';
  }
}
export const isCancelled = (e: unknown): e is Cancelled => e instanceof Cancelled;

export interface CancelGroup {
  guard: <T>(p: Promise<T>) => Promise<T>;
  /** Reject every pending guarded call; returns how many there were. */
  cancel: () => number;
  pending: () => number;
}

export function cancelGroup(): CancelGroup {
  const stops = new Set<() => void>();
  // (the group's R job: live while it has pending calls, a new one after each cancel)
  let job = newRJob('cancel group');
  const settled = (stop: () => void) => {
    if (stops.delete(stop) && stops.size === 0) endRJob(job);
  };
  return {
    guard: <T>(p: Promise<T>) =>
      new Promise<T>((resolve, reject) => {
        const stop = () => reject(new Cancelled());
        stops.add(stop);
        beginRJob(job);
        p.then(resolve, reject).finally(() => settled(stop));
      }),
    cancel: () => {
      const all = [...stops];
      stops.clear();
      if (all.length) cancelRJob(job);
      job = newRJob('cancel group');
      all.forEach((s) => s());
      return all.length;
    },
    pending: () => stops.size,
  };
}
