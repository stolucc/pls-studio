// Every package example: its dataset loads from the package in webR, contains
// the columns the example uses, and the package estimates the example as
// documented. Run with npm run test:webr.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CbEstimator } from '../engine/cbsem';
import type { Dataset } from '../engine/types';
import { DEFAULT_SETTINGS, toSpec } from '../model/project';
import { processInput } from '../process/input';
import { miivR } from '../rengine/analyses';
import { rCall } from '../rengine/bridge';
import { estimateCpaR } from '../rengine/cpa';
import { irtR, lcaR } from '../rengine/items';
import { estimateCbLavaan } from '../rengine/lavaan';
import { growthR } from '../rengine/longitudinal';
import { estimatePlsR } from '../rengine/pls';
import { startTestRuntime, stopTestRuntime } from '../rengine/webrTestRuntime';
import { exampleModel, PACKAGE_EXAMPLES, type PackageExample } from './packages';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

/** Documented values the estimate must reproduce. */
const CHISQ: Record<string, number> = { 'lavaan-poldem': 40.179, 'lavaan-hs': 85.306, 'lavaan-hs-groups': 164.103 };

async function load(ex: PackageExample): Promise<Dataset & { levels?: unknown }> {
  const raw = await rCall<{ names: string[]; cols: (number | null)[][]; n: number; levels?: unknown }>('ps_dataset', { package: ex.data.package, name: ex.data.name, na: ex.data.na ?? [] }, ex.data.package);
  return { names: raw.names, cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))), levels: raw.levels };
}

describe.each(PACKAGE_EXAMPLES.map((e) => [e.id, e] as const))('package example %s in webR', (_id, ex) => {
  it('loads its data from the package and estimates', async () => {
    const data = await load(ex);
    const st = { ...DEFAULT_SETTINGS, ...ex.settings };
    if (ex.panel) {
      const p = ex.panel;
      const cols = p.kind === 'growth' ? [...p.measures, ...p.covariates] : p.items;
      for (const c of cols) expect(data.names, `${ex.id}: ${c}`).toContain(c);
      if (p.kind === 'growth') {
        const r = await growthR(data, { ...p, estimator: 'ML', missing: st.missing });
        expect(r.fit.df).toBe(5);  // ?growth: linear growth on four occasions
      } else if (p.kind === 'irt') {
        const r = await irtR(data, p.items, p.model);
        expect(r.params.length).toBe(p.items.length);
        if (ex.id === 'ltm-lsat') expect(r.logLik).toBeCloseTo(-2466.9376, 3);  // rasch(LSAT) in native R (ltm 1.2-0)
      } else {
        const r = await lcaR(data, p.items, Array.from({ length: p.to - p.from + 1 }, (_, i) => p.from + i), 10, 1);
        expect(r.models.map((m) => m.k)).toEqual(Array.from({ length: p.to - p.from + 1 }, (_, i) => p.from + i));
      }
      return;
    }
    const model = exampleModel(ex);
    const spec = toSpec(model);
    for (const c of spec.constructs) for (const i of c.indicators) expect(data.names, `${ex.id}: ${i}`).toContain(i);
    for (const col of [ex.multigroup?.column, ex.multilevel?.column]) if (col) expect(data.names).toContain(col);
    if (st.method === 'process') {
      const input = processInput(model, st, data)!;
      const r = await estimateCpaR(data, { ...input, boot: { samples: 200, seed: 1 } });
      expect(r.equations.length).toBeGreaterThan(0);
    } else if (st.method === 'cbsem' && st.estimator === '2SLS') {
      const r = await miivR(data, spec, st.missing);
      expect(r.equations.length).toBeGreaterThan(0);
    } else if (st.method === 'cbsem') {
      const r = await estimateCbLavaan(data, spec, st.missing, st.estimator as CbEstimator, st.interaction);
      expect(r.converged).toBe(true);
      if (CHISQ[ex.id] !== undefined) expect(r.fit.chisq).toBeCloseTo(CHISQ[ex.id], 2);
    } else {
      const r = await estimatePlsR(data, spec, { scheme: st.scheme, consistent: st.consistent, missing: st.missing, tolerance: 1e-7, maxIter: 300 }, st.plsPackage);
      expect(r.converged).toBe(true);
    }
  }, 600_000);
});

it('factors arrive as codes in level order, with their levels', async () => {
  const d = await load(PACKAGE_EXAMPLES.find((e) => e.id === 'lavaan-hs-groups')!);
  const school = d.cols[d.names.indexOf('school')];
  expect(new Set(school)).toEqual(new Set([1, 2]));
  expect((d.levels as Record<string, string[]>).school).toEqual(['Grant-White', 'Pasteur']);
}, 600_000);
