// Ordinal PLS (OrdPLS / OrdPLSc; Schuberth, Henseler & Dijkstra 2018) through the cSEM
// bridge: the OrdPLScPredict example of cSEM's ?predict help page (BergamiBagozzi2000,
// the items as ordered factors), against scripts/validation/ordinal_pls.R.
// Run with npm run test:webr (or natively: WEBR_TESTS=1 PS_NATIVE_R=1).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Dataset, ModelSpec, PlsOptions } from '../engine/types';
import { bootstrapR } from './analyses';
import { rCall } from './bridge';
import { estimatePlsR, plsRequest, plsScriptR } from './pls';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

type Part = { paths: Record<string, number>; loadings: Record<string, number>; weights: Record<string, number>; r2: Record<string, number>; rhoA: Record<string, number>; ave: Record<string, number>; srmr: number };
const ref = JSON.parse(readFileSync(join(__dirname, '__fixtures__', 'ordinal_pls_csem_bergami.r.json'), 'utf8')) as { n: number; ordPLSc: Part; ordPLS: Part; bootSd: Record<string, number> };

const items = (p: string, k: number) => Array.from({ length: k }, (_, i) => `${p}${i + 1}`);
const fac = (name: string, indicators: string[]) => ({ name, type: 'factor' as const, mode: 'A' as const, indicators });
const constructs = [fac('OrgPres', items('cei', 8)), fac('OrgIden', items('ma', 6)), fac('AffJoy', ['orgcmt1', 'orgcmt2', 'orgcmt3', 'orgcmt7']), fac('AffLove', ['orgcmt5', 'orgcmt6', 'orgcmt8'])];
const ordered = constructs.flatMap((c) => c.indicators);
const spec: ModelSpec = { constructs, paths: [{ from: 'OrgPres', to: 'OrgIden' }, { from: 'OrgIden', to: 'AffLove' }, { from: 'OrgIden', to: 'AffJoy' }], ordered };
const opts = (consistent: boolean): PlsOptions => ({ scheme: 'path', consistent, missing: 'casewise', tolerance: 1e-10, maxIter: 1000 });
const load = async (): Promise<Dataset> => {
  const raw = await rCall<{ names: string[]; cols: (number | null)[][] }>('ps_dataset', { package: 'cSEM', name: 'BergamiBagozzi2000', na: [] }, 'cSEM');
  return { names: raw.names, cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))) };
};

describe('ordinal PLS through the cSEM bridge (BergamiBagozzi2000, ?predict)', () => {
  it.each([['OrdPLSc', true], ['OrdPLS', false]] as const)('%s reproduces cSEM run natively', async (what, consistent) => {
    const r = await estimatePlsR(await load(), spec, opts(consistent), 'cSEM');
    const e = what === 'OrdPLSc' ? ref.ordPLSc : ref.ordPLS;
    const at = (n: string) => r.constructs.indexOf(n);
    expect(r.n).toBe(ref.n);
    for (const [k, b] of Object.entries(e.paths)) { const [f, t] = k.split(' -> '); expect(r.pathCoef[at(f)][at(t)], k).toBeCloseTo(b, 6); }
    r.indicators.forEach((ind, j) => {
      expect(r.loadings[j], ind.name).toBeCloseTo(e.loadings[ind.name], 6);
      expect(r.weights[j], ind.name).toBeCloseTo(e.weights[ind.name], 6);
    });
    for (const [k, v] of Object.entries(e.r2)) expect(r.rSquared[at(k)], k).toBeCloseTo(v, 6);
    // (Without disattenuation cSEM reports rho_A = 1; the bridge computes Dijkstra & Henseler's rho_A, which depends on the
    // weights and the (polychoric) correlations only: cSEM's OrdPLSc value, as PLS and PLSc share the weights.)
    for (const [k, v] of Object.entries(ref.ordPLSc.rhoA)) expect(r.quality[at(k)].rhoA, k).toBeCloseTo(v, 6);
    if (!consistent) expect(Object.values(e.rhoA).every((v) => v === 1)).toBe(true);
    for (const [k, v] of Object.entries(e.ave)) expect(r.quality[at(k)].ave, k).toBeCloseTo(v, 6);
    expect(r.fit.estimated.srmr).toBeCloseTo(e.srmr, 6);
    expect(r.ordinal).toEqual(ordered);
    // (the HTMT sign diagnostics work on the polychoric correlations: AffLove's items run against OrgPres's)
    expect(r.notes).toEqual([expect.stringMatching(/^The items of OrgPres and AffLove correlate with mixed signs/)]);
  }, 600_000);

  it('bootstraps OrdPLSc with cSEM’s resampling, as cSEM natively', async () => {
    const res = await bootstrapR(await load(), spec, { kind: 'plsBoot', pkg: 'cSEM', options: opts(true), boot: { samples: 100, seed: 1234, confidence: 0.95 } }, () => '');
    for (const [k, sd] of Object.entries(ref.bootSd)) {
      const [to, from] = k.split(' ~ ');
      // (100 resamples of polychoric fits: webR's floating point moves a resample's estimate slightly, the SDs agree to ~1e-4)
      expect(res.stats.find((s) => s.key === `path:${from}:${to}`)!.sd, k).toBeCloseTo(sd, 3);
    }
  }, 900_000);

  it('exports the script it runs: the items as ordered factors before csem()', async () => {
    const script = await plsScriptR(await load(), spec, opts(true), 'cSEM');
    expect(script).toContain('Ordinal PLS (OrdPLSc, cSEM)');
    expect(script).toContain('data[ordinal] <- lapply(data[ordinal], ordered)');
    expect(script.indexOf('lapply(data[ordinal], ordered)')).toBeLessThan(script.indexOf('fit <- csem('));
  }, 600_000);

  it('refuses where ordinal PLS is not available', async () => {
    const d = await load();
    await expect(estimatePlsR(d, spec, opts(true), 'seminr')).rejects.toThrow(/seminr has no ordinal PLS/);
    const gap = { ...d, cols: d.cols.map((c, i) => (d.names[i] === 'cei1' ? Float64Array.from(c, (v, k) => (k === 0 ? NaN : v)) : c)) };
    await expect(estimatePlsR(gap, spec, { ...opts(true), missing: 'mean' }, 'cSEM')).rejects.toThrow(/Mean replacement would put non-category values/);
    await expect(estimatePlsR(d, spec, { ...opts(false), approach: 'GSCA' }, 'cSEM')).rejects.toThrow(/choose PLS-PM/);
    // Other PLS analyses are for continuous indicators.
    await expect(rCall('ps_fittest', { ...plsRequest(d, spec, opts(true), 'cSEM'), boot: { samples: 20, seed: 1, confidence: 0.95 } }, 'cSEM')).rejects.toThrow(/for continuous indicators/);
  }, 600_000);
});
