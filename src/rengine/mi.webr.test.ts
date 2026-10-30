// Multiple imputation (mice) pooled: CB-SEM by lavaan.mi (Rubin's rules), PLS
// estimates averaged, in webR against desktop R (scripts/validation/mi.R).
// The missing cells are the reference's (R's sample() with its seeds), passed in.
// Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Dataset } from '../engine/types';
import { toSpec, type ModelState } from '../model/project';
import { rCall, type RPackage } from './bridge';
import { estimateCbLavaan } from './lavaan';
import { estimatePlsR } from './pls';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const ref = JSON.parse(readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'mi', 'reference.json'), 'utf8'));
const load = async (pkg: RPackage, name: string): Promise<Dataset> => {
  const raw = await rCall<{ names: string[]; cols: (number | null)[][] }>('ps_dataset', { package: pkg, name, na: [] }, pkg);
  return { names: raw.names, cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))) };
};
/** Keep `vars`, with the given 1-based rows of some columns missing. */
const withMissing = (d: Dataset, vars: string[], missing: Record<string, number[]>): Dataset => ({
  names: vars,
  cols: vars.map((v) => { const c = d.cols[d.names.indexOf(v)].slice(); for (const r of missing[v] ?? []) c[r - 1] = NaN; return c; }),
});
const C = (id: string, inds: string[], type: 'factor' | 'composite' = 'factor') => ({ id, name: id, type, mode: (type === 'composite' ? 'B' : 'A') as 'A' | 'B', indicators: inds, x: 0, y: 0, side: 'left' as const });

describe('multiple imputation', () => {
  it('CB-SEM: pooled estimates, SEs and fit equal lavaan.mi', async () => {
    const hs = await load('lavaan', 'HolzingerSwineford1939');
    const data = withMissing(hs, Array.from({ length: 9 }, (_, i) => `x${i + 1}`), ref.cb.hsMissing);
    const model: ModelState = { constructs: [C('visual', ['x1', 'x2', 'x3']), C('textual', ['x4', 'x5', 'x6']), C('speed', ['x7', 'x8', 'x9'])], paths: [], moderations: [],
      correlations: [{ id: 'a', kind: 'construct', a: 'visual', b: 'textual' }, { id: 'b', kind: 'construct', a: 'visual', b: 'speed' }, { id: 'c', kind: 'construct', a: 'textual', b: 'speed' }] };
    const r = await estimateCbLavaan(data, toSpec(model), 'mi', 'ML', 'product', { m: 5, seed: 1 });
    expect(r.imputations).toBe(5);
    expect(r.n).toBe(301);
    for (const [k, v] of Object.entries(ref.cb.loadings as Record<string, number>)) {
      const [l, i] = k.split(' ');
      const e = r.estimates.find((x) => x.op === '=~' && x.lhs === l && x.rhs === i)!;
      expect(e.est, k).toBeCloseTo(v, 6);
      expect(e.se!, `${k} se`).toBeCloseTo(ref.cb.se[k], 6);
    }
    expect(r.fit.chisq).toBeCloseTo(ref.cb.chisq, 4);
    expect(r.fit.cfi).toBeCloseTo(ref.cb.cfi, 6);
    // The pooled covariance matrix (lavaan.mi's, rebuilt from the per-imputation fits where its S4 method is not dispatched).
    expect(r.vcov).not.toBeNull();
    // (by parameter: lavaan names them "lhs=~rhs"; the app's syntax orders them differently)
    for (const e of r.estimates.filter((x) => x.index !== undefined && x.lhs !== x.rhs)) {
      const want = (ref.cb.vcovDiag as Record<string, number>)[`${e.lhs}${e.op}${e.rhs}`] ?? (ref.cb.vcovDiag as Record<string, number>)[`${e.rhs}${e.op}${e.lhs}`];
      if (want !== undefined) expect(r.vcov![e.index!][e.index!], `${e.lhs}${e.op}${e.rhs}`).toBeCloseTo(want, 8);
    }
  }, 900_000);

  it('CB-SEM with groups (metric invariance): pooled per-group loadings and SEs equal lavaan.mi', async () => {
    const raw = await rCall<{ names: string[]; cols: (number | null)[][]; levels?: Record<string, string[]> }>('ps_dataset', { package: 'lavaan', name: 'HolzingerSwineford1939', na: [] }, 'lavaan');
    const hs: Dataset = { names: raw.names, cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))) };
    const vars = [...Array.from({ length: 9 }, (_, i) => `x${i + 1}`), 'school'];
    const data: Dataset = { ...withMissing(hs, vars, ref.cb.hsMissing), categories: { school: raw.levels!.school } };
    const model: ModelState = { constructs: [C('visual', ['x1', 'x2', 'x3']), C('textual', ['x4', 'x5', 'x6']), C('speed', ['x7', 'x8', 'x9'])], paths: [], moderations: [],
      correlations: [{ id: 'a', kind: 'construct', a: 'visual', b: 'textual' }, { id: 'b', kind: 'construct', a: 'visual', b: 'speed' }, { id: 'c', kind: 'construct', a: 'textual', b: 'speed' }],
      multigroup: { column: 'school', invariance: 'metric', free: [] } };
    const r = await estimateCbLavaan(data, toSpec(model), 'mi', 'ML', 'product', { m: 5, seed: 1 });
    expect(r.groups!.labels).toEqual(ref.groups.labels);
    expect(r.fit.chisq).toBeCloseTo(ref.groups.chisq, 3);
    r.groups!.results.forEach((g, k) => {
      for (const [key, v] of Object.entries(ref.groups.loadings[String(k + 1)] as Record<string, number>)) {
        const [l, i] = key.split(' ');
        const e = g.estimates.find((x) => x.op === '=~' && x.lhs === l && x.rhs === i)!;
        expect(e.est, `group ${k + 1} ${key}`).toBeCloseTo(v, 5);
        expect(e.se!, `group ${k + 1} ${key} se`).toBeCloseTo(ref.groups.se[String(k + 1)][key], 5);
      }
    });
  }, 900_000);

  it('PLS: estimates averaged over the imputed data sets equal cSEM', async () => {
    const sat = await load('cSEM', 'satisfaction');
    const vars = [...['expe1', 'expe2', 'expe3'], ...['qual1', 'qual2', 'qual3'], ...['sat1', 'sat2', 'sat3']];
    const data = withMissing(sat, vars, ref.pls.satMissing);
    const model: ModelState = { constructs: [C('EXPE', ['expe1', 'expe2', 'expe3']), C('QUAL', ['qual1', 'qual2', 'qual3'], 'composite'), C('SAT', ['sat1', 'sat2', 'sat3'])],
      paths: [{ id: 'p1', from: 'EXPE', to: 'QUAL' }, { id: 'p2', from: 'EXPE', to: 'SAT' }, { id: 'p3', from: 'QUAL', to: 'SAT' }], moderations: [] };
    const r = await estimatePlsR(data, toSpec(model), { scheme: 'path', consistent: false, missing: 'mi', tolerance: 1e-7, maxIter: 300, mi: { m: 5, seed: 3 } }, 'cSEM');
    expect(r.imputations).toBe(5);
    for (const [k, v] of Object.entries(ref.pls.paths as Record<string, number>)) {
      const [f, t] = k.split(' -> ');
      expect(r.pathCoef[r.constructs.indexOf(f)][r.constructs.indexOf(t)], k).toBeCloseTo(v, 6);
    }
  }, 900_000);
});
