// Meta-analytic SEM in desktop R equals metaSEM called directly (scripts/validation/metasem.R): ?Digman97's two-stage
// SEM by random and fixed effects, and random effects with a study that did not measure one variable. metaSEM runs
// on OpenMx, desktop R only: these run with PS_NATIVE_R (the helper's R).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseCsv } from '../engine/dataset';
import { toSpec, type ModelState } from '../model/project';
import { metaSemR, metaSemScriptR, type MetaSemResult } from './metasem';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const ROOT = join(__dirname, '..', '..');
const ref = JSON.parse(
  readFileSync(join(ROOT, 'src', 'engine', '__fixtures__', 'metasem', 'reference.json'), 'utf8'),
);
const data = parseCsv(
  readFileSync(join(ROOT, 'public', 'examples', 'metasem', 'digman97.csv'), 'utf8'),
).dataset;
const F = (name: string, indicators: string[]) => ({
  id: name,
  name,
  type: 'factor' as const,
  mode: 'A' as const,
  indicators,
  x: 0,
  y: 0,
  side: 'left' as const,
});
const model: ModelState = {
  constructs: [F('Alpha', ['A', 'C', 'ES']), F('Beta', ['E', 'I'])],
  paths: [],
  moderations: [],
  correlations: [{ id: 'k', kind: 'construct', a: 'Alpha', b: 'Beta' }],
};
const LABEL: Record<string, string> = {
  AONAlpha: 'Alpha → A',
  CONAlpha: 'Alpha → C',
  ESONAlpha: 'Alpha → ES',
  EONBeta: 'Beta → E',
  IONBeta: 'Beta → I',
  AlphaWITHBeta: 'Alpha ↔ Beta',
};
const name = (p: MetaSemResult['stage2']['params'][number]) =>
  p.kind === 'covariance' ? `${p.from} ↔ ${p.to}` : `${p.from} → ${p.to}`;

function same(
  r: MetaSemResult,
  x: {
    pooled: number[];
    est: Record<string, number>;
    se: Record<string, number>;
    chisq: number;
    df: number;
    rmsea: number;
    srmr: number;
    cfi: number;
    q?: unknown;
  },
) {
  r.stage1.pooled.forEach((p, k) =>
    expect(p.r, `pooled ${p.a}–${p.b}`).toBeCloseTo(x.pooled[k], 6),
  );
  expect(r.stage2.params).toHaveLength(6);
  for (const [l, v] of Object.entries(x.est)) {
    const p = r.stage2.params.find((q) => name(q) === LABEL[l])!;
    expect(p.est, l).toBeCloseTo(v, 6);
    expect(p.se, `SE ${l}`).toBeCloseTo(x.se[l], 6);
  }
  expect(r.stage2.fit.chisq).toBeCloseTo(x.chisq, 5);
  expect(r.stage2.fit.df).toBe(x.df);
  expect(r.stage2.fit.rmsea).toBeCloseTo(x.rmsea, 6);
  expect(r.stage2.fit.srmr).toBeCloseTo(x.srmr, 6);
  expect(r.stage2.fit.cfi).toBeCloseTo(x.cfi, 6);
  if (typeof x.q === 'number') expect(r.stage1.q).toBeCloseTo(x.q, 4);
}

describe('meta-analytic SEM (metaSEM, desktop R)', () => {
  it('reproduces ?Digman97: random effects (diagonal), the two-factor model', async () => {
    const r = await metaSemR(data, toSpec(model), { n: 'N', method: 'REM', reType: 'Diag' });
    expect(r.stage1).toMatchObject({ method: 'REM', studies: 14, totalN: 4496, qDf: 130 });
    same(r, ref.rem);
    expect(r.stage1.pooled[0]).toMatchObject({ a: 'A', b: 'C' });
    expect(r.stage1.pooled.every((p) => p.tau2! > 0 && p.i2! > 0 && p.i2! < 1)).toBe(true);
    expect(r.variables).toEqual(['A', 'C', 'ES', 'E', 'I']);
    const script = await metaSemScriptR(data, toSpec(model), {
      n: 'N',
      method: 'REM',
      reType: 'Diag',
    });
    expect(script).toContain('stage1 <- tssem1(R, n, method = "REM", RE.type = "Diag")');
    expect(script).toContain(
      'RAM <- lavaan2RAM(model, obs.variables = c("A", "C", "ES", "E", "I"))',
    );
  }, 600_000);

  it('fixed effects: the homogeneity test and the stage-2 fit', async () => {
    const r = await metaSemR(data, toSpec(model), { n: 'N', method: 'FEM', reType: 'Diag' });
    same(r, ref.fem);
    expect(r.stage1.df).toBe(130);
    expect(r.stage1.chisq).toBeGreaterThan(1000);
  }, 600_000);

  it('a study that did not measure a variable (its correlations empty), and strict checks of the studies', async () => {
    const I = ['A_I', 'C_I', 'ES_I', 'E_I'].map((c) => data.names.indexOf(c));
    const miss = {
      ...data,
      cols: data.cols.map((col, k) =>
        I.includes(k) ? Float64Array.from(col, (v, row) => (row === 0 ? NaN : v)) : col,
      ),
    };
    same(
      await metaSemR(miss, toSpec(model), { n: 'N', method: 'REM', reType: 'Diag' }),
      ref.missingI,
    );
    const bad = {
      ...data,
      cols: data.cols.map((col, k) =>
        data.names[k] === 'A_C' ? Float64Array.from(col, (v, row) => (row === 2 ? 1.2 : v)) : col,
      ),
    };
    await expect(
      metaSemR(bad, toSpec(model), { n: 'N', method: 'REM', reType: 'Diag' }),
    ).rejects.toThrow(/Study 3: a correlation is not between -1 and 1/);
    const noN = {
      ...data,
      cols: data.cols.map((col, k) =>
        data.names[k] === 'N' ? Float64Array.from(col, (v, row) => (row === 4 ? 10.5 : v)) : col,
      ),
    };
    await expect(
      metaSemR(noN, toSpec(model), { n: 'N', method: 'REM', reType: 'Diag' }),
    ).rejects.toThrow(/Study 5: N must be a whole number/);
  }, 600_000);
});
