// For tests only: the validation evidence a test file collects (src/validation/types.ts), written when it ends
// (setup.ts) with PS_VALIDATION_DIR set. vitest evaluates modules per test file, so this state is the file's.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
import type { Check } from './types';

/** Where this run computes (Check.runtime): desktop R with PS_NATIVE_R, webR with WEBR_TESTS, otherwise no R. */
export function runtime(): Check['runtime'] {
  if (process.env.PS_NATIVE_R) return 'desktop';
  if (process.env.WEBR_TESTS) return undefined;
  return 'fixture';
}

export const checks = new Map<string, Check>();

/**
 * The test file, relative to src/ and without the .webr.test.ts / .test.ts suffix: "rengine/esem" (the key of a
 * validated feature, features.ts: a feature's plain and webR test files share it).
 */
export const fileName = () =>
  (expect.getState().testPath ?? 'unknown')
    .replace(/\\/g, '/')
    .replace(/^.*\/src\//, '')
    .replace(/\.webr\.test\.tsx?$/, '')
    .replace(/\.test\.tsx?$/, '');

/**
 * The file a test file's evidence is written to: its path under src/ with "/" as "__", keeping ".webr", so that
 * X.test.ts and X.webr.test.ts write X.json and X.webr.json and neither overwrites the other
 * (scripts/validation/evidence.mjs merges every file of the directory).
 */
export const evidenceFile = (testPath: string) =>
  `${testPath
    .replace(/\\/g, '/')
    .replace(/^.*\/src\//, '')
    .replace(/\.test\.tsx?$/, '')
    .replace(/\//g, '__')}.json`;

export function flush() {
  const dir = process.env.PS_VALIDATION_DIR;
  if (!dir || !checks.size) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, evidenceFile(expect.getState().testPath ?? 'unknown')),
    JSON.stringify([...checks.values()], null, 1),
  );
}

/** Examples: the example whose check the toBeCloseTo calls of a test feed (record.ts), and the source compared with. */
export const current: {
  example: Check | null;
  source: string | null;
  /** The example checks the running test has fed. */
  touched: Set<Check>;
  /** A test of this file timed out (endTest). */
  abandoned: boolean;
} = {
  example: null,
  source: null,
  touched: new Set(),
  abandoned: false,
};

/**
 * The end of a test (setup.ts): a failed test fails every check it fed, so a test that timed out before its comparisons does
 * not leave its example's check passed. A timed-out test keeps running in the background and its late comparisons land in
 * whatever check the file is on by then, so from a timeout on no check of the file passes: the file has to be rerun.
 */
export function endTest(failed: boolean, timedOut: boolean, feature: Check | null) {
  if (timedOut) current.abandoned = true;
  if (failed || current.abandoned) {
    for (const check of current.touched) check.passed = false;
    if (feature) feature.passed = false;
  }
  current.touched.clear();
  current.example = null;
  current.source = null;
}
