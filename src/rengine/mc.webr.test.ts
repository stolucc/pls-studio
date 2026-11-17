// Monte Carlo through webR (lavaan::simulateData + cSEM / lavaan), checked
// against the built-in simulation of the same design: the random data differ,
// so means agree up to Monte Carlo error; the χ² test keeps its nominal level.
// Run with npm run test:webr.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { designParameters, runMcTask, summariseMc, type McDesign } from '../engine/montecarlo';
import { buildPopulation } from '../engine/population';
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
  // (per construct ρc, AVE, Fornell–Larcker and cross-loadings; per pair HTMT at .85 and .90; GoF)
  expect(checks.length).toBe(3 * 4 + 3 * 2 + 1);
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

it('discriminant validity (Henseler et al. 2015): one factor split in two is flagged by HTMT inference in R and the built-in engine', async () => {
  const half = (name: string, p: string) => ({
    name,
    type: 'factor' as const,
    indicators: [1, 2, 3].map((i) => `${p}${i}`),
    loadings: [0.7, 0.7, 0.7],
  });
  const split: McDesign = {
    ...design,
    population: {
      constructs: [half('A', 'a'), half('B', 'b')],
      paths: [],
      exoCor: [{ a: 'A', b: 'B', value: 1 }],
    },
    estimators: [{ id: 'PLS', method: 'pls', consistent: false }],
    sampleSizes: [250],
    replications: 20,
    bootSamples: 100,
  };
  const r = summariseMc(split, [await runMcChunkR(split, 250, 0, 20)]);
  const b = summariseMc(split, [runMcTask({ design: split, n: 250, start: 0, end: 20 })]);
  const at = (rows: typeof r, key: string) => rows.find((x) => x.param.key === key)!;
  for (const rows of [r, b]) {
    // (Table 3, loadings .7, N = 250: HTMT_inference 95.7%, HTMT.85 100%, Fornell–Larcker 0.3%, cross-loadings 0%)
    expect(at(rows, 'validity:htmtci:A:B').rejection!).toBeGreaterThan(0.8);
    expect(at(rows, 'validity:htmt:A:B').rejection!).toBeGreaterThan(0.9);
    expect(at(rows, 'validity:fl:A').rejection!).toBeLessThan(0.2);
    expect(at(rows, 'validity:xl:A').rejection!).toBeLessThan(0.2);
  }
  for (const key of ['validity:htmtci:A:B', 'validity:xl:A']) {
    const x = at(r, key);
    const y = at(b, key);
    expect(Math.abs(x.mean - y.mean), key).toBeLessThan(
      4 * Math.sqrt((x.sd ** 2 + y.sd ** 2) / 20) + 0.01,
    );
  }
}, 900_000);

it("CB-SEM measurement checks (Rönkkö & Cho 2022): the factor correlation's interval and χ²(1) in R, the interval as built in", async () => {
  const half = (name: string, p: string) => ({
    name,
    type: 'factor' as const,
    indicators: [1, 2, 3].map((i) => `${p}${i}`),
    loadings: [0.8, 0.8, 0.8],
  });
  const two = (phi: number): McDesign => ({
    ...design,
    population: {
      constructs: [half('A', 'a'), half('B', 'b')],
      paths: [],
      exoCor: [{ a: 'A', b: 'B', value: phi }],
    },
    estimators: [{ id: 'CB-ML', method: 'cb', estimator: 'ML' }],
    sampleSizes: [250],
    replications: 40,
    bootSamples: 100,
    cbChecks: true,
  });
  const at = (rows: ReturnType<typeof summariseMc>, key: string) =>
    rows.find((x) => x.param.key === key)!;
  for (const phi of [1, 0.7]) {
    const d = two(phi);
    const r = summariseMc(d, [await runMcChunkR(d, 250, 0, 40)]);
    const b = summariseMc(d, [runMcTask({ design: d, n: 250, start: 0, end: 40 })]);
    // (Table 8, loadings .8, N = 250: CI_CFA(1) and χ²(1) .983 / .994 at φ = 1, 0 at .7)
    const flags = phi === 1 ? (x: number) => x > 0.85 : (x: number) => x === 0;
    for (const rows of [r, b]) expect(flags(at(rows, 'validity:cicfa:A:B').rejection!)).toBe(true);
    expect(flags(at(r, 'validity:chi1:A:B').rejection!), `χ²(1) at φ = ${phi}`).toBe(true);
    expect(at(r, 'validity:chi1:A:B').reps).toBe(40);
    // AVE/SV_CFA flags φ = 1 always (Table 8: 1.000), and HTMT inference runs for CB-SEM too
    if (phi === 1) expect(at(r, 'validity:fl:A').rejection!).toBe(1);
    expect(at(r, 'validity:htmtci:A:B').reps).toBe(40);
    // R's interval (standardizedSolution) and the built-in delta method estimate the same bound
    for (const key of ['validity:cicfa:A:B', 'validity:ave:A', 'validity:htmt:A:B']) {
      const x = at(r, key);
      const y = at(b, key);
      expect(Math.abs(x.mean - y.mean), `${key} at φ = ${phi}`).toBeLessThan(
        4 * Math.sqrt((x.sd ** 2 + y.sd ** 2) / 40) + 0.01,
      );
    }
  }
}, 900_000);

it('a composite population estimated as common factors: PLSc corrects the composites in R as built in', async () => {
  const block = (name: string, p: string) => ({
    name,
    type: 'composite' as const,
    indicators: [1, 2, 3, 4].map((i) => `${p}${i}`),
    weights: [0.4, 0.4, 0.4, 0.4],
    withinCor: 0.1875,
  });
  const d: McDesign = {
    ...design,
    population: {
      constructs: [block('A', 'a'), block('B', 'b')],
      paths: [{ from: 'A', to: 'B', value: 0.5 }],
      exoCor: [],
    },
    estimators: [{ id: 'PLSc', method: 'pls', consistent: true }],
    sampleSizes: [500],
    replications: 40,
    bootSamples: 0,
    factorModel: true,
  };
  const path = (rows: ReturnType<typeof summariseMc>) =>
    rows.find((x) => x.param.key === 'path:A:B')!;
  const r = path(summariseMc(d, [await runMcChunkR(d, 500, 0, 40)]));
  const b = path(summariseMc(d, [runMcTask({ design: d, n: 500, start: 0, end: 40 })]));
  // (corrected for attenuation the composites do not have: well above .5 in both engines)
  expect(r.mean).toBeGreaterThan(0.7);
  expect(Math.abs(r.mean - b.mean)).toBeLessThan(
    4 * Math.sqrt((r.sd ** 2 + b.sd ** 2) / 40) + 0.02,
  );
}, 900_000);

it('GSCA (cSEM) estimates the paths of a composite population as PLS mode B does', async () => {
  const block = (name: string, p: string) => ({
    name,
    type: 'composite' as const,
    indicators: [1, 2, 3, 4].map((i) => `${p}${i}`),
    weights: [0.1, 0.3, 0.5, 0.7],
    withinCor: 0.3,
  });
  const d: McDesign = {
    ...design,
    population: {
      constructs: [block('A', 'a'), block('B', 'b'), block('C', 'c')],
      paths: [
        { from: 'A', to: 'B', value: 0.5 },
        { from: 'B', to: 'C', value: 0.3 },
      ],
      exoCor: [],
    },
    estimators: [
      { id: 'PLS', method: 'pls', consistent: false },
      { id: 'GSCA', method: 'pls', consistent: false, approach: 'GSCA' },
    ],
    sampleSizes: [500],
    replications: 40,
    bootSamples: 0,
  };
  const rows = summariseMc(d, [await runMcChunkR(d, 500, 0, 40)]);
  const at = (e: string, key: string) =>
    rows.find((x) => x.estimator === e && x.param.key === key)!;
  for (const key of ['path:A:B', 'path:B:C']) {
    const gsca = at('GSCA', key);
    expect(gsca.failed, key).toBe(0);
    // (consistent on composites: the mean within Monte Carlo error of the true value, and of PLS mode B's)
    expect(Math.abs(gsca.mean - gsca.param.value), key).toBeLessThan(0.03);
    expect(Math.abs(gsca.mean - at('PLS', key).mean), key).toBeLessThan(0.03);
  }
}, 900_000);

it('a latent interaction (Chin et al. 2003): PLS product indicators and regression on sum scores recover it with reliable indicators', async () => {
  const factor = (name: string, p: string) => ({
    name,
    type: 'factor' as const,
    indicators: [1, 2, 3, 4, 5, 6].map((i) => `${p}${i}`),
    loadings: [0.95, 0.95, 0.95, 0.95, 0.95, 0.95],
  });
  const d: McDesign = {
    ...design,
    population: {
      constructs: [factor('X', 'x'), factor('Z', 'z'), factor('Y', 'y')],
      paths: [
        { from: 'X', to: 'Y', value: 0.3 },
        { from: 'Z', to: 'Y', value: 0.5 },
      ],
      exoCor: [{ a: 'X', b: 'Z', value: 0.3 }],
      interactions: [{ a: 'X', b: 'Z', to: 'Y', value: 0.3 }],
    },
    estimators: [
      { id: 'PLS', method: 'pls', consistent: false },
      { id: 'Sum scores', method: 'regression', dr: false },
    ],
    sampleSizes: [500],
    replications: 40,
    bootSamples: 0,
  };
  const rows = summariseMc(d, [await runMcChunkR(d, 500, 0, 40)]);
  const at = (e: string, key: string) =>
    rows.find((x) => x.estimator === e && x.param.key === key)!;
  // (the product of factors correlated .3 has variance 1.09: the standardised coefficient is .3 · √1.09)
  expect(at('PLS', 'path:X × Z:Y').param.value).toBeCloseTo(0.3 * Math.sqrt(1.09), 10);
  for (const e of ['PLS', 'Sum scores']) {
    for (const key of ['path:X:Y', 'path:Z:Y', 'path:X × Z:Y']) {
      const r = at(e, key);
      expect(r.failed, `${e} ${key}`).toBe(0);
      // (loadings .95: composites nearly error-free, so the estimates within Monte Carlo error of the truth)
      expect(Math.abs(r.mean - r.param.value), `${e} ${key}`).toBeLessThan(0.03);
    }
  }
}, 900_000);

it('a square term and a product shared by two constructs: one product construct each, mode B runs', async () => {
  const factor = (name: string, p: string) => ({
    name,
    type: 'factor' as const,
    indicators: [1, 2, 3, 4].map((i) => `${p}${i}`),
    loadings: [0.95, 0.95, 0.95, 0.95],
  });
  const d: McDesign = {
    ...design,
    population: {
      constructs: [factor('X', 'x'), factor('Z', 'z'), factor('Y', 'y'), factor('W', 'w')],
      paths: [
        { from: 'X', to: 'Y', value: 0.3 },
        { from: 'Z', to: 'Y', value: 0.2 },
        { from: 'X', to: 'W', value: 0 },
        { from: 'Z', to: 'W', value: 0.2 },
        { from: 'Y', to: 'W', value: 0.3 },
      ],
      exoCor: [{ a: 'X', b: 'Z', value: 0.3 }],
      interactions: [
        { a: 'X', b: 'X', to: 'Y', value: 0.2 },
        { a: 'X', b: 'Z', to: 'Y', value: 0.2 },
        { a: 'X', b: 'Z', to: 'W', value: 0.2 },
      ],
    },
    estimators: [
      { id: 'PLS', method: 'pls', consistent: false },
      { id: 'PLS mode B', method: 'pls', consistent: false, mode: 'B' },
      { id: 'Sum scores', method: 'regression', dr: false },
    ],
    sampleSizes: [500],
    replications: 30,
    bootSamples: 0,
  };
  const rows = summariseMc(d, [await runMcChunkR(d, 500, 0, 30)]);
  const at = (e: string, key: string) =>
    rows.find((x) => x.estimator === e && x.param.key === key)!;
  // (Var X² = 2: the standardised coefficient of the square is .2 · √2)
  expect(at('PLS', 'path:X × X:Y').param.value).toBeCloseTo(0.2 * Math.sqrt(2), 10);
  const keys = ['path:X:Y', 'path:Y:W', 'path:X × X:Y', 'path:X × Z:Y', 'path:X × Z:W'];
  for (const key of keys) expect(at('PLS mode B', key).failed, `mode B ${key}`).toBe(0);
  for (const e of ['PLS', 'Sum scores']) {
    for (const key of keys) {
      const r = at(e, key);
      expect(r.failed, `${e} ${key}`).toBe(0);
      expect(Math.abs(r.mean - r.param.value), `${e} ${key}`).toBeLessThan(0.04);
    }
  }
}, 900_000);

it('two groups (Qureshi & Compeau 2009): PLS and CB-SEM estimate and test each path’s difference', async () => {
  const factor = (name: string, p: string) => ({
    name,
    type: 'factor' as const,
    indicators: [1, 2, 3].map((i) => `${p}${i}`),
    loadings: [0.7, 0.8, 0.9],
  });
  const d: McDesign = {
    ...design,
    population: {
      constructs: [factor('A', 'a'), factor('B', 'b'), factor('C', 'c')],
      paths: [
        { from: 'A', to: 'C', value: 0.2 },
        { from: 'B', to: 'C', value: 0.3 },
      ],
      exoCor: [],
    },
    groups: { paths: [{ from: 'A', to: 'C', value: 0.6 }] },
    estimators: [
      { id: 'PLS', method: 'pls', consistent: false },
      { id: 'CB-ML', method: 'cb', estimator: 'ML' },
    ],
    sampleSizes: [300],
    replications: 30,
    bootSamples: 100,
  };
  const rows = summariseMc(d, [await runMcChunkR(d, 300, 0, 30)]);
  const at = (e: string, key: string) =>
    rows.find((x) => x.estimator === e && x.param.key === key)!;
  expect(rows.map((r) => r.param.key)).toEqual(['diff:A:C', 'diff:B:C', 'diff:A:C', 'diff:B:C']);
  for (const e of ['PLS', 'CB-ML']) {
    const differs = at(e, 'diff:A:C');
    expect(differs.failed, e).toBe(0);
    expect(differs.param.value).toBeCloseTo(0.4, 12);
    // (ML on factors is consistent; PLS attenuates both groups' paths, so their difference too)
    expect(differs.mean, e).toBeGreaterThan(e === 'PLS' ? 0.28 : 0.34);
    expect(differs.rejection, e).toBeGreaterThan(0.9);
    const same = at(e, 'diff:B:C');
    expect(Math.abs(same.mean), e).toBeLessThan(0.05);
    expect(same.rejection, e).toBeLessThan(0.2);
  }
}, 900_000);

it('PLS with bootstrap: each replication’s bootstrap SE, set against the SD of the estimates', async () => {
  const factor = (name: string, p: string) => ({
    name,
    type: 'factor' as const,
    indicators: [1, 2, 3].map((i) => `${p}${i}`),
    loadings: [0.7, 0.8, 0.9],
  });
  const population = {
    constructs: [factor('A', 'a'), factor('C', 'c')],
    paths: [{ from: 'A', to: 'C', value: 0.3 }],
    exoCor: [],
  };
  const d: McDesign = {
    ...design,
    population,
    estimators: [
      { id: 'PLS', method: 'pls', consistent: false },
      { id: 'CB-ML', method: 'cb', estimator: 'ML' },
    ],
    sampleSizes: [300],
    replications: 30,
    bootSamples: 100,
  };
  const part = await runMcChunkR(d, 300, 0, 30);
  const pi = designParameters(d, buildPopulation(population)).findIndex(
    (p) => p.key === 'path:A:C',
  );
  expect(Array.from(part.se![0][pi]).every(Number.isFinite)).toBe(true);
  expect(Array.from(part.se![1][pi]).every(Number.isNaN)).toBe(true);
  const rows = summariseMc(d, [part]);
  const pls = rows.find((r) => r.estimator === 'PLS' && r.param.key === 'path:A:C')!;
  expect(pls.seRatio!).toBeGreaterThan(0.7);
  expect(pls.seRatio!).toBeLessThan(1.4);
  expect(
    rows.find((r) => r.estimator === 'CB-ML' && r.param.key === 'path:A:C')!.seRatio,
  ).toBeUndefined();
  // Two groups: the pooled SE of the difference.
  const two: McDesign = { ...d, groups: { paths: [] }, estimators: [d.estimators[0]] };
  const mg = await runMcChunkR(two, 300, 0, 10);
  expect(Array.from(mg.se![0][0]).every((x) => Number.isFinite(x) && x > 0)).toBe(true);
}, 900_000);

it('two groups, PLS: the individual sign change applies to each group’s bootstrap draws', async () => {
  const factor = (name: string, p: string) => ({
    name,
    type: 'factor' as const,
    indicators: [1, 2, 3].map((i) => `${p}${i}`),
    loadings: [0.7, 0.8, 0.9],
  });
  const d = (signChange: 'none' | 'individual'): McDesign => ({
    ...design,
    population: {
      constructs: [factor('A', 'a'), factor('C', 'c')],
      paths: [{ from: 'A', to: 'C', value: 0 }],
      exoCor: [],
    },
    groups: { paths: [] },
    estimators: [{ id: 'PLS', method: 'pls', consistent: false }],
    inference: { signChange, interval: 'percentile' },
    sampleSizes: [100],
    replications: 30,
    bootSamples: 100,
  });
  const run = async (s: 'none' | 'individual') =>
    summariseMc(d(s), [await runMcChunkR(d(s), 100, 0, 30)])[0];
  const [none, individual] = [await run('none'), await run('individual')];
  // (a null path's draws folded onto one side have a smaller SD: narrower intervals, more rejections)
  expect(individual.width!).toBeLessThan(0.8 * none.width!);
}, 900_000);

it('skewed indicators: Fleishman per indicator lowers the paths, as in the built-in engine; Vale–Maurelli does not', async () => {
  const skewed = (nonnormal?: 'fleishman'): McDesign => ({
    ...design,
    population: { ...design.population, skew: 1.75, kurtosis: 3.75, nonnormal },
    estimators: [{ id: 'Sum scores', method: 'regression', dr: false }],
    replications: 40,
  });
  const path = (rows: ReturnType<typeof summariseMc>) =>
    rows.find((x) => x.param.key === 'path:Trust:Loyalty')!;
  const vm = path(summariseMc(skewed(), [await runMcChunkR(skewed(), 300, 0, 40)]));
  const fl = skewed('fleishman');
  const r = path(summariseMc(fl, [await runMcChunkR(fl, 300, 0, 40)]));
  const b = path(summariseMc(fl, [runMcTask({ design: fl, n: 300, start: 0, end: 40 })]));
  expect(r.failed).toBe(0);
  // (each indicator correlation shrinks by about a quarter, and the sum scores' path with them)
  expect(r.mean).toBeLessThan(vm.mean - 0.05);
  expect(Math.abs(r.mean - b.mean)).toBeLessThan(4 * Math.sqrt((r.sd ** 2 + b.sd ** 2) / 40));
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

  // The app's bootstrap loop (pls_boot: cSEM's estimation per draw, without its per-draw summaries) against
  // cSEM's own resampling (which BCa keeps) on the same 40 samples: the same tests up to bootstrap error.
  const own = paid('none', 'percentile');
  const ro = summariseMc(own, [await runMcChunkR(own, 100, 0, 40)])[0];
  for (const t of ['t', 'normal', 'basic', 'percentile'] as const)
    expect(Math.abs(ro.tests![t]! - r.tests![t]!), `${t}: own loop vs cSEM's`).toBeLessThanOrEqual(
      0.1,
    );
  expect(ro.mean).toBeCloseTo(r.mean, 12);

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
}, 1_800_000); // (in the browser's R: four bootstrapped designs, about 15 minutes)

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
