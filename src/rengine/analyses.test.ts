// Output mapping of the MIIVsem and cSEM-IPMA bridges, checked against the
// validation corpus without running R (__fixtures__/*.r.json were recorded by
// running R/analyses.R natively on the corpus requests).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cases, checkIpmaResult, checkMiivResult } from '../engine/validationHarness';
import { parseBoot, parseFitTest, parseIpma, parseMiiv } from './analyses';

const recorded = (name: string) => JSON.parse(readFileSync(join(__dirname, '__fixtures__', `${name}.r.json`), 'utf8'));

describe.each(['miiv_miivsem_hs', 'miiv_miivsem_poldem', 'miiv_miivsem_mobi', 'miiv_miivsem_emse', 'cov_miivsem_bollen'])('MIIVsem mapping: %s', (name) => {
  it('reproduces the reference', () => checkMiivResult(cases.find((c) => c.name === name)!, parseMiiv(recorded(name))));
});

describe.each(['ipma_csem_satisfaction_raw', 'ipma_csem_satisfaction_rescaled', 'ipma_csem_mobi_bounds'])('cSEM IPMA mapping: %s', (name) => {
  it('reproduces the reference', () => checkIpmaResult(cases.find((c) => c.name === name)!, parseIpma(recorded(name))));
});

describe('bootstrap and fit-test parsing', () => {
  it('turns null statistics into NaN and keeps the keys', () => {
    const r = parseBoot({ samples: 10, failed: 1, confidence: 0.95, stats: [{ key: 'path:A:B', group: 'path', label: 'A → B', original: 0.5, mean: 0.49, sd: 0.1, t: 5, p: null, ciLow: 0.3, ciHigh: 0.7 }] }, { package: 'cSEM', version: '0.7.1' });
    expect(r.stats[0].key).toBe('path:A:B');
    expect(Number.isNaN(r.stats[0].p)).toBe(true);
    expect(r.engine.package).toBe('cSEM');
  });
  it('maps the fit test discrepancies', () => {
    const d = { srmr: 0.05, dULS: 0.3, dG: 0.2 };
    const f = parseFitTest({ samples: 100, failed: 0, observed: { saturated: d, estimated: d }, hi95: { saturated: d, estimated: d }, hi99: { saturated: d, estimated: { srmr: null } } });
    expect(f.hi95.estimated.srmr).toBe(0.05);
    expect(Number.isNaN(f.hi99.estimated.srmr)).toBe(true);
  });
});

describe('MIIV-2SLS standardised values', () => {
  it('carries lavaan std.all for the 2SLS estimates, marker loadings and R²', () => {
    const r = parseMiiv(recorded('cov_miivsem_bollen'));
    const path = r.estimates.find((e) => e.op === '~' && e.lhs === 'dem60' && e.rhs === 'ind60')!;
    expect(path.est).toBeCloseTo(1.261, 3);
    expect(path.std).toBeCloseTo(0.376, 3);
    expect(r.fixedStd!.x1).toBeGreaterThan(0.8);
    expect(r.r2!.dem65).toBeGreaterThan(0.8);
  });
});

it('MIIV-2SLS (R): error variances and error covariances from var.cov', () => {
  const r = parseMiiv(recorded('cov_miivsem_bollen'));
  const v = r.variances!;
  const cov = v.find((x) => !x.latent && ((x.lhs === 'y1' && x.rhs === 'y5') || (x.lhs === 'y5' && x.rhs === 'y1')))!;
  expect(cov.est).toBeCloseTo(0.636, 3);
  const e1 = v.find((x) => x.lhs === 'y1' && x.rhs === 'y1')!;
  // An indicator's standardised error variance is 1 − R².
  expect(e1.std).toBeCloseTo(1 - r.r2!.y1, 3);
});
