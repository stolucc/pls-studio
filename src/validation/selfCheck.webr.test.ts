// The browser self-check's examples (selfCheck.ts) run as the browser will run them; their results' digests are
// recorded with the validation evidence, for the user's browser to reproduce. Run with npm run validate:evidence.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { PACKAGE_EXAMPLES } from '../examples/packages';
import { startTestRuntime, stopTestRuntime } from '../rengine/webrTestRuntime';
import { digest, digestDifferences } from './digest';
import { example, recordDigest } from './record';
import { runSelfCheck, SELF_CHECK_IDS } from './selfCheck';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const readText = async (path: string) => readFileSync(join(__dirname, '..', '..', 'public', path), 'utf8');

it.each([...SELF_CHECK_IDS])('%s: the self-check runs it and records its digest', async (id) => {
  const ex = PACKAGE_EXAMPLES.find((e) => e.id === id)!;
  example(id, { title: ex.title, method: 'self-check', packages: [ex.package] });
  const d = digest(await runSelfCheck(id, readText));
  expect(Object.keys(d).length, `${id}: numbers in the digest`).toBeGreaterThan(5);
  // Twice in the same R: the same numbers within the self-check's tolerance (an ESEM rotation's random starts move
  // its estimates by about 1e-8).
  const again = digest(await runSelfCheck(id, readText));
  const diff = digestDifferences(again, d);
  expect(diff, `${id}: ${JSON.stringify(diff.slice(0, 3))} … (${diff.length}; largest ${Math.max(0, ...diff.map((x) => Math.abs((x.got ?? NaN) - x.want)))})`).toEqual([]);
  recordDigest(d);
}, 900_000);
