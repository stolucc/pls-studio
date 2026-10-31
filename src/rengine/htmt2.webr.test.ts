// HTMT / HTMT2 notes (cSEM) on the customer-experience example. With Price
// Fairness made independent of the rest (its rows permuted), its item
// correlations with Service Quality have mixed signs and their HTMT2 (a
// geometric mean) does not exist. cSEM only warns, without naming constructs;
// the app names them, and keeps every other value. The example as shipped
// runs without any note. Run with npm run test:webr.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { toSpec } from '../model/project';
import { makeSample } from '../sample';
import { estimatePlsR } from './pls';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

/** The sample with Price Fairness unrelated to everything else: its rows permuted (fixed seed). */
function independentPf() {
  const { data, model } = makeSample();
  const n = data.cols[0].length;
  let x = 12345;
  const rand = () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const cols = data.cols.map((c, k) => (data.names[k].startsWith('PF') ? Float64Array.from(order, (i) => c[i]) : c));
  return { data: { ...data, cols }, model };
}

const options = (missing: 'mean' | 'casewise' | 'mi') => ({ scheme: 'path' as const, consistent: false, missing, tolerance: 1e-7, maxIter: 300, ...(missing === 'mi' ? { mi: { m: 3, seed: 7 } } : {}) });
const at = (m: (number | null)[][], i: number, j: number) => m[Math.max(i, j)][Math.min(i, j)];

describe('HTMT notes', () => {
  it('the example as shipped runs without a note or warning', async () => {
    const { data, model } = makeSample();
    for (const pkg of ['cSEM', 'seminr'] as const) {
      const r = await estimatePlsR(data, toSpec(model), options('mean'), pkg);
      expect(r.warnings, pkg).toEqual([]);
      expect(r.notes, pkg).toEqual([]);
      for (let i = 0; i < r.constructs.length; i++) for (let j = 0; j < i; j++) expect(at(r.htmt, i, j), `${pkg} htmt ${i},${j}`).toBeGreaterThan(0);
      if (pkg === 'cSEM') for (let i = 0; i < r.constructs.length; i++) for (let j = 0; j < i; j++) expect(at(r.htmt2, i, j), `htmt2 ${i},${j}`).toBeGreaterThan(0);
    }
  }, 180_000);

  it('names the pair whose HTMT2 is undefined and keeps the rest', async () => {
    const { data, model } = independentPf();
    const r = await estimatePlsR(data, toSpec(model), options('mean'), 'cSEM');
    const sq = r.constructs.indexOf('Service Quality'), pf = r.constructs.indexOf('Price Fairness');
    expect(at(r.htmt2, sq, pf)).toBeNull();
    expect(at(r.htmt, sq, pf)).toBeGreaterThan(0);
    expect(at(r.htmt, sq, pf)).toBeLessThan(0.15);
    const tr = r.constructs.indexOf('Trust');
    expect(at(r.htmt2, pf, tr)).toBeNull(); // 3 × 3 correlations: cSEM would return an odd root of a negative product
    expect(at(r.htmt, pf, tr)).toBeLessThan(0.15);
    // Price Fairness is unrelated to every other construct: those pairs have no HTMT2 and a small HTMT; the others are intact.
    for (let i = 0; i < r.constructs.length; i++) for (let j = 0; j < i; j++) {
      if ([i, j].includes(pf)) { expect(at(r.htmt, i, j), `htmt ${i},${j}`).toBeLessThan(0.2); continue; }
      expect(at(r.htmt2, i, j), `htmt2 ${i},${j}`).toBeGreaterThan(0);
      expect(at(r.htmt2, i, j), `htmt2 ${i},${j}`).toBeLessThan(1);
    }
    expect(r.warnings).toEqual([]);  // an explanation, not a warning
    const w = r.notes!.join('\n');
    expect(w).toMatch(/The items of Service Quality and Price Fairness; of Price Fairness and Trust.* correlate with mixed signs/);
    expect(w).not.toContain('reverse-coded');
    expect(w).not.toContain('is not reported');
    expect(w).not.toContain('heterotrait-heteromethod');
    expect(w).not.toContain('all-positive or all-negative');
    expect(w).not.toContain('NaNs produced');
  }, 120_000);

  it('reports the diagnostics once for a multiply-imputed result', async () => {
    const { data, model } = independentPf();
    const r = await estimatePlsR(data, toSpec(model), options('mi'), 'cSEM');
    const notes = r.notes!.filter((w) => w.includes('mixed signs') || w.includes('HTMT'));
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('Service Quality and Price Fairness');
    const sq = r.constructs.indexOf('Service Quality'), pf = r.constructs.indexOf('Price Fairness');
    expect(at(r.htmt2, sq, pf)).toBeNull();
  }, 180_000);

  it('points to a reverse-coded item within a construct', async () => {
    const { data, model } = independentPf();
    const k = data.names.indexOf('TR2');
    const cols = data.cols.map((c, i) => (i === k ? Float64Array.from(c, (x) => 8 - x) : c));
    const r = await estimatePlsR({ ...data, cols }, toSpec(model), options('casewise'), 'cSEM');
    const w = r.notes!.join('\n');
    expect(w).toContain('Some items of Trust correlate negatively with the others: is an item reverse-coded?');
    // the mixed signs that the reversed item causes are not mistaken for weak correlations
    const mixedNote = r.notes!.find((x) => x.includes('nearly uncorrelated'))!;
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
