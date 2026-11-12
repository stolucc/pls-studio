// Starting R in the browser in the background as soon as the app has rendered, so that examples and the first
// calculation do not wait for webR's start-up: it downloads and starts the R runtime, then loads the common packages
// (cSEM, lavaan) and the bridge's R code (bridge.ts warmUpRPackages). Only for R in the browser — not with the desktop
// helper, not with the built-in engine — and not when the browser asks to save data. Its progress shows in the R status
// indicator (useR, components/RStatusPill.tsx), which then says "R environment ready"; it never blocks the app, and a
// failure is no more than a short note there (the next calculation starts R itself).

import { useCompute } from './compute';

export interface WarmUpOptions {
  /** Whether the project's engine is R (the store's settings.engine === 'r'), asked when the warm-up is due. */
  engineIsR: () => boolean;
  /** Starts R and loads the common packages (bridge.ts warmUpRPackages). */
  start?: () => Promise<unknown>;
  /** Runs `task` once the app has rendered. */
  whenDue?: (task: () => void) => void;
}

/** Right after the current render: the app is on screen, and R downloads in its worker meanwhile. */
function soon(task: () => void) {
  setTimeout(task, 0);
}

const startR = async () => (await import('./bridge')).warmUpRPackages();

/** Whether warming up R is wanted now. */
export function shouldWarmUp(engineIsR: () => boolean): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  // (R in the browser needs a cross-origin isolated page; without it a calculation explains why)
  if (!window.crossOriginIsolated) return false;
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (connection?.saveData) return false;
  return useCompute.getState().backend === 'browser' && engineIsR();
}

let scheduled = false;

/** Warm up R once the app has rendered (once per page; later calls do nothing). Never throws (a failure shows in useR). */
export function scheduleRWarmUp(o: WarmUpOptions): void {
  if (scheduled) return;
  scheduled = true;
  try {
    (o.whenDue ?? soon)(() => {
      try {
        if (shouldWarmUp(o.engineIsR)) void (o.start ?? startR)().catch(() => undefined);
      } catch {
        /* a warm-up only: the first calculation starts R itself */
      }
    });
  } catch {
    /* as above */
  }
}

/** Tests: allow scheduling again. */
export function resetWarmUp() {
  scheduled = false;
}
