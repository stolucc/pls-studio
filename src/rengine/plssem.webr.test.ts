// Multilevel PLS-SEM in desktop R equals plssem 0.2.0 called directly (scripts/validation/plssem_multilevel.R) with the
// same seed: the two models of plssem's multilevel vignette on randomSlopes (random intercepts; random slopes of x1 and
// x2), and the random-intercept model's cluster bootstrap. The vignette prints no numbers (its chunks are not run in the
// package), so the reference is plssem itself. plssem 0.2.0 is desktop-only: these run with PS_NATIVE_R (the helper's R).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseCsv } from '../engine/dataset';
import type { ModelSpec } from '../engine/types';
import { plssemR, plssemScriptR, type PlssemInput, type PlssemModel, type PlssemResult } from './plssem';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const ROOT = join(__dirname, '..', '..');
const ref = JSON.parse(readFileSync(join(ROOT, 'src', 'engine', '__fixtures__', 'plssem', 'multilevel.json'), 'utf8'));
const data = parseCsv(readFileSync(join(ROOT, 'public', 'examples', 'plssem', 'randomSlopes.csv'), 'utf8')).dataset;
// The vignette's level 1 as the canvas holds it (x1–x3 single-indicator constructs) and its level 2 as Factors.
const spec: ModelSpec = {
  constructs: [{ name: 'fw', mode: 'A', type: 'factor', indicators: ['y1', 'y2', 'y3'] }, ...['x1', 'x2', 'x3'].map((x) => ({ name: x, mode: 'A' as const, type: 'factor' as const, indicators: [x] }))],
  paths: ['x1', 'x2', 'x3'].map((x) => ({ from: x, to: 'fw' })),
  multilevel: { column: 'cluster', between: 'factors', betweenCovariates: ['w1', 'w2'] },
};
const model: PlssemModel = { data, spec, missing: 'casewise' };
const base: PlssemInput = { slopes: [], consistent: false, scheme: 'path', bootR: 0, seed: 1 };
// plssem's names in the vignette's syntax → the app's
const NAMES: Record<string, string> = { fb: 'fw (between)', s1: 'x1 → fw (slope)', s2: 'x2 → fw (slope)' };

interface RefRow { lhs: string; op: string; rhs: string; level: number | null; est: number; se: number | null }
function expectSame(r: PlssemResult, x: any, se = false, names = NAMES) {
  const app = (n: string) => names[n] ?? n;
  const rows = r.levels.flatMap((l) => l.rows.map((q) => ({ ...q, level: l.level })));
  const th = (x.est as RefRow[]).filter((e) => e.level === null);
  expect(rows.length).toBe(x.est.length - th.length);
  expect(r.thresholds.length).toBe(th.length);
  for (const e of th) expect(Math.abs(r.thresholds.find((t) => t.variable === e.lhs && t.threshold === e.rhs)!.est - e.est), `${e.lhs} | ${e.rhs}`).toBeLessThan(1e-6);
  for (const e of (x.est as RefRow[]).filter((y) => y.level !== null)) {
    const q = rows.find((y) => y.level === e.level && y.op === e.op && ((y.lhs === app(e.lhs) && y.rhs === app(e.rhs)) || (e.op === '~~' && y.lhs === app(e.rhs) && y.rhs === app(e.lhs))));
    const what = `level ${e.level}: ${e.lhs} ${e.op} ${e.rhs}`;
    expect(q, what).toBeTruthy();
    expect(Math.abs(q!.est - e.est), what).toBeLessThan(1e-6);
    if (se && e.se !== null) expect(Math.abs(q!.se! - e.se), `${what} (SE)`).toBeLessThan(1e-6);
  }
  r.levels.forEach((l, k) => {
    for (const [n, v] of Object.entries(x.r2[k] as Record<string, number>)) expect(Math.abs(l.r2.find((y) => y.name === app(n))!.value! - v), `R² ${n}`).toBeLessThan(1e-6);
    for (const [n, v] of Object.entries(x.r2Indicators[k] as Record<string, number>)) expect(Math.abs(l.r2Indicators.find((y) => y.name === n)!.value! - v), `R² ${n}`).toBeLessThan(1e-6);
    const f = x.fit[`level.${k + 1}`];
    expect(Math.abs(l.fit!.chisq! - f.chisq)).toBeLessThan(1e-6);
    expect(l.fit!.df).toBe(f['chisq.df']);
    expect(Math.abs(l.fit!.srmr! - f.srmr)).toBeLessThan(1e-6);
  });
  for (const [n, v] of Object.entries(x.icc as Record<string, number>)) expect(Math.abs(r.icc.find((y) => y.name === n)!.value! - v)).toBeLessThan(1e-6);
  expect(r.iterations).toBe(x.iterations);
}

describe('Multilevel PLS-SEM (plssem 0.2.0, desktop R)', () => {
  it('the vignette’s two-level model (random intercepts) equals plssem run directly with seed 1', async () => {
    const r = await plssemR(model, base);
    expectSame(r, ref.twoLevel);
    expect(r).toMatchObject({ n: 3000, clusters: 200, estimator: 'MC-PLSc-MLM', converged: true, seed: 1, bootR: 0, slopes: [] });
    expect(r.syntax).toEqual(['level: 1', '  fw =~ y1 + y2 + y3', '  fw ~ x1 + x2 + x3', 'level: 2', '  fw_b =~ y1 + y2 + y3', '  fw_b ~ w1 + w2']);
    expect(r.fitNote).toMatch(/under development/);
    expect(r.warnings).toEqual([]);
  }, 600_000);

  it('the vignette’s random-slopes model equals plssem run directly with seed 1', async () => {
    const r = await plssemR(model, { ...base, slopes: [{ from: 'x1', to: 'fw' }, { from: 'x2', to: 'fw' }] });
    expectSame(r, ref.randomSlopes);
    expect(r.slopes.map((s) => s.name)).toEqual(['x1 → fw (slope)', 'x2 → fw (slope)']);
    expect(Math.abs(r.slopes[0].sd! - ref.randomSlopes.rsd.s1)).toBeLessThan(1e-6);
    expect(Math.abs(r.slopes[1].sd! - ref.randomSlopes.rsd.s2)).toBeLessThan(1e-6);
    const script = await plssemScriptR(model, { ...base, slopes: [{ from: 'x1', to: 'fw' }, { from: 'x2', to: 'fw' }] });
    expect(script).toContain('fw ~ rv("s_x1_fw")*x1 + rv("s_x2_fw")*x2 + x3');
    expect(script).toContain('s_x1_fw + s_x2_fw ~ w1 + w2');
    expect(script).toContain('set.seed(1)');
  }, 600_000);

  it('the cluster bootstrap (100 samples, seed 7) equals plssem’s, standard errors included', async () => {
    const r = await plssemR(model, { ...base, seed: 7, bootR: 100 });
    expectSame(r, ref.twoLevelBoot, true);
    expect(r.levels[0].rows.find((q) => q.op === '~' && q.rhs === 'x1')!.p).toBeLessThan(0.001);
  }, 600_000);

  it('ordinal indicators and cluster-level covariates (MC-OrdPLSc on randomSlopesOrdered) equal plssem run directly with seed 1', async () => {
    const ord = parseCsv(readFileSync(join(ROOT, 'src', 'engine', '__fixtures__', 'plssem', 'randomSlopesOrdered.csv'), 'utf8')).dataset;
    const r = await plssemR({ data: ord, spec: { ...spec, ordered: ['y1', 'y2', 'y3', 'x1', 'x2', 'x3', 'w1', 'w2'] }, missing: 'casewise' }, base);
    expect(r.estimator).toBe('MC-OrdPLSc-MLM');
    expect(r.ordered).toEqual(['y1', 'y2', 'y3', 'x1', 'x2', 'x3', 'w1', 'w2']);
    expectSame(r, ref.twoLevelOrdered);
  }, 600_000);

  it('the between level as written (the vignette’s level: 2) gives the same; Same model repeats the structure between clusters', async () => {
    const written: ModelSpec = { ...spec, multilevel: { column: 'cluster', between: 'model', betweenModel: [{ lhs: 'fb', op: '=~', rhs: [{ name: 'y1' }, { name: 'y2' }, { name: 'y3' }] }, { lhs: 'fb', op: '~', rhs: [{ name: 'w1' }, { name: 'w2' }] }] } };
    const r = await plssemR({ ...model, spec: written }, base);
    expect(r.syntax.slice(3)).toEqual(['level: 2', '  fb =~ y1 + y2 + y3', '  fb ~ w1 + w2']);
    expectSame(r, ref.twoLevel, false, { fb: 'fb (between)' });
    const same = await plssemScriptR({ ...model, spec: { ...spec, multilevel: { column: 'cluster', between: 'same' } } }, base);
    expect(same).toContain('level: 2\n  fw_b =~ y1 + y2 + y3\n  fw_b ~ x1 + x2 + x3\n');
  }, 600_000);

  it('refuses what plssem does not estimate', async () => {
    await expect(plssemR({ ...model, spec: { ...spec, constructs: [{ ...spec.constructs[0], mode: 'B', type: 'composite' }, ...spec.constructs.slice(1)] } }, base)).rejects.toThrow(/common factors only/);
    await expect(plssemR({ ...model, spec: { ...spec, multilevel: { column: 'cluster', between: 'saturated' } } }, base)).rejects.toThrow(/between-level model/);
    await expect(plssemR(model, { ...base, slopes: [{ from: 'x1', to: 'x2' }] })).rejects.toThrow(/not a path/);
  }, 600_000);
});
