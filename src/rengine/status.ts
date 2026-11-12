// State of the R runtime, for the UI. Kept apart from runtime.ts so that the
// webR library itself is only downloaded when R is first used.

import { create } from 'zustand';

export type RStatus = 'idle' | 'loading' | 'ready' | 'error';
export const useR = create<{ status: RStatus; message: string; versions: Record<string, string> }>(
  () => ({ status: 'idle', message: '', versions: {} }),
);

/** The message while the main R session starts (the background warm-up or a first calculation). */
export const R_STARTING = 'Loading R in your browser…';
