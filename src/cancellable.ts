// Cancelling an analysis started from a panel's Calculate (Estimate, Match…)
// button. The panel wraps each R call in guard(); cancel() rejects every
// guarded call at once with Cancelled, so the panel's own code skips the
// result (it never reaches setState), and interrupts R so the computation
// stops (webR sessions and the desktop helper). A result that R still delivers
// afterwards goes nowhere.

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
  return {
    guard: <T>(p: Promise<T>) =>
      new Promise<T>((resolve, reject) => {
        const stop = () => reject(new Cancelled());
        stops.add(stop);
        p.then(resolve, reject).finally(() => stops.delete(stop));
      }),
    cancel: () => {
      const all = [...stops];
      stops.clear();
      all.forEach((s) => s());
      return all.length;
    },
    pending: () => stops.size,
  };
}
