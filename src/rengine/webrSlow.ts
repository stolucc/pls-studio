// The slow webR tests (minutes each: 4PL IRT with priors, large mixtures, Monte Carlo studies, bootstraps, three-level
// models): they run with WEBR_SLOW set, as npm run validate:evidence and the nightly CI job set it, and are skipped by
// npm run test:webr, which stays fast. A whole file of slow tests can be named *.slow.webr.test.ts instead (vite.config.ts
// leaves those out without WEBR_SLOW). scripts/webr/test-timings.json records the files' durations (slowest first).

import { it } from 'vitest';

export const WEBR_SLOW = !!process.env.WEBR_SLOW;
/** `it` for a slow webR test: skipped unless WEBR_SLOW is set. */
export const slowIt: typeof it = (WEBR_SLOW ? it : it.skip) as typeof it;
/** `it` for a test that is slow only for some cases (an `it.each` over examples, say). */
export const itIfFast = (slow: boolean): typeof it => (slow ? slowIt : it);

/** `it` for a test about the browser's R itself (its sessions, what it refuses, its package versions): skipped in the native mode (PS_NATIVE_R). */
export const webrOnlyIt: typeof it = (process.env.PS_NATIVE_R ? it.skip : it) as typeof it;
