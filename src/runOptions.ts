// The estimation and bootstrap options of the current settings, in one place: the calculation
// (runner.ts) and the exported R script (io.ts buildRScript) take them from here, so the script
// reproduces exactly what was run.

import type { PlsOptions } from './engine/types';
import type { Settings } from './model/project';

/** The PLS estimation options of the settings. */
export function plsOptionsOf(st: Settings): PlsOptions {
  return {
    scheme: st.scheme,
    maxIter: st.maxIter,
    tolerance: 10 ** -st.stopExp,
    missing: st.missing,
    consistent: st.consistent,
    approach: st.plsApproach,
    hocApproach: st.hocApproach,
    mi: { m: st.miImputations, seed: st.seed, method: st.miMethod },
  };
}

/** The bootstrap options of the settings (samples, seed, interval type, tails). */
export function bootOptionsOf(st: Settings) {
  return {
    samples: Math.max(2, Math.floor(st.bootSamples)),
    seed: st.seed,
    confidence: st.confidence,
    tails: st.bootTails === 'one' ? (1 as const) : (2 as const),
    interval: st.bootInterval === 'bca' ? ('bca' as const) : ('percentile' as const),
    inadmissible: st.bootInadmissible === 'keep' ? ('keep' as const) : ('drop' as const),
  };
}
