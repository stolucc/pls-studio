// PLS-POS in webR: our implementation of Becker et al. (2013) recovers the
// two simulated segments of plspm's simdata and is reproducible with a seed.
// (No R package implements PLS-POS, so recovery is the check.)
// Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { parseCsv } from '../engine/dataset';
import type { ModelSpec } from '../engine/types';
import { posR, posScriptR } from './segment';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const DIR = join(__dirname, '..', 'engine', '__fixtures__', 'fimix');
const csv = parseCsv(readFileSync(join(DIR, 'simdata.csv'), 'utf8')).dataset;
const group = csv.cols[csv.names.indexOf('group')];
const mv = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => `mv${a + i}`);
const spec: ModelSpec = {
  constructs: [{ name: 'Price', type: 'factor', mode: 'A', indicators: mv(1, 5) }, { name: 'Quality', type: 'factor', mode: 'A', indicators: mv(6, 10) }, { name: 'Satisfaction', type: 'factor', mode: 'A', indicators: mv(11, 13) }],
  paths: [{ from: 'Price', to: 'Satisfaction' }, { from: 'Quality', to: 'Satisfaction' }],
};
const options = { scheme: 'path' as const, consistent: false, tolerance: 1e-7, maxIter: 300, missing: 'casewise' as const };

it('recovers the two simulated segments, reproducibly', async () => {
  const r = await posR(csv, spec, options, { segments: 2, nrep: 2, seed: 1 });
  // Agreement with the true groups, whichever label each segment got.
  const agree = r.assignment.filter((a, i) => a === group[i]).length / r.n;
  expect(Math.max(agree, 1 - agree)).toBeGreaterThan(0.85);
  expect(r.objective).toBeGreaterThan(r.globalObjective + 1);
  const priceDriven = r.segments.find((g) => g.paths.find((p) => p.from === 'Price')!.est > 0.6)!;
  expect(priceDriven.paths.find((p) => p.from === 'Quality')!.est).toBeLessThan(0.3);
  const again = await posR(csv, spec, options, { segments: 2, nrep: 2, seed: 1 });
  expect(again.objective).toBe(r.objective);
  expect(await posScriptR(csv, spec, options, { segments: 2, nrep: 2, seed: 1 })).toContain('pos_run <- function(X, K, min_size, max_moves, candidates)');
}, 1_800_000);
