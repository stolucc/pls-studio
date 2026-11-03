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
import { against, example, same } from '../validation/record';
import { nearest } from '../validation/textbook';
import { exampleModel, PACKAGE_EXAMPLES } from './packages';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

type Ml = { n: number; chisq: number; df: number; cfi: number; tli: number; estimates: { lhs: string; op: string; rhs: string; est: number; se: number | null }[] };
type Miiv = { coefficients: { name: string; est: number }[]; eqn: { DVobs: string; sargan: number; 'sargan.df': number }[] };
const ref = JSON.parse(readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'textbook', 'bollen.json'), 'utf8')) as Record<string, { ml: Ml; miiv: Miiv }>;

async function load(id: string): Promise<{ data: Dataset; spec: ReturnType<typeof toSpec> }> {
  const ex = PACKAGE_EXAMPLES.find((e) => e.id === id)!;
  example(id, { title: ex.title, method: 'CB-SEM', packages: [ex.package], definition: ex });
  const raw = await rCall<{ names: string[]; cols: (number | null)[][] }>('ps_dataset', { package: ex.data.package, name: ex.data.name, na: [] }, ex.data.package as RPackage);
  const data: Dataset = { names: raw.names, cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))) };
  return { data, spec: toSpec(exampleModel(ex)) };
}

it.each([['bollen-union', 'union'], ['bollen-felson', 'felson'], ['bollen-reisenzein', 'reisenzein']])('%s under ML reproduces native lavaan', async (id, key) => {
  const { data, spec } = await load(id);
  const r = await estimateCbLavaan(data, spec, 'casewise', 'ML', 'product');
  const want = ref[key].ml;
  expect(r.converged).toBe(true);
  against({ label: 'desktop lavaan, the help page’s model, scripts/validation/bollen.R', script: 'scripts/validation/bollen.R', level: 'native' });
  same('df', r.fit.df, want.df);
  expect(r.fit.chisq, 'χ²').toBeCloseTo(want.chisq, 3);
  expect(r.fit.cfi, 'CFI').toBeCloseTo(want.cfi, 3);
  // (TLI: the baseline as lavaan's for the help page's syntax; union writes yrsmill ~~ age out, so every variable is uncorrelated in it)
  expect(r.fit.tli, 'TLI').toBeCloseTo(want.tli, 3);
  for (const w of want.estimates) {
    const pool = r.estimates.filter((e) => e.op === w.op && ((e.lhs === w.lhs && e.rhs === w.rhs) || (w.op === '~~' && e.lhs === w.rhs && e.rhs === w.lhs)));
    if (!pool.length && (w.se === 0 || w.se === null)) continue;
    expect(pool.length, `${id}: ${w.lhs} ${w.op} ${w.rhs}`).toBeGreaterThan(0);
    nearest(`${w.lhs} ${w.op} ${w.rhs}`, pool, w.est);
  }
  if (key === 'union') {
    // Bollen (1989), Table 4.3 / p. 83: the ML estimates of the union sentiment model.
    against({ label: 'Bollen (1989), Structural Equations with Latent Variables, Table 4.3', level: 'published' });
    const est = (lhs: string, rhs: string) => r.estimates.find((e) => e.op === '~' && e.lhs === lhs && e.rhs === rhs)!.est;
    for (const [lhs, rhs, v] of [['unionsen', 'deferenc', -0.218], ['unionsen', 'laboract', 0.850], ['unionsen', 'yrsmill', 0.861], ['deferenc', 'age', -0.087], ['laboract', 'age', 0.058], ['laboract', 'deferenc', -0.285]] as const)
      expect(est(lhs, rhs), `${lhs} ~ ${rhs} (Bollen)`).toBeCloseTo(v, 3);
    expect(r.fit.chisq, 'χ² (Bollen)').toBeCloseTo(1.259, 2);
  }
}, 600_000);

it.each([['bollen-union', 'union'], ['bollen-accessibility', 'accessibility']])('%s under MIIV-2SLS (the estimator switched) reproduces MIIVsem', async (id, key) => {
  const { data, spec } = await load(id);
  against({ label: 'desktop MIIVsem, the help page’s model, scripts/validation/bollen.R', script: 'scripts/validation/bollen.R', level: 'native' });
  const r = await miivR(data, spec, 'casewise');
  const want = ref[key].miiv;
  for (const w of want.coefficients) {
    // MIIVsem names a loading indicator~factor and a regression outcome~predictor; variances and intercepts are not in the app's MIIV table.
    if (w.name.includes('~~')) continue;
    const m = /^(.+?)~(.+)$/.exec(w.name);
    if (!m || m[2] === '1') continue;
    const e = r.estimates.find((x) => (x.op === '~' && x.lhs === m[1] && x.rhs === m[2]) || (x.op === '=~' && x.lhs === m[2] && x.rhs === m[1]));
    expect(e, `${id}: ${w.name}`).toBeTruthy();
    expect(e!.est, `MIIV-2SLS ${w.name}`).toBeCloseTo(w.est, 5);
  }
  for (const q of want.eqn) {
    const e = r.equations.find((x) => x.dv === q.DVobs);
    expect(e, `${id}: equation ${q.DVobs}`).toBeTruthy();
    if (q['sargan.df'] > 0) expect(e!.sargan!, `Sargan test, ${q.DVobs}`).toBeCloseTo(q.sargan, 3);
  }
}, 600_000);
