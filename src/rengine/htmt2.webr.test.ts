// HTMT / HTMT2 notes (cSEM) on the customer-experience example. Service Quality and
// Price Fairness are independent, so their item correlations have mixed signs; with
// mean replacement their HTMT2 (a geometric mean) does not exist. cSEM only warns,
// without naming constructs; the app names them, and keeps every other value.
// Run with npm run test:webr.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { toSpec } from '../model/project';
import { makeSample } from '../sample';
import { estimatePlsR } from './pls';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const options = (missing: 'mean' | 'casewise') => ({ scheme: 'path' as const, consistent: false, missing, tolerance: 1e-7, maxIter: 300 });
const at = (m: (number | null)[][], i: number, j: number) => m[Math.max(i, j)][Math.min(i, j)];

describe('HTMT notes', () => {
  it('names the pair whose HTMT2 is undefined and keeps the rest', async () => {
    const { data, model } = makeSample();
    const r = await estimatePlsR(data, toSpec(model), options('mean'), 'cSEM');
    const sq = r.constructs.indexOf('Service Quality'), pf = r.constructs.indexOf('Price Fairness');
    expect(at(r.htmt2, sq, pf)).toBeNull();
    expect(at(r.htmt, sq, pf)).toBeGreaterThan(0);
    expect(at(r.htmt, sq, pf)).toBeLessThan(0.15);
    for (let i = 0; i < r.constructs.length; i++) for (let j = 0; j < i; j++) {
      if ((i === sq && j === pf) || (i === pf && j === sq)) continue;
      expect(at(r.htmt2, i, j)).toBeGreaterThan(0);
      expect(at(r.htmt2, i, j)).toBeLessThan(1);
    }
    const w = r.warnings.join('\n');
    expect(w).toContain('Items correlate with mixed signs between Service Quality and Price Fairness; between Price Fairness and Trust: these constructs are nearly uncorrelated');
    expect(w).toContain('HTMT2 is not defined for Service Quality – Price Fairness');
    expect(w).not.toContain('reverse-coded');
    expect(w).not.toContain('heterotrait-heteromethod');
    expect(w).not.toContain('all-positive or all-negative');
  }, 120_000);

  it('points to a reverse-coded item within a construct', async () => {
    const { data, model } = makeSample();
    const k = data.names.indexOf('TR2');
    const cols = data.cols.map((c, i) => (i === k ? Float64Array.from(c, (x) => 8 - x) : c));
    const r = await estimatePlsR({ ...data, cols }, toSpec(model), options('casewise'), 'cSEM');
    expect(r.warnings.join('\n')).toContain('Some items of Trust correlate negatively with the others: is an item reverse-coded?');
  }, 120_000);
});
