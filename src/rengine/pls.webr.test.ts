// End-to-end: the cSEM and seminr reference cases re-estimated by those
// packages running in webR, through the same code the app uses.
// Run with npm run test:webr.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PlsOptions } from '../engine/types';
import { cases, checkPls, loadData, toSpec } from '../engine/validationHarness';
import { estimatePlsR, plsScriptR, type PlsPackage } from './pls';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const plsCases = cases.filter((c) => c.kind === 'pls' && (c.source === 'cSEM' || c.source === 'seminr'));
const optionsOf = (pkg: PlsPackage, o: Record<string, unknown>): PlsOptions => ({
  scheme: o.scheme as PlsOptions['scheme'], consistent: !!o.consistent, missing: (o.missing as PlsOptions['missing']) ?? 'mean',
  // As in the reference runs: cSEM at a tight tolerance, seminr at its defaults.
  tolerance: pkg === 'cSEM' ? 1e-12 : 1e-7, maxIter: pkg === 'cSEM' ? 1000 : 300,
});

describe.each(plsCases)('$source in webR: $name', (c) => {
  it('reproduces the reference values', async () => {
    const pkg = c.source as PlsPackage;
    const res = await estimatePlsR(loadData(c), toSpec(c), optionsOf(pkg, c.options), pkg);
    expect(res.converged).toBe(true);
    checkPls(c, res);
  }, 600_000);
});

it('exports the cSEM script it runs', async () => {
  const c = plsCases.find((k) => k.name === 'plsc_csem_mobi_mixed')!;
  const script = await plsScriptR(loadData(c), toSpec(c), optionsOf('cSEM', c.options), 'cSEM');
  expect(script).toContain('Quality <~ PERQ1 + PERQ2');
  expect(script).toContain('.disattenuate = TRUE');
}, 600_000);
