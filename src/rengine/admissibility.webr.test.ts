// The CB-SEM admissibility check (engine/admissibility.ts with R/admissibility.R) on deliberately improper
// solutions, against direct lavaan calls in native R (scripts/validation/admissibility.R →
// src/engine/__fixtures__/admissibility/reference.json): eigen() of lavInspect's model matrices, parameterEstimates'
// Wald intervals of negative variances, the latent correlations, the eigenvalues of vcov with one per equality
// constraint dropped, and the empty cells of the ordinal two-way tables (table() by hand).
// Run with WEBR_TESTS=1 PS_NATIVE_R=1 (or npm run test:webr).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkAdmissibility, vcovSpectrum, waldInterval } from '../engine/admissibility';
import type { CbResult } from '../engine/cbsem';
import type { Dataset, ModelSpec } from '../engine/types';
import { SABATELLI_NAMES, SABATELLI_S } from '../examples/kline';
import { near, same } from '../validation/record';
import { rCall } from './bridge';
import { estimateCbLavaan } from './lavaan';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

interface Range {
  min: number;
  max: number;
}
interface Described {
  blocks: { implied: Range; latent: Range; theta: Range; maxLatentCor: number }[];
  negative: { name: string; group: number; est: number; se: number; low: number; high: number }[];
  vcov: { constraints: number; dropped: number[]; min: number; max: number };
  postCheck: boolean;
}
const REF = JSON.parse(
  readFileSync(
    join(__dirname, '..', 'engine', '__fixtures__', 'admissibility', 'reference.json'),
    'utf8',
  ),
) as Record<'sabatelli' | 'overfactored' | 'overfactored_groups' | 'proper', Described> & {
  ordinal: {
    data: Record<string, number>[];
    pairs: { a: string; b: string; cells: number; empty: number; sparse: number; r: number }[];
    fit: Described;
  };
};

const F = (name: string, indicators: string[]) => ({
  name,
  type: 'factor' as const,
  mode: 'A' as const,
  indicators,
});
// The visual factor split in two, speed on two indicators: two of the factors are one.
const over: ModelSpec = {
  constructs: [
    F('vA', ['x1', 'x2']),
    F('vB', ['x3', 'x9']),
    F('tx', ['x4', 'x5', 'x6']),
    F('sp', ['x7', 'x8']),
  ],
  paths: [],
};
const proper: ModelSpec = {
  constructs: [
    F('visual', ['x1', 'x2', 'x3']),
    F('textual', ['x4', 'x5', 'x6']),
    F('speed', ['x7', 'x8', 'x9']),
  ],
  paths: [],
};
let hs: Dataset;
beforeAll(async () => {
  const raw = await rCall<{ names: string[]; cols: (number | null)[][] }>(
    'ps_dataset',
    { package: 'lavaan', name: 'HolzingerSwineford1939', na: [] },
    'lavaan',
  );
  hs = {
    names: raw.names,
    cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))),
  };
}, 900_000);

/** Relative agreement: webR and desktop R differ by ~1e-6 relative in optimiser results (WebAssembly floating point). */
const rel = (quantity: string, got: number, want: number) =>
  near(quantity, got, want, 1e-5 * Math.max(1, Math.abs(want)));

/** The app's matrices of block b against the reference's eigenvalue ranges. */
function sameMatrices(r: CbResult, b: number, want: Described['blocks'][number], tag: string) {
  const block = r.admissibility!.blocks[b];
  for (const name of ['implied', 'latent', 'theta'] as const) {
    const m = block.matrices.find((x) => x.matrix === name)!;
    rel(`${tag}: smallest eigenvalue of ${name}`, m.min!, want[name].min);
    rel(`${tag}: largest eigenvalue of ${name}`, m.max!, want[name].max);
  }
}

describe('admissibility (lavaan): improper solutions against direct lavaan calls', () => {
  it('Kline’s Heywood case: the negative residual variance, its Wald interval and the matrices', async () => {
    const data: Dataset = {
      names: SABATELLI_NAMES,
      cols: [],
      moments: { S: SABATELLI_S, n: 103 },
    };
    const spec: ModelSpec = {
      constructs: [F('Marital', ['problems', 'intimacy']), F('FOE', ['father', 'mother', 'both'])],
      paths: [],
    };
    const r = await estimateCbLavaan(data, spec, 'casewise', 'ML');
    const ref = REF.sabatelli;
    sameMatrices(r, 0, ref.blocks[0], 'Sabatelli');
    const want = ref.negative[0];
    const e = r.estimates.find((x) => x.op === '~~' && x.lhs === want.name && x.rhs === want.name)!;
    rel('negative variance of intimacy', e.est, want.est);
    rel('its standard error', e.se!, want.se);
    const [low, high] = waldInterval(e.est, e.se!);
    rel('its 95% interval, lower', low, want.low);
    rel('its 95% interval, upper', high, want.high);
    const a = checkAdmissibility(r);
    const neg = a.findings.filter((f) => f.kind === 'negative-variance');
    same('negative variances found', neg.length, ref.negative.length);
    same('responsible', neg[0].params[0], 'intimacy');
    // The interval includes zero: sampling error is possible (Kolenikov & Bollen 2012).
    same('severity', neg[0].severity, 'check');
    same('lavaan post.check passes', String(ref.postCheck), 'false');
    same('status', a.status, 'check');
    same('first cause', a.causes[0].id, 'sampling');
    // (θ's negative eigenvalue is the negative variance itself: not reported twice)
    same('matrix findings', a.findings.filter((f) => f.kind === 'matrix').length, 0);
  }, 900_000);

  it('two factors that are one: a latent correlation beyond 1 and cov.lv not positive definite', async () => {
    const r = await estimateCbLavaan(hs, over, 'casewise', 'ML');
    const ref = REF.overfactored;
    sameMatrices(r, 0, ref.blocks[0], 'over-factored');
    const a = checkAdmissibility(r);
    const corr = a.findings.find((f) => f.kind === 'correlation')!;
    same('pair', corr.params.join(' '), 'vA vB');
    const i = r.constructs.indexOf('vA');
    const j = r.constructs.indexOf('vB');
    rel('latent correlation vA–vB', r.lvCor[i][j], ref.blocks[0].maxLatentCor);
    const latent = a.findings.find((f) => f.kind === 'matrix' && f.title.includes('latent'))!;
    same('cov.lv severity', latent.severity, 'serious');
    same('most involved', [...latent.params].sort().join(' '), 'vA vB');
    same('status', a.status, 'serious');
    same('first cause', a.causes[0].id, 'overfactoring');
    const sp = vcovSpectrum(r)!;
    rel('smallest eigenvalue of vcov', sp.min, ref.vcov.min);
    rel('largest eigenvalue of vcov', sp.max, ref.vcov.max);
  }, 900_000);

  it('by school with equal loadings: every group’s matrices, vcov with the constraint eigenvalues dropped', async () => {
    const spec: ModelSpec = {
      ...over,
      multigroup: { column: 'school', invariance: 'metric', free: [] },
    };
    const r = await estimateCbLavaan(hs, spec, 'casewise', 'ML');
    const ref = REF.overfactored_groups;
    same('blocks', r.admissibility!.blocks.length, ref.blocks.length);
    // (groups in lavaan's order, the order of appearance in the data, in both)
    ref.blocks.forEach((want, b) => sameMatrices(r, b, want, `group ${b + 1}`));
    same('equality constraints', r.admissibility!.equalityConstraints, ref.vcov.constraints);
    const sp = vcovSpectrum(r)!;
    same('eigenvalues dropped', sp.dropped.length, ref.vcov.dropped.length);
    for (const d of sp.dropped) expect(Math.abs(d)).toBeLessThan(1e-12 * sp.max);
    rel('smallest remaining eigenvalue of vcov', sp.min, ref.vcov.min);
    rel('largest eigenvalue of vcov', sp.max, ref.vcov.max);
    const a = checkAdmissibility(r);
    // No latent correlation exceeds 1 here, yet cov.lv is not positive definite in both groups.
    const latent = a.findings.filter((f) => f.kind === 'matrix' && f.title.includes('latent'));
    same('groups with cov.lv not positive definite', latent.length, 2);
    same('vcov flagged', a.findings.filter((f) => f.kind === 'vcov').length, 0);
  }, 900_000);

  it('the ?cfa model is admissible, as lavaan’s post.check says', async () => {
    const r = await estimateCbLavaan(hs, proper, 'casewise', 'ML');
    const ref = REF.proper;
    sameMatrices(r, 0, ref.blocks[0], '?cfa');
    const sp = vcovSpectrum(r)!;
    rel('smallest eigenvalue of vcov', sp.min, ref.vcov.min);
    const a = checkAdmissibility(r);
    same('lavaan post.check passes', String(ref.postCheck), 'true');
    same('status', a.status, 'admissible');
  }, 900_000);

  it('ordinal items: the pairs with empty cells in their two-way tables, and the polychoric correlations', async () => {
    const rows = REF.ordinal.data;
    const items = ['x1', 'x2', 'x3', 'x4', 'x5', 'x6'];
    const data: Dataset = {
      names: items,
      cols: items.map((v) => Float64Array.from(rows, (row) => row[v])),
    };
    const spec: ModelSpec = {
      constructs: [F('a', ['x1', 'x2', 'x3']), F('b', ['x4', 'x5', 'x6'])],
      paths: [],
      ordered: items,
    };
    const r = await estimateCbLavaan(data, spec, 'casewise', 'WLSMV');
    const sparse = r.admissibility!.sparse![0];
    same('pairs with empty cells', sparse.total, REF.ordinal.pairs.length);
    for (const want of REF.ordinal.pairs) {
      const got = sparse.pairs.find((p) => p.a === want.a && p.b === want.b)!;
      same(`${want.a} × ${want.b}: cells`, got.cells, want.cells);
      same(`${want.a} × ${want.b}: empty cells`, got.empty, want.empty);
      same(`${want.a} × ${want.b}: cells under 5`, got.sparse, want.sparse);
      rel(`${want.a} × ${want.b}: polychoric r`, got.r, want.r);
    }
    const a = checkAdmissibility(r);
    same('sparse finding', a.findings.filter((f) => f.kind === 'sparse').length, 1);
    expect(a.causes.map((c) => c.id)).toContain('sparse');
  }, 900_000);
});
