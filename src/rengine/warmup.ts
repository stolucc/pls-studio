// Starting R in the browser in the background once the app is idle after loading, so that the first calculation does
// not wait for webR's start-up (downloading and starting the R runtime; packages still install when a calculation
// needs them). Only for R in the browser — not with the desktop helper, not with the built-in engine — and not when
// the browser asks to save data or the page is in the background. Its progress shows in the R status indicator
// (useR, components/RStatusPill.tsx); it never blocks the app, and a failure is no more than a short note there (the
// next calculation starts R itself).

import { useCompute } from './compute';

export interface WarmUpOptions {
  /** Whether the project's engine is R (the store's settings.engine === 'r'), asked when the warm-up is due. */
  engineIsR: () => boolean;
  /** Starts the main R session (runtime.ts warmUpR). */
  start?: () => Promise<unknown>;
  /** Runs `task` once the page is idle after loading. */
  whenIdle?: (task: () => void) => void;
}

/** After the page's load event, a short pause, then the browser's next idle moment (at the latest 10 s later). */
const IDLE_DELAY_MS = 2000;
function whenIdle(task: () => void) {
  const idle = () =>
    setTimeout(() => {
      if (typeof requestIdleCallback === 'function') requestIdleCallback(task, { timeout: 10_000 });
      else task();
    }, IDLE_DELAY_MS);
  if (document.readyState === 'complete') idle();
  else window.addEventListener('load', idle, { once: true });
}

const startR = async () => (await import('./runtime')).warmUpR();

/** Whether warming up R is wanted now. */
export function shouldWarmUp(engineIsR: () => boolean): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  // (R in the browser needs a cross-origin isolated page; without it a calculation explains why)
  if (!window.crossOriginIsolated) return false;
  if (document.visibilityState === 'hidden') return false;
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (connection?.saveData) return false;
  return useCompute.getState().backend === 'browser' && engineIsR();
}

let scheduled = false;

/** Warm up R once the app is idle (once per page; later calls do nothing). Never throws (a failure shows in useR). */
export function scheduleRWarmUp(o: WarmUpOptions): void {
  if (scheduled) return;
  scheduled = true;
  try {
    (o.whenIdle ?? whenIdle)(() => {
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
