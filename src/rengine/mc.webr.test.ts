// Monte Carlo through webR (lavaan::simulateData + cSEM / lavaan), checked
// against the built-in simulation of the same design: the random data differ,
// so means agree up to Monte Carlo error; the χ² test keeps its nominal level.
// Run with npm run test:webr.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { runMcTask, summariseMc, type McDesign } from '../engine/montecarlo';
import { mcScriptR, runMcChunkR } from './mc';
import { helperLibrary } from './nativeR';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const f = (name: string, p: string) => ({
  name,
  type: 'factor' as const,
  indicators: [1, 2, 3].map((i) => `${p}${i}`),
  loadings: [0.8, 0.7, 0.75],
});
const design: McDesign = {
  population: {
    constructs: [f('Price fairness', 'a'), f('Trust', 'b'), f('Loyalty', 'c')],
    paths: [
      { from: 'Price fairness', to: 'Trust', value: 0.4 },
      { from: 'Trust', to: 'Loyalty', value: 0.5 },
      { from: 'Price fairness', to: 'Loyalty', value: 0 },
    ],
    exoCor: [],
  },
  estimators: [
    { id: 'PLSc', method: 'pls', consistent: true },
    { id: 'CB-ML', method: 'cb', estimator: 'ML' },
  ],
  sampleSizes: [300],
  replications: 40,
  seed: 5,
  alpha: 0.05,
  bootSamples: 0,
  mcDraws: 500,
};

it('R simulation agrees with the built-in simulation up to Monte Carlo error', async () => {
  const parts = [await runMcChunkR(design, 300, 0, 20), await runMcChunkR(design, 300, 20, 40)];
  const r = summariseMc(design, parts);
  const b = summariseMc(design, [runMcTask({ design, n: 300, start: 0, end: 40 })]);
  for (const row of r) {
    const ref = b.find((x) => x.estimator === row.estimator && x.param.key === row.param.key)!;
    expect(row.failed, `${row.estimator} ${row.param.key} failed`).toBe(0);
    if (row.param.key === 'fit:chisq') {
      expect(row.mean, 'mean χ² near df (24)').toBeGreaterThan(15);
      expect(row.mean).toBeLessThan(35);
      continue;
    }
    // Two independent estimates of the same mean, each with SE ≈ sd/√40.
    const se = Math.sqrt((row.sd ** 2 + ref.sd ** 2) / 40);
    expect(
      Math.abs(row.mean - ref.mean),
      `${row.estimator} ${row.param.key}: R ${row.mean} vs built-in ${ref.mean}`,
    ).toBeLessThan(4 * se);
    if (row.estimator === 'CB-ML' && row.coverage !== null)
      expect(row.coverage).toBeGreaterThan(0.8);
    // Mean CI widths (both standardised) agree as well.
    if (row.width !== null && ref.width !== null)
      expect(row.width / ref.width, `${row.estimator} ${row.param.key} width`).toBeCloseTo(1, 0);
  }
  // Composite reliabilities come from cSEM's weights (PLSc: the Mode A weights); none for CB-SEM.
  const reliability = r.filter((x) => x.param.kind === 'reliability');
  expect(reliability.map((x) => `${x.estimator} ${x.param.from}`)).toEqual([
    'PLSc Price fairness',
    'PLSc Trust',
    'PLSc Loyalty',
  ]);
  for (const x of reliability) {
    expect(x.reps).toBe(40);
    expect(x.mean).toBeLessThan(x.param.value);
  }
  // PLS measurement checks from cSEM's loadings, construct and indicator correlations (compared above).
  const checks = r.filter((x) => x.param.kind === 'validity');
  expect(checks.length).toBe(3 * 3 + 3 + 1);
  for (const x of checks) {
    expect(x.reps).toBe(40);
    expect(x.rejection).not.toBeNull();
  }
}, 900_000);

it('PLS variants (unit weights, mode B with centroid weighting) agree with the built-in engine', async () => {
  const variants: McDesign = {
    ...design,
    estimators: [
      { id: 'Sum scores', method: 'pls', consistent: false, mode: 'unit' },
      { id: 'PLS B centroid', method: 'pls', consistent: false, mode: 'B', scheme: 'centroid' },
      { id: 'PLS factorial', method: 'pls', consistent: false, scheme: 'factor' },
    ],
    replications: 3,
  };
  const r = summariseMc(variants, [await runMcChunkR(variants, 300, 0, 3)]);
  const b = summariseMc(variants, [runMcTask({ design: variants, n: 300, start: 0, end: 3 })]);
  // R draws its own data sets, so the means of three replications agree only loosely: this checks that
  // the variants reach cSEM (.PLS_modes, .PLS_weight_scheme_inner) and estimate the same quantity.
  expect(r.every((row) => row.failed === 0)).toBe(true);
  for (const row of r.filter((x) => x.param.kind === 'path')) {
    const ref = b.find((x) => x.estimator === row.estimator && x.param.key === row.param.key)!;
    expect(Math.abs(row.mean - ref.mean), `${row.estimator} ${row.param.key}`).toBeLessThan(0.15);
  }
}, 900_000);

it('a misspecified population (a cross-loading, an omitted path): lavaan rejects the model', async () => {
  const wrong: McDesign = {
    ...design,
    population: {
      ...design.population,
      paths: design.population.paths.map((p) =>
        p.value === 0 ? { ...p, value: 0.3, omitted: true } : p,
      ),
      crossLoadings: [{ indicator: 'c2', construct: 'Price fairness', value: 0.25 }],
    },
    estimators: [{ id: 'CB-ML', method: 'cb', estimator: 'ML' }],
    sampleSizes: [500],
    replications: 10,
  };
  const rows = summariseMc(wrong, [await runMcChunkR(wrong, 500, 0, 10)]);
  const chisq = rows.find((r) => r.param.key === 'fit:chisq')!;
  expect(chisq.param.value).toBe(1);
  expect(chisq.rejection!).toBeGreaterThan(0.7);
  // The omitted path is not a parameter of the estimated model.
  expect(rows.some((r) => r.param.key === 'path:Price fairness:Loyalty')).toBe(false);
}, 900_000);

it('missing values: MAR with mean replacement (PLS) and FIML (lavaan); FIML is more precise than deletion', async () => {
  const withNa = (cb: 'fiml' | 'casewise'): McDesign => ({
    ...design,
    estimators: [
      { id: 'PLS', method: 'pls', consistent: false },
      { id: 'CB-ML', method: 'cb', estimator: 'ML' },
    ],
    replications: 30,
    missing: { rate: 0.15, mechanism: 'MAR', pls: 'mean', cb },
  });
  const sd = async (cb: 'fiml' | 'casewise') => {
    const d = withNa(cb);
    const rows = summariseMc(d, [await runMcChunkR(d, 300, 0, 30)]);
    expect(rows.every((r) => r.failed === 0)).toBe(true);
    return rows.find((r) => r.estimator === 'CB-ML' && r.param.key === 'path:Trust:Loyalty')!.sd;
  };
  expect(await sd('fiml')).toBeLessThan(await sd('casewise'));
}, 900_000);

it('ordinal indicators: WLSMV (polychoric) recovers the latent path; ML on the categories does not', async () => {
  const ord: McDesign = {
    ...design,
    estimators: [
      { id: 'CB-ML', method: 'cb', estimator: 'ML' },
      { id: 'CB-WLSMV', method: 'cb', estimator: 'WLSMV' },
    ],
    replications: 20,
    ordinal: { categories: 3, thresholds: 'asymmetric' },
  };
  const rows = summariseMc(ord, [await runMcChunkR(ord, 300, 0, 20)]);
  const at = (id: string) =>
    rows.find((r) => r.estimator === id && r.param.key === 'path:Trust:Loyalty')!;
  expect(at('CB-WLSMV').failed).toBe(0);
  expect(Math.abs(at('CB-WLSMV').mean - 0.5)).toBeLessThan(0.05);
  expect(Math.abs(at('CB-WLSMV').mean - 0.5)).toBeLessThan(Math.abs(at('CB-ML').mean - 0.5));
}, 900_000);

it('regression on sum scores and DR agree with the built-in engine', async () => {
  const reg: McDesign = {
    ...design,
    estimators: [
      { id: 'Sum scores', method: 'regression', dr: false },
      { id: 'DR', method: 'regression', dr: true },
    ],
    replications: 40,
  };
  const r = summariseMc(reg, [await runMcChunkR(reg, 300, 0, 40)]);
  const b = summariseMc(reg, [runMcTask({ design: reg, n: 300, start: 0, end: 40 })]);
  for (const row of r.filter((x) => x.param.kind !== 'fit')) {
    const ref = b.find((x) => x.estimator === row.estimator && x.param.key === row.param.key)!;
    expect(row.failed).toBe(0);
    const se = Math.sqrt((row.sd ** 2 + ref.sd ** 2) / 40);
    expect(Math.abs(row.mean - ref.mean), `${row.estimator} ${row.param.key}`).toBeLessThan(4 * se);
    if (row.width !== null) expect(row.width / ref.width!).toBeCloseTo(1, 1);
  }
  // DR corrects the attenuation of the sum scores (Trust → Loyalty is .5 between the factors).
  const at = (id: string) =>
    r.find((x) => x.estimator === id && x.param.key === 'path:Trust:Loyalty')!;
  expect(Math.abs(at('DR').mean - 0.5)).toBeLessThan(Math.abs(at('Sum scores').mean - 0.5));
}, 900_000);

it('counts inadmissible PLSc solutions by cSEM::verify; PLS composites never are', async () => {
  const weak = (name: string, p: string) => ({ ...f(name, p), loadings: [0.45, 0.4, 0.35] });
  const small: McDesign = {
    ...design,
    population: {
      constructs: [weak('X', 'x'), weak('Y', 'y')],
      paths: [{ from: 'X', to: 'Y', value: 0.5 }],
      exoCor: [],
    },
    estimators: [
      { id: 'PLS', method: 'pls', consistent: false },
      { id: 'PLSc', method: 'pls', consistent: true },
    ],
    sampleSizes: [40],
    replications: 30,
  };
  const rows = summariseMc(small, [await runMcChunkR(small, 40, 0, 30)]);
  const at = (id: string) => rows.find((r) => r.estimator === id && r.param.kind === 'path')!;
  expect(at('PLS').improper).toBe(0);
  expect(at('PLSc').improper).toBeGreaterThan(0);
}, 900_000);

it('bootstrap tests (Rönkkö, McIntosh & Antonakis 2015): R and the built-in engine agree, BCa from cSEM', async () => {
  // PLS mode A, a null path between two constructs, n = 100: the basic interval rejects far too often; the
  // individual sign-change correction makes the percentile interval reject (nearly) always.
  const paid = (
    signChange: 'none' | 'individual' | 'construct',
    interval: 'percentile' | 'bca',
  ): McDesign => ({
    population: {
      constructs: [
        { name: 'A', type: 'factor', indicators: ['a1', 'a2', 'a3'], loadings: [0.6, 0.7, 0.8] },
        { name: 'B', type: 'factor', indicators: ['b1', 'b2', 'b3'], loadings: [0.6, 0.7, 0.8] },
      ],
      paths: [{ from: 'A', to: 'B', value: 0 }],
      exoCor: [],
    },
    estimators: [{ id: 'PLS', method: 'pls', consistent: false }],
    sampleSizes: [100],
    replications: 40,
    seed: 11,
    alpha: 0.05,
    bootSamples: 200,
    mcDraws: 0,
    inference: { signChange, interval },
  });
  const none = paid('none', 'bca');
  const r = summariseMc(none, [await runMcChunkR(none, 100, 0, 40)])[0];
  const b = summariseMc(none, [runMcTask({ design: none, n: 100, start: 0, end: 40 })])[0];
  expect(r.tests).toBeDefined();
  for (const t of ['t', 'normal', 'percentile', 'bca'] as const) {
    expect(r.tests![t], `R ${t}`).toBeLessThan(0.2);
    expect(Math.abs(r.tests![t]! - b.tests![t]!), `${t}: R vs built-in`).toBeLessThan(0.15);
  }
  expect(r.tests!.basic, 'basic interval: many false positives').toBeGreaterThan(0.2);
  expect(b.tests!.basic).toBeGreaterThan(0.2);
  // (coverage is of the chosen interval, BCa)
  expect(r.coverage).toBeCloseTo(1 - r.tests!.bca!, 10);

  const individual = paid('individual', 'percentile');
  const ri = summariseMc(individual, [await runMcChunkR(individual, 100, 0, 40)])[0];
  expect(ri.tests!.percentile, 'individual correction: percentile always rejects').toBeGreaterThan(
    0.9,
  );
  expect(ri.tests!.bca).toBeUndefined();

  // (construct level: cSEM's construct_reestimate; every replication runs)
  const construct: McDesign = {
    ...individual,
    replications: 10,
    inference: { signChange: 'construct', interval: 'percentile' },
  };
  const rc = summariseMc(construct, [await runMcChunkR(construct, 100, 0, 10)])[0];
  expect(rc.failed).toBe(0);
  expect(rc.tests!.t).toBeGreaterThanOrEqual(0);
}, 900_000);

it('exports the whole simulation as one script', async () => {
  const s = await mcScriptR({ ...design, replications: 3 });
  expect(s).toContain('simulateData(pop_model, sample.nobs = n');
  expect(s).toContain('Price_fairness =~');
  expect(s).toContain('summary_rows');
  expect(s).toContain('ci_width = ');
  expect(s).toContain('inadmissible = ');
}, 900_000);

// (desktop R only: Rscript runs the script as a user would)
it.runIf(process.env.PS_NATIVE_R)(
  'the exported script runs and prints every summary column',
  async () => {
    const script = await mcScriptR({ ...design, replications: 3 });
    const dir = mkdtempSync(join(tmpdir(), 'ps-mc-'));
    try {
      writeFileSync(join(dir, 'script.R'), script);
      const libs = [helperLibrary(), process.env.R_LIBS].filter(Boolean).join(':');
      const out = execFileSync('Rscript', ['script.R'], {
        cwd: dir,
        env: { ...process.env, R_LIBS: libs },
        encoding: 'utf8',
        stdio: 'pipe',
      });
      for (const column of ['rejection', 'ci_width', 'inadmissible'])
        expect(out, column).toContain(column);
      for (const index of ['CFI', 'TLI', 'RMSEA', 'SRMR'])
        expect(out, index).toContain(`fit model ${index}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
  900_000,
);
