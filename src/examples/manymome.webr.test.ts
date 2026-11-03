// manymome's moderated-mediation vignette ("Moderated mediation with lm()") as
// the app runs it: the same lm() equations, do_boot(R = 100, seed = 54532), w
// probed at its mean and one SD either side. The printed conditional
// indirect effects and the index of moderated mediation must come back.
// The simple and serial mediation help pages fit their models with lavaan:
// the app's least-squares estimates must give their indirect effects.
// Run with npm run test:webr.

import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Dataset } from '../engine/types';
import { DEFAULT_SETTINGS } from '../model/project';
import { processInput } from '../process/input';
import { rCall, type RPackage } from '../rengine/bridge';
import { estimateCpaR } from '../rengine/cpa';
import { startTestRuntime, stopTestRuntime } from '../rengine/webrTestRuntime';
import { exampleModel, PACKAGE_EXAMPLES } from './packages';
import { against, example as exampleCheck } from '../validation/record';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

async function run(id: string) {
  const ex = PACKAGE_EXAMPLES.find((e) => e.id === id)!;
  exampleCheck(id, { title: ex.title, method: 'PROCESS', packages: [ex.package], definition: ex });
  against({ label: id === 'manymome-modmed' ? 'manymome vignette (printed)' : `manymome, ?${id === 'manymome-med' ? 'data_med' : 'data_serial'} (printed)`, level: 'native' });
  const raw = await rCall<{ names: string[]; cols: (number | null)[][] }>('ps_dataset', { package: ex.data.package, name: ex.data.name, na: [] }, ex.data.package as RPackage);
  const data: Dataset = { names: raw.names, cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))) };
  const st = { ...DEFAULT_SETTINGS, ...ex.settings };
  return estimateCpaR(data, processInput(exampleModel(ex), st, data)!);
}

it('manymome-modmed reproduces the vignette: conditional indirect effects at mean ± 1 SD and the index, with their bootstrap intervals', async () => {
  const r = await run('manymome-modmed');
  const rows = r.indirect.find((p) => p.path.join(' ') === 'x m y')!.rows;
  // Printed: M+1.0SD 3.164 → 3.060 [2.168, 4.039]; Mean 2.179 → 2.136 [1.407, 2.925]; M−1.0SD 1.194 → 1.212 [−0.288, 2.564].
  const want = [[1.194, 1.212, -0.288, 2.564], [2.179, 2.136, 1.407, 2.925], [3.164, 3.060, 2.168, 4.039]];
  const byW = [...rows].sort((a, b) => Number(Object.values(a.at)[0]) - Number(Object.values(b.at)[0]));
  expect(byW.length).toBe(3);
  byW.forEach((row, i) => {
    const [w, ind, lo, hi] = want[i];
    expect(Number(Object.values(row.at)[0]), `moderator value ${i + 1}`).toBeCloseTo(w, 3);
    expect(row.est, `conditional indirect effect at w = ${w}`).toBeCloseTo(ind, 3);
    expect(row.lo, `lower limit at w = ${w}`).toBeCloseTo(lo, 3);
    expect(row.hi, `upper limit at w = ${w}`).toBeCloseTo(hi, 3);
  });
  // Printed: Index = 0.938, 95% bootstrap percentile CI [0.178, 1.732].
  const mm = r.indices.find((k) => k.kind === 'mm')!;
  expect(mm.est, 'index of moderated mediation').toBeCloseTo(0.938, 3); expect(mm.lo, 'index: lower limit').toBeCloseTo(0.178, 3); expect(mm.hi, 'index: upper limit').toBeCloseTo(1.732, 3);
}, 900_000);

it('manymome-med and manymome-serial: the least-squares indirect effects equal the help pages’ lavaan ones', async () => {
  // ?data_med: ab := a*b, 0.733; ?data_serial: indirect := a*b1*b2, 0.180 (both printed by the help pages' code, 3 decimals).
  const med = await run('manymome-med');
  expect(med.indirect.find((p) => p.path.join(' ') === 'x m y')!.rows[0].est, 'indirect effect x → m → y').toBeCloseTo(0.733, 3);
  const serial = await run('manymome-serial');
  expect(serial.indirect.find((p) => p.path.join(' ') === 'x m1 m2 y')!.rows[0].est, 'indirect effect x → m1 → m2 → y').toBeCloseTo(0.180, 3);
}, 900_000);
