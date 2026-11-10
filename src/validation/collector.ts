// For tests only: the validation evidence a test file collects (src/validation/types.ts), written when it ends
// (setup.ts) with PS_VALIDATION_DIR set. vitest evaluates modules per test file, so this state is the file's.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
import type { Check } from './types';

/** Where this run computes (Check.runtime): desktop R with PS_NATIVE_R, webR with WEBR_TESTS, otherwise no R. */
export const runtime = (): Check['runtime'] => (process.env.PS_NATIVE_R ? 'desktop' : process.env.WEBR_TESTS ? undefined : 'fixture');

export const checks = new Map<string, Check>();

/** The test file, relative to src/ and without the .webr.test.ts / .test.ts suffix: "rengine/esem". */
export const fileName = () => (expect.getState().testPath ?? 'unknown').replace(/\\/g, '/').replace(/^.*\/src\//, '').replace(/\.webr\.test\.tsx?$/, '').replace(/\.test\.tsx?$/, '');

export function flush() {
  const dir = process.env.PS_VALIDATION_DIR;
  if (!dir || !checks.size) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${fileName().replace(/\//g, '__')}.json`), JSON.stringify([...checks.values()], null, 1));
}

/** Examples: the example whose check the toBeCloseTo calls of a test feed (record.ts), and the source compared with. */
export const current: { example: Check | null; source: string | null } = { example: null, source: null };
