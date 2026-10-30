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

describe('sum scores per construct (unit weights) through the bridges', () => {
  it('cSEM and seminr estimate the sum-score constructs as cSEM does natively', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { parseCsv } = await import('../engine/dataset');
    const fx = (f: string) => join(__dirname, '..', 'engine', '__fixtures__', f);
    const ref = JSON.parse(readFileSync(fx('mobi_unit.json'), 'utf8')) as { weights: Record<string, number>; pathCoef: Record<string, Record<string, number>> };
    const data = parseCsv(readFileSync(fx('mobi.csv'), 'utf8')).dataset;
    const items = (p: string, k: number) => Array.from({ length: k }, (_, i) => `${p}${i + 1}`);
    const blocks: [string, string[], 'A' | 'unit'][] = [['Image', items('IMAG', 5), 'A'], ['Expectation', items('CUEX', 3), 'A'], ['Quality', items('PERQ', 7), 'unit'],
      ['Value', items('PERV', 2), 'A'], ['Satisfaction', items('CUSA', 3), 'A'], ['Complaints', ['CUSCO'], 'A'], ['Loyalty', items('CUSL', 3), 'unit']];
    const spec = {
      constructs: blocks.map(([name, indicators, mode]) => ({ name, indicators, mode, type: 'composite' as const })),
      paths: Object.entries(ref.pathCoef).flatMap(([to, row]) => Object.keys(row).map((from) => ({ from, to }))),
    };
    for (const pkg of ['cSEM', 'seminr'] as const) {
      const res = await estimatePlsR(data, spec, { scheme: 'path', consistent: false, missing: 'mean', tolerance: 1e-10, maxIter: 1000 }, pkg);
      res.indicators.forEach((ind, k) => expect(Math.abs(res.weights[k]), `${pkg} ${ind.name}`).toBeCloseTo(ref.weights[ind.name], 4));
      for (const [to, row] of Object.entries(ref.pathCoef)) for (const [from, b] of Object.entries(row))
        expect(res.pathCoef[res.constructs.indexOf(from)][res.constructs.indexOf(to)], `${pkg} ${from} → ${to}`).toBeCloseTo(b, 4);
    }
    const script = await plsScriptR(data, spec, { scheme: 'path', consistent: false, missing: 'mean', tolerance: 1e-7, maxIter: 300 }, 'seminr');
    expect(script).toContain('composite("Quality", c("PERQ1"');
    expect(script).toMatch(/composite\("Quality", .*weights = unit_weights\)/);
  }, 900_000);
});

describe('dominant indicators through the cSEM bridge', () => {
  it('flips Quality so that the reversed PERQ1 loads positively, as cSEM natively', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { parseCsv } = await import('../engine/dataset');
    const fx = (f: string) => join(__dirname, '..', 'engine', '__fixtures__', f);
    const ref = JSON.parse(readFileSync(fx('dominant.json'), 'utf8'));
    const base = parseCsv(readFileSync(fx('mobi.csv'), 'utf8')).dataset;
    const k = base.names.indexOf('PERQ1');
    const data = { ...base, cols: base.cols.map((c, i) => (i === k ? Float64Array.from(c, (v) => 11 - v) : c)) };
    const items = (p: string, n: number) => Array.from({ length: n }, (_, i) => `${p}${i + 1}`);
    const blocks: [string, string[], 'A' | 'B'][] = [['Image', items('IMAG', 5), 'A'], ['Expectation', items('CUEX', 3), 'A'], ['Quality', items('PERQ', 7), 'B'],
      ['Value', items('PERV', 2), 'A'], ['Satisfaction', items('CUSA', 3), 'A'], ['Complaints', ['CUSCO'], 'A'], ['Loyalty', items('CUSL', 3), 'A']];
    const paths = [['Image', 'Expectation'], ['Expectation', 'Quality'], ['Expectation', 'Value'], ['Quality', 'Value'], ['Image', 'Satisfaction'], ['Expectation', 'Satisfaction'],
      ['Quality', 'Satisfaction'], ['Value', 'Satisfaction'], ['Satisfaction', 'Complaints'], ['Image', 'Loyalty'], ['Satisfaction', 'Loyalty'], ['Complaints', 'Loyalty']].map(([from, to]) => ({ from, to }));
    const spec = { constructs: blocks.map(([name, indicators, mode]) => ({ name, indicators, mode, type: (mode === 'B' ? 'composite' : 'factor') as 'composite' | 'factor', ...(name === 'Quality' ? { dominant: 'PERQ1' } : {}) })), paths };
    const r = await estimatePlsR(data, spec, { scheme: 'path', consistent: false, missing: 'mean', tolerance: 1e-10, maxIter: 1000 }, 'cSEM');
    r.indicators.forEach((ind, j) => { if (ind.name.startsWith('PERQ')) expect(r.weights[j], ind.name).toBeCloseTo(ref.dominant.weights[ind.name], 5); });
    expect(r.pathCoef[r.constructs.indexOf('Quality')][r.constructs.indexOf('Satisfaction')]).toBeCloseTo(ref.dominant.qualToSat, 5);
    expect(await plsScriptR(data, spec, { scheme: 'path', consistent: false, missing: 'mean', tolerance: 1e-7, maxIter: 300 }, 'cSEM')).toContain('.dominant_indicators = c(Quality = "PERQ1")');
  }, 600_000);
});
