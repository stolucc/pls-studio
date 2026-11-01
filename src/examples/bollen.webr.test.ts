// Bollen's examples (data from MIIVsem) under lavaan ML and MIIV-2SLS in webR,
// against native lavaan and MIIVsem (scripts/validation/bollen.R) and the
// estimates Bollen (1989) prints for union sentiment. Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Dataset } from '../engine/types';
import { toSpec } from '../model/project';
import type { RPackage } from '../rengine/bridge';
import { rCall } from '../rengine/bridge';
import { estimateCbLavaan } from '../rengine/lavaan';
import { miivR } from '../rengine/analyses';
import { startTestRuntime, stopTestRuntime } from '../rengine/webrTestRuntime';
import { exampleModel, PACKAGE_EXAMPLES } from './packages';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

type Ml = { n: number; chisq: number; df: number; cfi: number; estimates: { lhs: string; op: string; rhs: string; est: number; se: number | null }[] };
type Miiv = { coefficients: { name: string; est: number }[]; eqn: { DVobs: string; sargan: number; 'sargan.df': number }[] };
const ref = JSON.parse(readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'textbook', 'bollen.json'), 'utf8')) as Record<string, { ml: Ml; miiv: Miiv }>;

async function load(id: string): Promise<{ data: Dataset; spec: ReturnType<typeof toSpec> }> {
  const ex = PACKAGE_EXAMPLES.find((e) => e.id === id)!;
  const raw = await rCall<{ names: string[]; cols: (number | null)[][] }>('ps_dataset', { package: ex.data.package, name: ex.data.name, na: [] }, ex.data.package as RPackage);
  const data: Dataset = { names: raw.names, cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))) };
  return { data, spec: toSpec(exampleModel(ex)) };
}

it.each([['bollen-union', 'union'], ['bollen-felson', 'felson'], ['bollen-accessibility', 'accessibility'], ['bollen-reisenzein', 'reisenzein']])('%s under ML reproduces native lavaan', async (id, key) => {
  const { data, spec } = await load(id);
  const r = await estimateCbLavaan(data, spec, 'casewise', 'ML', 'product');
  const want = ref[key].ml;
  expect(r.converged).toBe(true);
  expect(r.fit.df).toBe(want.df);
  expect(r.fit.chisq).toBeCloseTo(want.chisq, 3);
  expect(r.fit.cfi).toBeCloseTo(want.cfi, 3);
  for (const w of want.estimates) {
    const pool = r.estimates.filter((e) => e.op === w.op && ((e.lhs === w.lhs && e.rhs === w.rhs) || (w.op === '~~' && e.lhs === w.rhs && e.rhs === w.lhs)));
    if (!pool.length && (w.se === 0 || w.se === null)) continue;
    expect(pool.length, `${id}: ${w.lhs} ${w.op} ${w.rhs}`).toBeGreaterThan(0);
    expect(Math.min(...pool.map((e) => Math.abs(e.est - w.est))), `${id}: ${w.lhs} ${w.op} ${w.rhs}`).toBeLessThan(1e-4 * Math.max(1, Math.abs(w.est)));
  }
  if (key === 'union') {
    // Bollen (1989), Table 4.3 / p. 83: the ML estimates of the union sentiment model.
    const est = (lhs: string, rhs: string) => r.estimates.find((e) => e.op === '~' && e.lhs === lhs && e.rhs === rhs)!.est;
    expect(est('unionsen', 'deferenc')).toBeCloseTo(-0.218, 3); expect(est('unionsen', 'laboract')).toBeCloseTo(0.850, 3); expect(est('unionsen', 'yrsmill')).toBeCloseTo(0.861, 3);
    expect(est('deferenc', 'age')).toBeCloseTo(-0.087, 3); expect(est('laboract', 'age')).toBeCloseTo(0.058, 3); expect(est('laboract', 'deferenc')).toBeCloseTo(-0.285, 3);
    expect(r.fit.chisq).toBeCloseTo(1.259, 2);
  }
}, 600_000);

it.each([['bollen-union', 'union'], ['bollen-accessibility', 'accessibility']])('%s under MIIV-2SLS (the estimator switched) reproduces MIIVsem', async (id, key) => {
  const { data, spec } = await load(id);
  const r = await miivR(data, spec, 'casewise');
  const want = ref[key].miiv;
  for (const w of want.coefficients) {
    // MIIVsem names a loading indicator~factor and a regression outcome~predictor; variances and intercepts are not in the app's MIIV table.
    if (w.name.includes('~~')) continue;
    const m = /^(.+?)~(.+)$/.exec(w.name);
    if (!m || m[2] === '1') continue;
    const e = r.estimates.find((x) => (x.op === '~' && x.lhs === m[1] && x.rhs === m[2]) || (x.op === '=~' && x.lhs === m[2] && x.rhs === m[1]));
    expect(e, `${id}: ${w.name}`).toBeTruthy();
    expect(e!.est, `${id}: ${w.name}`).toBeCloseTo(w.est, 5);
  }
  for (const q of want.eqn) {
    const e = r.equations.find((x) => x.dv === q.DVobs);
    expect(e, `${id}: equation ${q.DVobs}`).toBeTruthy();
    if (q['sargan.df'] > 0) expect(e!.sargan!).toBeCloseTo(q.sargan, 3);
  }
}, 600_000);
