// End-to-end through webR: MIIVsem, cSEM's IPMA and fit test against the
// reference corpus; bootstrap resampling by cSEM, seminr and lavaan checked
// against the built-in bootstrap of the same model (same parameters; standard
// errors agree up to Monte Carlo error). Run with npm run test:webr.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCb, bootstrapPls } from '../engine/bootstrap';
import type { CbEstimator } from '../engine/cbsem';
import type { PlsOptions } from '../engine/types';
import { cases, checkIpmaResult, checkMiivResult, close, loadData, toSpec } from '../engine/validationHarness';
import { analysisScript, bootstrapR, fitTestR, ipmaR, miivR } from './analyses';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);
const T = 600_000;
const byName = (n: string) => cases.find((c) => c.name === n)!;
const PLS: PlsOptions = { scheme: 'path', consistent: false, missing: 'mean', tolerance: 1e-12, maxIter: 1000 };

describe.each(cases.filter((c) => c.kind === 'miiv' || c.source === 'MIIVsem').map((c) => c.name))('MIIVsem in webR: %s', (name) => {
  it('reproduces the reference', async () => checkMiivResult(byName(name), await miivR(loadData(byName(name)), toSpec(byName(name)), 'casewise')), T);
});

describe.each(cases.filter((c) => c.kind === 'ipma').map((c) => c.name))('cSEM IPMA in webR: %s', (name) => {
  it('reproduces the reference', async () => {
    const c = byName(name);
    const o = c.options as { target: string; rescale: boolean; min?: number | null; max?: number | null };
    checkIpmaResult(c, await ipmaR(loadData(c), toSpec(c), PLS, { target: o.target, rescale: o.rescale, min: o.min ?? undefined, max: o.max ?? undefined }));
  }, T);
});

it('cSEM fit test: observed discrepancies match the reference, quantiles exceed nothing absurd', async () => {
  const c = byName('pls_csem_threecommonfactors');
  const r = await fitTestR(loadData(c), toSpec(c), PLS, { samples: 50, seed: 1, confidence: 0.95 });
  const e = (c.expected as { fit: Record<'estimated' | 'saturated', Record<'srmr' | 'dULS' | 'dG', number>> }).fit;
  for (const w of ['estimated', 'saturated'] as const) for (const d of ['srmr', 'dULS', 'dG'] as const) {
    close(r.observed[w][d], e[w][d], 1e-6, `${w} ${d}`);
    expect(r.hi99[w][d]).toBeGreaterThanOrEqual(r.hi95[w][d]);
  }
}, T);

function compareBoot(rStats: { key: string; sd: number; original: number }[], builtin: { key: string; sd: number; original: number }[], groups: string[]) {
  for (const g of groups) {
    const mine = builtin.filter((s) => s.key.startsWith(`${g}:`));
    expect(mine.length, `${g} present in built-in`).toBeGreaterThan(0);
    for (const s of mine) {
      const r = rStats.find((x) => x.key === s.key);
      expect(r, `R bootstrap has ${s.key}`).toBeDefined();
      close(r!.original, s.original, 1e-4, `original ${s.key}`);
      expect(Math.abs(r!.sd - s.sd) / s.sd, `sd ${s.key}: R ${r!.sd} vs built-in ${s.sd}`).toBeLessThan(0.25);
    }
  }
}

it('cSEM bootstrap agrees with the built-in bootstrap', async () => {
  const c = byName('pls_csem_threecommonfactors');
  const boot = { samples: 300, seed: 11, confidence: 0.95 };
  const r = await bootstrapR(loadData(c), toSpec(c), { kind: 'plsBoot', pkg: 'cSEM', options: PLS, boot }, () => 'x');
  compareBoot(r.stats, bootstrapPls(loadData(c), toSpec(c), PLS, boot).stats, ['path', 'total', 'loading', 'r2']);
}, T);

it('seminr bootstrap: refused in the browser (needs worker processes) but exportable', async () => {
  const c = byName('pls_seminr_mobi_A');
  const boot = { samples: 50, seed: 11, confidence: 0.95 };
  const opts = { ...PLS, tolerance: 1e-7, maxIter: 300 };
  await expect(bootstrapR(loadData(c), toSpec(c), { kind: 'plsBoot', pkg: 'seminr', options: opts, boot }, () => 'x')).rejects.toThrow(/worker processes/);
  expect(await analysisScript(loadData(c), toSpec(c), { kind: 'plsBoot', pkg: 'seminr', options: opts, boot })).toContain('bootstrap_model(fit, nboot = 50, seed = 11, cores = cores)');
}, T);

it('lavaan bootstrap agrees with the built-in bootstrap', async () => {
  const c = byName('cb_lavaan_threecf_ml');
  const boot = { samples: 300, seed: 11, confidence: 0.95 };
  const r = await bootstrapR(loadData(c), toSpec(c), { kind: 'cbBoot', estimator: 'ML' as CbEstimator, missing: 'casewise', boot }, () => 'x');
  expect(r.failed).toBe(0);
  compareBoot(r.stats, bootstrapCb(loadData(c), toSpec(c), 'casewise', boot).stats, ['path', 'total', 'loading', 'r2']);
}, T);

it('exports bootstrap, fit-test, IPMA and MIIV scripts', async () => {
  const c = byName('pls_csem_threecommonfactors');
  const boot = { samples: 100, seed: 1, confidence: 0.95 };
  expect(await analysisScript(loadData(c), toSpec(c), { kind: 'plsBoot', pkg: 'cSEM', options: PLS, boot })).toContain('.resample_method = "bootstrap", .R = 100');
  expect(await analysisScript(loadData(c), toSpec(c), { kind: 'fitTest', options: PLS, boot })).toContain('testOMF(fit, .R = 100');
  expect(await analysisScript(loadData(c), toSpec(c), { kind: 'ipma', options: PLS, ipma: { target: 'eta3', rescale: true } })).toContain('ipma <- doIPMA(fit)');
  const m = byName('miiv_miivsem_poldem');
  const script = await analysisScript(loadData(m), toSpec(m), { kind: 'miiv', missing: 'casewise' });
  expect(script).toContain('fit <- miive(model, data, var.cov = TRUE)');
  // Standardisation uses MIIVsem's own estimates held fixed: no second estimation by ML.
  expect(script).toContain('do.fit = FALSE');
  expect(script).not.toMatch(/lavaan::sem\(|lavaan::cfa\(/);
}, T);
