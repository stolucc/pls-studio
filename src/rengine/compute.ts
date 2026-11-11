// Where and how R calculations run, a preference of this browser (not of the
// project): in the browser's R (webR) or in desktop R through the local
// helper, and how many R sessions share parallel work (bootstrap samples).

import { create } from 'zustand';

export type Backend = 'browser' | 'helper';
interface Compute {
  backend: Backend;
  /** R sessions for parallel work; 1 = off (one run of the package, its exact results). */
  workers: number;
  set: (p: Partial<Pick<Compute, 'backend' | 'workers'>>) => void;
}

const KEY = 'pls-studio.compute';
export const MAX_WORKERS = 8;
export const clampWorkers = (n: number) =>
  Math.max(1, Math.min(MAX_WORKERS, Math.round(Number.isFinite(n) ? n : 1)));

function load(): Pick<Compute, 'backend' | 'workers'> {
  try {
    const raw = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? '{}') as Partial<Compute>;
    return {
      backend: raw.backend === 'helper' ? 'helper' : 'browser',
      workers: clampWorkers(raw.workers ?? 1),
    };
  } catch {
    return { backend: 'browser', workers: 1 };
  }
}

export const useCompute = create<Compute>((set, get) => ({
  ...load(),
  set: (p) => {
    set({ ...p, ...(p.workers !== undefined ? { workers: clampWorkers(p.workers) } : {}) });
    try {
      globalThis.localStorage?.setItem(
        KEY,
        JSON.stringify({ backend: get().backend, workers: get().workers }),
      );
    } catch {
      /* private mode: not remembered */
    }
  },
}));

/** Bootstrap samples per chunk in parallel mode: fixed, so results do not depend on the number of workers. */
export const CHUNK_SAMPLES = 100;

/**
 * The chunks of a parallel bootstrap: CHUNK_SAMPLES samples each (the last
 * takes the rest), chunk k drawn with seed + k (k = 0, 1, …; kept within R's
 * set.seed range). The same plan for any number of workers, and in the
 * exported script.
 */
export function bootChunks(samples: number, seed: number): { R: number[]; seed: number[] } {
  const R: number[] = [],
    seeds: number[] = [];
  for (let k = 0, left = samples; left > 0; k++, left -= CHUNK_SAMPLES) {
    R.push(Math.min(CHUNK_SAMPLES, left));
    seeds.push((seed + k) % 2147483647);
  }
  return { R, seed: seeds };
}
