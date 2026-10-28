// Every package example: its dataset loads from the package in webR, contains
// the model's indicators, and the package estimates the example as documented.
// Run with npm run test:webr.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CbEstimator } from '../engine/cbsem';
import { DEFAULT_SETTINGS, toSpec } from '../model/project';
import { miivR } from '../rengine/analyses';
import { rCall } from '../rengine/bridge';
import { estimateCbLavaan } from '../rengine/lavaan';
import { estimatePlsR } from '../rengine/pls';
import { startTestRuntime, stopTestRuntime } from '../rengine/webrTestRuntime';
import { exampleModel, PACKAGE_EXAMPLES } from './packages';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

describe.each(PACKAGE_EXAMPLES.map((e) => [e.id, e] as const))('package example %s in webR', (_id, ex) => {
  it('loads its data from the package and estimates', async () => {
    const raw = await rCall<{ names: string[]; cols: (number | null)[][]; n: number }>('ps_dataset', { package: ex.data.package, name: ex.data.name, na: ex.data.na ?? [] }, ex.data.package);
    const data = { names: raw.names, cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))) };
    const model = exampleModel(ex);
    const spec = toSpec(model);
    for (const c of spec.constructs) for (const i of c.indicators) expect(raw.names, `${ex.id}: ${i}`).toContain(i);
    const st = { ...DEFAULT_SETTINGS, ...ex.settings };
    if (st.method === 'cbsem' && st.estimator === '2SLS') {
      const r = await miivR(data, spec, st.missing);
      expect(r.equations.length).toBeGreaterThan(0);
    } else if (st.method === 'cbsem') {
      const r = await estimateCbLavaan(data, spec, st.missing, st.estimator as CbEstimator);
      expect(r.converged).toBe(true);
      if (ex.id === 'lavaan-poldem') expect(r.fit.chisq).toBeCloseTo(38.125, 2);
    } else {
      const r = await estimatePlsR(data, spec, { scheme: st.scheme, consistent: st.consistent, missing: st.missing, tolerance: 1e-7, maxIter: 300 }, st.plsPackage);
      expect(r.converged).toBe(true);
    }
  }, 600_000);
});
