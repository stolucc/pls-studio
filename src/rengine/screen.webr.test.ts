// Data screening in webR equals psych and semfindr in desktop R
// (scripts/validation/screen.R). Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Dataset } from '../engine/types';
import { toSpec, type ModelState } from '../model/project';
import { rCall, type RPackage } from './bridge';
import { influenceR, screenR, screenScriptR } from './screen';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const ref = JSON.parse(readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'screen', 'reference.json'), 'utf8'));
const load = async (pkg: RPackage, name: string): Promise<Dataset> => {
  const raw = await rCall<{ names: string[]; cols: (number | null)[][] }>('ps_dataset', { package: pkg, name, na: [] }, pkg);
  return { names: raw.names, cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))) };
};

describe('data screening', () => {
  it('distributions, Mardia’s test and Mahalanobis outliers equal psych (HS, x1 missing in rows 3 and 10)', async () => {
    const hs = await load('lavaan', 'HolzingerSwineford1939');
    const vars = Array.from({ length: 9 }, (_, i) => `x${i + 1}`);
    const x1 = hs.cols[hs.names.indexOf('x1')].slice();
    x1[2] = NaN; x1[9] = NaN;
    const data = { ...hs, cols: hs.cols.map((c, k) => (hs.names[k] === 'x1' ? x1 : c)) };
    const r = await screenR(data, vars, 0.001);
    r.describe.forEach((d, i) => {
      expect(d.skew, vars[i]).toBeCloseTo(ref.describe.skew[i], 8);
      expect(d.kurtosis, vars[i]).toBeCloseTo(ref.describe.kurtosis[i], 8);
      expect(d.n).toBe(ref.describe.n[i]);
    });
    expect(r.describe[0].missing).toBe(2);
    for (const k of ['b1p', 'b2p', 'skew', 'kurtosis'] as const) expect(r.mardia[k], k).toBeCloseTo(ref.mardia[k], 8);
    expect(r.mardia.pKurt).toBeCloseTo(ref.mardia.pKurt, 10);
    expect(r.cases.rows).not.toContain(3);
    expect(r.cases.rows).toHaveLength(299);
    const top = r.cases.rows.map((row, i) => ({ row, d2: r.cases.d2[i] })).sort((a, b) => b.d2 - a.d2).slice(0, 5);
    expect(top.map((x) => x.row)).toEqual(ref.mahalanobis.rows);
    top.forEach((x, i) => expect(x.d2).toBeCloseTo(ref.mahalanobis.d2[i], 8));
    expect(await screenScriptR(data, vars, 0.001)).toContain('mard <- mardia(Xc, plot = FALSE)');
  }, 600_000);

  it('case influence of a CFA equals semfindr (?cfa_dat2)', async () => {
    const d = await load('semfindr', 'cfa_dat2');
    const C = (id: string, inds: string[]) => ({ id, name: id, type: 'factor' as const, mode: 'A' as const, indicators: inds, x: 0, y: 0, side: 'left' as const });
    const model: ModelState = { constructs: [C('f1', ['x1', 'x2', 'x3']), C('f2', ['x4', 'x5', 'x6'])], paths: [], moderations: [], correlations: [{ id: 'k', kind: 'construct', a: 'f1', b: 'f2' }] };
    const r = await influenceR(d, toSpec(model), 'casewise', 'ML');
    expect(r.rows).toHaveLength(100);
    const top = r.rows.map((row, i) => ({ row, i })).sort((a, b) => r.gcd[b.i] - r.gcd[a.i]).slice(0, 5);
    expect(top.map((x) => x.row)).toEqual(ref.influence.rows);
    top.forEach((x, k) => {
      expect(r.gcd[x.i]).toBeCloseTo(ref.influence.gcd[k], 6);
      expect(r.chisq[x.i]).toBeCloseTo(ref.influence.chisq[k], 6);
      expect(r.cfi[x.i]).toBeCloseTo(ref.influence.cfi[k], 6);
    });
  }, 900_000);
});
