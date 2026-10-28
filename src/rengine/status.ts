// State of the R runtime, for the UI. Kept apart from runtime.ts so that the
// webR library itself is only downloaded when R is first used.

import { create } from 'zustand';

export type RStatus = 'idle' | 'loading' | 'ready' | 'error';
export const useR = create<{ status: RStatus; message: string; versions: Record<string, string> }>(() => ({ status: 'idle', message: '', versions: {} }));
