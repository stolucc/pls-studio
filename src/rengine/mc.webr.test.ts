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
