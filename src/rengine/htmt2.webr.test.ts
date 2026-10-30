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

const options = (missing: 'mean' | 'casewise' | 'mi') => ({ scheme: 'path' as const, consistent: false, missing, tolerance: 1e-7, maxIter: 300, ...(missing === 'mi' ? { mi: { m: 3, seed: 7 } } : {}) });
const at = (m: (number | null)[][], i: number, j: number) => m[Math.max(i, j)][Math.min(i, j)];

describe('HTMT notes', () => {
  it('names the pair whose HTMT2 is undefined and keeps the rest', async () => {
    const { data, model } = makeSample();
    const r = await estimatePlsR(data, toSpec(model), options('mean'), 'cSEM');
    const sq = r.constructs.indexOf('Service Quality'), pf = r.constructs.indexOf('Price Fairness');
    expect(at(r.htmt2, sq, pf)).toBeNull();
    expect(at(r.htmt, sq, pf)).toBeGreaterThan(0);
    expect(at(r.htmt, sq, pf)).toBeLessThan(0.15);
    const tr = r.constructs.indexOf('Trust');
    expect(at(r.htmt2, pf, tr)).toBeNull(); // 3 × 3 correlations: cSEM would return an odd root of a negative product
    expect(at(r.htmt, pf, tr)).toBeLessThan(0.15);
    for (let i = 0; i < r.constructs.length; i++) for (let j = 0; j < i; j++) {
      if ([i, j].includes(pf) && ([i, j].includes(sq) || [i, j].includes(tr))) continue;
      expect(at(r.htmt2, i, j)).toBeGreaterThan(0);
      expect(at(r.htmt2, i, j)).toBeLessThan(1);
    }
    const w = r.warnings.join('\n');
    expect(w).toContain('The items of Service Quality and Price Fairness; of Price Fairness and Trust correlate with mixed signs');
    expect(w).not.toContain('reverse-coded');
    expect(w).not.toContain('is not reported');
    expect(w).not.toContain('heterotrait-heteromethod');
    expect(w).not.toContain('all-positive or all-negative');
    expect(w).not.toContain('NaNs produced');
  }, 120_000);

  it('reports the diagnostics once for a multiply-imputed result', async () => {
    const { data, model } = makeSample();
    const r = await estimatePlsR(data, toSpec(model), options('mi'), 'cSEM');
    const notes = r.warnings.filter((w) => w.includes('mixed signs') || w.includes('HTMT'));
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('Service Quality and Price Fairness');
    const sq = r.constructs.indexOf('Service Quality'), pf = r.constructs.indexOf('Price Fairness');
    expect(at(r.htmt2, sq, pf)).toBeNull();
  }, 180_000);

  it('points to a reverse-coded item within a construct', async () => {
    const { data, model } = makeSample();
    const k = data.names.indexOf('TR2');
    const cols = data.cols.map((c, i) => (i === k ? Float64Array.from(c, (x) => 8 - x) : c));
    const r = await estimatePlsR({ ...data, cols }, toSpec(model), options('casewise'), 'cSEM');
    const w = r.warnings.join('\n');
    expect(w).toContain('Some items of Trust correlate negatively with the others: is an item reverse-coded?');
    // the mixed signs that the reversed item causes are not mistaken for weak correlations
    const mixedNote = r.warnings.find((x) => x.includes('nearly uncorrelated'))!;
    expect(mixedNote).toContain('Service Quality and Price Fairness'); // still true with TR2 reversed
    expect(mixedNote).not.toContain('Trust');
    expect(w).toMatch(/The HTMT of .*Trust.* is not reported/);
    expect(w).not.toContain('show different signs');
    expect(w).not.toContain('NaNs produced');
    const tr = r.constructs.indexOf('Trust'), sat = r.constructs.indexOf('Satisfaction');
    expect(at(r.htmt, tr, sat)).toBeNull();
    expect(at(r.htmt2, tr, sat)).toBeNull();
  }, 120_000);
});
