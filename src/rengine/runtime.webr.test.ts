// A package that cannot be downloaded fails with a clear message, not a later
// "there is no package called" from R. Run with npm run test:webr.

import { afterAll, beforeAll, expect, it } from 'vitest';
import { withR } from './runtime';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

it('reports packages that could not be installed', async () => {
  await expect(withR(['jsonlite', 'noSuchPackagePS'], {}, async () => 1)).rejects.toThrow(/Could not download the R package noSuchPackagePS from http:\/\/127\.0\.0\.1:\d+\/repo\//);
  // The session stays usable for packages that exist.
  await expect(withR(['jsonlite'], {}, async () => 2)).resolves.toBe(2);
}, 300_000);
