// REBUS-PLS (plspm) in webR against native plspm on plspm's own example
// (scripts/validation/rebus.R: ?it.reb, simdata with two simulated segments).
// Native plspm 0.5.1, webR plspm 0.6.0. Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { parseCsv } from '../engine/dataset';
import type { ModelSpec } from '../engine/types';
import { rebusR, rebusScriptR } from './segment';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const DIR = join(__dirname, '..', 'engine', '__fixtures__', 'rebus');
const ref = JSON.parse(readFileSync(join(DIR, 'reference.json'), 'utf8'));
const data = parseCsv(readFileSync(join(DIR, 'simdata.csv'), 'utf8')).dataset;
const mv = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => `mv${a + i}`);
const spec: ModelSpec = {
  constructs: [
    { name: 'Price', type: 'factor', mode: 'A', indicators: mv(1, 5) },
    { name: 'Quality', type: 'factor', mode: 'A', indicators: mv(6, 10) },
    { name: 'Satisfaction', type: 'factor', mode: 'A', indicators: mv(11, 13) },
  ],
  paths: [
    { from: 'Price', to: 'Satisfaction' },
    { from: 'Quality', to: 'Satisfaction' },
  ],
};
const options = {
  scheme: 'centroid' as const,
  consistent: false,
  tolerance: 1e-6,
  maxIter: 100,
  missing: 'casewise' as const,
};

it('REBUS with 2 and 3 classes equals native plspm', async () => {
  const r = await rebusR(data, spec, options, {
    classes: [2, 3],
    stopCrit: 0.005,
    iterMax: 100,
    seed: 1,
  });
  expect(r.engine.package).toBe('plspm');
  expect(r.n).toBe(400);
  expect(r.globalGof).toBeCloseTo(ref.gof, 8);
  r.fusion.forEach((h, i) => expect(h).toBeCloseTo(ref.height[i], 6));
  for (const k of [2, 3]) {
    const m = r.models.find((x) => x.k === k)!,
      n = ref[`k${k}`];
    expect(m.gqi, `k = ${k}`).toBeCloseTo(n.gqi, 8);
    expect(m.sizes).toEqual(n.sizes);
    expect(m.segments).toEqual(n.segments);
    expect(m.gof.map((g) => +g.toFixed(8))).toEqual(n.gof.map((g: number) => +g.toFixed(8)));
    const p = m.paths.find((x) => x.from === 'Price')!;
    p.byClass.forEach((v, c) => expect(v).toBeCloseTo(n.paths[0][c], 8));
    expect(m.tests).toHaveLength((k * (k - 1)) / 2);
    expect(m.tests[0].gof.p).toBeGreaterThanOrEqual(0);
  }
  // The two simulated segments are recovered (as in plspm's example).
  expect(ref.k2.groupAgreement).toEqual([180, 20, 17, 183]);
  const script = await rebusScriptR(data, spec, options, {
    classes: [2],
    stopCrit: 0.005,
    iterMax: 100,
    seed: 1,
  });
  expect(script).toContain('it.reb(global, hc, nk = k');
  expect(script).toContain('path["Satisfaction", "Price"] <- 1');
}, 900_000);

it('refuses formative blocks and interactions', async () => {
  await expect(
    rebusR(
      data,
      {
        ...spec,
        constructs: spec.constructs.map((c, i) => (i === 0 ? { ...c, mode: 'B' as const } : c)),
      },
      options,
      { classes: [2], stopCrit: 0.005, iterMax: 100, seed: 1 },
    ),
  ).rejects.toThrow(/Mode A/);
}, 900_000);
