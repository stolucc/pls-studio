// The "Diagnose misfit" panel's numbers through the bridge (R/misfit.R, run as part of ps_cb) against direct
// lavaan and semTools calls in native R (scripts/validation/misfit.R → src/engine/__fixtures__/misfit/
// reference.json): the modification indices ranked by |sepc.all| (lavaan::modindices), the largest residual
// correlations with their z-statistics (lavaan::lavResiduals), and the app's decision per row (judgeMis,
// recomputed from MI and SEPC) against semTools::epcEquivFit's decision.pow. On the Holzinger-Swineford CFA
// (lavaan's ?cfa), the same CFA by school, and the Political Democracy SEM (lavaan's ?sem).
// Run with WEBR_TESTS=1 PS_NATIVE_R=1 (or npm run test:webr).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CbResult } from '../engine/cbsem';
import type { Dataset, ModelSpec } from '../engine/types';
import { same } from '../validation/record';
import { rCall } from './bridge';
import { estimateCbLavaan } from './lavaan';
import { judgeMis } from './misfit';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

interface RefMi {
  lhs: string;
  op: string;
  rhs: string;
  group: string | null;
  mi: number;
  epc: number;
  sepc: number;
  decision: string | null;
}
interface RefModel {
  groups: string[];
  miCount: number;
  mi: RefMi[];
  residuals: { a: string; b: string; r: number; z: number }[][];
}
const REF = JSON.parse(
  readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'misfit', 'reference.json'), 'utf8'),
) as Record<'hs' | 'hsSchool' | 'pd', RefModel>;

const F = (name: string, indicators: string[]) => ({
  name,
  type: 'factor' as const,
  mode: 'A' as const,
  indicators,
});
const hsSpec: ModelSpec = {
  constructs: [
    F('visual', ['x1', 'x2', 'x3']),
    F('textual', ['x4', 'x5', 'x6']),
    F('speed', ['x7', 'x8', 'x9']),
  ],
  paths: [],
};
const indicatorCov = (a: string, b: string) => ({ kind: 'indicator' as const, a, b });
const pdSpec: ModelSpec = {
  constructs: [
    F('ind60', ['x1', 'x2', 'x3']),
    F('dem60', ['y1', 'y2', 'y3', 'y4']),
    F('dem65', ['y5', 'y6', 'y7', 'y8']),
  ],
  paths: [
    { from: 'ind60', to: 'dem60' },
    { from: 'ind60', to: 'dem65' },
    { from: 'dem60', to: 'dem65' },
  ],
  covariances: [
    indicatorCov('y1', 'y5'),
    indicatorCov('y2', 'y4'),
    indicatorCov('y2', 'y6'),
    indicatorCov('y3', 'y7'),
    indicatorCov('y4', 'y8'),
    indicatorCov('y6', 'y8'),
  ],
};

async function dataset(name: string): Promise<Dataset> {
  const raw = await rCall<{ names: string[]; cols: (number | null)[][] }>(
    'ps_dataset',
    { package: 'lavaan', name, na: [] },
    'lavaan',
  );
  return {
    names: raw.names,
    cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))),
  };
}

let hs: Dataset;
let pd: Dataset;
beforeAll(async () => {
  hs = await dataset('HolzingerSwineford1939');
  pd = await dataset('PoliticalDemocracy');
}, 900_000);

/**
 * Every row in lavaan's order with its numbers, and the app's decision equal to semTools'. Tolerances:
 * MI, EPC and SEPC are optimiser results (about 1e-6 relative between webR's WebAssembly and desktop R).
 */
function compare(what: string, r: CbResult, ref: RefModel) {
  const m = r.misfit!;
  expect(m, what).toBeDefined();
  expect(m.error, what).toBeUndefined();
  same(`${what}: modification indices computed`, m.miCount, ref.miCount);
  same(`${what}: rows ranked`, m.mi.length, ref.mi.length);
  const judged = judgeMis(m.mi);
  ref.mi.forEach((want, k) => {
    const got = m.mi[k];
    const label = `${what} #${k + 1} ${want.lhs} ${want.op} ${want.rhs}`;
    same(
      `${label}: parameter`,
      `${got.lhs} ${got.op} ${got.rhs}`,
      `${want.lhs} ${want.op} ${want.rhs}`,
    );
    same(`${label}: group`, got.group ?? '', want.group ?? '');
    expect(got.mi, `${label} MI`).toBeCloseTo(want.mi, 4);
    expect(got.epc, `${label} EPC`).toBeCloseTo(want.epc, 5);
    expect(got.sepc, `${label} SEPC`).toBeCloseTo(want.sepc, 5);
    // The panel's own ranking keeps lavaan's order.
    same(
      `${label}: rank in the panel`,
      `${judged[k].lhs} ${judged[k].op} ${judged[k].rhs}`,
      `${want.lhs} ${want.op} ${want.rhs}`,
    );
    same(
      `${label}: decision (semTools::epcEquivFit)`,
      judged[k].decision ?? '',
      want.decision ?? '',
    );
  });
  same(`${what}: residual blocks`, m.residuals.length, ref.residuals.length);
  ref.residuals.forEach((pairs, g) => {
    const block = m.residuals[g];
    same(`${what}: residual block ${g + 1} group`, block.group ?? '', ref.groups[g] ?? '');
    same(`${what}: residual pairs in block ${g + 1}`, block.pairs.length, pairs.length);
    pairs.forEach((want, k) => {
      const got = block.pairs[k];
      const label = `${what} block ${g + 1} pair ${k + 1} ${want.a} ↔ ${want.b}`;
      same(`${label}: pair`, `${got.a} ↔ ${got.b}`, `${want.a} ↔ ${want.b}`);
      expect(got.r, `${label} r`).toBeCloseTo(want.r, 6);
      expect(got.z!, `${label} z`).toBeCloseTo(want.z, 5);
    });
  });
}

describe('Diagnose misfit (lavaan::modindices sepc.all, lavResiduals; semTools::epcEquivFit)', () => {
  it('the Holzinger–Swineford CFA (?cfa)', async () => {
    const r = await estimateCbLavaan(hs, hsSpec, 'casewise', 'ML');
    compare('HS CFA', r, REF.hs);
    // ?cfa's well-known misfit: the x7–x8 residual covariance tops the SEPC ranking; visual =~ x9 the MI ranking.
    expect(r.misfit!.mi[0]).toMatchObject({ lhs: 'x7', op: '~~', rhs: 'x8' });
    expect(r.modindices![0]).toMatchObject({ lhs: 'visual', op: '=~', rhs: 'x9' });
  }, 900_000);

  it('the same CFA by school (one ranking over both groups; residuals per group)', async () => {
    const spec: ModelSpec = {
      ...hsSpec,
      multigroup: { column: 'school', invariance: 'configural', free: [] },
    };
    const r = await estimateCbLavaan(hs, spec, 'casewise', 'ML');
    expect(r.groups!.labels).toEqual(REF.hsSchool.groups);
    compare('HS CFA by school', r, REF.hsSchool);
  }, 900_000);

  it('the Political Democracy SEM (?sem), with its residual covariances', async () => {
    const r = await estimateCbLavaan(pd, pdSpec, 'casewise', 'ML');
    compare('Political Democracy', r, REF.pd);
  }, 900_000);

  it('the code returned with the results is what ran', async () => {
    const r = await estimateCbLavaan(hs, hsSpec, 'casewise', 'ML');
    const code = r.misfit!.code.join('\n');
    expect(code).toContain('mi_all <- modindices(fit)');
    expect(code).toContain('lavResiduals(fit, type = "cor.bollen", summary = FALSE)');
    expect(code).toContain('head(mi_all[order(-abs(mi_all$sepc.all)), ], 150)');
  }, 900_000);
});
