// The parallel option in webR: bootstrap chunks spread over several R sessions
// give the same results for any number of sessions, equal to one R session
// drawing all chunks (the exported script); off, the package's single run is
// unchanged. Simulation chunks give the same results in any session.
// Run with npm run test:webr.

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Dataset, ModelSpec } from '../engine/types';
import { summariseMc, type McDesign } from '../engine/montecarlo';
import { bootstrapR } from './analyses';
import { rCall } from './bridge';
import { bootChunks, useCompute } from './compute';
import { cbRequest } from './lavaan';
import { runMcChunkR } from './mc';
import { plsRequest } from './pls';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);
afterEach(() => useCompute.getState().set({ workers: 1 }));

const load = async (pkg: 'cSEM' | 'lavaan', name: string): Promise<Dataset> => {
  const raw = await rCall<{ names: string[]; cols: (number | null)[][] }>('ps_dataset', { package: pkg, name, na: [] }, pkg);
  return { names: raw.names, cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))) };
};
const items = (p: string, k: number, from = 1) => Array.from({ length: k }, (_, i) => `${p}${i + from}`);
const fac = (name: string, ind: string[]) => ({ name, type: 'factor' as const, mode: 'A' as const, indicators: ind });
const boot = { samples: 250, seed: 11, confidence: 0.95 };
const options = { scheme: 'path' as const, consistent: false, tolerance: 1e-7, maxIter: 300, missing: 'casewise' as const };

describe('parallel bootstrap', () => {
  it('cSEM: identical for 2 and 3 sessions, equal to one session drawing all chunks; off = the single run', async () => {
    const d = await load('cSEM', 'satisfaction');
    const spec: ModelSpec = { constructs: [fac('EXPE', items('expe', 3)), fac('SAT', items('sat', 4)), fac('LOY', items('loy', 4))], paths: [{ from: 'EXPE', to: 'SAT' }, { from: 'SAT', to: 'LOY' }] };
    const a = { kind: 'plsBoot' as const, pkg: 'cSEM' as const, options, boot };
    const single = await bootstrapR(d, spec, a, () => '');
    const plain = await rCall<{ stats: { key: string; sd: number }[] }>('ps_pls_boot', { ...plsRequest(d, spec, options, 'cSEM'), boot }, 'cSEM');
    expect(single.stats.map((s) => s.sd)).toEqual(plain.stats.map((s) => s.sd));
    useCompute.getState().set({ workers: 3 });
    const seen: number[] = [];
    const r3 = await bootstrapR(d, spec, a, () => '', (done) => seen.push(done));
    expect(seen).toEqual([1, 2, 3]);
    useCompute.getState().set({ workers: 2 });
    const r2 = await bootstrapR(d, spec, a, () => '');
    expect(r2.stats).toEqual(r3.stats);
    const plan = bootChunks(boot.samples, boot.seed);
    const whole = await rCall<{ stats: { key: string; sd: number; ciLow: number }[] }>('ps_pls_boot', { ...plsRequest(d, spec, options, 'cSEM'), boot: { ...boot, chunkR: plan.R, chunkSeed: plan.seed } }, 'cSEM');
    for (const s of r3.stats) {
      const w = whole.stats.find((x) => x.key === s.key)!;
      expect(s.sd, s.key).toBeCloseTo(w.sd, 12);
      expect(s.ciLow, s.key).toBeCloseTo(w.ciLow, 12);
    }
    expect(r3.stats.find((s) => s.key === 'path:SAT:LOY')!.sd).not.toBe(single.stats.find((s) => s.key === 'path:SAT:LOY')!.sd);
  }, 900_000);

  it('lavaan: identical for 2 and 3 sessions, equal to one session drawing all chunks', async () => {
    const d = await load('lavaan', 'HolzingerSwineford1939');
    const spec: ModelSpec = { constructs: [fac('visual', items('x', 3)), fac('textual', items('x', 3, 4)), fac('speed', items('x', 3, 7))], paths: [{ from: 'visual', to: 'textual' }, { from: 'textual', to: 'speed' }] };
    const a = { kind: 'cbBoot' as const, estimator: 'ML' as const, missing: 'casewise' as const, boot: { ...boot, samples: 150 } };
    useCompute.getState().set({ workers: 3 });
    const r3 = await bootstrapR(d, spec, a, () => '');
    useCompute.getState().set({ workers: 2 });
    const r2 = await bootstrapR(d, spec, a, () => '');
    expect(r2.stats).toEqual(r3.stats);
    const plan = bootChunks(150, boot.seed);
    const whole = await rCall<{ stats: { key: string; sd: number }[] }>('ps_cb_boot', { ...cbRequest(d, spec, 'casewise', 'ML'), boot: { ...boot, samples: 150, chunkR: plan.R, chunkSeed: plan.seed } }, 'lavaan');
    for (const s of r3.stats) expect(s.sd, s.key).toBeCloseTo(whole.stats.find((x) => x.key === s.key)!.sd, 12);
  }, 900_000);
});

it('cSEM bootstraps a model without indirect effects', async () => {
  const d = await load('cSEM', 'satisfaction');
  const spec: ModelSpec = { constructs: [fac('SAT', items('sat', 4)), fac('LOY', items('loy', 4))], paths: [{ from: 'SAT', to: 'LOY' }] };
  const r = await bootstrapR(d, spec, { kind: 'plsBoot', pkg: 'cSEM', options, boot: { ...boot, samples: 100 } }, () => '');
  expect(r.stats.find((s) => s.key === 'path:SAT:LOY')!.sd).toBeGreaterThan(0);
  expect(r.stats.some((s) => s.group === 'indirect')).toBe(false);
}, 900_000);

it('simulation chunks give the same results in any R session', async () => {
  const f = (name: string, p: string) => ({ name, type: 'factor' as const, indicators: [1, 2, 3].map((i) => `${p}${i}`), loadings: [0.8, 0.7, 0.75] });
  const design: McDesign = {
    population: { constructs: [f('A', 'a'), f('B', 'b')], paths: [{ from: 'A', to: 'B', value: 0.4 }], exoCor: [] },
    estimators: [{ id: 'PLS', method: 'pls', consistent: false }], sampleSizes: [200], replications: 6, seed: 3, alpha: 0.05, bootSamples: 0, mcDraws: 0,
  };
  const s0 = summariseMc(design, [await runMcChunkR(design, 200, 0, 3, 0), await runMcChunkR(design, 200, 3, 6, 0)]);
  const s1 = summariseMc(design, [await runMcChunkR(design, 200, 3, 6, 1), await runMcChunkR(design, 200, 0, 3, 2)]);
  expect(s1).toEqual(s0);
}, 900_000);
